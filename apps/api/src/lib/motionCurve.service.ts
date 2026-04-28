/**
 * Motion Curve Service
 *
 * Per-frame motion curve from a local video using FFmpeg's tblend+signalstats
 * pipeline. Produces a CONTINUOUS signal — the mean Y (luminance) of the
 * frame-difference between adjacent frames — instead of mpdecimate's binary
 * "kept / dropped" classification.
 *
 * Why continuous matters: high-action content saturates a binary signal at
 * 1.0 for every second, hiding peaks and valleys. A continuous signal still
 * shows relative motion structure even when the floor is high.
 *
 * The curve is normalized using percentiles so it's robust to videos that
 * are uniformly bright, uniformly dim, or have outlier transition flashes.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export interface MotionPoint {
  time: number     // seconds into video (bucket center)
  motion: number   // 0..1 normalized (continuous, not binary)
  raw: number      // raw frame-diff Y mean (unnormalized, for debugging)
}

export interface MotionCurveResult {
  curve: MotionPoint[]
  peakMotion: number
  meanMotion: number
  /** 5th percentile of raw values — used as the "floor" for normalization */
  rawFloor: number
  /** 95th percentile of raw values — used as the "ceiling" */
  rawCeil: number
}

/**
 * Build a per-second motion curve.
 *
 * Pipeline:
 *   1. Sample at SAMPLE_HZ fps.
 *   2. Downscale to 240w (saves ~10× compute on large videos, no signal loss
 *      for our purposes — we care about gross motion magnitude).
 *   3. tblend=all_mode=difference produces a frame whose Y channel is the
 *      pixel-wise abs-difference between the current and previous frame.
 *   4. signalstats=stat=ymean writes the mean Y of that diff frame as
 *      lavfi.signalstats.YAVG metadata. High YAVG = lots changed.
 *   5. metadata=mode=print prints the values to stderr where we parse them.
 *
 * We then bucket per-second (max-pooled — peaks matter more than averages)
 * and normalize using the 5th/95th percentile as floor/ceiling.
 */
export async function buildMotionCurve(
  localVideoPath: string,
  videoDuration: number,
): Promise<MotionCurveResult> {
  const SAMPLE_HZ = 4   // 4 frames/sec → 0.25s temporal resolution

  let stderr = ''
  try {
    const result = await execFileAsync('ffmpeg', [
      '-i', localVideoPath,
      '-an',
      '-vf', `fps=${SAMPLE_HZ},scale=240:-2,tblend=all_mode=difference,signalstats,metadata=mode=print`,
      '-f', 'null',
      '-',
    ], { timeout: 180000, maxBuffer: 200 * 1024 * 1024 })
    stderr = result.stderr
  } catch (err: any) {
    // ffmpeg writes metadata to stderr even on non-zero exits
    stderr = err.stderr || ''
  }

  // The metadata filter emits two lines per frame:
  //   [Parsed_metadata_X @ 0x...] frame:N pts:T pts_time:T.TTT
  //   [Parsed_metadata_X @ 0x...] lavfi.signalstats.YAVG=N.NNN
  // (signalstats actually emits multiple keys: YAVG, YMIN, YMAX, etc.; we
  //  only want YAVG.)
  const samples: Array<{ time: number; raw: number }> = []
  const lines = stderr.split('\n')
  let pendingTime: number | null = null
  for (const line of lines) {
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

  if (samples.length === 0) {
    console.warn('[motion-curve] No samples parsed from ffmpeg output — returning empty curve')
    return { curve: [], peakMotion: 0, meanMotion: 0, rawFloor: 0, rawCeil: 0 }
  }

  // Robust normalization via percentiles, not min/max — a single transition
  // flash can blow out a min/max scale; percentiles ignore the long tail.
  const sortedRaw = [...samples].map((s) => s.raw).sort((a, b) => a - b)
  const pct = (p: number) => sortedRaw[Math.min(sortedRaw.length - 1, Math.floor(sortedRaw.length * p))]
  const rawFloor = pct(0.05)
  const rawCeil = Math.max(rawFloor + 0.001, pct(0.95))

  // Bucket per second — take the MAX raw value within the bucket (peaks
  // matter; averaging would smooth away the very anomalies we're detecting).
  const seconds = Math.max(1, Math.ceil(videoDuration))
  const curve: MotionPoint[] = []
  for (let i = 0; i < seconds; i++) {
    const inBucket = samples.filter((s) => s.time >= i && s.time < i + 1)
    if (inBucket.length === 0) {
      curve.push({ time: i + 0.5, motion: 0, raw: 0 })
      continue
    }
    const maxRaw = inBucket.reduce((m, s) => (s.raw > m ? s.raw : m), 0)
    const norm = Math.max(0, Math.min(1, (maxRaw - rawFloor) / (rawCeil - rawFloor)))
    curve.push({ time: i + 0.5, motion: norm, raw: maxRaw })
  }

  const peakMotion = curve.reduce((m, p) => Math.max(m, p.motion), 0)
  const meanMotion = curve.length > 0
    ? curve.reduce((s, p) => s + p.motion, 0) / curve.length
    : 0

  console.log(`[motion-curve] ${curve.length} buckets — peak=${peakMotion.toFixed(2)} mean=${meanMotion.toFixed(2)} rawFloor=${rawFloor.toFixed(1)} rawCeil=${rawCeil.toFixed(1)} (${samples.length} raw samples)`)
  return { curve, peakMotion, meanMotion, rawFloor, rawCeil }
}

/**
 * Smooth a curve via centered moving average. Window in samples.
 */
export function smoothCurve(curve: MotionPoint[], window = 3): MotionPoint[] {
  if (curve.length === 0 || window <= 1) return curve
  const half = Math.floor(window / 2)
  return curve.map((p, i) => {
    const lo = Math.max(0, i - half)
    const hi = Math.min(curve.length - 1, i + half)
    let sum = 0
    let n = 0
    for (let j = lo; j <= hi; j++) {
      sum += curve[j].motion
      n++
    }
    return { time: p.time, motion: sum / n, raw: p.raw }
  })
}
