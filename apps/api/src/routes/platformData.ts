import { Router } from 'express'
import { requireAuth, AuthedRequest } from '../middleware/auth'

import prisma from '../lib/prisma'
const router = Router()

router.get('/timeseries', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const company = await prisma.company.findFirst({ where: { userId } })
    if (!company) {
      res.json({ account: null, snapshots: [], posts: [], audiences: [] })
      return
    }
    const accounts = await prisma.platformAccount.findMany({
      where: { companyId: company.id },
      orderBy: { lastSyncedAt: 'desc' },
    })
    if (accounts.length === 0) {
      res.json({ account: null, snapshots: [], posts: [], audiences: [] })
      return
    }
    const accountIds = accounts.map(a => a.id)

    const [snapshots, posts, audiences] = await Promise.all([
      prisma.platformSnapshot.findMany({
        where: { accountId: { in: accountIds } },
        orderBy: { capturedAt: 'asc' },
        take: 500,
      }),
      prisma.platformPost.findMany({
        where: { accountId: { in: accountIds } },
        orderBy: { publishedAt: 'desc' },
        take: 200,
      }),
      prisma.platformAudience.findMany({
        where: { accountId: { in: accountIds } },
        orderBy: { capturedAt: 'desc' },
        take: 5,
      }),
    ])

    res.json({ account: accounts[0], snapshots, posts, audiences })
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

    // If the legacy IG row exists and we don't already have a
    // PlatformAccount for Instagram, surface it too.
    const hasIgAccount = accounts.some((a) => a.platform === 'instagram')
    if (!hasIgAccount && legacyIg) {
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

router.get('/overview', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const company = await prisma.company.findFirst({ where: { userId } })
    if (!company) {
      res.json({ accounts: [], combinedFollowers: 0, combinedFollowersDelta: 0, sparkline: [], topPost: null, audience: null })
      return
    }

    const platformAccounts = await prisma.platformAccount.findMany({
      where: { companyId: company.id, status: 'connected' },
    })
    if (platformAccounts.length === 0) {
      res.json({ accounts: [], combinedFollowers: 0, combinedFollowersDelta: 0, sparkline: [], topPost: null, audience: null })
      return
    }

    const accountIds = platformAccounts.map((a) => a.id)
    const now = new Date()
    const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    // Per-account: latest snapshot, ~7d-ago snapshot, and all 30d snapshots
    const perAccount = await Promise.all(
      platformAccounts.map(async (acct) => {
        const [latest, prev, thirtyDay] = await Promise.all([
          prisma.platformSnapshot.findFirst({
            where: { accountId: acct.id },
            orderBy: { capturedAt: 'desc' },
          }),
          prisma.platformSnapshot.findFirst({
            where: { accountId: acct.id, capturedAt: { lte: d7 } },
            orderBy: { capturedAt: 'desc' },
          }),
          prisma.platformSnapshot.findMany({
            where: { accountId: acct.id, capturedAt: { gte: d30 } },
            orderBy: { capturedAt: 'asc' },
          }),
        ])
        return { acct, latest, prev, thirtyDay }
      }),
    )

    // Accounts summary
    const accounts = perAccount.map(({ acct, latest, prev }) => ({
      platform: acct.platform,
      handle: acct.handle,
      displayName: acct.displayName,
      profileImageUrl: acct.profileImageUrl,
      latestFollowers: latest?.followerCount ?? 0,
      prevFollowers: prev?.followerCount ?? null,
    }))

    const combinedFollowers = accounts.reduce((s, a) => s + a.latestFollowers, 0)
    const combinedFollowersDelta = accounts.reduce((s, a) => {
      if (a.prevFollowers == null) return s
      return s + (a.latestFollowers - a.prevFollowers)
    }, 0)

    // Sparkline: merge all 30d snapshots by date, carry forward gaps
    const byDate = new Map<string, Record<string, number>>()
    for (const { acct, thirtyDay } of perAccount) {
      for (const snap of thirtyDay) {
        const d = snap.capturedAt.toISOString().slice(0, 10)
        const entry = byDate.get(d) || {}
        entry[acct.platform] = snap.followerCount
        byDate.set(d, entry)
      }
    }
    const sortedDates = [...byDate.keys()].sort()
    const carry: Record<string, number> = {}
    for (const pa of platformAccounts) carry[pa.platform] = 0
    const sparkline = sortedDates.map((date) => {
      const entry = byDate.get(date)!
      for (const p of Object.keys(carry)) {
        if (entry[p] != null) carry[p] = entry[p]
      }
      const byPlatform = { ...carry }
      const total = Object.values(byPlatform).reduce((s, v) => s + v, 0)
      return { date, total, byPlatform }
    })

    // Top post across all accounts (no date filter — synced posts are
    // already bounded to the most recent ~20-30 per account)
    const posts = await prisma.platformPost.findMany({
      where: { accountId: { in: accountIds } },
      orderBy: { publishedAt: 'desc' },
      take: 200,
    })
    let topPost: {
      platform: string; handle: string; caption: string | null
      url: string | null; thumbnailUrl: string | null
      likeCount: number; commentCount: number; shareCount: number
      viewCount: number; publishedAt: string | null; engagementScore: number
    } | null = null
    let bestScore = -1
    const acctMap = new Map(platformAccounts.map((a) => [a.id, a]))
    for (const p of posts) {
      const score = p.likeCount + p.commentCount * 2 + p.shareCount * 3
      if (score > bestScore) {
        bestScore = score
        const owner = acctMap.get(p.accountId)
        topPost = {
          platform: owner?.platform ?? 'unknown',
          handle: owner?.handle ?? '',
          caption: p.caption,
          url: p.url,
          thumbnailUrl: p.thumbnailUrl,
          likeCount: p.likeCount,
          commentCount: p.commentCount,
          shareCount: p.shareCount,
          viewCount: p.viewCount,
          publishedAt: p.publishedAt?.toISOString() ?? null,
          engagementScore: score,
        }
      }
    }

    // Audience: most recent across all accounts
    const latestAudience = await prisma.platformAudience.findFirst({
      where: { accountId: { in: accountIds } },
      orderBy: { capturedAt: 'desc' },
    })
    let audience: {
      platform: string; handle: string
      ageBreakdown: unknown[]; genderBreakdown: unknown[]
      topCountries: unknown[]; topCities: unknown[]
    } | null = null
    if (latestAudience) {
      const owner = acctMap.get(latestAudience.accountId)
      audience = {
        platform: owner?.platform ?? 'unknown',
        handle: owner?.handle ?? '',
        ageBreakdown: (latestAudience.ageBreakdown as unknown[]) || [],
        genderBreakdown: (latestAudience.genderBreakdown as unknown[]) || [],
        topCountries: (latestAudience.topCountries as unknown[]) || [],
        topCities: (latestAudience.topCities as unknown[]) || [],
      }
    }

    res.json({ accounts, combinedFollowers, combinedFollowersDelta, sparkline, topPost, audience })
  } catch (err) {
    next(err)
  }
})

export default router
