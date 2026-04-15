import type { PrismaClient, OutputType } from '@prisma/client'
import { recordTaskApproved } from './brandMemory'

const KNOWN_TYPES: readonly OutputType[] = [
  'trend_report',
  'content_plan',
  'hooks',
  'caption',
  'script',
  'shot_list',
  'video',
]

/** Types that clear without CEO sign-off unless overridden via `agent_tools.autoShipOutputTypes`. */
const DEFAULT_AUTO_SHIP: readonly OutputType[] = ['hooks', 'caption']

type AgentToolsSettings = {
  autoShipOutputTypes?: unknown
}

function parseOutputTypeList(value: unknown): OutputType[] {
  if (!Array.isArray(value)) return []
  const out: OutputType[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    if ((KNOWN_TYPES as readonly string[]).includes(item)) out.push(item as OutputType)
  }
  return out
}

/**
 * Resolves which task `type` values auto-approve after delivery.
 * - If `autoShipOutputTypes` is absent: defaults to hooks + caption.
 * - If present and empty: auto-ship is off for all types.
 * - If present and non-empty: only those types auto-ship.
 */
export function resolveAutoShipTypes(agentTools: unknown): OutputType[] | null {
  const o = (agentTools && typeof agentTools === 'object' ? agentTools : {}) as AgentToolsSettings
  if (Object.prototype.hasOwnProperty.call(o, 'autoShipOutputTypes')) {
    const parsed = parseOutputTypeList(o.autoShipOutputTypes)
    if (parsed.length === 0) return null
    return parsed
  }
  return [...DEFAULT_AUTO_SHIP]
}

export function shouldAutoShipOutput(agentTools: unknown, taskType: OutputType): boolean {
  const list = resolveAutoShipTypes(agentTools)
  if (list === null) return false
  return list.includes(taskType)
}

export type TryAutoApproveResult = { didAuto: boolean }

/**
 * If this `delivered` task matches auto-ship policy, flip output + task to approved
 * and record memory. Does **not** chain the next agent — callers run
 * `triggerNextAgentAfterApproval` when `didAuto` is true (and send notifications).
 */
export async function tryAutoApproveDeliveredTask(
  prisma: PrismaClient,
  opts: {
    companyId: string
    taskId: string
    outputType: OutputType
    agentTools: unknown
  }
): Promise<TryAutoApproveResult> {
  if (!shouldAutoShipOutput(opts.agentTools, opts.outputType)) {
    return { didAuto: false }
  }

  const task = await prisma.task.findUnique({
    where: { id: opts.taskId },
    include: { employee: true, outputs: true },
  })
  if (!task || task.companyId !== opts.companyId || task.status !== 'delivered') {
    return { didAuto: false }
  }

  const outputs = task.outputs ?? []
  const latest =
    outputs.length === 0 ? null : outputs.reduce((a, b) => (a.createdAt > b.createdAt ? a : b))
  if (!latest) return { didAuto: false }

  const now = new Date()

  await prisma.output.update({
    where: { id: latest.id },
    data: { status: 'approved' },
  })

  await prisma.task.update({
    where: { id: task.id },
    data: {
      status: 'approved',
      userAction: { type: 'auto_approve', reason: 'auto_ship', ts: now.toISOString() },
      completedAt: now,
    },
  })

  await recordTaskApproved(prisma, {
    companyId: task.companyId,
    taskId: task.id,
    taskTitle: task.title,
    taskType: task.type,
    employeeName: task.employee.name,
  })

  return { didAuto: true }
}
