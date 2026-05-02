import { Router } from 'express'
import crypto from 'crypto'
import { oauthSuccessPage } from '../lib/oauthSuccess'
import { requireAuth, AuthedRequest, readSession, createSession } from '../middleware/auth'
import { readPendingSignup, clearPendingSignup } from './auth'
import { storePendingByNonce, getPendingByNonce, deletePendingByNonce } from '../lib/pendingSignupStore'
import * as meta from '../lib/metaGraph'
import type { IGStory, IGStoryInsight } from '../lib/metaGraph'
import { mapMetaToStub } from '../lib/metaMapper'
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

router.get('/auth/start', async (req, res) => {
  const uri = redirectUri()
  const fbAppId = (process.env.FACEBOOK_APP_ID || '').trim()
  if (!fbAppId || !uri) {
    res.status(500).type('html').send('<h1>Missing FACEBOOK_APP_ID or INSTAGRAM_REDIRECT_URI</h1>')
    return
  }

  const session = await readSession(req)
  const pending = !session ? await readPendingSignup(req) : null

  if (!session && !pending) {
    res.status(401).type('html').send('<h1>Not authenticated</h1>')
    return
  }

  let companyId = ''
  if (session) {
    // Authenticated: validate companyId ownership to prevent IDOR.
    const { userId } = session
    const rawId = typeof req.query.companyId === 'string' ? req.query.companyId : ''
    const company = rawId
      ? await prisma.company.findFirst({ where: { id: rawId, userId }, select: { id: true } })
      : await prisma.company.findFirst({ where: { userId }, select: { id: true } })
    companyId = company?.id ?? ''
  }
  // Pending signup: companyId stays '' — user+company created atomically at callback.

  const nonce = crypto.randomBytes(16).toString('hex')
  const state = encodeState({ n: nonce, c: companyId, ts: Date.now() })

  // For pending signups: cookies won't survive the cross-site OAuth redirect
  // (SameSite=Lax blocks them). Store pending data server-side by nonce now,
  // while cookies are still accessible through the Next.js proxy.
  if (!session && pending) {
    storePendingByNonce(nonce, pending)
    console.log('[instagram] stored pending signup by nonce for', pending.email)
  }

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
  let companyId = decoded.c

  // Pending signup path: companyId is empty — create user+company atomically now.
  if (!companyId) {
    // Look up by nonce (stored at /auth/start time, survives cross-site redirect).
    // Fall back to cookie for same-origin flows.
    const pending = getPendingByNonce(decoded.n) ?? await readPendingSignup(req)
    console.log('[instagram] pending data:', pending ? `email=${pending.email} company=${pending.companyName} niche=${pending.niche}` : 'null')
    if (!pending?.companyName || !pending?.niche) {
      res.status(400).type('html').send('<h1>Signup session expired</h1><p>Please sign up again.</p>')
      return
    }
    const EMPLOYEE_SEED = [
      { role: 'analyst' as const, name: 'Maya' },
      { role: 'strategist' as const, name: 'Jordan' },
      { role: 'copywriter' as const, name: 'Alex' },
      { role: 'creative_director' as const, name: 'Riley' },
    ]
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: pending.email, username: pending.username, passwordHash: pending.passwordHash, fullName: pending.fullName ?? null },
        select: { id: true, email: true },
      })
      const company = await tx.company.create({
        data: { userId: user.id, name: pending.companyName!, niche: pending.niche!, employees: { create: EMPLOYEE_SEED } },
        select: { id: true },
      })
      return { user, company }
    })
    companyId = created.company.id
    clearPendingSignup(res)
    deletePendingByNonce(decoded.n)
    await createSession(res, { userId: created.user.id, email: created.user.email })
    // Seed tasks + welcome notification fire-and-forget
    const { seedStarterTasks } = await import('../lib/seedStarterTasks')
    seedStarterTasks(prisma, { companyId, niche: pending.niche! }).catch(() => {})
  }

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

    // Fetch media + account insights + stories in parallel
    const [media, accountInsights, liveStories] = await Promise.all([
      meta.getIGMedia(igBiz.igBusinessId, accessToken, 30).catch((err) => {
        console.warn('[instagram] media fetch failed (continuing without posts):', err.message)
        return [] as meta.IGMedia[]
      }),
      meta.getIGAccountInsights(igBiz.igBusinessId, accessToken).catch(() => null),
      meta.getIGStories(igBiz.igBusinessId, accessToken).catch(() => [] as meta.IGStory[]),
    ])
    console.log('[instagram] media fetched:', media.length, 'posts')
    if (accountInsights) console.log('[instagram] account insights:', accountInsights.profileViews, 'profile views,', accountInsights.websiteClicks, 'website clicks (28d)')
    if (liveStories.length > 0) console.log('[instagram] live stories:', liveStories.length)

    // Fetch per-post insights (best-effort, parallel, cap at 20)
    const insightsMap = new Map<string, meta.IGMediaInsight>()
    if (media.length > 0) {
      await Promise.allSettled(
        media.slice(0, 20).map(async (m) => {
          insightsMap.set(m.id, await meta.getMediaInsights(m.id, m.media_type, accessToken))
        }),
      )
    }

    // Story insights (best-effort)
    const storyData: Array<{ story: meta.IGStory; insights: meta.IGStoryInsight }> = []
    if (liveStories.length > 0) {
      await Promise.allSettled(
        liveStories.map(async (s) => {
          const insights = await meta.getStoryInsights(s.id, accessToken)
          storyData.push({ story: s, insights })
        }),
      )
    }

    // Audience (best-effort — requires 100+ followers)
    const audience = await meta.getIGAudienceInsights(igBiz.igBusinessId, accessToken).catch(() => null)

    // Carousel thumbnails: fetch first child's media_url for slideshow posts
    const carouselThumbnails = new Map<string, string>()
    const carousels = media.filter((m) => m.media_type === 'CAROUSEL_ALBUM' && !m.thumbnail_url && !m.media_url)
    if (carousels.length > 0) {
      await Promise.allSettled(
        carousels.map(async (m) => {
          const children = await meta.getCarouselChildren(m.id, accessToken)
          const firstImage = children.find((c) => c.media_url)
          if (firstImage?.media_url) carouselThumbnails.set(m.id, firstImage.media_url)
        }),
      )
    }

    // Map to IgStub
    const stub = mapMetaToStub({ profile, media, mediaInsights: insightsMap, audience, accountInsights, stories: storyData, carouselThumbnails })

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
      profileViews: stub.profileViews,
      websiteClicks: stub.websiteClicks,
      dailyProfileViews: stub.dailyProfileViews as unknown as object,
      dailyWebsiteClicks: stub.dailyWebsiteClicks as unknown as object,
      topPosts: stub.topPosts as unknown as object,
      recentMedia: stub.recentMedia as unknown as object,
      stories: stub.stories as unknown as object,
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

    // Also write to Platform* tables (direct upsert by compound unique
    // instead of persistPhylloSync, which keys on phylloAccountId and
    // fails when an older row exists with a different ID).
    try {
      const acct = await prisma.platformAccount.upsert({
        where: {
          companyId_platform_handle: {
            companyId,
            platform: 'instagram',
            handle: stub.username,
          },
        },
        update: {
          displayName: stub.username,
          profileUrl: stub.profileUrl,
          profileImageUrl: profile.profile_picture_url,
          bio: stub.bio,
          accountType: stub.accountType,
          platformUserId: stub.igUserId || null,
          status: 'connected',
          lastSyncedAt: new Date(),
        },
        create: {
          companyId,
          platform: 'instagram',
          platformUserId: stub.igUserId || null,
          handle: stub.username,
          displayName: stub.username,
          profileUrl: stub.profileUrl,
          profileImageUrl: profile.profile_picture_url,
          bio: stub.bio,
          accountType: stub.accountType,
          status: 'connected',
        },
      })

      // Write a snapshot + posts via persistPhylloSync's post-upsert logic
      const { persistSnapshotAndPosts, backfillIGDailySnapshots } = await import('../lib/platformSync')
      await persistSnapshotAndPosts(prisma, acct.id, stub).catch((e: unknown) =>
        console.warn('[instagram] snapshot/posts write failed', e),
      )

      // Backfill ~30 days of daily snapshots so the trend chart populates
      // immediately on first connect / login instead of waiting for fresh data.
      try {
        const { getIGAccountHistory } = await import('../lib/metaGraph')
        const igUserId = stub.igUserId
        if (igUserId) {
          const history = await getIGAccountHistory(igUserId, accessToken, 30)
          if (history.length > 0) {
            await backfillIGDailySnapshots(prisma, acct.id, history, stub.followerCount)
            console.log('[instagram] backfilled', history.length, 'daily snapshots')
          }
        }
      } catch (e) {
        console.warn('[instagram] daily history backfill failed:', (e as Error).message)
      }
    } catch (e) {
      console.warn('[instagram] platform-account write failed', e)
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
    const plan = PLAN_LIMITS[ownerForPlan?.user.plan ?? 'free']
    if (plan.nicheDetection) {
      void detectNicheFromContent(prisma, companyId).catch(() => {})
    }
    if (plan.proactiveAnalysis) {
      void triggerFirstConnectBatch(prisma, companyId).catch(() => {})
    }
    // Heuristic content tags so the Content-mix tile populates immediately
    // (Bedrock-based tagger is rate-limited; this fills the gap for free tier).
    void (async () => {
      try {
        const { heuristicTagAllPosts } = await import('../lib/heuristicTagger')
        const n = await heuristicTagAllPosts(prisma, companyId)
        if (n > 0) console.log('[instagram] heuristic-tagged', n, 'posts')
      } catch (e) {
        console.warn('[instagram] heuristic tagging failed:', (e as Error).message?.slice(0, 120))
      }
    })()

    // Maya's daily playbook — runs once on first connect for every plan,
    // including free, so the dashboard's playbook tile populates immediately
    // instead of staying empty until the scheduled daily run.
    void (async () => {
      try {
        const { generateMayaPlaybook } = await import('../lib/metricTracking')
        await generateMayaPlaybook(prisma, companyId)
      } catch (e) {
        console.warn('[instagram] first-connect Maya playbook failed:', (e as Error).message?.slice(0, 120))
      }
    })()

    // Jordan picks an opening goal so the dashboard's goal tile shows a
    // concrete target on first dashboard load instead of an empty state.
    void (async () => {
      try {
        const fresh = await prisma.company.findUnique({ where: { id: companyId }, select: { goals: true } })
        const existing = (fresh?.goals as { active?: unknown } | null) || {}
        if (existing.active) return
        const { generateJordanGoal } = await import('./company')
        const result = await generateJordanGoal(prisma, companyId)
        if (result) {
          await prisma.company.update({
            where: { id: companyId },
            data: { goals: { ...existing, active: result.goal } as unknown as object },
          })
          console.log('[instagram] Jordan opening goal set:', result.goal.type, '→', result.goal.target)
        }
      } catch (e) {
        console.warn('[instagram] first-connect Jordan goal failed:', (e as Error).message?.slice(0, 120))
      }
    })()

    console.log('[instagram] connection saved', { companyId, handle: stub.username, followers: stub.followerCount, posts: stub.postCount })

    res.type('html').send(oauthSuccessPage(companyId ? `${appUrl()}/?instagramConnected=1` : null))
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

  // One-time history backfill bypasses the plan gate so the trend chart
  // populates on first login even for free users. Uses < 5 snapshots as
  // the "needs bootstrap" signal.
  if (!plan.syncOnLogin) {
    try {
      const acct = await prisma.platformAccount.findFirst({
        where: { companyId, platform: 'instagram' },
        select: { id: true },
      })
      if (acct) {
        const snapshotCount = await prisma.platformSnapshot.count({ where: { accountId: acct.id } })
        if (snapshotCount < 5) {
          const conn = await prisma.instagramConnection.findUnique({ where: { companyId } })
          const igUserId = conn?.igBusinessId || conn?.igUserId
          if (conn?.accessToken && igUserId) {
            const { getIGAccountHistory, getIGProfile } = await import('../lib/metaGraph')
            const { backfillIGDailySnapshots } = await import('../lib/platformSync')
            const profile = await getIGProfile(igUserId, conn.accessToken).catch(() => null)
            const followers = profile?.followers_count ?? conn.followerCount ?? 0
            const history = await getIGAccountHistory(igUserId, conn.accessToken, 30)
            if (history.length > 0) {
              await backfillIGDailySnapshots(prisma, acct.id, history, followers)
              console.log('[instagram] login bootstrap: backfilled', history.length, 'daily snapshots')
            }
            // Heuristic-tag any posts missing communityTags so the Content-mix
            // tile populates regardless of the throttled Bedrock tagger.
            try {
              const { heuristicTagAllPosts } = await import('../lib/heuristicTagger')
              const tagged = await heuristicTagAllPosts(prisma, companyId)
              if (tagged > 0) console.log('[instagram] bootstrap heuristic-tagged', tagged, 'posts')
            } catch (e) {
              console.warn('[instagram] bootstrap heuristic tagging failed:', (e as Error).message?.slice(0, 120))
            }
            // Generate Maya's playbook if it doesn't exist yet
            const existingPb = await prisma.brandMemory.findFirst({
              where: { companyId, content: { path: ['tags'], array_contains: 'maya_playbook' } },
              select: { id: true },
            })
            if (!existingPb) {
              const { generateMayaPlaybook } = await import('../lib/metricTracking')
              generateMayaPlaybook(prisma, companyId).catch((e: unknown) =>
                console.warn('[instagram] bootstrap Maya playbook failed:', (e as Error).message?.slice(0, 120)),
              )
            }
            // Set Jordan's opening goal if none exists yet
            const existingGoal = (company.goals as { active?: unknown } | null) || {}
            if (!existingGoal.active) {
              try {
                const { generateJordanGoal } = await import('./company')
                const goalResult = await generateJordanGoal(prisma, companyId)
                if (goalResult) {
                  await prisma.company.update({
                    where: { id: companyId },
                    data: { goals: { ...existingGoal, active: goalResult.goal } as unknown as object },
                  })
                  console.log('[instagram] bootstrap Jordan goal set:', goalResult.goal.type, '→', goalResult.goal.target)
                }
              } catch (e) {
                console.warn('[instagram] bootstrap Jordan goal failed:', (e as Error).message?.slice(0, 120))
              }
            }
            res.json({ synced: true, bootstrap: true, days: history.length })
            return
          }
        }
      }
    } catch (e) {
      console.warn('[instagram] login bootstrap failed:', (e as Error).message)
    }
    res.json({ synced: false, reason: 'plan_locked' })
    return
  }

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
