/**
 * Direct Meta Graph API client for Instagram Business accounts.
 * Replaces Phyllo middleware — calls Meta's APIs directly using
 * the user's long-lived access token.
 *
 * Permissions required: instagram_basic, pages_read_engagement,
 * pages_show_list, business_management.
 */

const API_VERSION = 'v21.0'
const GRAPH_URL = `https://graph.facebook.com/${API_VERSION}`

function appId(): string { return (process.env.FACEBOOK_APP_ID || '').trim() }
function appSecret(): string { return (process.env.FACEBOOK_APP_SECRET || '').trim() }

export function hasMetaCreds(): boolean {
  return Boolean(appId() && appSecret())
}

async function graphGet<T = unknown>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${GRAPH_URL}${path}`)
  url.searchParams.set('access_token', token)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString(), { timeout: 15000 } as RequestInit)
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const msg = (body as { error?: { message?: string } })?.error?.message || res.statusText
    throw new Error(`Meta ${path} → ${res.status}: ${msg}`)
  }
  return body as T
}

// ── OAuth token exchange ────────────────────────────────────────────

export async function exchangeCodeForToken(code: string, redirectUri: string): Promise<{ accessToken: string; expiresIn: number }> {
  const res = await fetch(`${GRAPH_URL}/oauth/access_token?` + new URLSearchParams({
    client_id: appId(),
    client_secret: appSecret(),
    redirect_uri: redirectUri,
    code,
  }))
  const body = await res.json().catch(() => null) as Record<string, unknown> | null
  if (!res.ok || !body?.access_token) {
    throw new Error(`Meta token exchange failed: ${res.status} ${JSON.stringify(body)}`)
  }
  return { accessToken: String(body.access_token), expiresIn: Number(body.expires_in || 3600) }
}

export async function getLongLivedToken(shortToken: string): Promise<{ accessToken: string; expiresIn: number }> {
  const res = await fetch(`${GRAPH_URL}/oauth/access_token?` + new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: appId(),
    client_secret: appSecret(),
    fb_exchange_token: shortToken,
  }))
  const body = await res.json().catch(() => null) as Record<string, unknown> | null
  if (!res.ok || !body?.access_token) {
    throw new Error(`Meta long-lived token exchange failed: ${res.status} ${JSON.stringify(body)}`)
  }
  return { accessToken: String(body.access_token), expiresIn: Number(body.expires_in || 5184000) }
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
}

export async function getIGMedia(igId: string, token: string, limit = 30): Promise<IGMedia[]> {
  const res = await graphGet<{ data: IGMedia[] }>(`/${igId}/media`, token, {
    fields: 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,like_count,comments_count',
    limit: String(limit),
  })
  return res.data || []
}

// ── Per-post insights ───────────────────────────────────────────────

export interface IGMediaInsight {
  impressions: number
  reach: number
  engagement: number
  saved: number
}

export async function getMediaInsights(mediaId: string, token: string): Promise<IGMediaInsight> {
  try {
    const res = await graphGet<{ data: Array<{ name: string; values: Array<{ value: number }> }> }>(
      `/${mediaId}/insights`,
      token,
      { metric: 'impressions,reach,saved' },
    )
    const byName: Record<string, number> = {}
    for (const m of res.data || []) {
      byName[m.name] = m.values?.[0]?.value ?? 0
    }
    return {
      impressions: byName.impressions || 0,
      reach: byName.reach || 0,
      engagement: (byName.impressions || 0) > 0 ? 0 : 0, // computed from likes+comments later
      saved: byName.saved || 0,
    }
  } catch {
    // Insights unavailable for this media (e.g., story, or account too new)
    return { impressions: 0, reach: 0, engagement: 0, saved: 0 }
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
    const res = await graphGet<{ data: Array<{ name: string; values: Array<{ value: Record<string, number> }> }> }>(
      `/${igId}/insights`,
      token,
      { metric: 'audience_gender_age,audience_country,audience_city', period: 'lifetime' },
    )
    const byName: Record<string, Record<string, number>> = {}
    for (const m of res.data || []) {
      byName[m.name] = m.values?.[0]?.value ?? {}
    }

    // audience_gender_age keys look like "F.18-24", "M.25-34"
    const genderAge: IGAudienceInsights['genderAge'] = []
    for (const [key, value] of Object.entries(byName.audience_gender_age || {})) {
      const [gender, ageRange] = key.split('.')
      genderAge.push({ gender, ageRange, value })
    }

    const countries = Object.entries(byName.audience_country || {})
      .map(([code, value]) => ({ code, value }))
      .sort((a, b) => b.value - a.value)

    const cities = Object.entries(byName.audience_city || {})
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)

    return { genderAge, countries, cities }
  } catch {
    // Audience insights require 100+ followers and a Business account
    return null
  }
}
