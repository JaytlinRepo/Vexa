/**
 * Realistic Instagram data stub.
 *
 * Shapes match what the real Instagram Graph API returns, so the UI code that
 * reads this is 1:1 the same code that will read live data once OAuth is
 * wired. All numbers are deterministic from the handle (same handle → same
 * numbers across refreshes) so testers see stable data.
 */

export interface IgMedia {
  id: string
  caption: string
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM' | 'REEL'
  media_url: string | null
  permalink: string
  thumbnail_url: string | null
  timestamp: string
  like_count: number
  comments_count: number
  video_duration?: number // seconds, VIDEO/REEL only
  insights: {
    reach: number
    impressions: number
    saved: number
    shares: number
    engagement: number
    avgWatchTimeMs?: number
  }
}

export interface IgFollowerPoint {
  date: string        // YYYY-MM-DD
  followers: number
  reach: number
}

export interface IgAudienceBucket {
  bucket: string      // '18-24', '25-34', …  or country code
  share: number       // 0..1
}

export interface IgStoryItem {
  id: string
  media_type: 'IMAGE' | 'VIDEO'
  media_url: string | null
  timestamp: string
  insights: {
    impressions: number
    reach: number
    replies: number
    tapsForward: number
    tapsBack: number
    exits: number
  }
}

export interface IgStub {
  username: string
  igUserId: string
  accountType: 'BUSINESS' | 'CREATOR'
  bio: string
  profileUrl: string
  followerCount: number
  followingCount: number
  postCount: number
  engagementRate: number
  avgReach: number
  avgImpressions: number
  profileViews: number
  websiteClicks: number
  dailyProfileViews: Array<{ date: string; value: number }>
  dailyWebsiteClicks: Array<{ date: string; value: number }>
  topPosts: IgMedia[]
  recentMedia: IgMedia[]
  stories: IgStoryItem[]
  followerSeries: IgFollowerPoint[]
  audienceAge: IgAudienceBucket[]
  audienceGender: IgAudienceBucket[]
  audienceTopCountries: IgAudienceBucket[]
  audienceTopCities: IgAudienceBucket[]
}

// ── Deterministic PRNG from handle ──────────────────────────────────────────
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

const CAPTION_TEMPLATES = [
  'The one change that actually moved the needle this month. Save this.',
  '3 things I stopped doing and the result surprised me.',
  'Swipe for the side-by-side. No filter, no editing tricks.',
  'If you have 12 minutes and one dumbbell, I have a plan for you.',
  'Why I deleted half my morning routine — and what replaced it.',
  'The myth everyone in this niche repeats. Here is the research that breaks it.',
  'Client result I am actually proud of. Process in the comments.',
  'POV: you tried everything and nothing stuck. Read this.',
  'The thumb-stopping hook nobody is using yet.',
  'Unpopular opinion (with receipts).',
  'Behind the scenes of how I plan a week in 20 minutes.',
  'Three reels a week for six months did this. Numbers inside.',
]

const MEDIA_TYPES: IgMedia['media_type'][] = ['REEL', 'CAROUSEL_ALBUM', 'IMAGE', 'VIDEO']

export function buildStub(handle: string): IgStub {
  const cleanHandle = handle.replace(/^@/, '').toLowerCase()
  const seed = hashString(cleanHandle)
  const rand = mulberry32(seed)
  const pick = <T>(arr: T[]) => arr[Math.floor(rand() * arr.length)]!

  const followerCount = 2_000 + Math.floor(rand() * 95_000)
  const followingCount = 80 + Math.floor(rand() * 900)
  const postCount = 40 + Math.floor(rand() * 360)
  const engagementRate = Math.round((1.2 + rand() * 4.3) * 100) / 100 // 1.20 – 5.50%
  const avgReach = Math.floor(followerCount * (0.18 + rand() * 0.25)) // 18-43% of followers
  const avgImpressions = Math.floor(avgReach * (1.1 + rand() * 0.6))

  // ── Recent media (last 14 posts, newest first) ───────────────────────────
  const now = Date.now()
  const recentMedia: IgMedia[] = Array.from({ length: 14 }).map((_, i) => {
    const daysAgo = i * (1 + Math.floor(rand() * 2)) // irregular cadence
    const ts = new Date(now - daysAgo * 24 * 60 * 60 * 1000).toISOString()
    const mediaType = pick(MEDIA_TYPES)
    const reach = Math.floor(avgReach * (0.6 + rand() * 1.0))
    const likes = Math.floor(reach * (0.04 + rand() * 0.12))
    const comments = Math.floor(likes * (0.02 + rand() * 0.08))
    const saved = Math.floor(reach * (0.005 + rand() * 0.05))
    const shares = Math.floor(reach * (0.002 + rand() * 0.02))
    return {
      id: `${cleanHandle}_${i}_${seed}`,
      caption: pick(CAPTION_TEMPLATES),
      media_type: mediaType,
      media_url: null,
      permalink: `https://instagram.com/p/stub_${cleanHandle}_${i}`,
      thumbnail_url: null,
      timestamp: ts,
      like_count: likes,
      comments_count: comments,
      insights: {
        reach,
        impressions: Math.floor(reach * (1.1 + rand() * 0.4)),
        saved,
        shares,
        engagement: likes + comments + saved + shares,
      },
    }
  })

  const topPosts = [...recentMedia]
    .sort((a, b) => b.insights.engagement - a.insights.engagement)
    .slice(0, 3)

  // ── 30-day follower series ───────────────────────────────────────────────
  const followerSeries: IgFollowerPoint[] = []
  let running = followerCount - Math.floor(rand() * 2000) // 30 days ago
  for (let d = 29; d >= 0; d--) {
    const date = new Date(now - d * 24 * 60 * 60 * 1000)
    const delta = Math.floor((rand() - 0.35) * 120) // generally growing
    running = Math.max(0, running + delta)
    followerSeries.push({
      date: date.toISOString().slice(0, 10),
      followers: running,
      reach: Math.floor(avgReach * (0.8 + rand() * 0.4)),
    })
  }
  // Force the final point to match the total we reported
  followerSeries[followerSeries.length - 1]!.followers = followerCount

  // ── Audience breakdowns ──────────────────────────────────────────────────
  const ageBuckets = ['13-17', '18-24', '25-34', '35-44', '45-54', '55+']
  const ageShares = normaliseShares(ageBuckets.length, rand, [0.02, 0.18, 0.48, 0.20, 0.08, 0.04])
  const audienceAge = ageBuckets.map((b, i) => ({ bucket: b, share: ageShares[i]! }))

  const genderBuckets = ['F', 'M', 'U']
  const genderBase = seed % 2 === 0 ? [0.62, 0.34, 0.04] : [0.38, 0.58, 0.04]
  const genderShares = normaliseShares(3, rand, genderBase)
  const audienceGender = genderBuckets.map((b, i) => ({ bucket: b, share: genderShares[i]! }))

  const countries = ['US', 'GB', 'CA', 'AU', 'DE', 'BR', 'IN', 'NG']
  const shuffled = [...countries].sort(() => rand() - 0.5).slice(0, 5)
  const countryShares = normaliseShares(5, rand, [0.55, 0.14, 0.10, 0.07, 0.05])
  const audienceTopCountries = shuffled.map((c, i) => ({ bucket: c, share: countryShares[i]! }))

  // Stub profile views / website clicks (realistic ranges)
  const profileViews = Math.floor(followerCount * (0.03 + rand() * 0.12)) // 3-15% of followers over 28d
  const websiteClicks = Math.floor(profileViews * (0.02 + rand() * 0.08)) // 2-10% of profile visitors click

  return {
    username: cleanHandle,
    igUserId: `stub_${seed}`,
    accountType: rand() > 0.4 ? 'CREATOR' : 'BUSINESS',
    bio: pick([
      'Helping busy people get fit at home.',
      'Writing about money the way your friend would explain it.',
      'Recipes I would cook for you if you came over.',
      'Coaching people to think clearer and ship more.',
    ]),
    profileUrl: `https://instagram.com/${cleanHandle}`,
    followerCount,
    followingCount,
    postCount,
    engagementRate,
    avgReach,
    avgImpressions,
    profileViews,
    websiteClicks,
    dailyProfileViews: [],
    dailyWebsiteClicks: [],
    topPosts,
    recentMedia,
    stories: [],
    followerSeries,
    audienceAge,
    audienceGender,
    audienceTopCountries,
    audienceTopCities: [],
  }
}

function normaliseShares(n: number, rand: () => number, base: number[]): number[] {
  const jittered = base.slice(0, n).map((b) => Math.max(0.01, b + (rand() - 0.5) * 0.06))
  const sum = jittered.reduce((a, b) => a + b, 0)
  return jittered.map((v) => Math.round((v / sum) * 1000) / 1000)
}

/** Lightly perturb an existing stub so Simulate buttons feel alive. */
export function jitterStub(current: IgStub): IgStub {
  const rand = mulberry32(Date.now() & 0xffff)
  const delta = Math.floor((rand() - 0.35) * 200)
  const newFollowers = Math.max(0, current.followerCount + delta)
  const newEngagement = Math.round((current.engagementRate + (rand() - 0.5) * 0.4) * 100) / 100
  const newSeries = [...current.followerSeries.slice(1)]
  newSeries.push({
    date: new Date().toISOString().slice(0, 10),
    followers: newFollowers,
    reach: Math.floor(current.avgReach * (0.9 + rand() * 0.3)),
  })
  return {
    ...current,
    followerCount: newFollowers,
    engagementRate: Math.max(0.1, newEngagement),
    followerSeries: newSeries,
  }
}
