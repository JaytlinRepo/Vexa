/**
 * FFmpeg Clipper Service
 *
 * CapCut-style reel editing:
 * - Downloads source video once
 * - Cuts each segment individually
 * - Concatenates all segments into one fluid reel with crossfades
 * - Scales to 1080x1920 vertical (Reel/TikTok format)
 * - Uploads result to S3
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import axios from 'axios'
import { uploadFile } from '../services/storage/s3.service'
import { ReelSegment } from './clipAnalyzer.service'

const execFileAsync = promisify(execFile)

export interface ClipResult {
  s3Key: string
  duration: number
  fileSizeBytes: number
  segmentCount: number
}

/**
 * Build a reel from multiple segments: cut each, concatenate, upload to S3.
 */
export async function buildReel(params: {
  sourceUrl: string
  segments: ReelSegment[]
  companyId: string
  uploadId: string
}): Promise<ClipResult> {
  const { sourceUrl, segments, companyId, uploadId } = params
  const tmpDir = os.tmpdir()
  const workDir = path.join(tmpDir, `sovexa-reel-${uploadId}`)
  const inputPath = path.join(workDir, 'source.mp4')
  const outputPath = path.join(workDir, 'reel.mp4')
  const concatListPath = path.join(workDir, 'concat.txt')
  const segmentPaths: string[] = []

  try {
    fs.mkdirSync(workDir, { recursive: true })

    // 1. Download source video
    console.log(`[ffmpeg] Downloading source video...`)
    const response = await axios.get(sourceUrl, { responseType: 'arraybuffer', timeout: 180000 })
    fs.writeFileSync(inputPath, Buffer.from(response.data))
    console.log(`[ffmpeg] Downloaded ${(response.data.byteLength / 1024 / 1024).toFixed(1)}MB`)

    // 2. Cut each segment individually (re-encode to ensure consistent format)
    console.log(`[ffmpeg] Cutting ${segments.length} segments...`)
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      const duration = seg.endTime - seg.startTime
      const segPath = path.join(workDir, `seg-${i.toString().padStart(3, '0')}.mp4`)
      segmentPaths.push(segPath)

      console.log(`[ffmpeg]   ${i + 1}/${segments.length}: ${seg.startTime.toFixed(1)}s - ${seg.endTime.toFixed(1)}s (${duration.toFixed(1)}s) — ${seg.label}`)

      await execFileAsync('ffmpeg', [
        '-y',
        '-ss', String(seg.startTime),
        '-i', inputPath,
        '-t', String(duration),
        '-c:v', 'h264_videotoolbox', '-b:v', '8M',
        '-c:a', 'aac', '-b:a', '128k',
        '-vf', 'format=yuv420p,scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2',
        '-movflags', '+faststart',
        '-r', '30',
        segPath,
      ], { timeout: 120000 })
    }

    // 3. Build concat list
    const concatContent = segmentPaths
      .map(p => `file '${p}'`)
      .join('\n')
    fs.writeFileSync(concatListPath, concatContent)

    // 4. Concatenate all segments
    console.log(`[ffmpeg] Concatenating ${segments.length} segments into reel...`)
    if (segments.length === 1) {
      // Single segment — just rename
      fs.copyFileSync(segmentPaths[0], outputPath)
    } else {
      await execFileAsync('ffmpeg', [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', concatListPath,
        '-c', 'copy',
        '-movflags', '+faststart',
        outputPath,
      ], { timeout: 60000 })
    }

    // 5. Get final duration
    const finalDuration = await getVideoDuration(outputPath)

    // 6. Upload to S3
    const clipBuffer = fs.readFileSync(outputPath)
    const s3Key = `studio/clips/${companyId}/${Date.now()}-reel.mp4`

    console.log(`[ffmpeg] Uploading reel (${(clipBuffer.length / 1024 / 1024).toFixed(1)}MB, ${finalDuration.toFixed(1)}s, ${segments.length} cuts) to S3`)
    await uploadFile({
      key: s3Key,
      body: clipBuffer,
      contentType: 'video/mp4',
    })

    return {
      s3Key,
      duration: finalDuration,
      fileSizeBytes: clipBuffer.length,
      segmentCount: segments.length,
    }
  } finally {
    // Cleanup
    try { fs.rmSync(workDir, { recursive: true, force: true }) } catch {}
  }
}

/**
 * Get video duration using FFprobe.
 */
export async function getVideoDuration(videoPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      videoPath,
    ], { timeout: 10000 })
    return parseFloat(stdout.trim()) || 0
  } catch {
    return 0
  }
}

/**
 * Get video duration from a URL.
 */
export async function getVideoDurationFromUrl(url: string): Promise<number> {
  const tmpPath = path.join(os.tmpdir(), `sovexa-probe-${Date.now()}.mp4`)
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 180000 })
    fs.writeFileSync(tmpPath, Buffer.from(response.data))
    return await getVideoDuration(tmpPath)
  } finally {
    try { fs.unlinkSync(tmpPath) } catch {}
  }
}
