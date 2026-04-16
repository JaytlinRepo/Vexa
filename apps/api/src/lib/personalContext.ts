/**
 * PersonalContext — the creator-specific data each agent generator needs
 * to stop producing identical output across users in the same niche.
 *
 * Pulled once per brief (or once per meeting reply) and passed into every
 * generator. Generators treat every field as optional and fall back to
 * niche-token defaults when data isn't there yet.
 */
import { PrismaClient, Prisma } from '@prisma/client'

export interface PersonalTopPost {
  caption: string | null
  likeCount: number
  commentCount: number
  permalink: string | null
  mediaType: string
}

export interface PersonalIgSnapshot {
  handle: string
  source: string                     // 'phyllo' | 'stub' | 'manual'
  accountType: string                // 'CREATOR' | 'BUSINESS' | 'PERSONAL'
  followerCount: number
  followingCount: number
  postCount: number
  engagementRate: number
  avgReach: number
  avgImpressions: number
  topPosts: PersonalTopPost[]
  audienceAge: Array<{ bucket: string; share: number }>
  audienceGender: Array<{ bucket: string; share: number }>
  audienceTopCountries: Array<{ bucket: string; share: number }>
  audienceTopCities: Array<{ bucket: string; share: number }>
  lastSyncedAt: Date
}

export interface PersonalTiktokVideo {
  caption: string | null
  url: string | null
  publishedAt: string | null
  viewCount: number
  likeCount: number
  commentCount: number
  shareCount: number
}

export interface PersonalTiktokSnapshot {
  handle: string
  displayName: string | null
  followerCount: number
  followingCount: number
  videoCount: number
  likesCount: number
  avgViews: number
  engagementRate: number
  reachRate: number
  recentVideos: PersonalTiktokVideo[]
  lastSyncedAt: Date
}

export interface PersonalGoal {
  type: string
  target: number
  byDate: string
  baseline: number
  metricLabel?: string
  rationale?: string
}

export interface PersonalMemory {
  type: string
  content: Prisma.JsonValue
  weight: number
}

export interface PersonalContext {
  companyId: string
  companyName: string
  niche: string
  subNiche: string | null
  brandVoice: Record<string, unknown>
  audience: Record<string, unknown>
  goals: Record<string, unknown>
  instagram: PersonalIgSnapshot | null
  tiktok: PersonalTiktokSnapshot | null
  activeGoal: PersonalGoal | null
  recentMemories: PersonalMemory[]
  /** Deterministic seed derived from companyId — use for stable per-user
   *  variation (picking from a pool of alternatives, rotating hooks, etc.)
   *  so two users in the same niche don't see identical output but the
   *  same user sees stable copy across sessions. */
  seed: number
}

function toArr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}
function toObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function hashString(s: string): number {
  // Small deterministic hash — sufficient for picking-from-a-pool. Not
  // cryptographic; don't use for secrets.
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export async function loadPersonalContext(
  prisma: PrismaClient,
  companyId: string,
): Promise<PersonalContext | null> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: { instagram: true, tiktok: true },
  })
  if (!company) return null

  // Active goal lives on company.goals.active
  const goalsJson = toObj(company.goals)
  const activeRaw = goalsJson.active as Record<string, unknown> | undefined
  const activeGoal: PersonalGoal | null = activeRaw
    ? {
        type: String(activeRaw.type || ''),
        target: Number(activeRaw.target || 0),
        byDate: String(activeRaw.byDate || ''),
        baseline: Number(activeRaw.baseline || 0),
        metricLabel: activeRaw.metricLabel ? String(activeRaw.metricLabel) : undefined,
        rationale: activeRaw.rationale ? String(activeRaw.rationale) : undefined,
      }
    : null

  // Recent brand memories (top-weighted, last 60d)
  const cutoff = new Date(Date.now() - 60 * 86400000)
  const memories = await prisma.brandMemory.findMany({
    where: { companyId, createdAt: { gte: cutoff } },
    orderBy: [{ weight: 'desc' }, { createdAt: 'desc' }],
    take: 12,
  })

  // Instagram — map the JSON blobs into typed arrays so generators can
  // consume them without repeating shape-casting boilerplate.
  let instagram: PersonalIgSnapshot | null = null
  if (company.instagram) {
    const ig = company.instagram
    const topPostsRaw = toArr<Record<string, unknown>>(ig.topPosts)
    instagram = {
      handle: ig.handle,
      source: ig.source,
      accountType: ig.accountType,
      followerCount: ig.followerCount,
      followingCount: ig.followingCount,
      postCount: ig.postCount,
      engagementRate: ig.engagementRate,
      avgReach: ig.avgReach,
      avgImpressions: ig.avgImpressions,
      topPosts: topPostsRaw.slice(0, 5).map((p) => ({
        caption: (p.caption as string) || null,
        likeCount: Number(p.like_count || p.likeCount || 0),
        commentCount: Number(p.comments_count || p.commentCount || 0),
        permalink: (p.permalink as string) || null,
        mediaType: String(p.media_type || p.mediaType || 'IMAGE'),
      })),
      audienceAge: toArr<{ bucket: string; share: number }>(ig.audienceAge),
      audienceGender: toArr<{ bucket: string; share: number }>(ig.audienceGender),
      audienceTopCountries: toArr<{ bucket: string; share: number }>(ig.audienceTop),
      audienceTopCities: toArr<{ bucket: string; share: number }>(ig.audienceCities),
      lastSyncedAt: ig.lastSyncedAt,
    }
  }

  // TikTok — map the JSON video arrays into typed snapshots
  let tiktok: PersonalTiktokSnapshot | null = null
  if (company.tiktok) {
    const tt = company.tiktok
    const vidsRaw = toArr<Record<string, unknown>>(tt.recentVideos)
    tiktok = {
      handle: tt.handle,
      displayName: tt.displayName,
      followerCount: tt.followerCount,
      followingCount: tt.followingCount,
      videoCount: tt.videoCount,
      likesCount: tt.likesCount,
      avgViews: tt.avgViews,
      engagementRate: tt.engagementRate,
      reachRate: tt.reachRate,
      recentVideos: vidsRaw.slice(0, 20).map((v) => ({
        caption: ((v.title as string) || '').trim() || null,
        url: (v.shareUrl as string) || null,
        publishedAt: v.createdAt ? new Date(Number(v.createdAt) * 1000).toISOString() : null,
        viewCount: Number(v.views || 0),
        likeCount: Number(v.likes || 0),
        commentCount: Number(v.comments || 0),
        shareCount: Number(v.shares || 0),
      })),
      lastSyncedAt: tt.lastSyncedAt,
    }
  }

  return {
    companyId: company.id,
    companyName: company.name,
    niche: company.niche,
    subNiche: company.subNiche,
    brandVoice: toObj(company.brandVoice),
    audience: toObj(company.audience),
    goals: goalsJson,
    instagram,
    tiktok,
    activeGoal,
    recentMemories: memories.map((m) => ({
      type: String(m.memoryType),
      content: m.content,
      weight: m.weight,
    })),
    seed: hashString(company.id),
  }
}

// ─── Helpers generators use to pick variation deterministically ────
export function pickFromPool<T>(pool: T[], seed: number, offset = 0): T | undefined {
  if (pool.length === 0) return undefined
  return pool[(seed + offset) % pool.length]
}

/** Rotate a pool so a seed-dependent subset comes out first. Use when
 *  you want N items but don't want everyone to see the same N. */
export function rotatePool<T>(pool: T[], seed: number): T[] {
  if (pool.length === 0) return []
  const k = seed % pool.length
  return [...pool.slice(k), ...pool.slice(0, k)]
}

/** Format a follower count with the size-bucket label creators use. */
export function followerTier(n: number): string {
  if (n < 1000) return 'sub-1K'
  if (n < 10_000) return 'early micro'
  if (n < 50_000) return 'micro'
  if (n < 250_000) return 'mid'
  if (n < 1_000_000) return 'macro'
  return 'mega'
}

/** Compact, readable follower count. */
export function fmtFollowers(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 10_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return n.toLocaleString()
}

/** Best-effort top audience bucket by share. */
export function topShare(
  rows: Array<{ bucket: string; share: number }>,
): { bucket: string; share: number } | null {
  if (!rows || rows.length === 0) return null
  const sorted = [...rows].sort((a, b) => b.share - a.share)
  return sorted[0] || null
}
