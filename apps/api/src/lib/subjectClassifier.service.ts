/**
 * Subject Classifier — per-frame
 *
 * Classifies each beat-targeted keyframe individually as:
 *   - real-person  — actual subject physically present in the scene
 *   - screen       — camera pointed at a display, photo, monitor, mirror image
 *   - other        — ambiguous / abstract / no clear subject
 *
 * Per-frame matters because action spans frequently MIX content: a 24-second
 * "action" can begin with the creator on camera, pan to screens for 7s, then
 * pan back. A span-level classifier samples one frame and tags the whole span
 * by that frame's verdict — which means screen sections get treated as
 * real-person (or vice versa).
 *
 * Aggregation logic on top:
 *   - For each ActionSpan, gather verdicts of frames inside it.
 *   - If verdicts disagree, the span is "mixed" — caller should split it at
 *     the transition between dominant subject types.
 *   - If verdicts agree, the span is uniformly that subject.
 *
 * Throttle handling: sequential calls with delay between, exponential backoff
 * on 429s. Bedrock account-level rate limits choke parallel vision calls; we
 * trade ~2-3s of latency for reliable verdicts.
 */

import type { ExtractedFrame } from './keyframeExtractor.service'
import type { ActionSpan } from './beatDetector.service'
import { invokeAgent, parseAgentOutput } from '../services/bedrock/bedrock.service'

export type SubjectKind = 'real-person' | 'screen' | 'other' | 'unknown'

export interface FrameVerdict {
  frameTimestamp: number
  subject: SubjectKind
  confidence: number
  note: string
}

export interface SpanVerdict {
  /** Dominant subject across the span's frames */
  subject: SubjectKind
  confidence: number
  /** True when frames disagree — caller should split the span */
  mixed: boolean
  /**
   * For mixed spans: timestamp where the subject changes (mid-point between
   * the last frame of the old subject and the first frame of the new subject).
   * undefined when not mixed.
   */
  splitAt?: number
  /** Per-frame breakdown for debugging */
  frameVerdicts: FrameVerdict[]
}

const SYSTEM_PROMPT = `You classify the PRIMARY SUBJECT of a video frame into one of three categories:

  "real-person" — A real person or thing physically present in the scene. The camera is pointed at them in real space. Could be a creator on camera, someone they're filming, an object, a room, a landscape. The key signal: the subject's body has natural depth, lighting variation, and the background extends naturally around them.

  "screen" — The camera is pointed at a screen, monitor, TV, phone, computer display, photo, magazine, mirror reflection, or other surface that itself shows or reflects an image. The viewer sees a person or scene REPRESENTED, not the actual subject. STRICT requirements: a clearly visible bezel, screen edge, frame border, or photo edge that ENCLOSES the imagery. Without an enclosing edge, do NOT call it screen.

  "other" — Genuinely ambiguous, abstract, or doesn't fit either category (close-up of texture with no clear subject, transitions, etc.).

STRONG REAL-PERSON SIGNALS (treat as "real-person" even if other context is rectangular):
  - Person looking AT the camera, mouth open / mid-speech / eyes engaged with the lens
  - Selfie-style framing (close to camera, slightly off-center, body extends to frame edge)
  - Hands or arms extending toward / past the camera
  - Natural depth of field (subject sharp, background soft)
  - Visible skin/hair texture — pixel-clean texture suggests screen, fuzzy texture suggests live capture

ENVIRONMENTAL ELEMENTS THAT ARE NOT SCREENS (do NOT call screen):
  - A picture or print on a wall behind a real person — that person is the subject, not the picture
  - A hanging plant, decorative item, or window in the background
  - A doorway or dark area to one side of the frame
  - Studio backdrops, fabric drapes, or color blocks
  - A mirror in the background where you can ALSO see the actual person

CRITICAL distinctions:
  - Person talking directly at camera with face/mouth visible, even with rectangular wall art behind them = "real-person"
  - A photograph of a person held up close to the lens = "screen"
  - A person standing in front of a mirror, where you can see the actual person = "real-person"
  - A monitor or phone screen filling the frame, displaying a person = "screen"
  - A laptop with the user typing on it (the user is the subject) = "real-person"
  - A laptop where the camera is focused on the screen content = "screen"
  - A wall covered with framed photos and no real person = "screen"

CONFIDENCE CALIBRATION:
  - Only output confidence ≥ 0.85 for "screen" if you can clearly identify the screen edge / bezel / photo border
  - Default to "real-person" when a person is clearly the subject and you can't see the enclosing display edge
  - Use "other" liberally for ambiguous transition / texture / abstract frames

Output STRICT JSON only:
{
  "subject": "real-person" | "screen" | "other",
  "confidence": 0..1,
  "note": "short reason ≤ 80 chars"
}`

const PER_CALL_DELAY_MS = 350      // small gap between sequential vision calls
const RETRY_DELAYS_MS = [1500, 4000, 8000]   // backoff for 429s

/**
 * Classify each frame individually, then aggregate per ActionSpan.
 * Returns a parallel array indexed identically to the input actions.
 */
export async function classifySubjects(
  actions: ActionSpan[],
  frames: ExtractedFrame[],
  companyId: string | undefined,
): Promise<SpanVerdict[]> {
  if (actions.length === 0) return []

  // Build the dedup'd set of frames we actually need to classify — frames
  // inside any action span. Skip frames in dead windows entirely.
  const frameInsideAnyAction = (f: ExtractedFrame) =>
    actions.some((a) => f.timestamp >= a.startTime && f.timestamp <= a.endTime)
  const candidateFrames = frames.filter(frameInsideAnyAction)

  // Cap total frames to keep latency reasonable. Pick frames closest to each
  // action's beat timestamps so we get the most informative samples.
  const MAX_FRAMES = 24
  const selectedFrames = selectFramesToClassify(actions, candidateFrames, MAX_FRAMES)
  console.log(`[subject] classifying ${selectedFrames.length} frames across ${actions.length} actions (sequential, throttle-aware)`)

  // Sequential calls with throttle-aware retry
  const verdictsByFrameTime = new Map<number, FrameVerdict>()
  for (const frame of selectedFrames) {
    const v = await classifyFrameWithRetry(frame, companyId)
    verdictsByFrameTime.set(frame.timestamp, v)
    await delay(PER_CALL_DELAY_MS)
  }

  // Aggregate verdicts per ActionSpan
  const spanVerdicts: SpanVerdict[] = actions.map((action) => {
    const inside = selectedFrames
      .filter((f) => f.timestamp >= action.startTime && f.timestamp <= action.endTime)
      .map((f) => verdictsByFrameTime.get(f.timestamp))
      .filter((v): v is FrameVerdict => !!v)
      .sort((a, b) => a.frameTimestamp - b.frameTimestamp)

    if (inside.length === 0) {
      return { subject: 'unknown', confidence: 0, mixed: false, frameVerdicts: [] }
    }

    return aggregateSpanVerdicts(inside)
  })

  // Log a compact summary so we can see at a glance how the classifier read the video
  console.log('[subject] span classifications:')
  spanVerdicts.forEach((v, i) => {
    const a = actions[i]
    const mixedNote = v.mixed ? ` [MIXED — split at ${v.splitAt?.toFixed(1)}s]` : ''
    console.log(`  #${i + 1} [${a.startTime.toFixed(1)}-${a.endTime.toFixed(1)}s] ${a.durationClass} → ${v.subject} (${v.confidence.toFixed(2)})${mixedNote}`)
    v.frameVerdicts.forEach((fv) => {
      console.log(`     · ${fv.frameTimestamp.toFixed(1)}s: ${fv.subject} (${fv.confidence.toFixed(2)}) — ${fv.note}`)
    })
  })

  return spanVerdicts
}

/**
 * Pick a representative subset of frames to classify. We prefer frames near
 * each action's beats (boundaries + sub-peaks) since those are the moments
 * where the subject is visually informative.
 */
function selectFramesToClassify(actions: ActionSpan[], frames: ExtractedFrame[], maxFrames: number): ExtractedFrame[] {
  if (frames.length <= maxFrames) return frames

  // Score each frame by proximity to any beat. Closer to a beat = higher score.
  const scored = frames.map((f) => {
    let bestProximity = Infinity
    for (const a of actions) {
      for (const b of a.beats) {
        const d = Math.abs(f.timestamp - b.time)
        if (d < bestProximity) bestProximity = d
      }
    }
    return { frame: f, proximity: bestProximity }
  })
  scored.sort((a, b) => a.proximity - b.proximity)
  // Keep best `maxFrames`, then re-sort by timestamp for ordered processing
  return scored.slice(0, maxFrames).map((s) => s.frame).sort((a, b) => a.timestamp - b.timestamp)
}

async function classifyFrameWithRetry(frame: ExtractedFrame, companyId: string | undefined): Promise<FrameVerdict> {
  let lastErr: Error | null = null
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await classifyFrame(frame, companyId)
    } catch (err) {
      lastErr = err as Error
      const msg = lastErr.message || ''
      // Only retry on rate-limit / throttle errors
      const isThrottle = msg.includes('Too many requests') || msg.includes('Throttling') || msg.includes('429')
      if (!isThrottle || attempt >= RETRY_DELAYS_MS.length) break
      const wait = RETRY_DELAYS_MS[attempt]
      console.log(`[subject] frame ${frame.timestamp.toFixed(1)}s throttled — retry in ${wait}ms`)
      await delay(wait)
    }
  }
  console.warn(`[subject] frame ${frame.timestamp.toFixed(1)}s failed after retries: ${lastErr?.message}`)
  return {
    frameTimestamp: frame.timestamp,
    subject: 'unknown',
    confidence: 0,
    note: lastErr?.message?.slice(0, 80) || 'classify error',
  }
}

async function classifyFrame(frame: ExtractedFrame, companyId: string | undefined): Promise<FrameVerdict> {
  type ContentItem =
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

  const content: ContentItem[] = [
    { type: 'text', text: `Frame at ${frame.timestamp.toFixed(1)}s:` },
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: frame.base64 } },
    { type: 'text', text: '\nClassify the primary subject. Output JSON only.' },
  ]

  const raw = await invokeAgent({
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
    maxTokens: 96,
    temperature: 0.1,
    companyId,
  })
  const parsed = parseAgentOutput<{ subject?: string; confidence?: number; note?: string }>(raw)

  const subject: SubjectKind = parsed.subject === 'real-person' || parsed.subject === 'screen' || parsed.subject === 'other'
    ? parsed.subject
    : 'unknown'
  const confidence = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0
  const note = typeof parsed.note === 'string' ? parsed.note.slice(0, 80) : ''

  return { frameTimestamp: frame.timestamp, subject, confidence, note }
}

/**
 * Aggregate per-frame verdicts into a single span verdict. Detects "mixed"
 * spans — where adjacent frames disagree — and computes a split-at timestamp
 * so the caller can break the span into homogeneous sub-spans.
 */
function aggregateSpanVerdicts(frameVerdicts: FrameVerdict[]): SpanVerdict {
  const sorted = [...frameVerdicts].sort((a, b) => a.frameTimestamp - b.frameTimestamp)

  // Tally weighted by confidence (skip 'unknown' from the tally).
  // SCREEN verdicts only count if confidence is ≥ 0.85 — the classifier has
  // a known false-positive rate on real-person frames with rectangular
  // background elements (wall art, doorways, dark areas reading as bezels).
  // Lower-confidence "screen" calls aren't enough to override real-person.
  const tally: Record<SubjectKind, number> = { 'real-person': 0, screen: 0, other: 0, unknown: 0 }
  for (const v of sorted) {
    if (v.subject === 'unknown') continue
    if (v.subject === 'screen' && v.confidence < 0.85) {
      // Demote uncertain screen calls to "other" rather than letting them
      // dominate the span tally
      tally.other += Math.max(0.1, v.confidence) * 0.5
      continue
    }
    tally[v.subject] += Math.max(0.1, v.confidence)
  }
  const ranked = (['real-person', 'screen', 'other'] as SubjectKind[])
    .map((s) => ({ s, score: tally[s] }))
    .sort((a, b) => b.score - a.score)
  const dominant = ranked[0].score > 0 ? ranked[0].s : 'unknown'
  const totalScore = ranked.reduce((sum, r) => sum + r.score, 0)
  const dominantConfidence = totalScore > 0 ? ranked[0].score / totalScore : 0

  // Detect a clean transition: find the first index where the verdict
  // *changes* from the dominant subject and stays changed. If such a change
  // exists, the span is mixed and split-at is between those two frames.
  let mixed = false
  let splitAt: number | undefined

  // Group consecutive same-subject frames into runs.
  type Run = { subject: SubjectKind; from: number; to: number; frameCount: number }
  const runs: Run[] = []
  for (const v of sorted) {
    const last = runs[runs.length - 1]
    if (last && last.subject === v.subject) {
      last.to = v.frameTimestamp
      last.frameCount++
    } else {
      runs.push({ subject: v.subject, from: v.frameTimestamp, to: v.frameTimestamp, frameCount: 1 })
    }
  }

  // Look for the first 'screen' / 'real-person' boundary in the runs.
  // We only consider mixed when both subjects are real-person and screen
  // (other → other transitions aren't actionable).
  for (let i = 1; i < runs.length; i++) {
    const prev = runs[i - 1]
    const cur = runs[i]
    const isPersonScreenSwitch =
      (prev.subject === 'real-person' && cur.subject === 'screen') ||
      (prev.subject === 'screen' && cur.subject === 'real-person')
    if (!isPersonScreenSwitch) continue
    // Require at least one frame on each side to call it mixed; one-frame
    // anomalies are likely classifier noise.
    if (prev.frameCount < 1 || cur.frameCount < 1) continue
    mixed = true
    splitAt = (prev.to + cur.from) / 2
    break
  }

  return {
    subject: dominant,
    confidence: dominantConfidence,
    mixed,
    splitAt,
    frameVerdicts: sorted,
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Subject-aware segment-length policy.
 * Every category respects the 2.0s global floor — anything under 2s feels rushed.
 */
export function lengthPolicyFor(subject: SubjectKind): { minLen: number; maxLen: number; postBreath: number } {
  switch (subject) {
    case 'real-person':
      return { minLen: 2.5, maxLen: 6.0, postBreath: 0.4 }
    case 'screen':
      return { minLen: 2.0, maxLen: 3.0, postBreath: 0.0 }
    case 'other':
    case 'unknown':
    default:
      return { minLen: 2.0, maxLen: 5.0, postBreath: 0.2 }
  }
}
