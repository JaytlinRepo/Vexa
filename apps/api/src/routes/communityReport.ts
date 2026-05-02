import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import prisma from '../lib/prisma'

const router = Router()

const REPORT_REASONS = ['spam', 'offensive', 'misleading', 'copyright', 'other'] as const

const reportBodySchema = z.object({
  postId: z.string().uuid(),
  reason: z.enum(REPORT_REASONS),
  notes: z.string().max(2000).optional(),
})

/**
 * POST /api/community/report
 *
 * Report a community-contributed post. The first report against a post
 * immediately hides it from every community feed (sets communityHiddenAt)
 * and creates a CommunityReport row. Subsequent reports are recorded too,
 * so admins can see how many users flagged the same item, but the hide
 * action is idempotent (we only set communityHiddenAt when it's still null).
 */
router.post('/report', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const parsed = reportBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_input', issues: parsed.error.issues })
      return
    }
    const { postId, reason, notes } = parsed.data

    const post = await prisma.platformPost.findUnique({
      where: { id: postId },
      select: {
        id: true,
        communityTaggedAt: true,
        communityHiddenAt: true,
        account: { select: { companyId: true } },
      },
    })
    if (!post || !post.communityTaggedAt) {
      res.status(404).json({ error: 'post_not_found' })
      return
    }

    // The reporter's company id (best-effort, used for analytics only).
    const reporterCompany = await prisma.company.findFirst({
      where: { userId },
      select: { id: true },
    })

    const ops = [
      prisma.communityReport.create({
        data: {
          postId,
          reporterUserId: userId,
          reporterCompanyId: reporterCompany?.id ?? null,
          reason,
          notes: notes ?? null,
        },
      }),
    ]

    if (!post.communityHiddenAt) {
      ops.push(
        prisma.platformPost.update({
          where: { id: postId },
          data: {
            communityHiddenAt: new Date(),
            communityHiddenReason: `report:${reason}`,
          },
        }) as never
      )
    }

    await prisma.$transaction(ops)

    res.json({ ok: true, hidden: !post.communityHiddenAt })
  } catch (err) {
    next(err)
  }
})

export default router
