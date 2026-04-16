/**
 * TikTok data refresh — re-pulls profile + videos using a fresh token,
 * updates TiktokConnection + PlatformAccount/Snapshot/Post, and reports
 * how many new posts were discovered.
 *
 * Called by:
 *  - POST /api/tiktok/sync (dashboard sync-on-login)
 *  - scheduler (daily cron alongside Phyllo sync)
 */

import { PrismaClient } from '@prisma/client'
import { ensureFreshToken } from './tiktokToken'
import { persistTiktokSnapshot } from './tiktokSync'

const USER_INFO_URL =
  'https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,avatar_url_100,display_name,username,bio_description,profile_deep_link,is_verified,follower_count,following_count,likes_count,video_count'

const VIDEO_LIST_URL =
  'https://open.tiktokapis.com/v2/video/list/?fields=id,title,video_description,duration,cover_image_url,embed_link,share_url,create_time,like_count,comment_count,share_count,view_count'

const THROTTLE_MS = 5 * 60 * 1000 // 5 minutes between syncs

export interface SyncResult {
  synced: boolean
  newPosts: number
  reason?: string
  lastSyncedAt?: string
}

export async function syncTiktokAccount(
  prisma: PrismaClient,
  companyId: string,
): Promise<SyncResult> {
  const conn = await prisma.tiktokConnection.findUnique({ where: { companyId } })
  if (!conn) return { synced: false, newPosts: 0, reason: 'no_connection' }

  // Throttle: skip if synced recently
  if (conn.lastSyncedAt && Date.now() - conn.lastSyncedAt.getTime() < THROTTLE_MS) {
    return { synced: false, newPosts: 0, reason: 'throttled' }
  }

  // Get a fresh token
  const token = await ensureFreshToken(prisma, companyId)
  if (!token) return { synced: false, newPosts: 0, reason: 'token_expired' }

  // Fetch profile + videos in parallel
  const [userJson, videoJson] = await Promise.all([
    fetch(USER_INFO_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token.accessToken}` },
    }).then(async (r) => (r.ok ? (await r.json().catch(() => null)) as Record<string, unknown> | null : null))
      .catch(() => null),
    fetch(VIDEO_LIST_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ max_count: 20 }),
    }).then(async (r) => (r.ok ? (await r.json().catch(() => null)) as Record<string, unknown> | null : null))
      .catch(() => null),
  ])

  const profile = ((userJson as { data?: { user?: Record<string, unknown> } } | null)?.data?.user) || null
  const videos = ((videoJson as { data?: { videos?: Array<Record<string, unknown>> } } | null)?.data?.videos) || []

  if (!profile && videos.length === 0) {
    return { synced: false, newPosts: 0, reason: 'api_returned_empty' }
  }

  // Count existing posts before upsert
  const platformAccount = await prisma.platformAccount.findFirst({
    where: { companyId, platform: 'tiktok' },
  })
  const postsBefore = platformAccount
    ? await prisma.platformPost.count({ where: { accountId: platformAccount.id } })
    : 0

  // Parse profile fields
  const p = profile || {}
  const handleRaw = typeof p.username === 'string' ? p.username : ''
  const followerCount = Number(p.follower_count ?? conn.followerCount)
  const followingCount = Number(p.following_count ?? conn.followingCount)
  const videoCount = Number(p.video_count ?? conn.videoCount)
  const likesCount = Number(p.likes_count ?? conn.likesCount)
  const displayName = typeof p.display_name === 'string' ? p.display_name : conn.displayName
  const bio = typeof p.bio_description === 'string' ? p.bio_description : conn.bio
  const avatarUrl = (typeof p.avatar_url_100 === 'string' && p.avatar_url_100) || conn.avatarUrl
  const profileUrl = typeof p.profile_deep_link === 'string' ? p.profile_deep_link : conn.profileUrl
  const isVerified = Boolean(p.is_verified)

  // Compute engagement
  const videoForCard = (v: Record<string, unknown>) => ({
    id: String(v.id || ''),
    title: (typeof v.title === 'string' && v.title.trim()) || (typeof v.video_description === 'string' && v.video_description.trim()) || '',
    cover: typeof v.cover_image_url === 'string' ? v.cover_image_url : '',
    shareUrl: typeof v.share_url === 'string' ? v.share_url : '',
    createdAt: Number(v.create_time || 0),
    duration: Number(v.duration || 0),
    views: Number(v.view_count || 0),
    likes: Number(v.like_count || 0),
    comments: Number(v.comment_count || 0),
    shares: Number(v.share_count || 0),
  })
  const recentMapped = videos.map(videoForCard)
  const topVideos = [...recentMapped].sort((a, b) => b.views - a.views).slice(0, 3)

  let totalViews = 0, totalLikes = 0, totalComments = 0, totalShares = 0
  for (const v of recentMapped) {
    totalViews += v.views; totalLikes += v.likes; totalComments += v.comments; totalShares += v.shares
  }
  const n = recentMapped.length || 1
  const avgViews = Math.round(totalViews / n)
  const avgLikes = Math.round(totalLikes / n)
  const engagementRate = totalViews > 0 ? (totalLikes + totalComments + totalShares) / totalViews : 0
  const reachRate = followerCount > 0 ? avgViews / followerCount : 0

  // Update TiktokConnection (legacy table)
  await prisma.tiktokConnection.update({
    where: { companyId },
    data: {
      handle: handleRaw ? `@${handleRaw}` : conn.handle,
      displayName, bio, avatarUrl, profileUrl, isVerified,
      followerCount, followingCount, videoCount, likesCount,
      avgViews, avgLikes, engagementRate, reachRate,
      topVideos, recentVideos: recentMapped,
      lastSyncedAt: new Date(),
    },
  })

  // Update Platform* tables
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { userId: true } })
  if (company) {
    try {
      await persistTiktokSnapshot(prisma, {
        companyId,
        userId: company.userId,
        openId: conn.openId,
        handle: handleRaw || conn.handle.replace(/^@/, ''),
        displayName, bio, profileUrl, avatarUrl, isVerified,
        followerCount, followingCount,
        postCount: videoCount,
        avgViews, engagementRate,
        videos: recentMapped.map((v) => ({
          id: v.id,
          caption: v.title,
          url: v.shareUrl || null,
          thumbnailUrl: v.cover || null,
          publishedAt: v.createdAt > 0 ? new Date(v.createdAt * 1000) : null,
          viewCount: v.views,
          likeCount: v.likes,
          commentCount: v.comments,
          shareCount: v.shares,
        })),
      })
    } catch (e) {
      console.warn('[tiktok-sync] platform-snapshot write failed', e)
    }
  }

  // Count new posts
  const updatedAccount = await prisma.platformAccount.findFirst({
    where: { companyId, platform: 'tiktok' },
  })
  const postsAfter = updatedAccount
    ? await prisma.platformPost.count({ where: { accountId: updatedAccount.id } })
    : 0
  const newPosts = Math.max(0, postsAfter - postsBefore)

  if (newPosts > 0) console.log(`[tiktok-sync] ${newPosts} new posts detected for company ${companyId}`)

  return { synced: true, newPosts, lastSyncedAt: new Date().toISOString() }
}
