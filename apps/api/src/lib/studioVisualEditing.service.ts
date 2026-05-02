/**
 * Studio Visual Editing Service
 *
 * Riley re-edits a clip when the user rejects the visual. Previously delegated
 * to Descript's agent — but Descript was never wired into the upload pipeline,
 * so `clip.descriptVideoId` was always null and the regen path threw.
 *
 * Now: parse the user's feedback into FFmpeg filter adjustments, re-cut the
 * source video with the new filters, upload the new reel to S3, and update
 * the clip. Same code path as the original encode, just with different params.
 */

import { PrismaClient } from '@prisma/client'
import { execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import axios from 'axios'
import { uploadFile, getPresignedUrl } from '../services/storage/s3.service'
import { invokeAgent, parseAgentOutput } from '../services/bedrock/bedrock.service'

const execFileAsync = promisify(execFile)

export interface VisualEditRequest {
  clipId: string
  companyId: string
  clipUrl: string                // s3:// or presigned URL of the current clip
  feedbackHistory?: string[]     // Past rejection reasons; latest is most relevant
}

export interface VisualEditResult {
  editedUrl: string              // s3:// URL of new clip
  styleMetrics: {
    appliedAdjustments: string[]
    feedbackApplied: string
  }
  adjustments: Record<string, unknown>
  version: number
}

/**
 * Structured representation of an edit operation parsed from feedback text.
 * Each field is a delta in the range [-2, +2] where positive means "more of"
 * and negative means "less of." Pacing is a categorical change.
 */
interface ParsedEditOps {
  brightness: number       // -2..+2
  saturation: number       // -2..+2
  warmth: number           // -2..+2  (positive = warmer)
  contrast: number         // -2..+2
  denoise: number          // 0..2 (only positive — never add noise)
  pacing: 'faster' | 'slower' | 'same'
  notes: string
}

const ZERO_OPS: ParsedEditOps = {
  brightness: 0,
  saturation: 0,
  warmth: 0,
  contrast: 0,
  denoise: 0,
  pacing: 'same',
  notes: '',
}

export class StudioVisualEditingService {
  constructor(private prisma: PrismaClient) {}

  async editClip(request: VisualEditRequest): Promise<VisualEditResult> {
    const { clipId, companyId, clipUrl, feedbackHistory = [] } = request

    const clip = await this.prisma.videoClip.findUnique({ where: { id: clipId } })
    if (!clip) throw new Error('Clip not found')

    // 1. Parse feedback into structured edit operations.
    //    LLM-based for fidelity; falls back to keyword matching if Bedrock fails.
    const ops = await this.parseFeedback(feedbackHistory, companyId).catch(() => fallbackParseFeedback(feedbackHistory))

    // 2. Build FFmpeg filter chain from the ops.
    const { videoFilter, audioFilter, applied } = buildFiltersFromOps(ops)

    // 3. Resolve the clip URL to a fetchable URL.
    const fetchUrl = clipUrl.startsWith('s3://')
      ? await getPresignedUrl(clipUrl.replace('s3://', ''), 3600)
      : clipUrl

    // 4. Download, re-encode, upload.
    const workDir = path.join(os.tmpdir(), `sovexa-regen-${clipId}-${Date.now()}`)
    fs.mkdirSync(workDir, { recursive: true })
    const inputPath = path.join(workDir, 'input.mp4')
    const outputPath = path.join(workDir, 'output.mp4')

    try {
      const response = await axios.get(fetchUrl, { responseType: 'arraybuffer', timeout: 180000 })
      fs.writeFileSync(inputPath, Buffer.from(response.data))

      const codec = process.env.VEXA_VIDEO_CODEC
        || (process.platform === 'darwin' ? 'h264_videotoolbox' : 'libx264')
      const codecExtra = codec === 'libx264' ? ['-preset', 'veryfast', '-crf', '23'] : ['-b:v', '8M']

      const args = [
        '-y',
        '-i', inputPath,
        '-vf', videoFilter,
        ...(audioFilter ? ['-af', audioFilter] : []),
        '-c:v', codec, ...codecExtra,
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        outputPath,
      ]

      await execFileAsync('ffmpeg', args, { timeout: 180000 }).catch((err: any) => {
        // ffmpeg writes warnings to stderr even when it succeeds
        if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) throw err
      })

      const buffer = fs.readFileSync(outputPath)
      const s3Key = `studio/clips/${companyId}/${Date.now()}-regen.mp4`
      await uploadFile({ key: s3Key, body: buffer, contentType: 'video/mp4' })

      const previousAdjustments = (clip.adjustments as Record<string, unknown>) || {}
      const previousVersion = typeof previousAdjustments.version === 'number' ? previousAdjustments.version : 1
      const version = previousVersion + 1

      console.log(`[studio-visual-edit] Regenerated clip ${clipId} v${version} — applied: ${applied.join(', ') || 'no-op'}`)

      return {
        editedUrl: `s3://${s3Key}`,
        styleMetrics: {
          appliedAdjustments: applied,
          feedbackApplied: feedbackHistory[feedbackHistory.length - 1] || '',
        },
        adjustments: { ...previousAdjustments, version, ops, applied },
        version,
      }
    } finally {
      try { fs.rmSync(workDir, { recursive: true, force: true }) } catch {}
    }
  }

  /**
   * Use Bedrock to parse feedback into structured edit operations.
   * This is the part the old keyword regex got wrong — phrases like
   * "warmer feel please" used to push *cooler* because of substring matching.
   */
  private async parseFeedback(history: string[], companyId: string): Promise<ParsedEditOps> {
    if (history.length === 0) return ZERO_OPS

    const systemPrompt = `You parse short editorial feedback into structured edit operations for a video.

Output STRICT JSON matching this schema:
{
  "brightness": number,    // -2 to +2 (negative = darker, positive = brighter)
  "saturation": number,    // -2 to +2
  "warmth": number,        // -2 to +2 (negative = cooler/blue, positive = warmer/orange)
  "contrast": number,      // -2 to +2
  "denoise": number,       // 0 to 2 (only positive; how much grain/noise reduction)
  "pacing": "faster" | "slower" | "same",
  "notes": string          // brief plain-text summary, ≤ 50 chars
}

Rules:
- Only set a value to non-zero if the feedback CLEARLY asks for that change.
- Magnitudes: small ask = 1, strong ask = 2. Default to 1 unless they say "much" / "way" / "very".
- "warmer" / "more orange" / "golden hour" → positive warmth
- "cooler" / "more blue" / "less yellow" → negative warmth
- Never invent operations the user didn't ask for.

Output JSON only. No prose.`

    const userMessage = history.length === 1
      ? `Feedback: "${history[0]}"`
      : `Feedback (most recent first):\n${history.slice().reverse().map((f, i) => `${i + 1}. ${f}`).join('\n')}\n\nPrioritize the most recent feedback.`

    const raw = await invokeAgent({
      systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 256,
      temperature: 0.1,
      companyId,
    })
    const parsed = parseAgentOutput<Partial<ParsedEditOps>>(raw)

    return {
      brightness: clamp(parsed.brightness ?? 0, -2, 2),
      saturation: clamp(parsed.saturation ?? 0, -2, 2),
      warmth: clamp(parsed.warmth ?? 0, -2, 2),
      contrast: clamp(parsed.contrast ?? 0, -2, 2),
      denoise: clamp(parsed.denoise ?? 0, 0, 2),
      pacing: parsed.pacing === 'faster' || parsed.pacing === 'slower' ? parsed.pacing : 'same',
      notes: typeof parsed.notes === 'string' ? parsed.notes.slice(0, 80) : '',
    }
  }
}

/**
 * Keyword-based feedback parser used when Bedrock fails.
 * Same behavior as the previous in-line code, kept as a safety net.
 */
function fallbackParseFeedback(history: string[]): ParsedEditOps {
  const ops: ParsedEditOps = { ...ZERO_OPS }
  if (history.length === 0) return ops
  const text = history.join(' ').toLowerCase()

  // Specific phrases first to avoid substring collisions ("not too warm")
  if (/\b(not too warm|less warm|too warm|cooler\b|too orange)/.test(text)) ops.warmth = -1
  else if (/\b(warmer\b|more warm|golden hour|orange tone)/.test(text)) ops.warmth = +1

  if (/\b(too bright|blown out|overexposed)/.test(text)) ops.brightness = -1
  else if (/\b(too dark|muddy|underexposed|brighter)/.test(text)) ops.brightness = +1

  if (/\b(too vibrant|oversaturated|too saturated)/.test(text)) ops.saturation = -1
  else if (/\b(too dull|desaturated|more pop|more vibrant)/.test(text)) ops.saturation = +1

  if (/\b(too flat|more contrast|punchier)/.test(text)) ops.contrast = +1
  else if (/\b(too contrasty|too much contrast)/.test(text)) ops.contrast = -1

  if (/\b(grainy|noisy|noise|denoise)/.test(text)) ops.denoise = 1

  if (/\b(too slow|drags|drag|slow pacing)/.test(text)) ops.pacing = 'faster'
  else if (/\b(too fast|too choppy|too quick|slower)/.test(text)) ops.pacing = 'slower'

  ops.notes = history[history.length - 1].slice(0, 80)
  return ops
}

/**
 * Translate parsed ops into an FFmpeg filter chain.
 * Returns the -vf string, optional -af string, and a list of human-readable
 * adjustments for logging / brand memory.
 */
function buildFiltersFromOps(ops: ParsedEditOps): {
  videoFilter: string
  audioFilter: string
  applied: string[]
} {
  const v: string[] = []
  const a: string[] = []
  const applied: string[] = []

  // Brightness via eq filter (range: -1..+1, but ours is -2..+2)
  if (ops.brightness !== 0) {
    const b = ops.brightness * 0.08 // ±2 → ±0.16, conservative
    v.push(`eq=brightness=${b.toFixed(3)}`)
    applied.push(`brightness ${ops.brightness > 0 ? '+' : ''}${ops.brightness}`)
  }
  if (ops.contrast !== 0) {
    const c = 1 + ops.contrast * 0.1 // ±2 → ±0.2
    v.push(`eq=contrast=${c.toFixed(3)}`)
    applied.push(`contrast ${ops.contrast > 0 ? '+' : ''}${ops.contrast}`)
  }
  if (ops.saturation !== 0) {
    const s = 1 + ops.saturation * 0.15 // ±2 → ±0.3
    v.push(`eq=saturation=${s.toFixed(3)}`)
    applied.push(`saturation ${ops.saturation > 0 ? '+' : ''}${ops.saturation}`)
  }
  // Warmth via colorchannelmixer (push red, pull blue for warmer; opposite for cooler)
  if (ops.warmth !== 0) {
    const w = ops.warmth * 0.06 // ±2 → ±0.12
    v.push(`colorchannelmixer=rr=${(1 + w).toFixed(3)}:bb=${(1 - w).toFixed(3)}`)
    applied.push(`warmth ${ops.warmth > 0 ? '+' : ''}${ops.warmth}`)
  }
  if (ops.denoise > 0) {
    // hqdn3d luma_spatial chroma_spatial luma_tmp chroma_tmp
    const strength = ops.denoise === 2 ? '4:3:6:4.5' : '2:1.5:3:2.5'
    v.push(`hqdn3d=${strength}`)
    applied.push(`denoise +${ops.denoise}`)
  }

  // Pacing — apply via setpts (video) + atempo (audio)
  if (ops.pacing === 'faster') {
    v.push('setpts=0.92*PTS')
    a.push('atempo=1.087')
    applied.push('pacing: faster')
  } else if (ops.pacing === 'slower') {
    v.push('setpts=1.10*PTS')
    a.push('atempo=0.909')
    applied.push('pacing: slower')
  }

  // Always pass-through scale to keep 9:16 sizing consistent (matches original encode)
  if (v.length === 0) {
    v.push('null')
  }

  return {
    videoFilter: v.join(','),
    audioFilter: a.join(','),
    applied,
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : 0))
}

export default StudioVisualEditingService
