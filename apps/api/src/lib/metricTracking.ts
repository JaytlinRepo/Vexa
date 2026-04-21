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

/**
 * Evaluate whether outputs linked to posts performed well.
 * Runs during daily sync. Checks outputs with linkedPostId where
 * performedWell is still null and the post is 48+ hours old.
 *
 * "Performed well" = engagement rate above the account's average.
 * This feeds back into brand memory so agents learn what works.
 */
export async function evaluateOutputPerformance(
  prisma: PrismaClient,
  companyId: string,
): Promise<{ evaluated: number; wellPerformed: number }> {
  const threshold = new Date(Date.now() - 48 * 60 * 60 * 1000) // 48h ago

  // Find outputs with linked posts that haven't been evaluated yet
  const outputs = await prisma.output.findMany({
    where: {
      companyId,
      linkedPostId: { not: null },
      performedWell: null,
    },
  })

  if (outputs.length === 0) return { evaluated: 0, wellPerformed: 0 }

  // Get account-level avg engagement rate
  const snapshot = await prisma.platformSnapshot.findFirst({
    where: { account: { companyId } },
    orderBy: { capturedAt: 'desc' },
  })
  const avgEng = snapshot?.engagementRate || 0

  let evaluated = 0
  let wellPerformed = 0

  for (const output of outputs) {
    const post = await prisma.platformPost.findFirst({
      where: { id: output.linkedPostId! },
    })
    if (!post || !post.publishedAt || post.publishedAt > threshold) continue

    const didWell = post.engagementRate > avgEng
    await prisma.output.update({
      where: { id: output.id },
      data: { performedWell: didWell },
    })

    // Write brand memory about what worked/didn't
    const { writeMemory } = await import('./brandMemory')
    const employee = await prisma.employee.findUnique({ where: { id: output.employeeId } })
    await writeMemory(prisma, {
      companyId,
      type: didWell ? 'performance' : 'feedback',
      weight: didWell ? 1.2 : 1.4,
      content: {
        source: 'performance_tracking',
        summary: didWell
          ? `${employee?.name}'s ${output.type} led to a post with ${post.engagementRate.toFixed(1)}% engagement (above ${avgEng.toFixed(1)}% avg). This style works.`
          : `${employee?.name}'s ${output.type} led to a post with ${post.engagementRate.toFixed(1)}% engagement (below ${avgEng.toFixed(1)}% avg). Consider adjusting.`,
        tags: ['learning', output.type, didWell ? 'success' : 'underperform'],
        details: {
          outputId: output.id,
          outputType: output.type,
          employeeName: employee?.name || 'Unknown',
          postEngagement: post.engagementRate,
          accountAvg: avgEng,
          verdict: didWell ? 'above_average' : 'below_average',
        },
      },
    }).catch(() => {})

    evaluated++
    if (didWell) wellPerformed++
  }

  return { evaluated, wellPerformed }
}
