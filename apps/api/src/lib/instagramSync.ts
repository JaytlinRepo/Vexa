/**
 * Instagram data refresh via direct Meta Graph API.
 * Mirrors tiktokRefreshSync.ts pattern — refresh token if needed,
 * re-pull profile + media + insights, persist to InstagramConnection
 * + Platform* tables.
 */

import { PrismaClient } from '@prisma/client'
import * as meta from './metaGraph'
import { mapMetaToStub } from './metaMapper'
import { persistPhylloSync } from './platformSync'

const THROTTLE_MS = 5 * 60 * 1000
const TOKEN_REFRESH_BUFFER_MS = 7 * 24 * 60 * 60 * 1000 // refresh 7 days before expiry

export async function syncInstagramAccount(
  prisma: PrismaClient,
  companyId: string,
): Promise<{ synced: boolean; newPosts: number; reason?: string }> {
  const conn = await prisma.instagramConnection.findUnique({ where: { companyId } })
  if (!conn || !conn.accessToken || conn.source !== 'meta') {
    return { synced: false, newPosts: 0, reason: conn ? 'not_meta_source' : 'no_connection' }
  }

  // Throttle
  if (conn.lastSyncedAt && Date.now() - conn.lastSyncedAt.getTime() < THROTTLE_MS) {
    return { synced: false, newPosts: 0, reason: 'throttled' }
  }

  let token = conn.accessToken

  // Refresh token if within 7 days of expiry
  if (conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() - Date.now() < TOKEN_REFRESH_BUFFER_MS) {
    try {
      console.log('[ig-sync] refreshing long-lived token for company', companyId)
      const refreshed = await meta.refreshLongLivedToken(token)
      token = refreshed.accessToken
      await prisma.instagramConnection.update({
        where: { companyId },
        data: {
          accessToken: refreshed.accessToken,
          tokenExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
        },
      })
    } catch (err) {
      console.warn('[ig-sync] token refresh failed', err)
      return { synced: false, newPosts: 0, reason: 'token_refresh_failed' }
    }
  }

  const igId = conn.igBusinessId || conn.igUserId
  if (!igId) return { synced: false, newPosts: 0, reason: 'no_ig_business_id' }

  try {
    // Fetch profile + media in parallel
    const [profile, media] = await Promise.all([
      meta.getIGProfile(igId, token),
      meta.getIGMedia(igId, token, 30),
    ])

    // Per-post insights (best-effort)
    const insightsMap = new Map<string, meta.IGMediaInsight>()
    await Promise.allSettled(
      media.slice(0, 20).map(async (m) => {
        insightsMap.set(m.id, await meta.getMediaInsights(m.id, token))
      }),
    )

    // Audience
    const audience = await meta.getIGAudienceInsights(igId, token).catch(() => null)

    // Map + persist
    const stub = mapMetaToStub({ profile, media, mediaInsights: insightsMap, audience })

    // Count posts before
    const platformAccount = await prisma.platformAccount.findFirst({
      where: { companyId, platform: 'instagram' },
    })
    const postsBefore = platformAccount
      ? await prisma.platformPost.count({ where: { accountId: platformAccount.id } })
      : 0

    // Update InstagramConnection
    await prisma.instagramConnection.update({
      where: { companyId },
      data: {
        handle: stub.username,
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
        lastSyncedAt: new Date(),
      },
    })

    // Update Platform* tables
    try {
      await persistPhylloSync(prisma, companyId, '', {
        id: igId,
        user: { id: '' },
        work_platform: { id: '', name: 'Instagram' },
        platform_username: stub.username,
        profile_pic_url: profile.profile_picture_url,
        status: 'CONNECTED',
      }, stub)
    } catch (e) {
      console.warn('[ig-sync] platform-snapshot write failed', e)
    }

    // Count new posts
    const updatedAccount = await prisma.platformAccount.findFirst({
      where: { companyId, platform: 'instagram' },
    })
    const postsAfter = updatedAccount
      ? await prisma.platformPost.count({ where: { accountId: updatedAccount.id } })
      : 0
    const newPosts = Math.max(0, postsAfter - postsBefore)

    return { synced: true, newPosts }
  } catch (err) {
    console.warn('[ig-sync] sync failed', err)
    return { synced: false, newPosts: 0, reason: 'api_error' }
  }
}
