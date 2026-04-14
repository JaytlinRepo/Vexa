import { PhylloAccount, PhylloAudience, PhylloContentList, PhylloProfile } from './phyllo'
import type { PhylloContent } from './phyllo'
import type { IgMedia, IgStub } from './instagramStub'

/**
 * Map Phyllo payloads into the same shape our IG stub produces, so every
 * downstream consumer (dashboard, charts, insights) reads a single format
 * regardless of whether the numbers came from Phyllo or the stub.
 */
export function mapPhylloToStub(input: {
  account: PhylloAccount
  profile: PhylloProfile | null
  contents: PhylloContentList
  audience: PhylloAudience | null
}): IgStub {
  const profile = input.profile
  const rep = profile?.reputation || {}
  const followerCount = rep.follower_count ?? 0
  const followingCount = rep.following_count ?? 0
  const postCount = rep.content_count ?? input.contents.data.length

  // Recent media
  const recentMedia: IgMedia[] = (input.contents.data || []).slice(0, 20).map((c) => ({
    id: c.id,
    caption: c.description || c.title || '',
    media_type: mapContentType(c.type),
    media_url: c.url,
    permalink: c.url || '',
    thumbnail_url: c.thumbnail_url,
    timestamp: c.published_at || new Date().toISOString(),
    like_count: c.engagement?.like_count ?? 0,
    comments_count: c.engagement?.comment_count ?? 0,
    insights: {
      reach: c.engagement?.reach_count ?? c.engagement?.view_count ?? 0,
      impressions: c.engagement?.impression_count ?? c.engagement?.view_count ?? 0,
      saved: c.engagement?.save_count ?? 0,
      shares: c.engagement?.share_count ?? 0,
      engagement:
        (c.engagement?.like_count ?? 0) +
        (c.engagement?.comment_count ?? 0) +
        (c.engagement?.save_count ?? 0) +
        (c.engagement?.share_count ?? 0),
    },
  }))

  const avgReach = recentMedia.length
    ? Math.round(recentMedia.reduce((a, m) => a + m.insights.reach, 0) / recentMedia.length)
    : 0
  const avgImpressions = recentMedia.length
    ? Math.round(recentMedia.reduce((a, m) => a + m.insights.impressions, 0) / recentMedia.length)
    : 0
  const engagementRate = recentMedia.length && avgReach > 0
    ? +((recentMedia.reduce((a, m) => a + m.insights.engagement, 0) / recentMedia.length / avgReach) * 100).toFixed(2)
    : 0

  const topPosts = [...recentMedia]
    .sort((a, b) => b.insights.engagement - a.insights.engagement)
    .slice(0, 3)

  // Phyllo doesn't return a 30-day follower time series directly; synthesize a
  // monotonic series that ends at the real current follower count. When their
  // historical analytics endpoint is added we swap this out.
  const now = Date.now()
  const followerSeries = Array.from({ length: 30 }).map((_, i) => {
    const daysAgo = 29 - i
    // slight smoothing: assume steady growth ending at current count
    const estimate = Math.round(followerCount * (0.96 + 0.04 * (i / 29)))
    return {
      date: new Date(now - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      followers: i === 29 ? followerCount : estimate,
      reach: avgReach,
    }
  })

  // Audience buckets
  const audienceAge = aggregateAge(input.audience?.gender_age_distribution || [])
  const audienceGender = aggregateGender(input.audience?.gender_age_distribution || [])
  // Phyllo returns country share as a percentage (0..100), not a decimal.
  const audienceTopCountries = (input.audience?.countries || [])
    .slice()
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)
    .map((c) => ({ bucket: c.code, share: clamp01(c.value / 100) }))

  const username = profile?.platform_username || input.account.platform_username || ''
  const url = profile?.url || (username ? `https://instagram.com/${username}` : '')

  return {
    username,
    igUserId: profile?.id || input.account.id,
    accountType: 'BUSINESS',
    bio: profile?.introduction || '',
    profileUrl: url,
    followerCount,
    followingCount,
    postCount,
    engagementRate,
    avgReach,
    avgImpressions,
    topPosts,
    recentMedia,
    followerSeries,
    audienceAge,
    audienceGender,
    audienceTopCountries,
  }
}

function mapContentType(t: PhylloContent['type']): IgMedia['media_type'] {
  switch (t) {
    case 'VIDEO': return 'REEL'
    case 'CAROUSEL': return 'CAROUSEL_ALBUM'
    case 'IMAGE': return 'IMAGE'
    default: return 'IMAGE'
  }
}

function aggregateAge(rows: Array<{ gender: string; age_range: string; value: number }>) {
  const buckets: Record<string, number> = {}
  let total = 0
  for (const r of rows) {
    buckets[r.age_range] = (buckets[r.age_range] || 0) + r.value
    total += r.value
  }
  const order = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65-']
  return order
    .filter((k) => buckets[k] != null)
    .map((bucket) => ({ bucket, share: total > 0 ? clamp01((buckets[bucket] || 0) / total) : 0 }))
}

function aggregateGender(rows: Array<{ gender: string; age_range: string; value: number }>) {
  const buckets: Record<string, number> = {}
  let total = 0
  for (const r of rows) {
    const g = r.gender || 'U'
    buckets[g] = (buckets[g] || 0) + r.value
    total += r.value
  }
  return Object.entries(buckets).map(([bucket, value]) => ({ bucket, share: total > 0 ? clamp01(value / total) : 0 }))
}

function clamp01(n: number): number {
  if (!isFinite(n) || n < 0) return 0
  if (n > 1) return 1
  return Math.round(n * 1000) / 1000
}
