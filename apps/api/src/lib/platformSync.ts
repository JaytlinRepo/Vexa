/**
 * Writes Phyllo sync output into the generalized PlatformAccount /
 * PlatformSnapshot / PlatformPost / PlatformAudience tables.
 *
 * Privacy & tenancy:
 *  - Every write is scoped to a companyId, and Company is scoped to userId
 *    via onDelete: Cascade at the schema level. When a user deletes their
 *    account, every row in every table below is removed.
 *  - Nothing sensitive about the underlying OAuth grant is stored locally.
 *    Phyllo holds the Instagram access token; we only store their opaque
 *    account reference (phylloAccountId).
 *  - Profile fields we persist (handle, bio, profile image URL) are all
 *    data the user exposes publicly on Instagram. Audience stats are
 *    aggregated (never per-follower) and tied to the creator's account.
 */

import { PrismaClient, SocialPlatform } from '@prisma/client'
import type { IgStub } from './instagramStub'
/** @deprecated — only used by the legacy persistPhylloSync function */
interface PhylloAccount {
  id: string
  user: { id: string }
  work_platform?: { id: string; name: string }
  platform_username?: string
  profile_pic_url?: string
  status: string
}

function mapPlatformName(name: string | undefined): SocialPlatform {
  const n = (name || '').toLowerCase()
  if (n.includes('instagram')) return 'instagram'
  if (n === 'tiktok' || n.includes('tik')) return 'tiktok'
  if (n === 'youtube') return 'youtube'
  if (n === 'x' || n === 'twitter') return 'twitter_x'
  if (n === 'facebook') return 'facebook'
  if (n === 'twitch') return 'twitch'
  if (n === 'substack') return 'substack'
  if (n === 'snapchat') return 'snapchat'
  if (n === 'linkedin') return 'linkedin'
  if (n === 'pinterest') return 'pinterest'
  return 'other'
}

export async function persistPhylloSync(
  prisma: PrismaClient,
  companyId: string,
  phylloUserId: string,
  account: PhylloAccount,
  stub: IgStub,
  opts: { sparse?: boolean } = {},
): Promise<{ accountId: string }> {
  const platform = mapPlatformName(account.work_platform?.name)
  const handle = stub.username || account.platform_username || 'unknown'

  // 1. Upsert the account identity
  const platformAccount = await prisma.platformAccount.upsert({
    where: { phylloAccountId: account.id },
    update: {
      handle,
      displayName: stub.username,
      profileUrl: stub.profileUrl,
      profileImageUrl: account.profile_pic_url,
      bio: stub.bio,
      accountType: stub.accountType,
      status: account.status === 'CONNECTED' ? 'connected' : 'disconnected',
      lastSyncedAt: new Date(),
    },
    create: {
      companyId,
      platform,
      platformUserId: stub.igUserId || null,
      handle,
      displayName: stub.username,
      profileUrl: stub.profileUrl,
      profileImageUrl: account.profile_pic_url,
      bio: stub.bio,
      accountType: stub.accountType,
      phylloAccountId: account.id,
      phylloUserId,
      status: 'connected',
    },
  })

  // 2. Append a snapshot (time series). Two rules:
  //   - Skip entirely on a sparse sync — writing zeros would wipe the
  //     real prior data the dashboard trajectory charts off.
  //   - Dedupe by UTC day so cron + manual resync don't pile identical
  //     rows. When an existing row exists for today and the new numbers
  //     are better, update; if they're worse (edge case — a sparse sync
  //     got past the first guard) keep the prior row untouched.
  if (!opts.sparse) {
    const dayStart = new Date()
    dayStart.setUTCHours(0, 0, 0, 0)
    const dayEnd = new Date(dayStart)
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1)

    const existingToday = await prisma.platformSnapshot.findFirst({
      where: {
        accountId: platformAccount.id,
        capturedAt: { gte: dayStart, lt: dayEnd },
      },
      orderBy: { capturedAt: 'desc' },
    })
    if (existingToday) {
      // Only overwrite when the new numbers are real. If somehow a
      // zero-everything payload slipped past the sparse check upstream,
      // don't let it nuke today's prior good data.
      const newIsBetter = stub.followerCount > 0 || stub.avgReach > 0 || stub.engagementRate > 0
      if (newIsBetter) {
        await prisma.platformSnapshot.update({
          where: { id: existingToday.id },
          data: {
            followerCount: stub.followerCount,
            followingCount: stub.followingCount,
            postCount: stub.postCount,
            avgReach: stub.avgReach,
            avgImpressions: stub.avgImpressions,
            engagementRate: stub.engagementRate,
            capturedAt: new Date(),
          },
        })
      }
    } else {
      await prisma.platformSnapshot.create({
        data: {
          accountId: platformAccount.id,
          followerCount: stub.followerCount,
          followingCount: stub.followingCount,
          postCount: stub.postCount,
          avgReach: stub.avgReach,
          avgImpressions: stub.avgImpressions,
          engagementRate: stub.engagementRate,
        },
      })
    }
  }

  // 3. Append an audience snapshot (if we have any meaningful data)
  const hasAudience =
    stub.audienceAge.length > 0 ||
    stub.audienceGender.length > 0 ||
    stub.audienceTopCountries.length > 0
  if (hasAudience) {
    await prisma.platformAudience.create({
      data: {
        accountId: platformAccount.id,
        ageBreakdown: stub.audienceAge as never,
        genderBreakdown: stub.audienceGender as never,
        topCountries: stub.audienceTopCountries as never,
        topCities: stub.audienceTopCities as never,
      },
    })
  }

  // 4. Upsert each post. Stub maps from Phyllo contents; for personal IG
  // Phyllo returns nothing here so recentMedia is empty and we simply
  // skip writes.
  for (const m of stub.recentMedia) {
    await prisma.platformPost.upsert({
      where: { accountId_platformPostId: { accountId: platformAccount.id, platformPostId: m.id } },
      update: {
        caption: m.caption,
        mediaType: m.media_type,
        url: m.permalink,
        thumbnailUrl: m.thumbnail_url,
        publishedAt: m.timestamp ? new Date(m.timestamp) : null,
        likeCount: m.like_count,
        commentCount: m.comments_count,
        shareCount: m.insights.shares,
        saveCount: m.insights.saved,
        viewCount: m.insights.impressions,
        reachCount: m.insights.reach,
        impressionCount: m.insights.impressions,
        lastSyncedAt: new Date(),
      },
      create: {
        accountId: platformAccount.id,
        platformPostId: m.id,
        caption: m.caption,
        mediaType: m.media_type,
        url: m.permalink,
        thumbnailUrl: m.thumbnail_url,
        publishedAt: m.timestamp ? new Date(m.timestamp) : null,
        likeCount: m.like_count,
        commentCount: m.comments_count,
        shareCount: m.insights.shares,
        saveCount: m.insights.saved,
        viewCount: m.insights.impressions,
        reachCount: m.insights.reach,
        impressionCount: m.insights.impressions,
      },
    })
    // Capture metric snapshot for delta tracking
    const { capturePostMetrics } = await import('./metricTracking')
    const upserted = await prisma.platformPost.findFirst({
      where: { accountId: platformAccount.id, platformPostId: m.id },
      select: { id: true },
    })
    if (upserted) await capturePostMetrics(prisma, upserted.id).catch(() => {})
  }

  // Compute weekly summary after all posts synced
  const { computeWeeklySummary } = await import('./metricTracking')
  await computeWeeklySummary(prisma, platformAccount.id).catch((e) => console.warn('[platformSync] weekly summary failed:', e))

  // Compute all derived metrics (post-level, snapshot rollups, weekly extensions)
  const { computeAllDerivedMetrics } = await import('./derivedMetrics')
  await computeAllDerivedMetrics(prisma, platformAccount.id, {
    profileViews: stub.profileViews ?? 0,
    websiteClicks: stub.websiteClicks ?? 0,
  }).catch((e) => console.warn('[platformSync] derived metrics failed:', e))

  return { accountId: platformAccount.id }
}

/**
 * Write snapshot, audience, posts, and derived metrics for an already-
 * existing PlatformAccount row.  Extracted so callers that upsert the
 * account themselves (e.g. direct Meta OAuth) can still run the full
 * post-sync pipeline without going through persistPhylloSync.
 */
export async function persistSnapshotAndPosts(
  prisma: PrismaClient,
  accountId: string,
  stub: IgStub,
): Promise<void> {
  // Snapshot (dedupe by UTC day)
  const dayStart = new Date()
  dayStart.setUTCHours(0, 0, 0, 0)
  const dayEnd = new Date(dayStart)
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1)

  const existingToday = await prisma.platformSnapshot.findFirst({
    where: { accountId, capturedAt: { gte: dayStart, lt: dayEnd } },
    orderBy: { capturedAt: 'desc' },
  })
  if (existingToday) {
    const newIsBetter = stub.followerCount > 0 || stub.avgReach > 0 || stub.engagementRate > 0
    if (newIsBetter) {
      await prisma.platformSnapshot.update({
        where: { id: existingToday.id },
        data: {
          followerCount: stub.followerCount,
          followingCount: stub.followingCount,
          postCount: stub.postCount,
          avgReach: stub.avgReach,
          avgImpressions: stub.avgImpressions,
          engagementRate: stub.engagementRate,
          capturedAt: new Date(),
        },
      })
    }
  } else {
    await prisma.platformSnapshot.create({
      data: {
        accountId,
        followerCount: stub.followerCount,
        followingCount: stub.followingCount,
        postCount: stub.postCount,
        avgReach: stub.avgReach,
        avgImpressions: stub.avgImpressions,
        engagementRate: stub.engagementRate,
      },
    })
  }

  // Audience
  const hasAudience =
    stub.audienceAge.length > 0 ||
    stub.audienceGender.length > 0 ||
    stub.audienceTopCountries.length > 0
  if (hasAudience) {
    await prisma.platformAudience.create({
      data: {
        accountId,
        ageBreakdown: stub.audienceAge as never,
        genderBreakdown: stub.audienceGender as never,
        topCountries: stub.audienceTopCountries as never,
        topCities: stub.audienceTopCities as never,
      },
    })
  }

  // Posts
  for (const m of stub.recentMedia) {
    await prisma.platformPost.upsert({
      where: { accountId_platformPostId: { accountId, platformPostId: m.id } },
      update: {
        caption: m.caption,
        mediaType: m.media_type,
        url: m.permalink,
        thumbnailUrl: m.thumbnail_url,
        publishedAt: m.timestamp ? new Date(m.timestamp) : null,
        likeCount: m.like_count,
        commentCount: m.comments_count,
        shareCount: m.insights.shares,
        saveCount: m.insights.saved,
        viewCount: m.insights.impressions,
        reachCount: m.insights.reach,
        impressionCount: m.insights.impressions,
        lastSyncedAt: new Date(),
      },
      create: {
        accountId,
        platformPostId: m.id,
        caption: m.caption,
        mediaType: m.media_type,
        url: m.permalink,
        thumbnailUrl: m.thumbnail_url,
        publishedAt: m.timestamp ? new Date(m.timestamp) : null,
        likeCount: m.like_count,
        commentCount: m.comments_count,
        shareCount: m.insights.shares,
        saveCount: m.insights.saved,
        viewCount: m.insights.impressions,
        reachCount: m.insights.reach,
        impressionCount: m.insights.impressions,
      },
    })
    const { capturePostMetrics } = await import('./metricTracking')
    const upserted = await prisma.platformPost.findFirst({
      where: { accountId, platformPostId: m.id },
      select: { id: true },
    })
    if (upserted) await capturePostMetrics(prisma, upserted.id).catch(() => {})
  }

  // Weekly summary + derived metrics
  const { computeWeeklySummary } = await import('./metricTracking')
  await computeWeeklySummary(prisma, accountId).catch((e) => console.warn('[platformSync] weekly summary failed:', e))
  const { computeAllDerivedMetrics } = await import('./derivedMetrics')
  await computeAllDerivedMetrics(prisma, accountId, {
    profileViews: stub.profileViews ?? 0,
    websiteClicks: stub.websiteClicks ?? 0,
  }).catch((e) => console.warn('[platformSync] derived metrics failed:', e))
}
