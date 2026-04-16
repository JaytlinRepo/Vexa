/**
 * TikTok Login Kit token refresh. Access tokens expire in ~24h.
 * The refresh token has a longer TTL (~365 days for approved apps,
 * shorter for sandbox). Each refresh returns a NEW refresh token
 * that must be stored — the old one is invalidated.
 */

import { PrismaClient } from '@prisma/client'

const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/'
const REFRESH_BUFFER_MS = 60 * 60 * 1000 // refresh 1 hour before expiry

function readConfig() {
  const clientKey = (process.env.TIKTOK_CLIENT_KEY || '').trim()
  const clientSecret = (process.env.TIKTOK_CLIENT_SECRET || '').trim()
  return { clientKey, clientSecret }
}

export async function ensureFreshToken(
  prisma: PrismaClient,
  companyId: string,
): Promise<{ accessToken: string; refreshed: boolean } | null> {
  const conn = await prisma.tiktokConnection.findUnique({ where: { companyId } })
  if (!conn || !conn.accessToken) return null

  // Token still valid and not close to expiry — use as-is
  if (conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() > Date.now() + REFRESH_BUFFER_MS) {
    return { accessToken: conn.accessToken, refreshed: false }
  }

  // Need to refresh
  if (!conn.refreshToken) {
    console.warn('[tiktok-token] no refresh token stored for company', companyId)
    return null
  }

  const { clientKey, clientSecret } = readConfig()
  if (!clientKey || !clientSecret) {
    console.warn('[tiktok-token] TIKTOK_CLIENT_KEY or TIKTOK_CLIENT_SECRET not set')
    return null
  }

  console.log('[tiktok-token] refreshing token for company', companyId)
  try {
    const body = new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      refresh_token: conn.refreshToken,
      grant_type: 'refresh_token',
    })

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cache-Control': 'no-cache',
      },
      body: body.toString(),
    })

    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null

    if (!res.ok || !json || typeof json.access_token !== 'string') {
      console.warn('[tiktok-token] refresh failed', { status: res.status, body: json })
      // If the refresh token is revoked/expired, mark the connection
      if (res.status === 400 || res.status === 401) {
        await prisma.tiktokConnection.update({
          where: { companyId },
          data: { accessToken: null, refreshToken: null },
        })
      }
      return null
    }

    const newAccessToken = String(json.access_token)
    const newRefreshToken = typeof json.refresh_token === 'string' ? json.refresh_token : conn.refreshToken
    const expiresIn = Number(json.expires_in || 0)

    await prisma.tiktokConnection.update({
      where: { companyId },
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        tokenExpiresAt: expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null,
      },
    })

    console.log('[tiktok-token] refreshed successfully, expires in', expiresIn, 's')
    return { accessToken: newAccessToken, refreshed: true }
  } catch (err) {
    console.warn('[tiktok-token] refresh network error', err)
    return null
  }
}
