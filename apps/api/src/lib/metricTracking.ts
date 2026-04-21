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

/**
 * Capture a daily engagement snapshot for a company.
 * Sums current totals across all posts from all connected accounts.
 * Run once per day after platform sync completes.
 * Delta between consecutive days = engagement gained that day.
 */
export async function captureDailyEngagement(
  prisma: PrismaClient,
  companyId: string,
): Promise<void> {
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  const accounts = await prisma.platformAccount.findMany({
    where: { companyId, status: 'connected' },
    select: { id: true },
  })
  if (accounts.length === 0) return

  const accountIds = accounts.map(a => a.id)
  const posts = await prisma.platformPost.findMany({
    where: { accountId: { in: accountIds } },
    select: {
      likeCount: true,
      commentCount: true,
      saveCount: true,
      shareCount: true,
      reachCount: true,
      viewCount: true,
    },
  })

  const totalLikes = posts.reduce((s, p) => s + p.likeCount, 0)
  const totalComments = posts.reduce((s, p) => s + p.commentCount, 0)
  const totalSaves = posts.reduce((s, p) => s + p.saveCount, 0)
  const totalShares = posts.reduce((s, p) => s + p.shareCount, 0)
  const totalReach = posts.reduce((s, p) => s + (p.reachCount || p.viewCount || 0), 0)
  const totalViews = posts.reduce((s, p) => s + (p.viewCount || 0), 0)
  const totalInteractions = totalLikes + totalComments + totalSaves + totalShares
  const engagementRate = totalReach > 0 ? totalInteractions / totalReach : 0

  await prisma.dailyEngagement.upsert({
    where: { companyId_date: { companyId, date: today } },
    update: {
      totalLikes,
      totalComments,
      totalSaves,
      totalShares,
      totalReach,
      totalViews,
      postCount: posts.length,
      engagementRate,
    },
    create: {
      companyId,
      date: today,
      totalLikes,
      totalComments,
      totalSaves,
      totalShares,
      totalReach,
      totalViews,
      postCount: posts.length,
      engagementRate,
    },
  })
}

/**
 * Generate a Bedrock narrative forecast from the account's time series data.
 * Stores the result in the company's brand memory so agents and the dashboard
 * can reference it. Runs once per day after daily sync.
 */
export async function generateNarrativeForecast(
  prisma: PrismaClient,
  companyId: string,
): Promise<string> {
  // Gather data
  const accounts = await prisma.platformAccount.findMany({
    where: { companyId, status: 'connected' },
    select: { platform: true, handle: true },
  })
  const snapshots = await prisma.platformSnapshot.findMany({
    where: { account: { companyId } },
    orderBy: { capturedAt: 'asc' },
    take: 60,
    select: { capturedAt: true, followerCount: true, engagementRate: true, avgReach: true },
  })
  const dailyEng = await prisma.dailyEngagement.findMany({
    where: { companyId },
    orderBy: { date: 'asc' },
    take: 30,
  })
  const posts = await prisma.platformPost.findMany({
    where: { account: { companyId } },
    orderBy: { publishedAt: 'desc' },
    take: 20,
    select: { mediaType: true, likeCount: true, commentCount: true, saveCount: true, shareCount: true, reachCount: true, engagementRate: true, publishedAt: true, avgWatchTimeMs: true },
  })

  const platformList = accounts.map(a => `${a.platform} @${a.handle}`).join(', ')
  const latestSnap = snapshots[snapshots.length - 1]
  const earliestSnap = snapshots[0]
  const followerGrowth = latestSnap && earliestSnap ? latestSnap.followerCount - earliestSnap.followerCount : 0
  const daysCovered = snapshots.length

  // Build prompt
  const dataBlock = `
Connected platforms: ${platformList}
Follower snapshots (${daysCovered} days): ${earliestSnap?.followerCount?.toLocaleString() || '?'} → ${latestSnap?.followerCount?.toLocaleString() || '?'} (${followerGrowth >= 0 ? '+' : ''}${followerGrowth})
Latest engagement rate: ${latestSnap?.engagementRate ? (latestSnap.engagementRate < 1 ? (latestSnap.engagementRate * 100).toFixed(1) : latestSnap.engagementRate.toFixed(1)) + '%' : 'unknown'}
Latest avg reach: ${latestSnap?.avgReach?.toLocaleString() || 'unknown'}
Daily engagement snapshots: ${dailyEng.length} days tracked
Recent posts (${posts.length}):
${posts.slice(0, 10).map(p => `  ${p.mediaType} — ${p.likeCount} likes, ${p.commentCount} comments, ${p.saveCount} saves, ${p.reachCount} reach, eng=${(p.engagementRate * 100).toFixed(1)}%${p.avgWatchTimeMs ? ', watch=' + (p.avgWatchTimeMs/1000).toFixed(1) + 's' : ''}`).join('\n')}
`.trim()

  const systemPrompt = `You are Maya, a data analyst for a social media creator. Analyze their account data and write a 2-3 sentence growth forecast. Be specific with numbers. Mention what's driving growth or holding it back. End with one actionable recommendation. No fluff, no generic advice — reference their actual data. Write in first person as Maya speaking to the CEO.`

  try {
    const { invokeAgent } = await import('../services/bedrock/bedrock.service')
    const response = await invokeAgent({
      systemPrompt,
      messages: [{ role: 'user', content: dataBlock }],
      maxTokens: 200,
    })

    // Store in brand memory
    const { writeMemory } = await import('./brandMemory')
    await writeMemory(prisma, {
      companyId,
      type: 'performance',
      weight: 1.5,
      content: {
        source: 'performance_tracking',
        summary: response.trim(),
        tags: ['forecast', 'maya', 'daily'],
      },
    })

    return response.trim()
  } catch (err) {
    console.warn('[forecast] Bedrock narrative failed:', (err as Error).message?.slice(0, 100))
    return ''
  }
}

/**
 * Compute multi-factor correlation analysis for a company's posts.
 * Stores results in brand memory so agents (Maya, Jordan, Alex) can
 * reference what drives likes/views when making content decisions.
 * Runs daily after sync.
 */
export async function computeCorrelationAnalysis(
  prisma: PrismaClient,
  companyId: string,
): Promise<void> {
  const accounts = await prisma.platformAccount.findMany({
    where: { companyId, status: 'connected' },
    select: { id: true },
  })
  if (accounts.length === 0) return

  const posts = await prisma.platformPost.findMany({
    where: {
      accountId: { in: accounts.map(a => a.id) },
      likeCount: { gt: 0 },
      engagementRate: { lt: 1 },
    },
    select: {
      mediaType: true,
      likeCount: true,
      commentCount: true,
      saveCount: true,
      shareCount: true,
      viewCount: true,
      reachCount: true,
      engagementRate: true,
      captionLength: true,
      publishHour: true,
      publishDayOfWeek: true,
      avgWatchTimeMs: true,
      caption: true,
    },
  })

  if (posts.length < 5) return

  // Pearson correlation
  function pearson(x: number[], y: number[]): number {
    const n = x.length
    if (n < 3) return 0
    const mx = x.reduce((s, v) => s + v, 0) / n
    const my = y.reduce((s, v) => s + v, 0) / n
    const sx = Math.sqrt(x.reduce((s, v) => s + (v - mx) ** 2, 0) / n)
    const sy = Math.sqrt(y.reduce((s, v) => s + (v - my) ** 2, 0) / n)
    if (sx === 0 || sy === 0) return 0
    return x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0) / (n * sx * sy)
  }

  const likes = posts.map(p => p.likeCount)
  const views = posts.map(p => p.viewCount || p.reachCount || 0)

  const factors = [
    { factor: 'views_reach', r: pearson(posts.map(p => p.viewCount || p.reachCount || 0), likes) },
    { factor: 'comments', r: pearson(posts.map(p => p.commentCount), likes) },
    { factor: 'caption_length', r: pearson(posts.map(p => p.captionLength || (p.caption || '').length), likes) },
    { factor: 'shares', r: pearson(posts.map(p => p.shareCount), likes) },
    { factor: 'saves', r: pearson(posts.map(p => p.saveCount), likes) },
    { factor: 'watch_time', r: pearson(posts.map(p => p.avgWatchTimeMs || 0), likes) },
    { factor: 'hour_of_day', r: pearson(posts.map(p => p.publishHour ?? new Date().getHours()), likes) },
  ].sort((a, b) => Math.abs(b.r) - Math.abs(a.r))

  // Format performance
  const formatMap: Record<string, { total: number; count: number }> = {}
  for (const p of posts) {
    const f = p.mediaType || 'unknown'
    if (!formatMap[f]) formatMap[f] = { total: 0, count: 0 }
    formatMap[f].total += p.likeCount
    formatMap[f].count++
  }
  const formats = Object.entries(formatMap)
    .map(([format, { total, count }]) => ({ format, avgLikes: Math.round(total / count), count }))
    .sort((a, b) => b.avgLikes - a.avgLikes)

  // Views correlation
  const viewFactors = [
    { factor: 'likes', r: pearson(likes, views) },
    { factor: 'comments', r: pearson(posts.map(p => p.commentCount), views) },
    { factor: 'shares', r: pearson(posts.map(p => p.shareCount), views) },
    { factor: 'saves', r: pearson(posts.map(p => p.saveCount), views) },
    { factor: 'caption_length', r: pearson(posts.map(p => p.captionLength || (p.caption || '').length), views) },
    { factor: 'watch_time', r: pearson(posts.map(p => p.avgWatchTimeMs || 0), views) },
  ].sort((a, b) => Math.abs(b.r) - Math.abs(a.r))

  const topLikeDriver = factors[0]
  const topViewDriver = viewFactors[0]
  const bestFormat = formats[0]

  const strength = (r: number) => Math.abs(r) > 0.5 ? 'strong' : Math.abs(r) > 0.2 ? 'moderate' : 'weak'

  // Build agent-readable summary
  const summary = [
    `Correlation analysis (${posts.length} posts):`,
    `Biggest driver of LIKES: ${topLikeDriver.factor.replace(/_/g, ' ')} (${strength(topLikeDriver.r)} correlation, r=${topLikeDriver.r.toFixed(2)}).`,
    `Biggest driver of VIEWS: ${topViewDriver.factor.replace(/_/g, ' ')} (${strength(topViewDriver.r)} correlation, r=${topViewDriver.r.toFixed(2)}).`,
    `Best format: ${bestFormat.format} (${bestFormat.avgLikes} avg likes, ${bestFormat.count} posts).`,
    `All factors ranked by like impact: ${factors.map(f => f.factor.replace(/_/g, ' ') + '=' + f.r.toFixed(2)).join(', ')}.`,
  ].join(' ')

  // Store in brand memory for agents
  const { writeMemory } = await import('./brandMemory')
  await writeMemory(prisma, {
    companyId,
    type: 'performance',
    weight: 1.6,
    content: {
      source: 'performance_tracking',
      summary,
      tags: ['correlation', 'analysis', 'what_works'],
      details: {
        likeFactors: factors,
        viewFactors,
        formatPerformance: formats,
        postCount: posts.length,
        computedAt: new Date().toISOString(),
      },
    },
  })
}
