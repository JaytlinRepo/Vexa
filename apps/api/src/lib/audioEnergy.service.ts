/**
 * Audio Energy Service
 *
 * Produces a per-second loudness curve from a local video using FFmpeg's
 * ebur128 filter. Loudness spikes inside an action span indicate noteworthy
 * micro-events (object dropped, reaction, slam, laughter) that should be
 * preserved as beats even when motion alone wouldn't pick them up.
 *
 * Output is short-term loudness (M, momentary) sampled per second. Normalized
 * 0..1 against the loudest sample in the file so it can be combined with the
 * motion curve.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export interface AudioPoint {
  time: number       // seconds
  energy: number     // 0..1 normalized
  loudnessLufs: number // raw LUFS for debugging
}

export interface AudioEnergyResult {
  curve: AudioPoint[]
  peakLufs: number
  silentFile: boolean    // true when the file has no audio stream or is fully silent
}

/**
 * Run ffmpeg ebur128 and parse the M (momentary) values from stderr.
 */
export async function buildAudioEnergyCurve(
  localVideoPath: string,
  videoDuration: number,
): Promise<AudioEnergyResult> {
  let stderr = ''
  try {
    const result = await execFileAsync('ffmpeg', [
      '-nostats',
      '-i', localVideoPath,
      '-filter_complex', 'ebur128=peak=true:metadata=1',
      '-f', 'null',
      '-',
    ], { timeout: 120000, maxBuffer: 50 * 1024 * 1024 })
    stderr = result.stderr
  } catch (err: any) {
    stderr = err.stderr || ''
  }

  // ebur128 stderr lines look like:
  //   [Parsed_ebur128_0 @ 0x...] t: 1.2     M: -23.4 S: -22.1 I: -21.0 LUFS LRA: 8.5 LU
  // We parse t (time in seconds) and M (momentary loudness LUFS).
  const samples: Array<{ time: number; lufs: number }> = []
  const re = /t:\s*(\d+\.?\d*)\s+M:\s*(-?\d+\.?\d*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(stderr)) !== null) {
    const t = parseFloat(m[1])
    const lufs = parseFloat(m[2])
    if (!isNaN(t) && !isNaN(lufs) && isFinite(lufs)) {
      samples.push({ time: t, lufs })
    }
  }

  if (samples.length === 0) {
    // No audio stream, or ffmpeg couldn't compute loudness
    return {
      curve: [],
      peakLufs: -70,
      silentFile: true,
    }
  }

  // ebur128's "infinite silence" sentinel is around -70 LUFS. Treat anything
  // below that as silence. Normalize using the loudest momentary sample as 1.0
  // and a floor of -50 LUFS as 0.0 (anything quieter just rounds to 0).
  const peakLufs = samples.reduce((p, s) => (s.lufs > p ? s.lufs : p), -70)
  const FLOOR = -50

  const curve: AudioPoint[] = []
  // Bucket samples into per-second points; if multiple samples land in a
  // bucket, take the max (we care about peaks, not averages).
  const seconds = Math.max(1, Math.ceil(videoDuration))
  for (let i = 0; i < seconds; i++) {
    const inBucket = samples.filter((s) => s.time >= i && s.time < i + 1)
    if (inBucket.length === 0) {
      curve.push({ time: i + 0.5, energy: 0, loudnessLufs: -70 })
      continue
    }
    const maxLufs = inBucket.reduce((p, s) => (s.lufs > p ? s.lufs : p), -70)
    const range = peakLufs - FLOOR
    const energy = range > 0 ? Math.max(0, Math.min(1, (maxLufs - FLOOR) / range)) : 0
    curve.push({ time: i + 0.5, energy, loudnessLufs: maxLufs })
  }

  console.log(`[audio-energy] ${curve.length} buckets, peakLufs=${peakLufs.toFixed(1)}`)
  return {
    curve,
    peakLufs,
    silentFile: peakLufs <= -65,
  }
}
