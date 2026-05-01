/**
 * Feed Embedding Service
 *
 * Orchestrates Titan Embed vectors for the Knowledge feed:
 *   - Profile vectors per Company (persisted, refreshed every 7 days)
 *   - Item vectors per FeedItem (community items persist on PlatformPost;
 *     IG-trending items live in a 24h in-memory cache)
 *   - Cosine similarity for ranking
 *
 * Reuses `invokeTitanEmbed` from bedrock.service.ts. Mirrors the
 * concurrency-bounded bulk pattern from feedItemTagging.service.ts.
 *
 * Failure mode: `null` returns are silently passed up. The relevance
 * scorer treats null vectors as a 0 contribution, so the feed still
 * ranks via token + tag signals when embedding is unavailable.
 */
import { PrismaClient } from '@prisma/client'
import { invokeTitanEmbed } from './bedrock/bedrock.service'
import type { FeedContentProfile } from './feedContentProfile.service'
import type { CommunityTags } from './communityTagging.service'

// ── Cosine similarity ──────────────────────────────────────────────────────

/** Cosine of two vectors. Returns 0 when either is empty/mismatched. */
export function cosine(a: number[] | null | undefined, b: number[] | null | undefined): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  if (magA === 0 || magB === 0) return 0
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}

// ── In-memory cache (IG-trending items only) ───────────────────────────────

const ITEM_CACHE_TTL = 24 * 60 * 60 * 1000 // 24h
const ITEM_FAIL_TTL = 60 * 60 * 1000 // 1h cooldown on failure

interface CacheEntry { embedding: number[] | null; ts: number; ttl: number }
const itemCache = new Map<string, CacheEntry>()

function itemCacheGet(id: string): number[] | null | undefined {
  const hit = itemCache.get(id)
  if (!hit) return undefined
  if (Date.now() - hit.ts >= hit.ttl) { itemCache.delete(id); return undefined }
  return hit.embedding
}

function itemCacheSet(id: string, embedding: number[] | null): void {
  itemCache.set(id, {
    embedding,
    ts: Date.now(),
    ttl: embedding ? ITEM_CACHE_TTL : ITEM_FAIL_TTL,
  })
}

export function clearItemEmbeddingCache(): void { itemCache.clear() }
export function itemEmbeddingCacheSize(): number { return itemCache.size }

// ── Profile cache (in-memory mirror of DB row) ─────────────────────────────

const PROFILE_CACHE_TTL = 60 * 60 * 1000 // 1h — matches FeedContentProfile cache
const PROFILE_REFRESH_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days persisted

interface ProfileCacheEntry { embedding: number[] | null; ts: number }
const profileCache = new Map<string, ProfileCacheEntry>()

export function invalidateProfileEmbedding(companyId: string): void {
  profileCache.delete(companyId)
}

// ── Profile embedding ──────────────────────────────────────────────────────

/**
 * Build the profile text used for embedding.
 *
 * Titan Embed performs MUCH better on natural-language sentences than on
 * a token salad. Same fingerprint inputs (hashtags, AI tags, moods,
 * styles, formats, hooks, audiences) but composed into a paragraph so
 * the embedding captures the relationships between them, not just bag-
 * of-words frequency.
 *
 * Empirically (baseline diagnostic): token-salad yields avg cosine 0.21
 * against IG hashtag content; the paragraph form below targets 0.4+.
 */
function buildProfileText(profile: FeedContentProfile): string {
  const sub = profile.detectedSubNiche ? `${profile.detectedSubNiche} ` : ''
  const topics = profile.topAITags.slice(0, 5).join(', ') || profile.niche
  const tags = profile.topHashtags.slice(0, 6).map((h) => '#' + h).join(' ')
  const keywords = profile.topKeywords.slice(0, 6).join(', ')

  const moods = profile.dominantMoods.slice(0, 3).join(' and ') || 'natural'
  const styles = profile.dominantStyles.slice(0, 3).join(', ') || 'natural'
  const formats = profile.dominantFormats.slice(0, 2).join(' and ') || 'short-form video'
  const hooks = profile.dominantHooks.slice(0, 2).join(' and ') || 'personal-story'
  const audiences = profile.dominantAudiences.slice(0, 2).join(' and ') || 'general'

  // A short, natural-language description anchored on what makes this
  // creator distinctive.
  return [
    `A ${sub}${profile.niche} content creator.`,
    `Their content is mostly about ${topics}.`,
    keywords ? `Common themes include: ${keywords}.` : '',
    `They make ${formats} with a ${moods} mood.`,
    `Visual style is ${styles}.`,
    `Hooks lean ${hooks}.`,
    `Audience is ${audiences}.`,
    tags ? `Frequent hashtags: ${tags}.` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * Returns the user's profile embedding, computing if missing/stale.
 * Persisted on Company.profileEmbedding so a process restart doesn't
 * re-bill us for the same vector. In-memory cached for the hour to
 * skip the DB roundtrip on every feed call.
 */
export async function getOrComputeProfileEmbedding(
  prisma: PrismaClient,
  companyId: string,
  profile: FeedContentProfile,
): Promise<number[] | null> {
  // Process-level cache first
  const cached = profileCache.get(companyId)
  if (cached && Date.now() - cached.ts < PROFILE_CACHE_TTL) return cached.embedding

  // DB cache next
  const row = await prisma.company.findUnique({
    where: { id: companyId },
    select: { profileEmbedding: true, profileEmbeddingAt: true },
  })
  const persisted = (row?.profileEmbedding as unknown as number[] | null) ?? null
  const persistedAge = row?.profileEmbeddingAt
    ? Date.now() - row.profileEmbeddingAt.getTime()
    : Infinity
  if (persisted && persisted.length > 0 && persistedAge < PROFILE_REFRESH_AGE_MS) {
    profileCache.set(companyId, { embedding: persisted, ts: Date.now() })
    return persisted
  }

  // Cold path — call Titan
  const text = buildProfileText(profile)
  if (text.length < 10) {
    profileCache.set(companyId, { embedding: null, ts: Date.now() })
    return null
  }
  const fresh = await invokeTitanEmbed(text, companyId)
  if (fresh) {
    await prisma.company.update({
      where: { id: companyId },
      data: { profileEmbedding: fresh as never, profileEmbeddingAt: new Date() },
    }).catch((err) => {
      console.warn('[feedEmbedding] persist profile failed:', (err as Error).message)
    })
  }
  profileCache.set(companyId, { embedding: fresh, ts: Date.now() })
  return fresh
}

// ── Item embedding ─────────────────────────────────────────────────────────

interface EmbeddableItem {
  id: string
  title?: string
  summary?: string
  tags?: CommunityTags | null
}

function buildItemText(item: EmbeddableItem): string {
  const parts: string[] = []
  // Natural prose first — caption is the strongest signal.
  if (item.title) parts.push(item.title)
  if (item.summary && item.summary !== item.title) parts.push(item.summary)
  const t = item.tags
  // Compose the categorical tags as a sentence so they share the same
  // representational space as the profile-embedding text.
  if (t) {
    const descriptor: string[] = []
    if (t.format) descriptor.push(t.format)
    if (t.mood) descriptor.push(`${t.mood} in mood`)
    if (t.visualStyle) descriptor.push(`${t.visualStyle} visually`)
    if (t.hookType) descriptor.push(`${t.hookType} hook`)
    if (t.audienceType) descriptor.push(`for ${t.audienceType}`)
    if (descriptor.length) parts.push(`A ${descriptor.join(', ')}.`)
    if (t.topic && t.topic.length > 0) parts.push(`About ${t.topic.slice(0, 4).join(', ')}.`)
  }
  return parts.join(' ').slice(0, 2000)
}

/**
 * Get-or-compute one item's embedding. Community items hit the DB
 * (PlatformPost.topicEmbedding); IG-trending items hit the in-memory
 * cache. Caller is responsible for choosing items worth embedding —
 * this just returns null when text is too thin.
 */
async function computeItemEmbeddingNoCache(
  item: EmbeddableItem,
  companyIdForUsage?: string,
): Promise<number[] | null> {
  const text = buildItemText(item)
  if (text.length < 10) return null
  return invokeTitanEmbed(text, companyIdForUsage)
}

/**
 * Bulk-embed items with concurrency cap. Mirrors the API of
 * feedItemTagging.tagFeedItemsBulk so the feed route can use either
 * symmetrically.
 *
 * Reads:
 *   - Community items (`id` starts with `community_`): try
 *     PlatformPost.topicEmbedding first; fall through to fresh embed.
 *   - IG-trending (`id` starts with `ig_`): in-memory cache only.
 *
 * Writes:
 *   - Community items: persist to PlatformPost on success.
 *   - IG-trending: cache 24h.
 */
export async function embedItemsBulk(
  prisma: PrismaClient,
  items: EmbeddableItem[],
  options: { maxFresh?: number; concurrency?: number; companyId?: string } = {},
): Promise<Map<string, number[] | null>> {
  const maxFresh = options.maxFresh ?? 100
  // Titan is much less throttled than Haiku — 8 in-flight is comfortable.
  const concurrency = options.concurrency ?? 8
  const out = new Map<string, number[] | null>()

  // Pull community persisted vectors in one go to avoid N+1
  const communityIds = items
    .filter((i) => i.id.startsWith('community_'))
    .map((i) => i.id.replace(/^community_/, ''))
  const communityRows = communityIds.length > 0
    ? await prisma.platformPost.findMany({
        where: { id: { in: communityIds } },
        select: { id: true, topicEmbedding: true, topicEmbeddingAt: true },
      })
    : []
  const communityMap = new Map(
    communityRows.map((r) => [
      'community_' + r.id,
      (r.topicEmbedding as unknown as number[] | null) ?? null,
    ]),
  )

  let cacheHits = 0
  const toFetch: Array<{ item: EmbeddableItem; persistTo: 'community' | 'cache' }> = []

  for (const item of items) {
    if (item.id.startsWith('ig_')) {
      const hit = itemCacheGet(item.id)
      if (hit !== undefined) { out.set(item.id, hit); cacheHits++; continue }
      if (toFetch.length < maxFresh) toFetch.push({ item, persistTo: 'cache' })
    } else if (item.id.startsWith('community_')) {
      const persisted = communityMap.get(item.id)
      if (persisted && persisted.length > 0) { out.set(item.id, persisted); cacheHits++; continue }
      if (toFetch.length < maxFresh) toFetch.push({ item, persistTo: 'community' })
    } else {
      // Unknown source — embed but only cache in memory
      const hit = itemCacheGet(item.id)
      if (hit !== undefined) { out.set(item.id, hit); cacheHits++; continue }
      if (toFetch.length < maxFresh) toFetch.push({ item, persistTo: 'cache' })
    }
  }

  let freshSuccess = 0
  let freshFail = 0
  for (let i = 0; i < toFetch.length; i += concurrency) {
    const batch = toFetch.slice(i, i + concurrency)
    await Promise.all(
      batch.map(async ({ item, persistTo }) => {
        const vec = await computeItemEmbeddingNoCache(item, options.companyId)
        out.set(item.id, vec)
        if (vec) freshSuccess++; else freshFail++

        if (persistTo === 'community' && vec) {
          const platformPostId = item.id.replace(/^community_/, '')
          prisma.platformPost.update({
            where: { id: platformPostId },
            data: { topicEmbedding: vec as never, topicEmbeddingAt: new Date() },
          }).catch(() => { /* best-effort */ })
        } else if (persistTo === 'cache') {
          itemCacheSet(item.id, vec)
        }
      }),
    )
  }

  console.log(
    `[feedEmbedding] requested=${items.length} cached=${cacheHits} fresh=${freshSuccess} failed=${freshFail} skipped=${items.length - cacheHits - toFetch.length}`,
  )
  return out
}
