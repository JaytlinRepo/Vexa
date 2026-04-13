/**
 * Integration Orchestrator
 *
 * This is the single entry point that wires all external tools
 * to the right employee at the right time.
 *
 * Maya gets: Reddit + Google Trends + NewsAPI + RSS + YouTube
 * Alex gets:  Reddit comments (for hook language) + readability scoring
 * Riley gets: Pexels + Pixabay B-roll + YouTube format analysis
 * Jordan gets: Maya's processed output (no direct integrations needed)
 */

import { getNicheRedditInsights, formatRedditForMaya } from './reddit.service'
import { scanNicheTrends, formatGoogleTrendsForMaya } from './google-trends.service'
import { searchNicheArticles, getNicheHeadlines, formatNewsForMaya } from './newsapi.service'
import { searchNicheVideos, analyzeYouTubeData, formatYouTubeForMaya, formatYouTubeForRiley } from './youtube.service'
import { fetchNicheRSSFeeds, formatRSSForMaya } from './rss.service'
import { getBRollForShots, formatBRollForRiley } from './stock-media.service'
import { buildRenderRequestFromOutputs, renderReel, getRenderStatus } from './creatomate.service'

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface MayaToolContext {
  redditInsights: string
  googleTrends: string
  newsArticles: string
  rssFeeds: string
  youtubeTrends: string
  fetchedAt: Date
}

export interface RileyToolContext {
  bRollSuggestions: string
  videoFormats: string
}

// ─── MAYA'S TOOL SUITE ────────────────────────────────────────────────────────

/**
 * Gather all external intelligence for Maya before she generates a trend report.
 * This runs in parallel where possible to keep latency low.
 * All sources are free or nearly free.
 */
export async function gatherMayaContext(
  niche: string,
  subNiche?: string
): Promise<MayaToolContext> {
  console.log(`[Integrations] Gathering Maya context for niche: ${niche}`)

  // Run all sources in parallel
  const [
    redditResults,
    trendResults,
    newsResults,
    rssResults,
    youtubeResults,
  ] = await Promise.allSettled([
    getNicheRedditInsights(niche, subNiche),
    scanNicheTrends(niche, subNiche),
    Promise.all([
      searchNicheArticles(niche, subNiche, 10),
      getNicheHeadlines(niche),
    ]),
    fetchNicheRSSFeeds(niche, 4, 5),
    searchNicheVideos(niche, subNiche, 12),
  ])

  // Format each source for Maya's prompt
  const redditInsights = redditResults.status === 'fulfilled'
    ? formatRedditForMaya(redditResults.value, niche)
    : '(Reddit data unavailable)'

  const googleTrends = trendResults.status === 'fulfilled'
    ? formatGoogleTrendsForMaya(trendResults.value)
    : '(Google Trends data unavailable)'

  let newsArticles = '(News data unavailable)'
  if (newsResults.status === 'fulfilled') {
    const [everything, headlines] = newsResults.value
    newsArticles = formatNewsForMaya([...everything, ...headlines], niche)
  }

  const rssFeeds = rssResults.status === 'fulfilled'
    ? formatRSSForMaya(rssResults.value, niche)
    : '(RSS feed data unavailable)'

  let youtubeTrends = '(YouTube data unavailable)'
  if (youtubeResults.status === 'fulfilled') {
    const analyzed = analyzeYouTubeData(youtubeResults.value)
    analyzed.niche = niche
    youtubeTrends = formatYouTubeForMaya(analyzed, niche)
  }

  return {
    redditInsights,
    googleTrends,
    newsArticles,
    rssFeeds,
    youtubeTrends,
    fetchedAt: new Date(),
  }
}

/**
 * Assembles Maya's full context into a single prompt section.
 * This gets injected into Maya's system prompt before she generates.
 */
export function buildMayaContextPrompt(context: MayaToolContext): string {
  return `
## Real-Time Intelligence (gathered ${context.fetchedAt.toDateString()})

Use this data to ground your trend report in what's actually happening right now.
Prioritize signals that appear across multiple sources.

### Reddit Intelligence
${context.redditInsights}

### Google Trends
${context.googleTrends}

### Recent News & Articles
${context.newsArticles}

### RSS Feed — Industry Publications
${context.rssFeeds}

### YouTube Trending
${context.youtubeTrends}

---
Analyze the above data and identify the 3-5 strongest content opportunities for this creator.
Focus on what's RISING, not what's already peaked. Cross-reference signals — if something appears in both Reddit and Google Trends, that's a strong signal.
`.trim()
}

// ─── RILEY'S TOOL SUITE ───────────────────────────────────────────────────────

/**
 * Gather B-roll suggestions and format insights for Riley
 * after she receives an approved script.
 */
export async function gatherRileyContext(
  shots: Array<{ number: number; description: string; type: string }>,
  niche: string
): Promise<RileyToolContext> {
  console.log(`[Integrations] Gathering Riley context — ${shots.length} shots`)

  const [bRollResults, youtubeResults] = await Promise.allSettled([
    getBRollForShots(shots),
    searchNicheVideos(niche, undefined, 10),
  ])

  const bRollSuggestions = bRollResults.status === 'fulfilled'
    ? formatBRollForRiley(bRollResults.value)
    : '(B-roll suggestions unavailable — film original footage)'

  let videoFormats = ''
  if (youtubeResults.status === 'fulfilled') {
    const analyzed = analyzeYouTubeData(youtubeResults.value)
    videoFormats = formatYouTubeForRiley(analyzed)
  }

  return { bRollSuggestions, videoFormats }
}

export function buildRileyContextPrompt(context: RileyToolContext): string {
  return `
## Production Resources

### B-Roll Footage Suggestions
${context.bRollSuggestions || 'Film original footage for all shots.'}

### Currently Performing Video Formats
${context.videoFormats || 'Short-form direct-to-camera with B-roll cutaways.'}
`.trim()
}

// ─── ALEX'S TOOL SUITE ────────────────────────────────────────────────────────

/**
 * Get authentic audience language from Reddit comments.
 * Alex uses this to write hooks that sound like real people, not AI.
 */
export async function gatherAlexContext(
  niche: string,
  topic: string
): Promise<string> {
  try {
    const insights = await getNicheRedditInsights(niche)

    // Find the most relevant post to the current topic
    const allPosts = insights.flatMap(i => i.topPosts)
    const relevant = allPosts
      .filter(p => p.title.toLowerCase().includes(topic.toLowerCase().split(' ')[0]))
      .slice(0, 2)

    const comments = insights.flatMap(i => i.topComments).slice(0, 8)

    if (!comments.length && !relevant.length) return ''

    const postTitles = relevant.map(p => `  - "${p.title}" (${p.score} upvotes)`).join('\n')
    const commentVoices = comments.map(c => `  - "${c.body.slice(0, 200)}"`).join('\n')

    return `
## Authentic Audience Language (from Reddit)
Use these to write hooks that sound like real people in this niche — not AI.

High-performing post titles in this space:
${postTitles || '  (none found for this specific topic)'}

Real comments from your target audience:
${commentVoices}

Study the language, emotions, and specific words these people use. Mirror that in your hooks.
`.trim()
  } catch {
    return ''
  }
}

// ─── VIDEO PIPELINE ───────────────────────────────────────────────────────────

/**
 * Full video generation pipeline:
 * Takes Riley + Alex outputs → renders a Reel via Creatomate
 */
export async function generateReel(
  rileyOutput: {
    shots: Array<{ timestamp?: string; textOverlay?: string }>
    musicMood: string
    textOverlayGuide: string
  },
  alexOutput: {
    hookLine: string
    sections: Array<{ timestamp: string; speakingText?: string; textOverlay?: string }>
    cta: string
  },
  backgroundVideoUrl?: string
): Promise<{ jobId: string; status: string }> {
  const renderRequest = buildRenderRequestFromOutputs(rileyOutput, alexOutput, backgroundVideoUrl)
  const job = await renderReel(renderRequest)

  return { jobId: job.id, status: job.status }
}

export async function checkReelStatus(jobId: string) {
  return getRenderStatus(jobId)
}

// ─── COST SUMMARY ────────────────────────────────────────────────────────────

/**
 * Monthly cost estimate at launch scale (100-500 users):
 *
 * Reddit API:        $0     (public JSON, no key needed)
 * Google Trends:     $0     (pytrends wrapper, unofficial but free)
 * NewsAPI:           $0     (free tier: 100 req/day — enough for launch)
 * RSS Feeds:         $0     (open standard, no cost)
 * YouTube Data API:  $0     (10,000 units/day free — ~100 searches)
 * Pexels API:        $0     (200 req/hour free)
 * Pixabay API:       $0     (100 req/min free)
 * Creatomate:        $29/mo (1,000 renders — upgrade as you scale)
 *
 * TOTAL TO START:    ~$29/mo
 *
 * When to upgrade:
 * - NewsAPI paid ($449/mo) when you need real-time news (not day-old)
 * - Creatomate higher tier when renders exceed 1,000/mo
 * - YouTube paid quota when searches exceed 100/day
 */
export const INTEGRATION_COST_SUMMARY = {
  reddit:       { cost: 0, limit: 'No official limit on public JSON' },
  googleTrends: { cost: 0, limit: 'Unofficial — cache results, max 1 req/sec' },
  newsAPI:      { cost: 0, limit: '100 req/day on free tier' },
  rss:          { cost: 0, limit: 'None — just be polite' },
  youtube:      { cost: 0, limit: '10,000 units/day (100 searches)' },
  pexels:       { cost: 0, limit: '200 req/hour' },
  pixabay:      { cost: 0, limit: '100 req/min' },
  creatomate:   { cost: 29, limit: '1,000 renders/mo on starter plan' },
  totalMonthly: 29,
}
