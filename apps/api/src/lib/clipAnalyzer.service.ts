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

  // Dynamic target from creator's typical video length (not audience-optimal)
  const targetLen = Math.min(targetDuration, Math.floor(videoDuration * 0.65))

  // Dynamic segments from creator's actual cut speed
  // Cap at 5s max — values above that are from thumbnail-only analysis (inaccurate)
  const rawCutSpeed = (style as any)?.avgCutDuration || 3
  const avgCutSpeed = Math.min(5, Math.max(1, rawCutSpeed))
  const maxSegments = Math.max(3, Math.ceil(targetLen / avgCutSpeed))
  const segDuration = `${Math.max(1, avgCutSpeed - 1).toFixed(0)}-${(avgCutSpeed + 1).toFixed(0)}`

  // Build creator style instructions — how THIS creator edits
  let creatorInstructions = ''
  if (style) {
    const parts: string[] = []

    // Cut & pacing
    if ((style as any).avgCutDuration) parts.push(`Cut rhythm: ${(style as any).avgCutDuration}s per cut — match this creator's pacing exactly`)
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

Your job: edit this video the way THIS creator would edit it. Match their cut speed, pacing, hook style, and visual choices. You are saving them time, not changing their style.
${creatorInstructions}
HARD CONSTRAINTS (DO NOT VIOLATE):
- MAXIMUM OUTPUT: ${targetLen} seconds total. Add up all your segment durations — they MUST total ${targetLen}s or less
- MAXIMUM SEGMENTS: ${maxSegments} segments
- EACH SEGMENT: ${segDuration} seconds. Match this creator's editing rhythm
- YOU MUST CUT CONTENT. Not everything makes the reel. Be ruthless — only the peak moments survive

${editingRules}

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
${preferencesSection}

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
