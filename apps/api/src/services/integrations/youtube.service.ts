import axios from 'axios'

/**
 * YouTube Data API v3 Integration
 *
 * Free tier: 10,000 units/day
 * A search costs 100 units. So ~100 searches/day free.
 * More than enough for daily niche scanning.
 * Sign up: https://console.developers.google.com
 * Cost: FREE to start
 */

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || ''
const BASE_URL = 'https://www.googleapis.com/youtube/v3'

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface YouTubeVideo {
  id: string
  title: string
  description: string
  channelTitle: string
  publishedAt: string
  viewCount?: number
  likeCount?: number
  commentCount?: number
  thumbnailUrl?: string
  url: string
  duration?: string
  tags?: string[]
}

export interface YouTubeTrendingData {
  niche: string
  trendingVideos: YouTubeVideo[]
  popularFormats: string[]
  topChannels: string[]
  commonHookPatterns: string[]
}

// ─── NICHE CATEGORY MAP ───────────────────────────────────────────────────────

// YouTube category IDs for trending
const NICHE_CATEGORY_IDS: Record<string, string> = {
  fitness:            '17', // Sports
  finance:            '25', // News & Politics
  food:               '26', // Howto & Style
  coaching:           '27', // Education
  lifestyle:          '22', // People & Blogs
  personal_development: '27', // Education
}

// Search keywords per niche for findable trending content
const NICHE_SEARCH_TERMS: Record<string, string> = {
  fitness:            'fitness workout 2024',
  finance:            'personal finance investing 2024',
  food:               'recipe cooking viral',
  coaching:           'productivity mindset self improvement',
  lifestyle:          'lifestyle wellness vlog',
  personal_development: 'self improvement habits 2024',
}

// ─── SEARCH TRENDING VIDEOS ───────────────────────────────────────────────────

/**
 * Search for recent high-performing videos in a niche.
 * Filters by upload date to get current trends.
 */
export async function searchNicheVideos(
  niche: string,
  subNiche?: string,
  maxResults = 15
): Promise<YouTubeVideo[]> {
  if (!YOUTUBE_API_KEY) {
    console.warn('YOUTUBE_API_KEY not set — skipping YouTube')
    return []
  }

  const query = subNiche
    ? `${subNiche} ${NICHE_SEARCH_TERMS[niche.toLowerCase()] || niche}`
    : NICHE_SEARCH_TERMS[niche.toLowerCase()] || niche

  try {
    // Step 1: Search for videos (costs 100 units)
    const searchResponse = await axios.get(`${BASE_URL}/search`, {
      params: {
        key: YOUTUBE_API_KEY,
        part: 'snippet',
        q: query,
        type: 'video',
        order: 'viewCount',
        publishedAfter: getDateDaysAgo(30),
        maxResults,
        relevanceLanguage: 'en',
        videoDuration: 'short', // Shorts/Reels-length content
      },
      timeout: 8000,
    })

    const items = searchResponse.data?.items || []
    const videoIds = items.map((i: { id: { videoId: string } }) => i.id.videoId).join(',')

    if (!videoIds) return []

    // Step 2: Get video stats (costs 1 unit per video)
    const statsResponse = await axios.get(`${BASE_URL}/videos`, {
      params: {
        key: YOUTUBE_API_KEY,
        part: 'statistics,contentDetails,snippet',
        id: videoIds,
      },
      timeout: 8000,
    })

    const statsItems = statsResponse.data?.items || []

    return statsItems.map((item: {
      id: string
      snippet: {
        title: string
        description?: string
        channelTitle?: string
        publishedAt?: string
        thumbnails?: { high?: { url?: string }; default?: { url?: string } }
        tags?: string[]
      }
      statistics?: {
        viewCount?: string
        likeCount?: string
        commentCount?: string
      }
      contentDetails?: { duration?: string }
    }) => ({
      id: item.id,
      title: item.snippet.title,
      description: (item.snippet.description || '').slice(0, 300),
      channelTitle: item.snippet.channelTitle || '',
      publishedAt: item.snippet.publishedAt || '',
      viewCount: parseInt(item.statistics?.viewCount || '0'),
      likeCount: parseInt(item.statistics?.likeCount || '0'),
      commentCount: parseInt(item.statistics?.commentCount || '0'),
      thumbnailUrl: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
      url: `https://youtube.com/watch?v=${item.id}`,
      duration: item.contentDetails?.duration,
      tags: item.snippet.tags?.slice(0, 10) || [],
    }))
  } catch (err) {
    console.warn('YouTube API search failed:', err)
    return []
  }
}

// ─── EXTRACT INSIGHTS ─────────────────────────────────────────────────────────

/**
 * Analyze YouTube data to extract content format patterns and hook structures.
 * Riley and Alex use these insights.
 */
export function analyzeYouTubeData(videos: YouTubeVideo[]): YouTubeTrendingData {
  const sorted = videos.sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))

  // Extract common title patterns (hook structures)
  const hookPatterns = extractHookPatterns(sorted.map(v => v.title))

  // Top channels
  const channelCounts: Record<string, number> = {}
  sorted.forEach(v => {
    channelCounts[v.channelTitle] = (channelCounts[v.channelTitle] || 0) + 1
  })
  const topChannels = Object.entries(channelCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([name]) => name)

  // Detect format types from tags and descriptions
  const popularFormats = detectFormats(sorted)

  return {
    niche: '',
    trendingVideos: sorted.slice(0, 10),
    popularFormats,
    topChannels,
    commonHookPatterns: hookPatterns,
  }
}

// ─── FORMAT FOR MAYA & RILEY ──────────────────────────────────────────────────

export function formatYouTubeForMaya(data: YouTubeTrendingData, niche: string): string {
  if (!data.trendingVideos.length) return ''

  const videoLines = data.trendingVideos
    .slice(0, 8)
    .map(v => {
      const views = v.viewCount ? `${(v.viewCount / 1000).toFixed(0)}K views` : ''
      return `  - "${v.title}" by ${v.channelTitle} (${views})`
    })
    .join('\n')

  return `YouTube trending in ${niche} (last 30 days):\n${videoLines}\n\nCommon hook patterns:\n${data.commonHookPatterns.slice(0, 5).map(h => `  - ${h}`).join('\n')}`
}

export function formatYouTubeForRiley(data: YouTubeTrendingData): string {
  if (!data.trendingVideos.length) return ''

  return `Popular video formats performing well right now:\n${data.popularFormats.map(f => `  - ${f}`).join('\n')}\n\nTop performing video titles (study their structure):\n${data.trendingVideos.slice(0, 5).map(v => `  - "${v.title}"`).join('\n')}`
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function extractHookPatterns(titles: string[]): string[] {
  const patterns: string[] = []

  // Number-led hooks
  const numbered = titles.filter(t => /^\d+/.test(t))
  if (numbered.length > 2) patterns.push('Number-led: "X things/ways/tips..."')

  // Question hooks
  const questions = titles.filter(t => t.includes('?'))
  if (questions.length > 2) patterns.push('Question hook: "Why does X happen?"')

  // I/My story hooks
  const story = titles.filter(t => /^I |^My /i.test(t))
  if (story.length > 2) patterns.push('Personal story: "I did X for Y days..."')

  // Controversial/hot take
  const controversial = titles.filter(t => /wrong|myth|truth|secret|nobody|stop/i.test(t))
  if (controversial.length > 1) patterns.push('Myth-busting: "Everyone is wrong about X"')

  // Before/After
  const transformation = titles.filter(t => /before|after|transform|week|day|month/i.test(t))
  if (transformation.length > 1) patterns.push('Transformation: "X days/weeks of doing Y"')

  return patterns
}

function detectFormats(videos: YouTubeVideo[]): string[] {
  const formats: string[] = []
  const descriptions = videos.map(v => v.description.toLowerCase())
  const titles = videos.map(v => v.title.toLowerCase())

  if ([...titles, ...descriptions].some(t => t.includes('tutorial') || t.includes('how to'))) {
    formats.push('Tutorial / How-to walkthrough')
  }
  if (titles.some(t => /day \d|week \d|\d+ days/i.test(t))) {
    formats.push('Day-in-the-life / Challenge format')
  }
  if (titles.some(t => /vs|versus|comparison/i.test(t))) {
    formats.push('Comparison / versus format')
  }
  if (titles.some(t => /react|reacting|watch/i.test(t))) {
    formats.push('Reaction / commentary format')
  }
  if (titles.some(t => /\d+ tips|\d+ ways|\d+ things/i.test(t))) {
    formats.push('List / tips format')
  }

  return formats.length ? formats : ['Short-form direct-to-camera', 'B-roll + voiceover']
}

function getDateDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString()
}
