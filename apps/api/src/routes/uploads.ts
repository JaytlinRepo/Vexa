import { Router } from 'express'
import { z } from 'zod'
import multer from 'multer'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import { uploadFile, buildUploadKey, getPresignedUrl, getPresignedUploadUrl } from '../services/storage/s3.service'
import { orchestrateTask } from '../agents/task-orchestrator'
import { createNotification } from '../services/notifications/notification.service'

import prisma from '../lib/prisma'
const router = Router()

// Accept up to 50MB files (video can be large)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'image/jpeg', 'image/png', 'image/webp', 'image/heic',
      'video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo',
    ]
    if (allowed.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`))
    }
  },
})

// ─── POST /api/uploads — Trigger Riley review (accepts JSON with S3 key or multipart file) ──

router.post('/', requireAuth, upload.single('file'), async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const { companyId, notes } = req.body as { companyId?: string; notes?: string }

    if (!companyId) {
      res.status(400).json({ error: 'companyId is required' })
      return
    }

    const company = await prisma.company.findFirst({
      where: { id: companyId, userId },
    })
    if (!company) {
      res.status(404).json({ error: 'company_not_found' })
      return
    }

    let key: string
    let uploadType: 'video' | 'image'

    // Check if file was uploaded via presigned URL (JSON body with uploadKey)
    const bodyKey = (req.body as Record<string, string>).uploadKey
    const bodyType = (req.body as Record<string, string>).uploadType as 'video' | 'image' | undefined

    if (bodyKey) {
      // Presigned flow — file already in S3
      key = bodyKey
      uploadType = bodyType || 'image'
    } else if (req.file) {
      // Multipart flow — file uploaded through API
      uploadType = req.file.mimetype.startsWith('video/') ? 'video' : 'image'
      key = buildUploadKey(companyId, req.file.originalname)
      await uploadFile({
        key,
        body: req.file.buffer,
        contentType: req.file.mimetype,
      })
    } else {
      res.status(400).json({ error: 'No file uploaded and no uploadKey provided' })
      return
    }

    const url = await getPresignedUrl(key)

    // Find Riley (creative_director)
    const riley = await prisma.employee.findFirst({
      where: { companyId, role: 'creative_director', isActive: true },
    })
    if (!riley) {
      res.status(400).json({ error: 'Riley (creative director) not found for this company' })
      return
    }

    // Create a task for Riley to review the upload
    const task = await prisma.task.create({
      data: {
        companyId,
        employeeId: riley.id,
        title: `Review uploaded ${uploadType}`,
        description: JSON.stringify({ uploadKey: key, uploadType, notes: notes || null }),
        type: 'upload_review',
        status: 'in_progress',
      },
    })

    // Fire-and-forget: Riley reviews the upload via orchestrateTask
    // (which routes to executeRileyUploadReview with multimodal + edit suggestions)
    orchestrateTask(task.id).then(async () => {
      await createNotification({
        userId,
        companyId,
        type: 'output_delivered',
        title: 'Riley reviewed your upload',
        body: `Riley has finished reviewing your ${uploadType}. Check the Content tab for her notes.`,
        emoji: '🎬',
        actionUrl: '/work?tab=content',
      })
    }).catch((err) => {
      console.error('[uploads] Riley review failed:', err)
    })

    res.json({
      success: true,
      data: {
        taskId: task.id,
        uploadKey: key,
        uploadType,
        url,
        message: `Riley is reviewing your ${uploadType}...`,
      },
    })
  } catch (err) {
    next(err)
  }
})

// ─── GET /api/uploads/presign — Get a presigned upload URL (for direct S3 upload) ─

const presignSchema = z.object({
  companyId: z.string().uuid(),
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1),
})

router.get('/presign', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const data = presignSchema.parse(req.query)

    const company = await prisma.company.findFirst({
      where: { id: data.companyId, userId },
    })
    if (!company) {
      res.status(404).json({ error: 'company_not_found' })
      return
    }

    const key = buildUploadKey(data.companyId, data.filename)
    const uploadUrl = await getPresignedUploadUrl({
      key,
      contentType: data.contentType,
    })

    res.json({ success: true, data: { key, uploadUrl } })
  } catch (err) {
    next(err)
  }
})

// ─── GET /api/uploads — List uploads for a company ───────────────────────────

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const companyId = req.query.companyId as string

    if (!companyId) {
      res.status(400).json({ error: 'companyId is required' })
      return
    }

    const company = await prisma.company.findFirst({
      where: { id: companyId, userId },
    })
    if (!company) {
      res.status(404).json({ error: 'company_not_found' })
      return
    }

    // Fetch upload_review tasks with their outputs
    const tasks = await prisma.task.findMany({
      where: { companyId, type: 'upload_review' },
      include: {
        outputs: { orderBy: { version: 'desc' }, take: 1 },
        employee: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    // Generate presigned URLs for each upload
    const items = await Promise.all(
      tasks.map(async (t) => {
        let uploadUrl: string | null = null
        let uploadMeta: { uploadKey?: string; uploadType?: string; notes?: string } = {}
        try {
          uploadMeta = JSON.parse(t.description || '{}')
          if (uploadMeta.uploadKey) {
            uploadUrl = await getPresignedUrl(uploadMeta.uploadKey)
          }
        } catch { /* ignore parse errors */ }

        return {
          id: t.id,
          status: t.status,
          uploadType: uploadMeta.uploadType || 'image',
          uploadUrl,
          uploadKey: uploadMeta.uploadKey,
          notes: uploadMeta.notes,
          description: t.description,
          review: t.outputs[0]?.content || null,
          reviewStatus: t.outputs[0]?.status || null,
          userAction: t.userAction || null,
          createdAt: t.createdAt,
          completedAt: t.completedAt,
        }
      }),
    )

    res.json({ success: true, data: items })
  } catch (err) {
    next(err)
  }
})

// ─── POST /api/uploads/:taskId/apply-edits — Apply Riley's suggested edits ──

router.post('/:taskId/apply-edits', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const { taskId } = req.params
    const { edits } = req.body as { edits?: Array<Record<string, unknown>> }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { company: true, outputs: { orderBy: { version: 'desc' }, take: 1 } },
    })
    if (!task || task.company.userId !== userId) {
      res.status(404).json({ error: 'task_not_found' })
      return
    }
    if (task.type !== 'upload_review') {
      res.status(400).json({ error: 'Not an upload review task' })
      return
    }

    // Get the upload key from task description
    let uploadMeta: { uploadKey?: string; uploadType?: string } = {}
    try { uploadMeta = JSON.parse(task.description || '{}') } catch {}
    if (!uploadMeta.uploadKey || uploadMeta.uploadType !== 'video') {
      res.status(400).json({ error: 'Only video uploads can be edited' })
      return
    }

    // Use provided edits or fall back to Riley's suggestions from the output
    const output = task.outputs[0]
    const review = (output?.content || {}) as Record<string, unknown>
    const editCommands = edits || (review.suggestedEdits as Array<Record<string, unknown>>) || []

    if (!editCommands.length) {
      res.status(400).json({ error: 'No edits to apply' })
      return
    }

    // Get presigned URL for the source video
    const { getPresignedUrl } = await import('../services/storage/s3.service')
    const videoUrl = await getPresignedUrl(uploadMeta.uploadKey)
    const videoDuration = (review.videoDuration as number) || undefined

    // Try Creatomate first (professional quality), fall back to FFmpeg
    const hasCreatomate = !!process.env.CREATOMATE_API_KEY
    let editedUrl: string | null = null
    let editedKey: string | null = null
    let renderEngine = 'ffmpeg'

    if (hasCreatomate) {
      try {
        const { renderFromEdits, waitForRender } = await import('../services/integrations/creatomate.service')
        console.log('[uploads] rendering via Creatomate...')
        const job = await renderFromEdits({
          videoUrl,
          videoDuration,
          edits: editCommands as never,
        })

        // Wait for Creatomate to finish rendering (typically 10-60s)
        const completed = await waitForRender(job.id, 180)
        if (completed.status === 'succeeded' && completed.url) {
          editedUrl = completed.url
          renderEngine = 'creatomate'
          console.log('[uploads] Creatomate render succeeded:', editedUrl)
        } else {
          console.warn('[uploads] Creatomate render failed:', completed.errorMessage)
          throw new Error(completed.errorMessage || 'Render failed')
        }
      } catch (e) {
        console.warn('[uploads] Creatomate failed, falling back to FFmpeg:', (e as Error).message)
      }
    }

    // Fallback: FFmpeg (local processing)
    if (!editedUrl) {
      const { applyEdits } = await import('../services/video/ffmpeg.service')
      const ffResult = await applyEdits({
        sourceKey: uploadMeta.uploadKey,
        companyId: task.companyId,
        edits: editCommands as never,
      })
      editedUrl = ffResult.editedUrl
      editedKey = ffResult.editedKey
    }

    // Update the output with the edited file reference
    if (output) {
      const updatedContent = {
        ...review,
        editedKey: editedKey || null,
        editedUrl,
        renderEngine,
      }
      await prisma.output.update({
        where: { id: output.id },
        data: { content: updatedContent as never },
      })
    }

    await createNotification({
      userId,
      companyId: task.companyId,
      type: 'output_delivered',
      title: 'Video edits applied',
      body: renderEngine === 'creatomate'
        ? 'Professional edits applied via Creatomate. Preview in the Content tab.'
        : 'Edits applied. Preview in the Content tab.',
      emoji: '✂️',
      actionUrl: '/work?tab=content',
    })

    res.json({
      success: true,
      data: {
        editedUrl,
        editedKey,
        editsApplied: editCommands.length,
        renderEngine,
      },
    })
  } catch (err) {
    next(err)
  }
})

// ─── POST /api/uploads/combine — Combine multiple videos into one ────────────

router.post('/combine', requireAuth, upload.array('files', 10), async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const { companyId, notes } = req.body as { companyId?: string; notes?: string }

    if (!companyId) {
      res.status(400).json({ error: 'companyId is required' })
      return
    }

    const company = await prisma.company.findFirst({
      where: { id: companyId, userId },
    })
    if (!company) {
      res.status(404).json({ error: 'company_not_found' })
      return
    }

    const files = req.files as Express.Multer.File[] | undefined
    if (!files || files.length < 2) {
      res.status(400).json({ error: 'Need at least 2 video files to combine' })
      return
    }

    // Validate all files are videos
    for (const f of files) {
      if (!f.mimetype.startsWith('video/')) {
        res.status(400).json({ error: `File "${f.originalname}" is not a video` })
        return
      }
    }

    // Upload all clips to S3
    const uploadedKeys: string[] = []
    for (const f of files) {
      const key = buildUploadKey(companyId, f.originalname)
      await uploadFile({ key, body: f.buffer, contentType: f.mimetype })
      uploadedKeys.push(key)
    }

    // Combine via FFmpeg
    const { combineVideos } = await import('../services/video/ffmpeg.service')
    const result = await combineVideos({
      sourceKeys: uploadedKeys,
      companyId,
    })

    // Find Riley
    const riley = await prisma.employee.findFirst({
      where: { companyId, role: 'creative_director', isActive: true },
    })
    if (!riley) {
      res.status(400).json({ error: 'Riley (creative director) not found' })
      return
    }

    // Create a task for Riley to review the combined video
    const task = await prisma.task.create({
      data: {
        companyId,
        employeeId: riley.id,
        title: `Review combined video (${files.length} clips)`,
        description: JSON.stringify({
          uploadKey: result.combinedKey,
          uploadType: 'video',
          notes: notes || null,
          sourceClips: uploadedKeys,
          clipCount: files.length,
        }),
        type: 'upload_review',
        status: 'in_progress',
      },
    })

    // Fire-and-forget: Riley reviews the combined video
    orchestrateTask(task.id).then(async () => {
      await createNotification({
        userId,
        companyId,
        type: 'output_delivered',
        title: 'Riley reviewed your combined video',
        body: `Riley has finished reviewing your ${files.length}-clip video. Check the Content tab.`,
        emoji: '🎬',
        actionUrl: '/work?tab=content',
      })
    }).catch((err) => {
      console.error('[uploads] combined video review failed:', err)
    })

    res.json({
      success: true,
      data: {
        taskId: task.id,
        combinedKey: result.combinedKey,
        combinedUrl: result.combinedUrl,
        duration: result.duration,
        clipCount: files.length,
        message: `${files.length} clips combined. Riley is reviewing...`,
      },
    })
  } catch (err) {
    next(err)
  }
})

// ─── POST /api/uploads/combine-existing — Combine already-uploaded videos ────

const combineExistingSchema = z.object({
  companyId: z.string().uuid(),
  uploadKeys: z.array(z.string().min(1)).min(2).max(10),
  notes: z.string().max(500).optional(),
})

router.post('/combine-existing', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const data = combineExistingSchema.parse(req.body)

    const company = await prisma.company.findFirst({
      where: { id: data.companyId, userId },
    })
    if (!company) {
      res.status(404).json({ error: 'company_not_found' })
      return
    }

    // Find Riley
    const riley = await prisma.employee.findFirst({
      where: { companyId: data.companyId, role: 'creative_director', isActive: true },
    })
    if (!riley) {
      res.status(400).json({ error: 'Riley (creative director) not found' })
      return
    }

    // Create task immediately so the UI shows "processing"
    const task = await prisma.task.create({
      data: {
        companyId: data.companyId,
        employeeId: riley.id,
        title: `Combining & reviewing ${data.uploadKeys.length} clips`,
        description: JSON.stringify({
          uploadKey: '',  // will be set after combine
          uploadType: 'video',
          notes: data.notes || null,
          sourceClips: data.uploadKeys,
          clipCount: data.uploadKeys.length,
          status: 'combining',
        }),
        type: 'upload_review',
        status: 'in_progress',
      },
    })

    // Respond immediately — combine + review runs in background
    res.json({
      success: true,
      data: {
        taskId: task.id,
        clipCount: data.uploadKeys.length,
        message: `Combining ${data.uploadKeys.length} clips in the background. Riley will review when ready.`,
      },
    })

    // Fire-and-forget: combine → update task → Riley reviews
    ;(async () => {
      try {
        const { combineVideos } = await import('../services/video/ffmpeg.service')
        const result = await combineVideos({
          sourceKeys: data.uploadKeys,
          companyId: data.companyId,
        })

        // Update task with the combined file key
        await prisma.task.update({
          where: { id: task.id },
          data: {
            description: JSON.stringify({
              uploadKey: result.combinedKey,
              uploadType: 'video',
              notes: data.notes || null,
              sourceClips: data.uploadKeys,
              clipCount: data.uploadKeys.length,
            }),
          },
        })

        // Now have Riley review it
        await orchestrateTask(task.id)

        await createNotification({
          userId,
          companyId: data.companyId,
          type: 'output_delivered',
          title: 'Combined video ready',
          body: `${data.uploadKeys.length} clips combined and reviewed by Riley. Check the Content tab.`,
          emoji: '🎬',
          actionUrl: '/work?tab=content',
        })
      } catch (err) {
        console.error('[uploads] combine-existing failed:', err)
        // Mark task as failed so UI shows an error
        await prisma.task.update({
          where: { id: task.id },
          data: { status: 'revision' },
        }).catch(() => {})
      }
    })()
  } catch (err) {
    next(err)
  }
})

export default router
