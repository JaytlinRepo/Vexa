import axios from 'axios'

/**
 * NewsAPI Integration
 *
 * Free tier: 100 requests/day, headlines only, delayed 24hrs on free plan
 * Paid ($449/mo) for real-time. Free tier is fine for daily trend scanning.
 * Sign up: https://newsapi.org
 * Cost: FREE to start
 */

const NEWS_API_KEY = process.env.NEWS_API_KEY || ''
const BASE_URL = 'https://newsapi.org/v2'

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface NewsArticle {
  title: string
  description: string
  url: string
  source: string
  author?: string
  publishedAt: string
  relevanceScore?: number
}

// ─── NICHE QUERY MAP ──────────────────────────────────────────────────────────

const NICHE_QUERIES: Record<string, string> = {
  fitness:            'fitness OR workout OR nutrition OR "weight loss" OR "strength training"',
  finance:            'investing OR "personal finance" OR "stock market" OR "passive income" OR budgeting',
  food:               'recipe OR "food trend" OR cooking OR "meal prep" OR restaurant',
  coaching:           'coaching OR productivity OR mindset OR "self improvement" OR leadership',
  lifestyle:          'wellness OR "self care" OR lifestyle OR "mental health" OR minimalism',
  personal_development: '"self improvement" OR habits OR motivation OR "mental health" OR "personal growth"',
}

// ─── FETCH EVERYTHING (keyword search) ───────────────────────────────────────

/**
 * Search all articles for a niche query.
 * Free tier gives last 30 days of articles.
 */
export async function searchNicheArticles(
  niche: string,
  subNiche?: string,
  pageSize = 15
): Promise<NewsArticle[]> {
  if (!NEWS_API_KEY) {
    console.warn('NEWS_API_KEY not set — skipping NewsAPI')
    return []
  }

  let query = NICHE_QUERIES[niche.toLowerCase()] || niche
  if (subNiche) query = `"${subNiche}" OR (${query})`

  try {
    const response = await axios.get(`${BASE_URL}/everything`, {
      params: {
        q: query,
        language: 'en',
        sortBy: 'publishedAt',
        pageSize,
        from: getDateDaysAgo(7),
      },
      headers: { 'X-Api-Key': NEWS_API_KEY },
      timeout: 8000,
    })

    const articles = response.data?.articles || []

    return articles
      .filter((a: { title?: string; description?: string }) => a.title && a.description && !a.title.includes('[Removed]'))
      .map((a: {
        title: string
        description?: string
        url: string
        source?: { name?: string }
        author?: string
        publishedAt?: string
      }) => ({
        title: a.title,
        description: a.description || '',
        url: a.url,
        source: a.source?.name || 'Unknown',
        author: a.author || undefined,
        publishedAt: a.publishedAt || new Date().toISOString(),
      }))
  } catch (err) {
    console.warn('NewsAPI search failed:', err)
    return []
  }
}

// ─── FETCH TOP HEADLINES ──────────────────────────────────────────────────────

/**
 * Get top headlines by category.
 * Maps niche to NewsAPI's built-in categories.
 * Free tier supports this endpoint with full real-time access.
 */
export async function getNicheHeadlines(niche: string): Promise<NewsArticle[]> {
  if (!NEWS_API_KEY) return []

  const categoryMap: Record<string, string> = {
    fitness:            'health',
    finance:            'business',
    food:               'general',
    coaching:           'business',
    lifestyle:          'health',
    personal_development: 'general',
  }

  const category = categoryMap[niche.toLowerCase()] || 'general'

  try {
    const response = await axios.get(`${BASE_URL}/top-headlines`, {
      params: {
        category,
        language: 'en',
        country: 'us',
        pageSize: 10,
      },
      headers: { 'X-Api-Key': NEWS_API_KEY },
      timeout: 8000,
    })

    const articles = response.data?.articles || []

    return articles
      .filter((a: { title?: string }) => a.title && !a.title.includes('[Removed]'))
      .map((a: {
        title: string
        description?: string
        url: string
        source?: { name?: string }
        author?: string
        publishedAt?: string
      }) => ({
        title: a.title,
        description: a.description || '',
        url: a.url,
        source: a.source?.name || 'Unknown',
        author: a.author || undefined,
        publishedAt: a.publishedAt || new Date().toISOString(),
      }))
  } catch (err) {
    console.warn('NewsAPI headlines failed:', err)
    return []
  }
}

// ─── FORMAT FOR MAYA ──────────────────────────────────────────────────────────

export function formatNewsForMaya(articles: NewsArticle[], niche: string): string {
  if (!articles.length) return ''

  const lines = articles
    .slice(0, 12)
    .map(a => `  - [${a.source}] "${a.title}" — ${a.description?.slice(0, 120) || ''}`)
    .join('\n')

  return `Recent news articles for ${niche} (last 7 days):\n${lines}`
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function getDateDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().split('T')[0]
}
