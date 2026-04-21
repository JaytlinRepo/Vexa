/**
 * Daily Brief Service
 *
 * Fetches and aggregates data for Maya's daily briefings:
 * - Morning brief (trends + yesterday + queue)
 * - Midday check (performance tracking)
 * - Evening recap (full day summary + tomorrow forecast)
 */

import { PrismaClient } from '@prisma/client'

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface TrendingTopic {
  topic: string
  category: string
  growthPercent: number
  timeframe: string
  isNewlyTrending: boolean
  saturationLevel: 'low' | 'medium' | 'high'
}

export interface PostPerformance {
  id: string
  platform: string
  caption: string
  publishedAt: Date
  metrics: {
    reach: number
    engagement: number
    engagementRate: number
    saves: number
    comments: number
    likes: number
  }
  vsAverage: string
  topCohort: { name: string; percentage: number }
}

export interface QueuedPost {
  id: string
  scheduledTime: Date
  caption: string
  format: string
  platform: string
  status: 'ready' | 'in_production'
  eta?: Date
}

export interface AudienceInsight {
  topCohorts: Array<{
    name: string
    engagementRate: number
    engagementVsAvg: string
  }>
  peakTimes: string[]
  mobileVsDesktop: { mobile: number; desktop: number }
}

export interface MorningBriefData {
  trendingTopics: TrendingTopic[]
  yesterdayPosts: PostPerformance[]
  queuedPosts: QueuedPost[]
  audienceInsights: AudienceInsight
}

export interface MidayCheckData {
  todaysPosts: PostPerformance[]
  hoursElapsed: number
  forecast: {
    estimatedReach: number
    estimatedEngagement: number
    trajectory: 'on_pace' | 'accelerating' | 'underperforming'
  }
}

export interface EveningRecapData {
  todaysPosts: PostPerformance[]
  topPost: PostPerformance
  worstPost?: PostPerformance
  insights: string[]
  queuedTomorrow: QueuedPost[]
  forecast: {
    tomorrowExpectedReach: number
    topCohort: string
  }
  trendOpportunity?: {
    trend: string
    shouldBrief: boolean
  }
}

// ─── MORNING BRIEF ────────────────────────────────────────────────────────────

/**
 * Fetch all data needed for morning brief:
 * - What's trending overnight
 * - How yesterday's posts performed
 * - What's queued for today
 * - Audience insights
 */
export async function getMorningBriefData(
  prisma: PrismaClient,
  companyId: string,
): Promise<MorningBriefData> {
  const [trendingTopics, yesterdayPosts, queuedPosts, audienceInsights] = await Promise.all([
    getTrendingTopics(companyId),
    getYesterdayPerformance(prisma, companyId),
    getQueueStatus(prisma, companyId),
    getAudienceInsights(prisma, companyId),
  ])

  return {
    trendingTopics,
    yesterdayPosts,
    queuedPosts,
    audienceInsights,
  }
}

// ─── MIDDAY CHECK ────────────────────────────────────────────────────────────

/**
 * Fetch how today's posts are performing mid-day
 */
export async function getMidayCheckData(
  prisma: PrismaClient,
  companyId: string,
): Promise<MidayCheckData> {
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  const todaysPosts = await prisma.platformPost.findMany({
    where: {
      account: { companyId },
      publishedAt: {
        gte: today,
        lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
      },
    },
    include: {
      account: { select: { platform: true } },
    },
  })

  const posts: PostPerformance[] = todaysPosts.map(post => ({
    id: post.id,
    platform: post.account.platform,
    caption: post.caption || '',
    publishedAt: post.publishedAt!,
    metrics: {
      reach: post.reachCount,
      engagement: post.likeCount + post.commentCount + post.shareCount + post.saveCount,
      engagementRate: post.engagementRate || 0,
      saves: post.saveCount,
      comments: post.commentCount,
      likes: post.likeCount,
    },
    vsAverage: '+0%', // TODO: compute vs historical average
    topCohort: { name: 'Unknown', percentage: 0 }, // TODO: get from audience data
  }))

  const hoursElapsed = Math.floor((Date.now() - today.getTime()) / (1000 * 60 * 60))

  return {
    todaysPosts: posts,
    hoursElapsed,
    forecast: {
      estimatedReach: 0, // TODO: linear forecast
      estimatedEngagement: 0,
      trajectory: 'on_pace',
    },
  }
}

// ─── EVENING RECAP ────────────────────────────────────────────────────────────

/**
 * Fetch full day summary and tomorrow forecast
 */
export async function getEveningRecapData(
  prisma: PrismaClient,
  companyId: string,
): Promise<EveningRecapData> {
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  const todaysPosts = await prisma.platformPost.findMany({
    where: {
      account: { companyId },
      publishedAt: {
        gte: today,
        lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
      },
    },
    include: { account: { select: { platform: true } } },
  })

  const posts: PostPerformance[] = todaysPosts.map(post => ({
    id: post.id,
    platform: post.account.platform,
    caption: post.caption || '',
    publishedAt: post.publishedAt!,
    metrics: {
      reach: post.reachCount,
      engagement: post.likeCount + post.commentCount + post.shareCount + post.saveCount,
      engagementRate: post.engagementRate || 0,
      saves: post.saveCount,
      comments: post.commentCount,
      likes: post.likeCount,
    },
    vsAverage: '+0%',
    topCohort: { name: 'Unknown', percentage: 0 },
  }))

  const topPost = posts.reduce((best, current) =>
    (current.metrics.engagement > best.metrics.engagement) ? current : best,
  posts[0] || { id: '', platform: '', caption: '', publishedAt: new Date(), metrics: { reach: 0, engagement: 0, engagementRate: 0, saves: 0, comments: 0, likes: 0 }, vsAverage: '', topCohort: { name: '', percentage: 0 } })

  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000)
  const tomorrowEnd = new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000)

  const queuedTomorrow = await prisma.task.findMany({
    where: {
      companyId,
      createdAt: { gte: tomorrow, lt: tomorrowEnd },
      status: { in: ['pending', 'delivered'] },
    },
    select: { id: true, createdAt: true },
    take: 5,
  })

  return {
    todaysPosts: posts,
    topPost,
    insights: [],
    queuedTomorrow: queuedTomorrow.map(task => ({
      id: task.id,
      scheduledTime: task.createdAt,
      caption: '',
      format: 'unknown',
      platform: 'unknown',
      status: 'ready',
    })),
    forecast: {
      tomorrowExpectedReach: 0,
      topCohort: 'Unknown',
    },
  }
}

// ─── HELPER FUNCTIONS ─────────────────────────────────────────────────────────

/**
 * Get trending topics in creator's niche (from cache/API)
 */
async function getTrendingTopics(companyId: string): Promise<TrendingTopic[]> {
  // Pull from the knowledge feed cache via the feed endpoint's internal cache
  try {
    const { getRelatedQueries } = await import('../services/integrations/google-trends.service')
    const { effectiveNiche } = await import('./nicheDetection')
    const prismaClient = (await import('./prisma')).default
    const company = await prismaClient.company.findUnique({ where: { id: companyId } })
    if (!company) return []
    const niche = effectiveNiche(company)
    const queries = await getRelatedQueries(niche)
    const rising = (queries.rising || []).slice(0, 5)
    return rising.map((q: string) => ({
      topic: q,
      category: niche,
      growthPercent: 0,
      timeframe: 'rising',
      isNewlyTrending: true,
      saturationLevel: 'low' as const,
    }))
  } catch {
    return []
  }
}

/**
 * Get yesterday's post performance
 */
async function getYesterdayPerformance(
  prisma: PrismaClient,
  companyId: string,
): Promise<PostPerformance[]> {
  const yesterday = new Date()
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  yesterday.setUTCHours(0, 0, 0, 0)

  const yesterdayEnd = new Date(yesterday.getTime() + 24 * 60 * 60 * 1000)

  const posts = await prisma.platformPost.findMany({
    where: {
      account: { companyId },
      publishedAt: { gte: yesterday, lt: yesterdayEnd },
    },
    include: { account: { select: { platform: true } } },
  })

  return posts.map(post => ({
    id: post.id,
    platform: post.account.platform,
    caption: post.caption || '',
    publishedAt: post.publishedAt!,
    metrics: {
      reach: post.reachCount,
      engagement: post.likeCount + post.commentCount + post.shareCount + post.saveCount,
      engagementRate: post.engagementRate || 0,
      saves: post.saveCount,
      comments: post.commentCount,
      likes: post.likeCount,
    },
    vsAverage: '+0%',
    topCohort: { name: 'Unknown', percentage: 0 },
  }))
}

/**
 * Get posts queued to post (ready + in production)
 */
async function getQueueStatus(
  prisma: PrismaClient,
  companyId: string,
): Promise<QueuedPost[]> {
  const tasks = await prisma.task.findMany({
    where: {
      companyId,
      type: { in: ['hooks', 'script', 'video'] },
      status: { in: ['delivered', 'pending'] },
    },
    orderBy: { createdAt: 'asc' },
    take: 10,
  })

  return tasks.map(task => ({
    id: task.id,
    scheduledTime: task.createdAt,
    caption: task.title || '',
    format: 'unknown',
    platform: 'unknown',
    status: task.status === 'delivered' ? 'ready' : 'in_production',
  }))
}

/**
 * Get audience insights (top cohorts, peak times)
 */
async function getAudienceInsights(
  prisma: PrismaClient,
  companyId: string,
): Promise<AudienceInsight> {
  // TODO: Aggregate from PlatformAudience + WeeklySummary
  return {
    topCohorts: [],
    peakTimes: [],
    mobileVsDesktop: { mobile: 0, desktop: 0 },
  }
}

// ─── ANOMALY DETECTION ────────────────────────────────────────────────────────

export interface Anomaly {
  type: 'surge' | 'underperformance' | 'trend_match'
  post?: string
  trend?: string
  message: string
  urgency: 'high' | 'medium'
}

/**
 * Detect real-time anomalies (post surges, etc.)
 */
export async function detectAnomalies(
  prisma: PrismaClient,
  companyId: string,
): Promise<Anomaly[]> {
  // TODO: Compare current metrics vs historical average
  // Flag if post is 2x+ average engagement
  return []
}

// ─── WEEKLY DATA AGGREGATION ──────────────────────────────────────────────────

export interface WeeklyMetrics {
  weekStart: Date
  weekEnd: Date
  totalReach: number
  totalEngagement: number
  avgEngagementRate: number
  totalPosts: number
  followerDelta: number
}

export interface FormatPerformance {
  format: string
  count: number
  avgEngagementRate: number
  avgReach: number
  totalEngagement: number
}

export interface HookPerformance {
  hookType: string
  count: number
  avgEngagementRate: number
  avgReach: number
}

export interface CohortPerformance {
  cohort: string
  engagementRate: number
  engagementCount: number
  percentage: number
}

export interface TimingPattern {
  day: string
  time: string
  avgEngagementRate: number
  postsCount: number
}

export interface WeeklyData {
  metrics: WeeklyMetrics
  formatPerformance: FormatPerformance[]
  hookPerformance: HookPerformance[]
  cohortPerformance: CohortPerformance[]
  timingPatterns: TimingPattern[]
  topPost: PostPerformance
  worstPost?: PostPerformance
  bestDay: string
  bestTime: string
  trajectory: 'accelerating' | 'stable' | 'declining'
}

/**
 * Get weekly aggregated data (Sunday recap data)
 * This is what Maya reads for her weekly pulse, informing all downstream agents
 */
export async function getWeeklyData(
  prisma: PrismaClient,
  companyId: string,
): Promise<WeeklyData> {
  // Calculate week boundaries (Sunday to Saturday)
  const today = new Date()
  const dayOfWeek = today.getUTCDay()
  const weekStart = new Date(today)
  weekStart.setUTCDate(weekStart.getUTCDate() - dayOfWeek)
  weekStart.setUTCHours(0, 0, 0, 0)

  const weekEnd = new Date(weekStart)
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6)
  weekEnd.setUTCHours(23, 59, 59, 999)

  // Fetch this week's posts
  const posts = await prisma.platformPost.findMany({
    where: {
      account: { companyId },
      publishedAt: { gte: weekStart, lte: weekEnd },
    },
  })

  // Compute metrics
  const metrics: WeeklyMetrics = {
    weekStart,
    weekEnd,
    totalReach: posts.reduce((sum, p) => sum + p.reachCount, 0),
    totalEngagement: posts.reduce(
      (sum, p) => sum + p.likeCount + p.commentCount + p.shareCount + p.saveCount,
      0,
    ),
    avgEngagementRate: posts.length > 0
      ? posts.reduce((sum, p) => sum + (p.engagementRate || 0), 0) / posts.length
      : 0,
    totalPosts: posts.length,
    followerDelta: 0, // TODO: Compare follower count start vs end of week
  }

  // Format performance (Reel vs Carousel vs Image, etc.)
  const formatMap = new Map<string, FormatPerformance>()
  posts.forEach(post => {
    const format = post.mediaType || 'unknown'
    const existing = formatMap.get(format) || {
      format,
      count: 0,
      avgEngagementRate: 0,
      avgReach: 0,
      totalEngagement: 0,
    }
    existing.count++
    existing.totalEngagement += post.likeCount + post.commentCount + post.shareCount + post.saveCount
    existing.avgReach = existing.totalEngagement / existing.count
    formatMap.set(format, existing)
  })
  const formatPerformance = Array.from(formatMap.values())

  // Hook performance (curiosity vs urgency vs relatability)
  // TODO: Parse hooks from outputs and track performance
  const hookPerformance: HookPerformance[] = []

  // Cohort performance
  // TODO: Aggregate from audience data
  const cohortPerformance: CohortPerformance[] = []

  // Timing patterns
  const timingMap = new Map<string, TimingPattern>()
  posts.forEach(post => {
    if (!post.publishedAt) return
    const day = post.publishedAt.toLocaleDateString('en-US', { weekday: 'long' })
    const time = `${post.publishedAt.getUTCHours()}:00`
    const key = `${day}_${time}`
    const existing = timingMap.get(key) || {
      day,
      time,
      avgEngagementRate: 0,
      postsCount: 0,
    }
    existing.postsCount++
    timingMap.set(key, existing)
  })
  const timingPatterns = Array.from(timingMap.values())

  // Top/worst posts
  const topPost = posts.reduce((best, curr) =>
    (curr.likeCount + curr.commentCount + curr.shareCount > best.likeCount + best.commentCount + best.shareCount)
      ? curr
      : best,
  posts[0] || ({} as any))

  return {
    metrics,
    formatPerformance,
    hookPerformance,
    cohortPerformance,
    timingPatterns,
    topPost: topPost ? {
      id: topPost.id,
      platform: 'unknown',
      caption: topPost.caption || '',
      publishedAt: topPost.publishedAt,
      metrics: {
        reach: topPost.reachCount,
        engagement: topPost.likeCount + topPost.commentCount + topPost.shareCount + topPost.saveCount,
        engagementRate: topPost.engagementRate || 0,
        saves: topPost.saveCount,
        comments: topPost.commentCount,
        likes: topPost.likeCount,
      },
      vsAverage: '+0%',
      topCohort: { name: 'Unknown', percentage: 0 },
    } : undefined as any,
    bestDay: timingPatterns[0]?.day || 'Unknown',
    bestTime: timingPatterns[0]?.time || 'Unknown',
    trajectory: 'stable',
  }
}
