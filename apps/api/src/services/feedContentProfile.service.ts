/**
 * Feed Content Profile Service (Knowledge tab)
 *
 * Builds a per-company "content profile" derived from the user's actual
 * published posts (not just their declared niche enum). The profile drives
 * three things in the Knowledge feed:
 *
 *   1. Query seeds — IG hashtag fetches use the user's real top hashtags
 *      instead of hard-coded NICHE_HASHTAGS.
 *   2. The relevance gate — items fetched from any source are scored by
 *      token overlap with the profile and dropped if zero (when the
 *      profile is rich enough to trust).
 *   3. Sub-niche auto-detection — if a content profile is dominated by
 *      "travel" tags, persist `Company.detectedSubNiche='travel'` so the
 *      next call can route accordingly.
 *
 * Cache: 1 hour in-memory keyed by companyId.
 *
 * NOTE: Distinct from `contentProfile.service.ts` which is an AI-driven
 * profiler used by the agents. This one is purely caption/tag aggregation
 * — no Bedrock calls.
 */
import { PrismaClient } from '@prisma/client'
import { getAffinityCreators } from './feedSignal.service'

export type ProfileStrength = 'rich' | 'thin' | 'empty'

export interface FeedContentProfile {
  companyId: string
  niche: string                  // declared niche, lowercased
  detectedSubNiche: string | null
  /** ISO 2-letter country code, derived from PlatformAudience.topCountries
   * top entry the first time the feed runs for this company. Null until
   * backfilled. Used to boost same-country community items. */
  country: string | null
  strength: ProfileStrength
  postsAnalyzed: number
  topHashtags: string[]          // user's most-used hashtags (no '#'), top 10
  topAITags: string[]            // most common communityTags.topic across posts, top 10
  topKeywords: string[]          // cleaned word tokens from captions, top 12
  dominantFormats: string[]      // 'REEL'|'VIDEO'|'CAROUSEL_ALBUM'|'IMAGE' sorted desc
  // ── Mood/style fingerprint (from communityTags) ──────────────────────
  // All five are top-N (4) sorted by engagement-weighted frequency. Used
  // by feedRelevance.service.ts to score multi-dimensional similarity
  // between a candidate item and the user's actual content fingerprint.
  /** Top moods e.g. 'energetic','raw','calm','aesthetic'. */
  dominantMoods: string[]
  /** Top visual styles e.g. 'cinematic','warm-tones','bright'. */
  dominantStyles: string[]
  /** Top hook types e.g. 'personal-story','statement'. */
  dominantHooks: string[]
  /** Top audience types e.g. 'young-professionals','travelers'. */
  dominantAudiences: string[]
  /** Top content lengths e.g. 'standard','short','long'. */
  dominantLengths: string[]
  /** Creators (e.g. '@handle') the user has revealed/opened recently.
   *  Used by feed.ts to apply an author-affinity boost. */
  affinityCreators: string[]
  /** Pre-built lowercase token set for cheap overlap checks. */
  tokenSet: Set<string>
  builtAt: number
}

// Stopwords + IG/TT chrome we never want polluting the topic histogram.
const STOP = new Set([
  'the','and','for','with','this','that','your','you','are','was','have','has',
  'but','not','its','our','were','they','their','will','can','one','two','out',
  'all','any','get','got','let','use','via','etc','about','from','what','when',
  'where','why','how','some','more','most','just','like','make','made','only',
  'also','than','then','them','these','those','here','there','very','much',
  'shorts','reel','reels','tiktok','instagram','facebook','youtube','video',
  'follow','link','bio','swipe','tap','watch','check','comment','share','save',
  'subscribe','today','week','month','year','time','need','want','look',
  'love','feel','felt','been','great','last','every','first',
])

function tokenizeCaption(text: string | null): { words: string[]; hashtags: string[] } {
  if (!text) return { words: [], hashtags: [] }
  const cleaned = text.toLowerCase().replace(/https?:\/\/\S+/g, ' ')
  const tokens = cleaned.split(/[\s\u200B-\u200D\uFEFF]+/)
  const words: string[] = []
  const hashtags: string[] = []
  for (const raw of tokens) {
    if (!raw) continue
    if (raw.startsWith('#')) {
      const tag = raw.replace(/[^a-z0-9]/g, '')
      if (tag.length >= 3) hashtags.push(tag)
    } else {
      const word = raw.replace(/[^a-z0-9]/g, '')
      if (word.length >= 4 && !STOP.has(word)) words.push(word)
    }
  }
  return { words, hashtags }
}

function topN(counts: Map<string, number>, n: number): string[] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k)
}

const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour
const cache = new Map<string, FeedContentProfile>()

export function invalidateFeedContentProfile(companyId: string): void {
  cache.delete(companyId)
}

export async function getFeedContentProfile(
  prisma: PrismaClient,
  companyId: string,
): Promise<FeedContentProfile> {
  const hit = cache.get(companyId)
  if (hit && Date.now() - hit.builtAt < CACHE_TTL_MS) return hit

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { niche: true, detectedSubNiche: true, subNiche: true, country: true },
  })
  const niche = (company?.niche || 'lifestyle').toLowerCase()
  const detectedSubNiche = company?.detectedSubNiche || company?.subNiche || null
  const country = company?.country ?? null

  const accounts = await prisma.platformAccount.findMany({
    where: { companyId },
    select: { id: true },
  })
  if (accounts.length === 0) {
    return finalize(companyId, niche, detectedSubNiche, country, 0, [], [], [], [], [], [], [], [], [], [])
  }

  // Pull engagement metrics so we can weight the histograms by post
  // performance. A breakout post (high engagement + saves + virality)
  // shapes the profile far more than a flop.
  const posts = await prisma.platformPost.findMany({
    where: { accountId: { in: accounts.map((a) => a.id) } },
    orderBy: { publishedAt: 'desc' },
    take: 80,
    select: {
      caption: true,
      mediaType: true,
      communityTags: true,
      engagementRate: true,
      saveRate: true,
      viralityScore: true,
    },
  })

  const wordCounts = new Map<string, number>()
  const hashCounts = new Map<string, number>()
  const formatCounts = new Map<string, number>()
  const aiTagCounts = new Map<string, number>()
  // Five additional dimension histograms — drives the multi-dimensional
  // similarity score in feedRelevance.service.ts.
  const moodCounts = new Map<string, number>()
  const styleCounts = new Map<string, number>()
  const hookCounts = new Map<string, number>()
  const audienceCounts = new Map<string, number>()
  const lengthCounts = new Map<string, number>()

  for (const p of posts) {
    // Per-post performance weight. Coefficients mirror communityFeed
    // service.ts:54-61 so scoring is consistent across the feed. Median
    // post → ~1.0; breakout → 3-4; flop → ~0.25.
    const weight = clamp(
      0.25,
      4,
      1 + (p.engagementRate || 0) * 0.5 + (p.saveRate || 0) * 1.5 + (p.viralityScore || 0),
    )
    const { words, hashtags } = tokenizeCaption(p.caption)
    for (const w of words) wordCounts.set(w, (wordCounts.get(w) ?? 0) + weight)
    for (const h of hashtags) hashCounts.set(h, (hashCounts.get(h) ?? 0) + weight)
    const tags = p.communityTags as {
      topic?: string[]
      mood?: string
      visualStyle?: string
      format?: string
      hookType?: string
      audienceType?: string
      contentLength?: string
    } | null
    // dominantFormats aggregates from communityTags.format (Bedrock
    // vocabulary like 'vlog', 'talking-head', 'b-roll-montage') so it
    // can be compared like-for-like against item tags in the relevance
    // gate. Falls back to mediaType ('REEL'/'VIDEO') for posts that
    // weren't tagged yet — those rarely make the top 3 in practice.
    if (tags?.format) {
      const k = tags.format.toLowerCase().trim()
      if (k) formatCounts.set(k, (formatCounts.get(k) ?? 0) + weight)
    } else {
      const fmt = (p.mediaType ?? 'UNKNOWN').toLowerCase()
      formatCounts.set(fmt, (formatCounts.get(fmt) ?? 0) + weight)
    }
    if (tags?.topic) {
      for (const t of tags.topic) {
        const k = t.toLowerCase().trim()
        if (k.length >= 3) aiTagCounts.set(k, (aiTagCounts.get(k) ?? 0) + weight)
      }
    }
    if (tags?.mood) {
      const k = tags.mood.toLowerCase().trim()
      if (k) moodCounts.set(k, (moodCounts.get(k) ?? 0) + weight)
    }
    if (tags?.visualStyle) {
      const k = tags.visualStyle.toLowerCase().trim()
      if (k) styleCounts.set(k, (styleCounts.get(k) ?? 0) + weight)
    }
    if (tags?.hookType) {
      const k = tags.hookType.toLowerCase().trim()
      if (k) hookCounts.set(k, (hookCounts.get(k) ?? 0) + weight)
    }
    if (tags?.audienceType) {
      const k = tags.audienceType.toLowerCase().trim()
      if (k) audienceCounts.set(k, (audienceCounts.get(k) ?? 0) + weight)
    }
    if (tags?.contentLength) {
      const k = tags.contentLength.toLowerCase().trim()
      if (k) lengthCounts.set(k, (lengthCounts.get(k) ?? 0) + weight)
    }
  }

  const topHashtags = topN(hashCounts, 10)
  const topKeywords = topN(wordCounts, 12)
  const topAITags = topN(aiTagCounts, 10)
  const dominantFormats = topN(formatCounts, 5)
  const dominantMoods = topN(moodCounts, 4)
  const dominantStyles = topN(styleCounts, 4)
  const dominantHooks = topN(hookCounts, 4)
  const dominantAudiences = topN(audienceCounts, 4)
  const dominantLengths = topN(lengthCounts, 4)

  // Pull author-affinity creators from FeedSignal aggregate; tolerate
  // failure (table may be empty for a brand-new install).
  let affinityCreators: string[] = []
  try {
    affinityCreators = await getAffinityCreators(prisma, companyId, 30, 8)
  } catch {
    affinityCreators = []
  }

  return finalize(
    companyId,
    niche,
    detectedSubNiche,
    country,
    posts.length,
    topHashtags,
    topAITags,
    topKeywords,
    dominantFormats,
    dominantMoods,
    dominantStyles,
    dominantHooks,
    dominantAudiences,
    dominantLengths,
    affinityCreators,
  )
}

function clamp(min: number, max: number, n: number): number {
  return Math.max(min, Math.min(max, n))
}

function finalize(
  companyId: string,
  niche: string,
  detectedSubNiche: string | null,
  country: string | null,
  postsAnalyzed: number,
  topHashtags: string[],
  topAITags: string[],
  topKeywords: string[],
  dominantFormats: string[],
  dominantMoods: string[],
  dominantStyles: string[],
  dominantHooks: string[],
  dominantAudiences: string[],
  dominantLengths: string[],
  affinityCreators: string[],
): FeedContentProfile {
  let strength: ProfileStrength = 'empty'
  if (postsAnalyzed >= 5 && (topHashtags.length + topAITags.length) >= 4) strength = 'rich'
  else if (postsAnalyzed >= 1) strength = 'thin'

  const tokenSet = new Set<string>([
    ...topHashtags.map((h) => h.toLowerCase()),
    ...topAITags.map((t) => t.toLowerCase()),
    ...topKeywords.map((k) => k.toLowerCase()),
    niche,
    ...(detectedSubNiche ? [detectedSubNiche.toLowerCase()] : []),
  ])

  const profile: FeedContentProfile = {
    companyId,
    niche,
    detectedSubNiche,
    country,
    strength,
    postsAnalyzed,
    topHashtags,
    topAITags,
    topKeywords,
    dominantFormats,
    dominantMoods,
    dominantStyles,
    dominantHooks,
    dominantAudiences,
    dominantLengths,
    affinityCreators,
    tokenSet,
    builtAt: Date.now(),
  }
  cache.set(companyId, profile)
  return profile
}

/**
 * Compute relevance overlap between a text blob and a content profile.
 * Returns count of matched tokens (>= 4 chars) found in the haystack.
 */
export function relevanceOverlap(text: string, profile: FeedContentProfile): number {
  if (!text || profile.tokenSet.size === 0) return 0
  const haystack = text.toLowerCase()
  let hits = 0
  for (const tok of profile.tokenSet) {
    if (tok.length < 4) continue
    if (haystack.includes(tok)) hits++
  }
  return hits
}

/**
 * Pick query hashtags for an external IG hashtag fetch.
 * - Rich profile: lead with the user's top hashtags + 2 niche-defaults for breadth.
 * - Thin/empty: fall back entirely to niche defaults so feed never empty.
 */
export function queryHashtagsForProfile(
  profile: FeedContentProfile,
  fallback: string[],
): string[] {
  if (profile.strength === 'rich' && profile.topHashtags.length > 0) {
    return [...profile.topHashtags.slice(0, 5), ...fallback.slice(0, 2)]
  }
  return fallback
}

// ── Sub-niche auto-detection ─────────────────────────────────────────────────

const SUB_NICHE_FROM_TAG: Record<string, string> = {
  travel: 'travel',
  fitness: 'workout',
  workout: 'workout',
  'weight loss': 'weight-loss',
  yoga: 'yoga',
  running: 'running',
  food: 'food',
  recipe: 'food',
  cooking: 'food',
  finance: 'finance',
  investing: 'investing',
  fashion: 'fashion',
  beauty: 'beauty',
  decor: 'home-decor',
  home: 'home-decor',
  parenting: 'parenting',
  business: 'entrepreneurship',
  entrepreneur: 'entrepreneurship',
}

export function detectSubNicheFromProfile(profile: FeedContentProfile): string | null {
  if (profile.topAITags.length === 0) return null
  for (const tag of profile.topAITags) {
    const mapped = SUB_NICHE_FROM_TAG[tag.toLowerCase()]
    if (mapped) return mapped
  }
  return null
}

export async function maybePersistDetectedSubNiche(
  prisma: PrismaClient,
  profile: FeedContentProfile,
): Promise<string | null> {
  const detected = detectSubNicheFromProfile(profile)
  if (!detected || detected === profile.detectedSubNiche) return profile.detectedSubNiche

  await prisma.company.update({
    where: { id: profile.companyId },
    data: { detectedSubNiche: detected },
  })
  invalidateFeedContentProfile(profile.companyId)
  return detected
}
