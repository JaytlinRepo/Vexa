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
import { getPresignedUrl, getPresignedDownloadUrl } from '../services/storage/s3.service'
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

      // Visual and copy approvals can fire concurrently. Both used to
      // findUnique → push to editorialFeedback → update on a plain client,
      // so two parallel rejections each saw the same starting array and
      // last-write-wins dropped one entry. Now we do the full read-modify-
      // write inside an interactive transaction with SELECT FOR UPDATE,
      // which serializes the two rejection paths via Postgres row lock.
      const result = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "video_clips" WHERE id = ${data.clipId} FOR UPDATE`
        const clip = await tx.videoClip.findUnique({
          where: { id: data.clipId },
          include: { company: true, upload: true },
        })
        if (!clip || clip.company.userId !== userId) return { error: 'clip_not_found' as const }

        const segments = (clip.adjustments as any)?.segments || []
        const segmentLabels = segments.map((s: any) => s.label).filter(Boolean)
        const visualKeywords = extractVisualKeywords(segmentLabels)
        const actionDecisions = segments.map((s: any) => {
          const dur = (s.endTime ?? 0) - (s.startTime ?? 0)
          const durationClass: 'short' | 'medium' | 'long' = dur <= 3 ? 'short' : dur <= 5.5 ? 'medium' : 'long'
          return { durationClass, decisionType: 'kept_whole' as const, label: s.label }
        })

        if (data.action === 'approve') {
          await tx.videoClip.update({
            where: { id: clip.id },
            data: { visualApprovalStatus: 'approved' },
          })
          return { mode: 'approved' as const, clip, segmentLabels, visualKeywords, actionDecisions }
        }

        const feedbackHistory = (clip.editorialFeedback as any[]) || []
        feedbackHistory.push({
          type: 'visual',
          reason: data.feedback,
          timestamp: new Date().toISOString(),
          version: (clip.adjustments as any)?.version ?? 1,
        })
        await tx.videoClip.update({
          where: { id: clip.id },
          data: { visualApprovalStatus: 'rejected', editorialFeedback: feedbackHistory },
        })
        return { mode: 'rejected' as const, clip, segmentLabels, visualKeywords, actionDecisions }
      })

      if ('error' in result) {
        return res.status(404).json({ error: 'clip_not_found' })
      }
      const { clip, segmentLabels, visualKeywords, actionDecisions } = result

      // Brand-memory writes happen outside the transaction — they don't
      // affect the lock contention we just resolved and can be slow.
      if (result.mode === 'approved') {
        await recordEditorialFeedback(prisma, {
          companyId: clip.companyId,
          feedback: 'Visual edit approved',
          type: 'visual_approval',
          context: { clipId: clip.id, adjustments: clip.adjustments, styleMetrics: clip.styleMetrics },
          visualKeywords,
          segmentLabels,
          actionDecisions,
        })
        // If the user re-cut this clip before approving, their edits
        // are now signal we trust. Recompute trim-learning right away
        // so the next reel reflects the updated preferences instead of
        // waiting for the daily 11 AM cron.
        if (clip.userEditedSegments) {
          ;(async () => {
            try {
              const { computeTrimLearning, saveTrimLearning } = await import('../services/trimLearning.service')
              const profile = await computeTrimLearning(prisma, clip.companyId)
              if (profile) await saveTrimLearning(prisma, clip.companyId, profile)
            } catch (err) {
              console.warn('[studio] trim-learning refresh after approve failed:', (err as Error).message)
            }
          })()
        }
        res.json({ clip: { id: clip.id, visualApprovalStatus: 'approved' } })
      } else {
        await recordEditorialFeedback(prisma, {
          companyId: clip.companyId,
          feedback: data.feedback || 'Visual edit rejected',
          type: 'visual_rejection',
          context: { clipId: clip.id, previousAdjustments: clip.adjustments },
          visualKeywords,
          segmentLabels,
          actionDecisions,
        })
        if (data.feedback) {
          res.json({ clip: { id: clip.id, visualApprovalStatus: 'rejected' }, action: 'regenerate', message: 'Visual edit queued for revision' })
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

      // Same lock pattern as approve-visual — see the long comment there.
      // editorialFeedback is a JSON array, so the read-push-write race is
      // real. SELECT FOR UPDATE inside an interactive transaction makes the
      // two endpoints take turns when they hit the same clip concurrently.
      const result = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "video_clips" WHERE id = ${data.clipId} FOR UPDATE`
        const clip = await tx.videoClip.findUnique({
          where: { id: data.clipId },
          include: { company: true },
        })
        if (!clip || clip.company.userId !== userId) return { error: 'clip_not_found' as const }

        if (data.action === 'approve') {
          const captionOptions = (clip.captionOptions as any) || []
          const selectedCaption = data.captionId
            ? captionOptions.find((c: any) => c.id === data.captionId)
            : captionOptions[0]
          await tx.videoClip.update({
            where: { id: clip.id },
            data: {
              copyApprovalStatus: 'approved',
              caption: selectedCaption?.text,
              selectedCaptionId: selectedCaption?.id,
            },
          })
          return { mode: 'approved' as const, clip, selectedCaption }
        }

        const feedbackHistory = (clip.editorialFeedback as any[]) || []
        feedbackHistory.push({
          type: 'copy',
          reason: data.feedback,
          timestamp: new Date().toISOString(),
          version: (clip.captionOptions as any)?.length ?? 0,
        })
        await tx.videoClip.update({
          where: { id: clip.id },
          data: { copyApprovalStatus: 'rejected', editorialFeedback: feedbackHistory },
        })
        return { mode: 'rejected' as const, clip }
      })

      if ('error' in result) {
        return res.status(404).json({ error: 'clip_not_found' })
      }

      // Brand-memory writes happen outside the transaction.
      if (result.mode === 'approved') {
        await recordEditorialFeedback(prisma, {
          companyId: result.clip.companyId,
          feedback: `Caption approved: "${result.selectedCaption?.text.slice(0, 100)}"`,
          type: 'copy_approval',
          context: { clipId: result.clip.id, selectedCaption: result.selectedCaption },
        })
        res.json({ clip: { id: result.clip.id, copyApprovalStatus: 'approved' } })
      } else {
        await recordEditorialFeedback(prisma, {
          companyId: result.clip.companyId,
          feedback: data.feedback || 'Caption rejected',
          type: 'copy_rejection',
          context: { clipId: result.clip.id, previousCaptions: result.clip.captionOptions },
        })
        res.json({ clip: { id: result.clip.id, copyApprovalStatus: 'rejected' }, action: 'regenerate', message: 'Caption queued for revision' })
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
          // Resolve segment thumbnail S3 keys → presigned URLs so the
          // approval card can render the trim/re-cut strip directly.
          // Empty array (rather than null) when none were generated.
          const thumbKeys: string[] = Array.isArray(clip.segmentThumbnails)
            ? (clip.segmentThumbnails as string[])
            : []
          const segmentThumbnailUrls = await Promise.all(
            thumbKeys.map((k) =>
              getPresignedUrl(k, 3600).catch(() => null),
            ),
          )
          // Source duration bounds the recut studio's extend handles —
          // sent as `sourceDuration` so the frontend doesn't have to
          // ffprobe the source.
          const sourceDuration = clip.upload?.duration ?? null
          // sourceAvailable tells the UI whether the user can still
          // re-cut. Drives the Re-cut icon button's enabled/disabled
          // state and the "re-upload to edit" tooltip. We treat the
          // upload as gone when EITHER the explicit purge flag is set,
          // OR there's no resolvable sourceVideoUrl at all.
          const sourceAvailable = !!clip.upload
            && !(clip.upload as any).sourcePurgedAt
            && !!sourceVideoUrl
          return { ...clip, clippedUrl: url, sourceVideoUrl, segmentThumbnailUrls, sourceDuration, sourceAvailable }
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
      const updated = await prisma.videoClip.update({
        where: { id: clipId },
        data: { status: 'archived' },
        select: { uploadId: true },
      })

      // If this archive made all sibling clips terminal, the upload's
      // source MP4 may now be eligible for purge. Fire-and-forget; the
      // helper enforces a grace period so a recent recut won't lose its
      // source the second the user discards.
      const { schedulePurgeCheck } = await import('../lib/sourcePurge.service')
      schedulePurgeCheck(prisma, updated.uploadId)

      res.json({ success: true, message: 'Clip discarded' })
    } catch (err) {
      console.error('[studio] discard failed:', err)
      res.status(500).json({ error: 'Failed to discard clip' })
    }
  })

  // ── Mark Ready ──────────────────────────────────────────────────────
  // Auto-posting isn't built yet. Until it is, "scheduled" was a lie — the
  // clip went into a `scheduled` status that no worker ever read, so users
  // saw a success toast and nothing ever posted. This endpoint just marks
  // the clip as Ready and stores the user's preferred platform as a hint
  // for the eventual auto-poster. No fake scheduledTime is written.

  const markReadySchema = z.object({
    clipId: z.string().cuid(),
    platform: z.enum(['instagram', 'tiktok']).default('instagram'),
  })

  router.post('/mark-ready', requireAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as AuthedRequest).session
      const data = markReadySchema.parse(req.body)

      const clip = await prisma.videoClip.findUnique({
        where: { id: data.clipId },
        include: { company: true },
      })

      if (!clip || clip.company.userId !== userId) {
        return res.status(404).json({ error: 'clip_not_found' })
      }

      // Captions UI was retired with Alex (copywriter). The frontend can no
      // longer surface caption approval, so the only enforceable gate is
      // visual approval. Anything else would render the Save as Ready
      // button permanently unreachable.
      if (clip.visualApprovalStatus !== 'approved') {
        return res.status(400).json({
          error: 'not_ready',
          message: 'Approve the visual before saving as ready.',
        })
      }

      const updated = await prisma.videoClip.update({
        where: { id: data.clipId },
        data: {
          status: 'ready',
          adjustments: {
            ...(clip.adjustments as Record<string, unknown> || {}),
            platform: data.platform,
          } as any,
        },
        select: { uploadId: true },
      })

      // The clip just shipped. If every sibling clip from the same
      // upload has also shipped (and the grace period has elapsed),
      // the source MP4 will be deleted from S3 in the background.
      const { schedulePurgeCheck } = await import('../lib/sourcePurge.service')
      schedulePurgeCheck(prisma, updated.uploadId)

      res.json({ success: true, message: 'Saved as ready', clipId: clip.id })
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: 'invalid_input', issues: err.issues })
      }
      console.error('[studio] mark-ready failed:', err)
      res.status(500).json({ error: 'Failed to save clip', message: 'Something went wrong. Please try again.' })
    }
  })

  // ── Download clip ───────────────────────────────────────────────────
  // Returns a short-lived presigned S3 URL with Content-Disposition:
  // attachment so the browser saves the file instead of streaming it inline.
  // The frontend triggers the download by navigating to / clicking the URL.
  router.get('/clip/:clipId/download', requireAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as AuthedRequest).session
      const { clipId } = req.params
      const clip = await prisma.videoClip.findUnique({
        where: { id: clipId },
        include: { company: { select: { userId: true, name: true } } },
      })
      if (!clip || clip.company.userId !== userId) {
        return res.status(404).json({ error: 'clip_not_found' })
      }
      // Only S3-hosted reels can be downloaded — Descript share links are not.
      const url = clip.clippedUrl
      if (!url || !url.startsWith('s3://')) {
        return res.status(400).json({ error: 'not_downloadable', message: 'This clip can\'t be downloaded yet.' })
      }
      const key = url.replace('s3://', '')
      const slug = (clip.company.name || 'reel').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 32) || 'reel'
      const filename = `${slug}-${clip.id.slice(-8)}.mp4`
      const downloadUrl = await getPresignedDownloadUrl({ key, downloadFilename: filename, expiresIn: 600 })
      // A download is a strong "saved this clip" signal — counts the
      // same as approval for trim-learning purposes. If the user
      // re-cut before downloading, flip the clip to approved (so the
      // aggregator gate counts it) and refresh trim-learning.
      // Without the flip the gate filter would skip the very clip we
      // just downloaded — keeping comment + behavior aligned.
      if (clip.userEditedSegments) {
        ;(async () => {
          try {
            if (clip.visualApprovalStatus === 'pending') {
              await prisma.videoClip.update({
                where: { id: clip.id },
                data: { visualApprovalStatus: 'approved' },
              })
            }
            const { computeTrimLearning, saveTrimLearning } = await import('../services/trimLearning.service')
            const profile = await computeTrimLearning(prisma, clip.companyId)
            if (profile) await saveTrimLearning(prisma, clip.companyId, profile)
          } catch (err) {
            console.warn('[studio] trim-learning refresh after download failed:', (err as Error).message)
          }
        })()
      }
      res.json({ url: downloadUrl, filename })
    } catch (err) {
      console.error('[studio] download presign failed:', err)
      res.status(500).json({ error: 'download_failed', message: 'Couldn\'t prepare your download. Please try again.' })
    }
  })

  // ── Scheduling ──────────────────────────────────────────────────────
  // Two endpoints. Auto-poster isn't built; these just persist the user's
  // intent and feed the studio bottom-ticker. Status flips to 'scheduled'
  // so the clip leaves the pending queue but isn't treated as posted.
  router.post('/clip/:clipId/schedule', requireAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as AuthedRequest).session
      const { clipId } = req.params
      const scheduledFor = req.body?.scheduledFor
      const platform = typeof req.body?.platform === 'string' ? req.body.platform : 'instagram'
      // Caption is optional — passing null/undefined leaves whatever's
      // already on the clip untouched. Passing an empty string clears
      // it. IG cap is 2,200 chars; we trim leading/trailing whitespace
      // but otherwise preserve what the user typed (linebreaks, emoji,
      // hashtags). Captions can also be edited later via this same
      // endpoint with the existing scheduledFor unchanged.
      const captionRaw = req.body?.caption
      const captionProvided = typeof captionRaw === 'string'
      const caption = captionProvided ? captionRaw.trim().slice(0, 2200) : undefined
      if (!scheduledFor || typeof scheduledFor !== 'string') {
        return res.status(400).json({ error: 'invalid_schedule', message: 'scheduledFor (ISO timestamp) is required.' })
      }
      const when = new Date(scheduledFor)
      if (isNaN(when.getTime())) {
        return res.status(400).json({ error: 'invalid_schedule', message: 'scheduledFor must be a valid ISO timestamp.' })
      }
      if (when.getTime() < Date.now() - 60_000) {
        return res.status(400).json({ error: 'past_schedule', message: 'Schedule a time in the future.' })
      }
      const clip = await prisma.videoClip.findFirst({
        where: { id: clipId, company: { userId } },
        select: { id: true, visualApprovalStatus: true },
      })
      if (!clip) return res.status(404).json({ error: 'clip_not_found' })
      // Scheduling implies approval — the user is committing to publish.
      const updated = await prisma.videoClip.update({
        where: { id: clip.id },
        data: {
          scheduledFor: when,
          scheduledPlatform: platform,
          status: 'scheduled',
          ...(captionProvided ? { caption: caption || null, copyApprovalStatus: caption ? 'approved' : 'pending' } : {}),
          ...(clip.visualApprovalStatus === 'pending' ? { visualApprovalStatus: 'approved' } : {}),
        },
        select: {
          id: true,
          scheduledFor: true,
          scheduledPlatform: true,
          status: true,
          caption: true,
        },
      })
      res.json({ clip: updated })
    } catch (err) {
      console.error('[studio] schedule failed:', err)
      res.status(500).json({ error: 'schedule_failed', message: 'Couldn\'t schedule that clip. Please try again.' })
    }
  })

  router.delete('/clip/:clipId/schedule', requireAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as AuthedRequest).session
      const { clipId } = req.params
      const clip = await prisma.videoClip.findFirst({
        where: { id: clipId, company: { userId } },
        select: { id: true },
      })
      if (!clip) return res.status(404).json({ error: 'clip_not_found' })
      await prisma.videoClip.update({
        where: { id: clip.id },
        data: { scheduledFor: null, scheduledPlatform: null, status: 'ready_to_post' },
      })
      res.json({ ok: true })
    } catch (err) {
      console.error('[studio] unschedule failed:', err)
      res.status(500).json({ error: 'unschedule_failed' })
    }
  })

  router.get('/scheduled', requireAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as AuthedRequest).session
      const company = await prisma.company.findFirst({
        where: { userId },
        select: { id: true },
      })
      if (!company) return res.json({ scheduled: [] })
      // Show all upcoming scheduled clips for this company. Limit to 20 to
      // keep the ticker payload tiny — anyone with more than 20 future
      // posts can paginate later.
      const rows = await prisma.videoClip.findMany({
        where: {
          companyId: company.id,
          scheduledFor: { gte: new Date(Date.now() - 60_000) },
        },
        orderBy: { scheduledFor: 'asc' },
        take: 20,
        select: {
          id: true,
          duration: true,
          hook: true,
          caption: true,
          scheduledFor: true,
          scheduledPlatform: true,
          segmentThumbnails: true,
        },
      })
      // Presign the first thumbnail per clip for the ticker preview.
      const scheduled = await Promise.all(
        rows.map(async (clip) => {
          let thumbUrl: string | null = null
          const thumbs = Array.isArray(clip.segmentThumbnails) ? (clip.segmentThumbnails as string[]) : []
          if (thumbs.length > 0) {
            try { thumbUrl = await getPresignedUrl(thumbs[0], 3600) } catch { thumbUrl = null }
          }
          return {
            id: clip.id,
            duration: clip.duration,
            hook: clip.hook,
            caption: clip.caption,
            scheduledFor: clip.scheduledFor,
            scheduledPlatform: clip.scheduledPlatform,
            thumbUrl,
          }
        }),
      )
      res.json({ scheduled })
    } catch (err) {
      console.error('[studio] scheduled list failed:', err)
      res.status(500).json({ error: 'scheduled_list_failed' })
    }
  })

  // ── Backfill segment thumbnails for older clips ─────────────────────
  // Clips processed before the per-segment thumbnail step shipped have
  // segmentThumbnails: null. The Re-cut studio renders camera-emoji
  // placeholders for those, which looks broken. This route generates
  // the missing thumbnails on demand the FIRST time the user opens the
  // studio for that clip. Subsequent opens are instant — the keys are
  // persisted on the clip row and the /pending route already presigns
  // them on every fetch.
  router.post('/clip/:clipId/backfill-thumbs', requireAuth, async (req: Request, res: Response) => {
    let workSourcePath: string | null = null
    try {
      const { userId } = (req as AuthedRequest).session
      const { clipId } = req.params
      const clip = await prisma.videoClip.findFirst({
        where: { id: clipId, company: { userId } },
        include: { upload: true },
      })
      if (!clip) { res.status(404).json({ error: 'clip_not_found' }); return }
      const adj = (clip.adjustments as any) ?? {}
      const segments = Array.isArray(adj.segments) ? adj.segments : []
      if (segments.length === 0) { res.status(400).json({ error: 'no_segments' }); return }

      // Already populated — return the existing keys (the /pending
      // route presigns them; we can presign them here too for parity).
      const existing = Array.isArray(clip.segmentThumbnails)
        ? (clip.segmentThumbnails as string[])
        : null
      if (existing && existing.length > 0) {
        const urls = await Promise.all(existing.map((k) => getPresignedUrl(k, 3600).catch(() => null)))
        res.json({ segmentThumbnailUrls: urls, fromCache: true })
        return
      }

      // Resolve source URL the same way the recut endpoint does.
      const rawSrc: string | undefined = clip.upload?.sourceVideoUrl
      if (!rawSrc) { res.status(400).json({ error: 'source_missing' }); return }
      let sourceUrlForBuild: string
      if (rawSrc.startsWith('s3://')) {
        sourceUrlForBuild = await getPresignedUrl(rawSrc.replace('s3://', ''), 3600)
      } else if (rawSrc.includes('vexa-outputs')) {
        const keyMatch = rawSrc.match(/vexa-outputs\.s3[^/]*\.amazonaws\.com\/([^?]+)/)
        if (!keyMatch) { res.status(400).json({ error: 'source_unresolved' }); return }
        sourceUrlForBuild = await getPresignedUrl(decodeURIComponent(keyMatch[1]), 3600)
      } else {
        sourceUrlForBuild = rawSrc
      }

      // Download source once, extract one frame per segment, upload to S3.
      // Same shape as the live processing pipeline so the resulting
      // keys read identically downstream.
      const path = await import('path')
      const os = await import('os')
      const fs = await import('fs')
      const axios = (await import('axios')).default
      const { execFile } = await import('child_process')
      const { promisify } = await import('util')
      const execFileAsync = promisify(execFile)
      const { uploadFile } = await import('../services/storage/s3.service')
      const tmpDir = path.join(os.tmpdir(), `sovexa-backfill-${clipId}`)
      fs.mkdirSync(tmpDir, { recursive: true })
      workSourcePath = path.join(tmpDir, 'source.mp4')
      const dl = await axios.get(sourceUrlForBuild, { responseType: 'arraybuffer', timeout: 180000 })
      fs.writeFileSync(workSourcePath, Buffer.from(dl.data))

      const newThumbs: string[] = []
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]
        const sampleAt = Math.min(seg.startTime + 0.3, seg.endTime - 0.05)
        const localThumb = path.join(tmpDir, `seg-${String(i).padStart(2, '0')}.jpg`)
        try {
          await execFileAsync(
            'ffmpeg',
            ['-y', '-ss', String(sampleAt), '-i', workSourcePath, '-frames:v', '1', '-vf', 'scale=240:-2', '-q:v', '5', localThumb],
            { timeout: 8000 },
          )
          const buf = fs.readFileSync(localThumb)
          const s3Key = `studio/thumbs/${clip.companyId}/${Date.now()}-${clipId}-bf-seg${String(i).padStart(2, '0')}.jpg`
          await uploadFile({ key: s3Key, body: buf, contentType: 'image/jpeg' })
          newThumbs.push(s3Key)
        } catch (err) {
          console.warn(`[studio] backfill thumb seg ${i} failed:`, (err as Error).message?.slice(0, 100))
        }
      }
      await prisma.videoClip.update({
        where: { id: clipId },
        data: { segmentThumbnails: newThumbs.length > 0 ? newThumbs : (clip.segmentThumbnails as any) },
      })
      const urls = await Promise.all(newThumbs.map((k) => getPresignedUrl(k, 3600).catch(() => null)))
      console.log(`[studio] backfilled ${newThumbs.length}/${segments.length} thumbs for clip ${clipId}`)
      res.json({ segmentThumbnailUrls: urls, fromCache: false })
    } catch (err: any) {
      console.error('[studio] backfill-thumbs failed:', err)
      res.status(500).json({ error: 'backfill_failed', message: err?.message })
    } finally {
      if (workSourcePath) {
        try {
          const fs = await import('fs')
          const path = await import('path')
          fs.rmSync(path.dirname(workSourcePath), { recursive: true, force: true })
        } catch {}
      }
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

  // ── Re-cut: drop selected segments and rebuild the reel ─────────────
  // Takes a list of segment indices the user chose to KEEP from the
  // clip's original adjustments.segments. The endpoint:
  //   1. Validates ownership and that ≥2 segments would remain
  //   2. Re-runs buildReel with only the kept segments (source video
  //      already lives in S3 — no re-upload of the user's footage)
  //   3. Overwrites clippedUrl with the new reel and re-extracts the
  //      thumbnail strip so the UI reflects the new segments
  //   4. Stamps userEditedSegments / userEditedAt / editVersion+1 so
  //      the learning aggregator can see what the user actually wants
  // Tier-2 recut payload — supports both:
  //   keepIndices: number[]                                  (drop-only, Tier 1)
  //   keepSegments: { index, startTime, endTime }[]          (drop + trim, Tier 2)
  // The two are mutually exclusive; the client sends one or the other.
  // keepSegments must reference valid indices and stay within each
  // segment's original bounds (you can shrink, never extend past the
  // source moment Riley chose). At least 2 entries always required.
  const recutSchema = z
    .object({
      keepIndices: z.array(z.number().int().nonnegative()).optional(),
      keepSegments: z
        .array(
          z.object({
            index: z.number().int().nonnegative(),
            startTime: z.number().nonnegative(),
            endTime: z.number().positive(),
          }),
        )
        .optional(),
    })
    .refine(
      (d) => (d.keepIndices && d.keepIndices.length >= 2) || (d.keepSegments && d.keepSegments.length >= 2),
      { message: 'keepIndices or keepSegments must contain at least 2 entries' },
    )

  router.post('/clips/:id/recut', requireAuth, async (req: Request, res: Response) => {
    const startedAt = Date.now()
    let workSourcePath: string | null = null
    try {
      const { userId } = (req as AuthedRequest).session
      const clipId = req.params.id
      const parsed = recutSchema.parse(req.body)

      const clip = await prisma.videoClip.findFirst({
        where: { id: clipId, company: { userId } },
        include: { upload: true },
      })
      if (!clip) { res.status(404).json({ error: 'clip_not_found' }); return }

      const adj = (clip.adjustments as any) ?? {}
      const allSegments = Array.isArray(adj.segments) ? adj.segments : []
      if (allSegments.length === 0) {
        res.status(400).json({ error: 'no_segments_on_clip' })
        return
      }

      // Normalize whichever payload shape we got into a single
      // `keptSegments` array (in chronological order, trimmed to the
      // original segment's bounds).
      type Kept = { index: number; startTime: number; endTime: number; label?: string; energy?: string }
      let keptSegments: Kept[] = []
      let trimApplied = false
      if (parsed.keepSegments && parsed.keepSegments.length > 0) {
        // Tier 2: trim-aware AND extend-aware. Bounds can extend past
        // Riley's chosen window (so the user can recover a moment that
        // was cut), but only as far as the source allows. Neighbors
        // come into play after we've placed every kept segment.
        const sourceDuration = clip.upload?.duration ?? 0
        const seenIdx = new Set<number>()
        for (const item of parsed.keepSegments) {
          if (item.index < 0 || item.index >= allSegments.length) continue
          if (seenIdx.has(item.index)) continue
          seenIdx.add(item.index)
          const orig = allSegments[item.index]
          // Clamp to [0, sourceDuration] only — NOT to the original
          // segment's bounds. Letting bounds grow lets the user recover
          // moments Riley trimmed away (e.g. extend a 2.5s pour to 4s
          // because the actual finish-pour happens 1.5s later in the
          // source). The clamp here is purely against impossible
          // values (negative time / past EOF).
          let lo = Math.max(0, item.startTime)
          let hi = sourceDuration > 0 ? Math.min(sourceDuration, item.endTime) : item.endTime
          // Enforce the same 2.0s floor as elsewhere in the pipeline.
          // 1.0s floor: any shorter is a single-beat glitch. Frontend
          // enforces the same minimum on the drag handles.
          if (hi - lo < 1.0) continue
          // Track whether the user moved EITHER bound vs Riley's pick —
          // this drives the trim-vs-extend signal in the aggregator.
          if (Math.abs(lo - orig.startTime) > 0.05 || Math.abs(hi - orig.endTime) > 0.05) {
            trimApplied = true
          }
          keptSegments.push({
            index: item.index,
            startTime: lo,
            endTime: hi,
            label: orig.label,
            energy: orig.energy,
          })
        }
        // Reorder support: keepSegments arrives in REEL ORDER (the
        // sequence the user wants in the output reel). When that
        // happens to match source-chronological order, we apply the
        // legacy sort + neighbor-overlap squeeze (so adjacent extends
        // don't fight each other). When the user has reordered the
        // segments, we preserve their order verbatim — segments that
        // overlap in source time are concatenated independently into
        // the reel, which is exactly what the user asked for.
        const inChronOrder = keptSegments.every(
          (s, i) => i === 0 || keptSegments[i - 1].startTime <= s.startTime + 0.001,
        )
        if (inChronOrder) {
          keptSegments.sort((a, b) => a.startTime - b.startTime)
          // Neighbor pass: enforce non-overlap with the segment
          // immediately before / after on the timeline. If two
          // extensions collide we shrink BOTH back so neither crosses
          // the midpoint of the gap. This preserves the user's intent
          // (both want more) while producing a buildReel-safe list.
          for (let i = 0; i + 1 < keptSegments.length; i++) {
            const a = keptSegments[i]
            const b = keptSegments[i + 1]
            if (a.endTime <= b.startTime + 0.001) continue
            const overlap = a.endTime - b.startTime
            const mid = (a.endTime + b.startTime) / 2
            a.endTime = mid
            b.startTime = mid
            // If the squeeze drops either below the floor, shave the
            // other one to keep both legal. Caller will see the
            // no_change error if everything degenerates.
            if (a.endTime - a.startTime < 1.0) a.startTime = Math.max(0, a.endTime - 1.0)
            if (b.endTime - b.startTime < 1.0) b.endTime = b.startTime + 1.0
            void overlap
          }
          // Drop any segments that ended up too short after squeeze.
          keptSegments = keptSegments.filter((k) => k.endTime - k.startTime >= 1.0)
        }
        if (keptSegments.length < 2) {
          res.status(400).json({ error: 'need_at_least_two_segments' })
          return
        }
      } else {
        // Tier 1: drop-only. De-dup + sort indices, drop out-of-range.
        const validIdx = Array.from(new Set(parsed.keepIndices ?? []))
          .filter((i) => i >= 0 && i < allSegments.length)
          .sort((a, b) => a - b)
        if (validIdx.length < 2) {
          res.status(400).json({ error: 'need_at_least_two_segments' })
          return
        }
        if (validIdx.length === allSegments.length) {
          res.status(400).json({ error: 'no_change' })
          return
        }
        keptSegments = validIdx.map((i) => ({
          index: i,
          startTime: allSegments[i].startTime,
          endTime: allSegments[i].endTime,
          label: allSegments[i].label,
          energy: allSegments[i].energy,
        }))
      }
      // No-op detection for Tier 2: same indices AND same bounds = no real change.
      if (
        !trimApplied &&
        keptSegments.length === allSegments.length &&
        keptSegments.every((k, i) => k.index === i)
      ) {
        res.status(400).json({ error: 'no_change' })
        return
      }

      // Pull the source video. videoUpload.sourceVideoUrl is either an
      // s3:// reference or a presigned URL containing the key. Resolve to
      // a fresh presigned URL so buildReel can stream it.
      // If the source has been explicitly purged (Tier 2 cleanup), refuse
      // with a clear, actionable error so the frontend can show the
      // "re-upload to edit" hint instead of a generic 500.
      if (clip.upload && (clip.upload as any).sourcePurgedAt) {
        res.status(410).json({
          error: 'source_purged',
          message: 'The original upload has been removed to save space. Re-upload it to edit this clip again.',
        })
        return
      }
      const rawSrc: string | undefined = clip.upload?.sourceVideoUrl
      if (!rawSrc) { res.status(400).json({ error: 'source_missing' }); return }
      let sourceUrlForBuild: string
      if (rawSrc.startsWith('s3://')) {
        sourceUrlForBuild = await getPresignedUrl(rawSrc.replace('s3://', ''), 3600)
      } else if (rawSrc.includes('vexa-outputs')) {
        // Already a presigned URL — refresh it. Match the pending-route
        // logic so we never use a stale signature.
        const keyMatch = rawSrc.match(/vexa-outputs\.s3[^/]*\.amazonaws\.com\/([^?]+)/)
        if (!keyMatch) { res.status(400).json({ error: 'source_unresolved' }); return }
        sourceUrlForBuild = await getPresignedUrl(decodeURIComponent(keyMatch[1]), 3600)
      } else {
        sourceUrlForBuild = rawSrc
      }

      // Run the rebuild. ffmpegClipper handles segment extraction +
      // concat; reuses our existing reel-render path so quality matches
      // the original.
      const { buildReel } = await import('../lib/ffmpegClipper.service')
      // Build the segment list buildReel expects (label/energy must be
      // present, even if Kept made them optional during parsing).
      const segmentsForBuild = keptSegments.map((k) => ({
        startTime: k.startTime,
        endTime: k.endTime,
        label: k.label ?? '',
        energy: (k.energy as 'hook' | 'high' | 'medium') ?? 'medium',
      }))
      const result = await buildReel({
        sourceUrl: sourceUrlForBuild,
        segments: segmentsForBuild,
        companyId: clip.companyId,
        uploadId: clip.uploadId,
        // creatorFilters are not persisted on the clip, but the original
        // reel was built without them on most paths today. Leaving null
        // means the new cut uses the same defaults the first cut did.
      })

      // Re-extract per-segment thumbnails for the NEW segment list so
      // the strip stays in sync after re-cut. We need a local copy of
      // the source for ffmpeg seek-and-grab; download once and reuse.
      const path = await import('path')
      const os = await import('os')
      const fs = await import('fs')
      const axios = (await import('axios')).default
      const { execFile } = await import('child_process')
      const { promisify } = await import('util')
      const execFileAsync = promisify(execFile)
      const thumbsDir = path.join(os.tmpdir(), `sovexa-recut-thumbs-${clipId}`)
      fs.mkdirSync(thumbsDir, { recursive: true })
      workSourcePath = path.join(thumbsDir, 'source.mp4')
      const dl = await axios.get(sourceUrlForBuild, { responseType: 'arraybuffer', timeout: 180000 })
      fs.writeFileSync(workSourcePath, Buffer.from(dl.data))
      const newThumbs: string[] = []
      for (let i = 0; i < keptSegments.length; i++) {
        try {
          const seg = keptSegments[i]
          const sampleAt = Math.min(seg.startTime + 0.3, seg.endTime - 0.05)
          const localThumb = path.join(thumbsDir, `seg-${String(i).padStart(2, '0')}.jpg`)
          await execFileAsync(
            'ffmpeg',
            ['-y', '-ss', String(sampleAt), '-i', workSourcePath, '-frames:v', '1', '-vf', 'scale=240:-2', '-q:v', '5', localThumb],
            { timeout: 8000 },
          )
          const buf = fs.readFileSync(localThumb)
          const s3Key = `studio/thumbs/${clip.companyId}/${Date.now()}-${clipId}-v${(clip.editVersion ?? 0) + 1}-seg${String(i).padStart(2, '0')}.jpg`
          const { uploadFile } = await import('../services/storage/s3.service')
          await uploadFile({ key: s3Key, body: buf, contentType: 'image/jpeg' })
          newThumbs.push(s3Key)
        } catch (err) {
          console.warn(`[studio] recut thumbnail seg ${i} failed:`, (err as Error).message?.slice(0, 100))
        }
      }

      // Capture S3 keys we're about to ORPHAN so we can purge them
      // after the update succeeds. The old reel MP4 (clip.clippedUrl)
      // becomes unreachable the moment the new s3Key replaces it.
      // Same for segmentThumbnails IF we generated fresh ones — when
      // newThumbs is empty we're carrying the old keys forward, so
      // those must NOT be deleted. Descript share links (non-s3://)
      // are skipped — they're not ours to delete.
      const orphanedReelKey = (() => {
        const u = clip.clippedUrl
        if (typeof u !== 'string' || !u.startsWith('s3://')) return null
        return u.slice('s3://'.length)
      })()
      const orphanedThumbKeys: string[] = newThumbs.length > 0
        && Array.isArray(clip.segmentThumbnails)
          ? (clip.segmentThumbnails as string[]).filter((k): k is string => typeof k === 'string' && k.length > 0)
          : []

      // Persist. Bump editVersion so the aggregator can later count
      // average edits per clip per creator.
      const updated = await prisma.videoClip.update({
        where: { id: clipId },
        data: {
          clippedUrl: `s3://${result.s3Key}`,
          duration: Math.round(result.duration),
          segmentThumbnails: newThumbs.length > 0 ? newThumbs : (clip.segmentThumbnails as any),
          // adjustments.segments stays as Riley's original pick — the
          // user's final list is the new field. This keeps the diff
          // (Riley's pick − user's keep) computable forever.
          userEditedSegments: keptSegments as any,
          userEditedAt: new Date(),
          editVersion: { increment: 1 },
        },
      })

      // Fire-and-forget purge of orphaned recut artifacts. Runs after
      // the DB update commits so a delete failure can't corrupt state
      // — at worst we leave the old objects in S3 (eventually swept by
      // the bucket's lifecycle policy). Don't await: the user response
      // shouldn't block on cleanup.
      if (orphanedReelKey || orphanedThumbKeys.length > 0) {
        ;(async () => {
          try {
            const { deleteFile } = await import('../services/storage/s3.service')
            const tasks: Promise<unknown>[] = []
            if (orphanedReelKey && orphanedReelKey !== result.s3Key) {
              tasks.push(deleteFile(orphanedReelKey).catch((e) =>
                console.warn(`[studio] recut purge: failed to delete reel ${orphanedReelKey}:`, (e as Error).message)))
            }
            for (const k of orphanedThumbKeys) {
              tasks.push(deleteFile(k).catch((e) =>
                console.warn(`[studio] recut purge: failed to delete thumb ${k}:`, (e as Error).message)))
            }
            await Promise.all(tasks)
            const totalDeleted = (orphanedReelKey ? 1 : 0) + orphanedThumbKeys.length
            if (totalDeleted > 0) {
              console.log(`[studio] recut purge: deleted ${totalDeleted} orphan object(s) for clip ${clipId} (${orphanedReelKey ? '1 reel + ' : ''}${orphanedThumbKeys.length} thumbs)`)
            }
          } catch (err) {
            console.warn('[studio] recut purge failed:', (err as Error).message)
          }
        })()
      }

      // Resolve the new playback URL + thumbnail URLs for the UI
      const playUrl = await getPresignedUrl(result.s3Key, 3600)
      const thumbUrls = await Promise.all(
        (updated.segmentThumbnails as string[] | null ?? []).map((k) =>
          getPresignedUrl(k, 3600).catch(() => null),
        ),
      )

      console.log(`[studio] recut clip=${clipId} kept=${keptSegments.length}/${allSegments.length} new_dur=${result.duration.toFixed(1)}s in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)

      res.json({
        clip: {
          id: updated.id,
          clippedUrl: playUrl,
          duration: updated.duration,
          editVersion: updated.editVersion,
          segments: keptSegments,
          segmentThumbnailUrls: thumbUrls,
        },
      })
    } catch (err: any) {
      if (err?.name === 'ZodError') {
        res.status(400).json({ error: 'invalid_request', issues: err.issues })
        return
      }
      console.error('[studio] recut failed:', err)
      res.status(500).json({ error: 'recut_failed', message: err?.message })
    } finally {
      if (workSourcePath) {
        try {
          const fs = await import('fs')
          const path = await import('path')
          fs.rmSync(path.dirname(workSourcePath), { recursive: true, force: true })
        } catch {}
      }
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
