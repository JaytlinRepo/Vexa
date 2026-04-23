import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import prisma from '../lib/prisma'

const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_BEDROCK_REGION || 'us-east-1' })

export interface StyleProfile {
  cutSpeed: string // e.g., "1.2-1.5s per cut" or "fast (0.8-1.0s)"
  subtitleDensity: 'high' | 'medium' | 'low'
  subtitleTiming: string // e.g., "keyword-synchronized"
  zoomBehavior: {
    frequency: string // e.g., "2-3 per 45s"
    type: string[] // e.g., ["punch-in", "slow-zoom", "reaction-focus"]
  }
  visualDensity: 'high' | 'medium' | 'low'
  musicIntensity: 'high' | 'medium' | 'low'
  hookTiming: string // e.g., "0-3 seconds"
  ctaPlacement: string // e.g., "end + mid-roll"
  transitionStyle: string[] // e.g., ["hard-cut", "fade", "match-cut"]
  narrativeStructure: string // e.g., "problem-solution" or "hook-story-cta"
  colorGrading: string // e.g., "warm-saturated" or "cool-muted"
  aspectRatio: string // e.g., "9:16 vertical"
  videoLength: string // e.g., "30-60 seconds average"
  contentAngles: string[] // detected types: e.g., ["transformation", "educational", "storytelling"]
}

/**
 * Analyze a single video's keyframes to detect editing patterns
 */
async function analyzeVideoStyle(videoUrl: string, duration: number): Promise<Partial<StyleProfile>> {
  if (!videoUrl || !videoUrl.startsWith('http')) {
    return {}
  }

  try {
    // Fetch the video (or thumbnail for MVP)
    // For MVP, we'll analyze the poster image/thumbnail
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)

    let response
    try {
      response = await fetch(videoUrl, { signal: controller.signal })
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) return {}

    const buffer = await response.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')

    // Call Bedrock Vision to analyze the image/poster
    const visionResponse = await bedrockClient.send(
      new InvokeModelCommand({
        modelId: process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/jpeg',
                    data: base64,
                  },
                },
                {
                  type: 'text',
                  text: `Analyze this video thumbnail/poster for editing style. Identify:
1. Visual density (how much is happening in frame)
2. Color grading (warm/cool, saturated/muted, contrast level)
3. Subtitle presence and style if visible
4. Zoom/focal point emphasis
5. Aspect ratio
6. Content angle (transformation, educational, storytelling, entertainment, etc.)

Respond as JSON:
{
  "visualDensity": "high/medium/low",
  "colorGrading": "description",
  "hasSubtitles": boolean,
  "subtitleStyle": "description if present",
  "zoomStyle": "punch-in/slow-zoom/static/other",
  "aspectRatio": "9:16/16:9/1:1/other",
  "contentAngle": "angle detected"
}`,
                },
              ],
            },
          ],
        }),
      }),
    )

    const responseBody = JSON.parse(new TextDecoder().decode(visionResponse.body as Uint8Array))
    const analysisText = responseBody.content?.[0]?.text || '{}'
    let analysis

    try {
      analysis = JSON.parse(analysisText)
    } catch {
      analysis = {}
    }

    return {
      visualDensity: analysis.visualDensity,
      colorGrading: analysis.colorGrading,
      subtitleDensity: analysis.hasSubtitles ? 'high' : 'low',
      subtitleTiming: analysis.subtitleStyle || 'standard',
      zoomBehavior: {
        frequency: 'varies',
        type: [analysis.zoomStyle].filter(Boolean),
      },
      aspectRatio: analysis.aspectRatio,
      contentAngles: [analysis.contentAngle].filter(Boolean),
    }
  } catch (err) {
    console.error('[videoStyleAnalyzer] Vision analysis failed:', err)
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

    // Analyze each post's thumbnail (direct CDN URL, not Instagram permalink)
    const styles: Partial<StyleProfile>[] = []
    for (const post of posts) {
      if (!post.thumbnailUrl) continue
      try {
        const duration = post.mediaType === 'REEL' || post.mediaType === 'VIDEO' ? 45 : 0
        const style = await analyzeVideoStyle(post.thumbnailUrl, duration)
        if (Object.keys(style).length > 0) {
          styles.push(style)
        }
      } catch (err) {
        console.warn(`[videoStyleAnalyzer] Failed to analyze post ${post.id}:`, err)
      }
      // Rate limit — 1.2s between Bedrock calls
      if (styles.length < posts.length) await new Promise((r) => setTimeout(r, 1200))
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
