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

    // Download video
    console.log('[keyframes] Downloading video...')
    const response = await axios.get(videoUrl, { responseType: 'arraybuffer', timeout: 180000 })
    fs.writeFileSync(inputPath, Buffer.from(response.data))

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
