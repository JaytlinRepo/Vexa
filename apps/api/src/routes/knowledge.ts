import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import prisma from '../lib/prisma'
import { createKnowledgeService } from '../services/knowledge.service'

const router = Router()
const knowledgeService = createKnowledgeService(prisma)

// ─── Validation Schemas ────────────────────────────────────────────────────────

const createKnowledgeSchema = z.object({
  type: z.enum(['insight', 'pattern', 'learning', 'trend_summary', 'content_angle', 'audience_signal', 'competitive_advantage']),
  source: z.enum(['feed_item', 'brand_memory', 'trend_report', 'user_feedback', 'performance_metric', 'ai_analysis']),
  title: z.string().min(5).max(200),
  summary: z.string().min(10).max(1000),
  details: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).max(10).optional(),
  sourceUrl: z.string().url().optional().nullable(),
  relevanceScore: z.number().min(0).max(1).optional(),
})

const updateKnowledgeSchema = z.object({
  title: z.string().min(5).max(200).optional(),
  summary: z.string().min(10).max(1000).optional(),
  details: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).max(10).optional(),
  sourceUrl: z.string().url().optional().nullable(),
  relevanceScore: z.number().min(0).max(1).optional(),
  isArchived: z.boolean().optional(),
})

const searchSchema = z.object({
  q: z.string().min(2).max(100),
  limit: z.coerce.number().min(1).max(100).optional(),
})

const filterSchema = z.object({
  type: z.string().optional(),
  source: z.string().optional(),
  tags: z.string().optional(), // comma-separated
  archived: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
})

// ─── Helper: Resolve company ID ────────────────────────────────────────────────

async function resolveCompanyId(userId: string, explicit?: string): Promise<string | null> {
  const company = explicit
    ? await prisma.company.findFirst({ where: { id: explicit, userId }, select: { id: true } })
    : await prisma.company.findFirst({ where: { userId }, select: { id: true } })
  return company?.id ?? null
}

// ─── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /api/knowledge
 * Get knowledge items for the user's company with optional filters
 */
router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const companyId = await resolveCompanyId(userId, req.query.companyId as string | undefined)

    if (!companyId) {
      return res.json({ items: [], total: 0 })
    }

    const filters = filterSchema.parse(req.query)
    const archived = filters.archived ? filters.archived === 'true' : false

    const queryFilters = {
      type: filters.type as any,
      source: filters.source as any,
      tags: filters.tags ? filters.tags.split(',') : undefined,
      archived,
      limit: filters.limit || 50,
      offset: filters.offset || 0,
    }

    const [items, total] = await Promise.all([
      knowledgeService.getKnowledge(companyId, queryFilters),
      knowledgeService.countKnowledge(companyId, queryFilters),
    ])

    res.json({ items, total })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'invalid_filters', issues: err.issues })
    }
    next(err)
  }
})

/**
 * POST /api/knowledge
 * Create a new knowledge item
 */
router.post('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const companyId = await resolveCompanyId(
      userId,
      (req.body?.companyId as string | undefined) ?? (req.query.companyId as string | undefined)
    )

    if (!companyId) {
      return res.status(404).json({ error: 'company_not_found' })
    }

    const data = createKnowledgeSchema.parse(req.body)
    const knowledge = await knowledgeService.createKnowledge(companyId, data)

    res.status(201).json({ knowledge })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'invalid_input', issues: err.issues })
    }
    next(err)
  }
})

/**
 * GET /api/knowledge/:id
 * Get a specific knowledge item
 */
router.get('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const companyId = await resolveCompanyId(userId, req.query.companyId as string | undefined)

    if (!companyId) {
      return res.status(404).json({ error: 'company_not_found' })
    }

    const knowledge = await knowledgeService.getKnowledgeById(req.params.id, companyId)

    if (!knowledge) {
      return res.status(404).json({ error: 'knowledge_not_found' })
    }

    res.json({ knowledge })
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/knowledge/:id
 * Update a knowledge item
 */
router.patch('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const companyId = await resolveCompanyId(
      userId,
      (req.body?.companyId as string | undefined) ?? (req.query.companyId as string | undefined)
    )

    if (!companyId) {
      return res.status(404).json({ error: 'company_not_found' })
    }

    const data = updateKnowledgeSchema.parse(req.body)
    // updateKnowledge enforces companyId scope at the DB layer; no separate
    // verification round-trip needed.
    const updated = await knowledgeService.updateKnowledge(req.params.id, companyId, data)

    res.json({ knowledge: updated })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'invalid_input', issues: err.issues })
    }
    if (err instanceof Error && err.message === 'Knowledge item not found') {
      return res.status(404).json({ error: 'knowledge_not_found' })
    }
    next(err)
  }
})

/**
 * DELETE /api/knowledge/:id
 * Delete a knowledge item (soft delete via archive)
 */
router.delete('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const companyId = await resolveCompanyId(userId, req.query.companyId as string | undefined)

    if (!companyId) {
      return res.status(404).json({ error: 'company_not_found' })
    }

    await knowledgeService.deleteKnowledge(req.params.id, companyId)
    res.json({ ok: true })
  } catch (err) {
    if (err instanceof Error && err.message === 'Knowledge item not found') {
      return res.status(404).json({ error: 'knowledge_not_found' })
    }
    next(err)
  }
})

/**
 * POST /api/knowledge/search
 * Search knowledge items by keyword
 */
router.post('/search', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const companyId = await resolveCompanyId(
      userId,
      (req.body?.companyId as string | undefined) ?? (req.query.companyId as string | undefined)
    )

    if (!companyId) {
      return res.json({ results: [] })
    }

    const { q, limit } = searchSchema.parse(req.body)
    const results = await knowledgeService.searchKnowledge(companyId, q, limit || 20)

    res.json({ results })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'invalid_input', issues: err.issues })
    }
    next(err)
  }
})

/**
 * POST /api/knowledge/:id/related/:relatedId
 * Link two knowledge items as related
 */
router.post('/:id/related/:relatedId', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const companyId = await resolveCompanyId(
      userId,
      (req.body?.companyId as string | undefined) ?? (req.query.companyId as string | undefined)
    )

    if (!companyId) {
      return res.status(404).json({ error: 'company_not_found' })
    }

    await knowledgeService.addRelatedItem(req.params.id, req.params.relatedId, companyId)
    res.json({ ok: true })
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return res.status(404).json({ error: 'knowledge_item_not_found' })
    }
    next(err)
  }
})

/**
 * POST /api/knowledge/extract/feed
 * Extract insights from recent feed items
 * (Typically called by a scheduled job)
 */
router.post('/extract/feed', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const companyId = await resolveCompanyId(
      userId,
      (req.body?.companyId as string | undefined) ?? (req.query.companyId as string | undefined)
    )

    if (!companyId) {
      return res.status(404).json({ error: 'company_not_found' })
    }

    // For now, this is a no-op (would be called by scheduled job)
    // In production, this would fetch real feed items and extract insights
    res.json({ created: [], message: 'Feed extraction would happen here' })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/knowledge/extract/memory
 * Extract patterns from brand memory
 */
router.post('/extract/memory', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const companyId = await resolveCompanyId(
      userId,
      (req.body?.companyId as string | undefined) ?? (req.query.companyId as string | undefined)
    )

    if (!companyId) {
      return res.status(404).json({ error: 'company_not_found' })
    }

    const created = await knowledgeService.extractPatternsFromMemory(companyId)
    res.json({ created, count: created.length })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/knowledge/archive-old
 * Archive knowledge items older than N days
 */
router.post('/archive-old', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const companyId = await resolveCompanyId(
      userId,
      (req.body?.companyId as string | undefined) ?? (req.query.companyId as string | undefined)
    )

    if (!companyId) {
      return res.status(404).json({ error: 'company_not_found' })
    }

    const daysOld = req.body.daysOld || 90
    const archived = await knowledgeService.archiveOldKnowledge(companyId, daysOld)

    res.json({ archived, message: `Archived ${archived} knowledge items older than ${daysOld} days` })
  } catch (err) {
    next(err)
  }
})

export default router
