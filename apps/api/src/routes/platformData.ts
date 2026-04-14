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

/**
 * Lightweight list of connected platform accounts for the current user.
 * Used by the dashboard to render green/gray dots on the Connections pill
 * strip without having to round-trip to Phyllo on every render. Reads
 * straight from the PlatformAccount table and also includes the legacy
 * InstagramConnection row so long-lived accounts that pre-date
 * PlatformAccount still show as connected.
 */
router.get('/accounts', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const company = await prisma.company.findFirst({ where: { userId } })
    if (!company) {
      res.json({ accounts: [] })
      return
    }
    const [platformAccounts, legacyIg] = await Promise.all([
      prisma.platformAccount.findMany({
        where: { companyId: company.id, status: 'connected' },
        select: {
          id: true,
          platform: true,
          phylloAccountId: true,
          phylloUserId: true,
          handle: true,
          status: true,
          lastSyncedAt: true,
          connectedAt: true,
        },
      }),
      prisma.instagramConnection.findUnique({
        where: { companyId: company.id },
        select: { handle: true, source: true, phylloAccountId: true, lastSyncedAt: true, connectedAt: true },
      }),
    ])

    const accounts = platformAccounts.map((a) => ({
      platform: a.platform,
      handle: a.handle,
      status: a.status,
      phylloAccountId: a.phylloAccountId,
      lastSyncedAt: a.lastSyncedAt,
      connectedAt: a.connectedAt,
    }))

    // If the legacy IG row exists from a Phyllo sync and we don't already
    // have a PlatformAccount for Instagram, surface it too.
    const hasIgAccount = accounts.some((a) => a.platform === 'instagram')
    if (!hasIgAccount && legacyIg && legacyIg.source === 'phyllo') {
      accounts.push({
        platform: 'instagram',
        handle: legacyIg.handle,
        status: 'connected',
        phylloAccountId: legacyIg.phylloAccountId,
        lastSyncedAt: legacyIg.lastSyncedAt,
        connectedAt: legacyIg.connectedAt,
      })
    }

    res.json({ accounts })
  } catch (err) {
    next(err)
  }
})

export default router
