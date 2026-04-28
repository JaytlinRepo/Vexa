/**
 * Clip Analyzer Service (Riley's brain)
 *
 * CapCut-style reel editing with VISION:
 * - Extracts keyframes and sends them to Bedrock so Riley can SEE the video
 * - Combines visual frames + transcript + motion data for full-picture analysis
 * - Picks the best moments based on what's actually happening, not just audio
 * - Outputs a shot list of timestamps that FFmpeg stitches into a reel
 */

import { PrismaClient } from '@prisma/client'
import { invokeAgent, parseAgentOutput } from '../services/bedrock/bedrock.service'
import { TranscriptionResult } from './transcribe.service'
import { SceneAnalysis } from './sceneDetection.service'
import { ExtractedFrame } from './keyframeExtractor.service'
import type { BeatAnalysis, Beat } from './beatDetector.service'
import { snapToBeat } from './beatDetector.service'
import type { BadWindow } from './qualityCurve.service'
import { detectSpeechSpans, findSpeechSpanAt, SpeechSpan } from './speechSpans'
import { filterDirectNarration } from './directNarrationFilter'
import type { AudioPoint } from './audioEnergy.service'
import { lengthPolicyFor } from './subjectClassifier.service'

export interface ReelSegment {
  startTime: number
  endTime: number
  label: string      // what's happening in this segment
  energy: 'high' | 'medium' | 'hook'  // why it was picked
}

export type LengthTier = 'quick' | 'standard' | 'story' | 'instructional'

export interface LengthTierSpec {
  tier: LengthTier
  /** Target output range in seconds */
  minSeconds: number
  maxSeconds: number
  /** Soft target Riley aims at; backend ceiling = maxSeconds */
  targetSeconds: number
  description: string
}

export const LENGTH_TIERS: Record<LengthTier, LengthTierSpec> = {
  quick: {
    tier: 'quick',
    minSeconds: 8,
    maxSeconds: 15,
    targetSeconds: 12,
    description: 'A single moment, punchline, or visual surprise. One pose or reveal.',
  },
  standard: {
    tier: 'standard',
    minSeconds: 20,
    maxSeconds: 35,
    targetSeconds: 28,
    description: 'Typical reel rhythm — 4-8 cuts, mix of action and payoff.',
  },
  story: {
    tier: 'story',
    minSeconds: 40,
    maxSeconds: 60,
    targetSeconds: 48,
    description: 'Narrative arc with multiple beats — setup, build, payoff. 6-12 cuts.',
  },
  instructional: {
    tier: 'instructional',
    minSeconds: 60,
    maxSeconds: 90,
    targetSeconds: 75,
    description: 'Demo, tutorial, or multi-step content. Each step gets room to land.',
  },
}

export interface ClipDecision {
  segments: ReelSegment[]
  totalDuration: number
  hook: string
  rationale: string
  transcript: string   // combined transcript of all selected segments
  /** Which length tier Riley chose for this reel */
  lengthTier?: LengthTier
}

// ── Default editing rules (seeded to memory on first use) ──────────────────

const DEFAULT_EDITING_RULES = `WHAT TO PRIORITIZE (in order):
1. HUMAN ACTIONS — a person doing something is ALWAYS more interesting than scenery. Closing a door, picking something up, a gesture, a reaction, walking, reaching, handing something to someone. These are the moments that make reels feel alive. NEVER skip a human action
2. INTERACTIONS — people with pets, people with other people, hands touching objects. Connection moments are gold
3. REVEALS & TRANSITIONS — opening/closing things, entering/exiting frame, before/after moments
4. EMOTIONAL BEATS — facial expressions, body language shifts, laughter, surprise
5. ESTABLISHING CONTEXT — scenery, objects, locations. Important but only needs 1-2 seconds

HOW TO EDIT:
1. HOOK FIRST — start with the most visually striking HUMAN ACTION (not scenery, not an establishing shot)
2. EVERY SEGMENT 2-5 SECONDS — this is a reel. One action per cut, then jump
3. SCAN EVERY FRAME — if you see a person doing ANY action between two frames (e.g. frame at 0:24 shows trunk open, frame at 0:26 shows trunk closed), that action happened between those timestamps. INCLUDE IT
4. CUT DEAD MOMENTS — standing still, empty scenery, idle waiting. These get cut
5. REORDER FOR IMPACT — chronological order is NOT sacred. Best moment first
6. ESTABLISHING SHOTS = 1-2 SECONDS MAX — just enough context, then cut to action`

/**
 * Get Riley's editing rules from brand memory. Seeds defaults on first use.
 */
async function getEditingRules(prisma: PrismaClient, companyId: string): Promise<string> {
  // Look for existing rules
  const existing = await prisma.brandMemory.findMany({
    where: {
      companyId,
      content: { path: ['source'], equals: 'riley_rules' },
    },
    orderBy: { weight: 'desc' },
    take: 10,
  })

  if (existing.length > 0) {
    // Combine all rules — higher weight first
    return existing.map(m => (m.content as any).rule).filter(Boolean).join('\n')
  }

  // First time — seed the default rules as individual memories
  const rules = [
    { rule: 'HUMAN ACTIONS are the highest priority. A person doing something is ALWAYS more interesting than scenery. Closing a door, picking something up, a gesture, a reaction — these make reels feel alive. NEVER skip a human action.', category: 'priority', weight: 2.0 },
    { rule: 'INTERACTIONS between people, pets, or objects are gold. Connection moments engage viewers.', category: 'priority', weight: 1.8 },
    { rule: 'REVEALS and TRANSITIONS — opening/closing things, entering/exiting frame, before/after moments. Always include these.', category: 'priority', weight: 1.6 },
    { rule: 'EMOTIONAL BEATS — facial expressions, body language shifts, laughter, surprise. These create empathy.', category: 'priority', weight: 1.4 },
    { rule: 'ESTABLISHING CONTEXT — scenery, objects, locations. Only needs 1-2 seconds max.', category: 'priority', weight: 1.0 },
    { rule: 'HOOK FIRST — start with the most visually striking HUMAN ACTION, not scenery or establishing shots.', category: 'technique', weight: 2.0 },
    { rule: 'EVERY SEGMENT 2-5 SECONDS — one action per cut, then jump. This is a reel, not long-form.', category: 'technique', weight: 1.8 },
    { rule: 'SCAN BETWEEN FRAMES — if frame at 0:24 shows trunk open and frame at 0:26 shows it closed, that closing action happened between those timestamps. Include it.', category: 'technique', weight: 1.6 },
    { rule: 'CUT DEAD MOMENTS — standing still, empty scenery, idle waiting. These always get cut.', category: 'technique', weight: 1.5 },
    { rule: 'REORDER FOR IMPACT — chronological order is NOT sacred. Put the strongest moment first.', category: 'technique', weight: 1.3 },
  ]

  for (const r of rules) {
    await prisma.brandMemory.create({
      data: {
        companyId,
        memoryType: 'voice',
        weight: r.weight,
        content: {
          source: 'riley_rules',
          rule: r.rule,
          category: r.category,
          summary: `Riley editing rule: ${r.rule.slice(0, 80)}...`,
          tags: ['riley', 'editing', r.category],
        } as any,
      },
    })
  }

  console.log(`[clip-analyzer] Seeded ${rules.length} editing rules for company ${companyId}`)
  return DEFAULT_EDITING_RULES
}

/**
 * Fetch past editorial feedback from brand memory, filtered by relevance to current video.
 * Two queries: (1) feedback matching visual keywords in this video, (2) general editing preferences.
 */
async function getUserEditingPreferences(
  prisma: PrismaClient,
  companyId: string,
  currentFrameDescriptions?: string[],
): Promise<string> {
  // Get ALL studio feedback for this company
  const allFeedback = await prisma.brandMemory.findMany({
    where: {
      companyId,
      content: { path: ['source'], equals: 'studio' },
    },
    orderBy: [{ weight: 'desc' }, { createdAt: 'desc' }],
    take: 100, // Get a lot, then filter by relevance
  })

  if (allFeedback.length === 0) return ''

  // Extract keywords from current video's frame context
  const currentContext = (currentFrameDescriptions || []).join(' ').toLowerCase()

  // Score each memory by relevance to current video
  const scored = allFeedback.map(m => {
    const c = m.content as any
    const tags: string[] = c.tags || []
    const labels: string[] = c.segmentLabels || []
    const allText = [...tags, ...labels, c.summary || ''].join(' ').toLowerCase()

    let relevanceScore = 0

    // Direct tag matches with current video context
    for (const tag of tags) {
      if (currentContext.includes(tag.toLowerCase())) relevanceScore += 3
    }

    // Label similarity
    for (const label of labels) {
      const words = label.toLowerCase().split(/\s+/)
      for (const word of words) {
        if (word.length > 3 && currentContext.includes(word)) relevanceScore += 1
      }
    }

    // Rejections are more important to remember (don't repeat mistakes)
    if (allText.includes('rejected')) relevanceScore += 2

    // General editing preferences always relevant
    if (allText.includes('pacing') || allText.includes('too long') || allText.includes('too short')) relevanceScore += 2
    if (allText.includes('action') || allText.includes('human') || allText.includes('person')) relevanceScore += 1

    // Recency bonus
    const ageMs = Date.now() - new Date(m.createdAt).getTime()
    const ageDays = ageMs / (1000 * 60 * 60 * 24)
    if (ageDays < 7) relevanceScore += 1

    return { memory: m, content: c, relevanceScore }
  })

  // Sort by relevance and take the best
  scored.sort((a, b) => b.relevanceScore - a.relevanceScore)
  const relevant = scored.filter(s => s.relevanceScore > 0).slice(0, 20)
  const general = scored.filter(s => s.relevanceScore === 0).slice(0, 5) // A few general ones too

  const selected = [...relevant, ...general]
  if (selected.length === 0) return ''

  const lines = selected.map(s => {
    const c = s.content
    const labels = (c.segmentLabels || []).join(', ')
    const labelStr = labels ? ` [clips: ${labels}]` : ''
    return `- ${c.summary}${labelStr}`
  })

  return `\nUSER EDITING HISTORY (${allFeedback.length} total reviews, ${relevant.length} relevant to this video):
${lines.join('\n')}

Apply these preferences: repeat what was approved, avoid what was rejected. Pay attention to specific feedback about pacing, shot types, and content the user wants to see.`
}

export async function analyzeAndPickClip(
  transcript: TranscriptionResult,
  videoDuration: number,
  targetDuration: number,
  companyId: string | undefined,
  sceneData: SceneAnalysis | undefined,
  frames: ExtractedFrame[],
  prisma?: PrismaClient,
  creatorProfile?: { style?: Record<string, unknown> | null; retention?: Record<string, unknown> | null } | null,
  beatAnalysis?: BeatAnalysis,
  badWindows?: BadWindow[],
  audioCurve?: AudioPoint[],
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

  // Speech spans — but ONLY direct camera-facing narration counts as "story"
  // we'd preserve. Background chatter, ambient TV/music, or off-camera voices
  // are all detected by Transcribe but should NOT drive cut decisions.
  // The filter does an audio pre-check (confidence + loudness) then a vision
  // confirmation pass (Bedrock looks at frames inside the span and confirms
  // the speaker is addressing the camera). Strict mode by default.
  const rawSpeechSpans = detectSpeechSpans(transcript)
  let speechSpans: SpeechSpan[] = []
  if (rawSpeechSpans.length > 0) {
    try {
      const filterResult = await filterDirectNarration(
        rawSpeechSpans,
        transcript,
        frames,
        audioCurve,
        companyId,
        { mode: 'strict' },
      )
      speechSpans = filterResult.kept
    } catch (err) {
      console.warn('[clip-analyzer] Direct-narration filter failed — falling back to all spans:', (err as Error).message)
      speechSpans = rawSpeechSpans
    }
  }
  let speechSection = ''
  if (speechSpans.length > 0) {
    speechSection = `\nDIRECT NARRATION SPANS — the creator is speaking TO THE CAMERA in these (vision-confirmed). NEVER cut inside one. If you keep ANY part of a span, keep the whole span (or skip it entirely):\n` +
      speechSpans.map((s, i) =>
        `  Span #${i + 1} [${s.startTime.toFixed(1)}-${s.endTime.toFixed(1)}s] (${s.duration.toFixed(1)}s, ${s.wordCount} words): "${s.preview}${s.wordCount > 8 ? '…' : ''}"`
      ).join('\n') +
      `\n\nIf a span is longer than your max segment length, that's OK — extend the segment to fit the whole span. Cutting a sentence mid-thought reads as careless.`
  }

  // Scene/motion section — label dead vs active so Riley knows what to cut
  let sceneSection = ''
  if (sceneData && sceneData.scenes.length > 0) {
    const sceneList = sceneData.scenes.map((s, i) => {
      const activity = s.motionScore > 0.5 ? 'ACTIVE' : s.motionScore > 0.3 ? 'MODERATE' : 'DEAD TIME — CUT THIS'
      return `Scene ${i + 1}: [${fmt(s.startTime)} - ${fmt(s.endTime)}] ${s.duration.toFixed(1)}s — Motion: ${s.motionScore.toFixed(2)} [${activity}] (${s.label})`
    }).join('\n')
    sceneSection = `\nMotion analysis (use this to decide what to cut):\n${sceneList}`
  }

  // Beat / action analysis — the structured cut grid Riley must respect.
  // Every cut must land on a rest point (between actions) or a beat (inside an
  // action). Long actions are decomposed into beats so they get sampled, not
  // skipped wholesale: the start, end, motion peaks, and audio anomalies are
  // all preserved.
  let beatSection = ''
  if (beatAnalysis && beatAnalysis.actions.length > 0) {
    const restList = beatAnalysis.restPoints
      .map((t) => t.toFixed(1))
      .join(', ')
    const actionLines = beatAnalysis.actions.map((a, i) => {
      const beatList = a.beats.map((b) => {
        const tag = b.required ? 'REQUIRED' : 'optional'
        const w = b.suggestedWidth.toFixed(1)
        return `      ${b.time.toFixed(1)}s [${b.kind}] (${tag}, ~${w}s clip)`
      }).join('\n')
      const rule = a.durationClass === 'short'
        ? 'KEEP WHOLE as ONE segment (cut at start/end rest points). Mandatory.'
        : a.durationClass === 'medium'
          ? 'Output 1-2 segments from this action — either keep whole, or sample start + end. Mandatory.'
          : 'Output 2-4 segments sampling beats below — typically start (1.0-1.5s), each sub-peak (1.0-1.5s), end (1.0-1.5s). Compress the connective tissue between beats. Mandatory: action must contribute segments.'
      return `  Action #${i + 1} [${a.startTime.toFixed(1)}-${a.endTime.toFixed(1)}s] ${a.durationClass.toUpperCase()} (${a.duration.toFixed(1)}s, peak motion ${a.peakMotion.toFixed(2)})
    Sampling rule: ${rule}
    Beats:
${beatList}`
    }).join('\n\n')

    const deadList = beatAnalysis.deadWindows.length > 0
      ? '\nDead windows (skip these unless they bracket an action you keep):\n' +
        beatAnalysis.deadWindows.map((d, i) => `  Dead #${i + 1}: [${d.startTime.toFixed(1)}-${d.endTime.toFixed(1)}s]`).join('\n')
      : ''

    const reasonLabel: Record<string, string> = {
      shake: 'camera shake',
      blur: 'blurry / out of focus',
      frozen: 'frozen / stuttering',
    }
    const qualityList = (badWindows && badWindows.length > 0)
      ? '\nBAD-QUALITY WINDOWS — avoid cutting into these unless the moment is critical:\n' +
        badWindows.map((w) => {
          const sev = w.severity >= 0.8 ? 'severe' : w.severity >= 0.6 ? 'heavy' : 'moderate'
          const note = w.severity >= 0.6 ? ' (DO NOT use unless absolutely critical)' : ''
          return `  [${w.startTime.toFixed(1)}-${w.endTime.toFixed(1)}s] ${reasonLabel[w.reason] ?? w.reason} — ${sev}${note}`
        }).join('\n')
      : ''

    beatSection = `\nACTION BOUNDARIES — use these, do NOT invent timestamps:

Rest points (safe to start or end a segment): ${restList}

Actions detected:
${actionLines}
${deadList}
${qualityList}

CUT RULES (non-negotiable):

CORE PRINCIPLE — EVERY ACTION CONTRIBUTES:
The user uploaded ALL these moments. Don't skip any of them. Your job is NOT to pick which actions matter (they all do); your job is to decide HOW MUCH of each action to keep.
- Every detected action must contribute AT LEAST ONE segment to the output.
- A reel that hits 5 actions hard is better than a reel that picks the "best" 3 and drops the rest.
- If total runtime exceeds the tier ceiling, COMPRESS each contribution — don't drop actions.

WHERE TO CUT:
- Every segment startTime AND endTime must equal a rest point or a beat (within 0.5s).
- Never start or end a segment in the middle of an action unless that timestamp is on the beats list.
- For each beat you include, output a segment ~suggestedWidth seconds long centered on the beat time. If the tier is tight, lean toward the SHORTER end of suggestedWidth (1.0s instead of 1.5s).
- Audio-anomaly beats (sound spike, reaction, drop, slam) are usually worth keeping — micro-events the viewer notices.

HOW MUCH TO KEEP PER ACTION:
- SHORT (≤3s): keep whole — one segment.
- MEDIUM (3-6s): keep whole OR sample start + end (1-2 segments).
- LONG (>6s): SAMPLE 2-4 beats (start, sub-peaks, end). Keep each beat as a tight 1.0-1.5s segment. The action must be REPRESENTED, not skipped.`
  }

  // Frame descriptions for the prompt
  const frameLabels = frames.map((f, i) => `Frame ${i + 1} at ${fmt(f.timestamp)}`).join(', ')

  // Build a description of current video content for relevance matching
  const currentVideoContext: string[] = []
  if (transcript.fullText) currentVideoContext.push(transcript.fullText)
  if (sceneData) {
    sceneData.scenes.forEach(s => currentVideoContext.push(s.label))
  }

  // Fetch Riley's editing rules + user preferences from memory
  let editingRules = ''
  let preferencesSection = ''
  if (prisma && companyId) {
    editingRules = await getEditingRules(prisma, companyId)
    preferencesSection = await getUserEditingPreferences(prisma, companyId, currentVideoContext)
  }

  // Fallback to default rules if none stored yet
  if (!editingRules) {
    editingRules = DEFAULT_EDITING_RULES
  }

  // Use creator's STYLE profile to replicate how they edit
  // NOT audience optimization — that's Maya's job. Riley matches the creator's style.
  const style = creatorProfile?.style as Record<string, unknown> | undefined
  const retention = creatorProfile?.retention as Record<string, unknown> | undefined

  // Build retention insights — what the creator's audience actually responds to.
  // This is computed nightly by retentionIntelligence; we surface it directly into
  // Riley's prompt as constraints rather than letting it sit unused in brandMemory.
  let retentionInsightsSection = ''
  if (retention) {
    const insights: string[] = []
    const corr = (retention as any).performanceCorrelations as Record<string, { optimal?: number; bestPerforming?: string; impact?: number }> | undefined

    if (corr) {
      const cutImpact = corr.cutSpeed?.impact ?? 0
      if (corr.cutSpeed?.optimal && cutImpact > 0.15) {
        insights.push(`Cut speed: this audience rewards cuts at ~${corr.cutSpeed.optimal}s (impact: ${(cutImpact * 100).toFixed(0)}%). Match it.`)
      }
      const lenImpact = corr.videoLength?.impact ?? 0
      if (corr.videoLength?.optimal && lenImpact > 0.15) {
        insights.push(`Video length: ${corr.videoLength.optimal}s is the sweet spot for this audience (impact: ${(lenImpact * 100).toFixed(0)}%). Don't go significantly over.`)
      }
      const hookImpact = corr.hookTiming?.impact ?? 0
      if (corr.hookTiming?.optimal && hookImpact > 0.15) {
        insights.push(`Hook timing: payoff/punchline must land within ${corr.hookTiming.optimal}s. The audience drops if the hook lags.`)
      }
      const formatImpact = corr.format?.impact ?? 0
      if (corr.format?.bestPerforming && formatImpact > 0.15) {
        insights.push(`Format: "${corr.format.bestPerforming}" outperforms others by ${(formatImpact * 100).toFixed(0)}%. Lean into it.`)
      }
      const moodImpact = corr.mood?.impact ?? 0
      if (corr.mood?.bestPerforming && moodImpact > 0.15) {
        insights.push(`Mood: "${corr.mood.bestPerforming}" content lands best with this audience.`)
      }
      const subImpact = corr.subtitles?.impact ?? 0
      if (corr.subtitles?.bestPerforming && subImpact > 0.15) {
        insights.push(`Subtitles: ${corr.subtitles.bestPerforming} works best (impact: ${(subImpact * 100).toFixed(0)}%).`)
      }
    }

    const audience = (retention as any).audiencePatterns as { topTopics?: string[]; avoidTopics?: string[] } | undefined
    if (audience?.topTopics?.length) {
      insights.push(`Audience top topics: ${audience.topTopics.slice(0, 3).join(', ')} — emphasize these moments if present.`)
    }
    if (audience?.avoidTopics?.length) {
      insights.push(`Audience avoid topics: ${audience.avoidTopics.slice(0, 3).join(', ')} — skip moments that feel like these.`)
    }

    const trend = (retention as any).trend as { engagementTrend?: string; lastSignificantChange?: string } | undefined
    if (trend?.engagementTrend === 'declining' && trend.lastSignificantChange) {
      insights.push(`Recent trend: engagement declining. Note: ${trend.lastSignificantChange} — bias edits toward what worked historically, not what's been posted lately.`)
    }

    if (insights.length > 0) {
      retentionInsightsSection = `\nRETENTION INSIGHTS — what THIS creator's audience rewards (data-driven, must follow):\n${insights.map(i => '- ' + i).join('\n')}\n`
    }
  }

  // No hard target — Riley decides the output length based on what she sees + the creator's style.
  // We give her the source duration and her style profile. She decides what to keep and what to cut.
  const rawCutSpeed = (style as any)?.avgCutDuration || 3
  const avgCutSpeed = Math.max(1, rawCutSpeed)

  // Build creator style instructions — how THIS creator edits
  let creatorInstructions = ''
  if (style) {
    const parts: string[] = []

    // Cut & pacing
    if ((style as any).avgCutDuration) parts.push(`Cut rhythm: ${(style as any).avgCutDuration}s per cut — match this creator's pacing exactly`)
    if ((style as any).avgCutsPerVideo) parts.push(`Cuts per video: ${(style as any).avgCutsPerVideo} — this is how many cuts this creator typically makes`)
    if ((style as any).pacingSpeed) parts.push(`Pacing: ${(style as any).pacingSpeed} — this is how they edit`)
    if ((style as any).pacingCurve) parts.push(`Pacing curve: ${(style as any).pacingCurve}`)

    // Hook
    if ((style as any).hookStyle) parts.push(`Hook style: ${(style as any).hookStyle} — replicate how this creator opens their videos`)
    if ((style as any).hookTiming) parts.push(`Hook lands at: ${(style as any).hookTiming}s — match this timing`)

    // Structure
    if ((style as any).narrativeStructure) parts.push(`Story structure: ${(style as any).narrativeStructure} — follow this format`)
    if ((style as any).storytellingCadence) parts.push(`Cadence: ${(style as any).storytellingCadence}`)

    // Visual
    if ((style as any).zoomTypes?.length) parts.push(`Zoom style: ${(style as any).zoomTypes.join(', ')} — this is how they frame shots`)
    if ((style as any).transitionStyles?.length) parts.push(`Transitions: ${(style as any).transitionStyles.join(', ')}`)
    if ((style as any).colorGrading) parts.push(`Color grade: ${(style as any).colorGrading}`)

    // Subtitles
    if ((style as any).hasSubtitles) parts.push(`Subtitles: yes, ${(style as any).subtitleStyle || 'standard'} style`)
    else if ((style as any).hasSubtitles === false) parts.push(`Subtitles: this creator does NOT use subtitles`)

    if (parts.length > 0) {
      creatorInstructions = `\nCREATOR STYLE (replicate how this creator edits — preserve their identity):\n${parts.map(p => '- ' + p).join('\n')}\n\nYour goal is to edit this video exactly how the creator would edit it themselves. Save them time, not change their style.\n`
    }
  }

  const systemPrompt = `You are Riley, a Creative Director who replicates a creator's editing style. You can SEE the actual video frames.

You're looking at ${frames.length} keyframes extracted from a ${videoDuration.toFixed(1)}-second video, plus audio transcript and motion data. Use ALL of this to make editing decisions.

Your job: edit this ${videoDuration.toFixed(0)}s video the way THIS creator would edit it.
${creatorInstructions}${retentionInsightsSection}
PACING MATH:
- This creator averages ~${avgCutSpeed.toFixed(1)}s per segment.
- Source video is ${videoDuration.toFixed(0)}s long.
- Cut boring/dead footage, keep everything interesting.
- IMPORTANT: each individual segment must be ≤ ${Math.max(3, Math.round(avgCutSpeed * 1.6))}s. Long single shots feel like uncut footage.

LENGTH TIER — pick the tier that fits the CONTENT:
You must pick exactly ONE tier in your JSON output as "lengthTier". Pick based on what the video actually contains, not on source duration alone. Your segments must total within the picked tier's range.

  "quick" (8-15s) — a single moment, punchline, or visual surprise. ONE pose or reveal. Use this when the source has ONE truly compelling moment and the rest is filler.

  "standard" (20-35s) — typical reel rhythm. 4-8 cuts mixing action and payoff. Use this for most content: a few interesting moments stitched together.

  "story" (40-60s) — narrative arc with multiple beats: setup, build, payoff. 6-12 cuts. Use this when the video tells a sequence (morning routine, get-ready-with-me, day in the life).

  "instructional" (60-90s) — demo, tutorial, or multi-step content. Each step needs room to land. Use this for fitness reps, recipe steps, technique demos, before/after walkthroughs.

${(() => {
  const optimal = (retention as any)?.performanceCorrelations?.videoLength?.optimal as number | undefined
  const impact = (retention as any)?.performanceCorrelations?.videoLength?.impact as number | undefined
  if (optimal && impact && impact > 0.1) {
    let suggestion = 'standard'
    if (optimal <= 17) suggestion = 'quick'
    else if (optimal <= 38) suggestion = 'standard'
    else if (optimal <= 62) suggestion = 'story'
    else suggestion = 'instructional'
    return `RETENTION DATA suggests "${suggestion}" tier (this audience's optimal length is ${optimal}s, impact ${(impact * 100).toFixed(0)}%). PICK THIS tier unless the content clearly belongs to a different tier (e.g. clearly a tutorial = instructional even if retention says standard).`
  }
  return `No retention data yet — pick the tier that fits the content type.`
})()}

OUTPUT TIER: include "lengthTier" in your JSON. Your segments must total within the picked tier's range.

EDITING — HOW TO JUMP CUT:
For any continuous action, capture THREE moments: the START, a KEY MOMENT, and the END. Skip the connective tissue between them, but each kept moment must be long enough to LAND.

Example: "person posing for photos" (20 seconds of footage)
  BAD:  [0:00-0:20] — keeping all 20 seconds, no cuts
  BAD:  [0:00-0:01] [0:10-0:11] [0:18-0:19] — too rushed; viewer can't read the poses
  GOOD: [0:00-0:02.5] first pose lands → SKIP → [0:09-0:12] different pose with breathing room → SKIP → [0:17.5-0:20] final pose with payoff
The "GOOD" version takes 8s of source and gives ~7.5s of reel. That's correct compression — preserve the meaningful moments at human-readable length.

CRITICAL — WHERE TO CUT:
- NEVER cut in the middle of a movement or gesture. Wait for the action to complete.
- CUT BETWEEN poses, movements, or actions — not during them.
- Each segment must START at the beginning of an action and END after that action lands. If someone is reaching, walking, turning, or completing a pose — INCLUDE the moment the motion settles. Cutting before it lands feels rushed and amateur.
- If you're unsure whether the action has finished, EXTEND the segment by 0.5-1.0s. Better slightly long than truncated.
- Clean cuts feel professional. Mid-action cuts feel choppy.
- A reel of cuts that all land at the natural end of motion reads as smooth even when the cut count is high.

RULES:
- Min 2.0s per segment HARD FLOOR. Anything shorter is unwatchable. Real-person poses need 2.5s+. Aim for 2.5-3.5s on most cuts so each moment LANDS.
- For B-roll of SCREENS / photos / monitors / displays (camera pointed at a screen, not at the actual scene): use SHORTER segments (2.0-3.0s) and MULTIPLE of them — viewers read screen content fast; long dwell drags. Treat a panning shot across screens as a montage of 2-3s cuts, not one long segment.
- For REAL-PERSON poses or actions (the camera is on the actual person/subject in the scene): use LONGER segments (2.5-6.0s) and let the gesture COMPLETE. Ending mid-pose feels amateur.
- Max ${Math.max(4, Math.round(avgCutSpeed * 1.4)).toFixed(0)}s per segment (let actions complete; this creator averages ~${avgCutSpeed.toFixed(1)}s but individual moments can run longer)
- Segments should have time gaps between them where less interesting footage is skipped
- ${Math.round(videoDuration / avgCutSpeed)} segments across ${videoDuration.toFixed(0)}s
- Cover beginning, middle, AND end of the video
- Start with action, end with a payoff or conclusion

${editingRules}

Respond in valid JSON only:
{
  "lengthTier": "quick|standard|story|instructional",
  "segments": [
    { "startTime": number, "endTime": number, "label": "string (what's visually happening)", "energy": "hook|high|medium" }
  ],
  "hook": "string (describe the opening visual — what grabs attention first)",
  "rationale": "string (why you chose this tier and these cuts — reference what you SAW in the frames)"
}`

  // Build the message content with interleaved frames and text
  const content: Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }> = []

  // Add context text first
  content.push({
    type: 'text',
    text: `Video: ${videoDuration.toFixed(1)}s | Target reel: ~${targetDuration}s | Frames: ${frames.length}
${hasSpeech ? `Speech: ${transcript.words.length} words` : 'No meaningful speech — visual content only'}
${transcriptSection}
${speechSection}
${sceneSection}
${beatSection}
${preferencesSection}

Here are the keyframes from the video. Each frame is labeled with its timestamp. Look at what's happening visually to decide what to keep and cut:`
  })

  // Add frames with timestamp labels — Bedrock allows max 20 images per request
  // If we have more, sample evenly across the timeline to maintain coverage
  const maxVisionFrames = 20
  let framesToSend = frames
  if (frames.length > maxVisionFrames) {
    const step = frames.length / maxVisionFrames
    framesToSend = Array.from({ length: maxVisionFrames }, (_, i) => frames[Math.min(Math.floor(i * step), frames.length - 1)])
    console.log(`[clip-analyzer] Sampled ${framesToSend.length} of ${frames.length} frames for vision (Bedrock limit: ${maxVisionFrames})`)
  }

  for (const frame of framesToSend) {
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
    text: `\nEdit this ${videoDuration.toFixed(0)}s video. At ~${avgCutSpeed.toFixed(1)}s per cut = ~${Math.round(videoDuration / avgCutSpeed)} segments. Output should be ${Math.round(videoDuration * 0.6)}-${Math.round(videoDuration * 0.9)}s. Cut dead time, keep action. Cover beginning through ending. Output JSON only.`
  })

  // Token budget scales with expected segment count. JSON segment ≈ 50 tokens,
  // hook + rationale ≈ 250. 1024 truncates frequently on long videos — bumped to 4096.
  const MAX_TOKENS_FIRST = 4096

  type RileyResponse = {
    segments: Array<{ startTime: number; endTime: number; label: string; energy: string }>
    hook: string
    rationale: string
    lengthTier?: LengthTier
  }

  let decision: RileyResponse | null = null
  // Throttle-aware invokeAgent — Bedrock 429s here would silently drop
  // Riley back to a generic motion-only fallback, masking everything we
  // computed upstream. Retry with backoff on rate-limit errors only.
  const RILEY_THROTTLE_DELAYS = [2000, 5000, 10000]
  const invokeWithRetry = async (msgs: typeof content, temp: number): Promise<string> => {
    let lastErr: Error | null = null
    for (let attempt = 0; attempt <= RILEY_THROTTLE_DELAYS.length; attempt++) {
      try {
        return await invokeAgent({
          systemPrompt,
          messages: [{ role: 'user', content: msgs }],
          maxTokens: MAX_TOKENS_FIRST,
          temperature: temp,
          companyId,
        })
      } catch (err) {
        lastErr = err as Error
        const msg = lastErr.message || ''
        const isThrottle = msg.includes('Too many requests') || msg.includes('Throttling') || msg.includes('429')
        if (!isThrottle || attempt >= RILEY_THROTTLE_DELAYS.length) throw lastErr
        const wait = RILEY_THROTTLE_DELAYS[attempt]
        console.log(`[clip-analyzer] main vision call throttled — retry in ${wait}ms (attempt ${attempt + 1})`)
        await new Promise((r) => setTimeout(r, wait))
      }
    }
    throw lastErr ?? new Error('invokeWithRetry failed')
  }

  try {
    const raw = await invokeWithRetry(content, 0.3)

    try {
      decision = parseAgentOutput<RileyResponse>(raw)
    } catch (parseErr) {
      // Likely truncation or malformed JSON. Retry once with a sharper prompt
      // that explicitly tells Riley her last response was incomplete.
      console.warn('[clip-analyzer] First parse failed — retrying with truncation hint:', (parseErr as Error).message)
      const retryContent = [
        ...content,
        {
          type: 'text' as const,
          text: `\nYour previous response was incomplete or invalid JSON. Be more concise — keep "label" under 8 words, "rationale" under 30 words, "hook" under 15 words. Output only the JSON object. No prose. Limit to ~${Math.min(15, Math.round(videoDuration / avgCutSpeed))} segments. Output JSON only.`,
        },
      ]
      const rawRetry = await invokeWithRetry(retryContent, 0.2)
      decision = parseAgentOutput<RileyResponse>(rawRetry)
    }

    // Validate and clamp segments
    let segments: ReelSegment[] = (decision.segments || [])
      .map(s => ({
        startTime: Math.max(0, s.startTime),
        endTime: Math.min(videoDuration, s.endTime),
        label: s.label,
        energy: (s.energy === 'hook' || s.energy === 'high' || s.energy === 'medium' ? s.energy : 'high') as ReelSegment['energy'],
      }))
      .filter(s => s.endTime > s.startTime && (s.endTime - s.startTime) >= 0.5)

    // ── Pre-snap: split segments that span multiple actions ────────────────
    // If Riley returns a single 10s segment that crosses 3 different actions
    // (e.g. a screen chunk → a real-person micro-action → another screen
    // chunk), no single subject-policy applies and the per-segment cap can't
    // do its job. Split such segments at the action boundaries so each
    // resulting segment has exactly one parent action and one subject kind.
    if (beatAnalysis && beatAnalysis.actions.length > 0) {
      const splitSegs: ReelSegment[] = []
      for (const s of segments) {
        const overlapping = beatAnalysis.actions.filter(
          (a) => s.startTime < a.endTime - 0.1 && s.endTime > a.startTime + 0.1,
        )
        if (overlapping.length <= 1) {
          splitSegs.push(s)
          continue
        }
        // Sort by startTime; clip Riley's segment to each action's bounds.
        overlapping.sort((a, b) => a.startTime - b.startTime)
        for (const a of overlapping) {
          const subStart = Math.max(s.startTime, a.startTime)
          const subEnd = Math.min(s.endTime, a.endTime)
          if (subEnd - subStart >= 0.6) {
            splitSegs.push({
              ...s,
              startTime: subStart,
              endTime: subEnd,
            })
          }
        }
        console.log(`[clip-analyzer] Pre-snap: segment [${s.startTime.toFixed(1)}-${s.endTime.toFixed(1)}s] spanned ${overlapping.length} actions — split per-action`)
      }
      segments = splitSegs
    }

    // ── Snap segments to the beat grid ─────────────────────────────────────
    // Riley should already be cutting at rest points / beats per the prompt,
    // but LLMs occasionally invent timestamps. Three-pass strategy:
    //   1. Snap each cut point to the nearest rest/beat within 0.7s.
    //   2. If a cut is still inside an action span, EXTEND it outward to the
    //      next rest point in the appropriate direction — never truncate an
    //      action mid-motion.
    //   3. Enforce a minimum segment length (1.4s) so rushed clips are
    //      stretched, not just kept as-is.
    if (beatAnalysis && beatAnalysis.actions.length > 0) {
      const allBeats: Beat[] = beatAnalysis.actions.flatMap((a) => a.beats)
      const restPoints = [...beatAnalysis.restPoints].sort((a, b) => a - b)
      let snapsApplied = 0
      let extensions = 0
      let stretches = 0
      let perActionCaps = 0

      const findActionContaining = (t: number) => beatAnalysis.actions.find(
        (a) => t > a.startTime + 0.3 && t < a.endTime - 0.3,
      )

      const nearestBeatInAction = (t: number, action: typeof beatAnalysis.actions[number], dir: 'before' | 'after') => {
        const candidates = action.beats.filter((b) => dir === 'before' ? b.time <= t : b.time >= t)
        if (candidates.length === 0) return null
        return candidates.reduce((best, b) => Math.abs(b.time - t) < Math.abs(best.time - t) ? b : best)
      }

      // Per-segment max length — by default derived from creator's
      // avgCutDuration. For segments anchored on a specific action, the
      // SUBJECT KIND (real-person, screen, other) overrides this with a
      // tighter range. Screens get short cuts; real people get longer dwell.
      const DEFAULT_MAX_SEG_LEN = Math.max(3.0, Math.min(8.0, avgCutSpeed * 1.8))

      // Find the action that this segment OVERLAPS MOST. We use majority
      // overlap rather than first-match because pre-snap may not catch every
      // multi-action segment (e.g. when sub-actions are very short).
      const findActionForSegment = (segStart: number, segEnd: number) => {
        let best: (typeof beatAnalysis.actions[number]) | undefined
        let bestOverlap = 0
        for (const a of beatAnalysis.actions) {
          const ov = Math.max(0, Math.min(segEnd, a.endTime) - Math.max(segStart, a.startTime))
          if (ov > bestOverlap) {
            bestOverlap = ov
            best = a
          }
        }
        return best
      }

      let speechExtensions = 0

      segments = segments.map((s) => {
        // Pass 1: nearest-snap, generous tolerance
        const startResult = snapToBeat(s.startTime, restPoints, allBeats, 0.7)
        const endResult = snapToBeat(s.endTime, restPoints, allBeats, 0.7)
        if (startResult.moved > 0.05) snapsApplied++
        if (endResult.moved > 0.05) snapsApplied++

        let newStart = startResult.snapped
        let newEnd = endResult.snapped

        // Pass 2: if a cut still lands inside an action and didn't reach a
        // beat, push it OUTWARD — but bounded by MAX_SEG_LEN. Inside long
        // actions we extend to the nearest BEAT (not the action boundary)
        // since beats are already validated as non-truncating cut points.
        const startInside = findActionContaining(newStart)
        if (startInside && startResult.landedOn !== 'beat') {
          const beat = nearestBeatInAction(newStart, startInside, 'before')
          newStart = beat ? beat.time : startInside.startTime
          extensions++
        }
        const endInside = findActionContaining(newEnd)
        if (endInside && endResult.landedOn !== 'beat') {
          const beat = nearestBeatInAction(newEnd, endInside, 'after')
          newEnd = beat ? beat.time : endInside.endTime
          extensions++
        }

        // Pass 2b: if a cut lands inside a SPEECH SPAN, push it to the span
        // boundary. Cutting a sentence in half is the worst kind of bad edit.
        // Speech preservation overrides MAX_SEG_LEN — we'd rather have a long
        // segment than chopped narration.
        const startSpan = findSpeechSpanAt(newStart, speechSpans)
        if (startSpan) {
          newStart = startSpan.startTime
          speechExtensions++
        }
        const endSpan = findSpeechSpanAt(newEnd, speechSpans)
        if (endSpan) {
          newEnd = endSpan.endTime
          speechExtensions++
        }

        // Pass 3: enforce per-segment maximum — but skip if the segment is
        // anchored on a speech span (story preservation overrides cap).
        // Use subject-aware MAX where the segment overlaps a classified
        // action; fall back to the creator-pacing default otherwise.
        const containsSpeechSpan = speechSpans.some(
          (sp) => sp.startTime >= newStart - 0.2 && sp.endTime <= newEnd + 0.2,
        )
        const parentAction = findActionForSegment(newStart, newEnd)
        const subjectPolicy = lengthPolicyFor(parentAction?.subjectKind ?? 'unknown')
        const segMax = parentAction
          ? Math.min(DEFAULT_MAX_SEG_LEN, subjectPolicy.maxLen)
          : DEFAULT_MAX_SEG_LEN
        if (!containsSpeechSpan && newEnd - newStart > segMax) {
          const trimmedEnd = newStart + segMax
          const candidatesInRange = [
            ...restPoints.filter((r) => r > newStart && r <= trimmedEnd + 0.3),
            ...allBeats.filter((b) => b.time > newStart && b.time <= trimmedEnd + 0.3).map((b) => b.time),
          ].sort((a, b) => Math.abs(b - trimmedEnd) - Math.abs(a - trimmedEnd))
          newEnd = candidatesInRange.length > 0 ? candidatesInRange[candidatesInRange.length - 1] : trimmedEnd
          perActionCaps++
        }

        // Pass 3b: real-person post-action breath. If the segment ends at the
        // action's end (mathematical end), pad ~0.4s so the gesture lands
        // visibly before the cut. Bounded by max length and video duration.
        if (parentAction && subjectPolicy.postBreath > 0 && Math.abs(newEnd - parentAction.endTime) < 0.5) {
          const padded = Math.min(videoDuration, newEnd + subjectPolicy.postBreath)
          if (padded - newStart <= segMax + subjectPolicy.postBreath) {
            newEnd = padded
          }
        }

        // Pass 4: minimum length — segments below this read as rushed.
        // Hard floor 2.0s globally; real-person actions floor at 2.5s.
        const segMin = Math.max(2.0, subjectPolicy.minLen)
        if (newEnd - newStart < segMin) {
          newEnd = Math.min(videoDuration, newStart + segMin)
          stretches++
        }

        return {
          ...s,
          startTime: Math.max(0, newStart),
          endTime: Math.min(videoDuration, newEnd),
        }
      }).filter((s) => s.endTime > s.startTime + 0.3)

      // Merge segments only if they TRULY OVERLAP (not just adjacent) AND
      // share the same parent action. Adjacent segments that landed on the
      // same boundary deliberately (from pre-snap splitting a multi-action
      // segment) should remain SEPARATE — that's the whole point of the
      // split. We use a strict overlap test.
      segments.sort((a, b) => a.startTime - b.startTime)
      const merged: ReelSegment[] = []
      for (const s of segments) {
        const prev = merged[merged.length - 1]
        const trueOverlap = prev && s.startTime < prev.endTime - 0.05
        const sameAction = prev
          ? findActionForSegment(prev.startTime, prev.endTime) === findActionForSegment(s.startTime, s.endTime)
          : false
        if (trueOverlap && sameAction) {
          prev.endTime = Math.max(prev.endTime, s.endTime)
          if (s.energy === 'hook') prev.energy = 'hook'
          else if (s.energy === 'high' && prev.energy !== 'hook') prev.energy = 'high'
        } else {
          merged.push({ ...s })
        }
      }
      segments = merged

      if (snapsApplied > 0) console.log(`[clip-analyzer] Snapped ${snapsApplied} cut points to beats/rest points`)
      if (extensions > 0) console.log(`[clip-analyzer] Extended ${extensions} cut(s) outward to nearest beat (was mid-action)`)
      if (speechExtensions > 0) console.log(`[clip-analyzer] Extended ${speechExtensions} cut(s) outward to preserve speech spans (was mid-sentence)`)
      if (stretches > 0) console.log(`[clip-analyzer] Stretched ${stretches} segment(s) to meet minimum 1.4s length`)
      if (perActionCaps > 0) console.log(`[clip-analyzer] Capped ${perActionCaps} segment(s) at MAX_SEG_LEN to prevent over-extension`)
    }

    // ── Hard exclusion of segments inside heavy bad-quality windows ────────
    // Even if Riley picks a moment inside a shaky/blurry/frozen window, we
    // refuse to render it. Better to lose the moment than ship unwatchable
    // footage.
    if (badWindows && badWindows.length > 0) {
      const heavy = badWindows.filter((w) => w.severity >= 0.6)
      if (heavy.length > 0) {
        const before = segments.length
        segments = segments.filter((s) => {
          const inside = heavy.some((w) => s.startTime >= w.startTime - 0.3 && s.endTime <= w.endTime + 0.3)
          return !inside
        })
        // Also trim segments that partially overlap (back the segment off the
        // bad window if the overlap is small; drop entirely if the overlap is
        // most of the segment).
        segments = segments.flatMap((s) => {
          const overlap = heavy.find((w) => s.endTime > w.startTime && s.startTime < w.endTime)
          if (!overlap) return [s]
          const segLen = s.endTime - s.startTime
          // If the segment ends inside a bad window — pull endTime back
          if (s.startTime < overlap.startTime && s.endTime > overlap.startTime && s.endTime <= overlap.endTime) {
            const trimmed = { ...s, endTime: overlap.startTime }
            return trimmed.endTime - trimmed.startTime >= 1.4 ? [trimmed] : []
          }
          // If the segment starts inside a bad window — push startTime forward
          if (s.endTime > overlap.endTime && s.startTime >= overlap.startTime && s.startTime < overlap.endTime) {
            const trimmed = { ...s, startTime: overlap.endTime }
            return trimmed.endTime - trimmed.startTime >= 1.4 ? [trimmed] : []
          }
          // Bad window straddles middle of segment — drop entirely
          return []
        })
        const dropped = before - segments.length
        if (dropped !== 0 || segments.length !== before) {
          console.log(`[clip-analyzer] Quality filter dropped/trimmed ${Math.max(0, dropped)} segment(s) overlapping heavy bad-quality windows`)
        }
      }
    }

    // ── Peak-centered windows for long real-person spans ──────────────────
    // For real-person actions ≥ 6s with multiple peaks (e.g. someone cycling
    // through poses), the natural reel rhythm is peak → cut → peak, not
    // continuous coverage. We rewrite any segment that covers ≥ 70% of a
    // long real-person action into a SET of peak-centered 2.5-3.0s windows
    // — one per beat — and discard the inter-peak deadzones.
    //
    // This is exactly the "illusion of reel content" the user described:
    // we show only the moment the pose lands, then jump-cut to the next.
    if (beatAnalysis && beatAnalysis.actions.length > 0) {
      const peakCenteredSegments: ReelSegment[] = []
      const replacedIndices = new Set<number>()
      const PEAK_WINDOW = 2.7   // seconds total per peak window
      const PEAK_HALF = PEAK_WINDOW / 2

      segments.forEach((s, idx) => {
        // Find the parent action (if any) that this segment covers most of
        const parent = beatAnalysis.actions.find(
          (a) =>
            a.subjectKind === 'real-person' &&
            a.duration >= 6 &&
            s.startTime <= a.startTime + 0.5 &&
            s.endTime >= a.endTime - 0.5,
        )
        if (!parent) return

        // Peaks within this action: all motion-peak beats + boundary beats.
        // We keep boundaries because the start of an action is its first
        // pose-land moment; the end is the last.
        const peakTimes: number[] = []
        for (const b of parent.beats) {
          if (b.kind === 'motion-peak' || b.kind === 'audio-peak' || b.kind === 'start' || b.kind === 'end') {
            peakTimes.push(b.time)
          }
        }
        // Need at least 2 peaks for the peak-centered approach to make sense
        if (peakTimes.length < 2) return

        // Build peak-centered windows; merge overlapping windows so we don't
        // produce micro-segments back-to-back without a true cut.
        const sorted = [...new Set(peakTimes.map((t) => Math.round(t * 10) / 10))].sort((a, b) => a - b)
        const windows: Array<{ start: number; end: number; peak: number }> = []
        for (const p of sorted) {
          const w = {
            start: Math.max(parent.startTime, p - PEAK_HALF + 0.5),  // bias slightly forward — show the build-up
            end: Math.min(parent.endTime, p + PEAK_HALF - 0.5),       // and a small post-land breath
            peak: p,
          }
          // Adjust to ensure ≥ 2.0s per window
          if (w.end - w.start < 2.0) {
            const pad = (2.0 - (w.end - w.start)) / 2
            w.start = Math.max(parent.startTime, w.start - pad)
            w.end = Math.min(parent.endTime, w.end + pad)
          }
          // Merge with previous window if overlapping
          const prev = windows[windows.length - 1]
          if (prev && w.start <= prev.end + 0.4) {
            prev.end = Math.max(prev.end, w.end)
          } else {
            windows.push(w)
          }
        }

        if (windows.length >= 2) {
          replacedIndices.add(idx)
          for (const w of windows) {
            peakCenteredSegments.push({
              startTime: w.start,
              endTime: w.end,
              label: `Peak-centered: ${parent.subjectKind} action @ ${w.peak.toFixed(1)}s`,
              energy: s.energy,
            })
          }
          console.log(`[clip-analyzer] Peak-centered: replaced segment [${s.startTime.toFixed(1)}-${s.endTime.toFixed(1)}s] (long real-person, ${parent.beats.length} beats) with ${windows.length} peak windows`)
        }
      })

      if (replacedIndices.size > 0) {
        segments = segments.filter((_, i) => !replacedIndices.has(i))
        segments = [...segments, ...peakCenteredSegments].sort((a, b) => a.startTime - b.startTime)
      }
    }

    // ── Auto-fill missed actions from beats ────────────────────────────────
    // Riley sometimes skips an action entirely. The user's mental model is
    // "preserve every moment I uploaded" — so we backfill: for any action
    // with no overlapping segment, construct a segment from its REQUIRED
    // boundary beats (and pre-existing sub-peak beats) so it contributes.
    //
    // EXCEPTION: do NOT auto-fill screen sub-chunks. Screens are B-roll —
    // viewers register "screen showing X" once, and the screen-split pass
    // already creates many sub-chunks of long screen pans. Auto-filling all
    // of them produces a screen-heavy reel.
    if (beatAnalysis && beatAnalysis.actions.length > 0) {
      const newSegments: ReelSegment[] = []
      for (const a of beatAnalysis.actions) {
        const hasSegment = segments.some(
          (s) => s.startTime <= a.endTime && s.endTime >= a.startTime,
        )
        if (hasSegment) continue
        if (a.subjectKind === 'screen') {
          // Skip auto-fill for screen actions — they're optional content.
          // The screen-cap pass below will keep at most 2 from Riley's picks.
          continue
        }

        // Action was missed — build segments from required beats. For long
        // actions, this means start + sub-peaks + end. For short/medium,
        // typically just one segment covering the whole action.
        const requiredBeats = a.beats.filter((b) => b.required)
        const subPeakBeats = a.beats
          .filter((b) => !b.required && (b.kind === 'motion-peak' || b.kind === 'audio-peak'))
          .sort((x, y) => y.strength - x.strength)
          .slice(0, a.durationClass === 'long' ? 2 : 1)
        const beatsToUse = [...requiredBeats, ...subPeakBeats].sort((x, y) => x.time - y.time)

        const policy = lengthPolicyFor(a.subjectKind ?? 'unknown')
        const minAutoLen = Math.max(2.0, policy.minLen)

        if (a.durationClass === 'short' || beatsToUse.length === 0) {
          // Short action: keep as a single segment covering the whole thing.
          // Pad to minAutoLen if the action itself is shorter (rare; spans
          // are guaranteed >= 1.5s by detector but we ensure 2s on output).
          const segStart = a.startTime
          const segEnd = Math.min(videoDuration, Math.max(a.endTime, segStart + minAutoLen))
          newSegments.push({
            startTime: segStart,
            endTime: segEnd,
            label: `Auto-filled: ${a.durationClass} action (motion ${a.peakMotion.toFixed(2)})`,
            energy: a.peakMotion > 0.7 ? 'high' : 'medium',
          })
          console.log(`[clip-analyzer] Auto-filled missed action [${a.startTime.toFixed(1)}-${a.endTime.toFixed(1)}s] (${a.durationClass}, subject=${a.subjectKind ?? 'unknown'}) as 1 segment`)
        } else {
          // Long/medium with beats: one segment per beat, centered on beat time
          for (const b of beatsToUse) {
            const targetWidth = Math.max(b.suggestedWidth, minAutoLen)
            const halfWidth = targetWidth / 2
            const segStart = Math.max(a.startTime, b.time - halfWidth)
            const segEnd = Math.min(a.endTime, b.time + halfWidth)
            if (segEnd - segStart >= minAutoLen) {
              newSegments.push({
                startTime: segStart,
                endTime: segEnd,
                label: `Auto-filled: ${b.kind} at ${b.time.toFixed(1)}s`,
                energy: b.required ? 'high' : 'medium',
              })
            }
          }
          console.log(`[clip-analyzer] Auto-filled missed action [${a.startTime.toFixed(1)}-${a.endTime.toFixed(1)}s] (${a.durationClass}, subject=${a.subjectKind ?? 'unknown'}) with ${beatsToUse.length} beats`)
        }
      }
      if (newSegments.length > 0) {
        segments = [...segments, ...newSegments].sort((a, b) => a.startTime - b.startTime)
        console.log(`[clip-analyzer] Auto-fill added ${newSegments.length} segment(s); total now ${segments.length} segments`)
      }
    }

    // ── Cap total screen segments in the reel (post auto-fill) ─────────────
    // Viewers register "screen showing X" in 1-2s; long pans across screens
    // shouldn't produce 5 cuts. We allow at most MAX_SCREEN_SEGMENTS total
    // across the whole reel, picked by motion peak (most interesting frames).
    if (beatAnalysis && beatAnalysis.actions.length > 0) {
      const MAX_SCREEN_SEGMENTS = 2
      const segScreenAction = (s: ReelSegment) =>
        beatAnalysis.actions.find(
          (a) => a.subjectKind === 'screen' && s.startTime >= a.startTime - 0.3 && s.endTime <= a.endTime + 0.3,
        )
      const screenSegs = segments
        .map((s, i) => ({ s, i, action: segScreenAction(s) }))
        .filter((x) => !!x.action)

      if (screenSegs.length > MAX_SCREEN_SEGMENTS) {
        screenSegs.sort((a, b) => (b.action!.peakMotion ?? 0) - (a.action!.peakMotion ?? 0))
        const keep = new Set(screenSegs.slice(0, MAX_SCREEN_SEGMENTS).map((x) => x.i))
        const droppedIdx = new Set(screenSegs.filter((x) => !keep.has(x.i)).map((x) => x.i))
        const before = segments.length
        segments = segments.filter((_, i) => !droppedIdx.has(i))
        console.log(`[clip-analyzer] Screen-cap: kept ${MAX_SCREEN_SEGMENTS} of ${screenSegs.length} screen segments (dropped ${before - segments.length})`)
      }
    }

    // ── Sacrosanct hook: always include the first action ──────────────────
    // Runs AFTER screen-cap so the hook can't be dropped as a "screen
    // segment" — even if the classifier mis-flagged the first action as
    // screen, the hook is too important to skip. The hook is the first
    // moment of the reel; a creator's intro / opening pose / direct address
    // is usually here. Better to include something the classifier was unsure
    // about than to start the reel mid-content.
    if (beatAnalysis && beatAnalysis.actions.length > 0) {
      const firstAction = beatAnalysis.actions[0]
      // Require MEANINGFUL overlap (≥1.0s) — boundary-touching segments don't
      // count, otherwise a segment that starts at firstAction.endTime would
      // be considered hook coverage when it actually falls in action #2.
      const MIN_HOOK_OVERLAP = 1.0
      const hasHookFromFirst = segments.some((s) => {
        const overlap = Math.max(0, Math.min(s.endTime, firstAction.endTime) - Math.max(s.startTime, firstAction.startTime))
        return overlap >= MIN_HOOK_OVERLAP
      })
      if (!hasHookFromFirst) {
        // Pull the hook from EARLY in the action span so we capture the
        // opening moment (often the strongest hook content), not the tail.
        const HOOK_TARGET = Math.min(firstAction.duration, 3.0)
        const hookSeg: ReelSegment = {
          startTime: firstAction.startTime,
          endTime: Math.min(videoDuration, firstAction.startTime + Math.max(2.0, HOOK_TARGET)),
          label: `Sacrosanct hook: ${firstAction.subjectKind ?? 'unknown'} at start`,
          energy: 'hook',
        }
        segments = [hookSeg, ...segments].sort((a, b) => a.startTime - b.startTime)
        const hookDur = (hookSeg.endTime - hookSeg.startTime).toFixed(1)
        console.log(`[clip-analyzer] Sacrosanct hook: prepended ${hookDur}s segment from first action [${firstAction.startTime.toFixed(1)}-${firstAction.endTime.toFixed(1)}s] (subject=${firstAction.subjectKind ?? 'unknown'})`)
      }
    }

    // ── Resolve length tier ────────────────────────────────────────────────
    // Riley picks a tier in her JSON. If she didn't, fall back from retention
    // data, else default to "standard."
    let pickedTier: LengthTier = (decision.lengthTier && (decision.lengthTier in LENGTH_TIERS))
      ? decision.lengthTier
      : (() => {
          const optimal = (creatorProfile?.retention as any)?.performanceCorrelations?.videoLength?.optimal as number | undefined
          if (optimal != null) {
            if (optimal <= 17) return 'quick'
            if (optimal <= 38) return 'standard'
            if (optimal <= 62) return 'story'
            return 'instructional'
          }
          // Default: pick by source duration shape — short source = quick/standard, long source = story/instructional
          if (videoDuration <= 30) return 'quick'
          if (videoDuration <= 90) return 'standard'
          if (videoDuration <= 180) return 'story'
          return 'instructional'
        })()
    const tierSpec = LENGTH_TIERS[pickedTier]
    console.log(`[clip-analyzer] Length tier: "${pickedTier}" — target ${tierSpec.minSeconds}-${tierSpec.maxSeconds}s (Riley ${decision.lengthTier ? 'picked' : 'fallback'})`)

    // ── Enforce tier ceiling ───────────────────────────────────────────────
    let currentTotal = segments.reduce((sum, s) => sum + (s.endTime - s.startTime), 0)
    const targetCeiling = tierSpec.maxSeconds
    const targetFloor = tierSpec.minSeconds

    if (currentTotal > targetCeiling && segments.length > 0) {
      console.log(`[clip-analyzer] Total ${currentTotal.toFixed(1)}s exceeds tier ceiling ${targetCeiling}s — uniformly shortening segments to preserve all actions`)

      // Identify protected segments — speech-containing segments and the hook
      // are NEVER shortened. Their length is fixed.
      const protectedFlags = segments.map((s) => {
        const containsSpeech = speechSpans.some(
          (sp) => sp.startTime >= s.startTime - 0.2 && sp.endTime <= s.endTime + 0.2,
        )
        return s.energy === 'hook' || containsSpeech
      })
      const protectedTotal = segments.reduce((sum, s, i) => sum + (protectedFlags[i] ? (s.endTime - s.startTime) : 0), 0)
      const compressibleTotal = currentTotal - protectedTotal
      const compressibleBudget = Math.max(0, targetCeiling - protectedTotal)

      // Floor each compressible segment at MIN_KEEP_LEN — below this length
      // viewers can't read the action and it feels rushed. Hard 2.0s floor
      // applies even during tier-ceiling shortening.
      const MIN_KEEP_LEN = 2.0
      const compressibleSegs = segments
        .map((s, i) => ({ s, i, len: s.endTime - s.startTime }))
        .filter((x) => !protectedFlags[x.i])

      if (compressibleSegs.length > 0 && compressibleTotal > compressibleBudget) {
        // Scale factor — proportionally shrink each compressible segment
        const idealScale = compressibleBudget / compressibleTotal
        let shortened = 0
        let stillOver = 0

        for (const x of compressibleSegs) {
          const ideal = x.len * idealScale
          const newLen = Math.max(MIN_KEEP_LEN, ideal)
          if (newLen >= x.len) continue // already small enough
          // Trim from BOTH sides equally — preserves the centroid (the actual
          // beat) and avoids favoring start-trim or end-trim
          const trimAmount = (x.len - newLen) / 2
          const newStart = segments[x.i].startTime + trimAmount
          const newEnd = segments[x.i].endTime - trimAmount
          segments[x.i] = { ...segments[x.i], startTime: newStart, endTime: newEnd }
          shortened++
          if (newLen > ideal + 0.05) stillOver++
        }
        currentTotal = segments.reduce((sum, s) => sum + (s.endTime - s.startTime), 0)
        console.log(`[clip-analyzer] Shortened ${shortened} segment(s) (idealScale=${idealScale.toFixed(2)}); total now ${currentTotal.toFixed(1)}s`)

        // If we floored at MIN_KEEP_LEN and still over, drop from lowest priority
        if (currentTotal > targetCeiling) {
          console.log(`[clip-analyzer] Still over ceiling after shortening (floor at ${MIN_KEEP_LEN}s) — dropping lowest-priority segments`)
          const energyRank: Record<string, number> = { hook: 3, high: 2, medium: 1 }
          const droppable = segments
            .map((s, i) => ({ s, i, score: energyRank[s.energy] ?? 0, len: s.endTime - s.startTime }))
            .filter((x) => !protectedFlags[x.i])
            .sort((a, b) => a.score - b.score || a.len - b.len)
          const keepIdx = new Set(segments.map((_, i) => i))
          let dropped = 0
          for (const cand of droppable) {
            if (currentTotal <= targetCeiling) break
            keepIdx.delete(cand.i)
            currentTotal -= cand.len
            dropped++
          }
          segments = segments.filter((_, i) => keepIdx.has(i))
          if (dropped > 0) console.log(`[clip-analyzer] Dropped ${dropped} segment(s) as last resort`)
        }
      }
      segments.sort((a, b) => a.startTime - b.startTime)
    }

    // Floor check — too short means we lost too much. Log only; don't extend
    // (extending would force keeping low-priority segments).
    if (currentTotal < targetFloor) {
      console.log(`[clip-analyzer] Total ${currentTotal.toFixed(1)}s is below tier floor ${targetFloor}s — reel is short for tier "${pickedTier}"`)
    }

    // ── Action coverage audit ──────────────────────────────────────────────
    // Every detected action should contribute at least one segment. Log any
    // action that didn't make it so we can diagnose. (We don't auto-retry
    // here — Riley's prompt already enforces this rule and a second pass
    // would double the latency. Persistent misses become a tuning signal.)
    if (beatAnalysis && beatAnalysis.actions.length > 0) {
      const missed: typeof beatAnalysis.actions = []
      for (const a of beatAnalysis.actions) {
        const hasSegment = segments.some(
          (s) => s.startTime <= a.endTime && s.endTime >= a.startTime,
        )
        if (!hasSegment) missed.push(a)
      }
      const coveragePct = ((beatAnalysis.actions.length - missed.length) / beatAnalysis.actions.length) * 100
      console.log(`[clip-analyzer] Action coverage: ${beatAnalysis.actions.length - missed.length}/${beatAnalysis.actions.length} (${coveragePct.toFixed(0)}%)`)
      if (missed.length > 0) {
        console.warn('[clip-analyzer] Missed actions (no segment overlaps):')
        for (const m of missed) {
          console.warn(`  - [${m.startTime.toFixed(1)}-${m.endTime.toFixed(1)}s] ${m.durationClass} (${m.duration.toFixed(1)}s)`)
        }
      }
    }

    // ── Transition cushion ─────────────────────────────────────────────────
    // When two adjacent segments jump across a major source boundary
    // (e.g. wardrobe change, scene change, big source-time skip), 2.0-2.5s
    // each isn't enough — the viewer needs ~3.0s to read the new context
    // before the next cut. Identify these "jump cut" pairs and extend each
    // side toward 3.0s, bounded by parent action edges and neighboring
    // segments. Same-scene adjacent shots (small source gap) keep the 2.0s
    // floor — those don't need cushion.
    if (beatAnalysis && beatAnalysis.actions.length > 0) {
      const SCENE_JUMP_GAP = 8.0  // source seconds between segments → likely different scene
      const TRANSITION_MIN_LEN = 3.0
      const sceneCuts = sceneData?.cutTimestamps ?? []

      const isJumpBetween = (a: ReelSegment, b: ReelSegment): boolean => {
        const sourceGap = b.startTime - a.endTime
        if (sourceGap >= SCENE_JUMP_GAP) return true
        // A scene cut (clip boundary) lying between them = scene change
        if (sceneCuts.some((t) => t > a.endTime && t < b.startTime)) return true
        // Different parent actions whose subjects differ (e.g. screen → real-person)
        const aAction = beatAnalysis.actions.find(
          (act) => Math.max(act.startTime, a.startTime) < Math.min(act.endTime, a.endTime),
        )
        const bAction = beatAnalysis.actions.find(
          (act) => Math.max(act.startTime, b.startTime) < Math.min(act.endTime, b.endTime),
        )
        if (aAction && bAction && aAction !== bAction && aAction.subjectKind && bAction.subjectKind && aAction.subjectKind !== bAction.subjectKind) {
          return true
        }
        return false
      }

      let cushioned = 0
      segments.sort((a, b) => a.startTime - b.startTime)
      for (let i = 0; i < segments.length; i++) {
        const cur = segments[i]
        const prev = segments[i - 1]
        const next = segments[i + 1]
        const jumpsToPrev = prev ? isJumpBetween(prev, cur) : i === 0  // first segment treated as following a jump
        const jumpsToNext = next ? isJumpBetween(cur, next) : false
        if (!jumpsToPrev && !jumpsToNext) continue
        const curLen = cur.endTime - cur.startTime
        if (curLen >= TRANSITION_MIN_LEN) continue
        const need = TRANSITION_MIN_LEN - curLen
        // Extend forward (later end), but don't pass the parent action's end
        // and don't run into the next segment's start. Then if still short,
        // extend backward (earlier start), bounded by parent action start
        // and prev segment's end.
        const parentAction = beatAnalysis.actions.find(
          (a) => cur.startTime >= a.startTime - 0.1 && cur.endTime <= a.endTime + 0.1,
        )
        const maxEnd = Math.min(
          videoDuration,
          parentAction ? parentAction.endTime : videoDuration,
          next ? next.startTime - 0.05 : videoDuration,
        )
        const minStart = Math.max(
          0,
          parentAction ? parentAction.startTime : 0,
          prev ? prev.endTime + 0.05 : 0,
        )
        let newStart = cur.startTime
        let newEnd = cur.endTime
        const forwardRoom = Math.max(0, maxEnd - newEnd)
        const forwardTake = Math.min(need, forwardRoom)
        newEnd += forwardTake
        const stillNeed = need - forwardTake
        if (stillNeed > 0) {
          const backwardRoom = Math.max(0, newStart - minStart)
          const backwardTake = Math.min(stillNeed, backwardRoom)
          newStart -= backwardTake
        }
        if (newStart !== cur.startTime || newEnd !== cur.endTime) {
          segments[i] = { ...cur, startTime: newStart, endTime: newEnd }
          cushioned++
        }
      }
      if (cushioned > 0) {
        console.log(`[clip-analyzer] Transition cushion: extended ${cushioned} segment(s) to ${TRANSITION_MIN_LEN.toFixed(1)}s for scene-jump readability`)
      }
    }

    // ── Hard no-overlap + min-length pass (FINAL DEFENSIVE GUARD) ─────────
    // After every snap/auto-fill/cap pass, walk the segments in time order:
    //   1. Trim any segment whose start is before the prior segment's end
    //      (overlap fix — overlaps cause FFmpeg rewind/replay glitches).
    //   2. Drop any segment shorter than the 2.0s floor (the iter-12
    //      invariant). Anything under 2s reads as rushed; we'd rather lose
    //      the moment than ship a flash cut.
    {
      segments.sort((a, b) => a.startTime - b.startTime)
      const out: ReelSegment[] = []
      let trimmed = 0
      let droppedOverlap = 0
      let droppedShort = 0
      const HARD_MIN_LEN = 2.0
      for (const s of segments) {
        const prev = out[out.length - 1]
        let newStart = s.startTime
        let newEnd = s.endTime
        if (prev && newStart < prev.endTime - 0.001) {
          // Overlap — push start to prev.endTime
          newStart = prev.endTime
          trimmed++
        }
        const len = newEnd - newStart
        if (len < HARD_MIN_LEN) {
          if (newStart === s.startTime) droppedShort++ // not from overlap trim
          else droppedOverlap++  // from overlap trim then too short
          continue
        }
        out.push({ ...s, startTime: newStart, endTime: newEnd })
      }
      if (trimmed > 0 || droppedOverlap > 0 || droppedShort > 0) {
        console.log(`[clip-analyzer] No-overlap guard: trimmed ${trimmed}, dropped ${droppedOverlap} (overlap-trim too short), ${droppedShort} (already <${HARD_MIN_LEN}s)`)
      }
      segments = out
    }

    if (segments.length === 0) {
      return fallbackClip(videoDuration, targetDuration, sceneData, creatorProfile)
    }

    const totalDuration = segments.reduce((sum, s) => sum + (s.endTime - s.startTime), 0)

    // Build combined transcript from selected segments
    const clipTranscript = segments.map(seg => {
      return transcript.words
        .filter(w => w.startTime >= seg.startTime && w.endTime <= seg.endTime)
        .map(w => w.text)
        .join(' ')
    }).filter(Boolean).join(' ')

    // Check if Riley actually jump-cut or just trimmed from the start
    let hasGaps = false
    for (let i = 1; i < segments.length; i++) {
      const gap = segments[i].startTime - segments[i - 1].endTime
      if (gap > 0.5) { hasGaps = true; break }
    }
    const lastSegEnd = segments.length > 0 ? segments[segments.length - 1].endTime : 0
    const coversEnd = lastSegEnd > videoDuration * 0.6

    console.log(`[clip-analyzer] Riley (vision) picked ${segments.length} segments, ${totalDuration.toFixed(1)}s total`)
    console.log(`  Jump cuts: ${hasGaps ? 'YES' : 'NO (contiguous — may need re-cut)'}`)
    console.log(`  Covers end: ${coversEnd ? 'YES' : 'NO (last segment ends at ' + fmt(lastSegEnd) + ' of ' + fmt(videoDuration) + ')'}`)
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
      lengthTier: pickedTier,
    }
  } catch (err) {
    console.error('[clip-analyzer] Vision analysis failed, using fallback:', err)
    return fallbackClip(videoDuration, targetDuration, sceneData, creatorProfile)
  }
}

/**
 * Fallback when Bedrock fails — use motion data or even splits.
 * Honors creator's RetentionProfile target length and avgCutSpeed when available
 * so we don't drop back to a generic edit even when Riley fails.
 */
function fallbackClip(
  videoDuration: number,
  targetDuration: number,
  sceneData?: SceneAnalysis,
  creatorProfile?: { style?: Record<string, unknown> | null; retention?: Record<string, unknown> | null } | null,
): ClipDecision {
  // Honor creator's optimal length if retention says so
  const optimal = (creatorProfile?.retention as any)?.performanceCorrelations?.videoLength?.optimal as number | undefined
  const effectiveTarget = optimal && optimal > 5 ? Math.min(optimal, targetDuration * 1.1) : targetDuration
  const cutBudget = ((creatorProfile?.style as any)?.avgCutDuration as number | undefined) || 4

  // If we have scene data, pick highest motion segments
  if (sceneData && sceneData.scenes.length > 1) {
    const sorted = [...sceneData.scenes].sort((a, b) => b.motionScore - a.motionScore)
    const segments: ReelSegment[] = []
    let total = 0
    const segCap = Math.max(2, Math.min(8, cutBudget * 1.5))
    for (const scene of sorted) {
      if (total >= effectiveTarget) break
      const dur = Math.min(scene.duration, segCap)
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

  // Last resort: even splits — honoring creator's cut budget if known
  const usable = Math.min(videoDuration, effectiveTarget)
  const segDur = Math.max(2, Math.min(8, cutBudget * 2))
  const segCount = Math.max(1, Math.floor(usable / segDur))
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
