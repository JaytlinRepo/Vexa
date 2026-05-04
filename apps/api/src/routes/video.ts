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
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const router = Router()
let prisma: PrismaClient
let processingService: VideoProcessingService

// Store SSE clients for broadcasting
// Keyed by userId — each user only receives their own processing events.
const sseClients = new Map<string, Set<Response>>()

export function initVideoRoutes(_prisma: PrismaClient) {
  prisma = _prisma
  processingService = new VideoProcessingService(prisma)

  // ── Upload Video ───────────────────────────────────────────────────────────

  // All uploads land on disk so a multi-hundred-MB body never pins the
  // request handler's heap. memoryStorage was OOM-prone for large clips
  // and broke the proxy connection mid-upload on big iPhone videos.
  const safeFilename = (_req: Request, file: Express.Multer.File, cb: (err: Error | null, name: string) => void): void => {
    const safe = file.originalname.replace(/[^A-Za-z0-9._-]/g, '_')
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`)
  }

  const singleUploadTmp = path.join(os.tmpdir(), 'sovexa-single-uploads')
  fs.mkdirSync(singleUploadTmp, { recursive: true })
  const upload = multer({
    storage: multer.diskStorage({ destination: singleUploadTmp, filename: safeFilename }),
    limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 1 },
  })

  const batchUploadTmp = path.join(os.tmpdir(), 'sovexa-batch-uploads')
  fs.mkdirSync(batchUploadTmp, { recursive: true })
  const uploadBatch = multer({
    storage: multer.diskStorage({ destination: batchUploadTmp, filename: safeFilename }),
    limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 12 },
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

      const file = (req as any).files?.[0] || (req as any).file
      if (!file) {
        return res.status(400).json({ error: 'No video file provided' })
      }

      // Stream from disk → S3. Always free the temp file when we're done.
      let videoUpload: { id: string } | null = null
      try {
        const s3Key = buildUploadKey(companyId, file.originalname)
        await uploadFile({
          key: s3Key,
          body: fs.createReadStream(file.path),
          contentType: file.mimetype,
        })
        const videoUrl = await getPresignedUrl(s3Key, 86400) // 24h URL for processing

        videoUpload = await prisma.videoUpload.create({
          data: { companyId, sourceVideoUrl: videoUrl, fileName: file.originalname },
        })
        console.log(`[video] Upload created: ${videoUpload.id}`)

        // Return immediately so the client unblocks before processing starts.
        res.json({
          uploadId: videoUpload.id,
          status: 'processing',
          message: 'Video processing started',
        })

        // Map upload → user for SSE event routing, identical to the batch path.
        const { registerUploadUser } = await import('../lib/videoProcessing.service')
        registerUploadUser(videoUpload.id, userId)

        // Prefer BullMQ so an API restart doesn't lose the job. Fall back to
        // inline processing only when Redis is unreachable, mirroring the
        // batch route's resilience.
        const { isRedisHealthy } = await import('../queues/connection')
        if (await isRedisHealthy()) {
          try {
            const { videoQueue } = await import('../queues')
            await videoQueue.add('single', {
              uploadId: videoUpload.id,
              videoUrl,
              userId,
              companyId,
              s3Key,
            })
            console.log(`[video] single ${videoUpload.id} enqueued`)
          } catch (err) {
            console.warn(`[video] enqueue failed despite healthy Redis — falling back inline:`, (err as Error).message)
            processingService.processVideo(videoUpload.id, videoUrl, userId).catch((e) => {
              console.error('[video] Background processing failed:', e)
            })
          }
        } else {
          console.warn(`[video] Redis unavailable — processing single ${videoUpload.id} inline`)
          processingService.processVideo(videoUpload.id, videoUrl, userId).catch((e) => {
            console.error('[video] Background processing failed:', e)
          })
        }
      } finally {
        // Always remove the disk-buffered upload — the worker reads from S3.
        try { fs.unlinkSync(file.path) } catch {}
      }
    } catch (err) {
      console.error('[video] Upload failed:', err)
      res.status(500).json({ error: 'Upload failed' })
    }
  })

  // ── Job existence check ───────────────────────────────────────────────────
  // Used by the Studio frontend on tab init to decide whether to resurrect a
  // saved progress card. Returns 404 if the upload/compilation no longer
  // exists (e.g. after an admin truncate or aborted run), so the client can
  // discard the stale sessionStorage entry instead of showing a ghost bar.
  router.get('/job/:id', requireAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as AuthedRequest).session
      const id = req.params.id
      const ownedCompanyIds = (await prisma.company.findMany({
        where: { userId },
        select: { id: true },
      })).map((c) => c.id)
      if (ownedCompanyIds.length === 0) { res.status(404).json({ error: 'not_found' }); return }

      // Compilation path: if we have a finished/failed compilation, tell the
      // client to drop the resume. A linked clip means the whole pipeline ran
      // (compilation → Riley → output) and the user shouldn't see a ghost
      // progress bar even if they already approved/rejected the clip.
      const compilation = await prisma.videoCompilation.findFirst({
        where: { id, companyId: { in: ownedCompanyIds } },
        select: { id: true, status: true },
      })
      if (compilation) {
        const done = compilation.status === 'completed' || compilation.status === 'failed'
        res.json({ kind: 'compilation', id: compilation.id, status: compilation.status, done })
        return
      }

      // Single-upload path: a clip linked to the upload means processing is
      // done. Otherwise the worker is still running it.
      const upload = await prisma.videoUpload.findFirst({
        where: { id, companyId: { in: ownedCompanyIds } },
        select: { id: true },
      })
      if (upload) {
        const clip = await prisma.videoClip.findFirst({ where: { uploadId: upload.id }, select: { id: true } })
        res.json({ kind: 'upload', id: upload.id, done: !!clip })
        return
      }

      res.status(404).json({ error: 'not_found' })
    } catch (err) {
      console.error('[video] job lookup failed:', err)
      res.status(500).json({ error: 'lookup_failed' })
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

      // Setup SSE.
      //   - Content-Type / Cache-Control: standard SSE headers.
      //   - X-Accel-Buffering: tells nginx (prod) and any compatible proxy
      //     never to buffer this response. Without this the dev-time
      //     Next.js proxy can hold the headers until first write fills its
      //     internal buffer, which prevents the browser from seeing the
      //     stream as "open" and causes immediate disconnects.
      //   - Connection: keep-alive (express may set this anyway, explicit is safer).
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache, no-transform')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('X-Accel-Buffering', 'no')

      res.flushHeaders()
      try { res.write(': connected\n\n') } catch { /* socket already gone */ }

      if (!sseClients.has(userId)) sseClients.set(userId, new Set())
      sseClients.get(userId)!.add(res)
      console.log(`[video] SSE client connected: ${userId} (${sseClients.get(userId)!.size} tab(s))`)

      const heartbeat = setInterval(() => {
        try {
          res.write(': heartbeat\n\n')
        } catch {
          // Socket gone but the close event hadn't fired yet — clean up
          // here too so a half-closed connection doesn't leak the Response
          // ref or keep ticking the heartbeat forever.
          cleanup()
        }
      }, 15000)

      // Single cleanup path so we never partially tear down. Idempotent so
      // it's safe whether the trigger comes from req.close, res.close, or
      // a write error.
      let cleanedUp = false
      const cleanup = () => {
        if (cleanedUp) return
        cleanedUp = true
        clearInterval(heartbeat)
        const tabs = sseClients.get(userId)
        if (tabs) {
          tabs.delete(res)
          if (tabs.size === 0) sseClients.delete(userId)
        }
        try { res.end() } catch { /* already ended */ }
        console.log(`[video] SSE client disconnected: ${userId}`)
      }

      req.on('close', cleanup)
      res.on('close', cleanup)
      res.on('error', cleanup)
    } catch (err) {
      console.error('[video] SSE setup failed:', err)
      res.status(500).end()
    }
  })

  // ── Batch Upload (multi-video compilation) ──────────────────────────────────

  router.post('/upload-batch', requireAuth, uploadBatch.any(), async (req, res) => {
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
      const MAX_BATCH = 12 // hard cap; mirrored on the Studio frontend
      if (!files || files.length < 2) {
        res.status(400).json({ error: 'At least 2 video files required' })
        return
      }
      if (files.length > MAX_BATCH) {
        res.status(400).json({
          error: 'too_many_files',
          message: `Maximum ${MAX_BATCH} videos per batch. You sent ${files.length}.`,
        })
        return
      }

      // Upload all files to S3 and create VideoUpload records.
      // Files are on disk (multer.diskStorage); stream them to S3 so we
      // never hold the full multi-hundred-MB buffer in memory.
      const uploadIds: string[] = []
      const tempPaths: string[] = []
      try {
        for (const file of files) {
          tempPaths.push(file.path) // remember to clean up
          const s3Key = `studio/clips/${company.id}/${Date.now()}-${file.originalname}`
          await uploadFile({
            key: s3Key,
            body: fs.createReadStream(file.path),
            contentType: file.mimetype,
          })

          const upload = await prisma.videoUpload.create({
            data: {
              companyId: company.id,
              sourceVideoUrl: `s3://${s3Key}`,
              fileName: file.originalname,
            },
          })
          uploadIds.push(upload.id)
        }
      } finally {
        // Always remove temp files, success or failure. The worker only
        // needs the S3 copy; the local file has done its job.
        for (const p of tempPaths) {
          try { fs.unlinkSync(p) } catch {}
        }
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

      // Register compilationId → userId so SSE events from the compilation
      // pipeline reach the right tab. Without this, broadcast calls drop
      // every progress event ("called without userId — event dropped").
      const { registerUploadUser } = await import('../lib/videoProcessing.service')
      registerUploadUser(compilation.id, userId)

      // Enqueue for background processing — but only if Redis is actually
      // reachable. `videoQueue.add()` does NOT reject when Redis is down;
      // BullMQ buffers the job in memory and retries forever, so a try/catch
      // around add() can't detect the outage. We have to ping Redis upfront
      // and pick the path explicitly.
      const { isRedisHealthy } = await import('../queues/connection')
      const redisOk = await isRedisHealthy()
      if (redisOk) {
        try {
          const { videoQueue } = await import('../queues')
          await videoQueue.add('compilation', {
            uploadId: compilation.id,
            videoUrl: '',
            userId,
            companyId: company.id,
            s3Key: '',
          })
          console.log(`[video] compilation ${compilation.id} enqueued`)
        } catch (err) {
          // Edge case: Redis dropped between health-check and add. Fall back inline.
          console.warn(`[video] queue enqueue failed despite healthy Redis — falling back inline:`, (err as Error).message)
          const { processCompilation } = await import('../lib/videoCompilation.service')
          processCompilation(prisma, compilation.id).catch((e) =>
            console.error('[video] compilation processing failed:', e),
          )
        }
      } else {
        // Redis down — process inline. Slower (single-process), but works.
        // Fire-and-forget so the HTTP response doesn't block on the long pipeline.
        console.warn(`[video] Redis unavailable — processing compilation ${compilation.id} inline as fallback`)
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

// Send a processing event only to the specific user who owns the job.
export function broadcastProcessingEvent(event: string, data: any, userId?: string) {
  const message = `data: ${JSON.stringify({ event, ...data })}\n\n`
  if (userId) {
    const tabs = sseClients.get(userId)
    if (tabs && tabs.size > 0) {
      // Track and prune any clients whose write fails — they're a closed
      // socket whose 'close' event hasn't fired yet (proxy timeouts, abrupt
      // disconnects). Without this the Set grows unboundedly.
      const dead: Response[] = []
      tabs.forEach((client) => {
        try {
          client.write(message)
        } catch {
          dead.push(client)
        }
      })
      if (dead.length > 0) {
        dead.forEach((c) => {
          tabs.delete(c)
          try { c.end() } catch { /* already ended */ }
        })
        if (tabs.size === 0) sseClients.delete(userId)
      }
    } else {
      // We have a userId but no tabs are listening — probably the user's
      // SSE client hasn't connected yet (race) or already closed. Log
      // once per event-type to make debugging easier.
      console.warn(`[video] event '${event}' for user ${userId.slice(0, 8)}… dropped (no listeners)`)
    }
  } else {
    // Legacy callers without userId — skip rather than broadcasting to everyone.
    console.warn('[video] broadcastProcessingEvent called without userId — event dropped:', event)
  }
}

export default router
