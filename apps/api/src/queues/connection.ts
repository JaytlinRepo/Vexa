/**
 * BullMQ Redis Connection Factory
 *
 * Separate from cache.service.ts because BullMQ requires
 * maxRetriesPerRequest: null (cache uses 3).
 *
 * Also exports `isRedisHealthy()` for HTTP routes that need to decide
 * whether to enqueue (Redis up) or fall back to inline processing (Redis
 * down). The route-level decision has to be deterministic because
 * `queue.add()` does NOT reject when Redis is down — BullMQ buffers the
 * job in memory and retries forever, so try/catch around add() never fires.
 */

import IORedis from 'ioredis'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

// Throttle the ECONNREFUSED log spam — when Redis isn't running we'd otherwise
// fill stderr with a wall of stack traces (multiple per second per connection),
// drowning out everything else. Log first occurrence per error class, then
// suppress for LOG_THROTTLE_MS.
const LOG_THROTTLE_MS = 60_000
const lastLoggedAt = new Map<string, number>()
function shouldLog(key: string): boolean {
  const now = Date.now()
  const last = lastLoggedAt.get(key) ?? 0
  if (now - last < LOG_THROTTLE_MS) return false
  lastLoggedAt.set(key, now)
  return true
}

/**
 * Attach the throttled error handler to an IORedis instance. Used both for
 * connections we create and for connections BullMQ duplicates internally
 * (BullMQ calls `.duplicate()` on the supplied connection for blocking
 * commands; those clones don't inherit our handler unless we patch them).
 *
 * Exported so other ioredis instantiation sites (sse-bridge, cache.service)
 * can share the same throttling and avoid stderr floods.
 */
export function attachThrottledErrorHandler(conn: IORedis): void {
  conn.on('error', (err: Error) => {
    const msg = err?.message || 'unknown'
    const bucket = msg.includes('ECONNREFUSED') ? 'ECONNREFUSED'
      : msg.includes('ETIMEDOUT') ? 'ETIMEDOUT'
      : msg.includes('NR_CLOSED') || msg.includes('Connection is closed') ? 'CLOSED'
      : 'OTHER'
    if (shouldLog(`redis:${bucket}`)) {
      console.warn(`[ioredis] connection error (${bucket}) — ${msg}. Suppressing same-class errors for ${LOG_THROTTLE_MS / 1000}s.`)
    }
  })
}

export function createRedisConnection(): IORedis {
  const conn = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null, // BullMQ requirement
    enableReadyCheck: false,
    retryStrategy: (times) => Math.min(times * 200, 5000),
  })

  attachThrottledErrorHandler(conn)

  // BullMQ calls connection.duplicate() to create blocking-command clones.
  // The clone is a fresh IORedis instance without our 'error' listener, so
  // ioredis falls back to its default "[ioredis] Unhandled error event"
  // logger and we get a wall of stack traces. Patch duplicate() to attach
  // the handler before returning.
  const origDuplicate = conn.duplicate.bind(conn)
  ;(conn as unknown as { duplicate: typeof origDuplicate }).duplicate = ((override?: object) => {
    const dup = origDuplicate(override)
    attachThrottledErrorHandler(dup)
    return dup
  }) as typeof origDuplicate

  return conn
}

/**
 * Quick liveness check — does Redis respond to PING within `probeTimeoutMs`?
 *
 * Result is cached for HEALTH_CACHE_MS so a request-burst doesn't slam Redis
 * (and so we don't add ~1s of latency to every request when Redis is down).
 *
 * Returns true only if PING returned PONG. Anything else (ECONNREFUSED,
 * timeout, garbage response) returns false. Errors are swallowed silently
 * because the throttled connection-error handler already logged.
 */
const HEALTH_CACHE_MS = 5_000
let healthCache: { ok: boolean; at: number } | null = null
let healthCheckInflight: Promise<boolean> | null = null

export async function isRedisHealthy(probeTimeoutMs = 1000): Promise<boolean> {
  const now = Date.now()
  if (healthCache && now - healthCache.at < HEALTH_CACHE_MS) return healthCache.ok
  if (healthCheckInflight) return healthCheckInflight

  healthCheckInflight = (async () => {
    let probe: IORedis | null = null
    try {
      probe = new IORedis(REDIS_URL, {
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
        connectTimeout: probeTimeoutMs,
        commandTimeout: probeTimeoutMs,
        lazyConnect: true,
        retryStrategy: () => null, // single-shot, no retries
      })
      // Don't let probe errors hit the throttled logger — those would
      // overwrite the legitimate connection's last-logged timestamp and
      // mask real outages.
      probe.on('error', () => {})
      const result = await Promise.race([
        probe.connect().then(() => probe!.ping()),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('redis-ping-timeout')), probeTimeoutMs + 200),
        ),
      ])
      const ok = result === 'PONG'
      healthCache = { ok, at: Date.now() }
      return ok
    } catch {
      healthCache = { ok: false, at: Date.now() }
      return false
    } finally {
      try { probe?.disconnect() } catch {}
      healthCheckInflight = null
    }
  })()

  return healthCheckInflight
}

/** For tests / explicit reconnection: invalidate the cached health verdict. */
export function _resetRedisHealthCache(): void {
  healthCache = null
}
