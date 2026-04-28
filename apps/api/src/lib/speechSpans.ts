/**
 * Speech Span Detector
 *
 * Builds "speech spans" — continuous runs of speech where cutting in the
 * middle would chop a sentence or thought in half. Used by the clip analyzer
 * to enforce: never cut inside a story.
 *
 * Existing transcript.segments split on 1s+ silence which is too coarse: a
 * thoughtful 1-second pause is still part of the same thought. We rebuild
 * spans from word timestamps using a tighter 0.65s gap threshold but a
 * MINIMUM duration so we don't flag every individual word as a span.
 */

import type { TranscriptionResult } from './transcribe.service'

export interface SpeechSpan {
  startTime: number
  endTime: number
  duration: number
  wordCount: number
  /** First few words for human-readable span identification */
  preview: string
  /** Concatenated text */
  text: string
}

const GAP_BREAK = 0.65       // word gap > this seconds = new span
const MIN_DURATION = 1.5     // ignore spans shorter than this — they're not real "stories" we'd cut
const MIN_WORDS = 3          // and they need real content

export function detectSpeechSpans(transcript: TranscriptionResult): SpeechSpan[] {
  const words = transcript.words || []
  if (words.length === 0) return []

  const spans: SpeechSpan[] = []
  let buf: typeof words = []
  let lastEnd = -Infinity

  const flush = () => {
    if (buf.length < MIN_WORDS) {
      buf = []
      return
    }
    const start = buf[0].startTime
    const end = buf[buf.length - 1].endTime
    if (end - start < MIN_DURATION) {
      buf = []
      return
    }
    const text = buf.map((w) => w.text).join(' ')
    spans.push({
      startTime: start,
      endTime: end,
      duration: end - start,
      wordCount: buf.length,
      preview: text.split(' ').slice(0, 8).join(' '),
      text,
    })
    buf = []
  }

  for (const w of words) {
    if (lastEnd > -Infinity && w.startTime - lastEnd > GAP_BREAK) {
      flush()
    }
    buf.push(w)
    lastEnd = w.endTime
  }
  flush()

  return spans
}

/**
 * Returns the speech span that t falls strictly inside (not its start/end).
 * Used by the snap pass to detect mid-sentence cuts.
 */
export function findSpeechSpanAt(t: number, spans: SpeechSpan[], padding = 0.2): SpeechSpan | null {
  for (const s of spans) {
    if (t > s.startTime + padding && t < s.endTime - padding) return s
  }
  return null
}
