/**
 * Studio Copywriting Service
 * Alex's role: Generate captions, hooks, and CTAs for studio content
 * Supports video hooks, image captions, and carousel descriptions
 */

import { PrismaClient } from '@prisma/client'
import { invokeAgent, parseAgentOutput } from '../services/bedrock/bedrock.service'

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
        memoryType: 'voice',
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
    const userPrompt = this.buildCopyPrompt(
      contentType,
      contentDescription,
      clipTranscript,
      brandVoice,
      recentOutputs,
      feedbackHistory
    )

    try {
      const systemPrompt = `You are Alex, the Copywriter. Creative, punchy, opinionated. Every word earns its place.

You're writing captions for a short-form reel. You'll receive a VISUAL DESCRIPTION of what's in the video (from Riley, the editor) plus any transcript. Your captions MUST match what's actually shown in the video.

CRITICAL: Write about what's VISUALLY HAPPENING, not generic motivational lines. If the video shows someone loading a car with a dog, the caption should be about that — not "get ready for the best." Be specific to the content.

You MUST respond in valid JSON with this exact structure:
{
  "hooks": [
    { "id": "hook-1", "text": "string", "type": "hook", "rationale": "string" },
    { "id": "hook-2", "text": "string", "type": "hook", "rationale": "string" },
    { "id": "hook-3", "text": "string", "type": "hook", "rationale": "string" }
  ],
  "captions": [
    { "id": "cap-1", "text": "string", "type": "caption", "rationale": "string" }
  ],
  "ctas": [
    { "id": "cta-1", "text": "string", "type": "cta", "rationale": "string" }
  ]
}

Rules:
- Generate exactly 3 hooks that reference what's VISUALLY happening in the reel
- Generate 1 caption (body text that tells the story of the visual sequence)
- Generate 1 CTA (natural, not salesy)
- Each rationale explains WHY it works for this audience
- If the video has minimal speech, the captions carry the narrative — make them vivid and specific
- NEVER write generic hooks. Every hook must connect to the actual video content
- NEVER add prose outside the JSON`

      const raw = await invokeAgent({
        systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        maxTokens: 1024,
        temperature: 0.8,
        companyId,
      })

      const parsed = parseAgentOutput<{ hooks: CopyOption[]; captions: CopyOption[]; ctas: CopyOption[] }>(raw)

      return {
        hooks: parsed.hooks || [],
        captions: parsed.captions || [],
        ctas: parsed.ctas || [],
        version: feedbackHistory.length + 1,
        feedbackApplied: feedbackHistory.slice(0, 2),
      }
    } catch (err) {
      console.error('[studio-copy] Bedrock call failed, falling back to mock:', err)
      return this.generateMockCopyOptions(contentType, feedbackHistory)
    }
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
      if (description) {
        prompt += `\nVideo context: ${description}\n`
      }
      if (transcript) {
        prompt += `\nActual transcript of the clip (USE THIS — captions MUST relate to what's actually said):\n"${transcript.slice(0, 1500)}"\n`
      }
      prompt += `\nGenerate 3 compelling hooks that match the actual content of this video. The hooks should reference or play off what's actually said/shown.\n`
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
