/**
 * Studio Visual Editing Service
 * Riley's role: Apply style-based edits to clips via Descript's agent.
 * When a user rejects, we re-run the agent with their feedback as the prompt.
 */

import { PrismaClient } from '@prisma/client'
import DescriptClient from './descript.service'

export interface VisualEditRequest {
  clipId: string
  companyId: string
  clipUrl: string // Descript project URL or project ID
  feedbackHistory?: string[] // Previous rejection reasons
}

export interface VisualEditResult {
  editedUrl: string // Updated Descript project URL
  styleMetrics: {
    styleReplication: number
    colorAccuracy: number
    lightingAccuracy: number
    vibeMatch: number
    analysis: string
  }
  adjustments: Record<string, number>
  version: number
}

export class StudioVisualEditingService {
  private descript: DescriptClient

  constructor(private prisma: PrismaClient) {
    this.descript = new DescriptClient()
  }

  /**
   * Riley re-edits a clip using Descript's agent with user feedback.
   * The feedback (e.g. "too warm", "too dark") becomes the agent prompt.
   */
  async editClip(request: VisualEditRequest): Promise<VisualEditResult> {
    const { clipId, companyId, clipUrl, feedbackHistory = [] } = request

    // Get the Descript project ID from the clip
    const clip = await this.prisma.videoClip.findUnique({
      where: { id: clipId },
    })

    const descriptProjectId = clip?.descriptVideoId
    if (!descriptProjectId) {
      throw new Error('No Descript project ID found for this clip')
    }

    // Build the re-edit prompt from feedback
    const prompt = this.buildFeedbackPrompt(feedbackHistory)

    // Run the agent edit
    const editJob = await this.descript.agentEdit(descriptProjectId, prompt)
    const result = await this.descript.waitForJob(editJob.job_id, 300000)

    const version = ((clip?.adjustments as any)?.version ?? 0) + 1

    return {
      editedUrl: result.project_url,
      styleMetrics: {
        styleReplication: 0.85, // Placeholder until vision metrics enabled
        colorAccuracy: 0.82,
        lightingAccuracy: 0.80,
        vibeMatch: 0.85,
        analysis: result.result?.agent_response || 'Re-edit applied based on feedback',
      },
      adjustments: { version },
      version,
    }
  }

  /**
   * Convert user feedback into a Descript agent prompt.
   */
  private buildFeedbackPrompt(feedbackHistory: string[]): string {
    if (feedbackHistory.length === 0) {
      return 'Improve the color grading and pacing of this clip.'
    }

    const feedbackStr = feedbackHistory.join('. ')
    const parts: string[] = []

    // Parse feedback into actionable instructions
    const lower = feedbackStr.toLowerCase()

    if (lower.includes('too warm') || lower.includes('warm')) {
      parts.push('Make the color temperature cooler')
    }
    if (lower.includes('too cool') || lower.includes('cold')) {
      parts.push('Make the color temperature warmer')
    }
    if (lower.includes('too bright') || lower.includes('blown out')) {
      parts.push('Reduce brightness')
    }
    if (lower.includes('too dark') || lower.includes('muddy')) {
      parts.push('Increase brightness')
    }
    if (lower.includes('too vibrant') || lower.includes('oversaturated')) {
      parts.push('Reduce saturation')
    }
    if (lower.includes('too dull') || lower.includes('desaturated')) {
      parts.push('Increase saturation and vibrancy')
    }
    if (lower.includes('grainy') || lower.includes('noisy')) {
      parts.push('Remove film grain and noise')
    }
    if (lower.includes('contrast')) {
      parts.push('Adjust the contrast')
    }
    if (lower.includes('pacing') || lower.includes('slow') || lower.includes('fast')) {
      parts.push('Adjust the pacing of the cuts')
    }

    // If we couldn't parse specific instructions, use the raw feedback
    if (parts.length === 0) {
      parts.push(`Apply these edits: ${feedbackStr}`)
    }

    return parts.join('. ') + '.'
  }
}

export default StudioVisualEditingService
