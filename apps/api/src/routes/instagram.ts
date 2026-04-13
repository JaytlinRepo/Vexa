import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { requireAuth, AuthedRequest } from '../middleware/auth'

const prisma = new PrismaClient()
const router = Router()

const connectSchema = z.object({
  companyId: z.string().uuid(),
  handle: z.string().min(1).max(60).regex(/^@?[A-Za-z0-9._]+$/, 'invalid_handle'),
})

// Deterministic pseudo-random from a string so the same handle yields stable
// mock numbers across refreshes.
function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function stubInsightsForHandle(handle: string) {
  const h = hashString(handle.toLowerCase())
  const followerCount = 2_000 + (h % 78_000)
  const followingCount = 120 + (h % 900)
  const postCount = 40 + (h % 260)
  const engagementRate = Math.round(((h % 420) / 100 + 1.2) * 100) / 100 // 1.20% – 5.40%
  const sampleTopics = [
    'morning routine',
    'behind the scenes',
    'client result',
    'myth busting',
    '30-sec tutorial',
  ]
  const topPosts = Array.from({ length: 3 }).map((_, i) => {
    const topic = sampleTopics[(h + i) % sampleTopics.length]!
    const likes = 800 + ((h + i * 977) % 6_200)
    const comments = 30 + ((h + i * 197) % 180)
    return {
      id: `ig_${handle}_${i}`,
      caption: `${topic} — post ${i + 1}`,
      likes,
      comments,
      permalink: `https://instagram.com/${handle.replace(/^@/, '')}/p/${i + 1}`,
      thumbnail: null,
    }
  })
  return { followerCount, followingCount, postCount, engagementRate, topPosts }
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
    const insights = stubInsightsForHandle(handle)

    const connection = await prisma.instagramConnection.upsert({
      where: { companyId: company.id },
      update: {
        handle,
        profileUrl: `https://instagram.com/${handle}`,
        ...insights,
        source: 'stub',
        connectedAt: new Date(),
      },
      create: {
        companyId: company.id,
        handle,
        profileUrl: `https://instagram.com/${handle}`,
        ...insights,
        source: 'stub',
      },
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

export default router
