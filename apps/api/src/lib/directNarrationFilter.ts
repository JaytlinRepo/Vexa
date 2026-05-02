/**
 * Direct Narration Filter
 *
 * Filters detected SpeechSpans down to ONLY those where the speaker is
 * directly addressing the camera. Background chatter, ambient TV/music,
 * off-camera voices, and side-profile mumbling are all dropped.
 *
 * Two-stage filter:
 *   1. Audio pre-filter (cheap, local):
 *      - Mean per-word transcribe confidence ≥ 0.65 (direct speech parses
 *        cleanly; background chatter is mumbled/quiet → low confidence).
 *      - Span loudness within 8 LUFS of the audio peak (foreground speaker
 *        is the dominant source).
 *   2. Vision confirm (Bedrock, only on spans that survive stage 1):
 *      - Send 1-2 keyframes from inside the span + a strict prompt.
 *      - Require Claude to confirm BOTH "person facing camera" AND
 *        "appears to be speaking/addressing the audience."
 *
 * Strict mode (default): requires isDirect=true AND confidence ≥ 0.7.
 * False positives (ambient chatter being preserved) ruin the reel; false
 * negatives (a real narration being dropped) are recoverable via regen.
 *
 * Falls back gracefully: if Bedrock fails, return audio-prefiltered spans
 * unchanged. If audio data is missing, return all spans unchanged.
 */

import type { SpeechSpan } from './speechSpans'
import type { TranscriptionResult } from './transcribe.service'
import type { ExtractedFrame } from './keyframeExtractor.service'
import type { AudioPoint } from './audioEnergy.service'
import { invokeAgent, parseAgentOutput } from '../services/bedrock/bedrock.service'

export interface FilterOptions {
  /** Strict requires both signals; loose accepts either */
  mode?: 'strict' | 'loose'
  /** Minimum span duration to bother filtering — short spans are kept as-is */
  minDurationToFilter?: number
  /** Skip the Bedrock confirm step (audio-only) — for testing or when offline */
  skipVisionConfirm?: boolean
  /** Only relevant for loose mode */
  visionMinConfidence?: number
}

export interface FilterResult {
  kept: SpeechSpan[]
  dropped: Array<{
    span: SpeechSpan
    reason: string
    detail?: string
  }>
}

const AUDIO_CONFIDENCE_FLOOR = 0.65
const LOUDNESS_FLOOR_DELTA_LUFS = 8.0
const STRICT_VISION_CONFIDENCE = 0.7

export async function filterDirectNarration(
  spans: SpeechSpan[],
  transcript: TranscriptionResult,
  frames: ExtractedFrame[],
  audioCurve: AudioPoint[] | undefined,
  companyId: string | undefined,
  options: FilterOptions = {},
): Promise<FilterResult> {
  const mode = options.mode ?? 'strict'
  const minDur = options.minDurationToFilter ?? 1.5
  const visionMinConf = options.visionMinConfidence ?? (mode === 'strict' ? STRICT_VISION_CONFIDENCE : 0.5)

  const result: FilterResult = { kept: [], dropped: [] }

  if (spans.length === 0) return result

  // Compute the audio peak once (used for loudness gating).
  const peakLufs = audioCurve && audioCurve.length > 0
    ? audioCurve.reduce((p, x) => (x.loudnessLufs > p ? x.loudnessLufs : p), -70)
    : null

  for (const span of spans) {
    // Skip very short spans — keep them by default; they're not worth a
    // Bedrock call and aren't likely to anchor a story-preservation cut.
    if (span.duration < minDur) {
      result.kept.push(span)
      continue
    }

    // ── Stage 1: audio pre-filter ────────────────────────────────────────

    // Mean word confidence inside the span
    const wordsInSpan = transcript.words.filter(
      (w) => w.startTime >= span.startTime - 0.05 && w.endTime <= span.endTime + 0.05,
    )
    const meanConfidence = wordsInSpan.length > 0
      ? wordsInSpan.reduce((s, w) => s + w.confidence, 0) / wordsInSpan.length
      : 0

    if (meanConfidence < AUDIO_CONFIDENCE_FLOOR) {
      result.dropped.push({
        span,
        reason: 'low-confidence-audio',
        detail: `mean word confidence ${meanConfidence.toFixed(2)} < ${AUDIO_CONFIDENCE_FLOOR}`,
      })
      continue
    }

    // Loudness gating — span's peak loudness should be within delta of file peak
    if (peakLufs != null && audioCurve) {
      const spanAudio = audioCurve.filter((p) => p.time >= span.startTime && p.time <= span.endTime)
      if (spanAudio.length > 0) {
        const spanPeakLufs = spanAudio.reduce((p, x) => (x.loudnessLufs > p ? x.loudnessLufs : p), -70)
        const delta = peakLufs - spanPeakLufs
        if (delta > LOUDNESS_FLOOR_DELTA_LUFS) {
          result.dropped.push({
            span,
            reason: 'background-loudness',
            detail: `span peak ${spanPeakLufs.toFixed(1)} LUFS is ${delta.toFixed(1)} below file peak ${peakLufs.toFixed(1)}`,
          })
          continue
        }
      }
    }

    // ── Stage 2: vision confirm ─────────────────────────────────────────
    if (options.skipVisionConfirm) {
      result.kept.push(span)
      continue
    }

    const candidateFrames = pickFramesInSpan(span, frames, 2)
    if (candidateFrames.length === 0) {
      // No frames available for this span — fall back to audio-only verdict.
      // In strict mode we err toward dropping (no visual evidence = no proof
      // of direct narration).
      if (mode === 'strict') {
        result.dropped.push({ span, reason: 'no-frames-strict' })
      } else {
        result.kept.push(span)
      }
      continue
    }

    let visionVerdict: { isDirect: boolean; confidence: number; note?: string } | null = null
    try {
      visionVerdict = await visionConfirm(span, candidateFrames, companyId)
    } catch (err) {
      console.warn(`[direct-narration] vision confirm failed for span ${span.startTime.toFixed(1)}s: ${(err as Error).message}`)
      // On Bedrock failure, fall back to audio-only verdict (which already
      // passed). Keep the span — degraded but not blocked.
      result.kept.push(span)
      continue
    }

    if (!visionVerdict) {
      result.kept.push(span)
      continue
    }

    const passesVision = mode === 'strict'
      ? visionVerdict.isDirect && visionVerdict.confidence >= visionMinConf
      : visionVerdict.isDirect

    if (passesVision) {
      result.kept.push(span)
    } else {
      result.dropped.push({
        span,
        reason: 'vision-not-direct',
        detail: `isDirect=${visionVerdict.isDirect}, confidence=${visionVerdict.confidence.toFixed(2)}${visionVerdict.note ? ` — "${visionVerdict.note}"` : ''}`,
      })
    }
  }

  console.log(`[direct-narration] mode=${mode} kept=${result.kept.length}/${spans.length} dropped=${result.dropped.length}`)
  for (const d of result.dropped) {
    console.log(`  drop [${d.span.startTime.toFixed(1)}-${d.span.endTime.toFixed(1)}s] ${d.reason}: "${d.span.preview}" — ${d.detail ?? ''}`)
  }

  return result
}

/**
 * Pick up to N frames from inside a speech span, preferring frames near the
 * middle (most representative of who's speaking).
 */
function pickFramesInSpan(span: SpeechSpan, frames: ExtractedFrame[], maxFrames: number): ExtractedFrame[] {
  const inside = frames.filter((f) => f.timestamp >= span.startTime && f.timestamp <= span.endTime)
  if (inside.length <= maxFrames) return inside
  // Pick frames evenly distributed across the span
  const step = inside.length / maxFrames
  const out: ExtractedFrame[] = []
  for (let i = 0; i < maxFrames; i++) {
    out.push(inside[Math.min(inside.length - 1, Math.floor(i * step + step / 2))])
  }
  return out
}

/**
 * Send 1-2 frames + a tight prompt to Bedrock and get a strict verdict on
 * whether the speaker is directly addressing the camera.
 */
async function visionConfirm(
  span: SpeechSpan,
  frames: ExtractedFrame[],
  companyId: string | undefined,
): Promise<{ isDirect: boolean; confidence: number; note?: string }> {
  const systemPrompt = `You evaluate whether a person in a video frame is DIRECTLY ADDRESSING THE CAMERA — i.e. the speaker of audio that's playing during this frame is the person on screen, talking to the audience.

Direct narration looks like:
  - Person facing the camera or close to it (front-on or 3/4 view)
  - Eyes generally toward the lens
  - Mouth/face visible enough to be a believable speech source

NOT direct narration:
  - Person facing away, turned to the side, or showing only their back
  - Person doing an action while audio plays (cooking, walking, posing) but NOT talking to camera
  - No person in frame at all (B-roll, scenery, object close-up)
  - Multiple people not focused on the lens (background conversation)
  - Person with mouth clearly closed or expression that says they're not speaking

Output STRICT JSON only:
{
  "isDirect": boolean,
  "confidence": 0..1,
  "note": "short reason"
}

Be conservative. If unsure, output isDirect=false. False positives (mistaking ambient audio for direct narration) are worse than false negatives (missing a real narration moment).`

  const text = `Speech timestamp: ${span.startTime.toFixed(1)}-${span.endTime.toFixed(1)}s
Transcript snippet: "${span.preview}${span.wordCount > 8 ? '…' : ''}"

Frames from inside this speech span:`

  const content: Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }> = [
    { type: 'text', text },
  ]
  for (const f of frames) {
    content.push({ type: 'text', text: `\n--- Frame at ${f.timestamp.toFixed(1)}s ---` })
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: f.base64 } })
  }
  content.push({
    type: 'text',
    text: `\nIs the person in these frames directly addressing the camera while speaking? Output JSON only.`,
  })

  const raw = await invokeAgent({
    systemPrompt,
    messages: [{ role: 'user', content }],
    maxTokens: 128,
    temperature: 0.1,
    companyId,
  })

  const parsed = parseAgentOutput<{ isDirect?: boolean; confidence?: number; note?: string }>(raw)
  return {
    isDirect: !!parsed.isDirect,
    confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0,
    note: typeof parsed.note === 'string' ? parsed.note.slice(0, 120) : undefined,
  }
}
