import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import { computeUsage } from '../lib/usage'

const prisma = new PrismaClient()
const router = Router()

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const report = await computeUsage(prisma, userId)
    res.json(report)
  } catch (err) {
    next(err)
  }
})

export default router
