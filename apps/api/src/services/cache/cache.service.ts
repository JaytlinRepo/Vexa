/**
 * Cache Service — Redis via ioredis
 *
 * On AWS: Use ElastiCache (Redis) — cache.t3.micro is ~$13/mo
 * Locally: Docker Redis or Upstash (free tier for dev)
 *
 * Why this matters:
 * - Trend data doesn't change minute-to-minute — cache for 6hrs
 * - RSS feeds update hourly — cache for 2hrs
 * - Brand memory reads happen on every agent call — cache for 30min
 * - Without caching, every task hits 5+ external APIs = slow + expensive
 *
 * Install: npm install ioredis
 */

import Redis from 'ioredis'

// ─── CONNECTION ───────────────────────────────────────────────────────────────

let redisClient: Redis | null = null

export function getRedisClient(): Redis {
  if (!redisClient) {
    const url = process.env.REDIS_URL || 'redis://localhost:6379'

    redisClient = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) return null // stop retrying
        return Math.min(times * 200, 2000)
      },
      lazyConnect: true,
    })

    redisClient.on('error', (err) => {
      console.error('Redis connection error:', err.message)
    })

    redisClient.on('connect', () => {
      console.log('Redis connected')
    })
  }

  return redisClient
}

// ─── TTL CONSTANTS ────────────────────────────────────────────────────────────

export const TTL = {
  TREND_DATA:        6 * 60 * 60,       // 6 hours  — trend data
  RSS_FEEDS:         2 * 60 * 60,       // 2 hours  — RSS articles
  REDDIT_DATA:       3 * 60 * 60,       // 3 hours  — Reddit posts
  YOUTUBE_DATA:      6 * 60 * 60,       // 6 hours  — YouTube trending
  NEWS_DATA:         4 * 60 * 60,       // 4 hours  — NewsAPI results
  BRAND_MEMORY:      30 * 60,           // 30 mins  — brand memory summary
  NICHE_CONTEXT:     12 * 60 * 60,      // 12 hours — RAG niche knowledge
  USER_SESSION:      24 * 60 * 60,      // 24 hours — user session data
  AGENT_OUTPUT:      60 * 60,           // 1 hour   — recent agent outputs
  RATE_LIMIT:        60,                // 1 minute — rate limit windows
} as const

// ─── KEY BUILDERS ─────────────────────────────────────────────────────────────

export const CacheKey = {
  trendData:     (niche: string) => `trends:${niche}`,
  rssFeeds:      (niche: string) => `rss:${niche}`,
  redditData:    (niche: string) => `reddit:${niche}`,
  youtubeData:   (niche: string) => `youtube:${niche}`,
  newsData:      (niche: string) => `news:${niche}`,
  brandMemory:   (companyId: string) => `memory:${companyId}`,
  nicheContext:  (niche: string) => `rag:${niche}`,
  mayaContext:   (companyId: string) => `maya-ctx:${companyId}`,
  agentOutput:   (taskId: string) => `output:${taskId}`,
  rateLimit:     (userId: string, action: string) => `rl:${userId}:${action}`,
  feedItems:     (companyId: string) => `feed:${companyId}`,
  userSession:   (userId: string) => `session:${userId}`,
}

// ─── CORE CACHE OPS ───────────────────────────────────────────────────────────

/**
 * Get a cached value. Returns null if not found or on error.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const client = getRedisClient()
    const value = await client.get(key)
    if (!value) return null
    return JSON.parse(value) as T
  } catch (err) {
    console.warn(`Cache GET failed for key "${key}":`, (err as Error).message)
    return null // fail open — never block on cache miss
  }
}

/**
 * Set a cached value with TTL in seconds.
 */
export async function cacheSet<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  try {
    const client = getRedisClient()
    await client.setex(key, ttlSeconds, JSON.stringify(value))
  } catch (err) {
    console.warn(`Cache SET failed for key "${key}":`, (err as Error).message)
    // fail silently — cache is non-critical
  }
}

/**
 * Delete a cached value.
 */
export async function cacheDel(key: string): Promise<void> {
  try {
    const client = getRedisClient()
    await client.del(key)
  } catch (err) {
    console.warn(`Cache DEL failed for key "${key}":`, (err as Error).message)
  }
}

/**
 * Delete all keys matching a pattern.
 * Use when brand memory or niche changes.
 */
export async function cacheDelPattern(pattern: string): Promise<void> {
  try {
    const client = getRedisClient()
    const keys = await client.keys(pattern)
    if (keys.length > 0) {
      await client.del(...keys)
    }
  } catch (err) {
    console.warn(`Cache DEL pattern failed for "${pattern}":`, (err as Error).message)
  }
}

// ─── CACHE-ASIDE HELPER ───────────────────────────────────────────────────────

/**
 * The main pattern: check cache first, fetch from source if miss, store result.
 *
 * Usage:
 *   const data = await withCache(
 *     CacheKey.trendData('fitness'),
 *     TTL.TREND_DATA,
 *     () => fetchRealTrendData('fitness')
 *   )
 */
export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  fetchFn: () => Promise<T>
): Promise<T> {
  // Try cache first
  const cached = await cacheGet<T>(key)
  if (cached !== null) {
    console.log(`Cache HIT: ${key}`)
    return cached
  }

  console.log(`Cache MISS: ${key} — fetching fresh`)

  // Fetch fresh data
  const fresh = await fetchFn()

  // Store in cache (don't await — fire and forget)
  cacheSet(key, fresh, ttlSeconds).catch(() => {})

  return fresh
}

// ─── RATE LIMITER ─────────────────────────────────────────────────────────────

/**
 * Simple token bucket rate limiter using Redis.
 *
 * Returns true if the action is allowed, false if rate limited.
 * Limits are per user per action per minute.
 */
export async function checkRateLimit(
  userId: string,
  action: string,
  maxPerMinute: number
): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
  const key = CacheKey.rateLimit(userId, action)

  try {
    const client = getRedisClient()

    // Increment counter and set expiry atomically
    const pipeline = client.pipeline()
    pipeline.incr(key)
    pipeline.ttl(key)
    const results = await pipeline.exec()

    const count = (results?.[0]?.[1] as number) || 1
    const ttl = (results?.[1]?.[1] as number) || -1

    // Set expiry only on first request
    if (ttl === -1) {
      await client.expire(key, TTL.RATE_LIMIT)
    }

    const allowed = count <= maxPerMinute
    const remaining = Math.max(0, maxPerMinute - count)

    return {
      allowed,
      remaining,
      resetIn: ttl === -1 ? TTL.RATE_LIMIT : ttl,
    }
  } catch {
    // If Redis is down, allow the request — never block on cache failure
    return { allowed: true, remaining: maxPerMinute, resetIn: 60 }
  }
}

// ─── PLAN-BASED RATE LIMITS ───────────────────────────────────────────────────

export const RATE_LIMITS = {
  starter: {
    tasksPerHour:    5,
    meetingsPerDay:  0,   // not on starter
    apiCallsPerMin:  10,
  },
  pro: {
    tasksPerHour:    20,
    meetingsPerDay:  10,
    apiCallsPerMin:  30,
  },
  agency: {
    tasksPerHour:    60,
    meetingsPerDay:  50,
    apiCallsPerMin:  60,
  },
} as const

// ─── CACHE INVALIDATION ───────────────────────────────────────────────────────

/**
 * Invalidate all company-specific cache when:
 * - User changes niche
 * - User updates brand voice
 * - User changes plan
 */
export async function invalidateCompanyCache(companyId: string, niche: string): Promise<void> {
  await Promise.all([
    cacheDel(CacheKey.brandMemory(companyId)),
    cacheDel(CacheKey.mayaContext(companyId)),
    cacheDel(CacheKey.feedItems(companyId)),
    cacheDelPattern(`output:*`), // clear recent outputs
    // Don't invalidate niche/trend data — shared across all users of that niche
  ])
  console.log(`Cache invalidated for company ${companyId} (niche: ${niche})`)
}

/**
 * Invalidate niche-level cache when trend data is stale.
 * Called by a scheduled job every 6 hours.
 */
export async function invalidateNicheCache(niche: string): Promise<void> {
  await Promise.all([
    cacheDel(CacheKey.trendData(niche)),
    cacheDel(CacheKey.rssFeeds(niche)),
    cacheDel(CacheKey.redditData(niche)),
    cacheDel(CacheKey.youtubeData(niche)),
    cacheDel(CacheKey.newsData(niche)),
  ])
  console.log(`Niche cache invalidated: ${niche}`)
}

// ─── CACHE WARMING ────────────────────────────────────────────────────────────

/**
 * Pre-warm cache for all active niches.
 * Run this on a schedule (e.g. every 6 hours via EventBridge).
 * Prevents cold-start latency for the first user in a niche each day.
 */
export async function warmNicheCache(
  niches: string[],
  fetchFn: (niche: string) => Promise<unknown>
): Promise<void> {
  console.log(`Warming cache for ${niches.length} niches`)

  for (const niche of niches) {
    try {
      const data = await fetchFn(niche)
      await cacheSet(CacheKey.trendData(niche), data, TTL.TREND_DATA)
      await sleep(1000) // be kind to external APIs
    } catch (err) {
      console.warn(`Cache warm failed for ${niche}:`, (err as Error).message)
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
