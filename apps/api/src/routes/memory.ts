import { Router } from 'express'
import { PrismaClient, MemoryType } from '@prisma/client'
import { z } from 'zod'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import { writeMemory } from '../lib/brandMemory'

const prisma = new PrismaClient()
const router = Router()

const createSchema = z.object({
  type: z.enum(['feedback', 'preference', 'performance', 'voice']),
  summary: z.string().min(3).max(500),
  weight: z.number().min(0).max(3).optional(),
  tags: z.array(z.string()).max(10).optional(),
})

const patchSchema = z.object({
  weight: z.number().min(0).max(3).optional(),
  summary: z.string().min(3).max(500).optional(),
})

async function resolveCompanyId(userId: string, explicit?: string): Promise<string | null> {
  const company = explicit
    ? await prisma.company.findFirst({ where: { id: explicit, userId }, select: { id: true } })
    : await prisma.company.findFirst({ where: { userId }, select: { id: true } })
  return company?.id ?? null
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const companyId = await resolveCompanyId(userId, req.query.companyId as string | undefined)
    if (!companyId) {
      res.json({ memories: [] })
      return
    }
    const memories = await prisma.brandMemory.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    res.json({ memories })
  } catch (err) {
    next(err)
  }
})

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const data = createSchema.parse(req.body)
    const companyId = await resolveCompanyId(userId)
    if (!companyId) {
      res.status(404).json({ error: 'company_not_found' })
      return
    }
    await writeMemory(prisma, {
      companyId,
      type: data.type as MemoryType,
      weight: data.weight ?? 1.0,
      content: {
        summary: data.summary,
        source: 'manual',
        tags: data.tags,
      },
    })
    const memories = await prisma.brandMemory.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    res.status(201).json({ memories })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'invalid_input', issues: err.issues })
      return
    }
    next(err)
  }
})

router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const data = patchSchema.parse(req.body)
    const mem = await prisma.brandMemory.findUnique({
      where: { id: req.params.id },
      include: { company: true },
    })
    if (!mem || mem.company.userId !== userId) {
      res.status(404).json({ error: 'memory_not_found' })
      return
    }
    const content = mem.content as { summary?: string } & Record<string, unknown>
    const updated = await prisma.brandMemory.update({
      where: { id: mem.id },
      data: {
        ...(data.weight != null ? { weight: data.weight } : {}),
        ...(data.summary != null ? { content: { ...content, summary: data.summary } } : {}),
      },
    })
    res.json({ memory: updated })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'invalid_input', issues: err.issues })
      return
    }
    next(err)
  }
})

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const mem = await prisma.brandMemory.findUnique({
      where: { id: req.params.id },
      include: { company: true },
    })
    if (!mem || mem.company.userId !== userId) {
      res.status(404).json({ error: 'memory_not_found' })
      return
    }
    await prisma.brandMemory.delete({ where: { id: mem.id } })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
