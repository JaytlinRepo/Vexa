/**
 * Derived metrics computation engine.
 *
 * Runs after each platform sync to enrich raw data with computed features.
 * Three layers:
 *   1. Per-post metrics   — engagement rate, save rate, virality, etc.
 *   2. Snapshot rollups    — rolling averages, growth acceleration, cadence
 *   3. Weekly summary ext  — consistency, format momentum, engagement trend
 *
 * Every computation is idempotent and safe to re-run.
 */

import { PrismaClient } from '@prisma/client'

// ── 1. Per-post derived metrics ────────────────────────────────────────

/**
 * Compute and persist derived metrics for a single post.
 * Needs the account's current follower count for view-to-follower ratio.
 */
export async function computePostDerivedMetrics(
  prisma: PrismaClient,
  postId: string,
  followerCount: number,
): Promise<void> {
  const post = await prisma.platformPost.findUnique({
    where: { id: postId },
    select: {
      likeCount: true,
      commentCount: true,
      shareCount: true,
      saveCount: true,
      viewCount: true,
      reachCount: true,
      caption: true,
      publishedAt: true,
      metricSnapshots: {
        orderBy: { capturedAt: 'asc' as const },
        select: { capturedAt: true, likeCount: true, commentCount: true, shareCount: true, saveCount: true, viewCount: true },
      },
    },
  })
  if (!post) return

  const reach = post.reachCount || post.viewCount || 1 // avoid div-by-zero
  const likes = post.likeCount
  const comments = post.commentCount
  const shares = post.shareCount
  const saves = post.saveCount
  const views = post.viewCount
  const totalEngagement = likes + comments + saves + shares

  // Core ratios
  const engagementRate = safe(totalEngagement / reach)
  const saveRate = safe(saves / reach)
  const viralityScore = safe(shares / reach)
  const commentToLikeRatio = safe(comments / (likes || 1))
  const viewToFollowerRatio = safe(views / (followerCount || 1))

  // Caption analysis
  const captionLength = post.caption
    ? post.caption.split(/\s+/).filter((w) => w.length > 0).length
    : 0

  // Time-of-day extraction
  let publishHour: number | null = null
  let publishDayOfWeek: number | null = null
  if (post.publishedAt) {
    const d = new Date(post.publishedAt)
    publishHour = d.getUTCHours()
    publishDayOfWeek = d.getUTCDay()
  }

  // Engagement velocity: total engagement gained in first 48h after publish
  let engagementVelocity = 0
  let decayRate = 0

  if (post.publishedAt && post.metricSnapshots.length >= 2) {
    const publishTime = new Date(post.publishedAt).getTime()
    const snaps = post.metricSnapshots

    // Find snapshot closest to 48h after publish
    const target48h = publishTime + 48 * 3600 * 1000
    const firstSnap = snaps[0]
    let snap48h = firstSnap
    for (const s of snaps) {
      if (new Date(s.capturedAt).getTime() <= target48h) snap48h = s
    }
    const engFirst = firstSnap.likeCount + firstSnap.commentCount + firstSnap.shareCount + firstSnap.saveCount
    const eng48h = snap48h.likeCount + snap48h.commentCount + snap48h.shareCount + snap48h.saveCount
    engagementVelocity = eng48h - engFirst

    // Decay rate: compare engagement velocity in first half vs second half
    // of the post's observed life. 1.0 = evergreen (steady), 0 = dies fast.
    const lastSnap = snaps[snaps.length - 1]
    const midTime = (new Date(firstSnap.capturedAt).getTime() + new Date(lastSnap.capturedAt).getTime()) / 2
    let midSnap = firstSnap
    for (const s of snaps) {
      if (new Date(s.capturedAt).getTime() <= midTime) midSnap = s
    }

    const engMid = midSnap.likeCount + midSnap.commentCount + midSnap.shareCount + midSnap.saveCount
    const engLast = lastSnap.likeCount + lastSnap.commentCount + lastSnap.shareCount + lastSnap.saveCount

    const firstHalfGrowth = engMid - engFirst
    const secondHalfGrowth = engLast - engMid

    if (firstHalfGrowth > 0) {
      // Ratio of second-half to first-half growth. 1.0 = linear, >1 = accelerating
      decayRate = Math.min(1, safe(secondHalfGrowth / firstHalfGrowth))
    } else if (secondHalfGrowth > 0) {
      decayRate = 1 // still gaining despite no first-half data
    }
  }

  await prisma.platformPost.update({
    where: { id: postId },
    data: {
      engagementRate,
      saveRate,
      viralityScore,
      commentToLikeRatio,
      viewToFollowerRatio,
      captionLength,
      publishHour,
      publishDayOfWeek,
      engagementVelocity,
      decayRate,
    },
  })
}

/**
 * Compute derived metrics for ALL posts belonging to an account.
 * Called once after a full sync rather than per-post to batch the
 * follower count lookup.
 */
export async function computeAllPostMetrics(
  prisma: PrismaClient,
  accountId: string,
): Promise<void> {
  // Get current follower count from the latest snapshot
  const latestSnap = await prisma.platformSnapshot.findFirst({
    where: { accountId },
    orderBy: { capturedAt: 'desc' },
    select: { followerCount: true },
  })
  const followerCount = latestSnap?.followerCount || 0

  // Process recent posts (last 50 — older posts rarely change)
  const posts = await prisma.platformPost.findMany({
    where: { accountId },
    orderBy: { publishedAt: 'desc' },
    take: 50,
    select: { id: true },
  })

  for (const p of posts) {
    try {
      await computePostDerivedMetrics(prisma, p.id, followerCount)
    } catch (e) {
      console.warn(`[derivedMetrics] post ${p.id} failed:`, (e as Error).message)
    }
  }
}

// ── 2. Snapshot rolling averages ───────────────────────────────────────

/**
 * Enrich the most recent PlatformSnapshot with rolling averages,
 * growth rates, and cadence metrics computed from historical data.
 */
export async function computeSnapshotRollups(
  prisma: PrismaClient,
  accountId: string,
  opts: { profileViews?: number; websiteClicks?: number } = {},
): Promise<void> {
  // Fetch last 30 snapshots (covers ~30 days at daily granularity)
  const snapshots = await prisma.platformSnapshot.findMany({
    where: { accountId },
    orderBy: { capturedAt: 'desc' },
    take: 30,
  })
  if (snapshots.length === 0) return

  const latest = snapshots[0]
  const prev = snapshots[1] || null

  // ── Follower delta & growth ──────────────────────────────────
  const followerDelta = prev ? latest.followerCount - prev.followerCount : 0
  const followerGrowthPct = prev && prev.followerCount > 0
    ? safe((latest.followerCount - prev.followerCount) / prev.followerCount)
    : 0

  // 7-day growth rate: avg daily change over last 7 snapshots
  const snap7d = snapshots.slice(0, Math.min(7, snapshots.length))
  const growthRate7d = computeAvgDailyGrowth(snap7d)

  // 28-day growth rate
  const snap28d = snapshots.slice(0, Math.min(28, snapshots.length))
  const growthRate28d = computeAvgDailyGrowth(snap28d)

  // Growth acceleration: compare current 7d rate to previous 7d rate
  let growthAcceleration = 0
  if (snapshots.length >= 14) {
    const prev7d = snapshots.slice(7, 14)
    const prevRate = computeAvgDailyGrowth(prev7d)
    growthAcceleration = growthRate7d - prevRate
  }

  // ── Rolling engagement averages ──────────────────────────────
  const engagementRate7d = avg(snap7d.map((s) => s.engagementRate))
  const engagementRate28d = avg(snap28d.map((s) => s.engagementRate))
  const reach7d = Math.round(avg(snap7d.map((s) => s.avgReach)))
  const reach28d = Math.round(avg(snap28d.map((s) => s.avgReach)))

  // ── Post-level rollups (save rate, virality) ─────────────────
  const recentPosts = await prisma.platformPost.findMany({
    where: { accountId },
    orderBy: { publishedAt: 'desc' },
    take: 20,
    select: { saveRate: true, viralityScore: true },
  })
  const avgSaveRate = avg(recentPosts.map((p) => p.saveRate))
  const avgViralityScore = avg(recentPosts.map((p) => p.viralityScore))

  // ── Posting cadence ──────────────────────────────────────────
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000)
  const twentyEightDaysAgo = new Date(now.getTime() - 28 * 86400000)

  const postingCadence7d = await prisma.platformPost.count({
    where: { accountId, publishedAt: { gte: sevenDaysAgo } },
  })
  const postingCadence28d = await prisma.platformPost.count({
    where: { accountId, publishedAt: { gte: twentyEightDaysAgo } },
  })

  await prisma.platformSnapshot.update({
    where: { id: latest.id },
    data: {
      followerDelta,
      followerGrowthPct,
      growthRate7d,
      growthRate28d,
      growthAcceleration,
      engagementRate7d,
      engagementRate28d,
      reach7d,
      reach28d,
      avgSaveRate,
      avgViralityScore,
      postingCadence7d,
      postingCadence28d: postingCadence28d / 4, // normalize to per-week
      profileViews: opts.profileViews ?? 0,
      websiteClicks: opts.websiteClicks ?? 0,
    },
  })
}

// ── 3. Extended weekly summary ─────────────────────────────────────────

/**
 * Enrich an existing weekly summary with derived fields:
 * consistency score, format momentum, engagement trend, etc.
 * Must be called AFTER the base computeWeeklySummary.
 */
export async function computeWeeklySummaryExtended(
  prisma: PrismaClient,
  accountId: string,
): Promise<void> {
  // Find current week boundaries
  const now = new Date()
  const dayOfWeek = now.getUTCDay()
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const weekStart = new Date(now)
  weekStart.setUTCDate(now.getUTCDate() + mondayOffset)
  weekStart.setUTCHours(0, 0, 0, 0)

  const weekEnd = new Date(weekStart)
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6)
  weekEnd.setUTCHours(23, 59, 59, 999)

  const summary = await prisma.weeklySummary.findUnique({
    where: { accountId_weekStart: { accountId, weekStart } },
  })
  if (!summary) return

  // Get this week's posts with derived metrics
  const weekPosts = await prisma.platformPost.findMany({
    where: { accountId, publishedAt: { gte: weekStart, lte: weekEnd } },
    orderBy: { publishedAt: 'asc' },
    select: {
      publishedAt: true,
      publishHour: true,
      mediaType: true,
      saveRate: true,
      viralityScore: true,
      captionLength: true,
      likeCount: true,
      commentCount: true,
      shareCount: true,
      saveCount: true,
      reachCount: true,
      viewCount: true,
    },
  })

  // ── Follower growth % ────────────────────────────────────────
  const followerGrowthPct = summary.followerStart > 0
    ? safe(summary.followerDelta / summary.followerStart)
    : 0

  // ── Total shares & saves ─────────────────────────────────────
  let totalShares = 0
  let totalSaves = 0
  for (const p of weekPosts) {
    totalShares += p.shareCount
    totalSaves += p.saveCount
  }

  // ── Avg save rate & virality ─────────────────────────────────
  const avgSaveRate = avg(weekPosts.map((p) => p.saveRate))
  const avgViralityScore = avg(weekPosts.map((p) => p.viralityScore))
  const avgCaptionLength = avg(weekPosts.map((p) => p.captionLength))

  // ── Best hour by engagement ──────────────────────────────────
  const hourBuckets: Record<number, { totalEng: number; count: number }> = {}
  for (const p of weekPosts) {
    if (p.publishHour == null) continue
    if (!hourBuckets[p.publishHour]) hourBuckets[p.publishHour] = { totalEng: 0, count: 0 }
    hourBuckets[p.publishHour].totalEng += p.likeCount + p.commentCount * 2 + p.shareCount * 3
    hourBuckets[p.publishHour].count++
  }
  const bestHour = Object.entries(hourBuckets)
    .sort((a, b) => (b[1].totalEng / b[1].count) - (a[1].totalEng / a[1].count))[0]
  const bestHourVal = bestHour ? parseInt(bestHour[0]) : null

  // ── Consistency score ────────────────────────────────────────
  // 1.0 = perfectly even spacing, 0 = all clustered on one day
  let consistencyScore = 0
  if (weekPosts.length >= 2) {
    const timestamps = weekPosts
      .filter((p) => p.publishedAt)
      .map((p) => new Date(p.publishedAt!).getTime())
      .sort((a, b) => a - b)

    if (timestamps.length >= 2) {
      const intervals: number[] = []
      for (let i = 1; i < timestamps.length; i++) {
        intervals.push(timestamps[i] - timestamps[i - 1])
      }
      const meanInterval = avg(intervals)
      if (meanInterval > 0) {
        const variance = avg(intervals.map((iv) => Math.pow(iv - meanInterval, 2)))
        const stdDev = Math.sqrt(variance)
        const cv = stdDev / meanInterval // coefficient of variation
        consistencyScore = Math.max(0, Math.min(1, 1 - cv)) // 1 - CV, clamped 0-1
      }
    }
  } else if (weekPosts.length === 1) {
    consistencyScore = 0.5 // single post = neither consistent nor inconsistent
  }

  // ── Engagement trend (compare to prior week) ─────────────────
  const priorWeekStart = new Date(weekStart)
  priorWeekStart.setUTCDate(priorWeekStart.getUTCDate() - 7)
  const priorSummary = await prisma.weeklySummary.findUnique({
    where: { accountId_weekStart: { accountId, weekStart: priorWeekStart } },
    select: { avgEngagement: true },
  })
  let engagementTrend: 'improving' | 'declining' | 'stable' = 'stable'
  if (priorSummary && priorSummary.avgEngagement > 0) {
    const change = (summary.avgEngagement - priorSummary.avgEngagement) / priorSummary.avgEngagement
    if (change >= 0.15) engagementTrend = 'improving'
    else if (change <= -0.15) engagementTrend = 'declining'
  }

  // ── Format momentum ──────────────────────────────────────────
  // Compare each format's avg engagement this week vs last 4 weeks
  const fourWeeksAgo = new Date(weekStart)
  fourWeeksAgo.setUTCDate(fourWeeksAgo.getUTCDate() - 28)

  const historicalPosts = await prisma.platformPost.findMany({
    where: { accountId, publishedAt: { gte: fourWeeksAgo, lt: weekStart } },
    select: { mediaType: true, likeCount: true, commentCount: true, shareCount: true },
  })

  const formatMomentum: Array<{ format: string; avgEng: number; delta: number; trend: string }> = []
  const formats = [...new Set([...weekPosts.map((p) => p.mediaType), ...historicalPosts.map((p) => p.mediaType)])]

  for (const fmt of formats) {
    const thisWeek = weekPosts.filter((p) => p.mediaType === fmt)
    const historical = historicalPosts.filter((p) => p.mediaType === fmt)

    const thisAvg = thisWeek.length > 0
      ? avg(thisWeek.map((p) => p.likeCount + p.commentCount * 2 + p.shareCount * 3))
      : 0
    const histAvg = historical.length > 0
      ? avg(historical.map((p) => p.likeCount + p.commentCount * 2 + p.shareCount * 3))
      : 0

    const delta = histAvg > 0 ? safe((thisAvg - histAvg) / histAvg) : 0
    const trend = delta >= 0.15 ? 'up' : delta <= -0.15 ? 'down' : 'stable'

    formatMomentum.push({ format: fmt, avgEng: Math.round(thisAvg), delta: Math.round(delta * 100) / 100, trend })
  }

  await prisma.weeklySummary.update({
    where: { id: summary.id },
    data: {
      followerGrowthPct,
      totalShares,
      totalSaves,
      avgSaveRate,
      avgViralityScore,
      avgCaptionLength,
      bestHour: bestHourVal,
      consistencyScore,
      engagementTrend,
      formatMomentum: formatMomentum as unknown as object,
    },
  })
}

// ── Master orchestrator ────────────────────────────────────────────────

/**
 * Run ALL derived metric computations for an account after sync.
 * Call this once at the end of the sync pipeline.
 */
export async function computeAllDerivedMetrics(
  prisma: PrismaClient,
  accountId: string,
  opts: { profileViews?: number; websiteClicks?: number } = {},
): Promise<void> {
  try {
    // 1. Per-post derived metrics (engagement rate, save rate, virality, etc.)
    await computeAllPostMetrics(prisma, accountId)
  } catch (e) {
    console.warn('[derivedMetrics] post metrics failed:', (e as Error).message)
  }

  try {
    // 2. Snapshot rollups (rolling averages, growth acceleration, cadence)
    await computeSnapshotRollups(prisma, accountId, opts)
  } catch (e) {
    console.warn('[derivedMetrics] snapshot rollups failed:', (e as Error).message)
  }

  try {
    // 3. Extended weekly summary (consistency, format momentum, trends)
    await computeWeeklySummaryExtended(prisma, accountId)
  } catch (e) {
    console.warn('[derivedMetrics] weekly summary extension failed:', (e as Error).message)
  }

  try {
    // 4. Record PostMetricSnapshots for delta tracking
    await recordPostMetricSnapshots(prisma, accountId)
  } catch (e) {
    console.warn('[derivedMetrics] post snapshots failed:', (e as Error).message)
  }
}

/**
 * Record a PostMetricSnapshot for each post (max once per day).
 * These accumulate over time to compute week-over-week deltas and trend sparklines.
 */
async function recordPostMetricSnapshots(
  prisma: PrismaClient,
  accountId: string,
): Promise<void> {
  const posts = await prisma.platformPost.findMany({
    where: { accountId },
    select: {
      id: true, likeCount: true, commentCount: true, shareCount: true,
      saveCount: true, viewCount: true, reachCount: true,
      metricSnapshots: { orderBy: { capturedAt: 'desc' as const }, take: 1, select: { capturedAt: true } },
    },
  })

  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)

  for (const post of posts) {
    // Skip if we already have a snapshot today
    const lastSnap = post.metricSnapshots[0]
    if (lastSnap && lastSnap.capturedAt.toISOString().slice(0, 10) === todayStr) continue

    await prisma.postMetricSnapshot.create({
      data: {
        postId: post.id,
        likeCount: post.likeCount ?? 0,
        commentCount: post.commentCount ?? 0,
        shareCount: post.shareCount ?? 0,
        saveCount: post.saveCount ?? 0,
        viewCount: post.viewCount ?? 0,
        reachCount: post.reachCount ?? 0,
      },
    })
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Division-safe: returns 0 for NaN/Infinity/negative */
function safe(n: number): number {
  if (!isFinite(n) || isNaN(n)) return 0
  return Math.round(n * 10000) / 10000 // 4 decimal places
}

/** Average of array, returns 0 for empty */
function avg(nums: number[]): number {
  if (nums.length === 0) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

/** Compute average daily follower growth from an array of snapshots (newest first) */
function computeAvgDailyGrowth(snapshots: Array<{ followerCount: number; capturedAt: Date }>): number {
  if (snapshots.length < 2) return 0
  const newest = snapshots[0]
  const oldest = snapshots[snapshots.length - 1]
  const days = Math.max(1, (new Date(newest.capturedAt).getTime() - new Date(oldest.capturedAt).getTime()) / 86400000)
  return safe((newest.followerCount - oldest.followerCount) / days)
}

export {
  computeAvgDailyGrowth,
  safe,
  avg,
}
