/**
 * Keyframe Extractor
 * Pulls frames from a video at regular intervals for visual analysis.
 * Returns base64-encoded images that can be sent to Bedrock vision.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import axios from 'axios'

const execFileAsync = promisify(execFile)

export interface ExtractedFrame {
  timestamp: number      // seconds into the video
  base64: string         // base64-encoded JPEG
  index: number
}

/**
 * Extract keyframes from a video at regular intervals.
 * Returns base64 JPEGs ready for Bedrock vision.
 *
 * @param videoUrl - presigned S3 URL or local path
 * @param videoDuration - total duration in seconds
 * @param intervalSeconds - how often to grab a frame (default: 2s)
 * @param maxFrames - cap on total frames (default: 15)
 */
export async function extractKeyframes(
  videoUrl: string,
  videoDuration: number,
  intervalSeconds = 2,
  maxFrames = 15,
): Promise<ExtractedFrame[]> {
  const workDir = path.join(os.tmpdir(), `sovexa-frames-${Date.now()}`)
  const inputPath = path.join(workDir, 'source.mp4')

  try {
    fs.mkdirSync(workDir, { recursive: true })

    // Get video — use local file if path exists, otherwise download
    if (videoUrl.startsWith('/') && fs.existsSync(videoUrl)) {
      console.log('[keyframes] Using local file')
      fs.copyFileSync(videoUrl, inputPath)
    } else {
      console.log('[keyframes] Downloading video...')
      const response = await axios.get(videoUrl, { responseType: 'arraybuffer', timeout: 180000 })
      fs.writeFileSync(inputPath, Buffer.from(response.data))
    }

    // Calculate actual interval to stay within maxFrames
    const totalPossible = Math.floor(videoDuration / intervalSeconds)
    const actualInterval = totalPossible > maxFrames
      ? Math.ceil(videoDuration / maxFrames)
      : intervalSeconds

    // Extract frames with FFmpeg
    // fps=1/interval gives us one frame per interval
    console.log(`[keyframes] Extracting frames every ${actualInterval}s (max ${maxFrames})...`)
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-vf', `fps=1/${actualInterval},format=yuv420p,scale=480:-1`,
      '-q:v', '5',              // Lower quality = faster + smaller base64
      '-frames:v', String(maxFrames),
      path.join(workDir, 'frame-%03d.jpg'),
    ], { timeout: 300000 }) // 5 min timeout for large 4K files

    // Read frames and convert to base64
    const frames: ExtractedFrame[] = []
    const files = fs.readdirSync(workDir)
      .filter(f => f.startsWith('frame-') && f.endsWith('.jpg'))
      .sort()

    for (let i = 0; i < files.length; i++) {
      const filePath = path.join(workDir, files[i])
      const buffer = fs.readFileSync(filePath)
      frames.push({
        timestamp: i * actualInterval,
        base64: buffer.toString('base64'),
        index: i,
      })
    }

    console.log(`[keyframes] Extracted ${frames.length} frames`)
    return frames
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }) } catch {}
  }
}

/**
 * Extract frames at specific timestamps (used for beat-targeted extraction).
 * Faster than running ffmpeg N times — uses one pass with a select filter.
 */
export async function extractFramesAt(
  videoPath: string,
  timestamps: number[],
): Promise<ExtractedFrame[]> {
  if (timestamps.length === 0) return []
  const sorted = [...new Set(timestamps.map((t) => Math.round(t * 100) / 100))].sort((a, b) => a - b)
  const workDir = path.join(os.tmpdir(), `sovexa-beats-${Date.now()}`)

  try {
    fs.mkdirSync(workDir, { recursive: true })

    // Use ffmpeg's select filter with eq(t,...)|eq(t,...)|... — one pass, N frames.
    // Build expression in chunks of 30 to avoid huge command lines.
    const out: ExtractedFrame[] = []
    const CHUNK = 30
    for (let chunkStart = 0; chunkStart < sorted.length; chunkStart += CHUNK) {
      const chunk = sorted.slice(chunkStart, chunkStart + CHUNK)
      // gte(t,X)*lte(t,X+0.05) — select first frame at-or-after each timestamp
      const expr = chunk.map((t) => `between(t,${t.toFixed(2)},${(t + 0.08).toFixed(2)})`).join('+')
      const outPattern = path.join(workDir, `beat-${chunkStart.toString().padStart(4, '0')}-%03d.jpg`)
      try {
        await execFileAsync('ffmpeg', [
          '-y',
          '-i', videoPath,
          '-vf', `select='${expr}',format=yuv420p,scale=480:-1`,
          '-vsync', 'vfr',
          '-q:v', '5',
          outPattern,
        ], { timeout: 120000 })
      } catch (err: any) {
        // ffmpeg returns non-zero on benign warnings sometimes
        if (!fs.readdirSync(workDir).some((f) => f.startsWith(`beat-${chunkStart.toString().padStart(4, '0')}-`))) {
          throw err
        }
      }

      const files = fs.readdirSync(workDir)
        .filter((f) => f.startsWith(`beat-${chunkStart.toString().padStart(4, '0')}-`) && f.endsWith('.jpg'))
        .sort()

      for (let i = 0; i < files.length && i < chunk.length; i++) {
        const buf = fs.readFileSync(path.join(workDir, files[i]))
        out.push({
          timestamp: chunk[i],
          base64: buf.toString('base64'),
          index: out.length,
        })
      }
    }

    console.log(`[keyframes] Beat-targeted extraction: ${out.length} of ${sorted.length} requested timestamps`)
    return out
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }) } catch {}
  }
}
