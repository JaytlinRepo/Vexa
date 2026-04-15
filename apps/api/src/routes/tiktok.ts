import { Router } from 'express'
import crypto from 'crypto'

const router = Router()

/**
 * Minimal TikTok OAuth handshake — verifies the sandbox app is wired up
 * end-to-end. No DB writes yet; successful calls print the token payload
 * + profile fields to the Railway log and render a success page.
 *
 * Env required:
 *   TIKTOK_CLIENT_KEY
 *   TIKTOK_CLIENT_SECRET
 *   TIKTOK_REDIRECT_URI  — must match one of the URIs whitelisted in the
 *                          app's Login Kit → Redirect URIs.
 *
 * Scopes requested mirror what the app page has enabled:
 *   user.info.basic, user.info.profile, user.info.stats, video.list
 */
const SCOPES = 'user.info.basic,user.info.profile,user.info.stats,video.list'
const AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/'
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/'
const USER_INFO_URL =
  'https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,avatar_url_100,display_name,bio_description,profile_deep_link,is_verified,follower_count,following_count,likes_count,video_count'

function readConfig() {
  // Trim — Railway's variable UI sometimes stores a trailing newline which
  // fails TikTok's byte-for-byte redirect_uri match.
  const clientKey = (process.env.TIKTOK_CLIENT_KEY || '').trim()
  const clientSecret = (process.env.TIKTOK_CLIENT_SECRET || '').trim()
  const redirectUri = (process.env.TIKTOK_REDIRECT_URI || '').trim()
  return { clientKey, clientSecret, redirectUri }
}

function missingConfigPage(missing: string[]): string {
  return `<!doctype html><meta charset="utf-8"><title>TikTok · config missing</title>
    <body style="font-family:system-ui;padding:40px;max-width:640px;margin:0 auto;line-height:1.55">
      <h1 style="font-weight:500">TikTok config missing</h1>
      <p>The API is missing these env vars: <code>${missing.join('</code>, <code>')}</code>.</p>
      <p>Set them on Railway (Variables tab) and redeploy.</p>
    </body>`
}

// PKCE: TikTok's sandbox requires a code_challenge on /authorize and the
// matching code_verifier on token exchange. 43–128 chars, base64url.
function makeCodeVerifier(): string {
  return crypto.randomBytes(64).toString('base64url').slice(0, 96)
}
function codeChallengeFor(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

router.get('/auth/start', (req, res) => {
  const { clientKey, redirectUri } = readConfig()
  const missing: string[] = []
  if (!clientKey) missing.push('TIKTOK_CLIENT_KEY')
  if (!redirectUri) missing.push('TIKTOK_REDIRECT_URI')
  if (missing.length) {
    res.status(500).type('html').send(missingConfigPage(missing))
    return
  }

  // CSRF state — opaque token stored in an httpOnly cookie and echoed
  // back by TikTok in the callback. Any mismatch = reject.
  const state = crypto.randomBytes(16).toString('hex')
  const codeVerifier = makeCodeVerifier()
  const codeChallenge = codeChallengeFor(codeVerifier)

  const secure = req.secure || req.get('x-forwarded-proto') === 'https'
  const cookieOpts = {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    maxAge: 10 * 60 * 1000,
    path: '/',
  }
  res.cookie('tiktok_state', state, cookieOpts)
  res.cookie('tiktok_verifier', codeVerifier, cookieOpts)

  const params = new URLSearchParams({
    client_key: clientKey,
    response_type: 'code',
    scope: SCOPES,
    redirect_uri: redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })
  res.redirect(`${AUTH_URL}?${params.toString()}`)
})

router.get('/callback', async (req, res) => {
  const { clientKey, clientSecret, redirectUri } = readConfig()
  const missing: string[] = []
  if (!clientKey) missing.push('TIKTOK_CLIENT_KEY')
  if (!clientSecret) missing.push('TIKTOK_CLIENT_SECRET')
  if (!redirectUri) missing.push('TIKTOK_REDIRECT_URI')
  if (missing.length) {
    res.status(500).type('html').send(missingConfigPage(missing))
    return
  }

  const { code, state, error, error_description, scopes } = req.query as Record<string, string | undefined>

  if (error) {
    console.warn('[tiktok] user denied or provider returned error', { error, error_description })
    res.status(400).type('html').send(
      `<h1>TikTok said no</h1><p><code>${error}</code> — ${error_description || '(no description)'}</p>`
    )
    return
  }

  const cookieState = req.cookies?.tiktok_state
  const codeVerifier = req.cookies?.tiktok_verifier
  if (!state || !cookieState || state !== cookieState) {
    console.warn('[tiktok] state mismatch', { cookieState, state })
    res.status(400).type('html').send('<h1>State mismatch</h1><p>Refresh and try again.</p>')
    return
  }
  if (!codeVerifier) {
    console.warn('[tiktok] missing code_verifier cookie')
    res.status(400).type('html').send('<h1>Missing PKCE verifier</h1><p>Start the flow again — cookie expired.</p>')
    return
  }
  res.clearCookie('tiktok_state', { path: '/' })
  res.clearCookie('tiktok_verifier', { path: '/' })

  if (!code) {
    res.status(400).type('html').send('<h1>No code returned</h1>')
    return
  }

  // Exchange authorization code → access token.
  let tokenJson: Record<string, unknown> | null = null
  try {
    const body = new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    })
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cache-Control': 'no-cache',
      },
      body: body.toString(),
    })
    tokenJson = (await tokenRes.json().catch(() => null)) as Record<string, unknown> | null
    if (!tokenRes.ok || !tokenJson || typeof tokenJson.access_token !== 'string') {
      console.warn('[tiktok] token exchange failed', { status: tokenRes.status, body: tokenJson })
      res.status(502).type('html').send(
        `<h1>Token exchange failed</h1><pre>${escapeHtml(JSON.stringify(tokenJson, null, 2))}</pre>`
      )
      return
    }
  } catch (e) {
    console.warn('[tiktok] token exchange network error', e)
    res.status(502).type('html').send('<h1>Network error talking to TikTok</h1>')
    return
  }

  const accessToken = String(tokenJson.access_token)
  const openId = String(tokenJson.open_id || '')
  const grantedScopes = String(tokenJson.scope || scopes || '')
  const expiresIn = Number(tokenJson.expires_in || 0)
  const refreshToken = tokenJson.refresh_token ? '<present>' : '<absent>'

  // Fetch basic profile so we can confirm the handshake returned a usable token.
  let userJson: Record<string, unknown> | null = null
  try {
    const userRes = await fetch(USER_INFO_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    userJson = (await userRes.json().catch(() => null)) as Record<string, unknown> | null
    if (!userRes.ok) {
      console.warn('[tiktok] user info non-200', { status: userRes.status, body: userJson })
    }
  } catch (e) {
    console.warn('[tiktok] user info network error', e)
  }

  console.log('[tiktok] handshake ok', {
    openId,
    grantedScopes,
    expiresIn,
    tokenPrefix: accessToken.slice(0, 6),
    hasRefresh: refreshToken,
    profile: (userJson as { data?: { user?: unknown } } | null)?.data?.user ?? null,
  })

  const profile =
    ((userJson as { data?: { user?: Record<string, unknown> } } | null)?.data?.user) || null

  res.type('html').send(successPage({
    openId,
    grantedScopes,
    expiresIn,
    tokenPrefix: accessToken.slice(0, 8),
    profile,
  }))
})

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

function successPage(d: {
  openId: string
  grantedScopes: string
  expiresIn: number
  tokenPrefix: string
  profile: Record<string, unknown> | null
}): string {
  const profilePretty = d.profile ? escapeHtml(JSON.stringify(d.profile, null, 2)) : '(no profile returned)'
  return `<!doctype html><meta charset="utf-8"><title>TikTok · connected</title>
<body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;padding:40px;max-width:720px;margin:0 auto;line-height:1.55;background:#111;color:#eee">
  <h1 style="font-weight:500;letter-spacing:-.02em">TikTok sandbox — connected.</h1>
  <p>The handshake completed. The token and profile below are also printed to the API log.</p>
  <table style="border-collapse:collapse;width:100%;margin:20px 0;font-size:14px">
    <tr><td style="padding:6px 12px;color:#888;width:160px">Open ID</td><td style="padding:6px 12px"><code>${escapeHtml(d.openId) || '—'}</code></td></tr>
    <tr><td style="padding:6px 12px;color:#888">Scopes granted</td><td style="padding:6px 12px"><code>${escapeHtml(d.grantedScopes) || '—'}</code></td></tr>
    <tr><td style="padding:6px 12px;color:#888">Token prefix</td><td style="padding:6px 12px"><code>${escapeHtml(d.tokenPrefix)}…</code></td></tr>
    <tr><td style="padding:6px 12px;color:#888">Expires in</td><td style="padding:6px 12px">${d.expiresIn}s</td></tr>
  </table>
  <h2 style="font-weight:500;margin-top:32px">Profile</h2>
  <pre style="background:#1a1a1a;padding:18px;border-radius:10px;overflow:auto;font-size:12.5px">${profilePretty}</pre>
</body>`
}

export default router
