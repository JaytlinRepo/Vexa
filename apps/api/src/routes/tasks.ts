import { Router } from 'express'
import { PrismaClient, TaskStatus } from '@prisma/client'
import { z } from 'zod'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import { createNotification } from '../services/notifications/notification.service'
import { assertTaskQuota, computeUsage } from '../lib/usage'

const prisma = new PrismaClient()
const router = Router()

const createSchema = z.object({
  companyId: z.string().uuid(),
  employeeId: z.string().uuid(),
  title: z.string().min(3).max(200),
  description: z.string().max(2000).optional(),
  type: z.enum(['trend_report', 'content_plan', 'hooks', 'caption', 'script', 'shot_list', 'video']),
})

router.post('/', requireAuth, async (req, res, next) => {
  try {
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

    res.status(201).json({ task, usage: await computeUsage(prisma, userId) })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'invalid_input', issues: err.issues })
      return
    }
    next(err)
  }
})

const actionSchema = z.object({
  action: z.enum(['approve', 'reject', 'reconsider', 'regenerate']),
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
        newStatus = 'approved'
        break
      case 'reject':
        newStatus = 'rejected'
        break
      case 'reconsider':
      case 'regenerate':
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

    // Fire a notification so the bell + SSE stream picks it up.
    try {
      const emojiByRole: Record<string, string> = {
        analyst: '📊',
        strategist: '🗺️',
        copywriter: '✍️',
        creative_director: '🎬',
      }
      const employeeName = updated.employee.name
      const emoji = emojiByRole[updated.employee.role] ?? '✅'
      if (data.action === 'approve') {
        await createNotification({
          userId,
          companyId: updated.companyId,
          type: 'task_approved',
          emoji,
          title: `${employeeName}'s work approved`,
          body: `You approved "${updated.title}". The next step auto-kicks off.`,
          metadata: { taskId: updated.id },
        })
      } else if (data.action === 'reject') {
        await createNotification({
          userId,
          companyId: updated.companyId,
          type: 'team_update',
          emoji: '↩️',
          title: `${employeeName} will rework "${updated.title}"`,
          body: 'Feedback noted. A revised version will be ready shortly.',
          metadata: { taskId: updated.id },
        })
      }
    } catch (e) {
      // Don't fail the action if notification emission errors out.
      console.warn('[tasks] notification emit failed', e)
    }

    res.json({ task: updated })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'invalid_input', issues: err.issues })
      return
    }
    next(err)
  }
})

export default router
