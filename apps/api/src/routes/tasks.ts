import { Router } from 'express'
import { PrismaClient, TaskStatus } from '@prisma/client'
import { z } from 'zod'
import { requireAuth, AuthedRequest } from '../middleware/auth'

const prisma = new PrismaClient()
const router = Router()

const actionSchema = z.object({
  action: z.enum(['approve', 'reject', 'reconsider', 'regenerate']),
  feedback: z.string().max(1000).optional(),
})

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const companyId = (req.query.companyId as string | undefined) ?? undefined
    const status = req.query.status as TaskStatus | undefined

    // Scope by user's companies
    const company = companyId
      ? await prisma.company.findFirst({ where: { id: companyId, userId } })
      : await prisma.company.findFirst({ where: { userId } })
    if (!company) {
      res.json({ tasks: [] })
      return
    }

    const tasks = await prisma.task.findMany({
      where: { companyId: company.id, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { employee: true, outputs: true },
      take: 50,
    })
    res.json({ tasks, companyId: company.id })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/action', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const data = actionSchema.parse(req.body)

    const task = await prisma.task.findUnique({
      where: { id: req.params.id },
      include: { company: true },
    })
    if (!task || task.company.userId !== userId) {
      res.status(404).json({ error: 'task_not_found' })
      return
    }

    let newStatus: TaskStatus
    switch (data.action) {
      case 'approve':
        newStatus = 'approved'
        break
      case 'reject':
        newStatus = 'rejected'
        break
      case 'reconsider':
      case 'regenerate':
        newStatus = 'revision'
        break
    }

    const updated = await prisma.task.update({
      where: { id: task.id },
      data: {
        status: newStatus,
        userAction: { type: data.action, feedback: data.feedback, ts: new Date().toISOString() },
        completedAt: newStatus === 'approved' || newStatus === 'rejected' ? new Date() : null,
      },
      include: { employee: true, outputs: true },
    })

    res.json({ task: updated })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'invalid_input', issues: err.issues })
      return
    }
    next(err)
  }
})

export default router
