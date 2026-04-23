/**
 * Video Style Analyzer
 *
 * Full analysis pipeline for creator videos:
 * 1. FFmpeg keyframes → Bedrock Vision (visual metrics)
 * 2. FFmpeg audio analysis (energy curves, silence, SFX detection)
 * 3. Aggregation across multiple videos into a StyleProfile
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { invokeAgent, parseAgentOutput } from './bedrock/bedrock.service'
import { extractKeyframes } from '../lib/keyframeExtractor.service'
import prisma from '../lib/prisma'

const execFileAsync = promisify(execFile)

// ── Full Style Profile ───────────────────────────────────────────────────────

export interface StyleProfile {
  // Cut & pacing
  avgCutDuration: number              // seconds per cut (e.g., 1.2)
  pacingSpeed: 'very-fast' | 'fast' | 'moderate' | 'slow' | 'mixed'
  pacingCurve: string                 // e.g., "builds intensity" | "steady" | "front-loaded"

  // Hook
  hookTiming: number                  // seconds before the hook lands (e.g., 1.5)
  hookStyle: string                   // e.g., "text-overlay-question" | "visual-surprise" | "voice-hook"

  // Subtitles & text
  subtitleFrequency: number           // percentage of frames with text overlays (0-100)
  subtitleStyle: string               // e.g., "bold-centered" | "lower-third" | "animated-word-by-word"
  hasSubtitles: boolean

  // Zoom & camera
  zoomFrequency: number               // zooms per minute
  zoomTypes: string[]                 // ["punch-in", "slow-zoom", "dolly", "whip-pan"]

  // Transitions
  transitionStyles: string[]          // ["hard-cut", "fade", "match-cut", "j-cut", "swipe"]
  transitionFrequency: number         // transitions per minute

  // Audio
  silenceRemoval: boolean             // whether creator removes silence/dead air
  silenceRatio: number                // % of video that is silent (0-100)
  audioEnergyProfile: string          // "high-throughout" | "builds" | "drops-mid" | "peaks-at-hook"
  musicIntensity: 'high' | 'medium' | 'low' | 'none'
  hasSFX: boolean                     // sound effects detected
  sfxFrequency: number                // SFX per minute
  sfxTiming: string                   // "on-cuts" | "on-text" | "on-beats" | "sparse"

  // Storytelling & engagement
  narrativeStructure: string          // "hook-story-cta" | "problem-solution" | "transformation" | "list" | "day-in-life"
  storytellingCadence: string         // "fast-reveal" | "slow-build" | "tension-release" | "montage"
  engagementPacing: string            // "front-loaded" | "even" | "back-loaded" | "peaks-middle"
  ctaPlacement: string                // "end" | "mid-roll" | "none" | "end + mid-roll"

  // Visual
  colorGrading: string
  visualDensity: 'high' | 'medium' | 'low'
  aspectRatio: string
  videoLength: string                 // average duration range

  // Content
  contentAngles: string[]
}

// ── Audio Analysis via FFmpeg ─────────────────────────────────────────────────

interface AudioAnalysis {
  silenceRatio: number
  silenceRemoval: boolean
  audioEnergyProfile: string
  hasSFX: boolean
  sfxFrequency: number
  musicIntensity: 'high' | 'medium' | 'low' | 'none'
}

async function analyzeAudio(videoUrl: string, duration: number): Promise<AudioAnalysis> {
  const defaults: AudioAnalysis = {
    silenceRatio: 0,
    silenceRemoval: false,
    audioEnergyProfile: 'unknown',
    hasSFX: false,
    sfxFrequency: 0,
    musicIntensity: 'medium',
  }

  if (!videoUrl || !videoUrl.startsWith('http')) return defaults

  const tmpDir = path.join(os.tmpdir(), `sovexa-audio-${Date.now()}`)
  try {
    fs.mkdirSync(tmpDir, { recursive: true })
    const tmpFile = path.join(tmpDir, 'source.mp4')

    // Download video
    const axios = (await import('axios')).default
    const resp = await axios.get(videoUrl, { responseType: 'arraybuffer', timeout: 15000 })
    fs.writeFileSync(tmpFile, Buffer.from(resp.data))

    // Detect silence using FFmpeg silencedetect filter
    let silenceOutput = ''
    try {
      const { stderr } = await execFileAsync('ffmpeg', [
        '-i', tmpFile,
        '-af', 'silencedetect=noise=-30dB:d=0.3',
        '-f', 'null', '-',
      ], { timeout: 30000 })
      silenceOutput = stderr
    } catch (err: any) {
      silenceOutput = err.stderr || ''
    }

    // Parse silence intervals
    const silenceStarts = (silenceOutput.match(/silence_start: [\d.]+/g) || []).map((s) =>
      parseFloat(s.replace('silence_start: ', ''))
    )
    const silenceEnds = (silenceOutput.match(/silence_end: [\d.]+/g) || []).map((s) =>
      parseFloat(s.replace('silence_end: ', '').split('|')[0].trim())
    )
    let totalSilence = 0
    for (let i = 0; i < Math.min(silenceStarts.length, silenceEnds.length); i++) {
      totalSilence += silenceEnds[i] - silenceStarts[i]
    }
    const silenceRatio = duration > 0 ? Math.round((totalSilence / duration) * 100) : 0

    // Detect volume levels using volumedetect
    let volumeOutput = ''
    try {
      const { stderr } = await execFileAsync('ffmpeg', [
        '-i', tmpFile,
        '-af', 'volumedetect',
        '-f', 'null', '-',
      ], { timeout: 30000 })
      volumeOutput = stderr
    } catch (err: any) {
      volumeOutput = err.stderr || ''
    }

    const meanVolMatch = volumeOutput.match(/mean_volume: ([-\d.]+) dB/)
    const maxVolMatch = volumeOutput.match(/max_volume: ([-\d.]+) dB/)
    const meanVol = meanVolMatch ? parseFloat(meanVolMatch[1]) : -20
    const maxVol = maxVolMatch ? parseFloat(maxVolMatch[1]) : -5

    // Determine audio characteristics
    const dynamicRange = maxVol - meanVol
    const hasSFX = dynamicRange > 15 // big spikes = SFX
    const sfxFrequency = hasSFX ? Math.round(dynamicRange / 5) : 0

    let musicIntensity: 'high' | 'medium' | 'low' | 'none' = 'medium'
    if (meanVol > -15) musicIntensity = 'high'
    else if (meanVol > -25) musicIntensity = 'medium'
    else if (meanVol > -40) musicIntensity = 'low'
    else musicIntensity = 'none'

    let audioEnergyProfile = 'steady'
    if (silenceRatio < 5 && musicIntensity === 'high') audioEnergyProfile = 'high-throughout'
    else if (silenceRatio > 30) audioEnergyProfile = 'speech-with-gaps'
    else if (hasSFX) audioEnergyProfile = 'peaks-at-transitions'
    else audioEnergyProfile = 'builds'

    // Clean up
    fs.rmSync(tmpDir, { recursive: true, force: true })

    return {
      silenceRatio,
      silenceRemoval: silenceRatio < 5 && duration > 15, // very little silence in a 15s+ video = removed
      audioEnergyProfile,
      hasSFX,
      sfxFrequency,
      musicIntensity,
    }
  } catch (err) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
    console.warn('[videoStyleAnalyzer] audio analysis failed:', (err as Error).message)
    return defaults
  }
}

// ── Visual Analysis via Bedrock Vision ───────────────────────────────────────

const VISION_PROMPT = `You are an expert video editing analyst. You are given keyframes extracted from a creator's Reel/Video at regular intervals.

Analyze the frames for PRECISE editing metrics. Respond with ONLY valid JSON:
{
  "avgCutDuration": 1.2,
  "pacingSpeed": "very-fast|fast|moderate|slow|mixed",
  "pacingCurve": "builds-intensity|steady|front-loaded|peaks-middle|slow-build",
  "hookTiming": 1.5,
  "hookStyle": "text-overlay-question|visual-surprise|voice-hook|pattern-interrupt|cold-open|relatable-moment",
  "subtitlePercentage": 60,
  "subtitleStyle": "bold-centered|lower-third|animated-word-by-word|minimal-keywords|none",
  "hasSubtitles": true,
  "zoomFrequency": 3.5,
  "zoomTypes": ["punch-in", "slow-zoom"],
  "transitionStyles": ["hard-cut", "fade"],
  "transitionFrequency": 8.0,
  "narrativeStructure": "hook-story-cta|problem-solution|transformation|list|day-in-life|montage|tutorial",
  "storytellingCadence": "fast-reveal|slow-build|tension-release|montage|question-answer",
  "engagementPacing": "front-loaded|even|back-loaded|peaks-middle",
  "ctaPlacement": "end|mid-roll|none|end+mid-roll",
  "colorGrading": "description",
  "visualDensity": "high|medium|low",
  "aspectRatio": "9:16|16:9|1:1",
  "contentAngle": "description"
}

CRITICAL — measure precisely:
- avgCutDuration: count how many distinctly different scenes appear across the frames, divide total duration by scene count
- hookTiming: how many seconds before something visually arresting happens (count from frame 0)
- subtitlePercentage: what % of frames show text overlays or subtitles
- zoomFrequency: how many zoom changes per minute (close-up → wide or vice versa)
- transitionFrequency: scene changes per minute based on frame differences
- engagementPacing: where is the most visually dynamic content? beginning, middle, or end?`

interface VisualAnalysis {
  avgCutDuration: number
  pacingSpeed: string
  pacingCurve: string
  hookTiming: number
  hookStyle: string
  subtitleFrequency: number
  subtitleStyle: string
  hasSubtitles: boolean
  zoomFrequency: number
  zoomTypes: string[]
  transitionStyles: string[]
  transitionFrequency: number
  narrativeStructure: string
  storytellingCadence: string
  engagementPacing: string
  ctaPlacement: string
  colorGrading: string
  visualDensity: 'high' | 'medium' | 'low'
  aspectRatio: string
  contentAngles: string[]
}

async function analyzeVisuals(
  mediaUrl: string,
  thumbnailUrl: string | null,
  duration: number,
): Promise<VisualAnalysis | null> {
  try {
    let frames: Array<{ timestamp: number; base64: string; index: number }> = []

    if (mediaUrl && mediaUrl.startsWith('http')) {
      try {
        const interval = duration > 30 ? 3 : 2
        frames = await extractKeyframes(mediaUrl, Math.max(duration, 15), interval, 10)
      } catch (err) {
        console.warn('[videoStyleAnalyzer] FFmpeg extraction failed:', (err as Error).message)
      }
    }

    // Thumbnail fallback — single frame can detect visual style but NOT cut speed/transitions
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

    if (frames.length === 0) return null

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
      text: `${frames.length} keyframes from a ${duration}s video. Measure editing metrics precisely.`,
    })

    const raw = await invokeAgent({
      systemPrompt: VISION_PROMPT,
      messages: [{ role: 'user', content: contentBlocks }],
      maxTokens: 768,
      temperature: 0.2,
    })

    const a = parseAgentOutput<Record<string, unknown>>(raw)

    // If only 1 frame (thumbnail), cut speed and transition metrics are unreliable
    const isThumbnailOnly = frames.length <= 1

    return {
      avgCutDuration: isThumbnailOnly ? -1 : (typeof a.avgCutDuration === 'number' ? a.avgCutDuration : 1.5),
      pacingSpeed: (a.pacingSpeed as string) || 'moderate',
      pacingCurve: (a.pacingCurve as string) || 'steady',
      hookTiming: typeof a.hookTiming === 'number' ? a.hookTiming : 2,
      hookStyle: (a.hookStyle as string) || 'cold-open',
      subtitleFrequency: typeof a.subtitlePercentage === 'number' ? a.subtitlePercentage : 0,
      subtitleStyle: (a.subtitleStyle as string) || 'none',
      hasSubtitles: !!a.hasSubtitles,
      zoomFrequency: typeof a.zoomFrequency === 'number' ? a.zoomFrequency : 0,
      zoomTypes: Array.isArray(a.zoomTypes) ? a.zoomTypes : [],
      transitionStyles: Array.isArray(a.transitionStyles) ? a.transitionStyles : ['hard-cut'],
      transitionFrequency: typeof a.transitionFrequency === 'number' ? a.transitionFrequency : 0,
      narrativeStructure: (a.narrativeStructure as string) || 'hook-story-cta',
      storytellingCadence: (a.storytellingCadence as string) || 'fast-reveal',
      engagementPacing: (a.engagementPacing as string) || 'front-loaded',
      ctaPlacement: (a.ctaPlacement as string) || 'end',
      colorGrading: (a.colorGrading as string) || 'natural',
      visualDensity: (a.visualDensity as 'high' | 'medium' | 'low') || 'medium',
      aspectRatio: (a.aspectRatio as string) || '9:16',
      contentAngles: [a.contentAngle as string].filter(Boolean),
    }
  } catch (err) {
    console.error('[videoStyleAnalyzer] visual analysis failed:', (err as Error).message)
    return null
  }
}

// ── Aggregation ──────────────────────────────────────────────────────────────

function aggregateProfiles(
  visuals: VisualAnalysis[],
  audios: AudioAnalysis[],
): StyleProfile {
  const defaults: StyleProfile = {
    avgCutDuration: 1.5, pacingSpeed: 'moderate', pacingCurve: 'steady',
    hookTiming: 2, hookStyle: 'cold-open',
    subtitleFrequency: 0, subtitleStyle: 'none', hasSubtitles: false,
    zoomFrequency: 0, zoomTypes: [], transitionStyles: ['hard-cut'], transitionFrequency: 0,
    silenceRemoval: false, silenceRatio: 0, audioEnergyProfile: 'unknown',
    musicIntensity: 'medium', hasSFX: false, sfxFrequency: 0, sfxTiming: 'sparse',
    narrativeStructure: 'hook-story-cta', storytellingCadence: 'fast-reveal',
    engagementPacing: 'front-loaded', ctaPlacement: 'end',
    colorGrading: 'natural', visualDensity: 'medium', aspectRatio: '9:16',
    videoLength: '30-60s', contentAngles: [],
  }

  if (visuals.length === 0) return defaults

  // Average numeric metrics — filter out -1 (thumbnail-only, unreliable for timing)
  const avg = (arr: number[]) => {
    const valid = arr.filter((v) => v >= 0)
    return valid.length > 0 ? valid.reduce((s, v) => s + v, 0) / valid.length : 0
  }
  const mode = (arr: string[]) => {
    const counts = new Map<string, number>()
    for (const v of arr) counts.set(v, (counts.get(v) || 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ''
  }

  const avgCut = avg(visuals.map((v) => v.avgCutDuration))
  const avgHook = avg(visuals.map((v) => v.hookTiming))
  const avgSubFreq = avg(visuals.map((v) => v.subtitleFrequency))
  const avgZoomFreq = avg(visuals.map((v) => v.zoomFrequency))
  const avgTransFreq = avg(visuals.map((v) => v.transitionFrequency))

  // Collect sets
  const allZoomTypes = new Set<string>()
  const allTransitions = new Set<string>()
  const allAngles = new Set<string>()
  const allGradings = new Set<string>()
  for (const v of visuals) {
    v.zoomTypes.forEach((z) => allZoomTypes.add(z))
    v.transitionStyles.forEach((t) => allTransitions.add(t))
    v.contentAngles.forEach((a) => allAngles.add(a))
    if (v.colorGrading) allGradings.add(v.colorGrading)
  }

  // Audio aggregation
  const avgSilence = avg(audios.map((a) => a.silenceRatio))
  const silenceRemoval = audios.filter((a) => a.silenceRemoval).length > audios.length / 2
  const avgSfxFreq = avg(audios.map((a) => a.sfxFrequency))
  const hasSFX = audios.some((a) => a.hasSFX)

  // Determine SFX timing from audio energy profile
  const energyProfiles = audios.map((a) => a.audioEnergyProfile)
  let sfxTiming = 'sparse'
  if (hasSFX && avgTransFreq > 5) sfxTiming = 'on-cuts'
  else if (hasSFX && avgSubFreq > 50) sfxTiming = 'on-text'
  else if (hasSFX) sfxTiming = 'on-beats'

  return {
    avgCutDuration: Math.round(avgCut * 10) / 10,
    pacingSpeed: avgCut < 0.8 ? 'very-fast' : avgCut < 1.5 ? 'fast' : avgCut < 3 ? 'moderate' : 'slow',
    pacingCurve: mode(visuals.map((v) => v.pacingCurve)) || 'steady',
    hookTiming: Math.round(avgHook * 10) / 10,
    hookStyle: mode(visuals.map((v) => v.hookStyle)) || 'cold-open',
    subtitleFrequency: Math.round(avgSubFreq),
    subtitleStyle: mode(visuals.map((v) => v.subtitleStyle)) || 'none',
    hasSubtitles: visuals.filter((v) => v.hasSubtitles).length > visuals.length / 2,
    zoomFrequency: Math.round(avgZoomFreq * 10) / 10,
    zoomTypes: [...allZoomTypes],
    transitionStyles: [...allTransitions],
    transitionFrequency: Math.round(avgTransFreq * 10) / 10,
    silenceRemoval,
    silenceRatio: Math.round(avgSilence),
    audioEnergyProfile: mode(energyProfiles) || 'steady',
    musicIntensity: mode(audios.map((a) => a.musicIntensity)) as 'high' | 'medium' | 'low' | 'none' || 'medium',
    hasSFX,
    sfxFrequency: Math.round(avgSfxFreq * 10) / 10,
    sfxTiming,
    narrativeStructure: mode(visuals.map((v) => v.narrativeStructure)) || 'hook-story-cta',
    storytellingCadence: mode(visuals.map((v) => v.storytellingCadence)) || 'fast-reveal',
    engagementPacing: mode(visuals.map((v) => v.engagementPacing)) || 'front-loaded',
    ctaPlacement: mode(visuals.map((v) => v.ctaPlacement)) || 'end',
    colorGrading: [...allGradings][0] || 'natural',
    visualDensity: mode(visuals.map((v) => v.visualDensity)) as 'high' | 'medium' | 'low' || 'medium',
    aspectRatio: mode(visuals.map((v) => v.aspectRatio)) || '9:16',
    videoLength: '30-60s',
    contentAngles: [...allAngles],
  }
}

// ── Main Entry Point ─────────────────────────────────────────────────────────

export async function analyzeUserVideoStyle(companyId: string): Promise<StyleProfile> {
  try {
    const posts = await prisma.platformPost.findMany({
      where: {
        account: { companyId },
        thumbnailUrl: { not: null },
        mediaType: { in: ['REEL', 'VIDEO'] },
      },
      orderBy: { publishedAt: 'desc' },
      take: 10,
      select: {
        id: true, url: true, thumbnailUrl: true, mediaUrl: true,
        mediaType: true, caption: true, publishedAt: true, engagementRate: true,
      },
    })

    console.log(`[videoStyleAnalyzer] Found ${posts.length} Reels/Videos for ${companyId}`)
    if (posts.length === 0) return aggregateProfiles([], [])

    const visuals: VisualAnalysis[] = []
    const audios: AudioAnalysis[] = []

    for (const post of posts) {
      if (!post.mediaUrl && !post.thumbnailUrl) continue
      const duration = 45

      try {
        // Visual analysis (Bedrock Vision on keyframes)
        const visual = await analyzeVisuals(post.mediaUrl || '', post.thumbnailUrl, duration)
        if (visual) visuals.push(visual)

        // Audio analysis (FFmpeg — only if we have the actual video file)
        if (post.mediaUrl) {
          const audio = await analyzeAudio(post.mediaUrl, duration)
          audios.push(audio)
        }

        const source = post.mediaUrl ? 'video' : 'thumbnail'
        console.log(`[videoStyleAnalyzer] analyzed ${post.id}: ${source} (cut: ${visual?.avgCutDuration}s, hook: ${visual?.hookTiming}s)`)
      } catch (err) {
        console.warn(`[videoStyleAnalyzer] failed ${post.id}:`, (err as Error).message)
      }

      await new Promise((r) => setTimeout(r, 1500))
    }

    console.log(`[videoStyleAnalyzer] ${visuals.length} visual + ${audios.length} audio analyses`)

    const profile = aggregateProfiles(visuals, audios)

    // Store with source tag
    const profileData = { source: 'video_style_analysis', ...profile } as any
    const existing = await prisma.brandMemory.findFirst({
      where: {
        companyId,
        memoryType: 'preference',
        content: { path: ['source'], equals: 'video_style_analysis' },
      },
    })

    if (existing) {
      await prisma.brandMemory.update({ where: { id: existing.id }, data: { content: profileData } })
    } else {
      await prisma.brandMemory.create({
        data: { companyId, memoryType: 'preference', content: profileData, weight: 1.0 },
      })
    }

    console.log(`[videoStyleAnalyzer] stored profile for ${companyId}`)
    return profile
  } catch (err) {
    console.error('[videoStyleAnalyzer] failed:', err)
    return aggregateProfiles([], [])
  }
}

export async function getStyleProfile(companyId: string): Promise<StyleProfile | null> {
  try {
    const memory = await prisma.brandMemory.findFirst({
      where: {
        companyId,
        memoryType: 'preference',
        content: { path: ['source'], equals: 'video_style_analysis' },
      },
    })
    if (!memory) return null
    const { source: _, ...profile } = memory.content as Record<string, unknown>
    return profile as unknown as StyleProfile
  } catch {
    return null
  }
}
