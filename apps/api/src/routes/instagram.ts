import { Router } from 'express'
import crypto from 'crypto'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import * as meta from '../lib/metaGraph'
import { mapMetaToStub } from '../lib/metaMapper'
import { persistPhylloSync } from '../lib/platformSync'
import { writeMemory } from '../lib/brandMemory'
import { createNotification } from '../services/notifications/notification.service'
import { detectNicheFromContent } from '../lib/nicheDetection'
import { triggerFirstConnectBatch } from '../lib/proactiveAnalysis'
import { PLAN_LIMITS } from '../lib/plans'

import prisma from '../lib/prisma'
const router = Router()

const SCOPES = 'instagram_basic,instagram_manage_insights,pages_read_engagement,pages_show_list,business_management'

function appUrl(): string {
  return (process.env.CORS_ORIGINS || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000')
    .split(',')[0].trim().replace(/\/$/, '')
}
function redirectUri(): string {
  return (process.env.INSTAGRAM_REDIRECT_URI || '').trim()
}

// ── Stateless state (same pattern as TikTok) ────────────────────────
function stateSecret(): string {
  return process.env.SESSION_SECRET || 'dev-local-session-secret-change-for-prod'
}
function encodeState(payload: { n: string; c: string; ts: number }): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url')
  return `${body}.${sig}`
}
function decodeState(raw: string | undefined): { n: string; c: string; ts: number } | null {
  if (!raw || typeof raw !== 'string') return null
  const parts = raw.split('.')
  if (parts.length !== 2) return null
  const [body, sig] = parts
  const expected = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url')
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  try {
    const obj = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (!obj || typeof obj.n !== 'string' || typeof obj.ts !== 'number') return null
    if (Date.now() - obj.ts > 15 * 60 * 1000) return null
    return obj
  } catch { return null }
}

// ── OAuth start ─────────────────────────────────────────────────────

router.get('/auth/start', (req, res) => {
  const uri = redirectUri()
  const fbAppId = (process.env.FACEBOOK_APP_ID || '').trim()
  if (!fbAppId || !uri) {
    res.status(500).type('html').send('<h1>Missing FACEBOOK_APP_ID or INSTAGRAM_REDIRECT_URI</h1>')
    return
  }

  const companyId = typeof req.query.companyId === 'string' && /^[0-9a-f-]{10,}$/i.test(req.query.companyId)
    ? req.query.companyId : ''
  const nonce = crypto.randomBytes(16).toString('hex')
  const state = encodeState({ n: nonce, c: companyId, ts: Date.now() })

  const params = new URLSearchParams({
    client_id: fbAppId,
    redirect_uri: uri,
    scope: SCOPES,
    response_type: 'code',
    state,
  })
  res.redirect(`https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`)
})

// ── OAuth callback ──────────────────────────────────────────────────

router.get('/auth/callback', async (req, res) => {
  const { code, state, error } = req.query as Record<string, string | undefined>

  if (error) {
    console.warn('[instagram] user denied or Meta error', { error })
    res.status(400).type('html').send(`<h1>Instagram connection failed</h1><p>${error}</p>`)
    return
  }

  const decoded = decodeState(state)
  if (!decoded) {
    res.status(400).type('html').send('<h1>State mismatch</h1><p>Refresh and try again.</p>')
    return
  }
  const companyId = decoded.c

  if (!code) {
    res.status(400).type('html').send('<h1>No code returned</h1>')
    return
  }

  try {
    // Exchange code → short-lived → long-lived token
    console.log('[instagram] exchanging code for token...')
    const shortToken = await meta.exchangeCodeForToken(code, redirectUri())
    const longToken = await meta.getLongLivedToken(shortToken.accessToken)
    const accessToken = longToken.accessToken
    const expiresIn = longToken.expiresIn

    // Discover IG Business Account
    const igBiz = await meta.discoverIGBusinessAccount(accessToken)
    if (!igBiz) {
      res.status(400).type('html').send(`
        <h1>No Instagram Business Account found</h1>
        <p>Your Facebook Page must be connected to an Instagram Professional (Creator or Business) account.</p>
        <p>Go to your Facebook Page → Settings → Instagram → Connect Account.</p>
      `)
      return
    }
    console.log('[instagram] found IG Business Account:', igBiz.igBusinessId, 'on page', igBiz.pageName)

    // Fetch profile (required) + media/audience (best-effort)
    const profile = await meta.getIGProfile(igBiz.igBusinessId, accessToken)
    console.log('[instagram] profile fetched:', profile.username, profile.followers_count, 'followers')

    const media = await meta.getIGMedia(igBiz.igBusinessId, accessToken, 30).catch((err) => {
      console.warn('[instagram] media fetch failed (continuing without posts):', err.message)
      return [] as meta.IGMedia[]
    })
    console.log('[instagram] media fetched:', media.length, 'posts')

    // Fetch per-post insights (best-effort, parallel, cap at 20)
    const insightsMap = new Map<string, meta.IGMediaInsight>()
    if (media.length > 0) {
      await Promise.allSettled(
        media.slice(0, 20).map(async (m) => {
          insightsMap.set(m.id, await meta.getMediaInsights(m.id, m.media_type, accessToken))
        }),
      )
    }

    // Audience (best-effort — requires 100+ followers)
    const audience = await meta.getIGAudienceInsights(igBiz.igBusinessId, accessToken).catch(() => null)

    // Map to IgStub
    const stub = mapMetaToStub({ profile, media, mediaInsights: insightsMap, audience })

    // Persist to InstagramConnection
    const payload = {
      handle: stub.username,
      profileUrl: stub.profileUrl,
      accountType: stub.accountType,
      bio: stub.bio,
      followerCount: stub.followerCount,
      followingCount: stub.followingCount,
      postCount: stub.postCount,
      engagementRate: stub.engagementRate,
      avgReach: stub.avgReach,
      avgImpressions: stub.avgImpressions,
      topPosts: stub.topPosts as unknown as object,
      recentMedia: stub.recentMedia as unknown as object,
      followerSeries: stub.followerSeries as unknown as object,
      audienceAge: stub.audienceAge as unknown as object,
      audienceGender: stub.audienceGender as unknown as object,
      audienceTop: stub.audienceTopCountries as unknown as object,
      audienceCities: stub.audienceTopCities as unknown as object,
      igUserId: stub.igUserId,
      igBusinessId: igBiz.igBusinessId,
      pageId: igBiz.pageId,
      accessToken,
      tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
      platform: 'instagram',
      source: 'meta',
      lastSyncedAt: new Date(),
    }

    const connection = await prisma.instagramConnection.upsert({
      where: { companyId },
      update: { ...payload, connectedAt: new Date() },
      create: { companyId, ...payload },
    })

    // Also write to Platform* tables
    try {
      const company = await prisma.company.findUnique({ where: { id: companyId }, select: { userId: true } })
      if (company) {
        // Build a fake PhylloAccount shape for persistPhylloSync
        await persistPhylloSync(prisma, companyId, '', {
          id: igBiz.igBusinessId,
          user: { id: '' },
          work_platform: { id: '', name: 'Instagram' },
          platform_username: stub.username,
          profile_pic_url: profile.profile_picture_url,
          status: 'CONNECTED',
        }, stub)
      }
    } catch (e) {
      console.warn('[instagram] platform-snapshot write failed', e)
    }

    // Brand memory + notification
    try {
      const company = await prisma.company.findUnique({ where: { id: companyId }, select: { userId: true } })
      if (company) {
        const topPost = stub.topPosts[0]
        await writeMemory(prisma, {
          companyId,
          type: 'performance',
          weight: 1.4,
          content: {
            source: 'instagram',
            summary: `Instagram @${stub.username}: ${stub.followerCount.toLocaleString()} followers, ${stub.engagementRate}% engagement. Top post: "${(topPost?.caption || '').slice(0, 80)}" (${topPost?.like_count ?? 0} likes).`,
            tags: ['instagram', 'analytics'],
          },
        })
        await createNotification({
          userId: company.userId,
          companyId,
          type: 'team_update',
          emoji: '✅',
          title: `Instagram @${stub.username} connected`,
          body: `${stub.followerCount.toLocaleString()} followers · ${stub.engagementRate}% engagement. Your team is now working from real numbers.`,
          metadata: {},
        })
      }
    } catch (e) {
      console.warn('[instagram] memory/notification failed', e)
    }

    // Fire-and-forget: plan-gated features
    const ownerForPlan = await prisma.company.findUnique({ where: { id: companyId }, include: { user: { select: { plan: true } } } })
    const plan = PLAN_LIMITS[ownerForPlan?.user.plan ?? 'starter']
    if (plan.nicheDetection) {
      void detectNicheFromContent(prisma, companyId).catch(() => {})
    }
    if (plan.proactiveAnalysis) {
      void triggerFirstConnectBatch(prisma, companyId).catch(() => {})
    }

    console.log('[instagram] connection saved', { companyId, handle: stub.username, followers: stub.followerCount, posts: stub.postCount })

    if (companyId) {
      res.redirect(`${appUrl()}/?instagramConnected=1`)
    } else {
      res.type('html').send(`<h1>Instagram connected!</h1><p>@${stub.username} — ${stub.followerCount} followers</p>`)
    }
  } catch (err) {
    console.error('[instagram] callback error', err)
    res.status(500).type('html').send(`<h1>Connection failed</h1><p>${(err as Error).message}</p>`)
  }
})

// ── Insights (dashboard read path — unchanged) ──────────────────────

router.get('/insights', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const companyId = (req.query.companyId as string | undefined) ?? ''
    const company = await prisma.company.findFirst({
      where: { id: companyId, userId },
      include: { instagram: true },
    })
    if (!company) {
      res.status(404).json({ error: 'company_not_found' })
      return
    }
    res.json({ connection: company.instagram })
  } catch (err) {
    next(err)
  }
})

// ── Sync (refresh data using stored token) ──────────────────────────

router.post('/sync', requireAuth, async (req, res) => {
  const { userId } = (req as AuthedRequest).session
  const companyId = typeof req.body?.companyId === 'string' ? req.body.companyId : ''
  if (!companyId) { res.status(400).json({ error: 'missing_company_id' }); return }
  const company = await prisma.company.findFirst({ where: { id: companyId, userId }, include: { user: { select: { plan: true } } } })
  if (!company) { res.status(404).json({ error: 'company_not_found' }); return }
  const plan = PLAN_LIMITS[company.user.plan]
  if (!plan.syncOnLogin) { res.json({ synced: false, reason: 'plan_locked' }); return }

  try {
    const { syncInstagramAccount } = await import('../lib/instagramSync')
    const result = await syncInstagramAccount(prisma, companyId)
    res.json(result)
  } catch (err) {
    console.warn('[instagram] sync error', err)
    res.status(500).json({ synced: false, error: 'sync_failed' })
  }
})

// ── Disconnect ──────────────────────────────────────────────────────

router.delete('/', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const company = await prisma.company.findFirst({ where: { userId }, include: { instagram: true } })
    if (!company?.instagram) {
      res.status(404).json({ error: 'no_instagram_connection' })
      return
    }
    await prisma.instagramConnection.delete({ where: { companyId: company.id } })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
