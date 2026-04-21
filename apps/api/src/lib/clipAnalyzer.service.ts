/**
 * Clip Analyzer Service (Riley's brain)
 *
 * CapCut-style reel editing with VISION:
 * - Extracts keyframes and sends them to Bedrock so Riley can SEE the video
 * - Combines visual frames + transcript + motion data for full-picture analysis
 * - Picks the best moments based on what's actually happening, not just audio
 * - Outputs a shot list of timestamps that FFmpeg stitches into a reel
 */

import { invokeAgent, parseAgentOutput } from '../services/bedrock/bedrock.service'
import { TranscriptionResult } from './transcribe.service'
import { SceneAnalysis } from './sceneDetection.service'
import { ExtractedFrame } from './keyframeExtractor.service'

export interface ReelSegment {
  startTime: number
  endTime: number
  label: string      // what's happening in this segment
  energy: 'high' | 'medium' | 'hook'  // why it was picked
}

export interface ClipDecision {
  segments: ReelSegment[]
  totalDuration: number
  hook: string
  rationale: string
  transcript: string   // combined transcript of all selected segments
}

/**
 * Riley analyzes the video using VISION (keyframes) + audio (transcript) + motion data.
 * This is the full-picture analysis — Riley can actually see what's happening.
 */
export async function analyzeAndPickClip(
  transcript: TranscriptionResult,
  videoDuration: number,
  targetDuration: number,
  companyId: string | undefined,
  sceneData: SceneAnalysis | undefined,
  frames: ExtractedFrame[],
): Promise<ClipDecision> {
  // Very short video — use the whole thing
  if (videoDuration <= 10) {
    return {
      segments: [{ startTime: 0, endTime: videoDuration, label: 'Full clip', energy: 'high' }],
      totalDuration: videoDuration,
      hook: transcript.segments[0]?.text || '',
      rationale: 'Video is very short — using full video',
      transcript: transcript.fullText,
    }
  }

  // Build all the context Riley needs
  const hasSpeech = transcript.hasSpeech

  // Transcript section
  let transcriptSection = ''
  if (transcript.segments.length > 0) {
    const segmentList = transcript.segments.map(seg => (
      `[${fmt(seg.startTime)} - ${fmt(seg.endTime)}] "${seg.text}"`
    )).join('\n')
    transcriptSection = `\nAudio/Speech:\n${segmentList}`

    // Gaps
    const gaps: string[] = []
    for (let i = 0; i < transcript.segments.length - 1; i++) {
      const gapDuration = transcript.segments[i + 1].startTime - transcript.segments[i].endTime
      if (gapDuration > 2) {
        gaps.push(`[${fmt(transcript.segments[i].endTime)} - ${fmt(transcript.segments[i + 1].startTime)}] SILENCE (${gapDuration.toFixed(1)}s)`)
      }
    }
    if (gaps.length > 0) {
      transcriptSection += `\n\nSilent gaps:\n${gaps.join('\n')}`
    }
  }

  // Scene/motion section
  let sceneSection = ''
  if (sceneData && sceneData.scenes.length > 0) {
    const sceneList = sceneData.scenes.map((s, i) => (
      `Scene ${i + 1}: [${fmt(s.startTime)} - ${fmt(s.endTime)}] ${s.duration.toFixed(1)}s — Motion: ${s.motionScore.toFixed(2)} (${s.label})`
    )).join('\n')
    sceneSection = `\nMotion analysis:\n${sceneList}`
  }

  // Frame descriptions for the prompt
  const frameLabels = frames.map((f, i) => `Frame ${i + 1} at ${fmt(f.timestamp)}`).join(', ')

  const systemPrompt = `You are Riley, a Creative Director who edits reels. You can SEE the actual video frames.

You're looking at ${frames.length} keyframes extracted from a ${videoDuration.toFixed(1)}-second video, plus audio transcript and motion data. Use ALL of this to make editing decisions.

Your job: build a CapCut-style reel — multiple jump cuts of the BEST visual moments. Cut everything boring.

CRITICAL RULES:
1. LOOK AT THE FRAMES — they show you what's actually happening. A "silent" moment might be visually stunning
2. HOOK FIRST — start with the most visually striking or emotionally compelling moment (NOT necessarily the beginning)
3. CUT DEAD MOMENTS — if a frame shows nothing happening (idle, blank, setup), cut that time range
4. KEEP VISUAL ACTION — movement, expressions, reveals, transformations, reactions — but only the PEAK 2-4 seconds of each
5. EVERY SEGMENT MUST BE 2-5 SECONDS — this is a reel, not a long-form video. Think TikTok/IG Reels pacing. No segment longer than 5 seconds. Trim to the peak moment of each action
6. TARGET ~${Math.min(targetDuration, Math.floor(videoDuration * 0.5))}s TOTAL — the output should be roughly HALF the input length or less. Aim for ${Math.min(targetDuration, Math.floor(videoDuration * 0.5))}s from this ${videoDuration.toFixed(0)}s video
7. FAST CUTS — CapCut style. Each cut should show ONE action/moment then jump to the next. Don't linger
8. If the entire video is action-packed, still trim each moment to its 2-3 second peak. An establishing shot needs 2 seconds, not 8. A reaction needs 1-2 seconds. Loading something needs 2-3 seconds
9. REORDER FOR IMPACT — the chronological order is NOT sacred. Put the most visually striking moment first as the hook, then arrange for energy flow

Respond in valid JSON only:
{
  "segments": [
    { "startTime": number, "endTime": number, "label": "string (what's visually happening)", "energy": "hook|high|medium" }
  ],
  "hook": "string (describe the opening visual — what grabs attention first)",
  "rationale": "string (why you chose these cuts — reference what you SAW in the frames)"
}`

  // Build the message content with interleaved frames and text
  const content: Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }> = []

  // Add context text first
  content.push({
    type: 'text',
    text: `Video: ${videoDuration.toFixed(1)}s | Target reel: ~${targetDuration}s | Frames: ${frames.length}
${hasSpeech ? `Speech: ${transcript.words.length} words` : 'No meaningful speech — visual content only'}
${transcriptSection}
${sceneSection}

Here are the keyframes from the video. Each frame is labeled with its timestamp. Look at what's happening visually to decide what to keep and cut:`
  })

  // Add frames with timestamp labels
  for (const frame of frames) {
    content.push({
      type: 'text',
      text: `\n--- Frame at ${fmt(frame.timestamp)} (${frame.timestamp.toFixed(1)}s) ---`
    })
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: frame.base64 }
    })
  }

  content.push({
    type: 'text',
    text: `\nBased on what you SEE in these frames + the audio/motion data above, build a reel. Cut the boring parts. Keep only what's visually compelling. Output JSON only.`
  })

  try {
    const raw = await invokeAgent({
      systemPrompt,
      messages: [{ role: 'user', content }],
      maxTokens: 1024,
      temperature: 0.3,
      companyId,
    })

    const decision = parseAgentOutput<{
      segments: Array<{ startTime: number; endTime: number; label: string; energy: string }>
      hook: string
      rationale: string
    }>(raw)

    // Validate and clamp segments
    const segments: ReelSegment[] = (decision.segments || [])
      .map(s => ({
        startTime: Math.max(0, s.startTime),
        endTime: Math.min(videoDuration, s.endTime),
        label: s.label,
        energy: (s.energy === 'hook' || s.energy === 'high' || s.energy === 'medium' ? s.energy : 'high') as ReelSegment['energy'],
      }))
      .filter(s => s.endTime > s.startTime && (s.endTime - s.startTime) >= 0.5)

    if (segments.length === 0) {
      return fallbackClip(videoDuration, targetDuration, sceneData)
    }

    const totalDuration = segments.reduce((sum, s) => sum + (s.endTime - s.startTime), 0)

    // Build combined transcript from selected segments
    const clipTranscript = segments.map(seg => {
      return transcript.words
        .filter(w => w.startTime >= seg.startTime && w.endTime <= seg.endTime)
        .map(w => w.text)
        .join(' ')
    }).filter(Boolean).join(' ')

    console.log(`[clip-analyzer] Riley (vision) picked ${segments.length} segments, ${totalDuration.toFixed(1)}s total`)
    segments.forEach((s, i) => {
      console.log(`  ${i + 1}. [${fmt(s.startTime)}-${fmt(s.endTime)}] ${s.energy} — ${s.label}`)
    })
    console.log(`  Rationale: ${decision.rationale}`)

    return {
      segments,
      totalDuration,
      hook: decision.hook || '',
      rationale: decision.rationale || '',
      transcript: clipTranscript || transcript.fullText,
    }
  } catch (err) {
    console.error('[clip-analyzer] Vision analysis failed, using fallback:', err)
    return fallbackClip(videoDuration, targetDuration, sceneData)
  }
}

/**
 * Fallback when Bedrock fails — use motion data or even splits.
 */
function fallbackClip(videoDuration: number, targetDuration: number, sceneData?: SceneAnalysis): ClipDecision {
  // If we have scene data, pick highest motion segments
  if (sceneData && sceneData.scenes.length > 1) {
    const sorted = [...sceneData.scenes].sort((a, b) => b.motionScore - a.motionScore)
    const segments: ReelSegment[] = []
    let total = 0
    for (const scene of sorted) {
      if (total >= targetDuration) break
      const dur = Math.min(scene.duration, 8)
      segments.push({
        startTime: scene.startTime,
        endTime: scene.startTime + dur,
        label: scene.label,
        energy: scene.motionScore > 0.6 ? 'high' : 'medium',
      })
      total += dur
    }
    segments.sort((a, b) => a.startTime - b.startTime)
    return { segments, totalDuration: total, hook: '', rationale: 'Fallback: highest-motion scenes', transcript: '' }
  }

  // Last resort: even splits
  const usable = Math.min(videoDuration, targetDuration)
  const segCount = Math.max(1, Math.floor(usable / 8))
  const segDuration = usable / segCount
  const segments: ReelSegment[] = []
  for (let i = 0; i < segCount; i++) {
    segments.push({
      startTime: i * segDuration,
      endTime: (i + 1) * segDuration,
      label: i === 0 ? 'Opening' : `Segment ${i + 1}`,
      energy: i === 0 ? 'hook' : 'medium',
    })
  }
  return { segments, totalDuration: usable, hook: '', rationale: 'Fallback: even segments', transcript: '' }
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
