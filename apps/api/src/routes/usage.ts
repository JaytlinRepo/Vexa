import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import { computeUsage } from '../lib/usage'
import { getBedrockUsage, estimateCost } from '../lib/bedrockUsage'

const prisma = new PrismaClient()
const router = Router()

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const report = await computeUsage(prisma, userId)

    // Append Bedrock usage for the user's primary company
    const company = await prisma.company.findFirst({ where: { userId }, select: { id: true } })
    if (company) {
      const bedrock = getBedrockUsage(company.id)
      ;(report as unknown as Record<string, unknown>).bedrock = {
        callsThisMonth: bedrock.count,
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
