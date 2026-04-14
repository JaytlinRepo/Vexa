import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { requireAuth, AuthedRequest } from '../middleware/auth'

const prisma = new PrismaClient()
const router = Router()

router.get('/timeseries', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const company = await prisma.company.findFirst({ where: { userId } })
    if (!company) {
      res.json({ account: null, snapshots: [], posts: [], audiences: [] })
      return
    }
    const account = await prisma.platformAccount.findFirst({
      where: { companyId: company.id },
      orderBy: { lastSyncedAt: 'desc' },
    })
    if (!account) {
      res.json({ account: null, snapshots: [], posts: [], audiences: [] })
      return
    }

    const [snapshots, posts, audiences] = await Promise.all([
      prisma.platformSnapshot.findMany({
        where: { accountId: account.id },
        orderBy: { capturedAt: 'asc' },
        take: 500,
      }),
      prisma.platformPost.findMany({
        where: { accountId: account.id },
        orderBy: { publishedAt: 'desc' },
        take: 200,
      }),
      prisma.platformAudience.findMany({
        where: { accountId: account.id },
        orderBy: { capturedAt: 'desc' },
        take: 5,
      }),
    ])

    res.json({ account, snapshots, posts, audiences })
  } catch (err) {
    next(err)
  }
})

export default router
