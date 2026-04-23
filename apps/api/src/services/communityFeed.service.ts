/**
 * Community Feed Service
 *
 * Queries opted-in users' content for the Knowledge Feed explore page.
 * Scores posts by engagement quality + tag relevance to the viewer.
 */

import { PrismaClient } from '@prisma/client'
import type { CommunityTags } from './communityTagging.service'

// ── Types ────────────────────────────────────────────────────────────────────

export interface CommunityFeedPost {
  id: string
  caption: string | null
  mediaType: string
  thumbnailUrl: string | null
  url: string | null
  publishedAt: string
  engagementRate: number
  saveRate: number
  viralityScore: number
  communityTags: CommunityTags
  creator: {
    handle: string
    profileImageUrl: string | null
    platform: string
  }
  relevanceScore: number
}

interface ViewerProfile {
  performancePattern?: { contentThemes?: string[]; bestPerformingFormat?: string }
  audienceCharacteristics?: { vibe?: string; lifestyle?: string; ageRange?: string; specificity?: string }
  visualStyle?: { filters?: string[] }
}

// ── Scoring ──────────────────────────────────────────────────────────────────

function computeRelevanceScore(
  post: {
    engagementRate: number
    saveRate: number
    viralityScore: number
    publishedAt: Date | null
    communityTags: CommunityTags | null
  },
  viewerNiche: string,
  viewerSubNiche: string | null,
  viewerProfile: ViewerProfile | null,
): number {
  let score = 0

  // Engagement quality (0–40)
  score += Math.min(40, post.engagementRate * 400)

  // Save rate — IG's strongest ranking signal (0–15)
  score += Math.min(15, post.saveRate * 1500)

  // Virality (0–10)
  score += Math.min(10, post.viralityScore * 1000)

  // Recency — linear decay over 30 days (0–15)
  if (post.publishedAt) {
    const daysOld = (Date.now() - post.publishedAt.getTime()) / 86400000
    score += Math.max(0, 15 - daysOld * 0.5)
  }

  // Tag relevance to viewer profile (0–20)
  const tags = post.communityTags
  if (viewerProfile && tags) {
    // Mood/vibe match
    if (viewerProfile.audienceCharacteristics?.vibe === tags.mood) score += 4

    // Topic overlap
    const themes = viewerProfile.performancePattern?.contentThemes || []
    let topicOverlap = 0
    for (const theme of themes) {
      for (const topic of tags.topic) {
        if (topic.toLowerCase().includes(theme.toLowerCase()) || theme.toLowerCase().includes(topic.toLowerCase())) {
          topicOverlap++
          break
        }
      }
    }
    score += Math.min(6, topicOverlap * 3)

    // Format match
    const bestFormat = viewerProfile.performancePattern?.bestPerformingFormat || ''
    if (bestFormat && tags.format.includes(bestFormat.toLowerCase())) score += 3

    // Visual style match
    const filters = viewerProfile.visualStyle?.filters || []
    if (filters.some((f) => tags.visualStyle.includes(f.toLowerCase()))) score += 2

    // Sub-niche exact match bonus
    if (viewerSubNiche && tags.subNiche === viewerSubNiche) score += 5
  }

  return Math.min(100, Math.round(score))
}

// ── Query ─────────────────────────────────────────────────────────────────────

export async function queryCommunityFeed(
  prisma: PrismaClient,
  viewerCompanyId: string,
  options: {
    limit?: number
    niche?: string
    subNiche?: string | null
    viewerProfile?: ViewerProfile | null
  },
): Promise<{ posts: CommunityFeedPost[]; totalAvailable: number }> {
  const { limit = 20, niche, subNiche = null, viewerProfile = null } = options

  // Build niche filter — if niche provided, match; otherwise all niches
  const nicheFilter = niche
    ? { OR: [{ niche }, { detectedNiche: niche }] }
    : {}

  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000)

  // Query opted-in posts from other companies
  const posts = await prisma.platformPost.findMany({
    where: {
      communityTaggedAt: { not: null },
      publishedAt: { gte: ninetyDaysAgo },
      account: {
        company: {
          communityOptIn: true,
          id: { not: viewerCompanyId },
          ...nicheFilter,
        },
      },
    },
    include: {
      account: {
        select: {
          handle: true,
          profileImageUrl: true,
          platform: true,
          company: {
            select: { niche: true, detectedSubNiche: true },
          },
        },
      },
    },
    orderBy: { engagementRate: 'desc' },
    take: limit * 3, // fetch extra for scoring + dedup
  })

  const totalAvailable = posts.length

  // Score and rank
  const scored: CommunityFeedPost[] = posts
    .filter((p) => p.communityTags) // safety check
    .map((p) => ({
      id: p.id,
      caption: p.caption,
      mediaType: p.mediaType,
      thumbnailUrl: p.thumbnailUrl,
      url: p.url,
      publishedAt: (p.publishedAt || p.lastSyncedAt).toISOString(),
      engagementRate: p.engagementRate,
      saveRate: p.saveRate,
      viralityScore: p.viralityScore,
      communityTags: p.communityTags as unknown as CommunityTags,
      creator: {
        handle: p.account.handle,
        profileImageUrl: p.account.profileImageUrl,
        platform: p.account.platform,
      },
      relevanceScore: computeRelevanceScore(
        { ...p, communityTags: p.communityTags as unknown as CommunityTags },
        niche || 'lifestyle',
        subNiche,
        viewerProfile,
      ),
    }))
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit)

  return { posts: scored, totalAvailable }
}

// ── Convert to FeedItem ──────────────────────────────────────────────────────

export interface FeedItem {
  id: string
  source: string
  title: string
  summary: string
  author?: string
  url: string
  imageUrl: string | null
  createdAt: string
  type: 'article' | 'research' | 'reddit' | 'trend' | 'video' | 'instagram'
  score: number
  mayaTake: string
  creator?: {
    handle: string
    profileImageUrl: string | null
    platform: string
  }
}

export function communityPostToFeedItem(post: CommunityFeedPost): FeedItem {
  const tags = post.communityTags
  const topicStr = tags.topic.slice(0, 2).join(' + ')
  const engPct = (post.engagementRate * 100).toFixed(1)
  const caption = (post.caption || '').slice(0, 80)

  // Determine type from mediaType
  const isVideo = ['REEL', 'VIDEO'].includes(post.mediaType.toUpperCase())
  const type = isVideo ? 'video' as const : post.mediaType === 'CAROUSEL_ALBUM' ? 'instagram' as const : 'instagram' as const

  // Maya explains relevance
  let mayaTake: string
  if (post.saveRate > 0.03) {
    mayaTake = `${engPct}% engagement, ${(post.saveRate * 100).toFixed(1)}% save rate on ${topicStr}. High saves = the audience wants to return to this.`
  } else if (post.viralityScore > 0.02) {
    mayaTake = `${(post.viralityScore * 100).toFixed(1)}% share rate on ${tags.format}. @${post.creator.handle} found a format that gets shared.`
  } else if (post.engagementRate > 0.05) {
    mayaTake = `${engPct}% engagement on ${tags.mood} ${tags.format} about ${topicStr}. Strong performance in your space.`
  } else {
    mayaTake = `${tags.mood} ${tags.format} about ${topicStr} from @${post.creator.handle}. Active in your niche.`
  }

  return {
    id: `community_${post.id}`,
    source: `@${post.creator.handle}`,
    title: caption || `${tags.format} — ${topicStr}`,
    summary: `${engPct}% ER · ${tags.mood} ${tags.format} · ${topicStr}`,
    url: post.url || '#',
    imageUrl: post.thumbnailUrl,
    createdAt: post.publishedAt,
    type,
    score: post.relevanceScore,
    mayaTake,
    creator: post.creator,
  }
}
