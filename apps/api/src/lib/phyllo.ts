import axios, { AxiosError } from 'axios'

/**
 * Thin wrapper over the Phyllo REST API. We use Basic auth (base64 of
 * client_id:secret) from env — never exposed to the browser.
 *
 * Docs: https://docs.getphyllo.com/docs/api-reference/reference/openapi.v1.yml
 */

const API_BASE = process.env.PHYLLO_API_BASE || 'https://api.staging.getphyllo.com'

function authHeader(): string {
  const id = process.env.PHYLLO_CLIENT_ID
  const secret = process.env.PHYLLO_CLIENT_SECRET
  if (!id || !secret) throw new Error('PHYLLO_CLIENT_ID / PHYLLO_CLIENT_SECRET unset')
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64')
}

export function hasPhylloCreds(): boolean {
  return Boolean(process.env.PHYLLO_CLIENT_ID && process.env.PHYLLO_CLIENT_SECRET)
}

async function call<T = unknown>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  try {
    const res = await axios.request<T>({
      method,
      url: API_BASE + path,
      data: body,
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 15000,
    })
    return res.data
  } catch (err) {
    const ax = err as AxiosError
    const status = ax.response?.status ?? 0
    const msg = ax.response?.data ? JSON.stringify(ax.response.data) : ax.message
    throw new Error(`phyllo ${method} ${path} → ${status}: ${msg}`)
  }
}

// ── Types (subset of what we use) ───────────────────────────────────────────
export interface PhylloUser {
  id: string
  name: string
  external_id: string
}

export interface PhylloSdkToken {
  sdk_token: string
  expires_at: string
}

export interface PhylloAccount {
  id: string
  user_id: string
  work_platform: { id: string; name: string; logo_url?: string }
  platform_username: string | null
  profile_pic_url: string | null
  status: 'CONNECTED' | 'SESSION_EXPIRED' | 'NOT_CONNECTED'
}

export interface PhylloProfile {
  id: string
  account: { id: string; platform_username?: string }
  platform_username: string | null
  url: string | null
  image_url: string | null
  platform_profile_name: string | null
  introduction: string | null
  reputation?: {
    follower_count?: number
    following_count?: number
    content_count?: number
  } | null
}

export interface PhylloContent {
  id: string
  external_id: string | null
  type: 'VIDEO' | 'IMAGE' | 'CAROUSEL' | 'AUDIO' | 'BLOG' | 'OTHER' | 'THREAD'
  title: string | null
  description: string | null
  url: string | null
  thumbnail_url: string | null
  published_at: string | null
  engagement?: {
    like_count?: number
    comment_count?: number
    share_count?: number
    view_count?: number
    save_count?: number
    reach_count?: number
    impression_count?: number
  } | null
}

export interface PhylloContentList {
  data: PhylloContent[]
  metadata?: { from?: string; to?: string; limit?: number; offset?: number }
}

export interface PhylloAudience {
  gender_age_distribution?: Array<{ gender: string; age_range: string; value: number }>
  country_distribution?: Array<{ code: string; name: string; value: number }>
  city_distribution?: Array<{ name: string; value: number }>
}

// ── Calls ───────────────────────────────────────────────────────────────────
export function createUser(name: string, externalId: string): Promise<PhylloUser> {
  return call<PhylloUser>('POST', '/v1/users', { name, external_id: externalId })
}

export function getUser(phylloUserId: string): Promise<PhylloUser> {
  return call<PhylloUser>('GET', `/v1/users/${phylloUserId}`)
}

export function createSdkToken(phylloUserId: string, products: string[]): Promise<PhylloSdkToken> {
  return call<PhylloSdkToken>('POST', '/v1/sdk-tokens', {
    user_id: phylloUserId,
    products,
  })
}

export function getAccount(accountId: string): Promise<PhylloAccount> {
  return call<PhylloAccount>('GET', `/v1/accounts/${accountId}`)
}

export function listAccountsForUser(phylloUserId: string): Promise<{ data: PhylloAccount[] }> {
  return call<{ data: PhylloAccount[] }>('GET', `/v1/accounts?user_id=${phylloUserId}`)
}

export function disconnectAccount(accountId: string): Promise<void> {
  return call<void>('POST', `/v1/accounts/${accountId}/disconnect`)
}

export function listWorkPlatforms(): Promise<{ data: Array<{ id: string; name: string; logo_url?: string; category?: string }> }> {
  return call('GET', '/v1/work-platforms?limit=100')
}

export function getProfile(accountId: string): Promise<{ data: PhylloProfile[] }> {
  return call<{ data: PhylloProfile[] }>('GET', `/v1/profiles?account_id=${accountId}`)
}

export function getContents(accountId: string, limit = 20): Promise<PhylloContentList> {
  return call<PhylloContentList>('GET', `/v1/social/contents?account_id=${accountId}&limit=${limit}`)
}

export function getAudience(accountId: string): Promise<PhylloAudience> {
  return call<PhylloAudience>('GET', `/v1/audience?account_id=${accountId}`)
}

export const DEFAULT_PRODUCTS = ['IDENTITY', 'IDENTITY.AUDIENCE', 'ENGAGEMENT', 'ENGAGEMENT.AUDIENCE']
