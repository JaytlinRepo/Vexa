import { Router } from 'express'
import axios from 'axios'
import { PrismaClient } from '@prisma/client'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import { fetchNicheRSSFeeds, RSSItem } from '../services/integrations/rss.service'
import { getRelatedQueries, getKeywordTrend } from '../services/integrations/google-trends.service'
import { searchNicheVideos, YouTubeVideo } from '../services/integrations/youtube.service'
import { effectiveNiche } from '../lib/nicheDetection'

const prisma = new PrismaClient()
const router = Router()

// ─── Feed cache: avoid re-fetching Reddit + RSS + Trends on every request ────
const feedCache = new Map<string, { items: FeedItem[]; trends: TrendItem[]; videos: YouTubeVideo[]; ts: number }>()
const FEED_CACHE_TTL = 60 * 60 * 1000 // 1 hour

interface FeedItem {
  id: string
  source: string
  title: string
  summary: string
  fullContent?: string
  author?: string
  url: string
  imageUrl: string | null
  createdAt: string
  type: 'article' | 'research' | 'reddit' | 'trend' | 'video'
  score: number
  mayaTake: string
}

interface TrendItem {
  keyword: string
  risingPercent: number
  relatedQueries: string[]
  verdict: 'act now' | 'build' | 'watch'
}

// ─── Niche seed keywords for Google Trends ───────────────────────────────────
const TREND_SEEDS: Record<string, string[]> = {
  fitness:            ['workout', 'fitness', 'weight loss'],
  finance:            ['investing', 'personal finance', 'passive income'],
  food:               ['recipe', 'meal prep', 'cooking'],
  coaching:           ['productivity', 'mindset', 'self improvement'],
  lifestyle:          ['wellness', 'morning routine', 'self care'],
  personal_development: ['habits', 'motivation', 'mental health'],
}

async function fetchTrendSignals(niche: string): Promise<TrendItem[]> {
  const seeds = TREND_SEEDS[niche] || TREND_SEEDS.lifestyle!
  const results: TrendItem[] = []

  // Fetch 2 seed keywords (staggered to avoid rate limits)
  for (let i = 0; i < Math.min(2, seeds.length); i++) {
    const keyword = seeds[i]
    try {
      const trend = await getKeywordTrend(keyword)
      if (!trend) continue
      const related = await getRelatedQueries(keyword)

      // Only include if there's meaningful rising data
      const risingQueries = related.rising.filter(Boolean).slice(0, 5)
      if (risingQueries.length === 0 && (!trend.isRising || (trend.risingPercent || 0) < 5)) continue

      // Each rising query becomes a trend item
      for (const rq of risingQueries.slice(0, 3)) {
        const pct = trend.risingPercent || 0
        results.push({
          keyword: rq,
          risingPercent: pct,
          relatedQueries: related.top.slice(0, 3),
          verdict: pct > 100 ? 'act now' : pct > 20 ? 'build' : 'watch',
        })
      }

      // Also include the seed keyword itself if it's rising
      if (trend.isRising && (trend.risingPercent || 0) > 10) {
        results.push({
          keyword,
          risingPercent: trend.risingPercent || 0,
          relatedQueries: related.rising.slice(0, 3),
          verdict: (trend.risingPercent || 0) > 100 ? 'act now' : 'build',
        })
      }
    } catch {
      // Non-critical — continue with other seeds
    }
    // Stagger requests
    if (i < seeds.length - 1) await new Promise((r) => setTimeout(r, 1200))
  }

  // Sort by rising percent, highest first
  return results.sort((a, b) => b.risingPercent - a.risingPercent).slice(0, 6)
}

function trendToFeedItem(t: TrendItem): FeedItem {
  const verdictLabel = t.verdict === 'act now' ? 'Act now' : t.verdict === 'build' ? 'Build content' : 'Watch'
  const pctLabel = t.risingPercent > 0 ? `+${t.risingPercent}%` : 'rising'
  const relatedStr = t.relatedQueries.length > 0 ? ` Related: ${t.relatedQueries.join(', ')}.` : ''

  return {
    id: `trend_${Buffer.from(t.keyword).toString('base64').slice(0, 16)}`,
    source: 'Google Trends',
    title: `"${t.keyword}" is trending (${pctLabel})`,
    summary: `${verdictLabel} — this search term is rising in your niche.${relatedStr}`,
    url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(t.keyword)}`,
    imageUrl: null,
    createdAt: new Date().toISOString(),
    type: 'trend',
    score: t.verdict === 'act now' ? 95 : t.verdict === 'build' ? 82 : 68,
    mayaTake: t.verdict === 'act now'
      ? `"${t.keyword}" is spiking right now — short window.`
      : t.verdict === 'build'
        ? `Steady growth on "${t.keyword}". The audience is forming.`
        : `"${t.keyword}" is warming up in your space.`,
  }
}

function shortViews(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K'
  return String(n)
}

function youtubeToFeedItem(v: YouTubeVideo, niche: string, subNiche: string | null): FeedItem {
  const views = v.viewCount ? shortViews(v.viewCount) + ' views' : ''
  const likes = v.likeCount ? shortViews(v.likeCount) + ' likes' : ''
  const stats = [views, likes].filter(Boolean).join(' · ')
  const engRate = v.viewCount && v.likeCount ? (v.likeCount / v.viewCount * 100) : 0
  const score = Math.min(99, 65 + Math.floor(Math.log10(Math.max(10, v.viewCount || 10)) * 6))

  // Maya explains WHY this content is relevant to the user's niche
  const nicheLabel = subNiche ? `${subNiche}/${niche}` : niche
  const title = (v.title || '').toLowerCase()
  const desc = (v.description || '').toLowerCase()
  const combined = `${title} ${desc}`

  // Detect content angle from title/description
  const angles: string[] = []
  if (/vlog|day in|routine|morning|night/i.test(combined)) angles.push('day-in-my-life format')
  if (/travel|trip|destination|airport|hotel|explore/i.test(combined)) angles.push('travel content')
  if (/tips|how to|tutorial|guide|learn/i.test(combined)) angles.push('educational angle')
  if (/haul|unbox|review|try/i.test(combined)) angles.push('product/experience review')
  if (/transform|before|after|glow|results/i.test(combined)) angles.push('transformation arc')
  if (/aesthetic|cinematic|edit|transition/i.test(combined)) angles.push('visual storytelling')
  if (/motivat|mindset|grind|discipline/i.test(combined)) angles.push('motivational hook')

  const angleStr = angles.length > 0 ? angles.slice(0, 2).join(' + ') : 'content in your space'

  let mayaTake: string
  if ((v.viewCount || 0) >= 500_000) {
    mayaTake = `${shortViews(v.viewCount || 0)} views on ${angleStr} in ${nicheLabel}. This format is resonating with the audience right now.`
  } else if (engRate >= 5) {
    mayaTake = `${engRate.toFixed(1)}% like rate on ${angleStr}. Strong audience connection in the ${nicheLabel} space.`
  } else if (angles.length > 0) {
    mayaTake = `${angleStr[0].toUpperCase() + angleStr.slice(1)} performing in ${nicheLabel}. Similar audience to yours.`
  } else {
    mayaTake = `Active in ${nicheLabel} — trending in your space this week.`
  }

  return {
    id: `yt_${v.id}`,
    source: v.channelTitle || 'YouTube',
    title: v.title,
    summary: stats ? `${stats} — ${(v.description || '').slice(0, 160)}` : (v.description || '').slice(0, 200),
    url: v.url,
    imageUrl: v.thumbnailUrl || null,
    createdAt: v.publishedAt || new Date().toISOString(),
    type: 'video',
    score,
    mayaTake,
  }
}

const SUBREDDITS_BY_NICHE: Record<string, string[]> = {
  fitness: ['fitness', 'xxfitness', 'loseit'],
  finance: ['personalfinance', 'investing'],
  food: ['Cooking', 'food'],
  coaching: ['coaching', 'productivity'],
  lifestyle: ['lifestyle', 'productivity'],
  personal_development: ['selfimprovement', 'getdisciplined'],
}

const SUB_NICHE_SUBS: Record<string, Record<string, string[]>> = {
  lifestyle: {
    travel: ['travel', 'solotravel', 'digitalnomad'],
    college: ['college', 'GetStudying', 'frugal'],
    mom: ['Mommit', 'Parenting', 'workingmoms'],
    minimalism: ['minimalism', 'declutter', 'simpleliving'],
    wellness: ['wellness', 'Meditation', 'selfcare'],
  },
  fitness: {
    'weight loss': ['loseit', 'progresspics', 'CICO'],
    bodybuilding: ['bodybuilding', 'naturalbodybuilding'],
    yoga: ['yoga', 'flexibility', 'Meditation'],
    running: ['running', 'C25K', 'trailrunning'],
  },
  finance: {
    investing: ['investing', 'stocks', 'dividends'],
    budgeting: ['personalfinance', 'povertyfinance', 'ynab'],
    crypto: ['CryptoCurrency', 'Bitcoin', 'defi'],
  },
  food: {
    baking: ['Baking', 'Breadit', 'cakedecorating'],
    'meal prep': ['MealPrepSunday', 'EatCheapAndHealthy', 'slowcooking'],
    vegan: ['vegan', 'veganrecipes', 'PlantBasedDiet'],
  },
}

function subNicheSubs(niche: string, subNiche: string | null | undefined): string[] {
  if (!subNiche) return []
  const map = SUB_NICHE_SUBS[niche]
  if (!map) return []
  const lower = subNiche.toLowerCase()
  for (const [key, subs] of Object.entries(map)) {
    if (lower.includes(key) || key.includes(lower.split(' ')[0])) return subs
  }
  return []
}

function rssToFeedItem(r: RSSItem, niche?: string, subNiche?: string | null): FeedItem {
  const summary = (r.description || '').replace(/<[^>]+>/g, '').slice(0, 240) ||
    `${r.source} · ${r.publishedAt.toLocaleDateString()}`
  const nicheLabel = subNiche ? `${subNiche}/${niche}` : (niche || 'your niche')
  const isRecent = Date.now() - r.publishedAt.getTime() < 3 * 86400000
  const mayaTake = isRecent
    ? `Fresh from ${r.source} — trending in the ${nicheLabel} space right now.`
    : `${r.source} covers ${nicheLabel} regularly. Relevant to your audience.`
  return {
    id: `rss_${Buffer.from(r.url).toString('base64').slice(0, 24)}`,
    source: r.source,
    title: r.title,
    summary,
    fullContent: r.fullContent || undefined,
    author: r.author || undefined,
    url: r.url,
    imageUrl: r.imageUrl || null,
    createdAt: r.publishedAt.toISOString(),
    type: 'article',
    score: 80 + Math.min(15, Math.floor(isRecent ? 15 : 5)),
    mayaTake,
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

async function fetchRedditTop(sub: string, limit = 6, niche?: string, subNiche?: string | null): Promise<FeedItem[]> {
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
            ? `${score.toLocaleString()} upvotes in r/${sub} — high engagement from your ${subNiche || niche || 'niche'} community.`
            : `Discussion from the ${subNiche || niche || 'niche'} community on r/${sub}.`,
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
      res.json({ items: [], trends: [], niche: null })
      return
    }

    const niche = effectiveNiche(company) || 'lifestyle'
    const detectedSub = company.detectedSubNiche
    const extraSubs = subNicheSubs(niche, detectedSub)
    const baseSubs = SUBREDDITS_BY_NICHE[niche] ?? SUBREDDITS_BY_NICHE.lifestyle!
    const subs = extraSubs.length > 0 ? [...new Set([...extraSubs, ...baseSubs])] : baseSubs

    // Build a YouTube query from the user's actual profile context
    const platformAcct = await prisma.platformAccount.findFirst({
      where: { companyId: company.id },
      select: { bio: true, handle: true },
    })
    const bioKeywords = (platformAcct?.bio || '').replace(/[|·•\n]/g, ' ').split(/\s+/).filter((w: string) => w.length > 3).slice(0, 4).join(' ')
    const ytQuery = bioKeywords.length > 8
      ? `${bioKeywords} content creator`
      : undefined // fall back to niche-based search in the service

    // Hard cap at 10 items — keeps the feed tight and rotating.
    // Reddit capped at 1 — feed should be articles and news, not forums.
    const requestedLimit = Math.max(1, Math.min(10, Number(req.query.limit) || 10))
    const maxRedditShare = 1

    // ── Check cache ──────────────────────────────────────────────
    const cacheKey = `${niche}:${detectedSub || ''}`
    const cached = feedCache.get(cacheKey)
    if (cached && Date.now() - cached.ts < FEED_CACHE_TTL) {
      const items = interleaveByType(cached.items).slice(0, requestedLimit)
      res.json({ items, trends: cached.trends, videos: cached.videos, niche, source: 'cached' })
      return
    }

    // ── Fetch all sources in parallel ────────────────────────────
    const [redditResults, rssItems, trendSignals, ytVideos] = await Promise.all([
      Promise.all(subs.slice(0, 1).map((s) => fetchRedditTop(s, 2, niche, detectedSub))),
      fetchNicheRSSFeeds(niche, 4, 3, detectedSub).catch(() => [] as RSSItem[]),
      fetchTrendSignals(niche).catch(() => [] as TrendItem[]),
      searchNicheVideos(niche, detectedSub || undefined, 5, ytQuery || undefined).catch(() => [] as YouTubeVideo[]),
    ])

    let items: FeedItem[] = [
      // Articles and news — the core of the feed
      ...rssItems.map((r) => rssToFeedItem(r, niche, detectedSub)),
      // Real niche videos — study what's working
      ...ytVideos.slice(0, 5).map((v) => youtubeToFeedItem(v, niche, detectedSub)),
      // One Reddit post for community signal
      ...redditResults.flat().slice(0, maxRedditShare),
    ]
    if (items.length === 0) items = mockFallbackForNiche(niche)

    // Deduplicate by title similarity (rough — lowercase, strip punctuation)
    const seen = new Set<string>()
    items = items.filter((item) => {
      const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    // Cache the results
    feedCache.set(cacheKey, { items, trends: trendSignals, videos: ytVideos, ts: Date.now() })

    // Mix by type so no single source dominates
    items = interleaveByType(items)
    res.json({ items: items.slice(0, requestedLimit), trends: trendSignals, niche, source: 'mixed' })
  } catch (err) {
    next(err)
  }
})

// ── On-demand article content extraction ─────────────────────────────────────
// When RSS doesn't include full content, fetch the page and extract the article body.
const articleCache = new Map<string, { content: string; ts: number }>()
const ARTICLE_CACHE_TTL = 60 * 60 * 1000 // 1 hour

router.get('/article', requireAuth, async (req, res) => {
  const url = req.query.url as string
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'url required' })
    return
  }

  // Check cache
  const cached = articleCache.get(url)
  if (cached && Date.now() - cached.ts < ARTICLE_CACHE_TTL) {
    res.json({ content: cached.content, source: 'cached' })
    return
  }

  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'Sovexa/1.0 (content reader)' },
      responseType: 'text',
      maxRedirects: 3,
    })

    const html = response.data as string

    // Extract the main article content from the page
    let content = ''

    // Try <article> tag first
    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
    if (articleMatch) {
      content = articleMatch[1]
    }

    // Try common content selectors if <article> didn't work
    if (!content || content.length < 200) {
      const selectors = [
        /class="[^"]*(?:post-content|entry-content|article-content|article-body|story-body|post-body|content-body|main-content)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        /class="[^"]*(?:post_content|single-content|blog-content|page-content)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      ]
      for (const sel of selectors) {
        const m = html.match(sel)
        if (m && m[1].length > content.length) {
          content = m[1]
        }
      }
    }

    // Last resort: grab all <p> tags from <main> or <body>
    if (!content || content.length < 200) {
      const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
      const source = mainMatch ? mainMatch[1] : html
      const paragraphs = source.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || []
      // Filter out short paragraphs (nav items, footers)
      const meaningful = paragraphs.filter(p => {
        const text = p.replace(/<[^>]*>/g, '').trim()
        return text.length > 40
      })
      if (meaningful.length >= 3) {
        content = meaningful.join('\n')
      }
    }

    if (!content || content.length < 100) {
      res.json({ content: null, error: 'Could not extract article content' })
      return
    }

    // Clean the HTML
    const cleaned = content
      .replace(/<(script|style|iframe|noscript|nav|footer|header|aside|form)[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<img[^>]*>/gi, '')
      .replace(/<a\s+[^>]*href=["']([^"']*)["'][^>]*>/gi, '<a href="$1">')
      .replace(/<(\w+)\s+[^>]*>/g, '<$1>')
      .replace(/<\/?(?!p|h[1-6]|ul|ol|li|a|strong|em|br|blockquote)[a-z][^>]*>/gi, '')
      .replace(/<(\w+)>\s*<\/\1>/g, '')
      .trim()

    articleCache.set(url, { content: cleaned, ts: Date.now() })
    res.json({ content: cleaned })
  } catch (err) {
    console.warn('[feed/article] fetch failed:', (err as Error).message)
    res.json({ content: null, error: 'Failed to fetch article' })
  }
})

export default router
