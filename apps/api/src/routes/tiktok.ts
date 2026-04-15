import { Router } from 'express'
import crypto from 'crypto'
import { PrismaClient } from '@prisma/client'
import { requireAuth, AuthedRequest } from '../middleware/auth'

const prisma = new PrismaClient()
const router = Router()

function appUrl(): string {
  const first = (process.env.CORS_ORIGINS || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000')
    .split(',')[0]
    .trim()
  return first.replace(/\/$/, '')
}

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
  'https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,avatar_url_100,avatar_large_url,display_name,username,bio_description,profile_deep_link,is_verified,follower_count,following_count,likes_count,video_count'

const VIDEO_LIST_URL =
  'https://open.tiktokapis.com/v2/video/list/?fields=id,title,video_description,duration,cover_image_url,embed_link,share_url,create_time,like_count,comment_count,share_count,view_count'

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

// Stateless state: we used to stash nonce + verifier + companyId in cookies,
// but the cookies are set on whatever origin the browser saw on /auth/start
// (Vercel, via rewrite) while TikTok's redirect_uri points at Railway — so
// the cookies never make it to /callback. Encoding everything into the
// signed `state` param sidesteps that entirely.
function stateSecret(): string {
  return process.env.SESSION_SECRET || 'dev-local-session-secret-change-for-prod'
}
function encodeState(payload: { nonce: string; v: string; c: string; ts: number }): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url')
  return `${body}.${sig}`
}
function decodeState(
  raw: string | undefined,
): { nonce: string; v: string; c: string; ts: number } | null {
  if (!raw || typeof raw !== 'string') return null
  const parts = raw.split('.')
  if (parts.length !== 2) return null
  const [body, sig] = parts
  const expected = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url')
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return null
  }
  try {
    const obj = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (!obj || typeof obj.nonce !== 'string' || typeof obj.v !== 'string') return null
    if (typeof obj.ts !== 'number' || Date.now() - obj.ts > 15 * 60 * 1000) return null
    return { nonce: obj.nonce, v: obj.v, c: String(obj.c || ''), ts: obj.ts }
  } catch {
    return null
  }
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

  // Optional companyId — when present, the callback persists the
  // TiktokConnection and redirects back to the web app's dashboard.
  // When absent, the callback falls through to the sandbox debug page.
  const companyId =
    typeof req.query.companyId === 'string' && /^[0-9a-f-]{10,}$/i.test(req.query.companyId)
      ? req.query.companyId
      : ''

  const nonce = crypto.randomBytes(16).toString('hex')
  const codeVerifier = makeCodeVerifier()
  const codeChallenge = codeChallengeFor(codeVerifier)
  const state = encodeState({ nonce, v: codeVerifier, c: companyId, ts: Date.now() })

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

  const decoded = decodeState(state)
  if (!decoded) {
    console.warn('[tiktok] state verify failed', { statePreview: (state || '').slice(0, 16) })
    res.status(400).type('html').send('<h1>State mismatch</h1><p>Refresh and click Connect TikTok again.</p>')
    return
  }
  const codeVerifier = decoded.v
  const stateCompanyId = decoded.c

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

  // Fetch profile + recent videos in parallel so the success page shows the
  // full picture of what this sandbox token unlocks.
  const [userJson, videoJson] = await Promise.all([
    fetch(USER_INFO_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(async (r) => {
        const body = (await r.json().catch(() => null)) as Record<string, unknown> | null
        if (!r.ok) console.warn('[tiktok] user info non-200', { status: r.status, body })
        return body
      })
      .catch((e) => {
        console.warn('[tiktok] user info network error', e)
        return null
      }),
    fetch(VIDEO_LIST_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ max_count: 20 }),
    })
      .then(async (r) => {
        const body = (await r.json().catch(() => null)) as Record<string, unknown> | null
        if (!r.ok) console.warn('[tiktok] video list non-200', { status: r.status, body })
        return body
      })
      .catch((e) => {
        console.warn('[tiktok] video list network error', e)
        return null
      }),
  ])

  const profile =
    ((userJson as { data?: { user?: Record<string, unknown> } } | null)?.data?.user) || null
  const videos =
    ((videoJson as { data?: { videos?: Array<Record<string, unknown>> } } | null)?.data?.videos) || []

  console.log('[tiktok] handshake ok', {
    openId,
    grantedScopes,
    expiresIn,
    tokenPrefix: accessToken.slice(0, 6),
    hasRefresh: refreshToken,
    profileFields: profile ? Object.keys(profile).length : 0,
    videoCount: videos.length,
  })

  // If a companyId was set at /auth/start, persist the connection and send
  // the user back to the web dashboard. Otherwise (sandbox smoke test), fall
  // through to the debug success page below.
  const companyId = stateCompanyId
  if (companyId) {
    try {
      await persistConnection({
        companyId,
        profile,
        videos,
        openId,
        unionId: String(tokenJson.open_id_hash || tokenJson.union_id || ''),
        accessToken,
        refreshToken: typeof tokenJson.refresh_token === 'string' ? tokenJson.refresh_token : null,
        expiresIn,
        grantedScopes,
      })
    } catch (e) {
      console.warn('[tiktok] persist failed', e)
    }
    const back = `${appUrl()}/?tiktokConnected=1#tiktok`
    res.redirect(back)
    return
  }

  res.type('html').send(successPage({
    openId,
    grantedScopes,
    expiresIn,
    tokenPrefix: accessToken.slice(0, 8),
    profile,
    videos,
  }))
})

/**
 * Write / upsert the TiktokConnection for the given company from a fresh
 * Login Kit handshake. We compute aggregate engagement here so the dashboard
 * doesn't have to recalculate on every render.
 */
async function persistConnection(opts: {
  companyId: string
  profile: Record<string, unknown> | null
  videos: Array<Record<string, unknown>>
  openId: string
  unionId: string
  accessToken: string
  refreshToken: string | null
  expiresIn: number
  grantedScopes: string
}): Promise<void> {
  const p = opts.profile || {}
  const engagement = summarizeEngagement(opts.videos)

  const handleRaw = typeof p.username === 'string' ? p.username : ''
  const handle = handleRaw ? `@${handleRaw}` : (typeof p.display_name === 'string' ? p.display_name : opts.openId.slice(0, 10))
  const followerCount = Number(p.follower_count ?? 0)
  const followingCount = Number(p.following_count ?? 0)
  const videoCount = Number(p.video_count ?? 0)
  const likesCount = Number(p.likes_count ?? 0)
  const avatarUrl =
    (typeof p.avatar_url_100 === 'string' && p.avatar_url_100) ||
    (typeof p.avatar_url === 'string' && p.avatar_url) ||
    null
  const profileUrl = typeof p.profile_deep_link === 'string' ? p.profile_deep_link : null
  const bio = typeof p.bio_description === 'string' ? p.bio_description : null
  const displayName = typeof p.display_name === 'string' ? p.display_name : null
  const isVerified = Boolean(p.is_verified)

  // Top 3 by views (mapped down to stable fields the UI consumes).
  const videoForCard = (v: Record<string, unknown>) => ({
    id: String(v.id || ''),
    title:
      (typeof v.title === 'string' && v.title.trim()) ||
      (typeof v.video_description === 'string' && v.video_description.trim()) ||
      '',
    cover: typeof v.cover_image_url === 'string' ? v.cover_image_url : '',
    shareUrl: typeof v.share_url === 'string' ? v.share_url : '',
    createdAt: Number(v.create_time || 0),
    duration: Number(v.duration || 0),
    views: Number(v.view_count || 0),
    likes: Number(v.like_count || 0),
    comments: Number(v.comment_count || 0),
    shares: Number(v.share_count || 0),
  })
  const recentMapped = opts.videos.map(videoForCard)
  const topVideos = [...recentMapped].sort((a, b) => b.views - a.views).slice(0, 3)

  const data = {
    handle,
    displayName,
    bio,
    avatarUrl,
    profileUrl,
    isVerified,
    followerCount,
    followingCount,
    videoCount,
    likesCount,
    avgViews: engagement.avgViews,
    avgLikes: engagement.avgLikes,
    engagementRate: engagement.engagementRate,
    reachRate: followerCount > 0 ? engagement.avgViews / followerCount : 0,
    topVideos,
    recentVideos: recentMapped,
    openId: opts.openId,
    unionId: opts.unionId || null,
    accessToken: opts.accessToken,
    refreshToken: opts.refreshToken,
    tokenExpiresAt: opts.expiresIn > 0 ? new Date(Date.now() + opts.expiresIn * 1000) : null,
    scopes: opts.grantedScopes || null,
    source: 'tiktok',
    lastSyncedAt: new Date(),
  }

  await prisma.tiktokConnection.upsert({
    where: { companyId: opts.companyId },
    create: { companyId: opts.companyId, ...data },
    update: data,
  })
  console.log('[tiktok] connection saved', { companyId: opts.companyId, handle, followerCount, videoCount })
}

/** GET /api/tiktok/insights?companyId=X — dashboard read path. */
router.get('/insights', requireAuth, async (req, res) => {
  const { userId } = (req as AuthedRequest).session
  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : ''
  if (!companyId) {
    res.status(400).json({ error: 'missing_company_id' })
    return
  }
  const company = await prisma.company.findFirst({ where: { id: companyId, userId } })
  if (!company) {
    res.status(404).json({ error: 'company_not_found' })
    return
  }
  const conn = await prisma.tiktokConnection.findUnique({ where: { companyId } })
  // Strip tokens before returning to the client.
  if (!conn) {
    res.json({ connection: null })
    return
  }
  const { accessToken: _t, refreshToken: _rt, ...safe } = conn
  void _t
  void _rt
  res.json({ connection: safe })
})

/** DELETE /api/tiktok/connections/:companyId — sign out of TikTok. */
router.delete('/connections/:companyId', requireAuth, async (req, res) => {
  const { userId } = (req as AuthedRequest).session
  const { companyId } = req.params
  const company = await prisma.company.findFirst({ where: { id: companyId, userId } })
  if (!company) {
    res.status(404).json({ error: 'company_not_found' })
    return
  }
  await prisma.tiktokConnection.deleteMany({ where: { companyId } })
  res.json({ ok: true })
})

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

type VideoEngagement = {
  count: number
  views: number
  likes: number
  comments: number
  shares: number
  avgViews: number
  avgLikes: number
  avgComments: number
  avgShares: number
  engagementRate: number // (likes+comments+shares) / views
  bestView: { title: string; views: number; url: string } | null
  bestEngagement: { title: string; rate: number; views: number; url: string } | null
}

function summarizeEngagement(videos: Array<Record<string, unknown>>): VideoEngagement {
  let views = 0, likes = 0, comments = 0, shares = 0
  let bestView: VideoEngagement['bestView'] = null
  let bestEng: VideoEngagement['bestEngagement'] = null
  for (const v of videos) {
    const vv = Number(v.view_count ?? 0)
    const ll = Number(v.like_count ?? 0)
    const cc = Number(v.comment_count ?? 0)
    const ss = Number(v.share_count ?? 0)
    views += vv; likes += ll; comments += cc; shares += ss
    const title =
      (typeof v.title === 'string' && v.title.trim()) ||
      (typeof v.video_description === 'string' && v.video_description.trim()) ||
      '(untitled)'
    const url = typeof v.share_url === 'string' ? v.share_url : ''
    if (!bestView || vv > bestView.views) {
      bestView = { title, views: vv, url }
    }
    if (vv > 0) {
      const rate = (ll + cc + ss) / vv
      if (!bestEng || rate > bestEng.rate) {
        bestEng = { title, rate, views: vv, url }
      }
    }
  }
  const n = videos.length || 1
  return {
    count: videos.length,
    views, likes, comments, shares,
    avgViews: Math.round(views / n),
    avgLikes: Math.round(likes / n),
    avgComments: Math.round(comments / n),
    avgShares: Math.round(shares / n),
    engagementRate: views > 0 ? (likes + comments + shares) / views : 0,
    bestView,
    bestEngagement: bestEng,
  }
}

function engagementSection(eng: VideoEngagement, followerCount: number): string {
  if (eng.count === 0) return ''
  const pct = (n: number) => (n * 100).toFixed(2) + '%'
  const reachRate = followerCount > 0 ? eng.avgViews / followerCount : 0
  return `
    <h2 style="font-weight:500;margin:30px 0 10px">Page engagement <span style="color:#666;font-weight:400;font-size:14px">· last ${eng.count} videos</span></h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px">
      ${statTile('Total views', fmtNum(eng.views))}
      ${statTile('Total likes', fmtNum(eng.likes))}
      ${statTile('Total comments', fmtNum(eng.comments))}
      ${statTile('Total shares', fmtNum(eng.shares))}
      ${statTile('Avg views / video', fmtNum(eng.avgViews))}
      ${statTile('Engagement rate', pct(eng.engagementRate), '(likes+comments+shares) / views')}
      ${followerCount > 0 ? statTile('Reach rate', pct(reachRate), 'avg views / follower count') : ''}
    </div>
    ${eng.bestView
      ? `<div style="background:#161616;border:1px solid #262626;border-radius:10px;padding:12px 14px;margin-bottom:10px;font-size:13px">
           <div style="color:#888;font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px">Top video by views</div>
           <div>${escapeHtml(eng.bestView.title.slice(0, 140))}${eng.bestView.title.length > 140 ? '…' : ''} — <strong>${fmtNum(eng.bestView.views)} views</strong>${eng.bestView.url ? ` · <a href="${escapeHtml(eng.bestView.url)}" target="_blank" style="color:#8aa;border-bottom:1px solid #456">open</a>` : ''}</div>
         </div>`
      : ''}
    ${eng.bestEngagement && eng.bestEngagement.title !== eng.bestView?.title
      ? `<div style="background:#161616;border:1px solid #262626;border-radius:10px;padding:12px 14px;margin-bottom:10px;font-size:13px">
           <div style="color:#888;font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px">Top video by engagement rate</div>
           <div>${escapeHtml(eng.bestEngagement.title.slice(0, 140))}${eng.bestEngagement.title.length > 140 ? '…' : ''} — <strong>${pct(eng.bestEngagement.rate)}</strong> on ${fmtNum(eng.bestEngagement.views)} views${eng.bestEngagement.url ? ` · <a href="${escapeHtml(eng.bestEngagement.url)}" target="_blank" style="color:#8aa;border-bottom:1px solid #456">open</a>` : ''}</div>
         </div>`
      : ''}
  `
}

function statTile(label: string, value: string, hint = ''): string {
  return `
    <div style="background:#161616;border:1px solid #262626;border-radius:10px;padding:12px 14px">
      <div style="color:#777;font-size:10px;letter-spacing:.12em;text-transform:uppercase">${escapeHtml(label)}</div>
      <div style="color:#eee;font-size:20px;font-weight:500;letter-spacing:-.01em;margin-top:4px">${escapeHtml(value)}</div>
      ${hint ? `<div style="color:#666;font-size:10px;margin-top:2px">${escapeHtml(hint)}</div>` : ''}
    </div>`
}

function fmtNum(n: unknown): string {
  const v = Number(n ?? 0)
  if (!Number.isFinite(v)) return '—'
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (v >= 1_000) return (v / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return v.toLocaleString()
}
function fmtDate(sec: unknown): string {
  const s = Number(sec ?? 0)
  if (!s) return '—'
  return new Date(s * 1000).toISOString().slice(0, 10)
}

function videoRow(v: Record<string, unknown>): string {
  const title =
    (typeof v.title === 'string' && v.title.trim()) ||
    (typeof v.video_description === 'string' && v.video_description.trim()) ||
    '(untitled)'
  const cover = typeof v.cover_image_url === 'string' ? v.cover_image_url : ''
  const share = typeof v.share_url === 'string' ? v.share_url : ''
  const duration = Number(v.duration ?? 0)
  return `
    <tr style="border-top:1px solid #262626">
      <td style="padding:10px 12px;vertical-align:top">
        ${cover
          ? `<img src="${escapeHtml(cover)}" alt="" width="72" height="96" style="border-radius:6px;object-fit:cover;background:#222;display:block">`
          : `<div style="width:72px;height:96px;border-radius:6px;background:#222"></div>`}
      </td>
      <td style="padding:10px 12px;vertical-align:top">
        <div style="color:#eee;font-size:13.5px;line-height:1.4;max-width:340px">${escapeHtml(title.slice(0, 120))}${title.length > 120 ? '…' : ''}</div>
        <div style="color:#777;font-size:11px;margin-top:4px">${fmtDate(v.create_time)} · ${duration}s${share ? ` · <a href="${escapeHtml(share)}" target="_blank" style="color:#8aa;border-bottom:1px solid #456">open</a>` : ''}</div>
      </td>
      <td style="padding:10px 12px;text-align:right;color:#bbb;font-size:12.5px;vertical-align:top">
        <div>❤ ${fmtNum(v.like_count)}</div>
        <div>💬 ${fmtNum(v.comment_count)}</div>
        <div>👁 ${fmtNum(v.view_count)}</div>
      </td>
    </tr>`
}

function successPage(d: {
  openId: string
  grantedScopes: string
  expiresIn: number
  tokenPrefix: string
  profile: Record<string, unknown> | null
  videos: Array<Record<string, unknown>>
}): string {
  const p = d.profile || {}
  const avatar = typeof p.avatar_url_100 === 'string' ? p.avatar_url_100 : ''
  const handle = typeof p.username === 'string' && p.username ? `@${p.username}` : ''
  const displayName = typeof p.display_name === 'string' ? p.display_name : ''
  const bio = typeof p.bio_description === 'string' ? p.bio_description : ''
  const videosRows = d.videos.map(videoRow).join('')
  const engagement = summarizeEngagement(d.videos)
  const followerCount = Number((p as { follower_count?: unknown }).follower_count ?? 0)
  const profileJson = escapeHtml(JSON.stringify(p, null, 2))
  return `<!doctype html><meta charset="utf-8"><title>TikTok · connected</title>
<body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;padding:40px;max-width:860px;margin:0 auto;line-height:1.55;background:#111;color:#eee">
  <h1 style="font-weight:500;letter-spacing:-.02em;margin:0 0 6px">TikTok sandbox — connected.</h1>
  <p style="color:#888;margin:0 0 24px">Handshake + scopes + /v2/video/list all printed to the Railway log.</p>

  <!-- Identity card -->
  <div style="display:flex;gap:18px;align-items:center;background:#161616;border:1px solid #262626;border-radius:14px;padding:18px 20px;margin-bottom:22px">
    ${avatar ? `<img src="${escapeHtml(avatar)}" alt="" width="72" height="72" style="border-radius:12px;flex-shrink:0">` : ''}
    <div style="min-width:0;flex:1">
      <div style="font-size:18px;font-weight:500">${escapeHtml(displayName) || '(no display name)'} ${handle ? `<span style="color:#777;font-weight:400;margin-left:6px">${escapeHtml(handle)}</span>` : ''}</div>
      ${bio ? `<div style="color:#aaa;font-size:13px;margin-top:4px">${escapeHtml(bio)}</div>` : ''}
      <div style="color:#777;font-size:12px;margin-top:6px;display:flex;gap:16px;flex-wrap:wrap">
        <span>${fmtNum(p.follower_count)} followers</span>
        <span>${fmtNum(p.following_count)} following</span>
        <span>${fmtNum(p.video_count)} videos</span>
        <span>${fmtNum(p.likes_count)} likes</span>
        ${p.is_verified ? '<span style="color:#7ac">verified</span>' : ''}
      </div>
    </div>
  </div>

  <!-- Token meta -->
  <table style="border-collapse:collapse;width:100%;margin:4px 0 26px;font-size:13px">
    <tr><td style="padding:5px 12px;color:#888;width:160px">Open ID</td><td style="padding:5px 12px"><code>${escapeHtml(d.openId) || '—'}</code></td></tr>
    <tr><td style="padding:5px 12px;color:#888">Scopes granted</td><td style="padding:5px 12px"><code>${escapeHtml(d.grantedScopes) || '—'}</code></td></tr>
    <tr><td style="padding:5px 12px;color:#888">Token prefix</td><td style="padding:5px 12px"><code>${escapeHtml(d.tokenPrefix)}…</code></td></tr>
    <tr><td style="padding:5px 12px;color:#888">Expires in</td><td style="padding:5px 12px">${d.expiresIn}s</td></tr>
  </table>

  ${engagementSection(engagement, followerCount)}

  <!-- Videos -->
  <h2 style="font-weight:500;margin:30px 0 10px">Recent videos <span style="color:#666;font-weight:400;font-size:14px">· ${d.videos.length} returned</span></h2>
  ${d.videos.length === 0
    ? '<p style="color:#888">No videos returned — check scope <code>video.list</code> or confirm the account has public content.</p>'
    : `<table style="border-collapse:collapse;width:100%;background:#161616;border:1px solid #262626;border-radius:12px;overflow:hidden">
         <thead>
           <tr style="color:#777;font-size:11px;letter-spacing:.08em;text-transform:uppercase;text-align:left;background:#1a1a1a">
             <th style="padding:10px 12px;font-weight:500;width:96px">Cover</th>
             <th style="padding:10px 12px;font-weight:500">Title</th>
             <th style="padding:10px 12px;font-weight:500;text-align:right">Engagement</th>
           </tr>
         </thead>
         <tbody>${videosRows}</tbody>
       </table>`}

  <!-- Raw profile JSON for debugging -->
  <details style="margin-top:28px">
    <summary style="cursor:pointer;color:#888;font-size:12px">Raw profile JSON</summary>
    <pre style="background:#1a1a1a;padding:18px;border-radius:10px;overflow:auto;font-size:12px;margin-top:10px">${profileJson}</pre>
  </details>
</body>`
}

export default router
