import { Router } from 'express'
import { OutputType } from '@prisma/client'
import prisma from '../lib/prisma'
import { requireAuth, AuthedRequest } from '../middleware/auth'

const router = Router()

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const companyId = (req.query.companyId as string | undefined) ?? undefined
    const type = req.query.type as OutputType | undefined

    const company = companyId
      ? await prisma.company.findFirst({ where: { id: companyId, userId } })
      : await prisma.company.findFirst({ where: { userId } })
    if (!company) {
      res.json({ outputs: [] })
      return
    }

    const outputs = await prisma.output.findMany({
      where: { companyId: company.id, ...(type ? { type } : {}) },
      include: { employee: true, task: { select: { id: true, title: true, status: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    res.json({ outputs })
  } catch (err) {
    next(err)
  }
})

export default router
