import { Router } from 'express'
import axios from 'axios'
import { PrismaClient } from '@prisma/client'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import { fetchNicheRSSFeeds, RSSItem } from '../services/integrations/rss.service'
import { effectiveNiche } from '../lib/nicheDetection'

const prisma = new PrismaClient()
const router = Router()

interface FeedItem {
  id: string
  source: string
  title: string
  summary: string
  url: string
  imageUrl: string | null
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

function rssToFeedItem(r: RSSItem): FeedItem {
  // Map RSS publisher articles onto the FeedItem shape. Score uses source
  // quality as a proxy (high-quality publishers start at 85) since RSS
  // doesn't expose engagement counts.
  const summary = (r.description || '').replace(/<[^>]+>/g, '').slice(0, 240) ||
    `${r.source} · ${r.publishedAt.toLocaleDateString()}`
  return {
    id: `rss_${Buffer.from(r.url).toString('base64').slice(0, 24)}`,
    source: r.source,
    title: r.title,
    summary,
    url: r.url,
    imageUrl: r.imageUrl || null,
    createdAt: r.publishedAt.toISOString(),
    type: 'article',
    score: 80 + Math.min(15, Math.floor((Date.now() - r.publishedAt.getTime() < 3 * 86400000 ? 15 : 5))),
    mayaTake:
      'Publisher coverage — strong anchor for an educational Reel or carousel citing the source.',
  }
}

function interleaveByType(items: FeedItem[]): FeedItem[] {
  const byType: Record<string, FeedItem[]> = {}
  for (const i of items) {
    ;(byType[i.type] ||= []).push(i)
  }
  const out: FeedItem[] = []
  let added = true
  while (added) {
    added = false
    for (const key of Object.keys(byType)) {
      const next = byType[key].shift()
      if (next) {
        out.push(next)
        added = true
      }
    }
  }
  return out
}

function extractRedditImage(d: Record<string, unknown>): string | null {
  const thumb = d.thumbnail as string | undefined
  if (thumb && /^https?:\/\//.test(thumb)) return thumb
  const preview = d.preview as { images?: Array<{ source?: { url?: string } }> } | undefined
  const url = preview?.images?.[0]?.source?.url
  if (url) return url.replace(/&amp;/g, '&')
  const directUrl = d.url as string | undefined
  if (directUrl && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(directUrl)) return directUrl
  return null
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
        imageUrl: extractRedditImage(c.data),
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
  const base: Array<Omit<FeedItem, 'id' | 'createdAt' | 'imageUrl'>> = [
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
    imageUrl: null,
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

    const niche = effectiveNiche(company) || 'lifestyle'
    const subs = SUBREDDITS_BY_NICHE[niche] ?? SUBREDDITS_BY_NICHE.lifestyle!

    const requestedLimit = Math.max(1, Math.min(24, Number(req.query.limit) || 12))
    // Cap Reddit to a small share of the feed — publisher RSS articles
    // read better and keep Maya's feed from feeling like r/ all day.
    const maxRedditShare = Math.max(1, Math.min(4, Number(req.query.redditMax) || 3))

    const [redditResults, rssItems] = await Promise.all([
      Promise.all(subs.slice(0, 2).map((s) => fetchRedditTop(s, 3))),
      fetchNicheRSSFeeds(niche, 4, 4).catch(() => [] as RSSItem[]),
    ])

    let items: FeedItem[] = [
      ...redditResults.flat().slice(0, maxRedditShare),
      ...rssItems.map(rssToFeedItem),
    ]
    if (items.length === 0) items = mockFallbackForNiche(niche)

    // Mix: alternate by source so Reddit doesn't bunch at the top.
    items = interleaveByType(items)
    res.json({ items: items.slice(0, requestedLimit), niche, source: 'mixed' })
  } catch (err) {
    next(err)
  }
})

export default router
