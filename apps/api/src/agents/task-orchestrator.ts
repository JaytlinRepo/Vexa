import { PrismaClient, Prisma, OutputType as PrismaOutputType } from '@prisma/client'
import { invokeAgent, parseAgentOutput, retrieveNicheContext, buildLayeredPrompt } from '../services/bedrock/bedrock.service'
import { buildMayaSystemPrompt, buildMayaTaskPrompt, buildMayaPerformanceSystemPrompt, buildMayaPerformanceTaskPrompt, buildMayaPulseSystemPrompt, buildMayaPulseTaskPrompt } from './maya/system-prompt'
import { buildJordanSystemPrompt, buildAlexSystemPrompt, buildRileySystemPrompt } from './jordan-alex-riley-prompts'
import { TrendReport, ContentPlan, HooksOutput, ScriptOutput, ShotListOutput, PerformanceReview, WeeklyPulse, OutputType } from '@vexa/types'
import { executeAndStore } from '../services/agentExecutor'
import { assertTaskQuota } from '../lib/usage'
import { tryAutoApproveDeliveredTask } from '../lib/autoShip'
import { AgentRole } from '../lib/nicheKnowledge'

const prisma = new PrismaClient()

// ─── ORCHESTRATE TASK ─────────────────────────────────────────────────────────

/**
 * Main entry point for executing a task.
 * Determines which agent handles it, builds the prompt, calls Bedrock, stores output.
 */
export async function orchestrateTask(taskId: string): Promise<void> {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      employee: true,
      company: true,
    },
  })

  await prisma.task.update({
    where: { id: taskId },
    data: { status: 'in_progress' },
  })

  try {
    const outputContent = await executeAgentTask(task)

    // Store output
    await prisma.output.create({
      data: {
        taskId,
        companyId: task.companyId,
        employeeId: task.employeeId,
        type: getOutputTypeForTask(task.type) as OutputType,
        content: outputContent as unknown as never,
        status: 'draft',
        version: 1,
      },
    })

    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'delivered',
        completedAt: new Date(),
      },
    })
  } catch (error) {
    await prisma.task.update({
      where: { id: taskId },
      data: { status: 'pending' }, // reset to retry
    })
    throw error
  }
}

// ─── EXECUTE BY ROLE ──────────────────────────────────────────────────────────

async function executeAgentTask(task: {
  id: string
  companyId: string
  type: string
  description: string | null
  employee: { role: string; name: string }
  company: {
    niche: string
    subNiche: string | null
    brandVoice: unknown
    audience: unknown
    goals: unknown
  }
}): Promise<unknown> {
  const { company, employee, description } = task
  const niche = company.niche
  const brandVoice = JSON.stringify(company.brandVoice)
  const audience = JSON.stringify(company.audience)
  const goals = JSON.stringify(company.goals)

  // Fetch niche context from RAG
  const nicheContext = await retrieveNicheContext(niche, description || task.type)

  // Fetch brand memory
  const brandMemory = await getBrandMemory(task.id)

  switch (employee.role) {
    case 'analyst':
      return executeMayaTask({ niche, brandVoice, nicheContext, brandMemory, description, taskType: task.type, companyId: task.companyId })

    case 'strategist':
      return executeJordanTask({ niche, brandVoice, audience, goals, nicheContext, brandMemory, description })

    case 'copywriter':
      return executeAlexTask({ niche, brandVoice, audience, nicheContext, brandMemory, description, taskType: task.type })

    case 'creative_director':
      return executeRileyTask({ niche, brandVoice, nicheContext, brandMemory, description })

    default:
      throw new Error(`Unknown employee role: ${employee.role}`)
  }
}

// ─── AGENT EXECUTORS ──────────────────────────────────────────────────────────

async function executeMayaTask(ctx: {
  niche: string
  brandVoice: string
  nicheContext: string
  brandMemory: string
  description: string | null
  taskType?: string
  companyId?: string
}): Promise<TrendReport | PerformanceReview | WeeklyPulse> {
  if (ctx.taskType === 'performance_review' && ctx.companyId) {
    return executeMayaPerformanceReview({ ...ctx, companyId: ctx.companyId })
  }
  if (ctx.taskType === 'weekly_pulse' && ctx.companyId) {
    return executeMayaWeeklyPulse({ ...ctx, companyId: ctx.companyId })
  }

  const basePrompt = buildMayaSystemPrompt({
    niche: ctx.niche,
    brandVoice: ctx.brandVoice,
  })

  const systemPrompt = buildLayeredPrompt({
    baseSystemPrompt: basePrompt,
    nicheContext: ctx.nicheContext,
    brandMemory: ctx.brandMemory,
  })

  const raw = await invokeAgent({
    systemPrompt,
    messages: [{ role: 'user', content: buildMayaTaskPrompt(ctx.description || 'Generate weekly trend report') }],
    maxTokens: 2048,
    temperature: 0.6,
  })

  return parseAgentOutput<TrendReport>(raw)
}

async function executeMayaPerformanceReview(ctx: {
  niche: string
  brandVoice: string
  nicheContext: string
  brandMemory: string
  companyId: string
}): Promise<PerformanceReview> {
  const { loadPersonalContext } = await import('../lib/personalContext')
  const personal = await loadPersonalContext(prisma, ctx.companyId)
  const tt = personal?.tiktok
  if (!tt || tt.recentVideos.length === 0) {
    throw new Error('No TikTok data available for performance review')
  }

  const basePrompt = buildMayaPerformanceSystemPrompt({
    niche: ctx.niche,
    brandVoice: ctx.brandVoice,
    platform: 'tiktok',
  })

  const systemPrompt = buildLayeredPrompt({
    baseSystemPrompt: basePrompt,
    nicheContext: ctx.nicheContext,
    brandMemory: ctx.brandMemory,
  })

  const taskPrompt = buildMayaPerformanceTaskPrompt({
    handle: tt.handle,
    followerCount: tt.followerCount,
    totalLikes: tt.likesCount,
    totalVideos: tt.videoCount,
    avgViews: tt.avgViews,
    engagementRate: tt.engagementRate,
    reachRate: tt.reachRate,
    videos: tt.recentVideos.map((v) => ({
      caption: v.caption,
      url: v.url,
      publishedAt: v.publishedAt,
      viewCount: v.viewCount,
      likeCount: v.likeCount,
      commentCount: v.commentCount,
      shareCount: v.shareCount,
    })),
  })

  const raw = await invokeAgent({
    systemPrompt,
    messages: [{ role: 'user', content: taskPrompt }],
    maxTokens: 3072,
    temperature: 0.5,
  })

  return parseAgentOutput<PerformanceReview>(raw)
}

async function executeMayaWeeklyPulse(ctx: {
  niche: string
  brandVoice: string
  nicheContext: string
  brandMemory: string
  companyId: string
}): Promise<WeeklyPulse> {
  const { loadPersonalContext } = await import('../lib/personalContext')
  const personal = await loadPersonalContext(prisma, ctx.companyId)
  const tt = personal?.tiktok
  if (!tt || tt.recentVideos.length === 0) {
    throw new Error('No TikTok data available for weekly pulse')
  }

  const basePrompt = buildMayaPulseSystemPrompt({
    niche: ctx.niche,
    brandVoice: ctx.brandVoice,
    platform: 'tiktok',
  })

  const systemPrompt = buildLayeredPrompt({
    baseSystemPrompt: basePrompt,
    nicheContext: ctx.nicheContext,
    brandMemory: ctx.brandMemory,
  })

  const taskPrompt = buildMayaPulseTaskPrompt({
    handle: tt.handle,
    followerCount: tt.followerCount,
    avgViews: tt.avgViews,
    engagementRate: tt.engagementRate,
    videos: tt.recentVideos.map((v) => ({
      caption: v.caption,
      url: v.url,
      publishedAt: v.publishedAt,
      viewCount: v.viewCount,
      likeCount: v.likeCount,
      commentCount: v.commentCount,
      shareCount: v.shareCount,
    })),
  })

  const raw = await invokeAgent({
    systemPrompt,
    messages: [{ role: 'user', content: taskPrompt }],
    maxTokens: 1024,
    temperature: 0.5,
  })

  return parseAgentOutput<WeeklyPulse>(raw)
}

async function executeJordanTask(ctx: {
  niche: string
  brandVoice: string
  audience: string
  goals: string
  nicheContext: string
  brandMemory: string
  description: string | null
}): Promise<ContentPlan> {
  const basePrompt = buildJordanSystemPrompt({
    niche: ctx.niche,
    brandVoice: ctx.brandVoice,
    audience: ctx.audience,
    goals: ctx.goals,
  })

  const systemPrompt = buildLayeredPrompt({
    baseSystemPrompt: basePrompt,
    nicheContext: ctx.nicheContext,
    brandMemory: ctx.brandMemory,
  })

  const raw = await invokeAgent({
    systemPrompt,
    messages: [{ role: 'user', content: ctx.description || 'Build the weekly content plan' }],
    maxTokens: 2048,
    temperature: 0.7,
  })

  return parseAgentOutput<ContentPlan>(raw)
}

async function executeAlexTask(ctx: {
  niche: string
  brandVoice: string
  audience: string
  nicheContext: string
  brandMemory: string
  description: string | null
  taskType: string
}): Promise<HooksOutput | ScriptOutput> {
  const basePrompt = buildAlexSystemPrompt({
    niche: ctx.niche,
    brandVoice: ctx.brandVoice,
    audience: ctx.audience,
  })

  const systemPrompt = buildLayeredPrompt({
    baseSystemPrompt: basePrompt,
    nicheContext: ctx.nicheContext,
    brandMemory: ctx.brandMemory,
  })

  const raw = await invokeAgent({
    systemPrompt,
    messages: [{ role: 'user', content: ctx.description || 'Write hooks for this week\'s content' }],
    maxTokens: 2048,
    temperature: 0.85,
  })

  return parseAgentOutput<HooksOutput | ScriptOutput>(raw)
}

async function executeRileyTask(ctx: {
  niche: string
  brandVoice: string
  nicheContext: string
  brandMemory: string
  description: string | null
}): Promise<ShotListOutput> {
  const basePrompt = buildRileySystemPrompt({
    niche: ctx.niche,
    brandVoice: ctx.brandVoice,
  })

  const systemPrompt = buildLayeredPrompt({
    baseSystemPrompt: basePrompt,
    nicheContext: ctx.nicheContext,
    brandMemory: ctx.brandMemory,
  })

  const raw = await invokeAgent({
    systemPrompt,
    messages: [{ role: 'user', content: ctx.description || 'Create the shot list and production brief' }],
    maxTokens: 2048,
    temperature: 0.7,
  })

  return parseAgentOutput<ShotListOutput>(raw)
}

// ─── HANDLE USER ACTION ON OUTPUT ────────────────────────────────────────────

/**
 * Process a button action from the user on a delivered output.
 * Approved: store memory, mark done.
 * Rejected: mark rejected.
 * Reconsider: trigger regeneration with feedback.
 */
export async function handleTaskAction(
  taskId: string,
  action: {
    type: string
    label: string
    feedback?: string
  }
): Promise<void> {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: { outputs: true, employee: true, company: true },
  })

  const isApprove = action.type === 'approve' || action.type.startsWith('use_') || action.type === 'start_production'
  const isReject = action.type === 'reject' || action.type === 'regenerate' || action.type === 'start_over'
  const isReconsider = !isApprove && !isReject

  if (isApprove) {
    await prisma.task.update({ where: { id: taskId }, data: { status: 'approved', userAction: action as never } })

    // Save as positive brand memory
    const latestOutput = task.outputs[task.outputs.length - 1]
    if (latestOutput) {
      await prisma.output.update({ where: { id: latestOutput.id }, data: { status: 'approved' } })
      await prisma.brandMemory.create({
        data: {
          companyId: task.companyId,
          memoryType: 'feedback',
          content: {
            type: 'approval',
            outputType: latestOutput.type,
            employeeRole: task.employee.role,
            action: action.type,
          } as never,
          weight: 1.5,
        },
      })
    }

    // Trigger next agent in pipeline if applicable
    await triggerNextAgentAfterApproval(prisma, task)

  } else if (isReject) {
    await prisma.task.update({ where: { id: taskId }, data: { status: 'rejected', userAction: action as never } })

    const latestOutput = task.outputs[task.outputs.length - 1]
    if (latestOutput) {
      await prisma.output.update({ where: { id: latestOutput.id }, data: { status: 'rejected' } })
    }

  } else if (isReconsider) {
    await prisma.task.update({ where: { id: taskId }, data: { status: 'revision', userAction: action as never } })

    // Save reconsider as memory signal with lower weight
    await prisma.brandMemory.create({
      data: {
        companyId: task.companyId,
        memoryType: 'feedback',
        content: {
          type: 'reconsider',
          outputType: task.type,
          action: action.type,
          feedback: action.feedback || action.label,
        } as never,
        weight: 0.8,
      },
    })

    // Regenerate with feedback context
    await regenerateWithFeedback(taskId, action)
  }
}

// ─── REGENERATE WITH FEEDBACK ─────────────────────────────────────────────────

async function regenerateWithFeedback(
  taskId: string,
  action: { type: string; label: string; feedback?: string }
): Promise<void> {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: { employee: true, company: true, outputs: true },
  })

  const latestOutput = task.outputs[task.outputs.length - 1]
  const feedbackContext = `Previous output was sent back with action: "${action.label}". ${action.feedback ? `CEO note: "${action.feedback}"` : ''} Please improve accordingly.`

  const modifiedTask = {
    ...task,
    description: `${task.description || ''}\n\nREVISION FEEDBACK: ${feedbackContext}`,
  }

  const newContent = await executeAgentTask(modifiedTask)

  const newVersion = (latestOutput?.version || 1) + 1

  await prisma.output.create({
    data: {
      taskId,
      companyId: task.companyId,
      employeeId: task.employeeId,
      type: latestOutput!.type as OutputType,
      content: newContent as never,
      status: 'draft',
      version: newVersion,
      feedback: { action: action.type, note: action.feedback } as never,
    },
  })

  await prisma.task.update({
    where: { id: taskId },
    data: { status: 'delivered' },
  })
}

// ─── PIPELINE TRIGGERS ────────────────────────────────────────────────────────

const PIPELINE_OUTPUT_TYPE: Record<string, PrismaOutputType> = {
  strategist: 'content_plan',
  copywriter: 'hooks',
  creative_director: 'shot_list',
}

/** Result of trying to run the next pipeline step after an approval. */
export type AgentPipelineChainResult =
  | { ok: false; reason: 'end_of_pipeline' | 'no_company' | 'quota_exceeded' | 'no_next_employee' | 'bad_config' }
  | {
      ok: true
      nextTaskId: string
      title: string
      outputType: PrismaOutputType
      nextRole: string
      nextEmployeeName: string
    }

/**
 * After an output is approved, create the next role's task and run the same
 * execution path as POST /api/tasks (`executeAndStore`), so chained work
 * matches manual briefs (Bedrock / mocks, niche RAG, brand memory).
 */
export async function triggerNextAgentAfterApproval(
  db: PrismaClient,
  task: { companyId: string; employee: { role: string } },
): Promise<AgentPipelineChainResult> {
  const nextRoleMap: Record<string, string | null> = {
    analyst: 'strategist',
    strategist: 'copywriter',
    copywriter: 'creative_director',
    creative_director: null,
  }

  const currentRole = task.employee.role
  const nextRoleStr = nextRoleMap[currentRole]
  if (!nextRoleStr) return { ok: false, reason: 'end_of_pipeline' }

  const company = await db.company.findUnique({
    where: { id: task.companyId },
    select: { niche: true, userId: true, agentTools: true },
  })
  if (!company) return { ok: false, reason: 'no_company' }

  try {
    await assertTaskQuota(db, company.userId)
  } catch (err) {
    const e = err as Error & { code?: string }
    if (e.code === 'plan_limit_exceeded') {
      console.warn('[triggerNextAgentAfterApproval] plan limit exceeded; skipping chained task')
      return { ok: false, reason: 'quota_exceeded' }
    }
    throw err
  }

  const nextEmployee = await db.employee.findFirst({
    where: { companyId: task.companyId, role: nextRoleStr as never, isActive: true },
  })
  if (!nextEmployee) return { ok: false, reason: 'no_next_employee' }

  const outputType = PIPELINE_OUTPUT_TYPE[nextRoleStr]
  if (!outputType) return { ok: false, reason: 'bad_config' }

  const title = getAutoTaskTitle(nextRoleStr)
  const description = ''

  const nextTask = await db.task.create({
    data: {
      companyId: task.companyId,
      employeeId: nextEmployee.id,
      title,
      type: outputType,
      status: 'in_progress',
      description,
    },
  })

  try {
    await executeAndStore(db, {
      taskId: nextTask.id,
      companyId: task.companyId,
      niche: company.niche,
      role: nextRoleStr as AgentRole,
      type: outputType,
      title,
      description,
    })
  } catch (err) {
    console.warn('[triggerNextAgentAfterApproval] executeAndStore failed', err)
    try {
      await db.output.create({
        data: {
          taskId: nextTask.id,
          companyId: task.companyId,
          employeeId: nextEmployee.id,
          type: outputType,
          content: {
            error: 'execution_failed',
            note: 'The agent could not complete this chained brief. Re-brief to try again.',
            message: (err as Error)?.message?.slice(0, 500) || null,
          } as unknown as Prisma.InputJsonObject,
          status: 'draft',
        },
      })
      await db.task.update({
        where: { id: nextTask.id },
        data: { status: 'revision' },
      })
    } catch (e2) {
      console.warn('[triggerNextAgentAfterApproval] failed to persist error stub', e2)
    }
  }

  let chainResult: AgentPipelineChainResult = {
    ok: true,
    nextTaskId: nextTask.id,
    title,
    outputType,
    nextRole: nextRoleStr,
    nextEmployeeName: nextEmployee.name,
  }

  const afterRun = await db.task.findUnique({ where: { id: nextTask.id } })
  if (afterRun?.status === 'delivered') {
    const auto = await tryAutoApproveDeliveredTask(db, {
      companyId: task.companyId,
      taskId: nextTask.id,
      outputType,
      agentTools: company.agentTools,
    })
    if (auto.didAuto) {
      const inner = await triggerNextAgentAfterApproval(db, {
        companyId: task.companyId,
        employee: nextEmployee,
      })
      chainResult = inner
    }
  }

  return chainResult
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

async function getBrandMemory(taskId: string): Promise<string> {
  const task = await prisma.task.findUnique({ where: { id: taskId } })
  if (!task) return ''

  const memories = await prisma.brandMemory.findMany({
    where: { companyId: task.companyId },
    orderBy: [{ weight: 'desc' }, { createdAt: 'desc' }],
    take: 10,
  })

  if (!memories.length) return ''

  return memories
    .map(m => JSON.stringify(m.content))
    .join('\n')
}

function getOutputTypeForTask(taskType: string): string {
  const map: Record<string, string> = {
    trend_analysis: 'trend_report',
    content_planning: 'content_plan',
    hook_writing: 'hooks',
    caption_writing: 'caption',
    script_writing: 'script',
    shot_list: 'shot_list',
    video_production: 'video',
    performance_review: 'performance_review',
    weekly_pulse: 'weekly_pulse',
  }
  return map[taskType] || taskType || 'hooks'
}

function getAutoTaskTitle(role: string): string {
  const map: Record<string, string> = {
    strategist: 'Build this week\'s content plan',
    copywriter: 'Write hooks and scripts for the content plan',
    creative_director: 'Create production brief and shot list',
  }
  return map[role] || 'New task'
}

