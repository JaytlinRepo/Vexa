import axios from 'axios'

/**
 * Pexels + Pixabay Integration — for Riley (Creative Director)
 *
 * Pexels:  Free API, 200 req/hour. Sign up: https://www.pexels.com/api/
 * Pixabay: Free API, 100 req/min.  Sign up: https://pixabay.com/api/docs/
 *
 * Both give access to royalty-free photos and videos.
 * Riley uses these to suggest B-roll footage and thumbnail concepts.
 * Cost: FREE
 */

const PEXELS_API_KEY = process.env.PEXELS_API_KEY || ''
const PIXABAY_API_KEY = process.env.PIXABAY_API_KEY || ''

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface StockVideo {
  id: string
  url: string
  previewUrl: string
  thumbnailUrl: string
  duration: number
  width: number
  height: number
  source: 'pexels' | 'pixabay'
  tags?: string[]
}

export interface StockPhoto {
  id: string
  url: string
  thumbnailUrl: string
  photographer?: string
  source: 'pexels' | 'pixabay'
  tags?: string[]
}

export interface BRollSuggestion {
  shotDescription: string
  searchQuery: string
  videos: StockVideo[]
  photos: StockPhoto[]
}

// ─── SHOT DESCRIPTION → SEARCH QUERY MAP ─────────────────────────────────────

/**
 * Riley describes shots in creative terms.
 * This maps those descriptions to effective stock search queries.
 */
export function shotDescriptionToQuery(shotDescription: string): string {
  const desc = shotDescription.toLowerCase()

  const mappings: Array<[RegExp, string]> = [
    [/gym|weight|dumbbell|barbell|lifting/,    'gym workout weightlifting'],
    [/running|jogging|cardio|outdoor/,          'person running outdoor fitness'],
    [/cooking|kitchen|food prep|chopping/,      'cooking kitchen food preparation'],
    [/desk|work|laptop|office|studying/,        'person working laptop desk'],
    [/nature|outdoor|sunrise|sunset/,           'nature outdoor sunrise lifestyle'],
    [/city|urban|street|commute/,               'city urban lifestyle street'],
    [/coffee|morning|breakfast|routine/,        'morning coffee routine lifestyle'],
    [/meditation|yoga|calm|breathing/,          'meditation yoga calm mindfulness'],
    [/money|finance|investing|chart/,           'business finance money charts'],
    [/walking|strolling|park|movement/,         'person walking park lifestyle'],
    [/phone|social media|content|filming/,      'person phone social media filming'],
    [/food|meal|plate|eating|restaurant/,       'food meal healthy eating restaurant'],
  ]

  for (const [pattern, query] of mappings) {
    if (pattern.test(desc)) return query
  }

  // Fallback: use the first 3 words of the description
  return desc.split(' ').slice(0, 3).join(' ')
}

// ─── PEXELS VIDEOS ────────────────────────────────────────────────────────────

export async function searchPexelsVideos(
  query: string,
  perPage = 6
): Promise<StockVideo[]> {
  if (!PEXELS_API_KEY) return []

  try {
    const response = await axios.get('https://api.pexels.com/videos/search', {
      params: { query, per_page: perPage, orientation: 'portrait' }, // portrait = Reels format
      headers: { Authorization: PEXELS_API_KEY },
      timeout: 6000,
    })

    const videos = response.data?.videos || []

    return videos.map((v: {
      id: number
      url: string
      duration: number
      width: number
      height: number
      video_files?: Array<{ quality?: string; link?: string }>
      video_pictures?: Array<{ picture?: string }>
    }) => ({
      id: String(v.id),
      url: v.video_files?.find((f) => f.quality === 'hd')?.link || v.url,
      previewUrl: v.video_files?.[0]?.link || '',
      thumbnailUrl: v.video_pictures?.[0]?.picture || '',
      duration: v.duration,
      width: v.width,
      height: v.height,
      source: 'pexels' as const,
    }))
  } catch {
    return []
  }
}

// ─── PEXELS PHOTOS ────────────────────────────────────────────────────────────

export async function searchPexelsPhotos(
  query: string,
  perPage = 6
): Promise<StockPhoto[]> {
  if (!PEXELS_API_KEY) return []

  try {
    const response = await axios.get('https://api.pexels.com/v1/search', {
      params: { query, per_page: perPage, orientation: 'portrait' },
      headers: { Authorization: PEXELS_API_KEY },
      timeout: 6000,
    })

    const photos = response.data?.photos || []

    return photos.map((p: {
      id: number
      url: string
      photographer?: string
      src?: { medium?: string; portrait?: string }
    }) => ({
      id: String(p.id),
      url: p.src?.portrait || p.url,
      thumbnailUrl: p.src?.medium || '',
      photographer: p.photographer,
      source: 'pexels' as const,
    }))
  } catch {
    return []
  }
}

// ─── PIXABAY VIDEOS ───────────────────────────────────────────────────────────

export async function searchPixabayVideos(
  query: string,
  perPage = 6
): Promise<StockVideo[]> {
  if (!PIXABAY_API_KEY) return []

  try {
    const response = await axios.get('https://pixabay.com/api/videos/', {
      params: {
        key: PIXABAY_API_KEY,
        q: query,
        per_page: perPage,
        video_type: 'film',
      },
      timeout: 6000,
    })

    const hits = response.data?.hits || []

    return hits.map((v: {
      id: number
      pageURL: string
      duration: number
      videos?: { medium?: { url?: string; thumbnail?: string }; tiny?: { url?: string } }
      tags?: string
    }) => ({
      id: String(v.id),
      url: v.videos?.medium?.url || v.pageURL,
      previewUrl: v.videos?.tiny?.url || '',
      thumbnailUrl: v.videos?.medium?.thumbnail || '',
      duration: v.duration,
      width: 0,
      height: 0,
      source: 'pixabay' as const,
      tags: v.tags?.split(', ') || [],
    }))
  } catch {
    return []
  }
}

// ─── MAIN: GET B-ROLL FOR SHOT LIST ──────────────────────────────────────────

/**
 * Main function Riley calls after building a shot list.
 * Takes each shot description and finds matching B-roll footage.
 */
export async function getBRollForShots(
  shots: Array<{ number: number; description: string; type: string }>
): Promise<BRollSuggestion[]> {
  const suggestions: BRollSuggestion[] = []

  // Only fetch B-roll for shots that would benefit from stock footage
  const bRollShots = shots.filter(s =>
    s.type.toLowerCase().includes('b-roll') ||
    s.type.toLowerCase().includes('wide') ||
    s.type.toLowerCase().includes('cutaway')
  )

  for (const shot of bRollShots.slice(0, 4)) { // cap at 4 to preserve API quota
    const query = shotDescriptionToQuery(shot.description)

    const [videos, photos] = await Promise.all([
      searchPexelsVideos(query, 4),
      searchPixabayVideos(query, 3),
    ])

    suggestions.push({
      shotDescription: shot.description,
      searchQuery: query,
      videos: [...videos].slice(0, 5),
      photos,
    })

    await sleep(500) // rate limit courtesy
  }

  return suggestions
}

// ─── FORMAT FOR RILEY ─────────────────────────────────────────────────────────

export function formatBRollForRiley(suggestions: BRollSuggestion[]): string {
  if (!suggestions.length) return ''

  return suggestions.map(s => {
    const videoLinks = s.videos.slice(0, 3).map(v => `    - ${v.url} (${v.duration}s)`).join('\n')
    return `Shot: "${s.shotDescription}"\nSuggested B-roll (search: "${s.searchQuery}"):\n${videoLinks || '    - No results found — film original'}`
  }).join('\n\n')
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
