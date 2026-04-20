import { PrismaClient } from '@prisma/client'

/**
 * Capture a snapshot of a post's current metrics.
 * Called after every post upsert during sync.
 * Only creates a new snapshot if metrics actually changed.
 */
export async function capturePostMetrics(
  prisma: PrismaClient,
  postId: string,
): Promise<void> {
  const post = await prisma.platformPost.findUnique({
    where: { id: postId },
    select: { likeCount: true, commentCount: true, shareCount: true, saveCount: true, viewCount: true, reachCount: true },
  })
  if (!post) return

  // Check if metrics changed since last snapshot
  const lastSnapshot = await prisma.postMetricSnapshot.findFirst({
    where: { postId },
    orderBy: { capturedAt: 'desc' },
  })

  if (lastSnapshot &&
    lastSnapshot.likeCount === post.likeCount &&
    lastSnapshot.viewCount === post.viewCount &&
    lastSnapshot.commentCount === post.commentCount) {
    return // no change, skip
  }

  await prisma.postMetricSnapshot.create({
    data: {
      postId,
      likeCount: post.likeCount,
      commentCount: post.commentCount,
      shareCount: post.shareCount,
      saveCount: post.saveCount,
      viewCount: post.viewCount,
      reachCount: post.reachCount,
    },
  })
}

/**
 * Compute and store a weekly summary for an account.
 * Called after each sync completes.
 */
export async function computeWeeklySummary(
  prisma: PrismaClient,
  accountId: string,
): Promise<void> {
  // Find current week boundaries (Monday 00:00 to Sunday 23:59 UTC)
  const now = new Date()
  const dayOfWeek = now.getUTCDay() // 0=Sun, 1=Mon...
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const weekStart = new Date(now)
  weekStart.setUTCDate(now.getUTCDate() + mondayOffset)
  weekStart.setUTCHours(0, 0, 0, 0)

  const weekEnd = new Date(weekStart)
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6)
  weekEnd.setUTCHours(23, 59, 59, 999)

  // Get account snapshots for this week
  const snapshots = await prisma.platformSnapshot.findMany({
    where: { accountId, capturedAt: { gte: weekStart, lte: weekEnd } },
    orderBy: { capturedAt: 'asc' },
  })

  if (snapshots.length === 0) return

  const firstSnap = snapshots[0]
  const lastSnap = snapshots[snapshots.length - 1]

  // Get posts published this week
  const posts = await prisma.platformPost.findMany({
    where: { accountId, publishedAt: { gte: weekStart, lte: weekEnd } },
    orderBy: { viewCount: 'desc' },
  })

  // Get ALL posts for the account to compute weekly deltas from metric snapshots
  const allPosts = await prisma.platformPost.findMany({
    where: { accountId },
    select: { id: true, caption: true, viewCount: true, likeCount: true, commentCount: true, mediaType: true, publishedAt: true },
  })

  // Compute per-post weekly deltas from metric snapshots
  let totalViewGrowth = 0
  let totalLikeGrowth = 0
  let totalCommentGrowth = 0

  for (const post of allPosts) {
    const weekSnapshots = await prisma.postMetricSnapshot.findMany({
      where: { postId: post.id, capturedAt: { gte: weekStart, lte: weekEnd } },
      orderBy: { capturedAt: 'asc' },
    })
    if (weekSnapshots.length >= 2) {
      const first = weekSnapshots[0]
      const last = weekSnapshots[weekSnapshots.length - 1]
      totalViewGrowth += last.viewCount - first.viewCount
      totalLikeGrowth += last.likeCount - first.likeCount
      totalCommentGrowth += last.commentCount - first.commentCount
    }
  }

  // Find top post (by view growth this week, or by total views if no delta data)
  let topPost = posts[0] || null
  let topPostViews = topPost?.viewCount || 0

  // Best day (most posts published)
  const dayCount: Record<string, number> = {}
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  for (const p of posts) {
    if (p.publishedAt) {
      const d = dayNames[new Date(p.publishedAt).getUTCDay()]
      dayCount[d] = (dayCount[d] || 0) + 1
    }
  }
  const bestDay = Object.entries(dayCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null

  // Best format
  const formatPerf: Record<string, { count: number; totalViews: number }> = {}
  for (const p of posts) {
    const fmt = p.mediaType || 'UNKNOWN'
    if (!formatPerf[fmt]) formatPerf[fmt] = { count: 0, totalViews: 0 }
    formatPerf[fmt].count++
    formatPerf[fmt].totalViews += p.viewCount
  }
  const bestFormat = Object.entries(formatPerf)
    .sort((a, b) => (b[1].totalViews / b[1].count) - (a[1].totalViews / a[1].count))[0]?.[0] || null

  await prisma.weeklySummary.upsert({
    where: { accountId_weekStart: { accountId, weekStart } },
    create: {
      accountId,
      weekStart,
      weekEnd,
      followerStart: firstSnap.followerCount,
      followerEnd: lastSnap.followerCount,
      followerDelta: lastSnap.followerCount - firstSnap.followerCount,
      avgEngagement: lastSnap.engagementRate,
      avgReach: lastSnap.avgReach,
      postsPublished: posts.length,
      totalViews: totalViewGrowth,
      totalLikes: totalLikeGrowth,
      totalComments: totalCommentGrowth,
      topPostId: topPost?.id || null,
      topPostViews,
      topPostCaption: topPost?.caption?.slice(0, 120) || null,
      bestDay,
      bestFormat,
    },
    update: {
      followerEnd: lastSnap.followerCount,
      followerDelta: lastSnap.followerCount - firstSnap.followerCount,
      avgEngagement: lastSnap.engagementRate,
      avgReach: lastSnap.avgReach,
      postsPublished: posts.length,
      totalViews: totalViewGrowth,
      totalLikes: totalLikeGrowth,
      totalComments: totalCommentGrowth,
      topPostId: topPost?.id || null,
      topPostViews,
      topPostCaption: topPost?.caption?.slice(0, 120) || null,
      bestDay,
      bestFormat,
    },
  })
}
