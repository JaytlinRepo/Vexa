import { PrismaClient, MemoryType, Prisma } from '@prisma/client'

export interface MemoryContent {
  summary: string
  source?: 'task' | 'meeting' | 'manual' | 'instagram'
  sourceId?: string
  tags?: string[]
  details?: Record<string, unknown>
}

/**
 * Write a brand-memory row. Prefer specific helpers below over calling this
 * directly so the summary copy stays consistent.
 */
export async function writeMemory(
  prisma: PrismaClient,
  params: {
    companyId: string
    type: MemoryType
    content: MemoryContent
    weight?: number
  },
): Promise<void> {
  await prisma.brandMemory.create({
    data: {
      companyId: params.companyId,
      memoryType: params.type,
      content: params.content as unknown as Prisma.InputJsonValue,
      weight: params.weight ?? 1.0,
    },
  })
}

/**
 * Read the top-N memories for a company, ordered by weight * recency.
 * More weight + more recent = higher priority.
 */
export async function readTopMemories(
  prisma: PrismaClient,
  companyId: string,
  limit = 12,
): Promise<Array<{ id: string; type: MemoryType; weight: number; content: MemoryContent; createdAt: Date }>> {
  // Pull more than `limit` so we can rank in memory.
  const rows = await prisma.brandMemory.findMany({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
    take: limit * 3,
  })

  const now = Date.now()
  const HALF_LIFE_DAYS = 30
  const halfLifeMs = HALF_LIFE_DAYS * 24 * 60 * 60 * 1000

  const scored = rows.map((r) => {
    const ageMs = now - r.createdAt.getTime()
    const recency = Math.pow(0.5, ageMs / halfLifeMs)
    const score = r.weight * recency
    return { row: r, score }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map(({ row }) => ({
    id: row.id,
    type: row.memoryType,
    weight: row.weight,
    content: row.content as unknown as MemoryContent,
    createdAt: row.createdAt,
  }))
}

/**
 * Format memories as a short block the agent can read inside its system
 * prompt. Groups by memory type so the model sees structure.
 */
export function formatMemoryForPrompt(
  memories: Array<{ type: MemoryType; content: MemoryContent }>,
): string {
  if (memories.length === 0) return ''
  const byType: Record<MemoryType, string[]> = {
    feedback: [],
    preference: [],
    performance: [],
    voice: [],
  }
  for (const m of memories) {
    byType[m.type].push('- ' + m.content.summary)
  }
  const sections: string[] = []
  if (byType.preference.length) sections.push(`Preferences (what they approve of):\n${byType.preference.join('\n')}`)
  if (byType.feedback.length) sections.push(`Corrections (what they push back on):\n${byType.feedback.join('\n')}`)
  if (byType.voice.length) sections.push(`Voice rules:\n${byType.voice.join('\n')}`)
  if (byType.performance.length) sections.push(`What has worked for them:\n${byType.performance.join('\n')}`)
  return `\n\n--- Context from prior work with this CEO ---\n${sections.join('\n\n')}\n--- End context ---\n`
}

// ── Specific helpers ────────────────────────────────────────────────────────

export async function recordTaskApproved(
  prisma: PrismaClient,
  params: { companyId: string; taskId: string; taskTitle: string; taskType: string; employeeName: string },
): Promise<void> {
  await writeMemory(prisma, {
    companyId: params.companyId,
    type: 'preference',
    weight: 1.0,
    content: {
      source: 'task',
      sourceId: params.taskId,
      summary: `Approved ${params.employeeName}'s ${formatType(params.taskType)}: "${params.taskTitle}"`,
      tags: [params.taskType, 'approved'],
    },
  })
}

export async function recordTaskRejected(
  prisma: PrismaClient,
  params: {
    companyId: string
    taskId: string
    taskTitle: string
    taskType: string
    employeeName: string
    feedback?: string
  },
): Promise<void> {
  const feedbackClause = params.feedback ? ` — reason: "${params.feedback}"` : ''
  await writeMemory(prisma, {
    companyId: params.companyId,
    type: 'feedback',
    // Rejections teach more than approvals; weight them higher.
    weight: 1.3,
    content: {
      source: 'task',
      sourceId: params.taskId,
      summary: `Rejected ${params.employeeName}'s ${formatType(params.taskType)}: "${params.taskTitle}"${feedbackClause}`,
      tags: [params.taskType, 'rejected'],
    },
  })
}

function formatType(t: string): string {
  return t.replace(/_/g, ' ')
}
