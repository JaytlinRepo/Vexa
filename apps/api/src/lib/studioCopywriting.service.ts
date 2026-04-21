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

    // Get the user's REAL post captions — this is how they actually write
    const realPosts = await this.prisma.platformPost.findMany({
      where: {
        account: { companyId },
        caption: { not: '' },
      },
      orderBy: { engagementRate: 'desc' },
      take: 10,
      select: { caption: true, engagementRate: true, mediaType: true },
    })

    // Build prompt context
    const userPrompt = this.buildCopyPrompt(
      contentType,
      contentDescription,
      clipTranscript,
      brandVoice,
      recentOutputs,
      feedbackHistory,
      realPosts,
    )

    try {
      const systemPrompt = `You are Alex, the Copywriter. Creative, punchy, opinionated. Every word earns its place.

You're writing captions for a short-form reel. You'll receive context about the video — what's visually happening, the vibe, and any transcript. Use this to understand the CONTENT CATEGORY and MOOD, then write captions that match that energy.

Your job is NOT to narrate what's on screen. Your job is to capture the LIFESTYLE, FEELING, and VIBE of the content. The visual context tells you what kind of content this is — lifestyle, fitness, food, travel, etc. Write for that category.

Example: A video of someone loading a car with a dog is LIFESTYLE content. Don't write "Watch me load my trunk." Write something that captures the feeling — the ease, the aesthetic, the day-in-the-life energy.

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
- Generate exactly 3 hooks that match the VIBE and CATEGORY of the content
- Generate 1 caption (body text that captures the lifestyle/feeling — include relevant hashtags)
- Generate 1 CTA (natural, not salesy)
- Don't narrate — evoke. Don't describe — capture the mood
- No generic motivational lines that could apply to any video
- MATCH THE CREATOR'S VOICE — if they write short and minimal, you write short and minimal
- Include hashtags that fit the content category and match the creator's hashtag style
- The caption should feel like the CREATOR wrote it, not a copywriter
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
    feedbackHistory: string[],
    realPosts?: Array<{ caption: string | null; engagementRate: number; mediaType: string }>,
  ): string {
    let prompt = ''

    // Brand voice context
    if (brandVoice.tone) prompt += `Brand tone: ${brandVoice.tone}\n`
    if (brandVoice.voiceProfile) prompt += `Brand voice: ${brandVoice.voiceProfile}\n`

    // The user's REAL caption style — this is how they actually write
    if (realPosts && realPosts.length > 0) {
      const topCaptions = realPosts
        .filter(p => p.caption && p.caption.length > 5)
        .slice(0, 6)
      if (topCaptions.length > 0) {
        prompt += `\nTHIS CREATOR'S ACTUAL CAPTION STYLE (from their best-performing posts — MATCH THIS TONE AND LENGTH):\n`
        topCaptions.forEach(p => {
          prompt += `- "${p.caption!.slice(0, 200)}" (${(p.engagementRate * 100).toFixed(1)}% engagement)\n`
        })
        prompt += `\nStudy these. Match their voice, their length, their energy. If they write short and minimal, you write short and minimal. If they use hashtags, include similar hashtags.\n`
      }
    }

    // Video context
    if (contentType === 'video') {
      if (description) prompt += `\nVideo context (what's visually happening):\n${description}\n`
      if (transcript) prompt += `\nTranscript: "${transcript.slice(0, 500)}"\n`
    } else if (contentType === 'carousel') {
      prompt += `\nCarousel content: ${description}\n`
    } else {
      prompt += `\nImage content: ${description}\n`
    }

    // Previous feedback
    if (feedbackHistory.length > 0) {
      prompt += `\nPrevious feedback to improve on:\n`
      feedbackHistory.forEach(f => { prompt += `- ${f}\n` })
    }

    prompt += `\nWrite captions and hooks that sound like THIS CREATOR wrote them. Include relevant hashtags based on their hashtag style.\n`

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
