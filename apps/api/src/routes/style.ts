import { Router } from 'express'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import { analyzeUserVideoStyle, getStyleProfile } from '../services/videoStyleAnalyzer.service'
import prisma from '../lib/prisma'

const router = Router()

// POST /api/style/analyze — Trigger style analysis for user's content
router.post('/analyze', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const companyId = (req.query.companyId as string | undefined) ?? undefined

    const company = companyId
      ? await prisma.company.findFirst({ where: { id: companyId, userId } })
      : await prisma.company.findFirst({ where: { userId } })

    if (!company) {
      return res.status(404).json({ error: 'Company not found' })
    }

    const profile = await analyzeUserVideoStyle(company.id)
    res.json({ profile, message: 'Style analysis complete' })
  } catch (err) {
    next(err)
  }
})

// GET /api/style/profile — Get stored style profile
router.get('/profile', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const companyId = (req.query.companyId as string | undefined) ?? undefined

    const company = companyId
      ? await prisma.company.findFirst({ where: { id: companyId, userId } })
      : await prisma.company.findFirst({ where: { userId } })

    if (!company) {
      return res.status(404).json({ error: 'Company not found' })
    }

    const profile = await getStyleProfile(company.id)
    res.json({ profile })
  } catch (err) {
    next(err)
  }
})

export default router
