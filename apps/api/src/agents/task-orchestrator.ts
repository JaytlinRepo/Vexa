import { PrismaClient } from '@prisma/client'
import { invokeAgent, parseAgentOutput, retrieveNicheContext, buildLayeredPrompt } from '../services/bedrock/bedrock.service'
import { buildMayaSystemPrompt, buildMayaTaskPrompt } from './maya/system-prompt'
import { buildJordanSystemPrompt, buildAlexSystemPrompt, buildRileySystemPrompt } from './jordan-alex-riley-prompts'
import { TrendReport, ContentPlan, HooksOutput, ScriptOutput, ShotListOutput, OutputType } from '@vexa/types'

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
      return executeMayaTask({ niche, brandVoice, nicheContext, brandMemory, description })

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
}): Promise<TrendReport> {
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
    await triggerNextAgent(task)

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

/**
 * After an output is approved, automatically trigger the next agent in the pipeline.
 * Analyst approval → Strategist plans
 * Strategist approval → Copywriter writes
 * Copywriter (script) approval → Riley directs
 * Riley approval → Video generation
 */
async function triggerNextAgent(task: {
  companyId: string
  type: string
  employee: { role: string }
}): Promise<void> {
  const nextRoleMap: Record<string, string | null> = {
    analyst: 'strategist',
    strategist: 'copywriter',
    copywriter: 'creative_director',
    creative_director: null, // triggers video generation instead
  }

  const nextRole = nextRoleMap[task.employee.role]
  if (!nextRole) return

  const nextEmployee = await prisma.employee.findFirst({
    where: { companyId: task.companyId, role: nextRole as never, isActive: true },
  })

  if (!nextEmployee) return

  const nextTask = await prisma.task.create({
    data: {
      companyId: task.companyId,
      employeeId: nextEmployee.id,
      title: getAutoTaskTitle(nextRole),
      type: getAutoTaskType(nextRole),
      status: 'pending',
      description: `Auto-triggered after ${task.employee.role} output was approved.`,
    },
  })

  // Kick off in background
  orchestrateTask(nextTask.id).catch(console.error)
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
  }
  return map[taskType] || 'hooks'
}

function getAutoTaskTitle(role: string): string {
  const map: Record<string, string> = {
    strategist: 'Build this week\'s content plan',
    copywriter: 'Write hooks and scripts for the content plan',
    creative_director: 'Create production brief and shot list',
  }
  return map[role] || 'New task'
}

function getAutoTaskType(role: string): string {
  const map: Record<string, string> = {
    strategist: 'content_planning',
    copywriter: 'hook_writing',
    creative_director: 'shot_list',
  }
  return map[role] || 'general'
}
