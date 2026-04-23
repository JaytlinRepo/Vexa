/**
 * Jordan Performance Learning Endpoint
 * Allows manual triggering of performance analysis and retrieval of insights
 */
import { Router } from 'express'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import prisma from '../lib/prisma'
import { createPerformanceMemory } from '../services/jordan/performanceMemory.service'

const router = Router()
const performanceMemory = createPerformanceMemory(prisma)

/**
 * POST /api/jordan/performance/analyze
 * Trigger performance analysis for a company's recent posts
 * This extracts learnings about what content angles worked best
 */
router.post('/analyze', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const companyId = (req.query.companyId as string | undefined) ?? undefined

    const company = companyId
      ? await prisma.company.findFirst({ where: { id: companyId, userId } })
      : await prisma.company.findFirst({ where: { userId } })

    if (!company) {
      res.status(404).json({ error: 'Company not found' })
      return
    }

    // Trigger analysis
    await performanceMemory.updateJordanMemory(company.id)

    // Fetch the results
    const insights = await performanceMemory.getJordanInsights(company.id)

    res.json({
      success: true,
      message: 'Performance analysis complete',
      insights,
    })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/jordan/performance/insights
 * Get current performance insights for Jordan
 * Returns the analysis of what content angles have worked best
 */
router.get('/insights', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const companyId = (req.query.companyId as string | undefined) ?? undefined

    const company = companyId
      ? await prisma.company.findFirst({ where: { id: companyId, userId } })
      : await prisma.company.findFirst({ where: { userId } })

    if (!company) {
      res.status(404).json({ error: 'Company not found' })
      return
    }

    const insights = await performanceMemory.getJordanInsights(company.id)

    res.json({
      insights: insights || 'No performance data yet. Post content and come back in a few days.',
    })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/jordan/performance/memories
 * Get raw performance memories stored in brand_memory table
 * Useful for debugging and understanding what Jordan learned
 */
router.get('/memories', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const companyId = (req.query.companyId as string | undefined) ?? undefined

    const company = companyId
      ? await prisma.company.findFirst({ where: { id: companyId, userId } })
      : await prisma.company.findFirst({ where: { userId } })

    if (!company) {
      res.status(404).json({ error: 'Company not found' })
      return
    }

    const memories = await prisma.brandMemory.findMany({
      where: {
        companyId: company.id,
        memoryType: 'performance',
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })

    res.json({
      memories: memories.map((m) => ({
        id: m.id,
        source: (m.content as any)?.source,
        createdAt: m.createdAt,
        weight: m.weight,
        content: m.content,
      })),
    })
  } catch (err) {
    next(err)
  }
})

export default router
