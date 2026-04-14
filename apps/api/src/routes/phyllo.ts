import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import * as phyllo from '../lib/phyllo'
import { mapPhylloToStub } from '../lib/phylloMapper'

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
    if (account.user_id !== user.phylloUserId) {
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
    if (account.user_id !== user.phylloUserId) {
      res.status(403).json({ error: 'account_not_owned' })
      return
    }

    const company = data.companyId
      ? await prisma.company.findFirst({ where: { id: data.companyId, userId } })
      : await prisma.company.findFirst({ where: { userId } })
    if (!company) {
      res.status(404).json({ error: 'company_not_found' })
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

    res.status(200).json({ connection, platform: account.work_platform?.name })
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
