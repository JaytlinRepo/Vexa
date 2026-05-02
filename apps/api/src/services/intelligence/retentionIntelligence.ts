/**
 * Creator-Specific Retention Intelligence
 *
 * Learns "what editing behavior performs best for THIS creator's audience?"
 * by correlating style metrics with engagement and retention data.
 *
 * The profile continuously evolves as new posts are synced and evaluated.
 * This gives each creator a unique competitive advantage — Riley can
 * edit specifically for THEIR audience's preferences, not generic best practices.
 */

import { PrismaClient } from '@prisma/client'
import type { CommunityTags } from '../communityTagging.service'
import { invokeAgent, parseAgentOutput } from '../bedrock/bedrock.service'

// ── Retention Profile ────────────────────────────────────────────────────────

export interface RetentionProfile {
  creatorId: string
  updatedAt: string
  postCount: number                    // how many posts inform this profile

  // Style-performance correlations (what works for THIS audience)
  styleProfile: {
    avgCutSpeed: number                // optimal cut duration in seconds
    subtitleDensity: 'high' | 'medium' | 'low' | 'none'
    zoomBehavior: 'aggressive' | 'moderate' | 'minimal' | 'none'
    hookPattern: string                // best-performing hook style
    audioEnergyCurve: string           // audio profile that retains
    transitionStyle: string            // most effective transition type
    retentionScore: number             // overall retention (0-1)
  }

  // Performance by editing dimension (which levers matter most)
  performanceCorrelations: {
    cutSpeed: { optimal: number; impact: number }           // impact = how much it affects ER
    subtitles: { bestPerforming: string; impact: number }
    hookTiming: { optimal: number; impact: number }
    videoLength: { optimal: number; impact: number }
    postingHour: { optimal: number; impact: number }
    format: { bestPerforming: string; impact: number }
    mood: { bestPerforming: string; impact: number }
  }

  // Audience retention patterns
  audiencePatterns: {
    peakEngagementDay: number          // 0=Sun..6=Sat
    peakEngagementHour: number         // 0-23 UTC
    preferredLength: string            // "micro" | "short" | "standard"
    topTopics: string[]                // topics that get most engagement
    avoidTopics: string[]              // topics that underperform
  }

  // Evolution tracking
  trend: {
    engagementTrend: 'improving' | 'stable' | 'declining'
    retentionTrend: 'improving' | 'stable' | 'declining'
    growthRate: number                 // followers per week
    lastSignificantChange: string      // what changed recently
  }
}

// ── Build Retention Profile ──────────────────────────────────────────────────

export async function buildRetentionProfile(
  prisma: PrismaClient,
  companyId: string,
): Promise<RetentionProfile> {
  // Get all posts with engagement data
  const posts = await prisma.platformPost.findMany({
    where: {
      account: { companyId },
      mediaType: { in: ['REEL', 'VIDEO'] },
      engagementRate: { gt: 0 },
    },
    orderBy: { publishedAt: 'desc' },
    take: 100,
    select: {
      id: true,
      engagementRate: true,
      saveRate: true,
      retentionRate: true,
      avgWatchTimeMs: true,
      viralityScore: true,
      publishHour: true,
      publishDayOfWeek: true,
      captionLength: true,
      mediaType: true,
      communityTags: true,
      publishedAt: true,
    },
  })

  if (posts.length < 3) {
    return defaultProfile(companyId)
  }

  // Split into top and bottom performers
  const sorted = [...posts].sort((a, b) => b.engagementRate - a.engagementRate)
  const topCount = Math.max(3, Math.floor(posts.length * 0.3))
  const topPerformers = sorted.slice(0, topCount)
  const bottomPerformers = sorted.slice(-topCount)

  const avgER = posts.reduce((s, p) => s + p.engagementRate, 0) / posts.length
  const avgRetention = posts.filter((p) => p.retentionRate > 0).reduce((s, p) => s + p.retentionRate, 0) /
    Math.max(1, posts.filter((p) => p.retentionRate > 0).length)

  // ── Correlate editing dimensions with performance ──

  // Cut speed correlation (from community tags)
  const cutSpeedCorr = correlateTagDimension(topPerformers, bottomPerformers, 'format')

  // Subtitle correlation
  // CommunityTags doesn't currently include `subtitleStyle` — treat it as an
  // optional field that may be present in older/extended tag payloads.
  const subtitleCorr = correlatePresence(
    topPerformers,
    bottomPerformers,
    (tags) => (tags as (CommunityTags & { subtitleStyle?: string }) | null)?.subtitleStyle !== 'none',
  )

  // Hook timing (from tags)
  const hookCorr = correlateTagDimension(topPerformers, bottomPerformers, 'hookType')

  // Video length
  const lengthCorr = correlateTagDimension(topPerformers, bottomPerformers, 'contentLength')

  // Posting time correlation
  // findBestValue's signature types each post as Record<string, unknown>,
  // so we cast the read fields to number-or-null at the extractor.
  const bestHour = findBestValue(topPerformers, (p) => p.publishHour as number | null | undefined)
  const bestDay = findBestValue(topPerformers, (p) => p.publishDayOfWeek as number | null | undefined)

  // Mood correlation
  const moodCorr = correlateTagDimension(topPerformers, bottomPerformers, 'mood')

  // Top topics (from community tags)
  const topTopics = extractTopValues(topPerformers, (tags) => tags?.topic || [])
  const bottomTopics = extractTopValues(bottomPerformers, (tags) => tags?.topic || [])
  const avoidTopics = bottomTopics.filter((t) => !topTopics.includes(t))

  // Trends
  const recentPosts = posts.slice(0, Math.min(10, posts.length))
  const olderPosts = posts.slice(Math.min(10, posts.length))
  const recentAvgER = recentPosts.reduce((s, p) => s + p.engagementRate, 0) / recentPosts.length
  const olderAvgER = olderPosts.length > 0
    ? olderPosts.reduce((s, p) => s + p.engagementRate, 0) / olderPosts.length
    : recentAvgER

  const engTrend = recentAvgER > olderAvgER * 1.1 ? 'improving' : recentAvgER < olderAvgER * 0.9 ? 'declining' : 'stable'

  // Growth rate
  const snapshots = await prisma.platformSnapshot.findMany({
    where: { account: { companyId } },
    orderBy: { capturedAt: 'desc' },
    take: 14,
    select: { followerCount: true, capturedAt: true },
  })
  const growthRate = snapshots.length >= 2
    ? (snapshots[0].followerCount - snapshots[snapshots.length - 1].followerCount) / (snapshots.length / 7)
    : 0

  // Determine optimal cut speed from top performers' tags
  const topFormats = topPerformers
    .map((p) => (p.communityTags as CommunityTags | null)?.format)
    .filter(Boolean) as string[]
  const avgCutSpeed = topFormats.includes('talking-head') ? 2.5
    : topFormats.includes('b-roll-montage') ? 1.0
    : topFormats.includes('tutorial') ? 2.0
    : 1.5

  const profile: RetentionProfile = {
    creatorId: companyId,
    updatedAt: new Date().toISOString(),
    postCount: posts.length,

    styleProfile: {
      avgCutSpeed,
      subtitleDensity: subtitleCorr.topHas > 0.6 ? 'high' : subtitleCorr.topHas > 0.3 ? 'medium' : 'low',
      zoomBehavior: topFormats.includes('b-roll-montage') ? 'aggressive' : 'moderate',
      hookPattern: hookCorr.bestValue || 'cold-open',
      audioEnergyCurve: moodCorr.bestValue === 'energetic' ? 'high-intensity' : 'moderate',
      transitionStyle: cutSpeedCorr.bestValue || 'hard-cut',
      retentionScore: Math.round(avgRetention * 100) / 100,
    },

    performanceCorrelations: {
      cutSpeed: { optimal: avgCutSpeed, impact: Math.round(cutSpeedCorr.impact * 100) / 100 },
      subtitles: { bestPerforming: subtitleCorr.topHas > 0.5 ? 'with-subtitles' : 'without', impact: Math.round(subtitleCorr.impact * 100) / 100 },
      hookTiming: { optimal: 1.5, impact: Math.round(hookCorr.impact * 100) / 100 },
      videoLength: { optimal: lengthCorr.bestValue === 'micro' ? 15 : lengthCorr.bestValue === 'short' ? 25 : 45, impact: Math.round(lengthCorr.impact * 100) / 100 },
      postingHour: { optimal: bestHour ?? 12, impact: 0.3 },
      format: { bestPerforming: cutSpeedCorr.bestValue || 'reel', impact: Math.round(cutSpeedCorr.impact * 100) / 100 },
      mood: { bestPerforming: moodCorr.bestValue || 'authentic', impact: Math.round(moodCorr.impact * 100) / 100 },
    },

    audiencePatterns: {
      peakEngagementDay: bestDay ?? 3,
      peakEngagementHour: bestHour ?? 12,
      preferredLength: lengthCorr.bestValue || 'short',
      topTopics: topTopics.slice(0, 5),
      avoidTopics: avoidTopics.slice(0, 3),
    },

    trend: {
      engagementTrend: engTrend,
      retentionTrend: engTrend, // mirrors engagement for now
      growthRate: Math.round(growthRate),
      lastSignificantChange: engTrend === 'improving'
        ? 'Engagement trending up — recent content resonating better.'
        : engTrend === 'declining'
          ? 'Engagement declining — consider refreshing format or topics.'
          : 'Engagement stable — consistent performance.',
    },
  }

  // Store in brand memory
  await storeRetentionProfile(prisma, companyId, profile)

  return profile
}

// ── Correlation Helpers ──────────────────────────────────────────────────────

interface CorrelationResult {
  bestValue: string
  impact: number // 0-1, how much this dimension affects performance
}

function correlateTagDimension(
  top: Array<{ communityTags: unknown }>,
  bottom: Array<{ communityTags: unknown }>,
  dimension: keyof CommunityTags,
): CorrelationResult {
  const topValues = new Map<string, number>()
  const bottomValues = new Map<string, number>()

  for (const p of top) {
    const tags = p.communityTags as CommunityTags | null
    if (!tags) continue
    const val = tags[dimension]
    const values = Array.isArray(val) ? val : [val]
    for (const v of values) {
      if (v) topValues.set(String(v), (topValues.get(String(v)) || 0) + 1)
    }
  }

  for (const p of bottom) {
    const tags = p.communityTags as CommunityTags | null
    if (!tags) continue
    const val = tags[dimension]
    const values = Array.isArray(val) ? val : [val]
    for (const v of values) {
      if (v) bottomValues.set(String(v), (bottomValues.get(String(v)) || 0) + 1)
    }
  }

  // Find value that appears most in top but least in bottom
  let bestValue = ''
  let bestDiff = -1
  for (const [val, topCount] of topValues) {
    const bottomCount = bottomValues.get(val) || 0
    const topRatio = topCount / top.length
    const bottomRatio = bottomCount / Math.max(1, bottom.length)
    const diff = topRatio - bottomRatio
    if (diff > bestDiff) {
      bestDiff = diff
      bestValue = val
    }
  }

  return { bestValue, impact: Math.max(0, Math.min(1, bestDiff)) }
}

function correlatePresence(
  top: Array<{ communityTags: unknown }>,
  bottom: Array<{ communityTags: unknown }>,
  hasFeature: (tags: CommunityTags | null) => boolean,
): { topHas: number; bottomHas: number; impact: number } {
  const topHas = top.filter((p) => hasFeature(p.communityTags as CommunityTags | null)).length / Math.max(1, top.length)
  const bottomHas = bottom.filter((p) => hasFeature(p.communityTags as CommunityTags | null)).length / Math.max(1, bottom.length)
  return { topHas, bottomHas, impact: Math.abs(topHas - bottomHas) }
}

function findBestValue(
  top: Array<Record<string, unknown>>,
  extractor: (p: Record<string, unknown>) => number | null | undefined,
): number | null {
  const counts = new Map<number, number>()
  for (const p of top) {
    const val = extractor(p)
    if (val != null) counts.set(val, (counts.get(val) || 0) + 1)
  }
  if (counts.size === 0) return null
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

function extractTopValues(
  posts: Array<{ communityTags: unknown }>,
  extractor: (tags: CommunityTags | null) => string[],
): string[] {
  const counts = new Map<string, number>()
  for (const p of posts) {
    const values = extractor(p.communityTags as CommunityTags | null)
    for (const v of values) {
      counts.set(v, (counts.get(v) || 0) + 1)
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v)
}

// ── Storage ──────────────────────────────────────────────────────────────────

async function storeRetentionProfile(
  prisma: PrismaClient,
  companyId: string,
  profile: RetentionProfile,
): Promise<void> {
  const data = { source: 'retention_intelligence', ...profile } as any

  const existing = await prisma.brandMemory.findFirst({
    where: {
      companyId,
      memoryType: 'performance',
      content: { path: ['source'], equals: 'retention_intelligence' },
    },
  })

  if (existing) {
    await prisma.brandMemory.update({ where: { id: existing.id }, data: { content: data, weight: 1.5 } })
  } else {
    await prisma.brandMemory.create({
      data: { companyId, memoryType: 'performance', content: data, weight: 1.5 },
    })
  }
}

export async function getRetentionProfile(
  prisma: PrismaClient,
  companyId: string,
): Promise<RetentionProfile | null> {
  const memory = await prisma.brandMemory.findFirst({
    where: {
      companyId,
      memoryType: 'performance',
      content: { path: ['source'], equals: 'retention_intelligence' },
    },
  })
  if (!memory) return null
  const { source: _, ...profile } = memory.content as Record<string, unknown>
  return profile as unknown as RetentionProfile
}

// ── Default Profile ──────────────────────────────────────────────────────────

function defaultProfile(companyId: string): RetentionProfile {
  return {
    creatorId: companyId,
    updatedAt: new Date().toISOString(),
    postCount: 0,
    styleProfile: {
      avgCutSpeed: 1.5, subtitleDensity: 'medium', zoomBehavior: 'moderate',
      hookPattern: 'cold-open', audioEnergyCurve: 'moderate',
      transitionStyle: 'hard-cut', retentionScore: 0,
    },
    performanceCorrelations: {
      cutSpeed: { optimal: 1.5, impact: 0 },
      subtitles: { bestPerforming: 'unknown', impact: 0 },
      hookTiming: { optimal: 2, impact: 0 },
      videoLength: { optimal: 30, impact: 0 },
      postingHour: { optimal: 12, impact: 0 },
      format: { bestPerforming: 'unknown', impact: 0 },
      mood: { bestPerforming: 'unknown', impact: 0 },
    },
    audiencePatterns: {
      peakEngagementDay: 3, peakEngagementHour: 12,
      preferredLength: 'short', topTopics: [], avoidTopics: [],
    },
    trend: {
      engagementTrend: 'stable', retentionTrend: 'stable',
      growthRate: 0, lastSignificantChange: 'Not enough data yet.',
    },
  }
}
