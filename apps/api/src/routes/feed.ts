import { Router } from 'express'
import axios from 'axios'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import { fetchNicheRSSFeeds, RSSItem } from '../services/integrations/rss.service'
import { searchNicheArticles, NewsArticle } from '../services/integrations/newsapi.service'
import { getRelatedQueries, getKeywordTrend } from '../services/integrations/google-trends.service'
import { searchNicheVideos, YouTubeVideo } from '../services/integrations/youtube.service'
import { effectiveNiche } from '../lib/nicheDetection'
import { createContentProfile } from '../services/contentProfile.service'
import { fetchInstagramTrendingByHashtag, getHashtagsForNiche, instagramPostToFeedItem } from '../services/integrations/instagram-trending.service'

import prisma from '../lib/prisma'
const router = Router()
const contentProfile = createContentProfile(prisma)

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
  const subs = v.subscriberCount ? shortViews(v.subscriberCount) + ' subs' : ''
  const stats = [views, likes, subs].filter(Boolean).join(' · ')
  const engRate = v.viewCount && v.likeCount ? (v.likeCount / v.viewCount * 100) : 0
  // Score: views (0-70) + engagement (0-20) + recency (0-10)
  const viewScore = Math.min(70, Math.floor(Math.log10(Math.max(10, v.viewCount || 10)) * 14))
  const engScore = Math.min(20, Math.floor(engRate / 5))
  const recencyDays = Math.max(0, 30 - Math.floor((Date.now() - new Date(v.publishedAt).getTime()) / 86400000))
  const recencyScore = Math.floor(recencyDays / 3)
  const score = Math.min(99, viewScore + engScore + recencyScore)

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
  lifestyle: ['minimalism', 'simpleliving', 'selfimprovement', 'DecidingToBeBetter'],
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

function newsToFeedItem(a: NewsArticle, niche?: string, subNiche?: string | null): FeedItem {
  const nicheLabel = subNiche ? `${subNiche}/${niche}` : (niche || 'your niche')
  const ageHours = Math.floor((Date.now() - new Date(a.publishedAt).getTime()) / 3600000)
  // Score: recency (0-70) + source authority (25 base) + boost if <24h (0-5)
  const recencyScore = Math.max(0, 70 - (ageHours * 2))
  const sourceBoost = ageHours < 24 ? 5 : 0
  const score = Math.min(99, Math.floor(recencyScore + 25 + sourceBoost))

  const isFresh = ageHours < 24
  return {
    id: `news_${Buffer.from(a.url).toString('base64').slice(0, 24)}`,
    source: a.source,
    title: a.title,
    summary: a.description?.slice(0, 240) || `${a.source} · ${new Date(a.publishedAt).toLocaleDateString()}`,
    author: a.author || undefined,
    url: a.url,
    imageUrl: null,
    createdAt: a.publishedAt,
    type: 'article',
    score,
    mayaTake: isFresh
      ? `Breaking from ${a.source} — directly relevant to ${nicheLabel}. Your audience will be talking about this.`
      : `${a.source} covering ${nicheLabel} — useful for content angles.`,
  }
}

function rssToFeedItem(r: RSSItem, niche?: string, subNiche?: string | null): FeedItem {
  const summary = (r.description || '').replace(/<[^>]+>/g, '').slice(0, 240) ||
    `${r.source} · ${r.publishedAt.toLocaleDateString()}`
  const nicheLabel = subNiche ? `${subNiche}/${niche}` : (niche || 'your niche')
  const ageHours = Math.floor((Date.now() - r.publishedAt.getTime()) / 3600000)
  // Score: recency (0-65) + source authority (25 base) + length bonus (0-10)
  const recencyScore = Math.max(0, 65 - (ageHours * 1.5))
  const lengthBonus = (r.fullContent?.length || 0) > 500 ? 10 : 5
  const score = Math.min(99, Math.floor(recencyScore + 25 + lengthBonus))

  const isFresh = ageHours < 72
  const mayaTake = isFresh
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
    score,
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

function boostProfileMatchedReels(items: FeedItem[], userProfile: any): FeedItem[] {
  // Boost Reels (videos) that match user's content profile
  // Videos matching their aesthetic, themes, and audience characteristics get higher scores
  if (!userProfile) return items

  return items.map((item) => {
    if (item.type !== 'video') return item

    let boost = 0
    const title = item.title.toLowerCase()
    const summary = item.summary.toLowerCase()
    const combined = `${title} ${summary}`

    // ── Content theme matching ──
    if (userProfile.performancePattern?.contentThemes) {
      for (const theme of userProfile.performancePattern.contentThemes) {
        if (combined.includes(theme.toLowerCase())) {
          boost += 5
        }
      }
    }

    // ── Format matching ──
    if (userProfile.performancePattern?.bestPerformingFormat) {
      if (combined.includes(userProfile.performancePattern.bestPerformingFormat)) {
        boost += 8
      }
    }

    // ── Audience characteristics matching ──
    const audioCharacteristics = userProfile.audienceCharacteristics || {}

    // Age range and life stage keywords
    if (audioCharacteristics.ageRange) {
      const ageKeywords: Record<string, string[]> = {
        'teens': ['teen', 'student', 'school', 'college'],
        'young adults 18-25': ['young adult', 'college', 'university', 'early career'],
        '25-35': ['professional', 'career', 'young professional', 'startup'],
        '35-50': ['parent', 'family', 'kids', 'career'],
        '50+': ['empty nester', 'retirement', 'senior', 'boomer'],
        'families with kids': ['parent', 'kids', 'family', 'children', 'parenting', 'motherhood', 'fatherhood'],
      }
      const keywords = ageKeywords[audioCharacteristics.ageRange] || []
      for (const kw of keywords) {
        if (combined.includes(kw)) {
          boost += 3
          break // Only count once per category
        }
      }
    }

    // Lifestyle matching
    if (audioCharacteristics.lifestyle) {
      const lifestyleKeywords: Record<string, string[]> = {
        'minimalist': ['minimalist', 'minimal', 'declutter', 'simple'],
        'luxury': ['luxury', 'premium', 'high-end', 'exclusive'],
        'budget-conscious': ['budget', 'frugal', 'cheap', 'affordable', 'diy'],
        'family-focused': ['family', 'kids', 'parenting', 'household'],
        'adventurous': ['travel', 'adventure', 'explore', 'journey'],
        'health-focused': ['health', 'wellness', 'fitness', 'nutrition'],
        'spiritual': ['spiritual', 'meditation', 'mindfulness', 'yoga'],
      }
      const keywords = lifestyleKeywords[audioCharacteristics.lifestyle] || []
      for (const kw of keywords) {
        if (combined.includes(kw)) {
          boost += 3
          break
        }
      }
    }

    // Vibe matching
    if (audioCharacteristics.vibe) {
      const vibeKeywords: Record<string, string[]> = {
        'energetic': ['fast', 'quick', 'rapid', 'dynamic', 'high energy'],
        'calm': ['calm', 'peaceful', 'relaxing', 'slow', 'zen'],
        'educational': ['tutorial', 'how to', 'learn', 'guide', 'tips'],
        'entertaining': ['funny', 'humor', 'laugh', 'entertainment'],
        'luxury': ['luxury', 'premium', 'exclusive', 'high-end'],
        'relatable': ['relatable', 'real', 'authentic', 'honest'],
      }
      const keywords = vibeKeywords[audioCharacteristics.vibe] || []
      for (const kw of keywords) {
        if (combined.includes(kw)) {
          boost += 2
          break
        }
      }
    }

    // ── Specificity filtering ──
    // If user has "very niche" content, filter out overly generic content
    if (audioCharacteristics.specificity === 'very niche') {
      const genericKeywords = ['lifestyle', 'wellness', 'self care', 'health', 'motivation', 'tips', 'advice']
      let genericCount = 0
      for (const gk of genericKeywords) {
        if (combined.includes(gk)) genericCount++
      }
      // Penalize if content looks too generic
      if (genericCount >= 3) {
        boost -= 5
      }
    } else if (audioCharacteristics.specificity === 'niche') {
      // Same but less aggressive
      const genericKeywords = ['lifestyle', 'wellness', 'self care', 'health', 'motivation']
      let genericCount = 0
      for (const gk of genericKeywords) {
        if (combined.includes(gk)) genericCount++
      }
      if (genericCount >= 4) {
        boost -= 2
      }
    }

    // ── Tone matching ──
    if (userProfile.copyStyle?.tone) {
      if (item.mayaTake.includes('engagement')) {
        boost += 3
      }
    }

    return {
      ...item,
      score: Math.min(99, Math.max(1, item.score + boost)),
    }
  })
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
      const upvotes = d.score ?? d.ups ?? 0
      const commentEngagement = Math.min(20, Math.floor((d.num_comments ?? 0) / 5))
      const voteScore = Math.min(70, Math.floor(Math.log10(Math.max(10, upvotes)) * 14))
      const recencyDays = Math.max(0, 7 - Math.floor((Date.now() - d.created_utc * 1000) / 86400000))
      const recencyScore = recencyDays * 2
      const potential = Math.min(99, voteScore + commentEngagement + recencyScore)
      return {
        id: `reddit_${d.id}`,
        source: `r/${sub}`,
        title: d.title,
        summary: (d.selftext || '').slice(0, 240) || `${upvotes.toLocaleString()} upvotes, ${d.num_comments ?? 0} comments — hot discussion on r/${sub}.`,
        url: `https://www.reddit.com${d.permalink}`,
        imageUrl: extractRedditImage(c.data),
        createdAt: new Date(d.created_utc * 1000).toISOString(),
        type: 'reddit',
        score: potential,
        mayaTake:
          upvotes > 1000
            ? `${upvotes.toLocaleString()} upvotes in r/${sub} — high engagement from your ${subNiche || niche || 'niche'} community.`
            : `Discussion from the ${subNiche || niche || 'niche'} community on r/${sub}.`,
      }
    })
  } catch {
    return []
  }
}

function mockFallbackForNiche(niche: string): FeedItem[] {
  // Used when data sources are temporarily unavailable.
  // Returns niche-specific insights instead of generic fallback.
  const now = Date.now()

  // Niche-specific fallback insights
  const fallbacks: Record<string, Array<Omit<FeedItem, 'id' | 'createdAt' | 'imageUrl'>>> = {
    fitness: [
      {
        source: 'Trend detection',
        title: 'Short-form transformation content is trending hard right now',
        summary: 'Creators in your space are getting 40%+ engagement on 30-60 second before/after clips. The hook is in the first 3 seconds.',
        url: '#',
        type: 'research',
        score: 85,
        mayaTake: 'Test a quick transformation format — setup shot → fast cuts → final result in under 45 seconds.',
      },
    ],
    finance: [
      {
        source: 'Trend detection',
        title: 'Personal finance creators are moving toward "here\'s what I actually own" content',
        summary: 'Transparency on real assets, expenses, and income is getting higher engagement than theoretical advice right now.',
        url: '#',
        type: 'research',
        score: 84,
        mayaTake: 'Consider showing real financial statements or holdings (anonymized). Authenticity is the differentiator.',
      },
    ],
    food: [
      {
        source: 'Trend detection',
        title: 'Ingredient-focused, recipe-light content is performing',
        summary: 'Rather than full recipes, creators are doing deep dives on single ingredients or techniques. Higher view times, better saves.',
        url: '#',
        type: 'research',
        score: 83,
        mayaTake: 'Try picking one technique or ingredient per week and showing 5 different applications.',
      },
    ],
    coaching: [
      {
        source: 'Trend detection',
        title: 'Coaching creators: case studies and student wins are the strongest hook',
        summary: 'Before/after student stories and documented transformations outperform theoretical content by 3x.',
        url: '#',
        type: 'research',
        score: 86,
        mayaTake: 'Prioritize showing real student outcomes over teaching frameworks. The proof is the content.',
      },
    ],
    lifestyle: [
      {
        source: 'Trend detection',
        title: 'Day-in-the-life content with a specific angle is trending across niches',
        summary: 'But not generic — creators winning with daily routines tied to a specific outcome (minimalism, remote work setup, morning optimization).',
        url: '#',
        type: 'research',
        score: 82,
        mayaTake: 'Your daily routine is unique. Show it through the lens of your niche. What makes it different?',
      },
    ],
    personal_development: [
      {
        source: 'Trend detection',
        title: 'Habit stacking and tiny daily wins are outperforming big goal content',
        summary: 'Creators focused on 2-minute daily practices are getting more engagement than those discussing 90-day challenges.',
        url: '#',
        type: 'research',
        score: 81,
        mayaTake: 'Focus on the smallest unit of change. Make it so easy that skipping it feels silly.',
      },
    ],
  }

  const base = fallbacks[niche.toLowerCase()] || fallbacks.lifestyle
  return base.map((b, i) => ({
    ...b,
    id: `fallback_${niche}_${i}_${now}`,
    imageUrl: null,
    createdAt: new Date(now - i * 3600 * 1000).toISOString(),
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

    // Check if user has uploaded content
    const hasUserContent = await contentProfile.hasContent(company.id)
    if (!hasUserContent) {
      // Return message prompting upload instead of empty feed
      res.json({
        items: [],
        trends: [],
        niche: null,
        message: 'Upload your first video to unlock personalized content inspiration. The Knowledge Feed will show Reels and articles matched to your style.',
        requiresContent: true,
      })
      return
    }

    // Build user's content profile for filtering
    const userProfile = await contentProfile.getProfile(company.id)

    const niche = effectiveNiche(company) || 'lifestyle'
    const detectedSub = company.detectedSubNiche
    const extraSubs = subNicheSubs(niche, detectedSub)
    const baseSubs = SUBREDDITS_BY_NICHE[niche] ?? SUBREDDITS_BY_NICHE.lifestyle!
    const subs = extraSubs.length > 0 ? [...new Set([...extraSubs, ...baseSubs])] : baseSubs

    // Build YouTube query from user's content profile + bio + audience characteristics
    const platformAcct = await prisma.platformAccount.findFirst({
      where: { companyId: company.id },
      select: { bio: true, handle: true },
    })
    const bioKeywords = (platformAcct?.bio || '').replace(/[|·•\n]/g, ' ').split(/\s+/).filter((w: string) => w.length > 3).slice(0, 4).join(' ')

    // Use content profile themes + visual style + audience characteristics for dynamic queries
    let ytQuery: string | undefined
    if (userProfile) {
      const queryParts: string[] = []

      // Add content themes
      const themes = userProfile.performancePattern?.contentThemes || []
      queryParts.push(...themes.slice(0, 2))

      // Add audience-specific keywords to narrow results
      const audioCh = userProfile.audienceCharacteristics || {}
      if (audioCh.ageRange) {
        const ageToQuery: Record<string, string> = {
          'teens': 'teen creator',
          'young adults 18-25': 'young adult 25',
          '25-35': 'professional 30s',
          '35-50': 'parent 40s',
          '50+': 'over 50',
          'families with kids': 'parent family kids',
        }
        const ageQuery = ageToQuery[audioCh.ageRange]
        if (ageQuery) queryParts.push(ageQuery)
      }

      // Add lifestyle for specificity
      if (audioCh.lifestyle) {
        const lifestyleToQuery: Record<string, string> = {
          'minimalist': 'minimalist lifestyle',
          'luxury': 'luxury lifestyle',
          'budget-conscious': 'budget friendly diy',
          'family-focused': 'family focused',
          'adventurous': 'travel adventure',
          'health-focused': 'wellness health',
          'spiritual': 'spiritual mindfulness',
        }
        const lifestyleQuery = lifestyleToQuery[audioCh.lifestyle]
        if (lifestyleQuery) queryParts.push(lifestyleQuery)
      }

      // Add visual style
      const style = userProfile.visualStyle?.filters || []
      queryParts.push(...style.slice(0, 1))

      // Build final query from parts (deduped)
      const uniqueTerms = [...new Set(queryParts.filter(Boolean))]
      const profileTerms = uniqueTerms.slice(0, 4).join(' ')
      if (profileTerms.length > 5) ytQuery = `${profileTerms} creator`
    }
    if (!ytQuery && bioKeywords.length > 8) ytQuery = `${bioKeywords} content creator`

    // Feed limits — more reels, articles on the side
    const requestedLimit = Math.max(1, Math.min(25, Number(req.query.limit) || 25))
    const maxRedditShare = 3

    // ── Check cache ──────────────────────────────────────────────
    const cacheKey = `${niche}:${detectedSub || ''}`
    const cached = feedCache.get(cacheKey)
    if (cached && Date.now() - cached.ts < FEED_CACHE_TTL) {
      const items = interleaveByType(cached.items).slice(0, requestedLimit)
      res.json({ items, trends: cached.trends, videos: cached.videos, niche, source: 'cached', cacheAge: Math.round((Date.now() - cached.ts) / 1000) })
      return
    }

    // ── Fetch all sources in parallel ────────────────────────────
    // Get Instagram hashtags for niche
    const igHashtags = getHashtagsForNiche(niche, detectedSub)

    const [redditResults, rssItems, newsItems, trendSignals, ytVideos, igPosts] = await Promise.all([
      Promise.all(subs.slice(0, 1).map((s) => fetchRedditTop(s, 2, niche, detectedSub))),
      fetchNicheRSSFeeds(niche, 4, 3, detectedSub).catch(() => [] as RSSItem[]),
      searchNicheArticles(niche, detectedSub || undefined, 5).catch(() => [] as NewsArticle[]),
      fetchTrendSignals(niche).catch(() => [] as TrendItem[]),
      searchNicheVideos(niche, detectedSub || undefined, 10, ytQuery || undefined).catch(() => [] as YouTubeVideo[]),
      (async () => {
        // Get Instagram token from user's connected account
        const igConn = await prisma.instagramConnection.findFirst({ where: { companyId: company.id } })
        if (!igConn?.accessToken || !igConn?.igBusinessId) return []
        return fetchInstagramTrendingByHashtag(igConn.accessToken, igConn.igBusinessId, igHashtags.slice(0, 3), 5)
      })().catch(() => []),
    ])

    let items: FeedItem[] = [
      // Articles and news
      ...rssItems.map((r) => rssToFeedItem(r, niche, detectedSub)),
      ...newsItems.slice(0, 3).map((a) => newsToFeedItem(a, niche, detectedSub)),
      // YouTube videos/Reels
      ...ytVideos.slice(0, 10).map((v) => youtubeToFeedItem(v, niche, detectedSub)),
      // Instagram trending posts
      ...igPosts.slice(0, 5).map((p) => instagramPostToFeedItem(p, niche, detectedSub)),
      // Reddit community discussions
      ...redditResults.flat().slice(0, maxRedditShare),
    ]
    let feedSource = 'live'
    if (items.length === 0) {
      items = mockFallbackForNiche(niche)
      feedSource = 'fallback'
    }

    // Boost Reels that match user's content profile
    items = boostProfileMatchedReels(items, userProfile)

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
    res.json({ items: items.slice(0, requestedLimit), trends: trendSignals, niche, source: feedSource })
  } catch (err) {
    next(err)
  }
})

// ── On-demand article content extraction ─────────────────────────────────────
// When RSS doesn't include full content, fetch the page and extract the article body.
const articleCache = new Map<string, { content: string; ts: number }>()
const ARTICLE_CACHE_TTL = 60 * 60 * 1000 // 1 hour

// ── Manual cache refresh ────────────────────────────────────────────────────
// Allow users to force a fresh feed without waiting for TTL to expire
router.post('/refresh', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const companyId = (req.query.companyId as string | undefined) ?? undefined
    const company = companyId
      ? await prisma.company.findFirst({ where: { id: companyId, userId } })
      : await prisma.company.findFirst({ where: { userId } })
    if (!company) {
      return res.json({ success: false, message: 'Company not found' })
    }

    const niche = effectiveNiche(company) || 'lifestyle'
    const detectedSub = company.detectedSubNiche
    const cacheKey = `${niche}:${detectedSub || ''}`
    feedCache.delete(cacheKey) // Clear cache for this niche
    articleCache.clear() // Also clear article cache

    res.json({ success: true, message: 'Cache cleared — fetching fresh data...' })
  } catch (err) {
    next(err)
  }
})

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
