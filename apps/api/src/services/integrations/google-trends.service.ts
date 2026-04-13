/**
 * Google Trends Integration
 *
 * Google doesn't offer an official API, but the `google-trends-api` npm package
 * wraps the public endpoint used by trends.google.com.
 *
 * Cost: FREE — no API key required.
 * Limit: Unofficial, so use with care. Cache results and don't hammer it.
 * Install: npm install google-trends-api
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const googleTrends = require('google-trends-api')

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface TrendingTopic {
  keyword: string
  relatedQueries: string[]
  interestOverTime: Array<{ date: string; value: number }>
  isRising: boolean
  risingPercent?: number
}

export interface NicheTrendData {
  niche: string
  keywords: TrendingTopic[]
  realTimeTopics: string[]
  fetchedAt: Date
}

// ─── NICHE KEYWORD SEEDS ──────────────────────────────────────────────────────

const NICHE_SEED_KEYWORDS: Record<string, string[]> = {
  fitness:            ['workout', 'fitness', 'weight loss', 'muscle gain', 'nutrition'],
  finance:            ['investing', 'personal finance', 'passive income', 'crypto', 'budgeting'],
  food:               ['recipe', 'meal prep', 'cooking', 'healthy eating', 'food trends'],
  coaching:           ['life coaching', 'productivity', 'mindset', 'self improvement', 'goal setting'],
  lifestyle:          ['wellness', 'self care', 'morning routine', 'minimalism', 'work life balance'],
  personal_development: ['habits', 'mindset', 'motivation', 'self discipline', 'mental health'],
}

// ─── INTEREST OVER TIME ───────────────────────────────────────────────────────

/**
 * Get 90-day interest trend for a keyword.
 * Returns normalized values 0-100. Rising trend = content opportunity.
 */
export async function getKeywordTrend(keyword: string): Promise<TrendingTopic | null> {
  try {
    const results = await googleTrends.interestOverTime({
      keyword,
      startTime: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // 90 days ago
      granularTimeResolution: true,
    })

    const parsed = JSON.parse(results)
    const timelineData = parsed?.default?.timelineData || []

    const interestOverTime = timelineData.map((point: { formattedTime: string; value: number[] }) => ({
      date: point.formattedTime,
      value: point.value[0] || 0,
    }))

    // Calculate if trend is rising by comparing last 2 weeks vs previous 2 weeks
    const recent = interestOverTime.slice(-14).map((p: { value: number }) => p.value)
    const prior = interestOverTime.slice(-28, -14).map((p: { value: number }) => p.value)
    const recentAvg = avg(recent)
    const priorAvg = avg(prior)
    const risingPercent = priorAvg > 0 ? Math.round(((recentAvg - priorAvg) / priorAvg) * 100) : 0

    return {
      keyword,
      relatedQueries: [],
      interestOverTime,
      isRising: risingPercent > 10,
      risingPercent,
    }
  } catch (err) {
    console.warn(`Google Trends failed for "${keyword}":`, err)
    return null
  }
}

// ─── RELATED QUERIES ──────────────────────────────────────────────────────────

/**
 * Get related/rising search queries for a keyword.
 * These are pure content gold — real searches happening right now.
 */
export async function getRelatedQueries(keyword: string): Promise<{
  top: string[]
  rising: string[]
}> {
  try {
    const results = await googleTrends.relatedQueries({ keyword })
    const parsed = JSON.parse(results)
    const data = parsed?.default?.rankedList || []

    const topList = data[0]?.rankedKeyword || []
    const risingList = data[1]?.rankedKeyword || []

    return {
      top: topList.slice(0, 8).map((k: { query: string }) => k.query),
      rising: risingList.slice(0, 8).map((k: { query: string }) => k.query),
    }
  } catch {
    return { top: [], rising: [] }
  }
}

// ─── REAL-TIME TRENDING ───────────────────────────────────────────────────────

/**
 * Get real-time trending searches (US market).
 * These are general trends — Maya filters for niche relevance.
 */
export async function getRealTimeTrending(): Promise<string[]> {
  try {
    const results = await googleTrends.realTimeTrends({
      geo: 'US',
      category: 'all',
    })

    const parsed = JSON.parse(results)
    const stories = parsed?.storySummaries?.trendingStories || []

    return stories
      .slice(0, 20)
      .flatMap((s: { entityNames?: string[] }) => s.entityNames || [])
      .filter(Boolean)
  } catch {
    return []
  }
}

// ─── NICHE TREND SCAN ────────────────────────────────────────────────────────

/**
 * Main function: scan Google Trends for an entire niche.
 * Fetches trend data for the top seed keywords + their related rising queries.
 */
export async function scanNicheTrends(
  niche: string,
  subNiche?: string
): Promise<NicheTrendData> {
  const seeds = NICHE_SEED_KEYWORDS[niche.toLowerCase()] || [niche]
  if (subNiche) seeds.unshift(subNiche)

  const topSeeds = seeds.slice(0, 4) // limit API calls
  const trendPromises = topSeeds.map(async (keyword, i) => {
    await sleep(i * 1200) // stagger requests to avoid rate limiting
    const trend = await getKeywordTrend(keyword)
    if (!trend) return null

    const related = await getRelatedQueries(keyword)
    await sleep(800)

    return { ...trend, relatedQueries: [...related.top, ...related.rising] }
  })

  const results = await Promise.all(trendPromises)
  const validTrends = results.filter(Boolean) as TrendingTopic[]

  // Sort by rising percent — highest opportunity first
  const sorted = validTrends.sort((a, b) => (b.risingPercent || 0) - (a.risingPercent || 0))

  let realTimeTopics: string[] = []
  try {
    realTimeTopics = await getRealTimeTrending()
  } catch { /* non-critical */ }

  return {
    niche,
    keywords: sorted,
    realTimeTopics,
    fetchedAt: new Date(),
  }
}

// ─── FORMAT FOR MAYA ──────────────────────────────────────────────────────────

export function formatGoogleTrendsForMaya(data: NicheTrendData): string {
  if (!data.keywords.length) return ''

  const keywordLines = data.keywords.map(k => {
    const trend = k.isRising
      ? `📈 RISING ${k.risingPercent && k.risingPercent > 0 ? `+${k.risingPercent}%` : ''}`
      : `→ stable`
    const related = k.relatedQueries.slice(0, 5).join(', ')
    return `  "${k.keyword}" — ${trend}\n    Related searches: ${related}`
  }).join('\n\n')

  return `Google Trends data for ${data.niche} (${data.fetchedAt.toDateString()}):\n\n${keywordLines}`
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function avg(nums: number[]): number {
  if (!nums.length) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
