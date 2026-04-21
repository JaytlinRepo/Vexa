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
      metricSnapshots: {
        orderBy: { capturedAt: 'asc' },
        take: 100,
      },
    },
  })

  const posts: PostPerformance[] = todaysPosts.map(post => ({
    id: post.id,
    platform: post.account.platform,
    caption: post.caption || '',
    publishedAt: post.publishedAt,
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
  })

  const posts: PostPerformance[] = todaysPosts.map(post => ({
    id: post.id,
    platform: 'unknown',
    caption: post.caption || '',
    publishedAt: post.publishedAt,
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
  // TODO: Call Google Trends API + NewsAPI + Redis cache
  // For now, return empty — will be populated by trend service
  return []
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
  })

  return posts.map(post => ({
    id: post.id,
    platform: 'unknown',
    caption: post.caption || '',
    publishedAt: post.publishedAt,
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
