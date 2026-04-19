import { Router } from 'express'
import { TaskStatus, type OutputType } from '@prisma/client'
import prisma from '../lib/prisma'
import { z } from 'zod'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import { createNotification } from '../services/notifications/notification.service'
import { assertTaskQuota, computeUsage } from '../lib/usage'
import { recordTaskApproved, recordTaskRejected } from '../lib/brandMemory'
import { executeAndStore } from '../services/agentExecutor'
import { orchestrateTask } from '../agents/task-orchestrator'
import { AgentRole } from '../lib/nicheKnowledge'
import { triggerNextAgentAfterApproval, type AgentPipelineChainResult } from '../agents/task-orchestrator'
import { tryAutoApproveDeliveredTask } from '../lib/autoShip'
import { PLAN_LIMITS } from '../lib/plans'
import { getBedrockUsage } from '../lib/bedrockUsage'

const router = Router()

const emojiByRole: Record<string, string> = {
  analyst: '📊',
  strategist: '🗺️',
  copywriter: '✍️',
  creative_director: '🎬',
}

function chainProgressBody(taskTitle: string, chain: AgentPipelineChainResult, tone: 'manual' | 'auto'): string {
  if (chain.ok === true) {
    return tone === 'auto'
      ? `${chain.nextEmployeeName} picked up "${chain.title}" — lighter deliverables ship on your defaults; this is your next stop.`
      : `${chain.nextEmployeeName} picked up "${chain.title}" — it is in your queue now.`
  }
  if (chain.reason === 'quota_exceeded') {
    return tone === 'auto'
      ? `"${taskTitle}" cleared on defaults, but the plan task limit blocked the next role — upgrade or wait for reset.`
      : `You approved "${taskTitle}". Plan task limit reached — upgrade or wait for reset to auto-chain the next role.`
  }
  if (chain.reason === 'end_of_pipeline') {
    return tone === 'auto'
      ? `"${taskTitle}" cleared on defaults — that was the last role in this pipeline.`
      : `You approved "${taskTitle}". That was the last role in this pipeline.`
  }
  return tone === 'auto'
    ? `"${taskTitle}" cleared on defaults — the next step will start when the team has capacity.`
    : `You approved "${taskTitle}". The next step will start when the team has capacity.`
}

const createSchema = z.object({
  companyId: z.string().uuid(),
  employeeId: z.string().uuid(),
  title: z.string().min(3).max(200),
  description: z.string().max(2000).optional(),
  type: z.enum(['trend_report', 'content_plan', 'hooks', 'caption', 'script', 'shot_list', 'video', 'upload_review']),
  briefKind: z.string().min(1).max(60).optional(),
})

// Per-user brief cooldown — duration comes from plan limits.
const briefCooldowns = new Map<string, number>()

router.post('/', requireAuth, async (req, res, next) => {
  try {
    console.log('[tasks] POST /api/tasks received', { body: req.body?.type, briefKind: req.body?.briefKind })
    const { userId } = (req as AuthedRequest).session
    const data = createSchema.parse(req.body)

    const company = await prisma.company.findFirst({
      where: { id: data.companyId, userId },
      include: { employees: { where: { id: data.employeeId } } },
    })
    if (!company) {
      res.status(404).json({ error: 'company_not_found' })
      return
    }
    if (company.employees.length === 0) {
      res.status(404).json({ error: 'employee_not_found' })
      return
    }

    // Plan-based enforcement
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } })
    const plan = PLAN_LIMITS[user?.plan ?? 'starter']

    // Cooldown: plan-based minutes between briefs per agent
    const cooldownMs = plan.briefCooldownMin * 60 * 1000
    const cooldownKey = `${userId}:${data.employeeId}`
    const lastBrief = briefCooldowns.get(cooldownKey) || 0
    if (Date.now() - lastBrief < cooldownMs) {
      const waitSec = Math.ceil((cooldownMs - (Date.now() - lastBrief)) / 1000)
      res.status(429).json({ error: 'brief_cooldown', message: `This agent is still working. Try again in ${waitSec}s.`, retryAfter: waitSec })
      return
    }

    // Bedrock monthly cap
    const bedrockUsage = getBedrockUsage(company.id)
    if (bedrockUsage.count >= plan.bedrockCallsPerMonth) {
      res.status(402).json({ error: 'bedrock_limit_reached', message: `Your ${user?.plan} plan allows ${plan.bedrockCallsPerMonth} AI calls per month. Upgrade for more.` })
      return
    }

    // Employee access: check the role is available on this plan
    const empRole = company.employees[0].role
    if (!plan.employees.includes(empRole as typeof plan.employees[number])) {
      res.status(403).json({ error: 'employee_locked', message: `${company.employees[0].name} is not available on your current plan. Upgrade to unlock.` })
      return
    }

    briefCooldowns.set(cooldownKey, Date.now())

    try {
      await assertTaskQuota(prisma, userId)
    } catch (err) {
      const e = err as Error & { code?: string; usage?: unknown }
      if (e.code === 'plan_limit_exceeded') {
        res.status(402).json({ error: 'plan_limit_exceeded', usage: e.usage })
        return
      }
      throw err
    }

    const task = await prisma.task.create({
      data: {
        companyId: company.id,
        employeeId: data.employeeId,
        title: data.title,
        description: data.description,
        type: data.type,
        status: 'in_progress',
      },
      include: { employee: true },
    })

    // Return immediately — the agent works in the background. The CEO
    // sees the task card flip to 'delivered' via SSE when it's done.
    res.status(201).json({
      task,
      usage: await computeUsage(prisma, userId),
      execution: { knowledgeUsed: 0, source: null },
      deliveryMode: 'awaiting_review',
      async: true,
    })

    // Fire-and-forget: run the agent in the background
    void (async () => {
      try {
        try {
          await orchestrateTask(task.id)
          console.log('[tasks] orchestrateTask completed for', task.id)
        } catch (bedrockErr) {
          console.warn('[tasks] orchestrateTask failed, falling back to mock', (bedrockErr as Error).message)
          const role = task.employee.role as AgentRole
          await executeAndStore(prisma, {
            taskId: task.id,
            companyId: company.id,
            niche: company.niche,
            role,
            type: data.type,
            title: data.title,
            description: data.description,
            briefKind: data.briefKind,
          })
        }

        // Auto-approve check
        const auto = await tryAutoApproveDeliveredTask(prisma, {
          companyId: company.id,
          taskId: task.id,
          outputType: data.type as OutputType,
          agentTools: company.agentTools,
        })

        let postDeliveryChain: AgentPipelineChainResult | undefined
        if (auto.didAuto) {
          const closed = await prisma.task.findUnique({
            where: { id: task.id },
            include: { employee: true, outputs: true },
          })
          if (closed) {
            try {
              postDeliveryChain = await triggerNextAgentAfterApproval(prisma, {
                id: closed.id,
                companyId: company.id,
                employee: closed.employee,
              })
            } catch (e) {
              console.warn('[tasks] auto-ship chain failed', e)
            }
          }
        }

        // Notify the CEO that the deliverable is ready
        const empName = task.employee.name || 'Your agent'
        const emoji = emojiByRole[task.employee.role] ?? '📋'
        await createNotification({
          userId,
          companyId: company.id,
          type: 'output_delivered',
          emoji,
          title: `${empName} finished: ${task.title}`,
          body: 'Ready for your review.',
          actionLabel: 'Open deliverable',
          metadata: {
            taskId: task.id,
            ...(postDeliveryChain?.ok === true ? { nextTaskId: postDeliveryChain.nextTaskId } : {}),
          },
        })
      } catch (err) {
        console.warn('[tasks] background execution failed', err)
        try {
          await prisma.output.create({
            data: {
              taskId: task.id,
              companyId: company.id,
              employeeId: task.employeeId,
              type: data.type,
              content: {
                error: 'execution_failed',
                note: 'The agent could not complete this brief. Re-brief to try again.',
                message: (err as Error)?.message?.slice(0, 500) || null,
              } as unknown as import('@prisma/client').Prisma.InputJsonObject,
              status: 'draft',
            },
          })
          await prisma.task.update({
            where: { id: task.id },
            data: { status: 'revision' },
          })
        } catch (e2) {
          console.warn('[tasks] failed to persist execution-failed stub', e2)
        }
      }
    })()
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'invalid_input', issues: err.issues })
      return
    }
    next(err)
  }
})

const actionSchema = z.object({
  action: z.enum(['approve', 'reject', 'reconsider', 'regenerate', 'post_anyway', 'save_unreleased', 'accept_notes']),
  feedback: z.string().max(1000).optional(),
})

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const companyId = (req.query.companyId as string | undefined) ?? undefined
    const status = req.query.status as TaskStatus | undefined

    // Scope by user's companies
    const company = companyId
      ? await prisma.company.findFirst({ where: { id: companyId, userId } })
      : await prisma.company.findFirst({ where: { userId } })
    if (!company) {
      res.json({ tasks: [] })
      return
    }

    const tasks = await prisma.task.findMany({
      where: { companyId: company.id, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { employee: true, outputs: true },
      take: 50,
    })
    res.json({ tasks, companyId: company.id })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/action', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const data = actionSchema.parse(req.body)

    const task = await prisma.task.findUnique({
      where: { id: req.params.id },
      include: { company: true },
    })
    if (!task || task.company.userId !== userId) {
      res.status(404).json({ error: 'task_not_found' })
      return
    }

    let newStatus: TaskStatus
    switch (data.action) {
      case 'approve':
      case 'post_anyway':
      case 'save_unreleased':
        newStatus = 'approved'
        break
      case 'reject':
        newStatus = 'rejected'
        break
      case 'reconsider':
      case 'regenerate':
      case 'accept_notes':
        newStatus = 'revision'
        break
    }

    const updated = await prisma.task.update({
      where: { id: task.id },
      data: {
        status: newStatus,
        userAction: { type: data.action, feedback: data.feedback, ts: new Date().toISOString() },
        completedAt: newStatus === 'approved' || newStatus === 'rejected' ? new Date() : null,
      },
      include: { employee: true, outputs: true },
    })

    let chain: AgentPipelineChainResult | undefined

    // Fire a notification so the bell + SSE stream picks it up.
    try {
      const employeeName = updated.employee.name
      const emoji = emojiByRole[updated.employee.role] ?? '✅'
      if (data.action === 'approve' || data.action === 'post_anyway' || data.action === 'save_unreleased') {
        const outputs = updated.outputs ?? []
        const latestOutput =
          outputs.length === 0
            ? null
            : outputs.reduce((a, b) => (a.createdAt > b.createdAt ? a : b))
        if (latestOutput) {
          await prisma.output.update({
            where: { id: latestOutput.id },
            data: { status: 'approved' },
          })
        }
        await recordTaskApproved(prisma, {
          companyId: updated.companyId,
          taskId: updated.id,
          taskTitle: updated.title,
          taskType: updated.type,
          employeeName,
        })
        // Save unreleased: store content but do NOT trigger publishing pipeline
        if (data.action === 'save_unreleased') {
          // Check if unreleased pile has hit 25 — nudge the CEO
          const unreleasedCount = await prisma.task.count({
            where: {
              companyId: updated.companyId,
              type: 'upload_review',
              status: 'approved',
              userAction: { path: ['type'], equals: 'save_unreleased' },
            },
          })
          if (unreleasedCount >= 25 && unreleasedCount % 25 === 0) {
            await createNotification({
              userId,
              companyId: updated.companyId,
              type: 'team_update',
              emoji: '⚠️',
              title: `${unreleasedCount} unreleased items piling up`,
              body: 'You have ' + unreleasedCount + ' saved uploads that haven\'t been posted. Take a few minutes to review them — release what\'s ready, scrap what\'s not.',
              actionLabel: 'Open Content tab',
              metadata: { tab: 'content' },
            })
          }
          await createNotification({
            userId,
            companyId: updated.companyId,
            type: 'task_approved',
            emoji: '📦',
            title: 'Content saved as unreleased',
            body: `"${updated.title}" saved. It won't be posted until you release it.`,
            actionLabel: 'Open Content tab',
            metadata: { taskId: updated.id },
          })
        } else {
          // Regular approve / post_anyway — trigger the pipeline
          try {
            chain = await triggerNextAgentAfterApproval(prisma, {
              id: updated.id,
              companyId: updated.companyId,
              employee: updated.employee,
            })
          } catch (e) {
            console.warn('[tasks] triggerNextAgentAfterApproval failed', e)
            chain = { ok: false, reason: 'bad_config' }
          }

          const chainBody = chainProgressBody(updated.title, chain, 'manual')

          await createNotification({
            userId,
            companyId: updated.companyId,
            type: 'task_approved',
            emoji,
            title: `${employeeName}'s work approved`,
            body: chainBody,
            actionLabel: chain.ok === true ? 'Open next deliverable' : 'Open queue',
            metadata: {
              taskId: updated.id,
              ...(chain.ok === true ? { nextTaskId: chain.nextTaskId, nextTaskTitle: chain.title } : {}),
            },
          })
        }
      } else if (data.action === 'reject') {
        await createNotification({
          userId,
          companyId: updated.companyId,
          type: 'team_update',
          emoji: '↩️',
          title: `${employeeName} is revising "${updated.title}"`,
          body: data.feedback
            ? `Revision requested: "${String(data.feedback).slice(0, 180)}${String(data.feedback).length > 180 ? '…' : ''}"`
            : 'Revision requested — they will rework from your last review.',
          actionLabel: 'Open queue',
          metadata: { taskId: updated.id },
        })
        await recordTaskRejected(prisma, {
          companyId: updated.companyId,
          taskId: updated.id,
          taskTitle: updated.title,
          taskType: updated.type,
          employeeName,
          feedback: data.feedback,
        })
      }
    } catch (e) {
      // Don't fail the action if notification or memory emission errors out.
      console.warn('[tasks] notification/memory emit failed', e)
    }

    res.json({ task: updated, ...(chain !== undefined ? { chain } : {}) })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'invalid_input', issues: err.issues })
      return
    }
    next(err)
  }
})

export default router
