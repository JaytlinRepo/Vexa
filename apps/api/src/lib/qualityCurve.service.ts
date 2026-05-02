/**
 * Quality Curve Service
 *
 * Per-second footage-quality assessment from a local video. Detects three
 * failure modes that visibly hurt a reel and that no LLM-vision pass would
 * reliably catch:
 *
 *   1. Camera shake     — vidstabdetect's per-frame translation magnitude
 *   2. Soft / blurry     — low edge density (motion blur, out of focus)
 *   3. Frozen / stalled  — near-zero frame diff inside otherwise-active spans
 *
 * Output is a per-second quality curve (0..1, higher = cleaner) and an
 * explicit list of "bad windows" that downstream code can use to either
 * exclude or annotate.
 *
 * Disambiguation note: high shake + low motion = handheld accident (bad);
 * high shake + high motion = intentional pan/swing (often fine). The decision
 * rule is applied in this service so consumers get a single quality score
 * already adjusted for context.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { MotionPoint } from './motionCurve.service'

const execFileAsync = promisify(execFile)

export type QualityIssue = 'shake' | 'blur' | 'frozen'

export interface QualityPoint {
  time: number          // bucket center (seconds)
  shake: number         // 0..1, higher = more shake
  sharpness: number     // 0..1, higher = sharper image
  motionRaw: number     // raw frame-diff (mirrored from motion curve)
  score: number         // 0..1 composite, higher = cleaner usable footage
}

export interface BadWindow {
  startTime: number
  endTime: number
  reason: QualityIssue
  /** Severity 0..1 — closer to 1 = worse */
  severity: number
}

export interface QualityCurveResult {
  curve: QualityPoint[]
  badWindows: BadWindow[]
  meanScore: number
  /** Whether vidstab succeeded — false means shake values are 0 (we couldn't detect) */
  shakeAvailable: boolean
}

/** Below this score the segment is considered unusable garbage */
export const HARD_EXCLUDE_THRESHOLD = 0.32
/** Below this (but above HARD) → annotate, let Riley weigh */
export const SOFT_WARN_THRESHOLD = 0.55

/**
 * Build the quality curve from a local file.
 *
 * Three FFmpeg passes (sequential — vidstabdetect writes a transforms file
 * we then parse). All passes operate on a downscaled 240p copy so they're
 * fast (each ~5-10s on a 4-min source).
 */
export async function buildQualityCurve(
  localVideoPath: string,
  videoDuration: number,
  motionCurve: MotionPoint[],
): Promise<QualityCurveResult> {
  const seconds = Math.max(1, Math.ceil(videoDuration))

  // ── 1. Shake — vidstabdetect ─────────────────────────────────────────────
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovexa-quality-'))
  const trfPath = path.join(workDir, 'transforms.trf')

  let shakeByBucket: number[] = new Array(seconds).fill(0)
  let shakeAvailable = false
  try {
    await execFileAsync('ffmpeg', [
      '-i', localVideoPath,
      '-an',
      '-vf', `scale=240:-2,vidstabdetect=stepsize=6:shakiness=10:accuracy=15:result=${trfPath}`,
      '-f', 'null',
      '-',
    ], { timeout: 180000, maxBuffer: 50 * 1024 * 1024 }).catch(() => {
      // vidstabdetect succeeds even on errors; we only care if the .trf was written
    })

    if (fs.existsSync(trfPath)) {
      shakeByBucket = parseShakeFile(trfPath, seconds, videoDuration)
      shakeAvailable = shakeByBucket.some((v) => v > 0)
    }
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }) } catch {}
  }

  // ── 2. Sharpness — edge density via edgedetect + signalstats ─────────────
  // edgedetect outputs a frame whose Y is high where edges are present; mean Y
  // of that output across a bucket = average edge density. High = sharp.
  let sharpnessByBucket = new Array(seconds).fill(0.5)
  try {
    let stderr = ''
    try {
      const result = await execFileAsync('ffmpeg', [
        '-i', localVideoPath,
        '-an',
        '-vf', 'fps=2,scale=320:-2,edgedetect=mode=colormix:high=0.4:low=0.15,signalstats,metadata=mode=print',
        '-f', 'null',
        '-',
      ], { timeout: 180000, maxBuffer: 100 * 1024 * 1024 })
      stderr = result.stderr
    } catch (err: any) {
      stderr = err.stderr || ''
    }

    sharpnessByBucket = parseSharpness(stderr, seconds)
  } catch (err) {
    console.warn('[quality] sharpness pass failed:', (err as Error).message)
  }

  // ── 3. Composite score ───────────────────────────────────────────────────
  // Score blends sharpness directly and shake-with-motion-context. Frozen
  // detection is per-second from the existing motion curve.
  const meanShake = average(shakeByBucket)
  const shakeNoiseFloor = meanShake > 0 ? Math.min(0.25, meanShake * 0.6) : 0
  const motionByBucket = bucketMotion(motionCurve, seconds)

  const curve: QualityPoint[] = []
  for (let t = 0; t < seconds; t++) {
    const shake = shakeByBucket[t] ?? 0
    const sharpness = sharpnessByBucket[t] ?? 0.5
    const motionRaw = motionByBucket[t] ?? 0

    // Adjusted shake — subtract baseline noise; for high-motion buckets,
    // forgive shake (legitimate pan/swing). Penalty only kicks in when the
    // shake is markedly above motion expectation.
    const motionExpectsShake = motionRaw > 0.55  // legit motion → some shake is fine
    const adjShake = Math.max(0, shake - shakeNoiseFloor) * (motionExpectsShake ? 0.4 : 1.0)

    // Score: sharpness weighted heavily; shake penalizes; never go below 0.
    // 0.7 * sharpness + 0.3 * (1 - clipped shake).
    const shakePenalty = Math.min(1, adjShake)
    const score = Math.max(0, Math.min(1, 0.7 * sharpness + 0.3 * (1 - shakePenalty)))

    curve.push({ time: t + 0.5, shake, sharpness, motionRaw, score })
  }

  // ── 4. Bad windows ───────────────────────────────────────────────────────
  // We collapse contiguous bad seconds into windows.
  const badWindows: BadWindow[] = []

  // Shake windows
  if (shakeAvailable) {
    let runStart: number | null = null
    let runMax = 0
    for (let t = 0; t < seconds; t++) {
      const s = curve[t]
      const isBad = (s.shake - shakeNoiseFloor) > 0.55 && s.motionRaw < 0.65
      if (isBad) {
        if (runStart === null) runStart = t
        runMax = Math.max(runMax, s.shake)
      } else if (runStart !== null) {
        if (t - runStart >= 1) {
          badWindows.push({ startTime: runStart, endTime: t, reason: 'shake', severity: Math.min(1, runMax) })
        }
        runStart = null
        runMax = 0
      }
    }
    if (runStart !== null && seconds - runStart >= 1) {
      badWindows.push({ startTime: runStart, endTime: seconds, reason: 'shake', severity: Math.min(1, runMax) })
    }
  }

  // Blur / soft windows — sharpness < 0.25 sustained ≥ 1.5s
  {
    let runStart: number | null = null
    let runMin = 1
    for (let t = 0; t < seconds; t++) {
      const s = curve[t]
      const isBad = s.sharpness < 0.25
      if (isBad) {
        if (runStart === null) runStart = t
        runMin = Math.min(runMin, s.sharpness)
      } else if (runStart !== null) {
        if (t - runStart >= 2) {
          badWindows.push({ startTime: runStart, endTime: t, reason: 'blur', severity: Math.min(1, 1 - runMin) })
        }
        runStart = null
        runMin = 1
      }
    }
    if (runStart !== null && seconds - runStart >= 2) {
      badWindows.push({ startTime: runStart, endTime: seconds, reason: 'blur', severity: Math.min(1, 1 - runMin) })
    }
  }

  // Frozen windows — motionRaw near zero for ≥ 1.5s INSIDE a generally-active
  // neighborhood (otherwise it's just dead time, not a frozen frame artifact)
  {
    const windowMean = (start: number, end: number): number => {
      const slice = curve.slice(Math.max(0, start), Math.min(curve.length, end))
      if (slice.length === 0) return 0
      return slice.reduce((s, p) => s + p.motionRaw, 0) / slice.length
    }
    let runStart: number | null = null
    for (let t = 0; t < seconds; t++) {
      const s = curve[t]
      const isFrozen = s.motionRaw < 0.05
      if (isFrozen) {
        if (runStart === null) runStart = t
      } else if (runStart !== null) {
        if (t - runStart >= 2) {
          // Confirm the surrounding 6s has meaningful motion — otherwise it's
          // just a slow segment, not a freeze.
          const surroundingMean = (windowMean(runStart - 3, runStart) + windowMean(t, t + 3)) / 2
          if (surroundingMean > 0.35) {
            badWindows.push({ startTime: runStart, endTime: t, reason: 'frozen', severity: 0.8 })
          }
        }
        runStart = null
      }
    }
  }

  badWindows.sort((a, b) => a.startTime - b.startTime)
  const meanScore = average(curve.map((p) => p.score))

  console.log(`[quality] mean=${meanScore.toFixed(2)} shakeAvailable=${shakeAvailable} badWindows=${badWindows.length}`)
  badWindows.forEach((w) => {
    console.log(`  bad[${w.reason}] ${w.startTime.toFixed(1)}-${w.endTime.toFixed(1)}s severity=${w.severity.toFixed(2)}`)
  })

  return { curve, badWindows, meanScore, shakeAvailable }
}

/**
 * Parse vidstabdetect's transforms.trf file. Format is roughly:
 *   #TRF starting line, then per-frame:
 *   X Y ROT ZOOM RX RY ALPHA
 * We sum |X| + |Y| as a shake magnitude and bucket per second.
 */
function parseShakeFile(trfPath: string, seconds: number, videoDuration: number): number[] {
  const result = new Array(seconds).fill(0)
  const counts = new Array(seconds).fill(0)
  try {
    const text = fs.readFileSync(trfPath, 'utf-8')
    const lines = text.split('\n')
    // Each non-comment line: "Frame N (X,Y,ROT,ZOOM,...) ..."
    // Format varies by vidstab version; safest to extract floats and look at
    // the magnitudes of the first two numeric fields per frame.
    let frameNum = 0
    const totalFramesRe = /^Frame\s+(\d+)/i
    const numRe = /-?\d+\.?\d*/g
    let detectedFrames = 0
    for (const line of lines) {
      if (line.startsWith('#') || line.trim() === '') continue
      const fm = line.match(totalFramesRe)
      if (fm) {
        frameNum = parseInt(fm[1], 10)
        const nums = line.match(numRe)
        if (nums && nums.length >= 4) {
          // Skip the leading frame number; next two are X, Y translation
          const x = parseFloat(nums[1])
          const y = parseFloat(nums[2])
          const mag = Math.sqrt(x * x + y * y)
          // Map frame to bucket — assume vidstab samples roughly per-frame at
          // source fps. We don't know exact fps here without probing; use a
          // proportional mapping based on detected frame count.
          detectedFrames = Math.max(detectedFrames, frameNum)
        }
      }
    }
    if (detectedFrames === 0) return result

    // Second pass with the now-known total frame count to bucket properly
    const fps = detectedFrames / videoDuration
    let frameIdx = 0
    for (const line of lines) {
      if (line.startsWith('#') || line.trim() === '') continue
      const fm = line.match(totalFramesRe)
      if (fm) {
        frameIdx = parseInt(fm[1], 10)
        const nums = line.match(numRe)
        if (nums && nums.length >= 4) {
          const x = parseFloat(nums[1])
          const y = parseFloat(nums[2])
          const mag = Math.sqrt(x * x + y * y)
          const tSec = Math.floor(frameIdx / fps)
          if (tSec >= 0 && tSec < seconds) {
            result[tSec] += mag
            counts[tSec] += 1
          }
        }
      }
    }

    // Average per bucket and normalize. Typical translation magnitudes are
    // 0..50 in pixel units of the 240p downscale; >15 is noticeably shaky.
    for (let t = 0; t < seconds; t++) {
      const avg = counts[t] > 0 ? result[t] / counts[t] : 0
      result[t] = Math.max(0, Math.min(1, avg / 25))  // 25px = 1.0 shake score
    }
  } catch (err) {
    console.warn('[quality] failed to parse vidstab file:', (err as Error).message)
  }
  return result
}

/**
 * Parse signalstats output from edgedetect+signalstats pipeline. Higher YAVG
 * of the edgedetect output = denser edges = sharper image. Normalized 0..1
 * via percentile floor/ceiling for robustness.
 */
function parseSharpness(stderr: string, seconds: number): number[] {
  const samples: Array<{ time: number; raw: number }> = []
  let pendingTime: number | null = null
  for (const line of stderr.split('\n')) {
    const tMatch = line.match(/pts_time:\s*(\d+\.?\d*)/)
    if (tMatch) {
      pendingTime = parseFloat(tMatch[1])
      continue
    }
    const yMatch = line.match(/lavfi\.signalstats\.YAVG\s*=\s*(\d+\.?\d*)/)
    if (yMatch && pendingTime != null) {
      samples.push({ time: pendingTime, raw: parseFloat(yMatch[1]) })
      pendingTime = null
    }
  }

  if (samples.length === 0) return new Array(seconds).fill(0.5)

  // Percentile-based normalization
  const sortedRaw = [...samples].map((s) => s.raw).sort((a, b) => a - b)
  const pct = (p: number) => sortedRaw[Math.min(sortedRaw.length - 1, Math.floor(sortedRaw.length * p))]
  const floor = pct(0.05)
  const ceil = Math.max(floor + 0.001, pct(0.95))

  const result = new Array(seconds).fill(0.5)
  const counts = new Array(seconds).fill(0)
  const accum = new Array(seconds).fill(0)
  for (const s of samples) {
    const tSec = Math.floor(s.time)
    if (tSec >= 0 && tSec < seconds) {
      const norm = Math.max(0, Math.min(1, (s.raw - floor) / (ceil - floor)))
      accum[tSec] += norm
      counts[tSec] += 1
    }
  }
  for (let t = 0; t < seconds; t++) {
    if (counts[t] > 0) result[t] = accum[t] / counts[t]
  }
  return result
}

function bucketMotion(curve: MotionPoint[], seconds: number): number[] {
  const out = new Array(seconds).fill(0)
  for (const p of curve) {
    const t = Math.floor(p.time)
    if (t >= 0 && t < seconds) out[t] = Math.max(out[t], p.motion)
  }
  return out
}

function average(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((s, x) => s + x, 0) / xs.length
}

/**
 * Test if a given time falls inside any bad window.
 */
export function isBadTime(t: number, badWindows: BadWindow[]): BadWindow | null {
  for (const w of badWindows) {
    if (t >= w.startTime && t <= w.endTime) return w
  }
  return null
}
