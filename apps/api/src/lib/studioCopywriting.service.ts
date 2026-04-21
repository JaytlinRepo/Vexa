/**
 * Studio Copywriting Service
 * Alex's role: Generate captions, hooks, and CTAs for studio content
 * Supports video hooks, image captions, and carousel descriptions
 */

import { PrismaClient } from '@prisma/client'

export type ContentType = 'video' | 'image' | 'carousel'

export interface CopywritingRequest {
  companyId: string
  contentType: ContentType
  contentDescription?: string // What the video/image shows
  clipTranscript?: string // For videos
  feedbackHistory?: string[] // Previous rejection reasons
}

export interface CopyOption {
  id: string
  text: string
  type: 'hook' | 'caption' | 'cta'
  rationale: string
}

export interface CopywritingResult {
  hooks: CopyOption[]
  captions: CopyOption[]
  ctas: CopyOption[]
  version: number
  feedbackApplied: string[]
}

export class StudioCopywritingService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Alex generates multiple copy options for content
   * Returns hooks (for videos), captions, and CTAs
   * Incorporates feedback history for iterative improvement
   */
  async generateCopyOptions(request: CopywritingRequest): Promise<CopywritingResult> {
    const { companyId, contentType, contentDescription = '', clipTranscript = '', feedbackHistory = [] } = request

    // Get company's brand voice from memory
    const brandMemories = await this.prisma.brandMemory.findMany({
      where: {
        companyId,
        memory_type: 'voice',
      },
      orderBy: { weight: 'desc' },
      take: 5,
    })

    const brandVoice = brandMemories
      .map((m) => m.content as any)
      .reduce((acc, mem) => ({ ...acc, ...mem }), {})

    // Get recent approved captions to understand patterns
    const recentOutputs = await this.prisma.output.findMany({
      where: {
        companyId,
        type: 'caption',
        status: 'approved',
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    })

    // Build prompt context
    const prompt = this.buildCopyPrompt(
      contentType,
      contentDescription,
      clipTranscript,
      brandVoice,
      recentOutputs,
      feedbackHistory
    )

    // For now, return mock data (in production, call Claude via Bedrock)
    // This is structured so the UI can be tested immediately
    const result = this.generateMockCopyOptions(contentType, feedbackHistory)

    return result
  }

  private buildCopyPrompt(
    contentType: ContentType,
    description: string,
    transcript: string,
    brandVoice: any,
    recentOutputs: any[],
    feedbackHistory: string[]
  ): string {
    let prompt = `You are Alex, a professional copywriter. Generate compelling ${contentType === 'video' ? 'hooks and captions' : 'captions'} for social media content.\n\n`

    if (brandVoice.tone) {
      prompt += `Brand tone: ${brandVoice.tone}\n`
    }
    if (brandVoice.voiceProfile) {
      prompt += `Brand voice: ${brandVoice.voiceProfile}\n`
    }

    if (contentType === 'video') {
      prompt += `\nVideo content: ${description}\n`
      if (transcript) {
        prompt += `Transcript: ${transcript.slice(0, 500)}\n`
      }
      prompt += `\nGenerate 3 compelling hooks (opening lines) that stop the scroll and make people want to watch.\n`
    } else if (contentType === 'carousel') {
      prompt += `\nCarousel content: ${description}\n`
      prompt += `\nGenerate 3 carousel captions that tell a story across multiple slides.\n`
    } else {
      prompt += `\nImage content: ${description}\n`
      prompt += `\nGenerate 3 captions that complement the image.\n`
    }

    if (recentOutputs.length > 0) {
      prompt += `\nRecent approved examples:\n`
      recentOutputs.slice(0, 3).forEach((output) => {
        prompt += `- ${(output.content as any).text?.slice(0, 100)}\n`
      })
    }

    if (feedbackHistory.length > 0) {
      prompt += `\nPrevious feedback to improve on:\n`
      feedbackHistory.forEach((feedback) => {
        prompt += `- ${feedback}\n`
      })
    }

    return prompt
  }

  /**
   * Mock copy generation for now
   * In production: Send prompt to Claude via Bedrock
   */
  private generateMockCopyOptions(contentType: ContentType, feedbackHistory: string[]): CopywritingResult {
    const feedbackApplied = feedbackHistory.slice(0, 2) || []

    if (contentType === 'video') {
      return {
        hooks: [
          {
            id: 'hook-1',
            text: 'Wait for the ending.',
            type: 'hook',
            rationale: 'Creates curiosity, makes viewers want to see more',
          },
          {
            id: 'hook-2',
            text: 'This completely changed how I think about it.',
            type: 'hook',
            rationale: 'Emotional hook, implies transformation',
          },
          {
            id: 'hook-3',
            text: 'Most people get this wrong.',
            type: 'hook',
            rationale: 'Contrarian hook, appeals to wanting to be right',
          },
        ],
        captions: [
          {
            id: 'cap-1',
            text: '3 things I wish I knew earlier. Which one surprised you?',
            type: 'caption',
            rationale: 'Invites engagement, curiosity-driven',
          },
        ],
        ctas: [
          {
            id: 'cta-1',
            text: 'Save this for later.',
            type: 'cta',
            rationale: 'High-intent call-to-action',
          },
        ],
        version: feedbackApplied.length + 1,
        feedbackApplied,
      }
    }

    if (contentType === 'carousel') {
      return {
        hooks: [],
        captions: [
          {
            id: 'carousel-cap-1',
            text: 'Swipe to see the 5 mistakes I made (and how I fixed them)',
            type: 'caption',
            rationale: 'Encourages swiping, hints at value',
          },
        ],
        ctas: [
          {
            id: 'carousel-cta-1',
            text: 'Save this series.',
            type: 'cta',
            rationale: 'Encourages saves and archival',
          },
        ],
        version: feedbackApplied.length + 1,
        feedbackApplied,
      }
    }

    // Image
    return {
      hooks: [],
      captions: [
        {
          id: 'image-cap-1',
          text: 'One shot that says it all.',
          type: 'caption',
          rationale: 'Minimal, impactful',
        },
      ],
      ctas: [
        {
          id: 'image-cta-1',
          text: 'Drop a comment.',
          type: 'cta',
          rationale: 'Simple engagement driver',
        },
      ],
      version: feedbackApplied.length + 1,
      feedbackApplied,
    }
  }
}

export default StudioCopywritingService
