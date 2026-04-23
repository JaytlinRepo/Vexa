/**
 * Analytics Engine
 *
 * Computes company-specific performance metrics from their own data.
 * What works for THIS creator, not generic best practices.
 */

import { PrismaClient } from '@prisma/client'

export interface AnalyticsSignal {
  bestPostingHours: number[]          // top 3 hours (UTC) by engagement
  bestPostingDays: number[]           // top 3 days (0=Sun..6=Sat)
  formatRanking: Array<{ format: string; avgEngagement: number }>
  contentVelocity: number             // posts per week (last 30 days)
  avgEngagementRate: number
  avgSaveRate: number
  topContentThemes: string[]          // from community tags
  audienceGrowthRate: number          // followers gained per week
  hookEffectiveness: {
    question: number                  // avg ER for posts with question hooks
    statement: number
    other: number
  }
}

export async function computeAnalytics(
  prisma: PrismaClient,
  companyId: string,
): Promise<AnalyticsSignal> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000)

  const posts = await prisma.platformPost.findMany({
    where: {
      account: { companyId },
      publishedAt: { gte: thirtyDaysAgo },
    },
    select: {
      publishHour: true,
      publishDayOfWeek: true,
      mediaType: true,
      engagementRate: true,
      saveRate: true,
      caption: true,
      communityTags: true,
    },
    orderBy: { publishedAt: 'desc' },
    take: 100,
  })

  // Best posting hours
  const hourEngagement = new Map<number, { total: number; count: number }>()
  for (const p of posts) {
    if (p.publishHour == null) continue
    const entry = hourEngagement.get(p.publishHour) || { total: 0, count: 0 }
    entry.total += p.engagementRate
    entry.count++
    hourEngagement.set(p.publishHour, entry)
  }
  const bestPostingHours = [...hourEngagement.entries()]
    .map(([hour, { total, count }]) => ({ hour, avg: total / count }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 3)
    .map((h) => h.hour)

  // Best posting days
  const dayEngagement = new Map<number, { total: number; count: number }>()
  for (const p of posts) {
    if (p.publishDayOfWeek == null) continue
    const entry = dayEngagement.get(p.publishDayOfWeek) || { total: 0, count: 0 }
    entry.total += p.engagementRate
    entry.count++
    dayEngagement.set(p.publishDayOfWeek, entry)
  }
  const bestPostingDays = [...dayEngagement.entries()]
    .map(([day, { total, count }]) => ({ day, avg: total / count }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 3)
    .map((d) => d.day)

  // Format ranking
  const formatEngagement = new Map<string, { total: number; count: number }>()
  for (const p of posts) {
    const fmt = p.mediaType || 'UNKNOWN'
    const entry = formatEngagement.get(fmt) || { total: 0, count: 0 }
    entry.total += p.engagementRate
    entry.count++
    formatEngagement.set(fmt, entry)
  }
  const formatRanking = [...formatEngagement.entries()]
    .map(([format, { total, count }]) => ({ format, avgEngagement: total / count }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement)

  // Content velocity
  const contentVelocity = posts.length / 4 // posts per week over 30 days

  // Averages
  const avgEngagementRate = posts.length > 0
    ? posts.reduce((s, p) => s + p.engagementRate, 0) / posts.length
    : 0
  const avgSaveRate = posts.length > 0
    ? posts.reduce((s, p) => s + p.saveRate, 0) / posts.length
    : 0

  // Top content themes from community tags
  const themeCounts = new Map<string, number>()
  for (const p of posts) {
    const tags = p.communityTags as { topic?: string[] } | null
    if (tags?.topic) {
      for (const t of tags.topic) {
        themeCounts.set(t, (themeCounts.get(t) || 0) + 1)
      }
    }
  }
  const topContentThemes = [...themeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([theme]) => theme)

  // Hook effectiveness
  const hookBuckets = { question: { total: 0, count: 0 }, statement: { total: 0, count: 0 }, other: { total: 0, count: 0 } }
  for (const p of posts) {
    const caption = (p.caption || '').trim()
    const firstLine = caption.split('\n')[0] || ''
    const bucket = firstLine.includes('?') ? 'question' : /^[A-Z]/.test(firstLine) ? 'statement' : 'other'
    hookBuckets[bucket].total += p.engagementRate
    hookBuckets[bucket].count++
  }

  // Audience growth rate
  const snapshots = await prisma.platformSnapshot.findMany({
    where: { account: { companyId }, capturedAt: { gte: thirtyDaysAgo } },
    select: { followerCount: true, capturedAt: true },
    orderBy: { capturedAt: 'asc' },
    take: 60,
  })
  const audienceGrowthRate = snapshots.length >= 2
    ? (snapshots[snapshots.length - 1].followerCount - snapshots[0].followerCount) / 4
    : 0

  return {
    bestPostingHours,
    bestPostingDays,
    formatRanking,
    contentVelocity,
    avgEngagementRate,
    avgSaveRate,
    topContentThemes,
    audienceGrowthRate,
    hookEffectiveness: {
      question: hookBuckets.question.count > 0 ? hookBuckets.question.total / hookBuckets.question.count : 0,
      statement: hookBuckets.statement.count > 0 ? hookBuckets.statement.total / hookBuckets.statement.count : 0,
      other: hookBuckets.other.count > 0 ? hookBuckets.other.total / hookBuckets.other.count : 0,
    },
  }
}
