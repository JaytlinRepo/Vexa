import { invokeAgent, parseAgentOutput } from './bedrock/bedrock.service'
import { extractKeyframes } from '../lib/keyframeExtractor.service'
import prisma from '../lib/prisma'

export interface StyleProfile {
  cutSpeed: string
  subtitleDensity: 'high' | 'medium' | 'low'
  subtitleTiming: string
  zoomBehavior: {
    frequency: string
    type: string[]
  }
  visualDensity: 'high' | 'medium' | 'low'
  musicIntensity: 'high' | 'medium' | 'low'
  hookTiming: string
  ctaPlacement: string
  transitionStyle: string[]
  narrativeStructure: string
  colorGrading: string
  aspectRatio: string
  videoLength: string
  contentAngles: string[]
}

const VISION_PROMPT = `You are a video editing style analyzer. You are given keyframes extracted from a creator's Reel/Video at regular intervals.

Analyze the frames for editing patterns and respond with ONLY valid JSON:
{
  "cutSpeed": "fast/medium/slow with estimated seconds per cut",
  "visualDensity": "high/medium/low",
  "colorGrading": "description of color palette and grading style",
  "hasSubtitles": true/false,
  "subtitleStyle": "description if visible, or null",
  "transitionStyle": ["hard-cut", "fade", "zoom-in", "match-cut", etc.],
  "zoomTypes": ["punch-in", "slow-zoom", "static", "reaction-focus"],
  "hookStyle": "how the first frames grab attention",
  "narrativeStructure": "hook-story-cta / transformation / tutorial / vlog / montage",
  "contentAngle": "what type of content this is",
  "aspectRatio": "9:16 / 16:9 / 1:1"
}

Look at frame-to-frame differences to detect:
- How fast cuts happen (compare adjacent frames — similar = slow cuts, very different = fast cuts)
- Whether subtitles/text overlays are present
- Color consistency across frames (same grade = cohesive, varying = dynamic)
- Zoom patterns (close-ups vs wide shots alternating)
- Opening hook style (first 2-3 frames)`

/**
 * Analyze a single video using FFmpeg keyframes sent to Bedrock Vision
 */
async function analyzeVideoStyle(
  mediaUrl: string,
  thumbnailUrl: string | null,
  duration: number,
): Promise<Partial<StyleProfile>> {
  try {
    // Extract keyframes from the actual video via FFmpeg
    let frames: Array<{ timestamp: number; base64: string; index: number }> = []

    if (mediaUrl && mediaUrl.startsWith('http')) {
      try {
        const interval = duration > 30 ? 4 : 3
        frames = await extractKeyframes(mediaUrl, Math.max(duration, 15), interval, 8)
      } catch (err) {
        console.warn('[videoStyleAnalyzer] FFmpeg extraction failed, trying thumbnail:', (err as Error).message)
      }
    }

    // Fallback: download thumbnail as single frame
    if (frames.length === 0 && thumbnailUrl) {
      try {
        const axios = (await import('axios')).default
        const resp = await axios.get(thumbnailUrl, { responseType: 'arraybuffer', timeout: 8000 })
        const buf = Buffer.from(resp.data)
        if (buf.length > 1000) {
          frames = [{ timestamp: 0, base64: buf.toString('base64'), index: 0 }]
        }
      } catch {}
    }

    if (frames.length === 0) return {}

    // Build vision content blocks — frames + analysis prompt
    const contentBlocks: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
    > = []

    for (const frame of frames) {
      contentBlocks.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: frame.base64 },
      })
      contentBlocks.push({
        type: 'text',
        text: `Frame at ${frame.timestamp.toFixed(1)}s`,
      })
    }

    contentBlocks.push({
      type: 'text',
      text: `${frames.length} keyframes from a ${duration}s video. Analyze the editing style.`,
    })

    const raw = await invokeAgent({
      systemPrompt: VISION_PROMPT,
      messages: [{ role: 'user', content: contentBlocks }],
      maxTokens: 512,
      temperature: 0.2,
    })

    let analysis: Record<string, unknown>
    try {
      analysis = parseAgentOutput(raw)
    } catch {
      analysis = {}
    }

    return {
      cutSpeed: (analysis.cutSpeed as string) || undefined,
      visualDensity: (analysis.visualDensity as 'high' | 'medium' | 'low') || undefined,
      colorGrading: (analysis.colorGrading as string) || undefined,
      subtitleDensity: analysis.hasSubtitles ? 'high' : 'low',
      subtitleTiming: (analysis.subtitleStyle as string) || 'standard',
      transitionStyle: Array.isArray(analysis.transitionStyle) ? analysis.transitionStyle : undefined,
      zoomBehavior: {
        frequency: 'varies',
        type: Array.isArray(analysis.zoomTypes) ? analysis.zoomTypes : [],
      },
      narrativeStructure: (analysis.narrativeStructure as string) || undefined,
      aspectRatio: (analysis.aspectRatio as string) || undefined,
      contentAngles: [analysis.contentAngle as string].filter(Boolean),
    }
  } catch (err) {
    console.error('[videoStyleAnalyzer] analysis failed:', (err as Error).message)
    return {}
  }
}

/**
 * Aggregate style patterns across multiple videos
 */
function aggregateStyles(styles: Partial<StyleProfile>[]): StyleProfile {
  if (styles.length === 0) {
    return {
      cutSpeed: 'unknown',
      subtitleDensity: 'medium',
      subtitleTiming: 'standard',
      zoomBehavior: { frequency: 'moderate', type: ['punch-in'] },
      visualDensity: 'medium',
      musicIntensity: 'medium',
      hookTiming: '0-3s',
      ctaPlacement: 'end',
      transitionStyle: ['hard-cut'],
      narrativeStructure: 'standard',
      colorGrading: 'standard',
      aspectRatio: '9:16',
      videoLength: '30-60s',
      contentAngles: [],
    }
  }

  // Count occurrences
  const densityCount = { high: 0, medium: 0, low: 0 }
  const contentAngles = new Set<string>()
  const zoomTypes = new Set<string>()
  const colorGradings = new Set<string>()

  for (const style of styles) {
    if (style.visualDensity) densityCount[style.visualDensity]++
    if (style.contentAngles) style.contentAngles.forEach((a) => contentAngles.add(a))
    if (style.zoomBehavior?.type) style.zoomBehavior.type.forEach((z) => zoomTypes.add(z))
    if (style.colorGrading) colorGradings.add(style.colorGrading)
  }

  // Determine most common density
  const mostCommonDensity = (Object.entries(densityCount).sort((a, b) => b[1] - a[1])[0]?.[0] || 'medium') as 'high' | 'medium' | 'low'

  return {
    cutSpeed: 'fast (1.0-1.5s)', // Default to fast since most creators edit aggressively
    subtitleDensity: mostCommonDensity === 'high' ? 'high' : 'medium',
    subtitleTiming: 'keyword-synchronized',
    zoomBehavior: {
      frequency: '2-3 per 45s',
      type: Array.from(zoomTypes).length > 0 ? Array.from(zoomTypes) : ['punch-in'],
    },
    visualDensity: mostCommonDensity,
    musicIntensity: mostCommonDensity === 'high' ? 'high' : 'medium',
    hookTiming: '0-3s',
    ctaPlacement: 'end + mid-roll',
    transitionStyle: ['hard-cut'],
    narrativeStructure: 'hook-story-cta',
    colorGrading: Array.from(colorGradings)[0] || 'warm-saturated',
    aspectRatio: '9:16',
    videoLength: '30-60s',
    contentAngles: Array.from(contentAngles),
  }
}

/**
 * Main function: Analyze all recent videos for a company and store style profile
 */
export async function analyzeUserVideoStyle(companyId: string): Promise<StyleProfile> {
  try {
    // Get recent platform posts through their accounts
    const posts = await prisma.platformPost.findMany({
      where: {
        account: { companyId },
        thumbnailUrl: { not: null },
        mediaType: { in: ['REEL', 'VIDEO'] },
      },
      orderBy: { publishedAt: 'desc' },
      take: 15,
      select: {
        id: true,
        url: true,
        thumbnailUrl: true,
        mediaUrl: true,
        mediaType: true,
        caption: true,
        publishedAt: true,
        engagementRate: true,
      },
    })

    console.log(`[videoStyleAnalyzer] Found ${posts.length} recent posts for ${companyId}`)

    if (posts.length === 0) {
      console.warn('[videoStyleAnalyzer] No posts found, returning default profile')
      return aggregateStyles([])
    }

    // Analyze each video — use mediaUrl (direct video file) for FFmpeg keyframes,
    // fall back to thumbnailUrl (static image) if no video URL available
    const styles: Partial<StyleProfile>[] = []
    for (const post of posts) {
      if (!post.mediaUrl && !post.thumbnailUrl) continue
      try {
        const duration = 45 // estimate for short-form
        const style = await analyzeVideoStyle(post.mediaUrl || '', post.thumbnailUrl, duration)
        if (Object.keys(style).length > 0) {
          styles.push(style)
          console.log(`[videoStyleAnalyzer] analyzed ${post.id}: ${post.mediaUrl ? 'video keyframes' : 'thumbnail'}`)
        }
      } catch (err) {
        console.warn(`[videoStyleAnalyzer] Failed to analyze post ${post.id}:`, (err as Error).message)
      }
      // Rate limit between Bedrock calls
      await new Promise((r) => setTimeout(r, 1500))
    }

    console.log(`[videoStyleAnalyzer] Analyzed ${styles.length} videos`)

    // Aggregate into profile
    const profile = aggregateStyles(styles)

    // Store in brand_memory using 'preference' as memoryType
    // First, try to find existing style preference
    const existing = await prisma.brandMemory.findFirst({
      where: {
        companyId,
        memoryType: 'preference',
      },
    })

    if (existing) {
      await prisma.brandMemory.update({
        where: { id: existing.id },
        data: {
          content: profile as any,
        },
      })
    } else {
      await prisma.brandMemory.create({
        data: {
          companyId,
          memoryType: 'preference',
          content: profile as any,
          weight: 1.0,
        },
      })
    }

    console.log(`[videoStyleAnalyzer] Stored style profile for ${companyId}`)
    return profile
  } catch (err) {
    console.error('[videoStyleAnalyzer] Analysis failed:', err)
    return aggregateStyles([])
  }
}

/**
 * Get stored style profile for a company
 */
export async function getStyleProfile(companyId: string): Promise<StyleProfile | null> {
  try {
    const memory = await prisma.brandMemory.findFirst({
      where: {
        companyId,
        memoryType: 'preference',
      },
    })

    if (!memory) return null
    return memory.content as unknown as StyleProfile
  } catch (err) {
    console.error('[videoStyleAnalyzer] Failed to get style profile:', err)
    return null
  }
}
