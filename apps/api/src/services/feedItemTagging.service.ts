/**
 * Feed Item Tagging — on-the-fly mood/style/format tags for IG-trending
 * posts (which have no PlatformPost row, so we can't persist).
 *
 * Reuses the Bedrock Haiku prompt + image pipeline from
 * communityTagging.service.ts. Tags are cached in-memory for 24h keyed by
 * the FeedItem id (already prefixed `ig_${postId}`), so a typical call
 * pattern is: first feed of the hour pays Bedrock cost, subsequent calls
 * within 24h are free.
 *
 * Concurrency: tag in batches of MAX_CONCURRENCY=6 to respect Bedrock
 * account-level throttling. Hard cap on FRESH calls per feed request via
 * MAX_FRESH_PER_REQUEST so a single user can't burn the budget.
 */
import {
  SYSTEM_PROMPT,
  downloadImageAsBase64,
  type CommunityTags,
} from './communityTagging.service'
import { invokeAgent, parseAgentOutput } from './bedrock/bedrock.service'

// ── In-memory cache ─────────────────────────────────────────────────────────

const TAG_CACHE_TTL = 24 * 60 * 60 * 1000 // 24h on success
const FAIL_CACHE_TTL = 60 * 60 * 1000     // 1h on failure (cooldown for bad URLs)

interface CacheEntry {
  tags: CommunityTags | null
  ts: number
  ttl: number
}

const cache = new Map<string, CacheEntry>()

function cacheGet(id: string): CommunityTags | null | undefined {
  const hit = cache.get(id)
  if (!hit) return undefined
  if (Date.now() - hit.ts >= hit.ttl) {
    cache.delete(id)
    return undefined
  }
  return hit.tags
}

function cacheSet(id: string, tags: CommunityTags | null): void {
  cache.set(id, { tags, ts: Date.now(), ttl: tags ? TAG_CACHE_TTL : FAIL_CACHE_TTL })
}

// ── Tagging ─────────────────────────────────────────────────────────────────

interface TaggableFeedItem {
  id: string
  title?: string
  summary?: string
  imageUrl?: string | null
  thumbnail?: string | null
  videoUrl?: string | null
  mediaType?: string
}

/**
 * Tag a single feed item via Bedrock. Caller is responsible for caching
 * (use getOrComputeIgTags below for normal callers).
 */
async function tagFeedItem(
  item: TaggableFeedItem,
  niche: string,
  subNiche: string | null,
): Promise<CommunityTags | null> {
  const contentBlocks: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  > = []

  // Try to attach a thumbnail image. For IG-trending VIDEO posts,
  // thumbnail is null (Meta doesn't expose it on hashtag results). For
  // IMAGE posts, mediaUrl IS the photo URL.
  const imgUrl = item.thumbnail || item.imageUrl || null
  if (imgUrl) {
    const base64 = await downloadImageAsBase64(imgUrl)
    if (base64) {
      contentBlocks.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
      })
    }
  }

  const caption = `${item.title ?? ''} ${item.summary ?? ''}`.slice(0, 500).trim()
  const mediaType = item.mediaType || (item.videoUrl ? 'VIDEO' : 'IMAGE')
  const textPrompt = [
    `Media type: ${mediaType}`,
    `Niche: ${niche}${subNiche ? ' / ' + subNiche : ''}`,
    caption ? `Caption: "${caption}"` : 'No caption provided.',
    'Tag this post.',
  ].join('\n')
  contentBlocks.push({ type: 'text', text: textPrompt })

  // Bedrock account-level concurrency is limited; "Too many requests"
  // errors are common when fanning out. One retry with linear backoff
  // recovers most of them without breaking the per-request budget.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await invokeAgent({
        systemPrompt: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: contentBlocks }],
        maxTokens: 256,
        temperature: 0.2,
      })
      const parsed = parseAgentOutput<Omit<CommunityTags, 'niche' | 'subNiche'>>(raw)
      return {
        ...parsed,
        topic: Array.isArray(parsed.topic) ? parsed.topic.slice(0, 4) : [],
        niche,
        subNiche,
      }
    } catch (err) {
      const msg = (err as Error).message || ''
      const isThrottle = /too many requests|throttl/i.test(msg)
      if (isThrottle && attempt === 0) {
        // Brief jitter, then retry once.
        await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500))
        continue
      }
      console.warn(`[feedItemTagging] failed for ${item.id}: ${msg.slice(0, 100)}`)
      return null
    }
  }
  return null
}

/**
 * Read-through cache for a single item. Hits return immediately; misses
 * call Bedrock once and cache the result.
 */
export async function getOrComputeIgTags(
  item: TaggableFeedItem,
  niche: string,
  subNiche: string | null,
): Promise<CommunityTags | null> {
  const hit = cacheGet(item.id)
  if (hit !== undefined) return hit
  const tags = await tagFeedItem(item, niche, subNiche)
  cacheSet(item.id, tags)
  return tags
}

/**
 * Bulk-tag a list of feed items. Items already in cache return instantly.
 * Fresh calls are dispatched in batches of MAX_CONCURRENCY at a time, up
 * to MAX_FRESH_PER_REQUEST per call. Items beyond the cap return without
 * tags (still pass through the relevance gate on token-overlap alone).
 *
 * Returns: a map of item.id → tags (or null when tagging failed/unavailable).
 * Logs a one-line summary so we can monitor cache-hit ratio + fresh cost.
 */
export async function tagFeedItemsBulk<T extends TaggableFeedItem>(
  items: T[],
  niche: string,
  subNiche: string | null,
  options: { maxFresh?: number; concurrency?: number } = {},
): Promise<Map<string, CommunityTags | null>> {
  const maxFresh = options.maxFresh ?? 30
  // Conservative concurrency — Bedrock account-level limits cause "Too
  // many requests" errors at higher parallelism. 3 in flight + 1.5s
  // retry-with-jitter recovers nearly every throttle without bursting.
  const concurrency = options.concurrency ?? 3
  const result = new Map<string, CommunityTags | null>()

  let cacheHits = 0
  const toFetch: T[] = []
  for (const item of items) {
    const hit = cacheGet(item.id)
    if (hit !== undefined) {
      result.set(item.id, hit)
      cacheHits++
    } else if (toFetch.length < maxFresh) {
      toFetch.push(item)
    }
  }

  // Dispatch fresh items in concurrency-bounded batches
  let freshSuccess = 0
  let freshFail = 0
  for (let i = 0; i < toFetch.length; i += concurrency) {
    const batch = toFetch.slice(i, i + concurrency)
    await Promise.all(
      batch.map(async (item) => {
        const tags = await tagFeedItem(item, niche, subNiche)
        cacheSet(item.id, tags)
        result.set(item.id, tags)
        if (tags) freshSuccess++
        else freshFail++
      }),
    )
  }

  console.log(
    `[feedItemTagging] requested=${items.length} cached=${cacheHits} fresh=${freshSuccess} failed=${freshFail} skipped=${items.length - cacheHits - toFetch.length}`,
  )
  return result
}

/** For tests / diagnostics. */
export function clearIgTagCache(): void {
  cache.clear()
}

export function igTagCacheSize(): number {
  return cache.size
}
