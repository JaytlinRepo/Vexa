/**
 * Redis-backed rate-limit store with in-memory fallback.
 *
 * Two namespaces:
 *   cooldown:{key}       — brief cooldowns per agent (TTL-based SET)
 *   bedrock:{co}:{YYYY-MM} — monthly Bedrock call counters (HASH + HINCRBY)
 *
 * Uses a dedicated IORedis connection with maxRetriesPerRequest:3 so commands
 * fail fast when Redis is down and the caller can fall back to the in-memory
 * store instead of blocking forever (BullMQ connections use null for that).
 *
 * The in-memory fallback is always kept in sync with Redis writes so the
 * app degrades gracefully on Redis outages rather than failing hard.
 */

import IORedis from 'ioredis'
import { attachThrottledErrorHandler } from '../queues/connection'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

let _client: IORedis | null = null

function getClient(): IORedis {
  if (!_client) {
    _client = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      retryStrategy: (times) => Math.min(times * 200, 3000),
      lazyConnect: true,
    })
    attachThrottledErrorHandler(_client)
  }
  return _client
}

// ── In-memory fallback ─────────────────────────────────────────────────────

// key → expires-at ms
const _cooldownExpiry = new Map<string, number>()

interface LocalRecord {
  count: number
  inputTokens: number
  outputTokens: number
  lastCallAt: number
}
// companyId → record (current month only; stale months harmlessly linger)
const _bedrockLocal = new Map<string, LocalRecord>()

// ── Brief Cooldowns ────────────────────────────────────────────────────────

/**
 * Returns remaining cooldown in milliseconds. 0 = no active cooldown.
 */
export async function getCooldown(key: string): Promise<number> {
  try {
    const pttl = await getClient().pttl(`cooldown:${key}`)
    return pttl > 0 ? pttl : 0
  } catch {
    const expiresAt = _cooldownExpiry.get(key) ?? 0
    return Math.max(0, expiresAt - Date.now())
  }
}

/**
 * Removes an active cooldown (e.g., to refund on agent failure).
 */
export async function deleteCooldown(key: string): Promise<void> {
  _cooldownExpiry.delete(key)
  try {
    await getClient().del(`cooldown:${key}`)
  } catch {
    // In-memory fallback already cleared above.
  }
}

/**
 * Sets a cooldown that expires after `ttlMs` milliseconds.
 */
export async function setCooldown(key: string, ttlMs: number): Promise<void> {
  _cooldownExpiry.set(key, Date.now() + ttlMs)
  try {
    await getClient().set(`cooldown:${key}`, '1', 'PX', ttlMs)
  } catch {
    // In-memory fallback already set above.
  }
}

// ── Bedrock Usage Counters ─────────────────────────────────────────────────

export interface BedrockRecord {
  count: number
  inputTokens: number
  outputTokens: number
  lastCallAt: Date
}

function monthBucket(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function bedrockKey(companyId: string): string {
  return `bedrock:${companyId}:${monthBucket()}`
}

export async function trackBedrockCall(
  companyId: string | undefined,
  inputTokens = 0,
  outputTokens = 0,
): Promise<void> {
  if (!companyId) return

  const local = _bedrockLocal.get(companyId) ?? { count: 0, inputTokens: 0, outputTokens: 0, lastCallAt: 0 }
  local.count++
  local.inputTokens += inputTokens
  local.outputTokens += outputTokens
  local.lastCallAt = Date.now()
  _bedrockLocal.set(companyId, local)

  try {
    const key = bedrockKey(companyId)
    const pipe = getClient().pipeline()
    pipe.hincrby(key, 'count', 1)
    pipe.hincrby(key, 'inputTokens', inputTokens)
    pipe.hincrby(key, 'outputTokens', outputTokens)
    pipe.hset(key, 'lastCallAt', String(Date.now()))
    pipe.expire(key, 35 * 24 * 60 * 60) // auto-clean after ~35 days
    await pipe.exec()
  } catch {
    // In-memory fallback already updated.
  }
}

export async function getBedrockUsage(companyId: string): Promise<BedrockRecord> {
  try {
    const data = await getClient().hgetall(bedrockKey(companyId))
    if (data?.count) {
      return {
        count: parseInt(data.count, 10),
        inputTokens: parseInt(data.inputTokens ?? '0', 10),
        outputTokens: parseInt(data.outputTokens ?? '0', 10),
        lastCallAt: data.lastCallAt ? new Date(parseInt(data.lastCallAt, 10)) : new Date(0),
      }
    }
  } catch {
    // Fall through to in-memory.
  }
  const local = _bedrockLocal.get(companyId)
  if (local) return { ...local, lastCallAt: new Date(local.lastCallAt) }
  return { count: 0, inputTokens: 0, outputTokens: 0, lastCallAt: new Date(0) }
}

export async function getAllBedrockUsage(): Promise<Array<{ key: string } & BedrockRecord>> {
  try {
    const keys = await getClient().keys('bedrock:*')
    const results: Array<{ key: string } & BedrockRecord> = []
    for (const key of keys) {
      const data = await getClient().hgetall(key)
      if (data?.count) {
        results.push({
          key,
          count: parseInt(data.count, 10),
          inputTokens: parseInt(data.inputTokens ?? '0', 10),
          outputTokens: parseInt(data.outputTokens ?? '0', 10),
          lastCallAt: data.lastCallAt ? new Date(parseInt(data.lastCallAt, 10)) : new Date(0),
        })
      }
    }
    return results
  } catch {
    return [..._bedrockLocal.entries()].map(([companyId, r]) => ({
      key: bedrockKey(companyId),
      ...r,
      lastCallAt: new Date(r.lastCallAt),
    }))
  }
}

export function estimateCost(record: BedrockRecord): number {
  return (record.inputTokens / 1_000_000) * 0.25 + (record.outputTokens / 1_000_000) * 1.25
}
