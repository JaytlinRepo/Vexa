/**
 * Instagram data refresh via direct Meta Graph API.
 * Mirrors tiktokRefreshSync.ts pattern — refresh token if needed,
 * re-pull profile + media + insights, persist to InstagramConnection
 * + Platform* tables.
 */

import { PrismaClient } from '@prisma/client'
import * as meta from './metaGraph'
import { mapMetaToStub } from './metaMapper'
import { persistSnapshotAndPosts } from './platformSync'

const THROTTLE_MS = 5 * 60 * 1000
const TOKEN_REFRESH_BUFFER_MS = 7 * 24 * 60 * 60 * 1000 // refresh 7 days before expiry

export async function syncInstagramAccount(
  prisma: PrismaClient,
  companyId: string,
): Promise<{ synced: boolean; newPosts: number; reason?: string }> {
  const conn = await prisma.instagramConnection.findUnique({ where: { companyId } })
  if (!conn || !conn.accessToken) {
    return { synced: false, newPosts: 0, reason: conn ? 'no_token' : 'no_connection' }
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
    // Fetch profile + media + account insights + stories in parallel
    const [profile, media, accountInsights, liveStories] = await Promise.all([
      meta.getIGProfile(igId, token),
      meta.getIGMedia(igId, token, 30),
      meta.getIGAccountInsights(igId, token).catch(() => null),
      meta.getIGStories(igId, token).catch(() => [] as meta.IGStory[]),
    ])

    // Per-post insights (best-effort)
    const insightsMap = new Map<string, meta.IGMediaInsight>()
    await Promise.allSettled(
      media.slice(0, 20).map(async (m) => {
        insightsMap.set(m.id, await meta.getMediaInsights(m.id, m.media_type, token))
      }),
    )

    // Story insights (best-effort, parallel)
    const storyData: Array<{ story: meta.IGStory; insights: meta.IGStoryInsight }> = []
    if (liveStories.length > 0) {
      await Promise.allSettled(
        liveStories.map(async (s) => {
          const insights = await meta.getStoryInsights(s.id, token)
          storyData.push({ story: s, insights })
        }),
      )
    }

    // Audience
    const audience = await meta.getIGAudienceInsights(igId, token).catch(() => null)

    // Carousel thumbnails: fetch first child's media_url for slideshow posts
    const carouselThumbnails = new Map<string, string>()
    const carousels = media.filter((m) => m.media_type === 'CAROUSEL_ALBUM' && !m.thumbnail_url && !m.media_url)
    if (carousels.length > 0) {
      await Promise.allSettled(
        carousels.map(async (m) => {
          const children = await meta.getCarouselChildren(m.id, token)
          const firstImage = children.find((c) => c.media_url)
          if (firstImage?.media_url) carouselThumbnails.set(m.id, firstImage.media_url)
        }),
      )
    }

    // Map + persist
    const stub = mapMetaToStub({ profile, media, mediaInsights: insightsMap, audience, accountInsights, stories: storyData, carouselThumbnails })

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
        lastSyncedAt: new Date(),
      },
    })

    // Update Platform* tables (upsert account + snapshot/posts)
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
      await persistSnapshotAndPosts(prisma, acct.id, stub)
    } catch (e) {
      console.warn('[ig-sync] platform-account write failed', e)
    }

    // Refresh metrics for ALL known posts (not just the latest 30)
    // Fetches fresh insights from Meta for each post in the DB
    try {
      const igAccount = await prisma.platformAccount.findFirst({
        where: { companyId, platform: 'instagram' },
      })
      if (igAccount) {
        const allPosts = await prisma.platformPost.findMany({
          where: { accountId: igAccount.id },
          select: { id: true, platformPostId: true, mediaType: true },
          orderBy: { publishedAt: 'desc' },
          take: 50, // cap to avoid API rate limits
        })
        if (allPosts.length > 0) {
          console.log(`[ig-sync] refreshing insights for ${allPosts.length} posts`)
          let updated = 0
          await Promise.allSettled(
            allPosts.map(async (post) => {
              try {
                const insights = await meta.getMediaInsights(post.platformPostId, post.mediaType as 'VIDEO' | 'IMAGE' | 'CAROUSEL_ALBUM', token)
                if (insights.reach > 0 || insights.impressions > 0 || insights.saved > 0) {
                  // Use the larger of reach/impressions, and floor at likeCount
                  // (a post can't have fewer views than likes)
                  const currentPost = await prisma.platformPost.findUnique({ where: { id: post.id }, select: { likeCount: true, commentCount: true, saveCount: true, shareCount: true } })
                  const likes = currentPost?.likeCount || 0
                  const reach = Math.max(insights.reach, insights.impressions, likes)
                  const shares = insights.shares || currentPost?.shareCount || 0
                  const totalEng = likes + (currentPost?.commentCount || 0) + (insights.saved || currentPost?.saveCount || 0) + shares
                  const engRate = reach > 0 ? Math.min(1, totalEng / reach) : 0

                  // Compute retention for Reels: avgWatchTime / videoDuration
                  const avgWatchMs = insights.avgWatchTimeMs || 0
                  // Look up video duration from the media we already fetched
                  const mediaItem = media.find(m => m.id === post.platformPostId)
                  const durationSec = mediaItem?.video_duration || 0
                  const retentionRate = (avgWatchMs > 0 && durationSec > 0)
                    ? Math.min(1, (avgWatchMs / 1000) / durationSec)
                    : 0

                  await prisma.platformPost.update({
                    where: { id: post.id },
                    data: {
                      reachCount: reach,
                      impressionCount: Math.max(insights.impressions, reach),
                      viewCount: reach,
                      saveCount: insights.saved || currentPost?.saveCount || 0,
                      shareCount: shares,
                      engagementRate: engRate,
                      avgWatchTimeMs: avgWatchMs,
                      retentionRate,
                      lastSyncedAt: new Date(),
                    },
                  })
                  updated++
                }
              } catch {}
            }),
          )
          if (updated > 0) console.log(`[ig-sync] updated insights for ${updated}/${allPosts.length} posts`)
        }
      }
    } catch (e) {
      console.warn('[ig-sync] backfill failed', e)
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
