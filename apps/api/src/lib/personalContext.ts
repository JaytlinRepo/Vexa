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

export interface PersonalTiktokPostedToday {
  caption: string | null
  publishedAt: string
  viewCount: number
  hoursAgo: number
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
  postedToday: PersonalTiktokPostedToday[]
  daysSinceLastPost: number | null
  lastSyncedAt: Date
}

export interface ContentInsights {
  bestPostingDay: string | null      // "Tuesday"
  bestFormat: string | null          // "Carousel" or "Reel"
  avgEngPerFormat: Record<string, number>  // { Reel: 45, Carousel: 184, Photo: 30 }
  postsPerWeek: number
  growthRatePerWeek: number | null   // followers gained per week
  projectedFollowers30d: number | null
  engagementTrend: 'improving' | 'stable' | 'declining' | null
  topCaption: string | null          // highest-engagement caption
  weakestCaption: string | null      // lowest-engagement caption
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
  contentInsights: ContentInsights | null
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
    const mappedVids = vidsRaw.slice(0, 20).map((v) => ({
      caption: ((v.title as string) || '').trim() || null,
      url: (v.shareUrl as string) || null,
      publishedAt: v.createdAt ? new Date(Number(v.createdAt) * 1000).toISOString() : null,
      viewCount: Number(v.views || 0),
      likeCount: Number(v.likes || 0),
      commentCount: Number(v.comments || 0),
      shareCount: Number(v.shares || 0),
    }))

    // Detect posts from today + days since last post
    const now = Date.now()
    const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0)
    const postedToday: PersonalTiktokPostedToday[] = []
    let latestPostMs = 0
    for (const v of mappedVids) {
      if (!v.publishedAt) continue
      const pubMs = new Date(v.publishedAt).getTime()
      if (pubMs > latestPostMs) latestPostMs = pubMs
      if (pubMs >= todayStart.getTime()) {
        postedToday.push({
          caption: v.caption,
          publishedAt: v.publishedAt,
          viewCount: v.viewCount,
          hoursAgo: Math.round((now - pubMs) / 3600000),
        })
      }
    }
    // Also check PlatformPost for today's posts (more reliable after sync)
    const ttAccount = await prisma.platformAccount.findFirst({ where: { companyId: company.id, platform: 'tiktok' } })
    if (ttAccount && postedToday.length === 0) {
      const todayPosts = await prisma.platformPost.findMany({
        where: { accountId: ttAccount.id, publishedAt: { gte: todayStart } },
        orderBy: { publishedAt: 'desc' },
        take: 5,
      })
      for (const p of todayPosts) {
        if (p.publishedAt) {
          postedToday.push({
            caption: p.caption,
            publishedAt: p.publishedAt.toISOString(),
            viewCount: p.viewCount,
            hoursAgo: Math.round((now - p.publishedAt.getTime()) / 3600000),
          })
        }
      }
    }

    const daysSinceLastPost = latestPostMs > 0 ? Math.floor((now - latestPostMs) / 86400000) : null

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
      recentVideos: mappedVids,
      postedToday,
      daysSinceLastPost,
      lastSyncedAt: tt.lastSyncedAt,
    }
  }

  // ── Computed content insights from PlatformPost + PlatformSnapshot ──
  const contentInsights = await computeContentInsights(prisma, company.id)

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
    contentInsights,
    activeGoal,
    recentMemories: memories.map((m) => ({
      type: String(m.memoryType),
      content: m.content,
      weight: m.weight,
    })),
    seed: hashString(company.id),
  }
}

async function computeContentInsights(prisma: PrismaClient, companyId: string): Promise<ContentInsights | null> {
  const accounts = await prisma.platformAccount.findMany({
    where: { companyId, status: 'connected' },
    select: { id: true, platform: true },
  })
  if (accounts.length === 0) return null
  const accountIds = accounts.map((a) => a.id)

  const posts = await prisma.platformPost.findMany({
    where: { accountId: { in: accountIds } },
    orderBy: { publishedAt: 'desc' },
    take: 100,
  })
  if (posts.length < 3) return null

  // Best posting day
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const dayEng: number[] = Array(7).fill(0)
  const dayCounts: number[] = Array(7).fill(0)
  for (const p of posts) {
    if (!p.publishedAt) continue
    const dow = p.publishedAt.getUTCDay()
    dayEng[dow] += p.likeCount + p.commentCount * 2 + p.shareCount * 3
    dayCounts[dow]++
  }
  const dayAvg = dayEng.map((e, i) => dayCounts[i] > 0 ? e / dayCounts[i] : 0)
  const bestDayIdx = dayAvg.indexOf(Math.max(...dayAvg))
  const bestPostingDay = dayCounts[bestDayIdx] > 0 ? days[bestDayIdx] : null

  // Format performance
  const formatEng: Record<string, { total: number; count: number }> = {}
  for (const p of posts) {
    const fmt = p.mediaType === 'VIDEO' || p.mediaType === 'REEL' ? 'Reel'
      : p.mediaType === 'CAROUSEL_ALBUM' ? 'Carousel' : 'Photo'
    if (!formatEng[fmt]) formatEng[fmt] = { total: 0, count: 0 }
    formatEng[fmt].total += p.likeCount + p.commentCount * 2 + p.shareCount * 3
    formatEng[fmt].count++
  }
  const avgEngPerFormat: Record<string, number> = {}
  let bestFormat: string | null = null
  let bestFmtAvg = 0
  for (const [fmt, { total, count }] of Object.entries(formatEng)) {
    const avg = Math.round(total / count)
    avgEngPerFormat[fmt] = avg
    if (avg > bestFmtAvg) { bestFmtAvg = avg; bestFormat = fmt }
  }

  // Posts per week
  const postsWithDates = posts.filter((p) => p.publishedAt)
  let postsPerWeek = 0
  if (postsWithDates.length >= 2) {
    const newest = postsWithDates[0].publishedAt!.getTime()
    const oldest = postsWithDates[postsWithDates.length - 1].publishedAt!.getTime()
    const weeks = Math.max(1, (newest - oldest) / (7 * 86400000))
    postsPerWeek = Math.round((postsWithDates.length / weeks) * 10) / 10
  }

  // Growth rate from snapshots — computed per platform then summed
  let growthRatePerWeek: number | null = null
  let projectedFollowers30d: number | null = null
  let totalCurrentFollowers = 0
  let totalGrowthPerDay = 0
  let hasGrowthData = false
  for (const acct of accounts) {
    const acctSnaps = await prisma.platformSnapshot.findMany({
      where: { accountId: acct.id },
      orderBy: { capturedAt: 'asc' },
    })
    if (acctSnaps.length < 2) {
      totalCurrentFollowers += acctSnaps[0]?.followerCount ?? 0
      continue
    }
    const first = acctSnaps[0]
    const last = acctSnaps[acctSnaps.length - 1]
    const daysDiff = Math.max(1, (last.capturedAt.getTime() - first.capturedAt.getTime()) / 86400000)
    totalGrowthPerDay += (last.followerCount - first.followerCount) / daysDiff
    totalCurrentFollowers += last.followerCount
    hasGrowthData = true
  }
  if (hasGrowthData) {
    growthRatePerWeek = Math.round(totalGrowthPerDay * 7)
    projectedFollowers30d = totalCurrentFollowers + Math.round(totalGrowthPerDay * 30)
  }

  // Engagement trend: compare first half vs second half of posts
  let engagementTrend: ContentInsights['engagementTrend'] = null
  if (posts.length >= 6) {
    const mid = Math.floor(posts.length / 2)
    const recentHalf = posts.slice(0, mid)
    const olderHalf = posts.slice(mid)
    const recentAvg = recentHalf.reduce((s, p) => s + p.likeCount + p.commentCount, 0) / recentHalf.length
    const olderAvg = olderHalf.reduce((s, p) => s + p.likeCount + p.commentCount, 0) / olderHalf.length
    if (recentAvg > olderAvg * 1.15) engagementTrend = 'improving'
    else if (recentAvg < olderAvg * 0.85) engagementTrend = 'declining'
    else engagementTrend = 'stable'
  }

  // Top + weakest caption by engagement
  const sorted = [...posts].sort((a, b) =>
    (b.likeCount + b.commentCount * 2 + b.shareCount * 3) - (a.likeCount + a.commentCount * 2 + a.shareCount * 3))
  const topCaption = sorted[0]?.caption?.slice(0, 80) || null
  const weakestCaption = sorted[sorted.length - 1]?.caption?.slice(0, 80) || null

  return {
    bestPostingDay,
    bestFormat,
    avgEngPerFormat,
    postsPerWeek,
    growthRatePerWeek,
    projectedFollowers30d,
    engagementTrend,
    topCaption,
    weakestCaption,
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

/** Build a compact text summary of connected platform data for agent prompts. */
export function buildPlatformDataSummary(ctx: PersonalContext | null): string {
  if (!ctx) return ''
  const parts: string[] = []

  if (ctx.instagram) {
    const ig = ctx.instagram
    parts.push(`Instagram @${ig.handle}: ${fmtFollowers(ig.followerCount)} followers, ${ig.engagementRate}% engagement, ${fmtFollowers(ig.avgReach)} avg reach, ${ig.postCount} posts.`)
    if (ig.topPosts.length > 0) {
      const top = ig.topPosts[0]
      parts.push(`  Top IG post: "${(top.caption || '').slice(0, 80)}" — ${top.likeCount} likes, ${top.commentCount} comments.`)
    }
    const topAge = topShare(ig.audienceAge)
    const topCountry = topShare(ig.audienceTopCountries)
    if (topAge || topCountry) {
      const bits = [topAge ? `${topAge.bucket} (${Math.round(topAge.share * 100)}%)` : '', topCountry ? `${topCountry.bucket} (${Math.round(topCountry.share * 100)}%)` : ''].filter(Boolean)
      parts.push(`  IG audience: ${bits.join(', ')}.`)
    }
  }

  if (ctx.tiktok) {
    const tt = ctx.tiktok
    parts.push(`TikTok @${tt.handle}: ${fmtFollowers(tt.followerCount)} followers, ${(tt.engagementRate * 100).toFixed(1)}% engagement, ${fmtFollowers(tt.avgViews)} avg views, ${tt.videoCount} videos, ${fmtFollowers(tt.likesCount)} total likes.`)
    if (tt.recentVideos.length > 0) {
      const sorted = [...tt.recentVideos].sort((a, b) => (b.likeCount + b.commentCount * 2 + b.shareCount * 3) - (a.likeCount + a.commentCount * 2 + a.shareCount * 3))
      const best = sorted[0]
      const worst = sorted[sorted.length - 1]
      parts.push(`  Top TT video: "${(best.caption || '').slice(0, 80)}" — ${best.viewCount} views, ${best.likeCount} likes.`)
      if (worst !== best) {
        parts.push(`  Weakest TT video: "${(worst.caption || '').slice(0, 80)}" — ${worst.viewCount} views, ${worst.likeCount} likes.`)
      }
    }
    // Posting activity signal
    if (tt.postedToday.length > 0) {
      const latest = tt.postedToday[0]
      parts.push(`  Posted today: "${(latest.caption || '').slice(0, 60)}" (${latest.hoursAgo}h ago, ${latest.viewCount} views so far). ${tt.postedToday.length > 1 ? `${tt.postedToday.length} posts today total.` : ''}`)
    } else if (tt.daysSinceLastPost != null) {
      parts.push(`  No posts today. Last post was ${tt.daysSinceLastPost === 0 ? 'earlier today' : tt.daysSinceLastPost === 1 ? 'yesterday' : `${tt.daysSinceLastPost} days ago`}.`)
    }
  }

  // ── IG Format analysis ──────────────────────────────────────────
  if (ctx.instagram && ctx.instagram.topPosts.length > 2) {
    const formats: Record<string, { count: number; totalEng: number }> = {}
    for (const p of ctx.instagram.topPosts) {
      const fmt = p.mediaType === 'VIDEO' || p.mediaType === 'REEL' ? 'Reel' : p.mediaType === 'CAROUSEL_ALBUM' ? 'Carousel' : 'Photo'
      if (!formats[fmt]) formats[fmt] = { count: 0, totalEng: 0 }
      formats[fmt].count++
      formats[fmt].totalEng += p.likeCount + p.commentCount
    }
    const best = Object.entries(formats).sort((a, b) => (b[1].totalEng / b[1].count) - (a[1].totalEng / a[1].count))[0]
    if (best) parts.push(`  Best IG format: ${best[0]}s (avg ${Math.round(best[1].totalEng / best[1].count)} engagement per post).`)
  }

  // (Posting day patterns computed from recentMedia at the API level,
  // not here — topPosts doesn't carry timestamps.)

  // ── Computed content insights ──────────────────────────────────
  if (ctx.contentInsights) {
    const ci = ctx.contentInsights
    const insightLines: string[] = []
    if (ci.bestPostingDay) insightLines.push(`Best posting day: ${ci.bestPostingDay}`)
    if (ci.bestFormat) insightLines.push(`Best format: ${ci.bestFormat}s (avg ${ci.avgEngPerFormat[ci.bestFormat] || 0} engagement)`)
    if (ci.postsPerWeek > 0) insightLines.push(`Posting frequency: ${ci.postsPerWeek} posts/week`)
    if (ci.growthRatePerWeek != null) insightLines.push(`Growth rate: ${ci.growthRatePerWeek >= 0 ? '+' : ''}${ci.growthRatePerWeek} followers/week`)
    if (ci.projectedFollowers30d != null) insightLines.push(`Projected followers in 30d: ${fmtFollowers(ci.projectedFollowers30d)}`)
    if (ci.engagementTrend) insightLines.push(`Engagement trend: ${ci.engagementTrend}`)
    if (ci.topCaption) insightLines.push(`Highest-engagement caption: "${ci.topCaption}"`)
    if (ci.weakestCaption && ci.weakestCaption !== ci.topCaption) insightLines.push(`Lowest-engagement caption: "${ci.weakestCaption}"`)
    if (insightLines.length > 0) {
      parts.push('\nContent insights (computed from post data):')
      for (const line of insightLines) parts.push('  ' + line)
    }
  }

  // ── Cross-platform comparison ─────────────────────────────────
  if (ctx.instagram && ctx.tiktok) {
    const igFollowers = ctx.instagram.followerCount
    const ttFollowers = ctx.tiktok.followerCount
    const bigger = igFollowers > ttFollowers ? 'Instagram' : 'TikTok'
    const ratio = Math.max(igFollowers, ttFollowers) / Math.max(1, Math.min(igFollowers, ttFollowers))
    parts.push(`\nCross-platform: ${bigger} is the larger audience (${ratio.toFixed(1)}x). Total reach: ${fmtFollowers(igFollowers + ttFollowers)} followers across both.`)
    const igEng = ctx.instagram.engagementRate
    const ttEng = ctx.tiktok.engagementRate * 100
    if (ttEng > igEng * 1.5) {
      parts.push(`  TikTok engagement (${ttEng.toFixed(1)}%) significantly outperforms IG (${igEng.toFixed(1)}%) — content resonates more on TikTok.`)
    } else if (igEng > ttEng * 1.5) {
      parts.push(`  IG engagement (${igEng.toFixed(1)}%) significantly outperforms TikTok (${ttEng.toFixed(1)}%) — IG audience is more engaged.`)
    } else {
      parts.push(`  Engagement is balanced across platforms: IG ${igEng.toFixed(1)}% vs TikTok ${ttEng.toFixed(1)}%.`)
    }
  }

  // ── Instruction to agents ───────────────────────────────────────
  if (parts.length > 0) {
    parts.push('')
    parts.push('IMPORTANT: Do NOT just repeat these numbers back to the CEO. Use them to make specific, actionable recommendations:')
    parts.push('  - Reference specific posts by name when suggesting what to do more/less of')
    parts.push('  - Tie every recommendation to a real number ("Your Carousels get 3x the engagement of Photos — lead with a carousel this week")')
    parts.push('  - If posting frequency is low, name a specific day and topic for the next post')
    parts.push('  - If engagement is declining, explain what changed and propose one concrete fix')
    parts.push('  - Always end with "here is exactly what to do next" — not "consider exploring"')
  }

  return parts.join('\n')
}

/** Best-effort top audience bucket by share. */
export function topShare(
  rows: Array<{ bucket: string; share: number }>,
): { bucket: string; share: number } | null {
  if (!rows || rows.length === 0) return null
  const sorted = [...rows].sort((a, b) => b.share - a.share)
  return sorted[0] || null
}
