/**
 * Maps Meta Graph API responses → IgStub shape so every downstream
 * consumer (dashboard, agents, Platform* tables) works unchanged.
 */

import type { IgStub, IgMedia, IgAudienceBucket, IgStoryItem } from './instagramStub'
import type { IGProfile, IGMedia, IGMediaInsight, IGAudienceInsights, IGAccountInsights, IGStory, IGStoryInsight } from './metaGraph'

export function mapMetaToStub(input: {
  profile: IGProfile
  media: IGMedia[]
  mediaInsights: Map<string, IGMediaInsight>
  audience: IGAudienceInsights | null
  accountInsights?: IGAccountInsights | null
  stories?: Array<{ story: IGStory; insights: IGStoryInsight }>
  carouselThumbnails?: Map<string, string> // mediaId → first child media_url
}): IgStub {
  const { profile, media, mediaInsights, audience, accountInsights, stories, carouselThumbnails } = input

  const recentMedia: IgMedia[] = media.slice(0, 30).map((m) => {
    const insights = mediaInsights.get(m.id) || { impressions: 0, reach: 0, engagement: 0, saved: 0 }
    const engagement = m.like_count + m.comments_count + insights.saved
    // For carousels: thumbnail_url and media_url are null on the parent.
    // Use the first child's media_url (fetched separately) as the thumbnail.
    const thumb = m.thumbnail_url || m.media_url || carouselThumbnails?.get(m.id) || null
    return {
      id: m.id,
      caption: m.caption || '',
      media_type: m.media_type === 'VIDEO' ? 'REEL' : m.media_type,
      media_url: m.media_url,
      permalink: m.permalink,
      thumbnail_url: thumb,
      timestamp: m.timestamp,
      like_count: m.like_count,
      comments_count: m.comments_count,
      video_duration: m.video_duration,
      insights: {
        reach: insights.reach,
        impressions: insights.impressions,
        saved: insights.saved,
        shares: insights.shares || 0,
        engagement,
        avgWatchTimeMs: insights.avgWatchTimeMs,
      },
    }
  })

  const avgReach = recentMedia.length
    ? Math.round(recentMedia.reduce((s, m) => s + m.insights.reach, 0) / recentMedia.length)
    : 0
  const avgImpressions = recentMedia.length
    ? Math.round(recentMedia.reduce((s, m) => s + m.insights.impressions, 0) / recentMedia.length)
    : 0
  const engagementRate = recentMedia.length && avgReach > 0
    ? +((recentMedia.reduce((s, m) => s + m.insights.engagement, 0) / recentMedia.length / avgReach) * 100).toFixed(2)
    : 0

  const topPosts = [...recentMedia]
    .sort((a, b) => b.insights.engagement - a.insights.engagement)
    .slice(0, 5)

  // Follower series: synthesize a 30-day series ending at current count
  // (Meta doesn't expose historical follower counts via Graph API)
  const now = Date.now()
  const followerSeries = Array.from({ length: 30 }).map((_, i) => {
    const daysAgo = 29 - i
    const estimate = Math.round(profile.followers_count * (0.96 + 0.04 * (i / 29)))
    return {
      date: new Date(now - daysAgo * 86400000).toISOString().slice(0, 10),
      followers: i === 29 ? profile.followers_count : estimate,
      reach: avgReach,
    }
  })

  // Audience
  const audienceAge = aggregateAge(audience?.genderAge || [])
  const audienceGender = aggregateGender(audience?.genderAge || [])
  const audienceTopCountries = normalizeTopN(audience?.countries || [], 5)
  const audienceTopCities = normalizeTopN(audience?.cities?.map((c) => ({ code: c.name, value: c.value })) || [], 5)

  // Account-level insights
  const profileViews = accountInsights?.profileViews ?? 0
  const websiteClicks = accountInsights?.websiteClicks ?? 0
  const dailyProfileViews = accountInsights?.dailyProfileViews ?? []
  const dailyWebsiteClicks = accountInsights?.dailyWebsiteClicks ?? []

  // Stories
  const mappedStories: IgStoryItem[] = (stories || []).map(({ story, insights }) => ({
    id: story.id,
    media_type: story.media_type,
    media_url: story.media_url,
    timestamp: story.timestamp,
    insights: {
      impressions: insights.impressions,
      reach: insights.reach,
      replies: insights.replies,
      tapsForward: insights.tapsForward,
      tapsBack: insights.tapsBack,
      exits: insights.exits,
    },
  }))

  return {
    username: profile.username,
    igUserId: profile.id,
    accountType: 'CREATOR', // Graph API doesn't distinguish; both work
    bio: profile.biography || '',
    profileUrl: `https://instagram.com/${profile.username}`,
    followerCount: profile.followers_count,
    followingCount: profile.follows_count,
    postCount: profile.media_count,
    engagementRate,
    avgReach,
    avgImpressions,
    profileViews,
    websiteClicks,
    dailyProfileViews,
    dailyWebsiteClicks,
    topPosts,
    recentMedia,
    stories: mappedStories,
    followerSeries,
    audienceAge,
    audienceGender,
    audienceTopCountries,
    audienceTopCities,
  }
}

function aggregateAge(rows: Array<{ gender: string; ageRange: string; value: number }>): IgAudienceBucket[] {
  const buckets: Record<string, number> = {}
  let total = 0
  for (const r of rows) {
    buckets[r.ageRange] = (buckets[r.ageRange] || 0) + r.value
    total += r.value
  }
  const order = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+']
  return order
    .filter((k) => buckets[k] != null)
    .map((bucket) => ({ bucket, share: total > 0 ? clamp01(buckets[bucket] / total) : 0 }))
}

function aggregateGender(rows: Array<{ gender: string; ageRange: string; value: number }>): IgAudienceBucket[] {
  const buckets: Record<string, number> = {}
  let total = 0
  for (const r of rows) {
    const g = r.gender === 'F' ? 'FEMALE' : r.gender === 'M' ? 'MALE' : 'OTHER'
    buckets[g] = (buckets[g] || 0) + r.value
    total += r.value
  }
  return Object.entries(buckets).map(([bucket, value]) => ({
    bucket,
    share: total > 0 ? clamp01(value / total) : 0,
  }))
}

function normalizeTopN(items: Array<{ code: string; value: number }>, n: number): IgAudienceBucket[] {
  const total = items.reduce((s, i) => s + i.value, 0)
  return items.slice(0, n).map((i) => ({
    bucket: i.code,
    share: total > 0 ? clamp01(i.value / total) : 0,
  }))
}

function clamp01(n: number): number {
  if (!isFinite(n) || n < 0) return 0
  if (n > 1) return 1
  return Math.round(n * 1000) / 1000
}
