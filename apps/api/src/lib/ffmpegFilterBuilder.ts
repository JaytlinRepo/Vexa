/**
 * FFmpeg Filter Builder
 *
 * Maps creator StyleProfile + RetentionProfile to concrete FFmpeg
 * filter chains. No generic templates — every creator gets unique
 * filter parameters based on what their audience responds to.
 */

import type { StyleProfile } from '../services/videoStyleAnalyzer.service'
import type { RetentionProfile } from '../services/intelligence/retentionIntelligence'

export interface CreatorFilters {
  // Per-segment video filters (applied to each cut)
  videoFilters: string[]
  // Per-segment audio filters
  audioFilters: string[]
  // Transition between segments
  segmentTransition: {
    type: 'none' | 'fade' | 'dissolve' | 'wipeleft' | 'slidedown'
    duration: number  // seconds
  }
  // Global encoding params
  targetFps: number
  speedFactor: number    // 1.0 = normal, 0.85 = subtle speedup
  targetDuration: number // optimal video length in seconds
  maxSegments: number    // based on cut speed
  frameInterval: number  // keyframe extraction interval
}

/**
 * Build FFmpeg filters from a creator's style and retention profiles.
 * If no profiles available, returns sensible defaults.
 */
export function buildCreatorFilters(
  style: StyleProfile | null,
  retention: RetentionProfile | null,
  videoDuration: number,
): CreatorFilters {
  const vf: string[] = []
  const af: string[] = []

  // ── Base scaling (always applied) ──
  vf.push('format=yuv420p')
  vf.push('scale=1080:1920:force_original_aspect_ratio=decrease')
  vf.push('pad=1080:1920:(ow-iw)/2:(oh-ih)/2')

  // ── Zoom / punch-in (from creator's actual editing style, not audience optimization) ──
  const zoomTypes = style?.zoomTypes || []
  const zoomBehavior = zoomTypes.includes('punch-in') ? 'aggressive'
    : zoomTypes.includes('slow-zoom') ? 'moderate'
    : zoomTypes.length > 0 ? 'moderate'
    : 'none' // if creator doesn't zoom, don't add zoom
  if (zoomBehavior === 'aggressive') {
    // Ken Burns-style slow zoom on each segment
    vf.push('zoompan=z=\'min(zoom+0.0015,1.15)\':x=\'iw/2-(iw/zoom/2)\':y=\'ih/2-(ih/zoom/2)\':d=1:s=1080x1920:fps=30')
  } else if (zoomBehavior === 'moderate') {
    // Subtle 5% zoom
    vf.push('zoompan=z=\'min(zoom+0.0008,1.05)\':x=\'iw/2-(iw/zoom/2)\':y=\'ih/2-(ih/zoom/2)\':d=1:s=1080x1920:fps=30')
  }
  // 'minimal' or 'none' — no zoom applied

  // ── Speed / pacing ──
  let speedFactor = 1.0
  const pacing = style?.pacingSpeed || 'moderate'
  if (pacing === 'very-fast') {
    speedFactor = 0.85 // speed up 15%
    vf.push('setpts=0.85*PTS')
    af.push('atempo=1.176') // inverse of 0.85
  } else if (pacing === 'fast') {
    speedFactor = 0.92
    vf.push('setpts=0.92*PTS')
    af.push('atempo=1.087')
  }
  // moderate and slow = 1x speed

  // ── Silence removal ──
  const removeSilence = style?.silenceRemoval || false
  if (removeSilence) {
    af.push('silenceremove=start_periods=1:start_silence=0.3:start_threshold=-30dB:detection=peak')
  }

  // ── Audio normalization ──
  const musicIntensity = style?.musicIntensity || retention?.styleProfile.audioEnergyCurve || 'medium'
  if (musicIntensity === 'high' || musicIntensity === 'high-intensity') {
    af.push('loudnorm=I=-14:TP=-2:LRA=7')
  } else if (musicIntensity !== 'none') {
    af.push('loudnorm=I=-16:TP=-1.5:LRA=11')
  }

  // ── Transitions ──
  const transitionStyles = style?.transitionStyles || ['hard-cut']
  let segmentTransition: CreatorFilters['segmentTransition'] = { type: 'none', duration: 0 }

  if (transitionStyles.includes('fade')) {
    segmentTransition = { type: 'fade', duration: 0.3 }
  } else if (transitionStyles.includes('dissolve')) {
    segmentTransition = { type: 'dissolve', duration: 0.5 }
  } else if (transitionStyles.includes('wipe') || transitionStyles.includes('swipe')) {
    segmentTransition = { type: 'wipeleft', duration: 0.3 }
  }

  // ── Target duration from retention data ──
  const optimalLength = retention?.performanceCorrelations.videoLength.optimal || 45
  const targetDuration = Math.min(optimalLength, Math.floor(videoDuration * 0.65))

  // ── Segment count from cut speed ──
  const avgCutSpeed = style?.avgCutDuration || retention?.styleProfile.avgCutSpeed || 2.0
  const maxSegments = Math.max(3, Math.min(20, Math.ceil(targetDuration / avgCutSpeed)))

  // ── Frame extraction interval (denser for fast editors) ──
  const frameInterval = avgCutSpeed < 1.5 ? 1.5 : avgCutSpeed < 3 ? 2 : 3

  // ── FPS ──
  const targetFps = pacing === 'very-fast' || pacing === 'fast' ? 30 : 30

  return {
    videoFilters: vf,
    audioFilters: af,
    segmentTransition,
    targetFps,
    speedFactor,
    targetDuration,
    maxSegments,
    frameInterval,
  }
}

/**
 * Build the -vf string for a single segment.
 */
export function buildSegmentVF(filters: CreatorFilters): string {
  return filters.videoFilters.join(',')
}

/**
 * Build the -af string for a single segment.
 */
export function buildSegmentAF(filters: CreatorFilters): string {
  return filters.audioFilters.length > 0 ? filters.audioFilters.join(',') : ''
}

/**
 * Build xfade filter_complex for cross-segment transitions.
 * Returns null if transitions are hard-cut (no filter needed).
 */
export function buildTransitionFilter(
  segmentCount: number,
  segmentDurations: number[],
  transition: CreatorFilters['segmentTransition'],
): string | null {
  if (transition.type === 'none' || segmentCount < 2) return null

  // Build xfade chain: [0:v][1:v]xfade=...[v01]; [v01][2:v]xfade=...[v012]; ...
  const parts: string[] = []
  let prevLabel = '0:v'
  let offset = 0

  for (let i = 1; i < segmentCount; i++) {
    offset += (segmentDurations[i - 1] || 3) - transition.duration
    const outLabel = i === segmentCount - 1 ? 'outv' : `v${i}`
    parts.push(`[${prevLabel}][${i}:v]xfade=transition=${transition.type}:duration=${transition.duration}:offset=${offset.toFixed(2)}[${outLabel}]`)
    prevLabel = outLabel
  }

  return parts.join('; ')
}

/**
 * Log which creator-specific adjustments were applied.
 * Useful for debugging and audit trail.
 */
export function describeFilters(filters: CreatorFilters): string[] {
  const desc: string[] = []

  if (filters.speedFactor !== 1.0) {
    desc.push(`Speed: ${(1 / filters.speedFactor * 100).toFixed(0)}% (${filters.speedFactor < 1 ? 'faster' : 'slower'})`)
  }
  if (filters.videoFilters.some((f) => f.includes('zoompan'))) {
    desc.push('Zoom: active')
  }
  if (filters.audioFilters.some((f) => f.includes('silenceremove'))) {
    desc.push('Silence removal: active')
  }
  if (filters.audioFilters.some((f) => f.includes('loudnorm'))) {
    desc.push('Audio normalization: active')
  }
  if (filters.segmentTransition.type !== 'none') {
    desc.push(`Transitions: ${filters.segmentTransition.type} (${filters.segmentTransition.duration}s)`)
  }
  desc.push(`Target: ${filters.targetDuration}s, ${filters.maxSegments} segments, ${filters.frameInterval}s keyframe interval`)

  return desc
}
