/**
 * Studio Visual Editing Service
 * Riley's role: Apply style-based edits to clips
 * Measures: style replication quality (Claude Vision)
 */

import { PrismaClient } from '@prisma/client'
import { RunwayService } from './runway.service'
import { VideoMetricsService } from './videoMetrics.service'

export interface VisualEditRequest {
  clipId: string
  companyId: string
  clipUrl: string
  styleProfileId?: string
  feedbackHistory?: string[] // Previous rejection reasons
}

export interface VisualEditResult {
  editedUrl: string
  styleMetrics: {
    styleReplication: number // 0-1
    colorAccuracy: number
    lightingAccuracy: number
    vibeMatch: number
    analysis: string
  }
  adjustments: Record<string, number>
  version: number
}

export class StudioVisualEditingService {
  private runway: RunwayService
  private metrics: VideoMetricsService

  constructor(private prisma: PrismaClient) {
    this.runway = new RunwayService()
    this.metrics = new VideoMetricsService(prisma)
  }

  /**
   * Riley edits a clip with style-based color grading
   * Incorporates feedback history for iterative improvement
   */
  async editClip(request: VisualEditRequest): Promise<VisualEditResult> {
    const { clipId, companyId, clipUrl, feedbackHistory = [] } = request

    // Get company's style profile(s) from brand memory
    const styleProfiles = await this.prisma.brandMemory.findMany({
      where: {
        companyId,
        memory_type: 'voice', // Style profiles stored as voice memory
      },
      orderBy: { weight: 'desc' },
      take: 1,
    })

    const styleProfile = styleProfiles[0]?.content as any || this.getDefaultStyleProfile()

    // Apply feedback adjustments if available
    let adjustments = this.getBaseAdjustments(styleProfile)

    if (feedbackHistory.length > 0) {
      adjustments = this.applyFeedbackAdjustments(adjustments, feedbackHistory)
    }

    // Apply edits via Runway
    const editedUrl = await this.runway.editVideo(clipUrl, {
      colorGrading: {
        temperature: adjustments.colorTemperature,
        saturation: adjustments.saturation,
        contrast: adjustments.contrast,
        warmth: adjustments.warmth,
      },
      effects: {
        filmGrain: adjustments.filmGrain,
        vignette: adjustments.vignette,
      },
    })

    // Measure style replication quality
    const styleMetrics = await this.metrics.measureStyleReplication(
      editedUrl,
      styleProfile,
      companyId
    )

    // Store edit version in database
    const videoClip = await this.prisma.videoClip.findUnique({
      where: { id: clipId },
    })

    const version = (videoClip?.adjustments as any)?.version ?? 0

    return {
      editedUrl,
      styleMetrics,
      adjustments,
      version: version + 1,
    }
  }

  /**
   * Get base adjustments from style profile
   */
  private getBaseAdjustments(styleProfile: any) {
    return {
      colorTemperature: styleProfile.colorTemperature ?? 3200,
      saturation: styleProfile.saturation ?? 0,
      contrast: styleProfile.contrast ?? 0,
      warmth: styleProfile.warmth ?? 0,
      filmGrain: styleProfile.filmGrain ?? 0.05,
      vignette: styleProfile.vignette ?? 0,
    }
  }

  /**
   * Adjust parameters based on user feedback
   * E.g. "too warm" → reduce warmth, "too bright" → reduce contrast
   */
  private applyFeedbackAdjustments(
    baseAdjustments: Record<string, number>,
    feedbackHistory: string[]
  ): Record<string, number> {
    const adjustments = { ...baseAdjustments }
    const feedbackStr = feedbackHistory.join(' ').toLowerCase()

    // Tone adjustments
    if (feedbackStr.includes('too warm') || feedbackStr.includes('warm')) {
      adjustments.warmth = Math.max(adjustments.warmth - 10, -30)
      adjustments.colorTemperature = Math.max(adjustments.colorTemperature - 200, 2700)
    }
    if (feedbackStr.includes('too cool') || feedbackStr.includes('cold')) {
      adjustments.warmth = Math.min(adjustments.warmth + 10, 30)
      adjustments.colorTemperature = Math.min(adjustments.colorTemperature + 200, 6500)
    }

    // Saturation adjustments
    if (feedbackStr.includes('too vibrant') || feedbackStr.includes('oversaturated')) {
      adjustments.saturation = Math.max(adjustments.saturation - 15, -50)
    }
    if (feedbackStr.includes('too dull') || feedbackStr.includes('desaturated')) {
      adjustments.saturation = Math.min(adjustments.saturation + 15, 50)
    }

    // Brightness/contrast adjustments
    if (feedbackStr.includes('too bright') || feedbackStr.includes('blown out')) {
      adjustments.contrast = Math.max(adjustments.contrast - 10, -30)
    }
    if (feedbackStr.includes('too dark') || feedbackStr.includes('muddy')) {
      adjustments.contrast = Math.min(adjustments.contrast + 10, 30)
    }

    // Film grain adjustments
    if (feedbackStr.includes('too grainy') || feedbackStr.includes('noisy')) {
      adjustments.filmGrain = Math.max(adjustments.filmGrain - 0.1, 0)
    }
    if (feedbackStr.includes('too clean') || feedbackStr.includes('sterile')) {
      adjustments.filmGrain = Math.min(adjustments.filmGrain + 0.1, 0.3)
    }

    return adjustments
  }

  private getDefaultStyleProfile() {
    return {
      colorTemperature: 3200,
      saturation: 0,
      contrast: 0,
      warmth: 0,
      filmGrain: 0.05,
      vignette: 0,
    }
  }
}

export default StudioVisualEditingService
