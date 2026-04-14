/**
 * Maya's "watch my account" loop.
 *
 * Called after every platform sync. Reads the latest N snapshots for an
 * account, compares the most recent one to a trailing baseline, and — if
 * something material has moved the wrong way — fires a notification in
 * Maya's voice so the CEO sees it the next time they open the app.
 *
 * Keep the thresholds conservative so the bell stays meaningful.
 */
import { PrismaClient } from '@prisma/client'
import { createNotification } from '../services/notifications/notification.service'

export interface WatchSignal {
  kind: 'engagement_drop' | 'follower_decline' | 'follower_flatline'
  severity: 'info' | 'warn'
  title: string
  body: string
}

const ENGAGEMENT_DROP_PCT = 0.15   // 15% below trailing 7-day average
const FOLLOWER_DECLINE_DAY_PCT = 0.01  // 1% drop day-over-day
const FOLLOWER_FLATLINE_DAYS = 5   // 5 days of zero / near-zero growth

function pct(from: number, to: number): number {
  if (from === 0) return 0
  return (to - from) / from
}

/**
 * Returns a signal if the latest snapshot looks concerning, otherwise null.
 * Pure function — does no I/O besides the one prisma read.
 */
export async function evaluateAccount(
  prisma: PrismaClient,
  accountId: string,
  handle: string,
): Promise<WatchSignal | null> {
  // Newest first. We need at least 3 to say anything.
  const snapshots = await prisma.platformSnapshot.findMany({
    where: { accountId },
    orderBy: { capturedAt: 'desc' },
    take: 8,
  })
  if (snapshots.length < 3) return null

  const latest = snapshots[0]!
  const trailing = snapshots.slice(1, 8) // up to 7 prior

  // ── 1. Engagement drop vs. trailing average ─────────────────────────
  const trailingEngagement = trailing
    .map((s) => s.engagementRate)
    .filter((v) => v > 0)
  if (trailingEngagement.length >= 2 && latest.engagementRate > 0) {
    const avg = trailingEngagement.reduce((a, b) => a + b, 0) / trailingEngagement.length
    const change = pct(avg, latest.engagementRate)
    if (change <= -ENGAGEMENT_DROP_PCT) {
      const dropPct = Math.round(Math.abs(change) * 100)
      return {
        kind: 'engagement_drop',
        severity: 'warn',
        title: `Maya — engagement dropped ${dropPct}% on @${handle}`,
        body: `Latest sync has engagement at ${latest.engagementRate.toFixed(2)}% vs. a ${avg.toFixed(2)}% trailing average. Open a meeting with me and I'll pull what changed.`,
      }
    }
  }

  // ── 2. Follower decline day-over-day ────────────────────────────────
  const previous = snapshots[1]!
  const dayChange = pct(previous.followerCount, latest.followerCount)
  if (previous.followerCount > 0 && dayChange <= -FOLLOWER_DECLINE_DAY_PCT) {
    const lost = previous.followerCount - latest.followerCount
    return {
      kind: 'follower_decline',
      severity: 'warn',
      title: `Maya — @${handle} lost ${lost.toLocaleString()} followers`,
      body: `Down ${Math.abs(dayChange * 100).toFixed(1)}% since yesterday. I'd want to see which post preceded this — want to meet?`,
    }
  }

  // ── 3. Flatline over N days ─────────────────────────────────────────
  if (snapshots.length >= FOLLOWER_FLATLINE_DAYS) {
    const oldest = snapshots[FOLLOWER_FLATLINE_DAYS - 1]!
    const growth = latest.followerCount - oldest.followerCount
    if (oldest.followerCount > 500 && Math.abs(growth) <= Math.max(2, oldest.followerCount * 0.001)) {
      return {
        kind: 'follower_flatline',
        severity: 'info',
        title: `Maya — growth has stalled on @${handle}`,
        body: `Follower count has barely moved in ${FOLLOWER_FLATLINE_DAYS} days (${growth >= 0 ? '+' : ''}${growth}). I have ideas on how to break the plateau.`,
      }
    }
  }

  return null
}

/**
 * Evaluates the account and, if a signal fires, writes one Maya-voiced
 * notification. De-dupes against the last 20h so daily syncs don't spam
 * the bell with the same alert.
 */
export async function runWatch(
  prisma: PrismaClient,
  opts: { userId: string; companyId: string; accountId: string; handle: string },
): Promise<WatchSignal | null> {
  const signal = await evaluateAccount(prisma, opts.accountId, opts.handle)
  if (!signal) return null

  const since = new Date(Date.now() - 20 * 60 * 60 * 1000)
  const existing = await prisma.notification.findFirst({
    where: {
      userId: opts.userId,
      type: 'team_update',
      createdAt: { gte: since },
      // Metadata is the only place 'watch_<kind>' lives — see below. We
      // can't filter on it directly in Prisma without a JSON query, so we
      // pull the last 20h of team_update rows and check inline.
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })
  const alreadyFired = !!existing &&
    (existing.metadata as { watchKind?: string } | null)?.watchKind === signal.kind
  if (alreadyFired) return signal

  try {
    await createNotification({
      userId: opts.userId,
      companyId: opts.companyId,
      type: 'team_update',
      emoji: '',
      title: signal.title,
      body: signal.body,
      actionLabel: 'Open Maya',
      actionUrl: '/app?meeting=analyst',
      metadata: { watchKind: signal.kind, source: 'metricsWatch' },
    })
  } catch (e) {
    console.warn('[metricsWatch] notification write failed', e)
  }
  return signal
}
