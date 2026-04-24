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
        const isCompilation = job.name === 'compilation'

        if (isCompilation) {
          console.log(`[worker:video] compilation ${uploadId} — joining videos then editing`)
          const { processCompilation } = await import('../lib/videoCompilation.service')
          await processCompilation(prisma, uploadId)
          console.log(`[worker:video] compilation done ${uploadId}`)
        } else {
          console.log(`[worker:video] single video ${uploadId}`)
          const VideoProcessingService = (await import('../lib/videoProcessing.service')).default
          const { setBroadcastFn } = await import('../lib/videoProcessing.service')

          setBroadcastFn((event: string, data: unknown) => {
            pubClient.publish('sovexa:video-progress', JSON.stringify({ event, data, uploadId }))
            const progress = (data as { progress?: number })?.progress
            if (progress != null) job.updateProgress(progress)
          })

          const svc = new VideoProcessingService(prisma)
          await svc.processVideo(uploadId, videoUrl, userId)
          console.log(`[worker:video] done ${uploadId} in ${((Date.now() - job.timestamp) / 1000).toFixed(1)}s`)
        }
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
