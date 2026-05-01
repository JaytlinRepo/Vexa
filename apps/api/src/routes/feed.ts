import { Router } from 'express'
import axios from 'axios'
import { requireAuth, AuthedRequest } from '../middleware/auth'
// Article/video sources kept imported because the /article extraction route
// + the legacy /refresh route still reference some of them. The main feed
// no longer pulls from YouTube / Reddit / RSS / NewsAPI / Google Trends —
// content is now Sovexa community videos + IG hashtag trending only.
import { fetchNicheRSSFeeds, RSSItem } from '../services/integrations/rss.service'
import { searchNicheArticles, NewsArticle } from '../services/integrations/newsapi.service'
import { getRelatedQueries, getKeywordTrend } from '../services/integrations/google-trends.service'
import { searchNicheVideos, YouTubeVideo } from '../services/integrations/youtube.service'
import { effectiveNiche } from '../lib/nicheDetection'
import { createContentProfile } from '../services/contentProfile.service'
import { fetchInstagramTrendingByHashtag, getHashtagsForNiche, instagramPostToFeedItem } from '../services/integrations/instagram-trending.service'
import { queryCommunityFeed, communityPostToFeedItem } from '../services/communityFeed.service'
import {
  getFeedContentProfile,
  invalidateFeedContentProfile,
  queryHashtagsForProfile,
  relevanceOverlap,
  maybePersistDetectedSubNiche,
  type FeedContentProfile,
} from '../services/feedContentProfile.service'
import { getDampenedTargets } from '../services/feedSignal.service'
import { tagFeedItemsBulk } from '../services/feedItemTagging.service'
import { scoreFeedItem, relevanceThreshold } from '../services/feedRelevance.service'
import { embedItemsBulk, getOrComputeProfileEmbedding } from '../services/feedEmbedding.service'

import prisma from '../lib/prisma'
const router = Router()
const contentProfile = createContentProfile(prisma)

// ─── Feed cache: avoid re-fetching Reddit + RSS + Trends on every request ────
const feedCache = new Map<string, { items: FeedItem[]; trends: TrendItem[]; videos: YouTubeVideo[]; ts: number }>()
const FEED_CACHE_TTL = 60 * 60 * 1000 // 1 hour

// ─── Trend cache: Google Trends calls are expensive + slow ────────────────────
const trendCache = new Map<string, { data: TrendItem[]; ts: number }>()
const TREND_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

// ─── YouTube cache: by niche+query to avoid redundant searches ────────────────
const youtubeCache = new Map<string, { videos: YouTubeVideo[]; ts: number }>()
const YOUTUBE_CACHE_TTL = 30 * 60 * 1000 // 30 minutes

// ─── In-flight request tracking: prevent thundering herd ──────────────────────
const feedRequests = new Map<string, Promise<{ items: FeedItem[]; trends: TrendItem[] }>>()

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
  type: 'article' | 'research' | 'reddit' | 'trend' | 'video' | 'instagram'
  score: number
  mayaTake: string
  /** Mood/style/format/hook/audience tags (CommunityTags shape).
   *  Set on community items by communityPostToFeedItem; set on
   *  IG-trending items by feedItemTagging.service.ts on the fly. Read
   *  by feedRelevance.scoreFeedItem(). */
  tags?: import('../services/communityTagging.service').CommunityTags | null
  /** Semantic embedding for cosine-similarity ranking. */
  embedding?: number[] | null
  /** IG-trending only — used by the lazy mood/style tagger. */
  thumbnail?: string | null
  videoUrl?: string | null
  mediaType?: string
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
  // Check cache first
  const cached = trendCache.get(niche)
  if (cached && Date.now() - cached.ts < TREND_CACHE_TTL) {
    return cached.data
  }

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
  const sorted = results.sort((a, b) => b.risingPercent - a.risingPercent).slice(0, 6)

  // Cache the results
  trendCache.set(niche, { data: sorted, ts: Date.now() })

  return sorted
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

async function searchYoutubeWithCache(
  niche: string,
  subNiche: string | undefined,
  limit: number,
  query: string | undefined
): Promise<YouTubeVideo[]> {
  const cacheKey = `${niche}:${subNiche || ''}:${query || 'default'}`
  const cached = youtubeCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < YOUTUBE_CACHE_TTL) {
    return cached.videos
  }

  const videos = await searchNicheVideos(niche, subNiche, limit, query).catch(() => [] as YouTubeVideo[])
  youtubeCache.set(cacheKey, { videos, ts: Date.now() })
  return videos
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

    // Backfill Company.country from PlatformAudience top-country when null
    // so the country boost has something to work with on the very first
    // /api/feed call. Fire-and-forget; we keep going with whatever the
    // current profile says.
    if (!company.country) {
      ;(async () => {
        try {
          const audience = await prisma.platformAudience.findFirst({
            where: { account: { companyId: company.id } },
            orderBy: { capturedAt: 'desc' },
            select: { topCountries: true },
          })
          const top = (audience?.topCountries as Array<{ bucket?: string; share?: number }> | null)?.[0]
          const code = top?.bucket
          if (code && /^[A-Z]{2}$/i.test(code)) {
            // updateMany lets us guard with where:{country:null} so two
            // parallel calls don't race on the same row.
            await prisma.company.updateMany({
              where: { id: company.id, country: null },
              data: { country: code.toUpperCase() },
            })
            invalidateFeedContentProfile(company.id)
          }
        } catch {
          // best-effort; don't block the feed
        }
      })()
    }

    // Build content profile from the user's actual posts. Drives query
    // seeds, the relevance gate, country boost, and author affinity.
    const profile = await getFeedContentProfile(prisma, company.id)
    // Auto-detect + persist sub-niche when confident — fire-and-forget so
    // the response isn't held up by the Company.update.
    maybePersistDetectedSubNiche(prisma, profile).catch(() => null)

    // Pull behavioral signal aggregates: which creators/topics has the
    // user explicitly told us they don't want? Fail-soft if the table is
    // empty for a brand-new company.
    const dampened = await getDampenedTargets(prisma, company.id, 60).catch(
      () => ({ creators: new Set<string>(), topics: new Set<string>(), posts: new Set<string>() }),
    )

    // Synthesize the viewerProfile shape that queryCommunityFeed expects so
    // it can score community posts by tag overlap with the user's content.
    const viewerProfile = {
      performancePattern: {
        contentThemes: [
          ...profile.topAITags.slice(0, 4),
          ...profile.topHashtags.slice(0, 3),
        ],
        bestPerformingFormat: profile.dominantFormats[0] || '',
      },
    }

    const niche = profile.niche
    const detectedSub = profile.detectedSubNiche
    const requestedLimit = Math.max(1, Math.min(25, Number(req.query.limit) || 25))
    const requestedOffset = Math.max(0, Number(req.query.offset) || 0)
    // Build a pool deeper than the requested page so the user can scroll
    // through several pages without triggering another external API call.
    // Sized for ~4 pages of 25 = 100 items end-to-end after filtering.
    const POOL_TARGET = 100

    // Cache key includes profile.strength, sub-niche, country, and a
    // signal-aware suffix so a Not-interested click immediately produces
    // a different feed (the cached version doesn't reflect the new
    // dampening). affinityCount + dampenedSize are cheap proxies for
    // "behavioral state changed".
    const signalSig = `a${profile.affinityCreators.length}d${dampened.creators.size + dampened.topics.size}`
    const cacheKey = `${company.id}:${profile.strength}:${detectedSub || ''}:${profile.country || ''}:${signalSig}`
    const cached = feedCache.get(cacheKey)
    if (cached && Date.now() - cached.ts < FEED_CACHE_TTL) {
      const slice = cached.items.slice(requestedOffset, requestedOffset + requestedLimit)
      res.json({
        items: slice,
        trends: [],
        niche,
        source: 'cached',
        cacheAge: Math.round((Date.now() - cached.ts) / 1000),
        profileStrength: profile.strength,
        offset: requestedOffset,
        total: cached.items.length,
        hasMore: requestedOffset + slice.length < cached.items.length,
        cacheTtlSeconds: Math.round((FEED_CACHE_TTL - (Date.now() - cached.ts)) / 1000),
      })
      return
    }

    const inFlightRequest = feedRequests.get(cacheKey)
    if (inFlightRequest) {
      const { items: allItems } = await inFlightRequest
      const slice = allItems.slice(requestedOffset, requestedOffset + requestedLimit)
      res.json({
        items: slice,
        trends: [],
        niche,
        source: 'deduplicated',
        profileStrength: profile.strength,
        offset: requestedOffset,
        total: allItems.length,
        hasMore: requestedOffset + slice.length < allItems.length,
      })
      return
    }

    const COMMUNITY_VIDEO_MIN = 8

    const fetchPromise = (async () => {
      // ── 1. Sovexa community (other CEOs' opted-in posts) ──
      // Build a deep pool so subsequent paginated requests can be served
      // entirely from cache without re-hitting external APIs.
      const community = await queryCommunityFeed(prisma, company.id, {
        limit: POOL_TARGET,
        niche,
        subNiche: detectedSub,
        viewerProfile,
        viewerCountry: profile.country,
      }).catch(() => ({ posts: [], totalAvailable: 0 }))

      let videoItems: FeedItem[] = community.posts.map(communityPostToFeedItem)
      let feedSource = videoItems.length > 0 ? 'community' : 'empty'

      // ── 2. Cross-niche community fallback (never empty) ──
      if (videoItems.length < COMMUNITY_VIDEO_MIN) {
        const crossNiche = await queryCommunityFeed(prisma, company.id, {
          limit: POOL_TARGET - videoItems.length,
          viewerProfile,
          viewerCountry: profile.country,
        }).catch(() => ({ posts: [], totalAvailable: 0 }))
        const existingIds = new Set(videoItems.map((i) => i.id))
        const crossItems = crossNiche.posts
          .filter((p) => !existingIds.has(`community_${p.id}`))
          .map(communityPostToFeedItem)
        videoItems = [...videoItems, ...crossItems]
        if (crossItems.length > 0) {
          feedSource = feedSource === 'empty' ? 'community-cross' : 'community+cross'
        }
      }

      // ── 3. IG hashtag trending — uses profile.topHashtags when rich,
      //      otherwise the niche-default fallback list. Pull volume sized
      //      so the cached pool can serve multiple pages without a fresh
      //      external call. ──
      if (videoItems.length < POOL_TARGET) {
        try {
          const igConn = await prisma.instagramConnection.findFirst({
            where: { companyId: company.id },
          })
          if (igConn?.accessToken && igConn?.igBusinessId) {
            const fallbackTags = getHashtagsForNiche(niche, detectedSub)
            const queryTags = queryHashtagsForProfile(profile, fallbackTags)
            // Over-fetch by ~2× the gap because the relevance gate +
            // dampening typically drop a non-trivial share, and we want
            // to land near POOL_TARGET after filtering.
            const targetIgCount = Math.max(30, (POOL_TARGET - videoItems.length) * 2)
            const igPosts = await fetchInstagramTrendingByHashtag(
              igConn.accessToken,
              igConn.igBusinessId,
              queryTags.slice(0, 6),
              targetIgCount,
            )
            const igItems: FeedItem[] = igPosts.map((p) =>
              instagramPostToFeedItem(p, niche, detectedSub),
            )
            const seenIds = new Set(videoItems.map((i) => i.id))
            const newIg = igItems.filter((i) => !seenIds.has(i.id))
            videoItems = [...videoItems, ...newIg]
            if (newIg.length > 0) {
              feedSource = feedSource === 'empty' ? 'ig-trending' : feedSource + '+ig-trending'
            }
          }
        } catch (err) {
          console.warn('[feed] IG trending fetch failed:', (err as Error).message)
        }
      }

      // ── 4. Dampening — drop creators/topics the user has explicitly
      //      Not-interested or Dismissed within the last 60 days. ──
      if (dampened.creators.size > 0 || dampened.topics.size > 0) {
        const before = videoItems.length
        videoItems = videoItems.filter((item) => {
          const handle = (item.source || '').toLowerCase()
          if (handle && dampened.creators.has(handle)) return false
          // Topic match: if any dampened topic appears in title/summary
          for (const topic of dampened.topics) {
            const t = topic.toLowerCase()
            if (item.title.toLowerCase().includes(t) || (item.summary || '').toLowerCase().includes(t)) {
              return false
            }
          }
          return true
        })
        if (process.env.NODE_ENV !== 'production' && before !== videoItems.length) {
          console.log(`[feed] dampening ${company.id.slice(0, 8)}: ${before} -> ${videoItems.length}`)
        }
      }

      // ── 5. Mood/style/format tagging + semantic embedding (parallel).
      //      Both run in parallel — tagging is ~10x slower than embedding,
      //      so doing them concurrently doesn't extend feed latency. The
      //      profile embedding is fetched alongside (cached 7 days on DB).
      //      Skipped entirely for thin/empty profiles to save cost on
      //      cold-start users. ──
      let profileEmbedding: number[] | null = null
      if (profile.strength === 'rich') {
        const untagged = videoItems.filter((it) => !it.tags && (it.id.startsWith('ig_') || it.type === 'instagram'))
        const embeddable = videoItems  // every item gets considered for embedding

        const tagPromise = untagged.length > 0
          ? tagFeedItemsBulk(
              untagged.map((it) => ({
                id: it.id,
                title: it.title,
                summary: it.summary,
                imageUrl: it.imageUrl,
                thumbnail: (it as any).thumbnail,
                videoUrl: (it as any).videoUrl,
                mediaType: (it as any).mediaType,
              })),
              niche,
              detectedSub,
              { maxFresh: 30, concurrency: 3 },
            ).catch((err) => {
              console.warn('[feed] IG tagging pass failed:', (err as Error).message)
              return new Map()
            })
          : Promise.resolve(new Map())

        const profileEmbedPromise = getOrComputeProfileEmbedding(prisma, company.id, profile)
          .catch((err) => {
            console.warn('[feed] profile embed failed:', (err as Error).message)
            return null
          })

        const [taggedMap, profileEmb] = await Promise.all([tagPromise, profileEmbedPromise])
        profileEmbedding = profileEmb

        // Apply tags before embedding so the embed text can include them.
        for (const it of videoItems) {
          if (!it.tags && taggedMap.has(it.id)) {
            it.tags = taggedMap.get(it.id) ?? null
          }
        }

        // Now embed candidate items. Runs after tagging completes so each
        // item's embedding text can include its tag values, sharpening
        // semantic match. Persists community vectors to PlatformPost.
        try {
          const embedMap = await embedItemsBulk(
            prisma,
            embeddable.map((it) => ({
              id: it.id,
              title: it.title,
              summary: it.summary,
              tags: it.tags ?? null,
            })),
            { maxFresh: 100, concurrency: 8, companyId: company.id },
          )
          for (const it of videoItems) {
            if (embedMap.has(it.id)) it.embedding = embedMap.get(it.id) ?? null
          }
        } catch (err) {
          console.warn('[feed] item embedding pass failed:', (err as Error).message)
        }
      }

      // ── 6. Relevance gate — three-component similarity score (token
      //      overlap + mood/style tag match + cosine semantic similarity).
      //      Items below threshold are dropped. Cold-start users
      //      (thin/empty profile) never see a gated feed
      //      (relevanceThreshold returns 0). ──
      {
        const threshold = relevanceThreshold(profile)
        if (threshold > 0) {
          const before = videoItems.length
          videoItems = videoItems.filter((item) => scoreFeedItem(item, profile, profileEmbedding) >= threshold)
          if (process.env.NODE_ENV !== 'production') {
            console.log(`[feed] relevance gate ${company.id.slice(0, 8)} ${niche}: ${before} -> ${videoItems.length} (threshold=${threshold})`)
          }
        }
      }

      // ── 7. Author affinity — items from creators the user has revealed
      //      or opened recently move toward the top. Stable sort: items
      //      retain their internal order within the affinity bucket. ──
      if (profile.affinityCreators.length > 0) {
        const affinitySet = new Set(profile.affinityCreators.map((c) => c.toLowerCase()))
        videoItems.sort((a, b) => {
          const aHit = affinitySet.has((a.source || '').toLowerCase()) ? 1 : 0
          const bHit = affinitySet.has((b.source || '').toLowerCase()) ? 1 : 0
          return bHit - aHit
        })
      }

      // ── 8. Dedup by title slug ──
      const seenTitle = new Set<string>()
      videoItems = videoItems.filter((item) => {
        const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40)
        if (seenTitle.has(key)) return false
        seenTitle.add(key)
        return true
      })

      // ── 9. Dedup by creator — cap at 2 tiles per @handle. Only applies
      //      to community items where the source IS the creator's handle.
      //      IG-trending items all share `source='Instagram'` (the IG
      //      hashtag API doesn't expose usernames), so capping that bucket
      //      collapses the entire IG lane to 2 tiles — exactly what we
      //      DON'T want. Skip non-handle sources here. ──
      const creatorCounts = new Map<string, number>()
      videoItems = videoItems.filter((item) => {
        const src = (item.source || '').toLowerCase()
        if (!src.startsWith('@')) return true   // IG-trending, fallback, etc.
        const count = (creatorCounts.get(src) ?? 0) + 1
        creatorCounts.set(src, count)
        return count <= 2
      })

      // ── 10. Last-resort: never empty. Fall back to mock content for the
      //      declared niche so the page always has something to show. ──
      if (videoItems.length === 0) {
        videoItems = mockFallbackForNiche(niche)
        feedSource = 'fallback'
      }

      feedCache.set(cacheKey, { items: videoItems, trends: [], videos: [], ts: Date.now() })
      return { items: videoItems, trends: [] as TrendItem[], feedSource }
    })()

    feedRequests.set(cacheKey, fetchPromise as unknown as Promise<{ items: FeedItem[]; trends: TrendItem[] }>)

    try {
      const { items: poolItems, feedSource } = await fetchPromise
      const slice = poolItems.slice(requestedOffset, requestedOffset + requestedLimit)
      res.json({
        items: slice,
        trends: [],
        niche,
        source: feedSource,
        profileStrength: profile.strength,
        offset: requestedOffset,
        total: poolItems.length,
        hasMore: requestedOffset + slice.length < poolItems.length,
        cacheTtlSeconds: Math.round(FEED_CACHE_TTL / 1000),
      })
    } finally {
      feedRequests.delete(cacheKey)
    }
  } catch (err) {
    next(err)
  }
})

// ── On-demand article content extraction ─────────────────────────────────────
// When RSS doesn't include full content, fetch the page and extract the article body.
const articleCache = new Map<string, { content: string; ts: number }>()
const ARTICLE_CACHE_TTL = 60 * 60 * 1000 // 1 hour

// ── Manual cache refresh ────────────────────────────────────────────────────
// Force a fresh feed pool for the calling company. Cache keys are now
// company-scoped (companyId:strength:sub:country:signalSig) so we delete
// every entry whose key starts with this company's id rather than
// guessing the exact key.
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

    const prefix = `${company.id}:`
    let cleared = 0
    for (const key of feedCache.keys()) {
      if (key.startsWith(prefix)) {
        feedCache.delete(key)
        cleared++
      }
    }
    invalidateFeedContentProfile(company.id)

    res.json({ success: true, cleared })
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

// ── Behavioral signals ──────────────────────────────────────────────────────
// Captures user actions on Knowledge tiles (reveal, open, dismiss,
// not_interested) so the next /api/feed call can boost / dampen accordingly.
// See feedSignal.service.ts + the Plan: "Closer to the user's content" Slice 1.
import {
  recordSignal,
  isSignalKind,
  isSignalTargetType,
} from '../services/feedSignal.service'

router.post('/signal', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const body = (req.body ?? {}) as {
      kind?: string
      targetType?: string
      targetId?: string
      weight?: number
    }
    if (!body.kind || !isSignalKind(body.kind)) {
      res.status(400).json({ error: 'invalid_kind' })
      return
    }
    if (!body.targetType || !isSignalTargetType(body.targetType)) {
      res.status(400).json({ error: 'invalid_target_type' })
      return
    }
    if (!body.targetId || typeof body.targetId !== 'string' || body.targetId.length < 1) {
      res.status(400).json({ error: 'invalid_target_id' })
      return
    }

    const company = await prisma.company.findFirst({
      where: { userId },
      select: { id: true },
    })
    if (!company) {
      res.status(404).json({ error: 'company_not_found' })
      return
    }

    await recordSignal(prisma, {
      userId,
      companyId: company.id,
      kind: body.kind,
      targetType: body.targetType,
      targetId: body.targetId,
      weight: typeof body.weight === 'number' ? body.weight : 1,
    })

    // Bust the profile cache so the next feed call rebuilds with the new
    // affinity / dampening state.
    invalidateFeedContentProfile(company.id)

    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
