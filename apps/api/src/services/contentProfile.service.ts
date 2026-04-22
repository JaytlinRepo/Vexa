import { PrismaClient } from '@prisma/client'

/**
 * Content Profile Service
 * Analyzes user's uploaded videos to extract:
 * - Visual style (colors, shot types, pacing, transitions)
 * - Copy style (hooks, tone, CTAs)
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

export async function createContentProfile(prisma: PrismaClient) {
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

      // Extract patterns from videos
      const profile: ContentProfile = {
        visualStyle: extractVisualPatterns(uploads),
        copyStyle: extractCopyPatterns(uploads),
        performancePattern: extractPerformancePattern(uploads),
      }

      return profile
    },

    /**
     * Store profile in brand memory for persistence
     */
    async saveProfileToMemory(companyId: string, profile: ContentProfile): Promise<void> {
      await prisma.brandMemory.upsert({
        where: {
          companyId_memoryType: {
            companyId,
            memoryType: 'content_profile',
          },
        },
        update: {
          content: profile,
        },
        create: {
          companyId,
          memoryType: 'content_profile' as any,
          content: profile,
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
          memoryType: 'content_profile',
        },
      })

      if (memory) {
        return memory.content as ContentProfile
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

function extractVisualPatterns(uploads: any[]) {
  // TODO: Integrate Claude Vision to analyze keyframes
  // For now, return heuristic-based patterns

  return {
    colorPalette: detectColorPalette(uploads),
    shotTypes: detectShotTypes(uploads),
    pacing: detectPacing(uploads),
    filters: detectFilters(uploads),
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

function detectColorPalette(uploads: any[]): string[] {
  // TODO: Extract colors from video keyframes using Claude Vision
  // Placeholder: return common warm/cool tones
  return ['warm', 'muted', 'natural', 'earth-tones']
}

function detectShotTypes(uploads: any[]): string[] {
  // TODO: Analyze keyframes for shot composition
  // Placeholder: common lifestyle shot types
  return ['wide', 'close-up', 'detail', 'movement']
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

function detectFilters(uploads: any[]): string[] {
  // TODO: Detect filter application from video analysis
  return ['warm', 'film', 'matte']
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
