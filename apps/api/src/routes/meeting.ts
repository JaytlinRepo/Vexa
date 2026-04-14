import { Router } from 'express'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import { isTestMode } from '../lib/mode'
import { readTopMemories, formatMemoryForPrompt } from '../lib/brandMemory'
import { PLAN_LIMITS } from '../lib/plans'

const prisma = new PrismaClient()
const router = Router()

function formatPlatformBlock(ig: {
  handle: string
  source: string
  followerCount: number
  engagementRate: number
  avgReach: number
  avgImpressions: number
  postCount: number
  topPosts: unknown
  audienceAge: unknown
  audienceTop: unknown
} | null): string {
  if (!ig || ig.source !== 'phyllo') return ''
  const topPosts = Array.isArray(ig.topPosts) ? ig.topPosts : []
  const topLine = topPosts[0]
    ? `  top post: "${String((topPosts[0] as { caption?: string }).caption || '').slice(0, 90)}" — ${(topPosts[0] as { like_count?: number }).like_count ?? 0} likes`
    : ''
  const ages = Array.isArray(ig.audienceAge) ? ig.audienceAge : []
  const topAge = ages.sort((a: { share: number }, b: { share: number }) => b.share - a.share)[0] as { bucket?: string } | undefined
  const countries = Array.isArray(ig.audienceTop) ? ig.audienceTop : []
  const topCountry = countries.sort((a: { share: number }, b: { share: number }) => b.share - a.share)[0] as { bucket?: string } | undefined
  return `

--- Live Instagram data (@${ig.handle}) ---
  ${ig.followerCount.toLocaleString()} followers, ${ig.postCount} posts
  ${ig.engagementRate}% engagement rate, avg reach ${ig.avgReach.toLocaleString()} / impressions ${ig.avgImpressions.toLocaleString()}
  primary audience: ${topAge?.bucket ?? 'unknown'}${topCountry?.bucket ? `, ${topCountry.bucket}` : ''}
${topLine}
Use these numbers when giving advice. Do not invent different stats.
--- End platform data ---`
}

const roleSchema = z.enum(['analyst', 'strategist', 'copywriter', 'creative_director'])

const replySchema = z.object({
  employeeRole: roleSchema,
  message: z.string().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
    .max(40)
    .default([]),
})

const PERSONA: Record<z.infer<typeof roleSchema>, { name: string; style: string; openers: string[] }> = {
  analyst: {
    name: 'Maya',
    style: 'data-driven, precise, cites numbers',
    openers: [
      'Looking at the signals, ',
      'Okay — a few data points first. ',
      'I pulled up what you asked. ',
    ],
  },
  strategist: {
    name: 'Jordan',
    style: 'calm, big-picture, talks in systems',
    openers: [
      'Let me zoom out for a second. ',
      'Here is how I would structure that. ',
      'Taking the last 30 days into account, ',
    ],
  },
  copywriter: {
    name: 'Alex',
    style: 'punchy, opinionated, pushes back',
    openers: [
      'I hear you, but — ',
      'Okay, I will say the thing. ',
      'Honest take: ',
    ],
  },
  creative_director: {
    name: 'Riley',
    style: 'visual, talks in shots and pacing',
    openers: [
      'Picture the open shot. ',
      'Let me walk through the cut. ',
      'Visually, I would push it this way. ',
    ],
  },
}

function hasBedrockCreds(): boolean {
  if (isTestMode()) return false
  return Boolean(process.env.AWS_REGION && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
}

function mockReply(role: z.infer<typeof roleSchema>, message: string): string {
  const p = PERSONA[role]
  const opener = p.openers[Math.floor(Math.random() * p.openers.length)]!
  const echo = message.length > 80 ? message.slice(0, 80) + '…' : message
  return `${opener}What I am hearing is: "${echo}". My instinct is to pull the thread on the second half of that. My style is ${p.style}, so let me come back with a concrete angle rather than a general reaction. Give me two things: the single metric you care about, and one post that worked recently so I can reverse-engineer why. Then I will have something specific to run with.`
}

async function streamMock(res: import('express').Response, text: string): Promise<void> {
  const tokens = text.split(/(\s+)/)
  for (const t of tokens) {
    res.write(`data: ${JSON.stringify({ chunk: t })}\n\n`)
    await new Promise((r) => setTimeout(r, 32))
  }
  res.write(`data: ${JSON.stringify({ done: true })}\n\n`)
  res.end()
}

async function streamBedrock(
  res: import('express').Response,
  role: z.infer<typeof roleSchema>,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  message: string,
  memoryBlock: string,
): Promise<void> {
  // Lazy-load bedrock so missing creds at boot don't crash the API.
  const { invokeAgentStream } = await import('../services/bedrock/bedrock.service')
  const p = PERSONA[role]
  const systemPrompt = `You are ${p.name}, the ${role.replace('_', ' ')}. Style: ${p.style}. Keep replies under 5 sentences unless asked to go deeper. You are in a one-on-one meeting with the CEO of an AI content company called Vexa.${memoryBlock}`
  try {
    await invokeAgentStream({
      systemPrompt,
      messages: [...history, { role: 'user', content: message }],
      maxTokens: 512,
      temperature: 0.8,
      onChunk: (text: string) => {
        res.write(`data: ${JSON.stringify({ chunk: text })}\n\n`)
      },
      onComplete: () => {
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`)
        res.end()
      },
      onError: (error: Error) => {
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`)
        res.end()
      },
    })
  } catch (err) {
    // Bedrock not usable — fall back to mock
    await streamMock(res, mockReply(role, message))
  }
}

router.post('/reply', requireAuth, async (req, res, next) => {
  try {
    const data = replySchema.parse(req.body)
    const { userId } = (req as AuthedRequest).session

    // Plan gate: starter normally doesn't include the Meeting feature, but
    // during the 7-day trial every user gets the full feature set so they
    // can evaluate it before committing.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true, subscriptionStatus: true, trialEndsAt: true },
    })
    const inTrial =
      user?.subscriptionStatus === 'trial' &&
      user?.trialEndsAt != null &&
      user.trialEndsAt.getTime() > Date.now()
    if (user && !inTrial && !PLAN_LIMITS[user.plan].meetingFeature) {
      res.status(402).json({ error: 'meeting_not_in_plan', plan: user.plan })
      return
    }

    // Pull this user's company + most relevant memories + platform data for
    // the system prompt.
    const company = await prisma.company.findFirst({
      where: { userId },
      include: { instagram: true },
    })
    let memoryBlock = ''
    let platformBlock = ''
    if (company) {
      const memories = await readTopMemories(prisma, company.id, 10)
      memoryBlock = formatMemoryForPrompt(memories)
      platformBlock = formatPlatformBlock(company.instagram)
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders?.()
    res.write(`data: ${JSON.stringify({ source: hasBedrockCreds() ? 'bedrock' : 'mock', memoryCount: memoryBlock ? (memoryBlock.match(/^- /gm) || []).length : 0 })}\n\n`)

    // Belt & suspenders: Claude requires the first entry in `messages` to
    // have role='user'. Trim any leading assistant turns from history in
    // case a client sends them by mistake.
    const sanitizedHistory = [...data.history]
    while (sanitizedHistory.length && sanitizedHistory[0]!.role !== 'user') {
      sanitizedHistory.shift()
    }

    if (hasBedrockCreds()) {
      await streamBedrock(res, data.employeeRole, sanitizedHistory, data.message, memoryBlock + platformBlock)
    } else {
      await streamMock(res, mockReply(data.employeeRole, data.message))
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'invalid_input', issues: err.issues })
      return
    }
    next(err)
  }
})

export default router
