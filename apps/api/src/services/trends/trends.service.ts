import axios from 'axios'

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const NEWS_API_KEY = process.env.NEWS_API_KEY || ''
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || ''

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface RawTrend {
  topic: string
  source: string
  growthSignal: 'rising' | 'viral' | 'emerging'
  description?: string
  url?: string
  publishedAt?: string
}

export interface TrendContext {
  niche: string
  trends: RawTrend[]
  fetchedAt: Date
}

// ─── NICHE KEYWORD MAP ────────────────────────────────────────────────────────

const NICHE_KEYWORDS: Record<string, string[]> = {
  fitness: ['workout', 'fitness', 'gym', 'strength training', 'weight loss', 'nutrition', 'protein'],
  finance: ['investing', 'personal finance', 'crypto', 'stocks', 'budgeting', 'passive income'],
  food: ['recipe', 'cooking', 'meal prep', 'food trend', 'restaurant', 'diet'],
  coaching: ['life coach', 'mindset', 'productivity', 'goal setting', 'personal development'],
  lifestyle: ['lifestyle', 'wellness', 'self care', 'morning routine', 'travel'],
  personal_development: ['self improvement', 'habits', 'mindset', 'motivation', 'mental health'],
}

// ─── MAIN AGGREGATOR ──────────────────────────────────────────────────────────

/**
 * Aggregates trend data from multiple sources for a given niche.
 * Returns raw trend signals that Maya then analyzes and formats.
 */
export async function aggregateTrends(niche: string, subNiche?: string): Promise<TrendContext> {
  const keywords = NICHE_KEYWORDS[niche.toLowerCase()] || [niche]
  if (subNiche) keywords.unshift(subNiche)

  const [newsArticles, instagramTrends] = await Promise.allSettled([
    fetchNewsAPITrends(keywords),
    fetchInstagramTrends(keywords),
  ])

  const trends: RawTrend[] = []

  if (newsArticles.status === 'fulfilled') {
    trends.push(...newsArticles.value)
  }

  if (instagramTrends.status === 'fulfilled') {
    trends.push(...instagramTrends.value)
  }

  return {
    niche,
    trends,
    fetchedAt: new Date(),
  }
}

// ─── NEWS API ─────────────────────────────────────────────────────────────────

async function fetchNewsAPITrends(keywords: string[]): Promise<RawTrend[]> {
  if (!NEWS_API_KEY) return []

  const query = keywords.slice(0, 3).join(' OR ')

  const response = await axios.get('https://newsapi.org/v2/everything', {
    params: {
      q: query,
      sortBy: 'publishedAt',
      pageSize: 10,
      language: 'en',
      from: getDateDaysAgo(7),
    },
    headers: { 'X-Api-Key': NEWS_API_KEY },
    timeout: 5000,
  })

  return (response.data.articles || []).map((article: {
    title: string
    description?: string
    url: string
    publishedAt: string
  }) => ({
    topic: article.title,
    source: 'news',
    growthSignal: 'emerging' as const,
    description: article.description,
    url: article.url,
    publishedAt: article.publishedAt,
  }))
}

// ─── RAPIDAPI (Instagram trends) ─────────────────────────────────────────────

async function fetchInstagramTrends(keywords: string[]): Promise<RawTrend[]> {
  if (!RAPIDAPI_KEY) return []

  const results: RawTrend[] = []

  // Fetch trending hashtags for the top 2 keywords
  for (const keyword of keywords.slice(0, 2)) {
    try {
      const response = await axios.get('https://instagram-scraper-api2.p.rapidapi.com/v1/hashtag', {
        params: { hashtag: keyword.replace(/\s+/g, '').toLowerCase() },
        headers: {
          'X-RapidAPI-Key': RAPIDAPI_KEY,
          'X-RapidAPI-Host': 'instagram-scraper-api2.p.rapidapi.com',
        },
        timeout: 5000,
      })

      const hashtagData = response.data?.data
      if (hashtagData) {
        results.push({
          topic: `#${keyword.replace(/\s+/g, '')}`,
          source: 'instagram_hashtag',
          growthSignal: 'viral',
          description: `Media count: ${hashtagData.media_count || 'unknown'}`,
        })
      }
    } catch {
      // Skip failed hashtag fetches silently
    }
  }

  return results
}

// ─── FORMAT FOR MAYA ──────────────────────────────────────────────────────────

/**
 * Formats raw trend data into a prompt string for Maya to analyze.
 */
export function formatTrendsForMaya(trendContext: TrendContext): string {
  if (!trendContext.trends.length) {
    return `No external trend data available for ${trendContext.niche}. Use your niche knowledge to identify current opportunities.`
  }

  const formatted = trendContext.trends
    .slice(0, 15)
    .map(t => `- [${t.source}] ${t.topic}${t.description ? ': ' + t.description : ''} (signal: ${t.growthSignal})`)
    .join('\n')

  return `Current trend signals for ${trendContext.niche} (as of ${trendContext.fetchedAt.toDateString()}):\n${formatted}`
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function getDateDaysAgo(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().split('T')[0]
}
