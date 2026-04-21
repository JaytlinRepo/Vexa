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
import { requireAuth, AuthedRequest } from '../middleware/auth'
import { recordEditorialFeedback } from '../lib/brandMemory'
import StudioVisualEditingService from '../lib/studioVisualEditing.service'
import StudioCopywritingService from '../lib/studioCopywriting.service'

const router = Router()
let prisma: PrismaClient
let visualEditingService: StudioVisualEditingService
let copywritingService: StudioCopywritingService

export function initStudioRoutes(_prisma: PrismaClient) {
  prisma = _prisma
  visualEditingService = new StudioVisualEditingService(prisma)
  copywritingService = new StudioCopywritingService(prisma)

  // ── Approve/Reject Visual Edit ──────────────────────────────────────────

  const approveVisualSchema = z.object({
    clipId: z.string().cuid(),
    action: z.enum(['approve', 'reject']),
    feedback: z.string().max(500).optional(),
  })

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

      if (data.action === 'approve') {
        // Approve visual
        await prisma.videoClip.update({
          where: { id: clip.id },
          data: {
            visualApprovalStatus: 'approved',
          },
        })

        // Record approval in brand memory
        await recordEditorialFeedback(prisma, {
          companyId: clip.companyId,
          feedback: 'Visual edit approved',
          type: 'visual_approval',
          context: {
            clipId: clip.id,
            adjustments: clip.adjustments,
            styleMetrics: clip.styleMetrics,
          },
        })

        res.json({ clip: { id: clip.id, visualApprovalStatus: 'approved' } })
      } else {
        // Reject visual and queue for re-edit
        const feedbackHistory = (clip.editorialFeedback as any[]) || []
        feedbackHistory.push({
          type: 'visual',
          reason: data.feedback,
          timestamp: new Date().toISOString(),
          version: clip.adjustments?.version ?? 1,
        })

        await prisma.videoClip.update({
          where: { id: clip.id },
          data: {
            visualApprovalStatus: 'rejected',
            editorialFeedback: feedbackHistory,
          },
        })

        // Record rejection in brand memory
        await recordEditorialFeedback(prisma, {
          companyId: clip.companyId,
          feedback: data.feedback || 'Visual edit rejected',
          type: 'visual_rejection',
          context: {
            clipId: clip.id,
            previousAdjustments: clip.adjustments,
          },
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
      console.error('[studio] approve-visual failed:', err)
      res.status(500).json({ error: 'Failed to process visual approval' })
    }
  })

  // ── Approve/Reject Copy ──────────────────────────────────────────────────

  const approveCopySchema = z.object({
    clipId: z.string().cuid(),
    action: z.enum(['approve', 'reject']),
    captionId: z.string().optional(), // Which caption option they chose
    feedback: z.string().max(500).optional(),
  })

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
      console.error('[studio] approve-copy failed:', err)
      res.status(500).json({ error: 'Failed to process copy approval' })
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
      console.error('[studio] regenerate failed:', err)
      res.status(500).json({ error: 'Failed to regenerate content' })
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

      res.json({ clips: pendingClips })
    } catch (err) {
      console.error('[studio] get pending failed:', err)
      res.status(500).json({ error: 'Failed to fetch pending approvals' })
    }
  })

  return router
}

export default router
