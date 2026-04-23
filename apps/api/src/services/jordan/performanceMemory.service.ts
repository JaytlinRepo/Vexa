import { PrismaClient } from '@prisma/client'

/**
 * Performance Memory Service for Jordan
 * Analyzes post performance data and stores learnings in brand_memory
 * so Jordan can improve future content plans based on what actually works.
 */

export interface PerformanceInsight {
  contentAngle: string
  sampleSize: number
  avgEngagementRate: number
  avgViewCount: number
  avgSaveRate: number
  trend: 'improving' | 'stable' | 'declining'
  confidence: 'high' | 'medium' | 'low'
}

export interface JordanLearning {
  type: 'content_angle' | 'posting_time' | 'format' | 'audience_segment'
  performance: PerformanceInsight[]
  generatedAt: string
  significance: 'strong' | 'moderate' | 'weak'
}

export function createPerformanceMemory(prisma: PrismaClient) {
  /**
   * Analyze performance of recent posts and extract learnings for Jordan
   */
  async function updateJordanMemory(companyId: string): Promise<void> {
    try {
      // Get company's platform account to find posts
      const account = await prisma.platformAccount.findFirst({
        where: { companyId },
      })
      if (!account) return

      // Get posts from last 30 days with metric snapshots
      const posts = await prisma.platformPost.findMany({
        where: {
          accountId: account.id,
          publishedAt: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          },
        },
        include: {
          metricSnapshots: {
            orderBy: { capturedAt: 'desc' },
            take: 1, // Just the latest snapshot
          },
        },
      })

      if (posts.length < 3) {
        // Not enough data to learn from yet
        return
      }

      // Group posts by content characteristics
      const insights = await analyzeContentAnglePerformance(posts)
      const timingInsights = await analyzePostingTimePerformance(posts)

      // Store in brand_memory as learnings for Jordan
      if (insights.length > 0) {
        await prisma.brandMemory.create({
          data: {
            companyId,
            memoryType: 'performance',
            content: {
              source: 'performance_analysis',
              contentAngles: insights,
              generatedAt: new Date().toISOString(),
              postsAnalyzed: posts.length,
            } as unknown as never,
            weight: 0.8,
          },
        })
      }

      if (timingInsights.length > 0) {
        await prisma.brandMemory.create({
          data: {
            companyId,
            memoryType: 'performance',
            content: {
              source: 'timing_analysis',
              postingTimes: timingInsights,
              generatedAt: new Date().toISOString(),
              postsAnalyzed: posts.length,
            } as unknown as never,
            weight: 0.6,
          },
        })
      }
    } catch (err) {
      console.error('[performanceMemory] updateJordanMemory failed:', err)
    }
  }

  async function analyzeContentAnglePerformance(posts: any[]): Promise<PerformanceInsight[]> {
    // Extract content angles from task descriptions/content plans
    const angleGroups = new Map<string, typeof posts>()

    for (const post of posts) {
      let angle = 'general'

      // Infer from post caption
      const caption = (post.caption || '').toLowerCase()
      if (caption.includes('transformation') || caption.includes('before/after')) {
        angle = 'transformation'
      } else if (caption.includes('educational') || caption.includes('how to') || caption.includes('tutorial')) {
        angle = 'educational'
      } else if (caption.includes('motivat') || caption.includes('inspire')) {
        angle = 'motivational'
      } else if (caption.includes('story') || caption.includes('personal')) {
        angle = 'storytelling'
      } else if (caption.includes('trend') || caption.includes('viral')) {
        angle = 'trendy'
      } else if (caption.includes('product') || caption.includes('review')) {
        angle = 'product_review'
      } else if (caption.includes('day in') || caption.includes('routine') || caption.includes('vlog')) {
        angle = 'day_in_life'
      }

      if (!angleGroups.has(angle)) {
        angleGroups.set(angle, [])
      }
      angleGroups.get(angle)!.push(post)
    }

    // Calculate performance metrics per angle
    const insights: PerformanceInsight[] = []

    for (const [angle, anglePosts] of angleGroups) {
      if (anglePosts.length < 2) continue // Need at least 2 posts to measure

      const metrics = anglePosts
        .filter((p) => p.metricSnapshots.length > 0)
        .map((p) => p.metricSnapshots[0]) // Latest metric snapshot

      if (metrics.length === 0) continue

      const avgEngagement = metrics.reduce((sum, m) => sum + (m.likeCount + m.commentCount), 0) / metrics.length
      const avgViews = metrics.reduce((sum, m) => sum + m.viewCount, 0) / metrics.length
      const avgSaveRate = metrics.reduce((sum, m) => sum + (m.viewCount > 0 ? m.saveCount / m.viewCount : 0), 0) / metrics.length

      // Trend detection: compare first half vs second half
      const midpoint = Math.floor(metrics.length / 2)
      const firstHalf = metrics.slice(0, midpoint)
      const secondHalf = metrics.slice(midpoint)

      const firstAvgEngagement = firstHalf.reduce((sum, m) => sum + (m.likeCount + m.commentCount), 0) / firstHalf.length
      const secondAvgEngagement = secondHalf.reduce((sum, m) => sum + (m.likeCount + m.commentCount), 0) / secondHalf.length

      let trend: 'improving' | 'stable' | 'declining' = 'stable'
      if (secondAvgEngagement > firstAvgEngagement * 1.15) {
        trend = 'improving'
      } else if (secondAvgEngagement < firstAvgEngagement * 0.85) {
        trend = 'declining'
      }

      insights.push({
        contentAngle: angle,
        sampleSize: anglePosts.length,
        avgEngagementRate: (avgEngagement / avgViews) * 100, // As percentage
        avgViewCount: Math.floor(avgViews),
        avgSaveRate: avgSaveRate * 100,
        trend,
        confidence: anglePosts.length >= 4 ? 'high' : anglePosts.length >= 2 ? 'medium' : 'low',
      })
    }

    // Sort by engagement rate (highest first)
    return insights.sort((a, b) => b.avgEngagementRate - a.avgEngagementRate)
  }

  async function analyzePostingTimePerformance(posts: any[]): Promise<any[]> {
    // Analyze which days/times perform best
    const dayGroups = new Map<string, typeof posts>()
    const timeGroups = new Map<string, typeof posts>()

    for (const post of posts) {
      const date = new Date(post.publishedAt || new Date())
      const dayName = date.toLocaleDateString('en-US', { weekday: 'long' })
      const hour = date.getHours()
      const timeSlot = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'

      if (!dayGroups.has(dayName)) dayGroups.set(dayName, [])
      dayGroups.get(dayName)!.push(post)

      if (!timeGroups.has(timeSlot)) timeGroups.set(timeSlot, [])
      timeGroups.get(timeSlot)!.push(post)
    }

    const insights: any[] = []

    // Analyze by day
    for (const [day, dayPosts] of dayGroups) {
      if (dayPosts.length < 1) continue

      const metrics = dayPosts.filter((p) => p.metrics.length > 0).map((p) => p.metrics[0])
      if (metrics.length === 0) continue

      const avgEngagement = metrics.reduce((sum, m) => sum + (m.likeCount + m.commentCount), 0) / metrics.length
      const avgViews = metrics.reduce((sum, m) => sum + m.viewCount, 0) / metrics.length

      insights.push({
        timing: `${day}s`,
        type: 'day',
        avgEngagementRate: (avgEngagement / avgViews) * 100,
        avgViews: Math.floor(avgViews),
        sampleSize: dayPosts.length,
      })
    }

    // Analyze by time slot
    for (const [slot, slotPosts] of timeGroups) {
      if (slotPosts.length < 1) continue

      const metrics = slotPosts.filter((p) => p.metrics.length > 0).map((p) => p.metrics[0])
      if (metrics.length === 0) continue

      const avgEngagement = metrics.reduce((sum, m) => sum + (m.likeCount + m.commentCount), 0) / metrics.length
      const avgViews = metrics.reduce((sum, m) => sum + m.viewCount, 0) / metrics.length

      insights.push({
        timing: slot,
        type: 'time_of_day',
        avgEngagementRate: (avgEngagement / avgViews) * 100,
        avgViews: Math.floor(avgViews),
        sampleSize: slotPosts.length,
      })
    }

    return insights.sort((a, b) => b.avgEngagementRate - a.avgEngagementRate)
  }

  /**
   * Get recent performance insights from brand_memory for Jordan's prompt
   */
  async function getJordanInsights(companyId: string): Promise<string | null> {
    try {
      // Get the most recent performance memory
      const memories = await prisma.brandMemory.findMany({
        where: {
          companyId,
          memoryType: 'performance',
        },
        orderBy: { createdAt: 'desc' },
        take: 5, // Last 5 performance analyses
      })

      if (memories.length === 0) return null

      // Extract content angle insights
      const contentAngles = memories
        .map((m) => (m.content as any)?.contentAngles)
        .flat()
        .filter(Boolean)

      if (contentAngles.length === 0) return null

      // Format as plain text for Jordan's prompt
      const topPerformers = contentAngles.slice(0, 3)
      const lines = [
        '## Your Performance Data (Last 30 Days)',
        '',
        ...topPerformers.map(
          (angle: PerformanceInsight) =>
            `- **${angle.contentAngle}**: ${angle.avgEngagementRate.toFixed(1)}% engagement (${angle.avgViewCount.toLocaleString()} avg views) — ${angle.trend}`,
        ),
        '',
        'Focus your plan on these proven angles.',
      ]

      return lines.join('\n')
    } catch (err) {
      console.error('[performanceMemory] getJordanInsights failed:', err)
      return null
    }
  }

  return {
    updateJordanMemory,
    getJordanInsights,
  }
}
