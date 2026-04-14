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
import type { PhylloAccount } from './phyllo'

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

  // 2. Append a snapshot (time series)
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
  }

  return { accountId: platformAccount.id }
}
