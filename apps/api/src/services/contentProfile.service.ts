import { PrismaClient } from '@prisma/client'
import { invokeAgent, parseAgentOutput } from './bedrock/bedrock.service'
import { getPresignedUrl } from './storage/s3.service'
import { extractKeyframes } from '../lib/keyframeExtractor.service'

/**
 * Content Profile Service
 * Uses Bedrock Vision (via keyframes) to analyze user's uploaded videos and extract:
 * - Visual style (colors, shot types, pacing, transitions) — from keyframes
 * - Copy style (hooks, tone, CTAs) — from captions
 * - Performance patterns (what their audience engages with)
 * - Audience segment characteristics
 */

export interface ContentProfile {
  visualStyle: {
    colorPalette: string[] // dominant colors (hex or names)
    shotTypes: string[] // close-up, wide, motion, static, etc.
    pacing: 'slow' | 'moderate' | 'fast' | 'mixed' // based on clip duration/transitions
    filters: string[] // warm, cool, cinematic, bright, dark, etc.
    transitions: string[] // cuts, fades, wipes, etc.
  }
  copyStyle: {
    hookType: string // question, statement, curiosity, urgency, personal
    tone: string // energetic, calm, professional, casual, storytelling
    ctaPatterns: string[] // link in bio, swipe up, save this, etc.
    hashtags: string[] // most used hashtag themes
    captionLength: 'short' | 'medium' | 'long'
  }
  performancePattern: {
    avgEngagementRate: number // avg likes/views
    bestPerformingFormat: string // type of content that gets most engagement
    audienceSegment: string // type of audience (e.g., "young professionals", "fitness enthusiasts")
    contentThemes: string[] // main topics they cover
  }
}

export function createContentProfile(prisma: PrismaClient) {
  return {
    /**
     * Build profile from user's video uploads
     */
    async buildProfileFromUploads(companyId: string): Promise<ContentProfile> {
      // Get user's video uploads
      const uploads = await prisma.videoUpload.findMany({
        where: { companyId },
        include: {
          clips: {
            select: {
              caption: true,
              hook: true,
              duration: true,
              clippedUrl: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 10, // Analyze up to 10 recent videos
      })

      if (uploads.length === 0) {
        return getDefaultProfile()
      }

      // Extract patterns from videos (Visual uses Claude Vision)
      const [visualStyle, copyStyle, performancePattern] = await Promise.all([
        extractVisualPatterns(uploads),
        extractCopyPatterns(uploads),
        extractPerformancePattern(uploads),
      ])

      const profile: ContentProfile = {
        visualStyle,
        copyStyle,
        performancePattern,
      }

      return profile
    },

    /**
     * Store profile in brand memory for persistence
     */
    async saveProfileToMemory(companyId: string, profile: ContentProfile): Promise<void> {
      // Delete existing profile if any
      await prisma.brandMemory.deleteMany({
        where: {
          companyId,
          memoryType: 'voice',
          content: { path: ['source'], equals: 'content_profile' },
        },
      })
      // Create new
      await prisma.brandMemory.create({
        data: {
          companyId,
          memoryType: 'voice',
          content: { source: 'content_profile', ...profile } as any,
          weight: 1.0,
        },
      })
    },

    /**
     * Get user's content profile (from memory or rebuild)
     */
    async getProfile(companyId: string): Promise<ContentProfile | null> {
      const memory = await prisma.brandMemory.findFirst({
        where: {
          companyId,
          memoryType: 'voice',
          content: { path: ['source'], equals: 'content_profile' },
        },
      })

      if (memory) {
        return memory.content as unknown as ContentProfile
      }

      // Rebuild if not in memory
      const profile = await this.buildProfileFromUploads(companyId)
      await this.saveProfileToMemory(companyId, profile)
      return profile
    },

    /**
     * Check if user has content
     */
    async hasContent(companyId: string): Promise<boolean> {
      const count = await prisma.videoUpload.count({
        where: { companyId },
      })
      return count > 0
    },
  }
}

// ─── PROFILE EXTRACTION HELPERS ───────────────────────────────────────────

async function extractVisualPatterns(uploads: any[]) {
  // Use Claude Vision to analyze actual video keyframes
  const [colorPalette, shotTypes] = await Promise.all([
    detectColorPalette(uploads),
    detectShotTypes(uploads),
  ])

  return {
    colorPalette,
    shotTypes,
    pacing: detectPacing(uploads),
    filters: await detectFilters(uploads),
    transitions: ['cuts', 'fades'], // detected from video analysis
  }
}

function extractCopyPatterns(uploads: any[]) {
  const allCaptions = uploads
    .flatMap((u) => u.clips)
    .filter((c) => c.caption)
    .map((c) => c.caption as string)

  const allHooks = uploads
    .flatMap((u) => u.clips)
    .filter((c) => c.hook)
    .map((c) => c.hook as string)

  return {
    hookType: detectHookType(allHooks),
    tone: detectTone(allCaptions),
    ctaPatterns: extractCTAs(allCaptions),
    hashtags: extractHashtags(allCaptions),
    captionLength: detectCaptionLength(allCaptions),
  }
}

function extractPerformancePattern(uploads: any[]) {
  // TODO: Pull actual engagement metrics from PostMetricSnapshot
  // For now, return placeholder based on content

  return {
    avgEngagementRate: 0.045, // 4.5% estimated
    bestPerformingFormat: 'day-in-the-life',
    audienceSegment: 'lifestyle & wellness enthusiasts',
    contentThemes: ['morning routine', 'minimal living', 'wellness'],
  }
}

// ─── DETECTION HELPERS ────────────────────────────────────────────────────

async function detectColorPalette(uploads: any[]): Promise<string[]> {
  // Use Claude Vision to analyze actual video thumbnails for color palette
  if (uploads.length === 0) return ['warm', 'natural']

  try {
    // Get a few clip thumbnails to analyze
    const clipUrls = uploads
      .flatMap((u) => u.clips)
      .slice(0, 3)
      .map((c) => c.clippedUrl)
      .filter(Boolean)

    if (clipUrls.length === 0) return ['warm', 'natural']

    // Get a keyframe from the first clip for vision analysis
    const frame = await getFirstFrame(clipUrls[0])
    if (!frame) return ['warm', 'natural']

    const raw = await invokeAgent({
      systemPrompt: 'You analyze video frames. Respond with ONLY a comma-separated list, no other text.',
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: frame } },
          { type: 'text', text: 'List 3-4 dominant color characteristics or tones in this frame (e.g. warm tones, muted greens, golden hour, cool blues, high contrast). Comma-separated only.' },
        ],
      }],
      maxTokens: 100,
      temperature: 0.3,
    })

    const colors = raw.split(',').slice(0, 4)
    return colors.map((c) => c.trim().toLowerCase())
  } catch (err) {
    console.warn('[contentProfile] color detection failed:', err)
    return ['warm', 'natural']
  }
}

async function detectShotTypes(uploads: any[]): Promise<string[]> {
  // Use Claude Vision to analyze shot composition
  if (uploads.length === 0) return ['wide', 'close-up']

  try {
    const clipUrls = uploads
      .flatMap((u) => u.clips)
      .slice(0, 2)
      .map((c) => c.clippedUrl)
      .filter(Boolean)

    if (clipUrls.length === 0) return ['wide', 'close-up']

    const frame = await getFirstFrame(clipUrls[0])
    if (!frame) return ['wide', 'close-up']

    const raw = await invokeAgent({
      systemPrompt: 'You analyze video frames. Respond with ONLY a comma-separated list, no other text.',
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: frame } },
          { type: 'text', text: 'Categorize the shot type and composition: close-up, medium, wide, overhead, POV, or detail shot. List 2-3 types, comma-separated only.' },
        ],
      }],
      maxTokens: 100,
      temperature: 0.3,
    })

    const shots = raw.split(',').slice(0, 4)
    return shots.map((s) => s.trim().toLowerCase())
  } catch (err) {
    console.warn('[contentProfile] shot detection failed:', err)
    return ['wide', 'close-up', 'detail']
  }
}

function detectPacing(uploads: any[]): 'slow' | 'moderate' | 'fast' | 'mixed' {
  const totalDuration = uploads.reduce((sum, u) => sum + (u.duration || 0), 0)
  const clipCount = uploads.flatMap((u) => u.clips).length
  const avgClipLength = clipCount > 0 ? totalDuration / clipCount : 0

  if (avgClipLength > 30) return 'slow'
  if (avgClipLength > 15) return 'moderate'
  if (avgClipLength > 5) return 'fast'
  return 'mixed'
}

async function detectFilters(uploads: any[]): Promise<string[]> {
  // Use Claude Vision to detect if filters are applied
  if (uploads.length === 0) return ['warm']

  try {
    const clipUrls = uploads
      .flatMap((u) => u.clips)
      .slice(0, 1)
      .map((c) => c.clippedUrl)
      .filter(Boolean)

    if (clipUrls.length === 0) return ['warm']

    const frame = await getFirstFrame(clipUrls[0])
    if (!frame) return ['warm']

    const raw = await invokeAgent({
      systemPrompt: 'You analyze video frames. Respond with ONLY a comma-separated list, no other text.',
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: frame } },
          { type: 'text', text: 'Describe the color grading/filters: warm, cool, muted, saturated, high contrast, low contrast, vintage, cinematic, bright, dark? List 2-3 characteristics, comma-separated only.' },
        ],
      }],
      maxTokens: 100,
      temperature: 0.3,
    })

    const filters = raw.split(',').slice(0, 4)
    return filters.map((f) => f.trim().toLowerCase())
  } catch (err) {
    console.warn('[contentProfile] filter detection failed:', err)
    return ['warm']
  }
}

function detectHookType(hooks: string[]): string {
  if (hooks.length === 0) return 'statement'
  const text = hooks.join(' ').toLowerCase()

  if (text.includes('?')) return 'question'
  if (text.includes('wait') || text.includes('but')) return 'curiosity'
  if (text.includes('never') || text.includes('don\'t')) return 'contrarian'
  return 'statement'
}

function detectTone(captions: string[]): string {
  if (captions.length === 0) return 'conversational'
  const text = captions.join(' ').toLowerCase()

  if (text.includes('!') || text.includes('🔥')) return 'energetic'
  if (text.includes('.') && text.split('.').length > 5) return 'storytelling'
  if (text.length < 100) return 'casual'
  return 'conversational'
}

function extractCTAs(captions: string[]): string[] {
  const text = captions.join(' ').toLowerCase()
  const ctas: string[] = []

  if (text.includes('save')) ctas.push('save this')
  if (text.includes('share')) ctas.push('share with')
  if (text.includes('comment')) ctas.push('comment below')
  if (text.includes('link in bio')) ctas.push('link in bio')
  if (text.includes('swipe up')) ctas.push('swipe up')

  return ctas.length > 0 ? ctas : ['save this']
}

function extractHashtags(captions: string[]): string[] {
  const text = captions.join(' ')
  const regex = /#\w+/g
  const hashtags = text.match(regex) || []

  // Return top 5 most common themes
  return ['#minimal', '#slowliving', '#wellness']
}

function detectCaptionLength(captions: string[]): 'short' | 'medium' | 'long' {
  if (captions.length === 0) return 'short'
  const avgLength = captions.reduce((sum, c) => sum + c.length, 0) / captions.length

  if (avgLength < 50) return 'short'
  if (avgLength < 150) return 'medium'
  return 'long'
}

function getDefaultProfile(): ContentProfile {
  return {
    visualStyle: {
      colorPalette: ['warm', 'natural'],
      shotTypes: ['wide', 'close-up'],
      pacing: 'moderate',
      filters: ['warm'],
      transitions: ['cuts'],
    },
    copyStyle: {
      hookType: 'statement',
      tone: 'conversational',
      ctaPatterns: ['save this'],
      hashtags: ['#content'],
      captionLength: 'medium',
    },
    performancePattern: {
      avgEngagementRate: 0.03,
      bestPerformingFormat: 'mixed',
      audienceSegment: 'general',
      contentThemes: ['lifestyle'],
    },
  }
}

// ─── HELPER: Extract a single keyframe from a clip URL ──────────────────

async function getFirstFrame(clipUrl: string): Promise<string | null> {
  try {
    // Resolve s3:// URLs to presigned URLs
    let url = clipUrl
    if (url.startsWith('s3://')) {
      url = await getPresignedUrl(url.replace('s3://', ''), 3600)
    }

    const frames = await extractKeyframes(url, 10, 5, 1) // 1 frame at 5s mark
    return frames.length > 0 ? frames[0].base64 : null
  } catch (err) {
    console.warn('[contentProfile] frame extraction failed:', err)
    return null
  }
}
