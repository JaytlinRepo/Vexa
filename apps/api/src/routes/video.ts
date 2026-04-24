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
import { uploadFile, buildUploadKey, getPresignedUrl } from '../services/storage/s3.service'
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

  // Accept both 'video' (single) and 'videos' (batch) field names
  const upload = multer({ storage: multer.memoryStorage() })

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

      const file = (req as any).files?.[0] || (req as any).file
      if (!file) {
        return res.status(400).json({ error: 'No video file provided' })
      }

      // Upload to S3
      const s3Key = buildUploadKey(companyId, file.originalname)
      await uploadFile({
        key: s3Key,
        body: file.buffer,
        contentType: file.mimetype,
      })
      const videoUrl = await getPresignedUrl(s3Key, 86400) // 24h URL for processing

      // Create upload record
      const videoUpload = await prisma.videoUpload.create({
        data: {
          companyId,
          sourceVideoUrl: videoUrl,
          fileName: file.originalname
        }
      })

      console.log(`[video] Upload created: ${videoUpload.id}`)

      // Return immediately
      res.json({
        uploadId: videoUpload.id,
        status: 'processing',
        message: 'Video processing started'
      })

      // Process in background
      processingService.processVideo(videoUpload.id, videoUrl, userId).catch(err => {
        console.error(`[video] Background processing failed:`, err)
      })
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

      // Keep connection alive
      const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n')
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
