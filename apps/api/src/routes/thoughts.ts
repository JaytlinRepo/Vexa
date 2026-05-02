import { Router } from 'express'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import prisma from '../lib/prisma'

const router = Router()

// GET thoughts for a company (by date range)
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const companyId = (req.query.companyId as string | undefined) ?? undefined
    const dateStr = req.query.date as string | undefined

    const company = companyId
      ? await prisma.company.findFirst({ where: { id: companyId, userId } })
      : await prisma.company.findFirst({ where: { userId } })

    if (!company) {
      return res.json({ thoughts: [] })
    }

    // If specific date requested, get thoughts from that day
    let where = { companyId: company.id }
    if (dateStr) {
      const start = new Date(dateStr)
      const end = new Date(dateStr)
      end.setDate(end.getDate() + 1)
      where = {
        ...where,
        createdAt: { gte: start, lt: end },
      } as any
    }

    const thoughts = await prisma.thought.findMany({
      where,
      include: {
        thoughtResponses: {
          include: { employee: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    res.json({ thoughts })
  } catch (err) {
    next(err)
  }
})

// GET single thought with responses
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const { id } = req.params

    const thought = await prisma.thought.findUnique({
      where: { id },
      include: {
        thoughtResponses: {
          include: { employee: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    if (!thought) {
      return res.status(404).json({ error: 'Thought not found' })
    }

    // Verify user owns this company
    const company = await prisma.company.findFirst({ where: { id: thought.companyId, userId } })
    if (!company) {
      return res.status(403).json({ error: 'Not authorized' })
    }

    res.json(thought)
  } catch (err) {
    next(err)
  }
})

// POST a new thought
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const { companyId, content } = req.body

    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'content required' })
    }

    const company = companyId
      ? await prisma.company.findFirst({ where: { id: companyId, userId } })
      : await prisma.company.findFirst({ where: { userId } })

    if (!company) {
      return res.status(404).json({ error: 'Company not found' })
    }

    const thought = await prisma.thought.create({
      data: {
        companyId: company.id,
        content: content.trim(),
      },
      include: {
        thoughtResponses: {
          include: { employee: true },
        },
      },
    })

    res.status(201).json(thought)
  } catch (err) {
    next(err)
  }
})

// DELETE a thought
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const { id } = req.params

    const thought = await prisma.thought.findUnique({ where: { id } })
    if (!thought) {
      return res.status(404).json({ error: 'Thought not found' })
    }

    const company = await prisma.company.findFirst({ where: { id: thought.companyId, userId } })
    if (!company) {
      return res.status(403).json({ error: 'Not authorized' })
    }

    await prisma.thought.delete({ where: { id } })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
