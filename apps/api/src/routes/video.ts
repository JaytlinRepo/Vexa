/**
 * Video Processing Routes
 *
 * POST /api/video/upload            — Upload video for processing
 * GET  /api/video/metrics           — Get aggregated metrics
 * GET  /api/video/stream            — SSE stream for processing events
 */

import { Router, Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import VideoProcessingService from '../lib/videoProcessing.service'
import { uploadFile, buildUploadKey, getPresignedUrl, deleteFile } from '../services/storage/s3.service'
import { assertStudioEditQuota } from '../lib/usage'
import multer from 'multer'

const router = Router()
let prisma: PrismaClient
let processingService: VideoProcessingService

// Store SSE clients for broadcasting
const sseClients = new Map<string, Response>()

export function initVideoRoutes(_prisma: PrismaClient) {
  prisma = _prisma
  processingService = new VideoProcessingService(prisma)

  // ── Upload Video ───────────────────────────────────────────────────────────

  // Accept both 'video' (single) and 'videos' (batch) field names.
  // 500MB ceiling keeps the process from OOM-ing on huge files buffered in memory.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 500 * 1024 * 1024 },
  })

  /**
   * POST /api/video/upload
   * Upload video for processing (accepts field name 'video' or 'videos')
   */
  router.post('/upload', requireAuth, upload.any(), async (req: Request, res: Response) => {
    try {
      const { userId } = (req as AuthedRequest).session
      const { companyId } = req.body

      if (!companyId) {
        return res.status(400).json({ error: 'companyId required' })
      }

      // Verify company ownership
      const company = await prisma.company.findFirst({
        where: { id: companyId, userId }
      })

      if (!company) {
        return res.status(403).json({ error: 'Company not found' })
      }

      try {
        await assertStudioEditQuota(prisma, userId)
      } catch (err) {
        const e = err as Error & { code?: string; usage?: unknown }
        if (e.code === 'studio_limit_exceeded') {
          return res.status(402).json({ error: 'studio_limit_exceeded', usage: e.usage })
        }
        throw err
      }

      const file = (req as any).files?.[0] || (req as any).file
      if (!file) {
        return res.status(400).json({ error: 'No video file provided' })
      }

      // Upload to S3 first, then create the DB record.
      // If the DB create fails, clean up the orphaned S3 object.
      const s3Key = buildUploadKey(companyId, file.originalname)
      await uploadFile({
        key: s3Key,
        body: file.buffer,
        contentType: file.mimetype,
      })
      const videoUrl = await getPresignedUrl(s3Key, 86400) // 24h URL for processing

      let videoUpload: Awaited<ReturnType<typeof prisma.videoUpload.create>>
      try {
        videoUpload = await prisma.videoUpload.create({
          data: {
            companyId,
            sourceVideoUrl: videoUrl,
            fileName: file.originalname
          }
        })
      } catch (dbErr) {
        // DB create failed — remove the S3 object so it doesn't become an orphan
        await deleteFile(s3Key).catch(e => console.error('[video] Failed to clean up orphaned S3 object:', e))
        throw dbErr
      }

      console.log(`[video] Upload created: ${videoUpload.id}`)

      // Return immediately
      res.json({
        uploadId: videoUpload.id,
        status: 'processing',
        message: 'Video processing started'
      })

      // Enqueue for background processing with retry support.
      // Falls back to in-process if Redis/queue is unavailable (dev without Redis).
      try {
        const { videoQueue } = await import('../queues')
        await videoQueue.add('single', {
          uploadId: videoUpload.id,
          videoUrl,
          userId,
          companyId,
          s3Key,
        })
        console.log(`[video] Enqueued upload ${videoUpload.id} for processing`)
      } catch (queueErr) {
        console.warn(`[video] Queue unavailable, processing in-process (no retry): ${queueErr}`)
        processingService.processVideo(videoUpload.id, videoUrl, userId).catch(err => {
          console.error(`[video] Background processing failed:`, err)
        })
      }
    } catch (err) {
      console.error('[video] Upload failed:', err)
      res.status(500).json({ error: 'Upload failed' })
    }
  })

  // ── Metrics Dashboard ──────────────────────────────────────────────────────

  /**
   * GET /api/video/metrics
   * Get aggregated processing metrics
   */
  router.get('/metrics', requireAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as AuthedRequest).session
      const { companyId } = req.query

      if (!companyId) {
        return res.status(400).json({ error: 'companyId required' })
      }

      // Verify access
      const company = await prisma.company.findFirst({
        where: { id: companyId as string, userId }
      })

      if (!company) {
        return res.status(403).json({ error: 'Company not found' })
      }

      const metricsService = new (require('../lib/videoMetrics.service').VideoMetricsService)(
        prisma
      )
      const metrics = await metricsService.getAggregatedMetrics(companyId as string)

      res.json(metrics)
    } catch (err) {
      console.error('[video] Metrics fetch failed:', err)
      res.status(500).json({ error: 'Failed to fetch metrics' })
    }
  })

  // ── SSE Stream for Real-time Updates ───────────────────────────────────────

  /**
   * GET /api/video/stream
   * Server-sent events for processing updates
   */
  router.get('/stream', requireAuth, (req: Request, res: Response) => {
    try {
      const { userId } = (req as AuthedRequest).session

      // Setup SSE
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')

      const clientId = `${userId}_${Date.now()}`
      sseClients.set(clientId, res)

      console.log(`[video] SSE client connected: ${clientId}`)

      // Cleanup on disconnect
      req.on('close', () => {
        sseClients.delete(clientId)
        console.log(`[video] SSE client disconnected: ${clientId}`)
      })

      // Keep connection alive. On write error the client already disconnected;
      // clear the interval so the timer doesn't accumulate on a stale entry.
      const heartbeat = setInterval(() => {
        try {
          res.write(': heartbeat\n\n')
        } catch {
          sseClients.delete(clientId)
          clearInterval(heartbeat)
        }
      }, 30000)

      req.on('close', () => {
        clearInterval(heartbeat)
      })
    } catch (err) {
      console.error('[video] SSE setup failed:', err)
      res.status(500).end()
    }
  })

  // ── Batch Upload (multi-video compilation) ──────────────────────────────────

  router.post('/upload-batch', requireAuth, upload.any(), async (req, res) => {
    try {
      const { userId } = (req as AuthedRequest).session
      const { companyId, strategy, targetDuration } = req.body as {
        companyId?: string
        strategy?: string
        targetDuration?: string
      }

      const company = companyId
        ? await prisma.company.findFirst({ where: { id: companyId, userId } })
        : await prisma.company.findFirst({ where: { userId } })
      if (!company) { res.status(404).json({ error: 'company_not_found' }); return }

      const files = req.files as Express.Multer.File[]
      if (!files || files.length < 2) {
        res.status(400).json({ error: 'At least 2 video files required' })
        return
      }

      // Studio quota — batch creates one VideoUpload row per file, so reject
      // if the entire batch wouldn't fit under the user's monthly cap.
      try {
        const usage = await assertStudioEditQuota(prisma, userId)
        if (usage.studioEdits.used + files.length > usage.studioEdits.limit) {
          res.status(402).json({
            error: 'studio_limit_exceeded',
            message: `Batch of ${files.length} would exceed your remaining ${usage.studioEdits.limit - usage.studioEdits.used} Studio edits this month.`,
            usage,
          })
          return
        }
      } catch (err) {
        const e = err as Error & { code?: string; usage?: unknown }
        if (e.code === 'studio_limit_exceeded') {
          res.status(402).json({ error: 'studio_limit_exceeded', usage: e.usage })
          return
        }
        throw err
      }

      // Upload all files to S3 and create VideoUpload records
      const uploadIds: string[] = []
      for (const file of files) {
        const s3Key = `studio/clips/${company.id}/${Date.now()}-${file.originalname}`
        await uploadFile({ key: s3Key, body: file.buffer, contentType: file.mimetype })

        const upload = await prisma.videoUpload.create({
          data: {
            companyId: company.id,
            sourceVideoUrl: `s3://${s3Key}`,
            fileName: file.originalname,
          },
        })
        uploadIds.push(upload.id)
      }

      // Create compilation record
      const compilation = await prisma.videoCompilation.create({
        data: {
          companyId: company.id,
          uploadIds,
          strategy: strategy || 'montage',
          targetDuration: parseInt(targetDuration || '60', 10),
        },
      })

      // Enqueue for background processing
      try {
        const { videoQueue } = await import('../queues')
        await videoQueue.add('compilation', {
          uploadId: compilation.id,
          videoUrl: '',
          userId,
          companyId: company.id,
          s3Key: '',
        })
      } catch {
        // Fallback: process directly if queue not available
        const { processCompilation } = await import('../lib/videoCompilation.service')
        processCompilation(prisma, compilation.id).catch((e) =>
          console.error('[video] compilation processing failed:', e),
        )
      }

      res.status(202).json({
        compilationId: compilation.id,
        uploadCount: files.length,
        strategy: compilation.strategy,
        status: 'processing',
        message: `${files.length} videos uploaded. Riley is analyzing all of them to build your reel.`,
      })
    } catch (err) {
      console.error('[video] batch upload failed:', err)
      res.status(500).json({ error: 'upload_failed' })
    }
  })

  return router
}

// Broadcast events to all connected clients
export function broadcastProcessingEvent(event: string, data: any) {
  const message = `data: ${JSON.stringify({ event, ...data })}\n\n`
  sseClients.forEach(client => {
    client.write(message)
  })
}

export default router
