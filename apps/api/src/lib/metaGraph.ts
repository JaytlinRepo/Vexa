/**
 * Direct Meta Graph API client for Instagram Business accounts.
 * Replaces Phyllo middleware — calls Meta's APIs directly using
 * the user's long-lived access token.
 *
 * Permissions required: instagram_basic, pages_read_engagement,
 * pages_show_list, business_management.
 */

import axios, { AxiosError } from 'axios'

const API_VERSION = 'v21.0'
const GRAPH_URL = `https://graph.facebook.com/${API_VERSION}`

function appId(): string { return (process.env.FACEBOOK_APP_ID || '').trim() }
function appSecret(): string { return (process.env.FACEBOOK_APP_SECRET || '').trim() }

export function hasMetaCreds(): boolean {
  return Boolean(appId() && appSecret())
}

export async function graphGet<T = unknown>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  try {
    const res = await axios.get<T>(`${GRAPH_URL}${path}`, {
      params: { access_token: token, ...params },
      timeout: 30000,
    })
    return res.data
  } catch (err) {
    const ax = err as AxiosError
    const msg = (ax.response?.data as { error?: { message?: string } })?.error?.message || ax.message
    throw new Error(`Meta ${path} → ${ax.response?.status ?? 0}: ${msg}`)
  }
}

// ── OAuth token exchange ────────────────────────────────────────────

export async function exchangeCodeForToken(code: string, redirectUri: string): Promise<{ accessToken: string; expiresIn: number }> {
  try {
    const res = await axios.get<Record<string, unknown>>(`${GRAPH_URL}/oauth/access_token`, {
      params: { client_id: appId(), client_secret: appSecret(), redirect_uri: redirectUri, code },
      timeout: 15000,
    })
    if (!res.data?.access_token) throw new Error('No access_token in response')
    return { accessToken: String(res.data.access_token), expiresIn: Number(res.data.expires_in || 3600) }
  } catch (err) {
    const ax = err as AxiosError
    throw new Error(`Meta token exchange failed: ${ax.response?.status ?? 0} ${JSON.stringify(ax.response?.data ?? ax.message)}`)
  }
}

export async function getLongLivedToken(shortToken: string): Promise<{ accessToken: string; expiresIn: number }> {
  try {
    const res = await axios.get<Record<string, unknown>>(`${GRAPH_URL}/oauth/access_token`, {
      params: { grant_type: 'fb_exchange_token', client_id: appId(), client_secret: appSecret(), fb_exchange_token: shortToken },
      timeout: 15000,
    })
    if (!res.data?.access_token) throw new Error('No access_token in response')
    return { accessToken: String(res.data.access_token), expiresIn: Number(res.data.expires_in || 5184000) }
  } catch (err) {
    const ax = err as AxiosError
    throw new Error(`Meta long-lived token failed: ${ax.response?.status ?? 0} ${JSON.stringify(ax.response?.data ?? ax.message)}`)
  }
}

export async function refreshLongLivedToken(token: string): Promise<{ accessToken: string; expiresIn: number }> {
  // Long-lived tokens can be refreshed while still valid. The response
  // is a new long-lived token with a fresh 60-day expiry.
  return getLongLivedToken(token)
}

// ── IG Business Account discovery ───────────────────────────────────

export interface IGBusinessAccount {
  igBusinessId: string
  pageId: string
  pageName: string
}

export async function discoverIGBusinessAccount(token: string): Promise<IGBusinessAccount | null> {
  const pages = await graphGet<{ data: Array<{ id: string; name: string; instagram_business_account?: { id: string } }> }>(
    '/me/accounts',
    token,
    { fields: 'id,name,instagram_business_account' },
  )
  for (const page of pages.data || []) {
    if (page.instagram_business_account?.id) {
      return {
        igBusinessId: page.instagram_business_account.id,
        pageId: page.id,
        pageName: page.name,
      }
    }
  }
  return null
}

// ── Profile ─────────────────────────────────────────────────────────

export interface IGProfile {
  id: string
  username: string
  name: string | null
  biography: string | null
  profile_picture_url: string | null
  followers_count: number
  follows_count: number
  media_count: number
}

export async function getIGProfile(igId: string, token: string): Promise<IGProfile> {
  return graphGet<IGProfile>(`/${igId}`, token, {
    fields: 'id,username,name,biography,profile_picture_url,followers_count,follows_count,media_count',
  })
}

// ── Media ───────────────────────────────────────────────────────────

export interface IGMedia {
  id: string
  caption: string | null
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM'
  media_url: string | null
  permalink: string
  thumbnail_url: string | null
  timestamp: string
  like_count: number
  comments_count: number
  video_duration?: number // seconds, VIDEO/REEL only
}

export async function getIGMedia(igId: string, token: string, limit = 30): Promise<IGMedia[]> {
  const res = await graphGet<{ data: IGMedia[] }>(`/${igId}/media`, token, {
    fields: 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,like_count,comments_count,video_duration',
    limit: String(limit),
  })
  return res.data || []
}

// ── Carousel children (first image as thumbnail) ───────────────────

export interface IGCarouselChild {
  id: string
  media_type: 'IMAGE' | 'VIDEO'
  media_url: string | null
}

export async function getCarouselChildren(mediaId: string, token: string): Promise<IGCarouselChild[]> {
  const res = await graphGet<{ data: IGCarouselChild[] }>(`/${mediaId}/children`, token, {
    fields: 'id,media_type,media_url',
  })
  return res.data || []
}

// ── Per-post insights ───────────────────────────────────────────────

export interface IGMediaInsight {
  impressions: number
  reach: number
  engagement: number
  saved: number
  shares?: number
  avgWatchTimeMs?: number  // Reel avg watch time in milliseconds
  totalWatchTimeMs?: number // Reel total watch time in milliseconds
  plays?: number           // Reel total plays (including replays)
}

export async function getMediaInsights(mediaId: string, mediaType: string, token: string): Promise<IGMediaInsight> {
  try {
    // Different media types support different metrics:
    // IMAGE/CAROUSEL: reach, impressions, saved
    // VIDEO/REEL: reach, saved, plays, shares, ig_reels_avg_watch_time, ig_reels_video_view_total_time
    const isReel = mediaType === 'VIDEO' || mediaType === 'REEL'

    // Base metrics (works for all media types)
    const baseMetrics = 'reach,saved'
    const res = await graphGet<{ data: Array<{ name: string; values: Array<{ value: number }> }> }>(
      `/${mediaId}/insights`,
      token,
      { metric: baseMetrics },
    )
    const byName: Record<string, number> = {}
    for (const m of res.data || []) {
      byName[m.name] = m.values?.[0]?.value ?? 0
    }

    // For Reels, fetch retention metrics separately (they fail on non-Reel VIDEO)
    if (isReel) {
      try {
        const reelRes = await graphGet<{ data: Array<{ name: string; values: Array<{ value: number }> }> }>(
          `/${mediaId}/insights`,
          token,
          { metric: 'ig_reels_avg_watch_time,ig_reels_video_view_total_time,shares' },
        )
        for (const m of reelRes.data || []) {
          byName[m.name] = m.values?.[0]?.value ?? 0
        }
      } catch {
        // Reel metrics not available for this post — continue with base metrics
      }
    }

    const reach = byName.reach || 0
    const shares = byName.shares || 0
    return {
      impressions: reach, // best proxy since impressions/plays deprecated
      reach,
      engagement: 0,
      saved: byName.saved || 0,
      shares,
      avgWatchTimeMs: byName.ig_reels_avg_watch_time || 0,
      totalWatchTimeMs: byName.ig_reels_video_view_total_time || 0,
      plays: 0,
    }
  } catch (err) {
    console.warn(`[meta] insights failed for ${mediaId}:`, (err as Error).message?.slice(0, 100))
    return { impressions: 0, reach: 0, engagement: 0, saved: 0 }
  }
}

// ── Account-level insights (profile visits, website clicks) ────────

export interface IGAccountInsights {
  profileViews: number       // total profile visits over period
  websiteClicks: number      // bio link taps over period
  /** Daily breakdown (most recent 28 days) */
  dailyProfileViews: Array<{ date: string; value: number }>
  dailyWebsiteClicks: Array<{ date: string; value: number }>
}

/**
 * Fetch account-level insights: profile_views and website_clicks.
 * These are only available for IG Business/Creator accounts with
 * the instagram_manage_insights permission (which we already request).
 * Returns last 28 days of daily data.
 */
export async function getIGAccountInsights(igId: string, token: string): Promise<IGAccountInsights | null> {
  const result: IGAccountInsights = {
    profileViews: 0,
    websiteClicks: 0,
    dailyProfileViews: [],
    dailyWebsiteClicks: [],
  }

  // profile_views — period=day returns daily values
  try {
    const pvRes = await graphGet<{ data: Array<{ name: string; values: Array<{ value: number; end_time: string }> }> }>(
      `/${igId}/insights`,
      token,
      { metric: 'profile_views', period: 'day', since: daysAgoUnix(28), until: daysAgoUnix(0) },
    )
    const pvData = pvRes.data?.find(m => m.name === 'profile_views')
    if (pvData?.values) {
      for (const v of pvData.values) {
        result.dailyProfileViews.push({ date: v.end_time.slice(0, 10), value: v.value })
        result.profileViews += v.value
      }
    }
  } catch (e) {
    console.warn('[meta] profile_views insight failed:', (e as Error).message?.slice(0, 100))
  }

  // website_clicks — bio link taps
  try {
    const wcRes = await graphGet<{ data: Array<{ name: string; values: Array<{ value: number; end_time: string }> }> }>(
      `/${igId}/insights`,
      token,
      { metric: 'website_clicks', period: 'day', since: daysAgoUnix(28), until: daysAgoUnix(0) },
    )
    const wcData = wcRes.data?.find(m => m.name === 'website_clicks')
    if (wcData?.values) {
      for (const v of wcData.values) {
        result.dailyWebsiteClicks.push({ date: v.end_time.slice(0, 10), value: v.value })
        result.websiteClicks += v.value
      }
    }
  } catch (e) {
    console.warn('[meta] website_clicks insight failed:', (e as Error).message?.slice(0, 100))
  }

  if (result.profileViews === 0 && result.websiteClicks === 0 &&
      result.dailyProfileViews.length === 0 && result.dailyWebsiteClicks.length === 0) {
    return null
  }
  return result
}

function daysAgoUnix(days: number): string {
  return String(Math.floor((Date.now() - days * 86400000) / 1000))
}

// ── Stories ─────────────────────────────────────────────────────────

export interface IGStory {
  id: string
  media_type: 'IMAGE' | 'VIDEO'
  media_url: string | null
  timestamp: string
  permalink?: string
}

export interface IGStoryInsight {
  impressions: number
  reach: number
  replies: number
  tapsForward: number
  tapsBack: number
  exits: number
}

/**
 * Fetch currently live stories (ephemeral — only visible for 24h).
 * Returns empty array if no stories are active.
 */
export async function getIGStories(igId: string, token: string): Promise<IGStory[]> {
  try {
    const res = await graphGet<{ data: IGStory[] }>(`/${igId}/stories`, token, {
      fields: 'id,media_type,media_url,timestamp',
    })
    return res.data || []
  } catch (e) {
    console.warn('[meta] stories fetch failed:', (e as Error).message?.slice(0, 100))
    return []
  }
}

/**
 * Fetch insights for a single story. Only works while the story is live.
 */
export async function getStoryInsights(storyId: string, token: string): Promise<IGStoryInsight> {
  try {
    const res = await graphGet<{ data: Array<{ name: string; values: Array<{ value: number }> }> }>(
      `/${storyId}/insights`,
      token,
      { metric: 'impressions,reach,replies,taps_forward,taps_back,exits' },
    )
    const byName: Record<string, number> = {}
    for (const m of res.data || []) {
      byName[m.name] = m.values?.[0]?.value ?? 0
    }
    return {
      impressions: byName.impressions || 0,
      reach: byName.reach || 0,
      replies: byName.replies || 0,
      tapsForward: byName.taps_forward || 0,
      tapsBack: byName.taps_back || 0,
      exits: byName.exits || 0,
    }
  } catch (e) {
    console.warn(`[meta] story insights failed for ${storyId}:`, (e as Error).message?.slice(0, 100))
    return { impressions: 0, reach: 0, replies: 0, tapsForward: 0, tapsBack: 0, exits: 0 }
  }
}

// ── Audience insights ───────────────────────────────────────────────

export interface IGAudienceInsights {
  genderAge: Array<{ gender: string; ageRange: string; value: number }>
  countries: Array<{ code: string; value: number }>
  cities: Array<{ name: string; value: number }>
}

export async function getIGAudienceInsights(igId: string, token: string): Promise<IGAudienceInsights | null> {
  try {
    // Meta renamed audience metrics. New names:
    // follower_demographics → replaces audience_gender_age/audience_country/audience_city
    // Breakdown by age, gender, city, country via the 'breakdown' param.
    const genderAge: IGAudienceInsights['genderAge'] = []
    const countries: IGAudienceInsights['countries'] = []
    const cities: IGAudienceInsights['cities'] = []

    // Age + gender breakdown
    try {
      const ageRes = await graphGet<{ data: Array<{ total_value: { breakdowns: Array<{ results: Array<{ dimension_values: string[]; value: number }> }> } }> }>(
        `/${igId}/insights`,
        token,
        { metric: 'follower_demographics', period: 'lifetime', metric_type: 'total_value', breakdown: 'age,gender' },
      )
      const results = ageRes.data?.[0]?.total_value?.breakdowns?.[0]?.results || []
      for (const r of results) {
        const [age, gender] = r.dimension_values || []
        if (age && gender) genderAge.push({ gender, ageRange: age, value: r.value })
      }
    } catch (e) {
      console.warn('[meta] follower_demographics (age,gender) failed:', (e as Error).message?.slice(0, 100))
    }

    // Country breakdown
    try {
      const countryRes = await graphGet<{ data: Array<{ total_value: { breakdowns: Array<{ results: Array<{ dimension_values: string[]; value: number }> }> } }> }>(
        `/${igId}/insights`,
        token,
        { metric: 'follower_demographics', period: 'lifetime', metric_type: 'total_value', breakdown: 'country' },
      )
      const results = countryRes.data?.[0]?.total_value?.breakdowns?.[0]?.results || []
      for (const r of results) {
        countries.push({ code: r.dimension_values?.[0] || '', value: r.value })
      }
      countries.sort((a, b) => b.value - a.value)
    } catch (e) {
      console.warn('[meta] follower_demographics (country) failed:', (e as Error).message?.slice(0, 100))
    }

    // City breakdown
    try {
      const cityRes = await graphGet<{ data: Array<{ total_value: { breakdowns: Array<{ results: Array<{ dimension_values: string[]; value: number }> }> } }> }>(
        `/${igId}/insights`,
        token,
        { metric: 'follower_demographics', period: 'lifetime', metric_type: 'total_value', breakdown: 'city' },
      )
      const results = cityRes.data?.[0]?.total_value?.breakdowns?.[0]?.results || []
      for (const r of results) {
        cities.push({ name: r.dimension_values?.[0] || '', value: r.value })
      }
      cities.sort((a, b) => b.value - a.value)
    } catch (e) {
      console.warn('[meta] follower_demographics (city) failed:', (e as Error).message?.slice(0, 100))
    }

    if (genderAge.length === 0 && countries.length === 0 && cities.length === 0) return null
    return { genderAge, countries, cities }
  } catch (err) {
    console.warn('[meta] audience insights failed entirely:', (err as Error).message?.slice(0, 100))
    return null
  }
}

// ── Hashtag trending ───────────────────────────────────────────────

export interface IGHashtagPost {
  id: string
  caption: string
  mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM'
  mediaUrl?: string
  permalink: string
  timestamp: string
  likeCount: number
  commentsCount: number
}

/**
 * Search for a hashtag and return its ID
 */
export async function searchHashtag(hashtag: string, token: string, igBusinessId: string): Promise<string | null> {
  try {
    const res = await graphGet<{ data: Array<{ id: string }> }>(
      '/ig_hashtag_search',
      token,
      { user_id: igBusinessId, q: hashtag },
    )

    return res.data?.[0]?.id || null
  } catch (err) {
    console.warn('[meta] hashtag search failed for', hashtag, (err as Error).message?.slice(0, 100))
    return null
  }
}

/**
 * Get top posts for a hashtag
 */
export async function getHashtagTopPosts(hashtagId: string, token: string, igBusinessId: string, limit = 9): Promise<IGHashtagPost[]> {
  try {
    const res = await graphGet<{
      data: Array<{
        id: string
        caption?: string
        media_type?: string
        media_url?: string
        permalink?: string
        timestamp?: string
        like_count?: number | string
        comments_count?: number | string
      }>
    // Use recent_media — top_media doesn't return Reels/VIDEO
    }>(`/${hashtagId}/recent_media`, token, {
      fields: 'id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count',
      limit: String(limit),
      user_id: igBusinessId,
    })

    return (res.data || []).map((p) => ({
      id: p.id,
      caption: p.caption || '',
      mediaType: ((p.media_type || 'IMAGE').toUpperCase()) as 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM',
      mediaUrl: p.media_url,
      permalink: p.permalink || '',
      timestamp: p.timestamp || new Date().toISOString(),
      likeCount: typeof p.like_count === 'number' ? p.like_count : parseInt(String(p.like_count)) || 0,
      commentsCount: typeof p.comments_count === 'number' ? p.comments_count : parseInt(String(p.comments_count)) || 0,
    }))
  } catch (err) {
    console.warn('[meta] get hashtag top posts failed:', (err as Error).message?.slice(0, 100))
    return []
  }
}
