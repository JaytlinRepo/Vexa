/**
 * SSE Bridge: Redis Pub/Sub → Express SSE
 *
 * Workers publish video processing progress to Redis.
 * This bridge subscribes and relays to connected SSE clients.
 */

import IORedis from 'ioredis'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const CHANNEL = 'sovexa:video-progress'

let subscriber: IORedis | null = null

type BroadcastFn = (event: string, data: unknown) => void

export function initSSEBridge(broadcastFn: BroadcastFn): void {
  if (subscriber) return

  subscriber = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  })

  subscriber.subscribe(CHANNEL, (err) => {
    if (err) {
      console.error('[sse-bridge] failed to subscribe:', err.message)
      return
    }
    console.log('[sse-bridge] listening for video progress events')
  })

  subscriber.on('message', (_channel: string, message: string) => {
    try {
      const { event, data } = JSON.parse(message)
      broadcastFn(event, data)
    } catch {}
  })
}

export function closeSSEBridge(): void {
  subscriber?.disconnect()
  subscriber = null
}
