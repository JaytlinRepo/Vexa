import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import * as phyllo from '../lib/phyllo'
import { mapPhylloToStub } from '../lib/phylloMapper'
import { writeMemory } from '../lib/brandMemory'
import { createNotification } from '../services/notifications/notification.service'
import { persistPhylloSync } from '../lib/platformSync'

const prisma = new PrismaClient()
const router = Router()

async function ensurePhylloUser(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, fullName: true, username: true, email: true, phylloUserId: true },
  })
  if (!user) throw new Error('user_not_found')
  if (user.phylloUserId) return user.phylloUserId
  const displayName = user.fullName || user.username || user.email
  const created = await phyllo.createUser(displayName, `vexa_${user.id}`)
  await prisma.user.update({ where: { id: user.id }, data: { phylloUserId: created.id } })
  return created.id
}

router.get('/accounts', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { phylloUserId: true } })
    if (!user?.phylloUserId) {
      res.json({ accounts: [] })
      return
    }
    const { data } = await phyllo.listAccountsForUser(user.phylloUserId)
    res.json({ accounts: data })
  } catch (err) {
    next(err)
  }
})

router.get('/platforms', requireAuth, async (_req, res, next) => {
  try {
    const list = await phyllo.listWorkPlatforms()
    res.json({ platforms: list.data })
  } catch (err) {
    next(err)
  }
})

router.post('/accounts/:id/disconnect', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { phylloUserId: true } })
    if (!user?.phylloUserId) {
      res.status(400).json({ error: 'no_phyllo_user' })
      return
    }
    const account = await phyllo.getAccount(req.params.id)
    if (phyllo.accountOwnerId(account) !== user.phylloUserId) {
      res.status(403).json({ error: 'account_not_owned' })
      return
    }
    await phyllo.disconnectAccount(req.params.id)
    // If this was the Instagram row we were syncing, drop the local connection too.
    await prisma.instagramConnection.deleteMany({ where: { phylloAccountId: account.id } })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

router.post('/sdk-token', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const phylloUserId = await ensurePhylloUser(userId)
    const token = await phyllo.createSdkToken(phylloUserId, phyllo.DEFAULT_PRODUCTS)
    res.json({
      sdkToken: token.sdk_token,
      phylloUserId,
      expiresAt: token.expires_at,
      environment: process.env.PHYLLO_ENVIRONMENT || 'staging',
    })
  } catch (err) {
    next(err)
  }
})

const syncSchema = z.object({
  accountId: z.string().min(1),
  companyId: z.string().uuid().optional(),
})

router.post('/sync', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const data = syncSchema.parse(req.body)

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { phylloUserId: true } })
    if (!user?.phylloUserId) {
      res.status(400).json({ error: 'no_phyllo_user' })
      return
    }

    // Verify the account belongs to this user's phyllo user
    const account = await phyllo.getAccount(data.accountId)
    const ownerId = phyllo.accountOwnerId(account)
    if (ownerId !== user.phylloUserId) {
      res.status(403).json({ error: 'account_not_owned', expected: user.phylloUserId, actual: ownerId })
      return
    }

    const company = data.companyId
      ? await prisma.company.findFirst({ where: { id: data.companyId, userId } })
      : await prisma.company.findFirst({ where: { userId } })
    if (!company) {
      res.status(404).json({ error: 'company_not_found' })
      return
    }

    const platformName = (account.work_platform?.name || '').toLowerCase()
    // Phyllo has three Instagram variants — treat them all as IG for sync.
    const isInstagram =
      platformName === 'instagram' ||
      platformName === 'instagram direct' ||
      platformName === 'instagram lite'

    // Non-Instagram connections are tracked by Phyllo but we don't persist
    // their analytics into the InstagramConnection row (which would
    // overwrite the user's IG numbers with, say, TikTok ones). Tell the
    // caller connection succeeded; dashboard will show the platform as
    // connected via the Integrations panel.
    if (!isInstagram) {
      res.json({
        ok: true,
        platform: account.work_platform?.name,
        accountId: account.id,
        skipped: 'non_instagram_not_persisted',
      })
      return
    }

    // Pull the data in parallel. Each call is best-effort: if one fails we
    // still persist what we have.
    const [profile, contents, audience] = await Promise.allSettled([
      phyllo.getProfile(data.accountId),
      phyllo.getContents(data.accountId, 30),
      phyllo.getAudience(data.accountId),
    ])

    const profileItem = profile.status === 'fulfilled' ? profile.value.data?.[0] ?? null : null
    const contentList = contents.status === 'fulfilled' ? contents.value : { data: [] }
    const audienceRes = audience.status === 'fulfilled' ? audience.value : null

    const stub = mapPhylloToStub({
      account,
      profile: profileItem,
      contents: contentList,
      audience: audienceRes,
    })

    // Detect Phyllo "still ingesting" state — no follower count + no contents.
    // Caller should retry after a delay.
    const sparseData = stub.followerCount === 0 && stub.recentMedia.length === 0

    const payload = {
      handle: stub.username || account.platform_username || '',
      profileUrl: stub.profileUrl,
      accountType: stub.accountType,
      bio: stub.bio,
      followerCount: stub.followerCount,
      followingCount: stub.followingCount,
      postCount: stub.postCount,
      engagementRate: stub.engagementRate,
      avgReach: stub.avgReach,
      avgImpressions: stub.avgImpressions,
      topPosts: stub.topPosts as unknown as object,
      recentMedia: stub.recentMedia as unknown as object,
      followerSeries: stub.followerSeries as unknown as object,
      audienceAge: stub.audienceAge as unknown as object,
      audienceGender: stub.audienceGender as unknown as object,
      audienceTop: stub.audienceTopCountries as unknown as object,
      audienceCities: stub.audienceTopCities as unknown as object,
      igUserId: stub.igUserId,
      phylloAccountId: account.id,
      platform: account.work_platform?.name?.toLowerCase() || 'instagram',
      source: 'phyllo',
      lastSyncedAt: new Date(),
    }

    const connection = await prisma.instagramConnection.upsert({
      where: { companyId: company.id },
      update: { ...payload, connectedAt: new Date() },
      create: { companyId: company.id, ...payload },
    })

    // Also write to the generalized tables (point-in-time snapshot + posts +
    // audience). Legacy InstagramConnection stays populated for backward
    // compatibility; new code should read from PlatformAccount.
    try {
      await persistPhylloSync(prisma, company.id, user.phylloUserId, account, stub)
    } catch (e) {
      console.warn('[phyllo] platform-snapshot write failed (legacy IG row still persisted)', e)
    }

    // Push key facts into BrandMemory so meetings reflect the real numbers
    // without re-fetching from Phyllo every call.
    try {
      const topPost = stub.topPosts[0]
      await writeMemory(prisma, {
        companyId: company.id,
        type: 'performance',
        weight: 1.4,
        content: {
          source: 'instagram',
          summary: `Instagram @${stub.username}: ${stub.followerCount.toLocaleString()} followers, ${stub.engagementRate}% engagement. Top post: "${(topPost?.caption || '').slice(0, 80)}" (${topPost?.like_count ?? 0} likes).`,
          tags: ['instagram', 'analytics'],
        },
      })
      await createNotification({
        userId,
        companyId: company.id,
        type: 'team_update',
        emoji: '✅',
        title: `Instagram @${stub.username} connected`,
        body: `${stub.followerCount.toLocaleString()} followers · ${stub.engagementRate}% engagement. Your team is now working from real numbers.`,
        metadata: { phylloAccountId: account.id },
      })
    } catch (e) {
      console.warn('[phyllo:sync] memory/notification emit failed', e)
    }

    // Write a performance-type BrandMemory entry + notification on initial
    // connect so agents and the activity timeline reflect the real numbers.
    if (!sparseData) {
      try {
        const topCap = (stub.topPosts[0]?.caption || '').slice(0, 80)
        await writeMemory(prisma, {
          companyId: company.id,
          type: 'performance',
          weight: 1.5,
          content: {
            source: 'instagram',
            summary: `Instagram @${stub.username}: ${stub.followerCount.toLocaleString()} followers, ${stub.engagementRate}% engagement${topCap ? `, top post "${topCap}"` : ''}`,
            tags: ['instagram', 'analytics'],
          },
        })
        await createNotification({
          userId,
          companyId: company.id,
          type: 'team_update',
          emoji: '',
          title: 'Instagram synced',
          body: `Maya has the real numbers for @${stub.username}. Your team is working from live data now.`,
        })
      } catch (e) {
        console.warn('[phyllo] post-sync memory/notif failed', e)
      }
    }

    res.status(200).json({
      connection,
      platform: account.work_platform?.name,
      sparse: sparseData,
      retryAfterMs: sparseData ? 10000 : null,
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'invalid_input', issues: err.issues })
      return
    }
    next(err)
  }
})

/**
 * Phyllo webhook receiver. Phyllo fires account.connected, account.disconnected,
 * contents.updated, etc. For now we just log + return 200 — full signature
 * verification can be added when we provide a webhook secret.
 */
router.post('/webhook', async (req, res) => {
  console.log('[phyllo:webhook]', JSON.stringify(req.body).slice(0, 500))
  res.status(200).json({ ok: true })
})

export default router
