/**
 * Writes TikTok Login Kit handshake output into the generalized
 * PlatformAccount / PlatformSnapshot / PlatformPost tables so the
 * dashboard trajectory charts and Maya's runWatch drop-detection
 * see TikTok data alongside Phyllo-synced Instagram.
 *
 * The legacy TiktokConnection row is still written by routes/tiktok.ts
 * for backward compatibility with the current dashboard read path.
 *
 * Mirrors platformSync.persistPhylloSync — same UTC-day snapshot
 * dedupe, same per-post upsert via (accountId, platformPostId).
 * TikTok Login Kit does not return demographics, so we skip
 * PlatformAudience entirely.
 */

import { PrismaClient } from '@prisma/client'
import { runWatch } from './metricsWatch'

export interface TiktokSnapshotVideo {
  id: string
  caption: string
  url: string | null
  thumbnailUrl: string | null
  publishedAt: Date | null
  viewCount: number
  likeCount: number
  commentCount: number
  shareCount: number
}

export interface TiktokSnapshotInput {
  companyId: string
  userId: string
  openId: string
  // Handle without leading @, to match Phyllo convention in PlatformAccount.
  handle: string
  displayName: string | null
  bio: string | null
  profileUrl: string | null
  avatarUrl: string | null
  isVerified: boolean
  followerCount: number
  followingCount: number
  postCount: number
  avgViews: number
  engagementRate: number
  videos: TiktokSnapshotVideo[]
}

export interface TiktokSnapshotResult {
  accountId: string
  sparse: boolean
}

export async function persistTiktokSnapshot(
  prisma: PrismaClient,
  input: TiktokSnapshotInput,
): Promise<TiktokSnapshotResult> {
  const sparse = input.followerCount === 0 && input.videos.length === 0

  // 1. Upsert the account identity. Keyed on (companyId, platform, handle)
  //    so a reconnect under the same username hits the existing row.
  const account = await prisma.platformAccount.upsert({
    where: {
      companyId_platform_handle: {
        companyId: input.companyId,
        platform: 'tiktok',
        handle: input.handle,
      },
    },
    update: {
      displayName: input.displayName,
      profileUrl: input.profileUrl,
      profileImageUrl: input.avatarUrl,
      bio: input.bio,
      accountType: 'CREATOR',
      status: 'connected',
      lastSyncedAt: new Date(),
    },
    create: {
      companyId: input.companyId,
      platform: 'tiktok',
      platformUserId: input.openId,
      handle: input.handle,
      displayName: input.displayName,
      profileUrl: input.profileUrl,
      profileImageUrl: input.avatarUrl,
      bio: input.bio,
      accountType: 'CREATOR',
      status: 'connected',
    },
  })

  // 2. Append a snapshot — dedupe by UTC day so rapid reconnects don't
  //    pile identical rows, and never overwrite real prior data with
  //    a sparse handshake (same guard as persistPhylloSync).
  if (!sparse) {
    const dayStart = new Date()
    dayStart.setUTCHours(0, 0, 0, 0)
    const dayEnd = new Date(dayStart)
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1)

    const existingToday = await prisma.platformSnapshot.findFirst({
      where: {
        accountId: account.id,
        capturedAt: { gte: dayStart, lt: dayEnd },
      },
      orderBy: { capturedAt: 'desc' },
    })
    if (existingToday) {
      const newIsBetter =
        input.followerCount > 0 || input.avgViews > 0 || input.engagementRate > 0
      if (newIsBetter) {
        await prisma.platformSnapshot.update({
          where: { id: existingToday.id },
          data: {
            followerCount: input.followerCount,
            followingCount: input.followingCount,
            postCount: input.postCount,
            avgReach: input.avgViews,
            avgImpressions: input.avgViews,
            engagementRate: input.engagementRate,
            capturedAt: new Date(),
          },
        })
      }
    } else {
      await prisma.platformSnapshot.create({
        data: {
          accountId: account.id,
          followerCount: input.followerCount,
          followingCount: input.followingCount,
          postCount: input.postCount,
          avgReach: input.avgViews,
          avgImpressions: input.avgViews,
          engagementRate: input.engagementRate,
        },
      })
    }
  }

  // 3. Upsert each video. TikTok conflates views/reach/impressions so we
  //    fan the view_count into all three columns; dashboard charts read
  //    whichever is present.
  for (const v of input.videos) {
    await prisma.platformPost.upsert({
      where: {
        accountId_platformPostId: {
          accountId: account.id,
          platformPostId: v.id,
        },
      },
      update: {
        caption: v.caption,
        mediaType: 'VIDEO',
        url: v.url,
        thumbnailUrl: v.thumbnailUrl,
        publishedAt: v.publishedAt,
        likeCount: v.likeCount,
        commentCount: v.commentCount,
        shareCount: v.shareCount,
        viewCount: v.viewCount,
        reachCount: v.viewCount,
        impressionCount: v.viewCount,
        lastSyncedAt: new Date(),
      },
      create: {
        accountId: account.id,
        platformPostId: v.id,
        caption: v.caption,
        mediaType: 'VIDEO',
        url: v.url,
        thumbnailUrl: v.thumbnailUrl,
        publishedAt: v.publishedAt,
        likeCount: v.likeCount,
        commentCount: v.commentCount,
        shareCount: v.shareCount,
        viewCount: v.viewCount,
        reachCount: v.viewCount,
        impressionCount: v.viewCount,
      },
    })
    // Capture metric snapshot for delta tracking
    const { capturePostMetrics } = await import('./metricTracking')
    const upserted = await prisma.platformPost.findFirst({
      where: { accountId: account.id, platformPostId: v.id },
      select: { id: true },
    })
    if (upserted) await capturePostMetrics(prisma, upserted.id).catch(() => {})
  }

  // Compute weekly summary after all posts synced
  const { computeWeeklySummary } = await import('./metricTracking')
  await computeWeeklySummary(prisma, account.id).catch((e) => console.warn('[tiktokSync] weekly summary failed:', e))

  // Compute all derived metrics (post-level, snapshot rollups, weekly extensions)
  const { computeAllDerivedMetrics } = await import('./derivedMetrics')
  await computeAllDerivedMetrics(prisma, account.id).catch((e) => console.warn('[tiktokSync] derived metrics failed:', e))

  // 4. Maya's drop-detection. On the very first snapshot this no-ops
  //    (needs history to compute a delta), but wiring it here means the
  //    day scheduled sync lands for TikTok, alerts start flowing with
  //    no further route changes.
  if (!sparse) {
    try {
      await runWatch(prisma, {
        userId: input.userId,
        companyId: input.companyId,
        accountId: account.id,
        handle: input.handle,
      })
    } catch (e) {
      console.warn('[tiktokSync] runWatch failed', e)
    }
  }

  return { accountId: account.id, sparse }
}
