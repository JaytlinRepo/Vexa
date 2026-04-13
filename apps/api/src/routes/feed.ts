import { Router } from 'express'
import axios from 'axios'
import { PrismaClient } from '@prisma/client'
import { requireAuth, AuthedRequest } from '../middleware/auth'

const prisma = new PrismaClient()
const router = Router()

interface FeedItem {
  id: string
  source: string
  title: string
  summary: string
  url: string
  createdAt: string
  type: 'article' | 'research' | 'reddit'
  score: number
  mayaTake: string
}

const SUBREDDITS_BY_NICHE: Record<string, string[]> = {
  fitness: ['fitness', 'xxfitness', 'loseit'],
  finance: ['personalfinance', 'investing'],
  food: ['Cooking', 'food'],
  coaching: ['coaching', 'productivity'],
  lifestyle: ['lifestyle', 'productivity'],
  personal_development: ['selfimprovement', 'getdisciplined'],
}

async function fetchRedditTop(sub: string, limit = 6): Promise<FeedItem[]> {
  try {
    const res = await axios.get(`https://www.reddit.com/r/${sub}/top.json`, {
      params: { t: 'week', limit },
      headers: { 'User-Agent': 'vexa-dev/0.1' },
      timeout: 8000,
    })
    const children = (res.data?.data?.children ?? []) as Array<{ data: Record<string, unknown> }>
    return children.map((c) => {
      const d = c.data as {
        id: string
        title: string
        selftext?: string
        ups?: number
        score?: number
        num_comments?: number
        permalink: string
        created_utc: number
      }
      const score = d.score ?? d.ups ?? 0
      const potential = Math.min(99, 60 + Math.floor(Math.log10(Math.max(10, score)) * 12))
      return {
        id: `reddit_${d.id}`,
        source: `r/${sub}`,
        title: d.title,
        summary: (d.selftext || '').slice(0, 240) || `${score.toLocaleString()} upvotes, ${d.num_comments ?? 0} comments — hot discussion on r/${sub}.`,
        url: `https://www.reddit.com${d.permalink}`,
        createdAt: new Date(d.created_utc * 1000).toISOString(),
        type: 'reddit',
        score: potential,
        mayaTake:
          score > 1000
            ? 'Real engagement here — the comments are where the hook language lives.'
            : 'Niche discussion with concrete pain points. Mine the top comments for angles.',
      }
    })
  } catch {
    return []
  }
}

function mockFallbackForNiche(niche: string): FeedItem[] {
  // Used when Reddit is unreachable (offline / rate-limited).
  const now = Date.now()
  const base: Array<Omit<FeedItem, 'id' | 'createdAt'>> = [
    {
      source: 'Demo feed',
      title: `Top-performing format in ${niche} this week: 15-second transformation Reels`,
      summary: 'Aggregated across 40 accounts in your niche — retention stays above 70% when the visual payoff lands in the first 2 seconds.',
      url: '#',
      type: 'research',
      score: 92,
      mayaTake: 'This is the week to ride the format. Riley should lean into the open shot.',
    },
    {
      source: 'Reddit-ish',
      title: 'What nobody is saying about cardio for fat loss',
      summary: 'Long comment thread picking apart why zone-2 advice is being oversold for the average creator audience.',
      url: '#',
      type: 'reddit',
      score: 87,
      mayaTake: 'Controversy is the hook. Alex, pull the hottest take and steelman the opposite.',
    },
    {
      source: 'Industry newsletter',
      title: 'Instagram quietly upweighted saves over likes in the ranking signal',
      summary: 'Multiple creator accounts report a shift in distribution favoring posts that generate high save-to-view ratios.',
      url: '#',
      type: 'article',
      score: 78,
      mayaTake: 'Jordan should re-tune this week around save-magnet formats — carousels over single Reels.',
    },
  ]
  return base.map((b, i) => ({
    ...b,
    id: `demo_${i}_${now}`,
    createdAt: new Date(now - (i + 1) * 3600 * 1000).toISOString(),
  }))
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const companyId = (req.query.companyId as string | undefined) ?? undefined
    const company = companyId
      ? await prisma.company.findFirst({ where: { id: companyId, userId } })
      : await prisma.company.findFirst({ where: { userId } })
    if (!company) {
      res.json({ items: [], niche: null })
      return
    }

    const niche = (company.niche as string) || 'lifestyle'
    const subs = SUBREDDITS_BY_NICHE[niche] ?? SUBREDDITS_BY_NICHE.lifestyle!

    const results = await Promise.all(subs.slice(0, 2).map((s) => fetchRedditTop(s, 5)))
    let items: FeedItem[] = results.flat()
    if (items.length === 0) items = mockFallbackForNiche(niche)

    items.sort((a, b) => b.score - a.score)
    res.json({ items: items.slice(0, 12), niche, source: items[0]?.id.startsWith('demo_') ? 'demo' : 'reddit' })
  } catch (err) {
    next(err)
  }
})

export default router
