import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import { buildStub, jitterStub, IgStub } from '../lib/instagramStub'

const prisma = new PrismaClient()
const router = Router()

const connectSchema = z.object({
  companyId: z.string().uuid(),
  handle: z.string().min(1).max(60).regex(/^@?[A-Za-z0-9._]+$/, 'invalid_handle'),
})

function stubToDb(stub: IgStub) {
  return {
    handle: stub.username,
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
    source: 'stub',
    lastSyncedAt: new Date(),
  }
}

function dbToStub(row: { [k: string]: unknown }): IgStub {
  return {
    username: row.handle as string,
    igUserId: (row.igUserId as string) || '',
    accountType: (row.accountType as IgStub['accountType']) || 'CREATOR',
    bio: (row.bio as string) || '',
    profileUrl: (row.profileUrl as string) || `https://instagram.com/${row.handle}`,
    followerCount: row.followerCount as number,
    followingCount: row.followingCount as number,
    postCount: row.postCount as number,
    engagementRate: row.engagementRate as number,
    avgReach: row.avgReach as number,
    avgImpressions: row.avgImpressions as number,
    topPosts: (row.topPosts as IgStub['topPosts']) || [],
    recentMedia: (row.recentMedia as IgStub['recentMedia']) || [],
    followerSeries: (row.followerSeries as IgStub['followerSeries']) || [],
    audienceAge: (row.audienceAge as IgStub['audienceAge']) || [],
    audienceGender: (row.audienceGender as IgStub['audienceGender']) || [],
    audienceTopCountries: (row.audienceTop as IgStub['audienceTopCountries']) || [],
    audienceTopCities: (row.audienceCities as IgStub['audienceTopCities']) || [],
  }
}

router.post('/connect', requireAuth, async (req, res, next) => {
  try {
    const data = connectSchema.parse(req.body)
    const { userId } = (req as AuthedRequest).session

    const company = await prisma.company.findFirst({ where: { id: data.companyId, userId } })
    if (!company) {
      res.status(404).json({ error: 'company_not_found' })
      return
    }

    const handle = data.handle.replace(/^@/, '')
    const stub = buildStub(handle)
    const payload = stubToDb(stub)

    const connection = await prisma.instagramConnection.upsert({
      where: { companyId: company.id },
      update: { ...payload, connectedAt: new Date() },
      create: { companyId: company.id, ...payload },
    })

    res.status(201).json({ connection })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'invalid_input', issues: err.issues })
      return
    }
    next(err)
  }
})

router.get('/insights', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const companyId = (req.query.companyId as string | undefined) ?? ''
    const company = await prisma.company.findFirst({
      where: { id: companyId, userId },
      include: { instagram: true },
    })
    if (!company) {
      res.status(404).json({ error: 'company_not_found' })
      return
    }
    res.json({ connection: company.instagram })
  } catch (err) {
    next(err)
  }
})

/**
 * Dev-only: lightly perturb the stub so testers can see numbers change.
 * Intended for local / test-mode use.
 */
router.post('/simulate', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const company = await prisma.company.findFirst({
      where: { userId },
      include: { instagram: true },
    })
    if (!company?.instagram) {
      res.status(404).json({ error: 'no_instagram_connection' })
      return
    }
    const current = dbToStub(company.instagram as unknown as { [k: string]: unknown })
    const next = jitterStub(current)
    const updated = await prisma.instagramConnection.update({
      where: { companyId: company.id },
      data: { ...stubToDb(next) },
    })
    res.json({ connection: updated })
  } catch (err) {
    next(err)
  }
})

router.delete('/', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const company = await prisma.company.findFirst({
      where: { userId },
      include: { instagram: true },
    })
    if (!company?.instagram) {
      res.status(404).json({ error: 'no_instagram_connection' })
      return
    }
    await prisma.instagramConnection.delete({ where: { companyId: company.id } })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
