import { Router, Request, Response, NextFunction } from 'express'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import prisma from '../lib/prisma'
import { createKnowledgeService } from '../services/knowledge.service'

const router = Router()
const knowledgeService = createKnowledgeService(prisma)

/**
 * Admin endpoint: Seed knowledge from memory
 * POST /api/knowledge-admin/seed-from-memory
 * Extracts patterns from brand memory and creates knowledge items
 */
router.post('/seed-from-memory', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthedRequest).session

    // Resolve company
    const company = await prisma.company.findFirst({
      where: { userId },
      select: { id: true },
    })

    if (!company) {
      return res.status(404).json({ error: 'company_not_found' })
    }

    const created = await knowledgeService.extractPatternsFromMemory(company.id)
    res.json({
      message: `Created ${created.length} knowledge items from brand memory`,
      created,
    })
  } catch (err) {
    next(err)
  }
})

/**
 * Admin endpoint: Cleanup old knowledge
 * POST /api/knowledge-admin/archive-old
 * Archives knowledge items older than specified days
 */
router.post('/archive-old', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const daysOld = req.body.daysOld || 90

    const company = await prisma.company.findFirst({
      where: { userId },
      select: { id: true },
    })

    if (!company) {
      return res.status(404).json({ error: 'company_not_found' })
    }

    const archived = await knowledgeService.archiveOldKnowledge(company.id, daysOld)
    res.json({
      message: `Archived ${archived} knowledge items older than ${daysOld} days`,
      archived,
    })
  } catch (err) {
    next(err)
  }
})

/**
 * Admin endpoint: Get knowledge stats
 * GET /api/knowledge-admin/stats
 */
router.get('/stats', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthedRequest).session

    const company = await prisma.company.findFirst({
      where: { userId },
      select: { id: true },
    })

    if (!company) {
      return res.status(404).json({ error: 'company_not_found' })
    }

    const [total, active, byType, bySource] = await Promise.all([
      prisma.knowledge.count({ where: { companyId: company.id } }),
      prisma.knowledge.count({ where: { companyId: company.id, isArchived: false } }),
      prisma.knowledge.groupBy({
        by: ['type'],
        where: { companyId: company.id, isArchived: false },
        _count: { id: true },
      }),
      prisma.knowledge.groupBy({
        by: ['source'],
        where: { companyId: company.id, isArchived: false },
        _count: { id: true },
      }),
    ])

    res.json({
      total,
      active,
      byType: byType.map((t) => ({ type: t.type, count: t._count.id })),
      bySource: bySource.map((s) => ({ source: s.source, count: s._count.id })),
    })
  } catch (err) {
    next(err)
  }
})

export default router
