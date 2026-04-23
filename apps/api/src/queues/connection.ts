/**
 * BullMQ Redis Connection Factory
 *
 * Separate from cache.service.ts because BullMQ requires
 * maxRetriesPerRequest: null (cache uses 3).
 */

import IORedis from 'ioredis'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

export function createRedisConnection(): IORedis {
  return new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null, // BullMQ requirement
    enableReadyCheck: false,
    retryStrategy: (times) => Math.min(times * 200, 5000),
  })
}
