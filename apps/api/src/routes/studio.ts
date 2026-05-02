/**
 * Studio Approval Routes
 *
 * POST /api/studio/approve-visual   — Approve or reject visual edit with feedback
 * POST /api/studio/approve-copy     — Approve or reject caption with feedback
 * GET  /api/studio/pending          — Get pending approvals (batch preview)
 * POST /api/studio/regenerate       — Regenerate visual or copy after rejection
 */

import { Router, Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { getPresignedUrl } from '../services/storage/s3.service'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import { recordEditorialFeedback } from '../lib/brandMemory'
import StudioVisualEditingService from '../lib/studioVisualEditing.service'
import StudioCopywritingService from '../lib/studioCopywriting.service'
import StudioPostingStrategyService from '../lib/studioPostingStrategy.service'
import { invokeAgent } from '../services/bedrock/bedrock.service'

const router = Router()
let prisma: PrismaClient
let visualEditingService: StudioVisualEditingService
let copywritingService: StudioCopywritingService
let postingStrategyService: StudioPostingStrategyService

/** Fresh HTTPS URL for clip playback (HQ Riley drawer, lite weekly-status). */
async function resolveClipPreviewUrl(clippedUrl: string | null | undefined): Promise<string | null> {
  if (!clippedUrl || typeof clippedUrl !== 'string') return null
  try {
    if (clippedUrl.startsWith('s3://')) {
      return await getPresignedUrl(clippedUrl.replace('s3://', ''), 3600)
    }
    return clippedUrl
  } catch {
    return null
  }
}

export function initStudioRoutes(_prisma: PrismaClient) {
  prisma = _prisma
  visualEditingService = new StudioVisualEditingService(prisma)
  copywritingService = new StudioCopywritingService(prisma)
  postingStrategyService = new StudioPostingStrategyService(prisma)

  // ── Approve/Reject Visual Edit ──────────────────────────────────────────

  const approveVisualSchema = z.object({
    clipId: z.string().cuid(),
    action: z.enum(['approve', 'reject']),
    feedback: z.string().max(500).optional(),
  }).refine(
    (data) => data.action === 'approve' || (data.feedback && data.feedback.trim().length > 5),
    {
      message: 'Please explain what you want changed (minimum 5 characters)',
      path: ['feedback'],
    }
  )

  /**
   * POST /api/studio/approve-visual
   * User approves or rejects the visual edit
   */
  router.post('/approve-visual', requireAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as AuthedRequest).session
      const data = approveVisualSchema.parse(req.body)

      const clip = await prisma.videoClip.findUnique({
        where: { id: data.clipId },
        include: { company: true, upload: true },
      })

      if (!clip || clip.company.userId !== userId) {
        return res.status(404).json({ error: 'clip_not_found' })
      }

      // Extract segment labels and visual keywords from clip data for memory
      const segments = (clip.adjustments as any)?.segments || []
      const segmentLabels = segments.map((s: any) => s.label).filter(Boolean)
      const visualKeywords = extractVisualKeywords(segmentLabels)
      // Derive action decisions for action-aware learning. We don't have a
      // perfect mapping from final cuts back to source actions yet (the source
      // beat analysis isn't persisted on the clip), but we can infer the
      // duration class of each kept segment as a useful first signal.
      const actionDecisions = segments.map((s: any) => {
        const dur = (s.endTime ?? 0) - (s.startTime ?? 0)
        const durationClass: 'short' | 'medium' | 'long' = dur <= 3 ? 'short' : dur <= 5.5 ? 'medium' : 'long'
        return {
          durationClass,
          decisionType: 'kept_whole' as const, // refine when source beat analysis is persisted
          label: s.label,
        }
      })

      if (data.action === 'approve') {
        // Approve visual
        await prisma.videoClip.update({
          where: { id: clip.id },
          data: {
            visualApprovalStatus: 'approved',
          },
        })

        // Record approval in brand memory with visual context
        await recordEditorialFeedback(prisma, {
          companyId: clip.companyId,
          feedback: 'Visual edit approved',
          type: 'visual_approval',
          context: {
            clipId: clip.id,
            adjustments: clip.adjustments,
            styleMetrics: clip.styleMetrics,
          },
          visualKeywords,
          segmentLabels,
          actionDecisions,
        })

        res.json({ clip: { id: clip.id, visualApprovalStatus: 'approved' } })
      } else {
        // Reject visual and queue for re-edit
        const feedbackHistory = (clip.editorialFeedback as any[]) || []
        feedbackHistory.push({
          type: 'visual',
          reason: data.feedback,
          timestamp: new Date().toISOString(),
          version: (clip.adjustments as any)?.version ?? 1,
        })

        await prisma.videoClip.update({
          where: { id: clip.id },
          data: {
            visualApprovalStatus: 'rejected',
            editorialFeedback: feedbackHistory,
          },
        })

        // Record rejection in brand memory with visual context
        await recordEditorialFeedback(prisma, {
          companyId: clip.companyId,
          feedback: data.feedback || 'Visual edit rejected',
          type: 'visual_rejection',
          context: {
            clipId: clip.id,
            previousAdjustments: clip.adjustments,
          },
          visualKeywords,
          segmentLabels,
          actionDecisions,
        })

        // Trigger re-edit if feedback provided
        if (data.feedback) {
          // Queue regeneration task
          // For now, just mark status
          res.json({
            clip: { id: clip.id, visualApprovalStatus: 'rejected' },
            action: 'regenerate',
            message: 'Visual edit queued for revision',
          })
        } else {
          res.json({ clip: { id: clip.id, visualApprovalStatus: 'rejected' } })
        }
      }
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: 'invalid_input', issues: err.issues })
      }
      console.error('[studio] approve-visual failed:', err)
      res.status(500).json({ error: 'Failed to process visual approval', message: 'Something went wrong. Please try again.' })
    }
  })

  // ── Approve/Reject Copy ──────────────────────────────────────────────────

  const approveCopySchema = z.object({
    clipId: z.string().cuid(),
    action: z.enum(['approve', 'reject']),
    captionId: z.string().optional(), // Which caption option they chose
    feedback: z.string().max(500).optional(),
  }).refine(
    (data) => data.action === 'approve' || (data.feedback && data.feedback.trim().length > 5),
    {
      message: 'Please explain what you want changed (minimum 5 characters)',
      path: ['feedback'],
    }
  )

  /**
   * POST /api/studio/approve-copy
   * User approves or rejects captions
   */
  router.post('/approve-copy', requireAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as AuthedRequest).session
      const data = approveCopySchema.parse(req.body)

      const clip = await prisma.videoClip.findUnique({
        where: { id: data.clipId },
        include: { company: true },
      })

      if (!clip || clip.company.userId !== userId) {
        return res.status(404).json({ error: 'clip_not_found' })
      }

      if (data.action === 'approve') {
        // Approve copy
        const captionOptions = (clip.captionOptions as any) || []
        const selectedCaption = data.captionId
          ? captionOptions.find((c: any) => c.id === data.captionId)
          : captionOptions[0]

        await prisma.videoClip.update({
          where: { id: clip.id },
          data: {
            copyApprovalStatus: 'approved',
            caption: selectedCaption?.text,
            selectedCaptionId: selectedCaption?.id,
          },
        })

        // Record approval in brand memory
        await recordEditorialFeedback(prisma, {
          companyId: clip.companyId,
          feedback: `Caption approved: "${selectedCaption?.text.slice(0, 100)}"`,
          type: 'copy_approval',
          context: {
            clipId: clip.id,
            selectedCaption,
          },
        })

        res.json({ clip: { id: clip.id, copyApprovalStatus: 'approved' } })
      } else {
        // Reject copy and queue for regen
        const feedbackHistory = (clip.editorialFeedback as any[]) || []
        feedbackHistory.push({
          type: 'copy',
          reason: data.feedback,
          timestamp: new Date().toISOString(),
          version: (clip.captionOptions as any)?.length ?? 0,
        })

        await prisma.videoClip.update({
          where: { id: clip.id },
          data: {
            copyApprovalStatus: 'rejected',
            editorialFeedback: feedbackHistory,
          },
        })

        // Record rejection in brand memory
        await recordEditorialFeedback(prisma, {
          companyId: clip.companyId,
          feedback: data.feedback || 'Caption rejected',
          type: 'copy_rejection',
          context: {
            clipId: clip.id,
            previousCaptions: clip.captionOptions,
          },
        })

        res.json({
          clip: { id: clip.id, copyApprovalStatus: 'rejected' },
          action: 'regenerate',
          message: 'Caption queued for revision',
        })
      }
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: 'invalid_input', issues: err.issues })
      }
      console.error('[studio] approve-copy failed:', err)
      res.status(500).json({ error: 'Failed to process copy approval', message: 'Something went wrong. Please try again.' })
    }
  })

  // ── Regenerate After Rejection ──────────────────────────────────────────

  const regenerateSchema = z.object({
    clipId: z.string().cuid(),
    type: z.enum(['visual', 'copy']),
  })

  /**
   * POST /api/studio/regenerate
   * Regenerate visual edit or copy based on feedback
   */
  router.post('/regenerate', requireAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as AuthedRequest).session
      const data = regenerateSchema.parse(req.body)

      const clip = await prisma.videoClip.findUnique({
        where: { id: data.clipId },
        include: { company: true, upload: true },
      })

      if (!clip || clip.company.userId !== userId) {
        return res.status(404).json({ error: 'clip_not_found' })
      }

      if (data.type === 'visual') {
        // Riley regenerates visual with feedback
        const feedbackHistory = (clip.editorialFeedback as any[]) || []
        const visualFeedback = feedbackHistory
          .filter((f: any) => f.type === 'visual')
          .map((f: any) => f.reason)

        const editResult = await visualEditingService.editClip({
          clipId: clip.id,
          companyId: clip.companyId,
          clipUrl: clip.clippedUrl,
          feedbackHistory: visualFeedback,
        })

        // Update clip with new edit
        await prisma.videoClip.update({
          where: { id: clip.id },
          data: {
            clippedUrl: editResult.editedUrl,
            adjustments: {
              ...editResult.adjustments,
              version: editResult.version,
            },
            styleMetrics: editResult.styleMetrics,
            visualApprovalStatus: 'pending', // Re-open for approval
          },
        })

        res.json({
          clip: { id: clip.id, editResult },
          message: 'Visual edit regenerated',
        })
      } else {
        // Alex regenerates copy with feedback
        const feedbackHistory = (clip.editorialFeedback as any[]) || []
        const copyFeedback = feedbackHistory
          .filter((f: any) => f.type === 'copy')
          .map((f: any) => f.reason)

        const copyResult = await copywritingService.generateCopyOptions({
          companyId: clip.companyId,
          contentType: 'video', // TODO: determine from context
          feedbackHistory: copyFeedback,
        })

        // Update clip with new captions
        await prisma.videoClip.update({
          where: { id: clip.id },
          data: {
            captionOptions: [
              ...copyResult.hooks.map((h) => ({ ...h, type: 'hook' })),
              ...copyResult.captions.map((c) => ({ ...c, type: 'caption' })),
            ],
            copyApprovalStatus: 'pending', // Re-open for approval
          },
        })

        res.json({
          clip: { id: clip.id, copyResult },
          message: 'Captions regenerated',
        })
      }
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: 'invalid_input', issues: err.issues })
      }
      console.error('[studio] regenerate failed:', err)
      res.status(500).json({
        error: 'Failed to regenerate content',
        message: err instanceof Error ? err.message : 'Unknown error',
        tip: 'If this continues, try saving as draft and editing manually'
      })
    }
  })

  // ── Weekly status — Riley's full pipeline summary for the HQ brief modal ─
  router.get('/weekly-status', requireAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as AuthedRequest).session
      const { companyId } = req.query
      if (!companyId) return res.status(400).json({ error: 'companyId required' })
      const company = await prisma.company.findFirst({ where: { id: companyId as string, userId } })
      if (!company) return res.status(403).json({ error: 'not found' })

      const lite =
        req.query.lite === '1' ||
        req.query.lite === 'true' ||
        (Array.isArray(req.query.lite) && req.query.lite[0] === '1')

      if (lite) {
        const [needsApproval, readyToPost] = await Promise.all([
          prisma.videoClip.findMany({
            where: {
              companyId: company.id,
              status: { not: 'archived' },
              OR: [{ visualApprovalStatus: 'pending' }, { copyApprovalStatus: 'pending' }],
            },
            select: {
              id: true,
              clippedUrl: true,
              hook: true,
              caption: true,
              duration: true,
              visualApprovalStatus: true,
              copyApprovalStatus: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 20,
          }),
          prisma.videoClip.findMany({
            where: {
              companyId: company.id,
              status: 'ready_to_post',
              visualApprovalStatus: 'approved',
              copyApprovalStatus: 'approved',
            },
            select: { id: true, clippedUrl: true, hook: true, caption: true, duration: true, updatedAt: true },
            orderBy: { updatedAt: 'desc' },
            take: 20,
          }),
        ])
        const [needsOut, readyOut] = await Promise.all([
          Promise.all(
            needsApproval.map(async (c) => ({
              id: c.id,
              hook: c.hook,
              caption: c.caption,
              duration: c.duration,
              visualApprovalStatus: c.visualApprovalStatus,
              copyApprovalStatus: c.copyApprovalStatus,
              createdAt: c.createdAt,
              description: null as string | null,
              previewUrl: await resolveClipPreviewUrl(c.clippedUrl),
            }))
          ),
          Promise.all(
            readyToPost.map(async (c) => ({
              id: c.id,
              hook: c.hook,
              caption: c.caption,
              duration: c.duration,
              updatedAt: c.updatedAt,
              description: null as string | null,
              previewUrl: await resolveClipPreviewUrl(c.clippedUrl),
            }))
          ),
        ])
        res.json({
          needsApproval: needsOut,
          readyToPost: readyOut,
        })
        return
      }

      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

      const [doneThisWeek, needsApproval, readyToPost] = await Promise.all([
        // Clips fully approved or posted in the last 7 days
        prisma.videoClip.findMany({
          where: {
            companyId: company.id,
            status: { in: ['ready_to_post', 'posted'] },
            visualApprovalStatus: 'approved',
            copyApprovalStatus: 'approved',
            updatedAt: { gte: since },
          },
          select: { id: true, hook: true, caption: true, duration: true, status: true, updatedAt: true },
          orderBy: { updatedAt: 'desc' },
          take: 10,
        }),
        // Clips still waiting on approval
        prisma.videoClip.findMany({
          where: {
            companyId: company.id,
            status: { not: 'archived' },
            OR: [{ visualApprovalStatus: 'pending' }, { copyApprovalStatus: 'pending' }],
          },
          select: { id: true, hook: true, caption: true, duration: true, visualApprovalStatus: true, copyApprovalStatus: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        // Clips fully approved and staged to post
        prisma.videoClip.findMany({
          where: {
            companyId: company.id,
            status: 'ready_to_post',
            visualApprovalStatus: 'approved',
            copyApprovalStatus: 'approved',
          },
          select: { id: true, hook: true, caption: true, duration: true, updatedAt: true },
          orderBy: { updatedAt: 'desc' },
          take: 10,
        }),
      ])

      // Generate short visual scene descriptions for all clips so the CEO
      // knows which video they're looking at without needing to open Studio.
      const allClips = [...doneThisWeek, ...needsApproval, ...readyToPost]
      const descMap: Record<string, string> = {}
      if (allClips.length > 0) {
        try {
          const clipList = allClips.map((c, i) =>
            `${i + 1}. id="${c.id}" hook="${(c.hook || '').substring(0, 120)}" caption="${(c.caption || '').substring(0, 120)}"`
          ).join('\n')
          const raw = await invokeAgent({
            systemPrompt: 'You are a video production assistant. Write a concise 4-8 word visual scene description for each video clip based on its hook and caption. Focus on what the viewer literally sees (e.g. "Woman holding photo of herself", "Chef preparing pasta close-up"). Return ONLY a JSON array: [{"id":"...","description":"..."}]',
            messages: [{ role: 'user', content: `Generate visual descriptions for these clips:\n${clipList}` }],
            maxTokens: 512,
            temperature: 0.3,
            companyId: company.id,
          })
          const parsed = JSON.parse(raw.trim().replace(/^```json\n?|```$/g, ''))
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (item.id && item.description) descMap[item.id] = item.description
            }
          }
        } catch {
          // descriptions are best-effort — never block the response
        }
      }

      const withDesc = <T extends { id: string }>(clips: T[]) =>
        clips.map(c => ({ ...c, description: descMap[c.id] || null }))

      res.json({
        doneThisWeek: withDesc(doneThisWeek),
        needsApproval: withDesc(needsApproval),
        readyToPost: withDesc(readyToPost),
      })
    } catch (err) {
      res.status(500).json({ error: 'weekly-status failed' })
    }
  })

  // ── Queue counts — lightweight for Riley's HQ card ────────────────────
  router.get('/counts', requireAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as AuthedRequest).session
      const { companyId } = req.query
      if (!companyId) return res.status(400).json({ error: 'companyId required' })
      const company = await prisma.company.findFirst({ where: { id: companyId as string, userId } })
      if (!company) return res.status(403).json({ error: 'not found' })

      const [needsApproval, readyToPost] = await Promise.all([
        prisma.videoClip.count({
          where: {
            companyId: company.id,
            status: { not: 'archived' },
            OR: [{ visualApprovalStatus: 'pending' }, { copyApprovalStatus: 'pending' }],
          },
        }),
        prisma.videoClip.count({
          where: {
            companyId: company.id,
            status: 'ready_to_post',
            visualApprovalStatus: 'approved',
            copyApprovalStatus: 'approved',
          },
        }),
      ])
      res.json({ needsApproval, readyToPost })
    } catch (err) {
      res.status(500).json({ error: 'counts failed' })
    }
  })

  // ── Get Pending Approvals (Batch Preview) ──────────────────────────────

  /**
   * GET /api/studio/pending?companyId=xyz
   * Get all clips pending visual or copy approval
   */
  router.get('/pending', requireAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as AuthedRequest).session
      const { companyId } = req.query

      if (!companyId) {
        return res.status(400).json({ error: 'companyId required' })
      }

      const company = await prisma.company.findFirst({
        where: { id: companyId as string, userId },
      })

      if (!company) {
        return res.status(403).json({ error: 'Company not found' })
      }

      const pendingClips = await prisma.videoClip.findMany({
        where: {
          companyId: company.id,
          status: { not: 'archived' },
          OR: [
            { visualApprovalStatus: 'pending' },
            { copyApprovalStatus: 'pending' },
          ],
        },
        orderBy: { createdAt: 'desc' },
        include: {
          upload: true,
        },
      })

      // Resolve s3:// keys to fresh presigned URLs and add source video URL
      const clipsWithUrls = await Promise.all(
        pendingClips.map(async (clip) => {
          let url = clip.clippedUrl
          if (url.startsWith('s3://')) {
            url = await getPresignedUrl(url.replace('s3://', ''), 3600)
          }
          // Generate fresh presigned URL for the source video too
          let sourceVideoUrl = clip.upload?.sourceVideoUrl || ''
          if (sourceVideoUrl.includes('vexa-outputs') && sourceVideoUrl.includes('X-Amz-')) {
            // Presigned URL may be expired — regenerate from the S3 key
            const keyMatch = sourceVideoUrl.match(/vexa-outputs\.s3[^/]*\.amazonaws\.com\/([^?]+)/)
            if (keyMatch) {
              sourceVideoUrl = await getPresignedUrl(decodeURIComponent(keyMatch[1]), 3600)
            }
          }
          return { ...clip, clippedUrl: url, sourceVideoUrl }
        })
      )

      res.json({ clips: clipsWithUrls })
    } catch (err) {
      console.error('[studio] get pending failed:', err)
      res.status(500).json({ error: 'Failed to fetch pending approvals' })
    }
  })

  // ── Discard Clip ────────────────────────────────────────────────────

  /**
   * POST /api/studio/discard
   * User discards a clip during editing (can't proceed with approval)
   */
  router.post('/discard', requireAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as AuthedRequest).session
      const { clipId } = z.object({ clipId: z.string().cuid() }).parse(req.body)

      const clip = await prisma.videoClip.findUnique({
        where: { id: clipId },
        include: { company: true },
      })

      if (!clip || clip.company.userId !== userId) {
        return res.status(404).json({ error: 'clip_not_found' })
      }

      // Mark clip as archived (soft delete)
      await prisma.videoClip.update({
        where: { id: clipId },
        data: { status: 'archived' },
      })

      res.json({ success: true, message: 'Clip discarded' })
    } catch (err) {
      console.error('[studio] discard failed:', err)
      res.status(500).json({ error: 'Failed to discard clip' })
    }
  })

  // ── Schedule Content ────────────────────────────────────────────────

  const scheduleSchema = z.object({
    clipId: z.string().cuid(),
    scheduledTime: z.coerce.date().min(new Date(), 'Must be in the future'),
    platform: z.enum(['instagram', 'tiktok']).default('instagram'),
  })

  /**
   * POST /api/studio/schedule
   * Schedule a clip for posting at a specific time
   */
  router.post('/schedule', requireAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as AuthedRequest).session
      const data = scheduleSchema.parse(req.body)

      const clip = await prisma.videoClip.findUnique({
        where: { id: data.clipId },
        include: { company: true },
      })

      if (!clip || clip.company.userId !== userId) {
        return res.status(404).json({ error: 'clip_not_found' })
      }

      // Verify both visual and copy are approved
      if (clip.visualApprovalStatus !== 'approved' || clip.copyApprovalStatus !== 'approved') {
        return res.status(400).json({
          error: 'not_ready',
          message: 'Both visual and caption must be approved before scheduling',
        })
      }

      // Store scheduled time and platform (actual posting happens via scheduler)
      await prisma.videoClip.update({
        where: { id: data.clipId },
        data: {
          status: 'scheduled',
          adjustments: {
            ...(clip.adjustments as Record<string, unknown> || {}),
            scheduledTime: data.scheduledTime.toISOString(),
            platform: data.platform,
          } as any,
        },
      })

      res.json({
        success: true,
        message: `Scheduled for ${data.scheduledTime.toLocaleString()} UTC`,
        clipId: clip.id,
      })
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: 'invalid_input', issues: err.issues })
      }
      console.error('[studio] schedule failed:', err)
      res.status(500).json({ error: 'Failed to schedule clip', message: 'Something went wrong. Please try again.' })
    }
  })

  // ── Get Posting Recommendations (Jordan) ────────────────────────────

  const strategySchema = z.object({
    companyId: z.string(),
    contentType: z.enum(['video', 'image', 'carousel']),
    contentDescription: z.string().optional(),
  })

  /**
   * POST /api/studio/posting-strategy
   * Jordan recommends when to post based on trends + audience behavior
   */
  router.post('/posting-strategy', requireAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as AuthedRequest).session
      const data = strategySchema.parse(req.body)

      const company = await prisma.company.findFirst({
        where: { id: data.companyId, userId },
      })

      if (!company) {
        return res.status(403).json({ error: 'Company not found' })
      }

      const strategy = await postingStrategyService.recommendPostingTimes({
        companyId: company.id,
        contentType: data.contentType,
        contentDescription: data.contentDescription,
      })

      res.json(strategy)
    } catch (err) {
      console.error('[studio] posting-strategy failed:', err)
      res.status(500).json({ error: 'Failed to generate posting strategy' })
    }
  })

  return router
}

/**
 * Extract visual keywords from Riley's segment labels.
 * e.g. "Person interacting with dog near car" → ["person", "dog", "car", "interaction"]
 */
function extractVisualKeywords(labels: string[]): string[] {
  const text = labels.join(' ').toLowerCase()
  const keywords = new Set<string>()

  // People & actions
  if (text.includes('person') || text.includes('people') || text.includes('someone')) keywords.add('person')
  if (text.includes('dog') || text.includes('pet') || text.includes('cat')) keywords.add('pet')
  if (text.includes('car') || text.includes('vehicle') || text.includes('tesla') || text.includes('truck')) keywords.add('vehicle')
  if (text.includes('food') || text.includes('cook') || text.includes('kitchen') || text.includes('eat')) keywords.add('food')
  if (text.includes('gym') || text.includes('workout') || text.includes('exercise') || text.includes('fitness')) keywords.add('fitness')
  if (text.includes('outdoor') || text.includes('nature') || text.includes('beach') || text.includes('mountain')) keywords.add('outdoor')
  if (text.includes('talk') || text.includes('speak') || text.includes('conversation')) keywords.add('talking')

  // Action types
  if (text.includes('opening') || text.includes('closing') || text.includes('reveal')) keywords.add('reveal')
  if (text.includes('interact') || text.includes('playing') || text.includes('touching')) keywords.add('interaction')
  if (text.includes('loading') || text.includes('carrying') || text.includes('lifting') || text.includes('picking')) keywords.add('physical-action')
  if (text.includes('walk') || text.includes('running') || text.includes('moving')) keywords.add('movement')
  if (text.includes('closeup') || text.includes('close-up') || text.includes('detail')) keywords.add('closeup')
  if (text.includes('establishing') || text.includes('wide') || text.includes('scenery')) keywords.add('establishing')

  return [...keywords]
}

export default router
