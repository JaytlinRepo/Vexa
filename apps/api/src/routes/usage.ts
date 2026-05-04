import { Router } from 'express'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import { computeUsage } from '../lib/usage'
import { getBedrockUsage, estimateCost } from '../lib/bedrockUsage'

import prisma from '../lib/prisma'
const router = Router()

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const report = await computeUsage(prisma, userId)

    // Append Bedrock usage for the user's primary company. Read the bucket
    // that matches the user's plan reset window — daily for Free, monthly
    // for paid tiers — so the surfaced usage matches the cap shown to them.
    const company = await prisma.company.findFirst({ where: { userId }, select: { id: true } })
    if (company) {
      const bedrock = await getBedrockUsage(company.id, report.tasks.resetWindow)
      ;(report as unknown as Record<string, unknown>).bedrock = {
        count: bedrock.count,
        window: report.tasks.resetWindow,
        inputTokens: bedrock.inputTokens,
        outputTokens: bedrock.outputTokens,
        estimatedCost: `$${estimateCost(bedrock).toFixed(4)}`,
        lastCallAt: bedrock.lastCallAt.toISOString(),
      }
    }

    res.json(report)
  } catch (err) {
    next(err)
  }
})

export default router
