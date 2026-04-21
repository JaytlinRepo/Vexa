/**
 * Video Processing Metrics
 * Measures: style replication, clipping quality, processing time
 */

import { PrismaClient } from '@prisma/client'
import { Anthropic } from '@anthropic-ai/sdk'

const anthropic = new Anthropic()

interface ProcessingStage {
  name: string
  startTime: number
  endTime: number
}

interface StyleMeasurement {
  styleMatchScore: number
  colorAccuracy: number
  lightingAccuracy: number
  overallVibe: number
  issues: string[]
  summary: string
}

interface ClippingMeasurement {
  hookScore: number
  pacingScore: number
  valueScore: number
  flowScore: number
  engagementScore: number
  overallQuality: number
  issues: string[]
  summary: string
}

interface ProcessingTimeMeasurement {
  totalTime: number
  stages: Array<{
    name: string
    duration: number
    percentage: string
  }>
}

export class VideoMetricsService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Measure how well the edited clip matches creator's existing style
   */
  async measureStyleReplication(
    clipUrl: string,
    styleProfile: any,
    companyId: string
  ): Promise<StyleMeasurement> {
    try {
      // Get creator's recent posts as reference
      const recentPosts = await this.prisma.platformPost.findMany({
        where: {
          account: {
            companyId
          }
        },
        orderBy: { publishedAt: 'desc' },
        take: 5
      })

      if (recentPosts.length === 0) {
        console.log('[metrics] Not enough historical posts to measure style')
        return {
          styleMatchScore: 0.5,
          colorAccuracy: 0,
          lightingAccuracy: 0,
          overallVibe: 0,
          issues: ['Not enough historical posts to compare'],
          summary: 'Unable to measure style match - insufficient historical data'
        }
      }

      // Use Claude Vision to compare
      const message = await anthropic.messages.create({
        model: 'claude-opus-4-7',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Compare this newly edited clip to their existing posts.

Creator's style: "${styleProfile.clusterName}"
Expected aesthetic:
- Colors: ${styleProfile.colorPalette}
- Lighting: ${styleProfile.lightingStyle}
- Vibe: ${styleProfile.vibe}

Rate how well the clip matches their existing aesthetic on a 0-1 scale.

Return ONLY valid JSON (no markdown):
{
  "styleMatchScore": 0.85,
  "colorAccuracy": 0.90,
  "lightingAccuracy": 0.80,
  "overallVibe": 0.85,
  "issues": ["slightly warmer than usual"],
  "summary": "Excellent match. Color and lighting are spot-on."
}`
              },
              {
                type: 'image',
                source: { type: 'url', url: clipUrl }
              },
              ...recentPosts.map(post => ({
                type: 'image' as const,
                source: { type: 'url' as const, url: post.imageUrl }
              }))
            ]
          }
        ]
      })

      const text = message.content[0].type === 'text' ? message.content[0].text : ''
      const measurement = JSON.parse(text) as StyleMeasurement

      // Store measurement
      await this.prisma.processingMetric.create({
        data: {
          companyId,
          metricType: 'style_replication',
          value: measurement.styleMatchScore,
          details: measurement
        }
      })

      return measurement
    } catch (err) {
      console.error('[metrics] Style measurement failed:', err)
      throw err
    }
  }

  /**
   * Measure clipping quality (hook, pacing, value, flow, engagement)
   */
  async measureClippingQuality(
    clipUrl: string,
    transcript: string
  ): Promise<ClippingMeasurement> {
    try {
      const message = await anthropic.messages.create({
        model: 'claude-opus-4-7',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Analyze this edited clip's quality on a 0-1 scale:

Criteria:
1. Hook strength (first 3 seconds grab attention)
2. Pacing (smooth, not choppy)
3. Value delivered (keeps key information)
4. Narrative flow (makes sense, not jarring)
5. Engagement (would viewers watch to the end?)

Transcript excerpt:
${transcript.slice(0, 500)}

Return ONLY valid JSON (no markdown):
{
  "hookScore": 0.9,
  "pacingScore": 0.85,
  "valueScore": 0.88,
  "flowScore": 0.82,
  "engagementScore": 0.87,
  "overallQuality": 0.86,
  "issues": ["Minor jump at 22s"],
  "summary": "Strong clip. Good hook and value."
}`
              },
              {
                type: 'image',
                source: { type: 'url', url: clipUrl }
              }
            ]
          }
        ]
      })

      const text = message.content[0].type === 'text' ? message.content[0].text : ''
      const measurement = JSON.parse(text) as ClippingMeasurement

      return measurement
    } catch (err) {
      console.error('[metrics] Clipping quality measurement failed:', err)
      throw err
    }
  }

  /**
   * Track processing time across stages
   */
  async trackProcessingTime(
    companyId: string,
    stages: ProcessingStage[]
  ): Promise<ProcessingTimeMeasurement> {
    const totalTime = stages.reduce((sum, stage) => sum + (stage.endTime - stage.startTime), 0)

    const stagesWithPercentage = stages.map(stage => ({
      name: stage.name,
      duration: stage.endTime - stage.startTime,
      percentage: ((((stage.endTime - stage.startTime) / totalTime) * 100).toFixed(1))
    }))

    const measurement: ProcessingTimeMeasurement = {
      totalTime,
      stages: stagesWithPercentage
    }

    // Store metric
    await this.prisma.processingMetric.create({
      data: {
        companyId,
        metricType: 'processing_time',
        value: totalTime,
        details: measurement
      }
    })

    return measurement
  }

  /**
   * Get aggregated metrics for a company
   */
  async getAggregatedMetrics(companyId: string) {
    const metrics = await this.prisma.processingMetric.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 50
    })

    const styleMetrics = metrics
      .filter(m => m.metricType === 'style_replication')
      .map(m => m.value)

    const clippingMetrics = metrics
      .filter(m => m.metricType === 'clipping_quality')
      .map(m => m.value)

    const timeMetrics = metrics
      .filter(m => m.metricType === 'processing_time')
      .map(m => m.value)

    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b) / arr.length : 0
    const trend = (arr: number[]) => {
      if (arr.length < 2) return 'stable'
      const recent = arr.slice(0, 5)
      const older = arr.slice(5, 10)
      const recentAvg = avg(recent)
      const olderAvg = avg(older)
      if (recentAvg > olderAvg + 0.05) return 'improving'
      if (recentAvg < olderAvg - 0.05) return 'declining'
      return 'stable'
    }

    return {
      styleReplication: {
        average: parseFloat(avg(styleMetrics).toFixed(2)),
        min: Math.min(...styleMetrics),
        max: Math.max(...styleMetrics),
        trend: trend(styleMetrics),
        samples: styleMetrics.length
      },
      clippingQuality: {
        average: parseFloat(avg(clippingMetrics).toFixed(2)),
        min: Math.min(...clippingMetrics),
        max: Math.max(...clippingMetrics),
        trend: trend(clippingMetrics),
        samples: clippingMetrics.length
      },
      processingTime: {
        average: parseFloat((avg(timeMetrics) / 1000).toFixed(1)), // Convert to seconds
        min: Math.min(...timeMetrics) / 1000,
        max: Math.max(...timeMetrics) / 1000,
        trend: trend(timeMetrics.map(t => 1 / t)), // Invert for "faster is better"
        samples: timeMetrics.length
      },
      recommendation: this.getRecommendation(styleMetrics, clippingMetrics, timeMetrics)
    }
  }

  private getRecommendation(styleMetrics: number[], clippingMetrics: number[], timeMetrics: number[]) {
    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b) / arr.length : 0

    const styleAvg = avg(styleMetrics)
    const clippingAvg = avg(clippingMetrics)
    const timeAvg = avg(timeMetrics) / 1000 / 60 // Convert to minutes

    if (styleAvg >= 0.85 && clippingAvg >= 0.80 && timeAvg < 6) {
      return '✅ READY TO SHIP - All metrics excellent'
    } else if (styleAvg >= 0.80 && clippingAvg >= 0.75 && timeAvg < 7) {
      return '⚠️ GOOD - Monitor a few more samples before shipping'
    } else {
      return '❌ NEEDS WORK - Consider adding Opus for better evaluation'
    }
  }
}

export default VideoMetricsService
