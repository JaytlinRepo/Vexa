/**
 * Video Processing Worker
 *
 * Processes uploaded videos through the full pipeline:
 * FFprobe → Transcribe → Scene Detection → Keyframes → Riley → FFmpeg → Alex
 *
 * Publishes progress to Redis Pub/Sub so the Express SSE bridge
 * can relay events to connected clients.
 */

import { Worker, Job } from 'bullmq'
import IORedis from 'ioredis'
import { createRedisConnection } from '../queues/connection'
import type { VideoProcessingJobData } from '../queues/types'
import prisma from '../lib/prisma'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

export function createVideoProcessingWorker(): Worker {
  const connection = createRedisConnection()

  const worker = new Worker<VideoProcessingJobData>(
    'video-processing',
    async (job: Job<VideoProcessingJobData>) => {
      const { uploadId, videoUrl, userId } = job.data
      const pubClient = new IORedis(REDIS_URL)

      try {
        console.log(`[worker:video] processing ${uploadId}`)

        // Dynamic import to avoid loading heavy FFmpeg deps at worker startup
        const { processVideo, setBroadcastFn } = await import('../lib/videoProcessing.service')

        // Override broadcast to publish to Redis instead of in-process SSE
        setBroadcastFn((event: string, data: unknown) => {
          pubClient.publish('sovexa:video-progress', JSON.stringify({ event, data, uploadId }))
          // Also update BullMQ job progress
          const progress = (data as { progress?: number })?.progress
          if (progress != null) job.updateProgress(progress)
        })

        await processVideo(uploadId, videoUrl, userId)

        console.log(`[worker:video] completed ${uploadId} in ${((Date.now() - job.timestamp) / 1000).toFixed(1)}s`)
      } finally {
        await pubClient.quit()
      }
    },
    {
      connection,
      concurrency: 2,
      limiter: undefined, // no rate limit — naturally limited by compute
    },
  )

  worker.on('failed', (job, err) => {
    console.error(`[worker:video] FAILED ${job?.data.uploadId}: ${err.message}`)
  })

  console.log('[worker:video] started (concurrency: 2)')
  return worker
}
