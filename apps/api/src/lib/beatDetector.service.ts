/**
 * Beat Detector
 *
 * Combines the motion curve and audio energy curve into a structured action
 * map that tells Riley exactly:
 *   - Where it's safe to cut (rest points)
 *   - Where the actions are and how long they last
 *   - Which beats inside each action are worth keeping (boundaries + sub-peaks)
 *
 * Riley then makes JUDGMENT calls (which beats serve the reel) — but she
 * cannot invent timestamps. She picks from this list.
 *
 * The point: a "10s grocery loading" action becomes 4-5 beats (start, anomaly,
 * mid-peak, end), not "skip the whole thing" or "keep all 10s." The user said:
 * preserve the start, the eggs-dropping, and the trunk-closing — that's beats.
 */

import type { MotionPoint } from './motionCurve.service'
import type { AudioPoint } from './audioEnergy.service'

export type BeatKind = 'start' | 'end' | 'motion-peak' | 'audio-peak' | 'demo-tick'
export type ActionDurationClass = 'short' | 'medium' | 'long'

export interface Beat {
  time: number
  kind: BeatKind
  /** Strength: motion peak → motion 0..1, audio peak → energy 0..1, boundary → 1.0 */
  strength: number
  /** Suggested clip width to capture this beat in seconds (centered on time) */
  suggestedWidth: number
  /** Whether Riley is *required* to keep this beat (boundaries, big anomalies) */
  required: boolean
}

export interface ActionSpan {
  startTime: number
  endTime: number
  duration: number
  durationClass: ActionDurationClass
  peakMotion: number
  meanMotion: number
  hasAudioAnomaly: boolean
  beats: Beat[]
  /** Subject classification — populated by subjectClassifier after detection */
  subjectKind?: 'real-person' | 'screen' | 'other' | 'unknown'
}

export interface BeatAnalysis {
  /** Times where a cut is safe (motion is at a valley) */
  restPoints: number[]
  /** Action spans with internal beats */
  actions: ActionSpan[]
  /** Dead windows — Riley should generally skip these unless they bracket actions */
  deadWindows: Array<{ startTime: number; endTime: number }>
}

// ── Threshold tuning ──────────────────────────────────────────────────────
//
// Earlier versions used fixed thresholds (action ≥ 0.35, rest ≤ 0.18). That
// works on average-energy content but fails on uniformly-high-motion videos:
// every bucket reads as "action," so rest points collapse to just the start
// and end of the video.
//
// We now compute thresholds adaptively per video, as percentiles of the
// actual motion curve. This guarantees roughly the top ~30% of motion
// becomes "action" and the bottom ~30% becomes "rest" regardless of the
// video's overall energy level.
//
// The fixed minimums below act as an absolute floor: even a video where the
// 30th-percentile sample is 0.0 won't classify everything below 0.0 as rest;
// we need actual evidence of stillness.
const ACTION_PCT = 0.65             // top 35% of motion = action
const REST_PCT = 0.30               // bottom 30% of motion = rest
const ACTION_FLOOR = 0.20           // never classify below this as "action" even if percentile is high
const REST_CEIL = 0.55              // never classify above this as "rest" even if percentile is low
const MIN_ACTION_DURATION = 1.5     // shorter is just a flicker, not an action
const MIN_REST_DURATION = 0.4       // a valley must hold for this long to count
const AUDIO_PEAK_DELTA = 0.45       // audio jump vs. local mean to flag anomaly
const SHORT_MAX = 3.0
const MEDIUM_MAX = 5.5

export function classifyDuration(d: number): ActionDurationClass {
  if (d <= SHORT_MAX) return 'short'
  if (d <= MEDIUM_MAX) return 'medium'
  return 'long'
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p))
  return sorted[idx]
}

/**
 * Main entry. Both curves should be aligned to 1Hz (1 sample per second).
 * If audioCurve is empty (silent file / no audio stream), audio anomalies are
 * skipped — beats come from motion + boundaries only.
 */
export function detectBeats(
  motionCurve: MotionPoint[],
  audioCurve: AudioPoint[],
  videoDuration: number,
  sceneCutTimestamps: number[] = [],
): BeatAnalysis {
  if (motionCurve.length === 0 || videoDuration <= 0) {
    return { restPoints: [], actions: [], deadWindows: [] }
  }

  // ── 1. Adaptive thresholds based on this video's motion distribution ────
  const motionValues = motionCurve.map((p) => p.motion)
  const actionThresh = Math.max(ACTION_FLOOR, percentile(motionValues, ACTION_PCT))
  const restThresh = Math.min(REST_CEIL, percentile(motionValues, REST_PCT))
  console.log(`[beat-detector] adaptive thresholds — action ≥ ${actionThresh.toFixed(2)}, rest ≤ ${restThresh.toFixed(2)}`)

  // ── 2. Find action spans by thresholding the motion curve ──────────────
  const actionSpans: Array<{ start: number; end: number }> = []
  let inAction = false
  let actionStart = 0
  let restRunStart: number | null = null
  let restRunLen = 0

  for (let i = 0; i < motionCurve.length; i++) {
    const p = motionCurve[i]
    if (p.motion >= actionThresh) {
      if (!inAction) {
        actionStart = p.time - 0.5
        inAction = true
      }
      restRunStart = null
      restRunLen = 0
    } else if (p.motion <= restThresh) {
      if (inAction) {
        if (restRunStart === null) restRunStart = p.time - 0.5
        restRunLen += 1
        // End the action only after a sustained rest (avoid premature cuts on flickers)
        if (restRunLen >= Math.ceil(MIN_REST_DURATION) || i === motionCurve.length - 1) {
          const end = restRunStart!
          if (end - actionStart >= MIN_ACTION_DURATION) {
            actionSpans.push({ start: actionStart, end })
          }
          inAction = false
          restRunStart = null
          restRunLen = 0
        }
      }
    }
    // Mid-zone (between REST and ACTION thresholds): hold state, don't flip
  }

  // Close any trailing action
  if (inAction) {
    const end = videoDuration
    if (end - actionStart >= MIN_ACTION_DURATION) {
      actionSpans.push({ start: actionStart, end })
    }
  }

  // ── 1b. Decompose long spans into MICRO-ACTIONS ────────────────────────
  // A long "action" of 30s isn't one logical action — it's often a sequence
  // of poses, gestures, or movements with brief return-to-baseline between
  // each. We need to detect those internal valleys (sub-thresh dips that
  // last ≥ INTERNAL_VALLEY_DURATION) and split the span at those points,
  // so each micro-action becomes its own ActionSpan with its own start /
  // peak / end. Otherwise the coverage rule "every action contributes"
  // protects only the first pose, and Riley misses 4 of 5.
  const INTERNAL_VALLEY_DURATION = 0.6  // sustained dip ≥ 0.6s = pose reset
  const SUB_ACTION_THRESH = Math.max(0.30, restThresh + 0.08)  // more permissive than full REST — micro-resets are partial
  const MIN_SUB_ACTION_DURATION = 1.5
  const SPLIT_AT_LENGTH = 6.0  // only consider splitting spans this long

  const refinedSpans: Array<{ start: number; end: number }> = []
  for (const span of actionSpans) {
    const dur = span.end - span.start
    if (dur < SPLIT_AT_LENGTH) {
      refinedSpans.push(span)
      continue
    }

    // Walk the curve inside this span looking for internal valleys
    const inside = motionCurve.filter((p) => p.time >= span.start && p.time <= span.end)
    if (inside.length < 4) {
      refinedSpans.push(span)
      continue
    }

    const splitPoints: number[] = []
    let valleyRunStart: number | null = null
    let valleyMin = 1
    for (let i = 0; i < inside.length; i++) {
      const p = inside[i]
      const isLow = p.motion <= SUB_ACTION_THRESH
      if (isLow) {
        if (valleyRunStart === null) valleyRunStart = p.time - 0.5
        valleyMin = Math.min(valleyMin, p.motion)
      } else if (valleyRunStart !== null) {
        const valleyEnd = p.time - 0.5
        const valleyLen = valleyEnd - valleyRunStart
        if (valleyLen >= INTERNAL_VALLEY_DURATION) {
          // The valley center is the split point — splits the span on the
          // calmest moment between two micro-actions
          const valleyCenter = valleyRunStart + valleyLen / 2
          splitPoints.push(valleyCenter)
        }
        valleyRunStart = null
        valleyMin = 1
      }
    }

    if (splitPoints.length === 0) {
      // Sustained motion, no internal resets — leave as one span
      refinedSpans.push(span)
      continue
    }

    // Split the span at each valley center
    const breakpoints = [span.start, ...splitPoints, span.end]
    let microActions = 0
    for (let i = 0; i < breakpoints.length - 1; i++) {
      const subStart = breakpoints[i]
      const subEnd = breakpoints[i + 1]
      if (subEnd - subStart >= MIN_SUB_ACTION_DURATION) {
        refinedSpans.push({ start: subStart, end: subEnd })
        microActions++
      }
    }
    if (microActions > 1) {
      console.log(`[beat-detector] split long span [${span.start.toFixed(1)}-${span.end.toFixed(1)}s] into ${microActions} micro-actions`)
    }
  }

  // Replace original action spans with the decomposed list
  actionSpans.length = 0
  actionSpans.push(...refinedSpans)

  // ── 1c. Audio-driven action seeding ────────────────────────────────────
  // Frame-diff motion under-detects content where the camera is static and
  // the SUBJECT is moving (e.g. jump rope, dancing in place, exercise). The
  // motion signal stays low because backdrop pixels don't change much, even
  // though there's clearly action happening. Audio energy is a complementary
  // signal — rhythmic foot/rope/breath/music sounds register strongly even
  // when frame-diff is quiet.
  //
  // For any window where audio energy is sustained-elevated AND the motion
  // curve does NOT already have an action span there, seed an audio-driven
  // action so it gets surfaced to Riley. The per-frame subject classifier
  // still confirms what's actually visible, so false positives (loud music
  // over a still photo) get caught downstream.
  if (audioCurve.length > 0) {
    // Compute audio threshold adaptively — same percentile approach as motion
    const audioValues = audioCurve.map((p) => p.energy)
    const audioPct = (p: number) => {
      const sorted = [...audioValues].sort((a, b) => a - b)
      return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
    }
    const AUDIO_ACTION_THRESH = Math.max(0.30, audioPct(0.55))
    const MIN_AUDIO_ACTION_DURATION = 2.5
    const MIN_AUDIO_GAP_FROM_MOTION = 0.3   // skip seeding if motion-action is within this distance

    // Helper: is t already covered by a motion-detected action span?
    const isCoveredByMotion = (t: number) => actionSpans.some(
      (a) => t >= a.start - MIN_AUDIO_GAP_FROM_MOTION && t <= a.end + MIN_AUDIO_GAP_FROM_MOTION,
    )

    const audioSpans: Array<{ start: number; end: number }> = []
    let audioRunStart: number | null = null
    for (let i = 0; i < audioCurve.length; i++) {
      const p = audioCurve[i]
      const above = p.energy >= AUDIO_ACTION_THRESH && !isCoveredByMotion(p.time)
      if (above) {
        if (audioRunStart === null) audioRunStart = p.time - 0.5
      } else if (audioRunStart !== null) {
        const runEnd = p.time - 0.5
        if (runEnd - audioRunStart >= MIN_AUDIO_ACTION_DURATION) {
          audioSpans.push({ start: audioRunStart, end: runEnd })
        }
        audioRunStart = null
      }
    }
    if (audioRunStart !== null) {
      const runEnd = videoDuration
      if (runEnd - audioRunStart >= MIN_AUDIO_ACTION_DURATION) {
        audioSpans.push({ start: audioRunStart, end: runEnd })
      }
    }

    if (audioSpans.length > 0) {
      console.log(`[beat-detector] audio co-detection: thresh=${AUDIO_ACTION_THRESH.toFixed(2)} added ${audioSpans.length} audio-driven action span(s)`)
      audioSpans.forEach((s) => {
        console.log(`  audio-action [${s.start.toFixed(1)}-${s.end.toFixed(1)}s] (${(s.end - s.start).toFixed(1)}s)`)
      })
      actionSpans.push(...audioSpans)
      actionSpans.sort((a, b) => a.start - b.start)
    }
  }

  // ── 1d. Split action spans at scene-cut boundaries ────────────────────
  // Multi-clip compilations weld original clips end-to-end. Even when the
  // motion signal is continuous across the splice (similar lighting / pace),
  // there's a HARD VISUAL CUT at the boundary that the motion curve misses.
  // Source-side scene detection picks these up. We split any action span
  // that contains a scene-cut so segments can never straddle a splice.
  if (sceneCutTimestamps.length > 0) {
    const sceneSplit: Array<{ start: number; end: number }> = []
    for (const span of actionSpans) {
      const cutsInside = sceneCutTimestamps
        .filter((t) => t > span.start + 0.4 && t < span.end - 0.4)
        .sort((a, b) => a - b)
      if (cutsInside.length === 0) {
        sceneSplit.push(span)
        continue
      }
      const breakpoints = [span.start, ...cutsInside, span.end]
      let pieces = 0
      for (let i = 0; i < breakpoints.length - 1; i++) {
        const subStart = breakpoints[i]
        const subEnd = breakpoints[i + 1]
        if (subEnd - subStart >= 1.0) {
          sceneSplit.push({ start: subStart, end: subEnd })
          pieces++
        }
      }
      if (pieces > 1) {
        console.log(`[beat-detector] split action [${span.start.toFixed(1)}-${span.end.toFixed(1)}s] at ${cutsInside.length} scene-cut(s) into ${pieces} pieces`)
      }
    }
    actionSpans.length = 0
    actionSpans.push(...sceneSplit)
  }

  // ── 2. Build rest points from valleys between actions ──────────────────
  const restPoints: number[] = []
  // Always include video start and end as cuttable boundaries
  restPoints.push(0)
  // Scene cuts are ALWAYS safe rest points — clip boundaries are by
  // construction not mid-action.
  for (const t of sceneCutTimestamps) restPoints.push(t)
  for (let i = 0; i < actionSpans.length; i++) {
    const s = actionSpans[i]
    // Rest at the end of one action == rest at the start of the next
    restPoints.push(s.start)
    restPoints.push(s.end)
  }
  restPoints.push(videoDuration)

  // Dedupe + sort
  const uniqRest = [...new Set(restPoints.map((t) => Math.round(t * 10) / 10))].sort((a, b) => a - b)

  // ── 3. For each action, extract internal beats ─────────────────────────
  const actions: ActionSpan[] = actionSpans.map((span) => {
    const duration = span.end - span.start
    const durationClass = classifyDuration(duration)

    // Motion samples inside this span
    const inside = motionCurve.filter((p) => p.time >= span.start && p.time <= span.end)
    const peakMotion = inside.reduce((m, p) => Math.max(m, p.motion), 0)
    const meanMotion = inside.length > 0 ? inside.reduce((s, p) => s + p.motion, 0) / inside.length : 0

    const beats: Beat[] = []

    // Boundary beats (always required — these are the start/end framing).
    // Widths are intentionally generous: a "rushed" cut that snips before the
    // gesture/movement completes reads as amateur. 1.6s gives the action room
    // to land for short actions; long actions get a tighter 1.2s start (more
    // beats follow) and a wider 1.8s end (the action's payoff lands here).
    const startWidth = durationClass === 'long' ? 1.2 : 1.6
    const endWidth = durationClass === 'short' ? 1.6 : 1.8
    beats.push({
      time: span.start,
      kind: 'start',
      strength: 1.0,
      suggestedWidth: startWidth,
      required: true,
    })
    beats.push({
      time: span.end,
      kind: 'end',
      strength: 1.0,
      suggestedWidth: endWidth,
      required: true,
    })

    // Motion sub-peaks within the action (local maxima well above the action's mean)
    if (durationClass !== 'short' && inside.length >= 3) {
      const subPeakThreshold = Math.max(meanMotion * 1.25, 0.55)
      for (let i = 1; i < inside.length - 1; i++) {
        const prev = inside[i - 1].motion
        const cur = inside[i].motion
        const next = inside[i + 1].motion
        if (cur > prev && cur >= next && cur >= subPeakThreshold) {
          // Avoid duplicate beats too close to existing ones
          const t = inside[i].time
          if (Math.abs(t - span.start) > 1.0 && Math.abs(t - span.end) > 1.0
              && !beats.some((b) => Math.abs(b.time - t) < 0.8)) {
            beats.push({
              time: t,
              kind: 'motion-peak',
              strength: cur,
              suggestedWidth: 1.4,   // wider — let the peak action land before cutting
              required: false,
            })
          }
        }
      }
    }

    // Audio anomaly beats (only inside the action span)
    let hasAudioAnomaly = false
    if (audioCurve.length > 0) {
      const audioInside = audioCurve.filter((p) => p.time >= span.start && p.time <= span.end)
      const audioMean = audioInside.length > 0
        ? audioInside.reduce((s, p) => s + p.energy, 0) / audioInside.length
        : 0
      for (const p of audioInside) {
        if (p.energy - audioMean > AUDIO_PEAK_DELTA && p.energy > 0.55) {
          if (!beats.some((b) => Math.abs(b.time - p.time) < 0.8)) {
            beats.push({
              time: p.time,
              kind: 'audio-peak',
              strength: p.energy,
              suggestedWidth: 1.3,   // give the reaction/sound room to breathe
              required: p.energy > 0.8, // very loud anomaly = required
            })
            hasAudioAnomaly = true
          }
        }
      }
    }

    // Sort beats by time
    beats.sort((a, b) => a.time - b.time)

    return {
      startTime: span.start,
      endTime: span.end,
      duration,
      durationClass,
      peakMotion,
      meanMotion,
      hasAudioAnomaly,
      beats,
    }
  })

  // ── 4. Dead windows — gaps between actions where motion is genuinely low ─
  const deadWindows: Array<{ startTime: number; endTime: number }> = []
  let cursor = 0
  for (const a of actions) {
    if (a.startTime - cursor >= 1.5) {
      deadWindows.push({ startTime: cursor, endTime: a.startTime })
    }
    cursor = a.endTime
  }
  if (videoDuration - cursor >= 1.5) {
    deadWindows.push({ startTime: cursor, endTime: videoDuration })
  }

  console.log(`[beat-detector] ${actions.length} actions, ${uniqRest.length} rest points, ${deadWindows.length} dead windows`)
  actions.forEach((a, i) => {
    console.log(`  Action #${i + 1} [${a.startTime.toFixed(1)}-${a.endTime.toFixed(1)}s] ${a.durationClass} (${a.duration.toFixed(1)}s) — ${a.beats.length} beats${a.hasAudioAnomaly ? ' (audio anomaly)' : ''}`)
  })

  return { restPoints: uniqRest, actions, deadWindows }
}

/**
 * Snap a timestamp to the nearest rest point or beat within a tolerance.
 * Returns the snapped time and how far it moved (so caller can decide whether to log).
 */
export function snapToBeat(
  time: number,
  restPoints: number[],
  beats: Beat[],
  tolerance = 0.5,
): { snapped: number; moved: number; landedOn: 'rest' | 'beat' | 'none' } {
  let bestT = time
  let bestDiff = Infinity
  let landedOn: 'rest' | 'beat' | 'none' = 'none'

  for (const r of restPoints) {
    const d = Math.abs(r - time)
    if (d < bestDiff) {
      bestDiff = d
      bestT = r
      landedOn = 'rest'
    }
  }
  for (const b of beats) {
    const d = Math.abs(b.time - time)
    if (d < bestDiff) {
      bestDiff = d
      bestT = b.time
      landedOn = 'beat'
    }
  }

  if (bestDiff > tolerance) {
    return { snapped: time, moved: 0, landedOn: 'none' }
  }
  return { snapped: bestT, moved: bestDiff, landedOn }
}
