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

  const upload = multer({ storage: multer.memoryStorage() })

  /**
   * POST /api/video/upload
   * Upload video for processing
   */
  router.post('/upload', requireAuth, upload.single('video'), async (req: Request, res: Response) => {
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

      if (!req.file) {
        return res.status(400).json({ error: 'No video file provided' })
      }

      // TODO: Save to S3 and get URL
      // For now, use a placeholder
      const videoUrl = `https://s3.amazonaws.com/vexa-videos/${Date.now()}_${req.file.originalname}`

      // Create upload record
      const videoUpload = await prisma.videoUpload.create({
        data: {
          companyId,
          sourceVideoUrl: videoUrl,
          fileName: req.file.originalname
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
