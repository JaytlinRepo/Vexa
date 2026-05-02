/**
 * Feed Signal Service
 *
 * Persists behavioral signals from the Knowledge feed (reveal, open,
 * dismiss, not_interested, report) so the next /api/feed call can:
 *   - boost creators the user has engaged with (author affinity)
 *   - dampen creators/topics the user has explicitly dismissed
 *
 * Append-only. No mutations after insert.
 *
 * The service is intentionally agnostic about the *meaning* of the
 * signals — feed.ts decides how to apply them. This keeps the storage
 * layer thin and easy to evolve.
 */
import { PrismaClient } from '@prisma/client'

export type SignalKind = 'reveal' | 'open' | 'dismiss' | 'not_interested' | 'report'
export type SignalTargetType = 'post' | 'creator' | 'topic'

const VALID_KINDS: SignalKind[] = ['reveal', 'open', 'dismiss', 'not_interested', 'report']
const VALID_TARGET_TYPES: SignalTargetType[] = ['post', 'creator', 'topic']

export function isSignalKind(s: string): s is SignalKind {
  return (VALID_KINDS as string[]).includes(s)
}

export function isSignalTargetType(s: string): s is SignalTargetType {
  return (VALID_TARGET_TYPES as string[]).includes(s)
}

export interface RecordSignalInput {
  userId: string
  companyId: string
  kind: SignalKind
  targetType: SignalTargetType
  targetId: string
  weight?: number
}

export async function recordSignal(
  prisma: PrismaClient,
  input: RecordSignalInput,
): Promise<void> {
  // Hard cap on weight to keep one runaway client from skewing aggregates.
  const weight = Math.max(0.1, Math.min(10, input.weight ?? 1))
  await prisma.feedSignal.create({
    data: {
      userId: input.userId,
      companyId: input.companyId,
      kind: input.kind,
      targetType: input.targetType,
      targetId: input.targetId.slice(0, 200),
      weight,
    },
  })
}

/**
 * Top creators (by total reveal+open weight) the company has engaged with
 * recently. Used by feed.ts to boost their other posts.
 */
export async function getAffinityCreators(
  prisma: PrismaClient,
  companyId: string,
  days: number = 30,
  limit: number = 8,
): Promise<string[]> {
  const cutoff = new Date(Date.now() - days * 86400000)

  const rows = await prisma.feedSignal.groupBy({
    by: ['targetId'],
    where: {
      companyId,
      targetType: 'creator',
      kind: { in: ['reveal', 'open'] },
      createdAt: { gte: cutoff },
    },
    _sum: { weight: true },
  })

  return rows
    .sort((a, b) => (b._sum.weight ?? 0) - (a._sum.weight ?? 0))
    .slice(0, limit)
    .map((r) => r.targetId)
}

/**
 * Set of {targetType, targetId} pairs the company has explicitly dampened
 * (Not-interested or Dismiss) within the lookback window. feed.ts drops
 * any item matching these.
 */
export async function getDampenedTargets(
  prisma: PrismaClient,
  companyId: string,
  days: number = 60,
): Promise<{ creators: Set<string>; topics: Set<string>; posts: Set<string> }> {
  const cutoff = new Date(Date.now() - days * 86400000)
  const rows = await prisma.feedSignal.findMany({
    where: {
      companyId,
      kind: { in: ['dismiss', 'not_interested'] },
      createdAt: { gte: cutoff },
    },
    select: { targetType: true, targetId: true },
  })

  const creators = new Set<string>()
  const topics = new Set<string>()
  const posts = new Set<string>()
  for (const r of rows) {
    if (r.targetType === 'creator') creators.add(r.targetId)
    else if (r.targetType === 'topic') topics.add(r.targetId)
    else if (r.targetType === 'post') posts.add(r.targetId)
  }
  return { creators, topics, posts }
}
