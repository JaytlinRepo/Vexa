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
import type { CreatorFilters } from './ffmpegFilterBuilder'
import { buildSegmentVF, buildSegmentAF, buildTransitionFilter, describeFilters } from './ffmpegFilterBuilder'

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
  creatorFilters?: CreatorFilters | null
  localSource?: boolean   // true = sourceUrl is a local file path, skip download
  sourceInputs?: string[]  // for multi-video compilation — additional input paths
}): Promise<ClipResult> {
  const { sourceUrl, segments, companyId, uploadId, creatorFilters, localSource } = params
  const tmpDir = os.tmpdir()
  const workDir = path.join(tmpDir, `sovexa-reel-${uploadId}`)
  const inputPath = path.join(workDir, 'source.mp4')
  const outputPath = path.join(workDir, 'reel.mp4')
  const concatListPath = path.join(workDir, 'concat.txt')
  const segmentPaths: string[] = []

  try {
    fs.mkdirSync(workDir, { recursive: true })

    // 1. Get source video (local file or download)
    if (localSource) {
      // Source already downloaded — copy or symlink to work dir
      fs.copyFileSync(sourceUrl, inputPath)
      const sizeMB = (fs.statSync(inputPath).size / 1024 / 1024).toFixed(1)
      console.log(`[ffmpeg] Using local source: ${sizeMB}MB (no download)`)
    } else {
      console.log(`[ffmpeg] Downloading source video...`)
      const response = await axios.get(sourceUrl, { responseType: 'arraybuffer', timeout: 180000 })
      fs.writeFileSync(inputPath, Buffer.from(response.data))
      console.log(`[ffmpeg] Downloaded ${(response.data.byteLength / 1024 / 1024).toFixed(1)}MB`)
    }

    // 2. Build creator-specific filter chains
    const vfStr = creatorFilters ? buildSegmentVF(creatorFilters) : 'format=yuv420p,scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2'
    const afStr = creatorFilters ? buildSegmentAF(creatorFilters) : ''
    const fps = creatorFilters?.targetFps || 30

    if (creatorFilters) {
      const desc = describeFilters(creatorFilters)
      console.log(`[ffmpeg] Creator-aware filters: ${desc.join(' | ')}`)
    }

    // 3. Cut each segment individually with creator-specific filters
    console.log(`[ffmpeg] Cutting ${segments.length} segments...`)
    const segmentDurations: number[] = []
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      const duration = seg.endTime - seg.startTime
      segmentDurations.push(duration)
      const segPath = path.join(workDir, `seg-${i.toString().padStart(3, '0')}.mp4`)
      segmentPaths.push(segPath)

      console.log(`[ffmpeg]   ${i + 1}/${segments.length}: ${seg.startTime.toFixed(1)}s - ${seg.endTime.toFixed(1)}s (${duration.toFixed(1)}s) — ${seg.label}`)

      const args = [
        '-y',
        '-ss', String(seg.startTime),
        '-i', inputPath,
        '-t', String(duration),
        '-c:v', 'h264_videotoolbox', '-b:v', '8M',
        '-c:a', 'aac', '-b:a', '128k',
        '-vf', vfStr,
        ...(afStr ? ['-af', afStr] : []),
        '-movflags', '+faststart',
        '-r', String(fps),
        segPath,
      ]

      try {
        await execFileAsync('ffmpeg', args, { timeout: 120000 })
      } catch (err: any) {
        // FFmpeg writes to stderr even on success — check if output file was created
        if (fs.existsSync(segPath) && fs.statSync(segPath).size > 0) {
          console.log(`[ffmpeg]   Segment ${i + 1} completed (stderr warnings ignored)`)
        } else if (afStr) {
          // Retry without audio filters (some codecs/streams are incompatible)
          console.warn(`[ffmpeg]   Retrying segment ${i + 1} without audio filters`)
          const fallbackArgs = args.filter((_, idx) => args[idx] !== '-af' && (idx === 0 || args[idx - 1] !== '-af'))
          try {
            await execFileAsync('ffmpeg', fallbackArgs, { timeout: 120000 })
          } catch {
            if (fs.existsSync(segPath) && fs.statSync(segPath).size > 0) {
              console.log(`[ffmpeg]   Segment ${i + 1} completed on retry`)
            } else {
              throw err
            }
          }
        } else {
          throw err
        }
      }
    }

    // 4. Concatenate with transitions
    const transition = creatorFilters?.segmentTransition || { type: 'none' as const, duration: 0 }
    const transitionFilter = buildTransitionFilter(segments.length, segmentDurations, transition)

    console.log(`[ffmpeg] Concatenating ${segments.length} segments (${transition.type} transitions)...`)
    if (segments.length === 1) {
      fs.copyFileSync(segmentPaths[0], outputPath)
    } else if (transitionFilter) {
      // Use filter_complex for cross-segment transitions (xfade)
      const inputs = segmentPaths.flatMap((p) => ['-i', p])
      await execFileAsync('ffmpeg', [
        '-y',
        ...inputs,
        '-filter_complex', transitionFilter,
        '-map', '[outv]',
        '-c:v', 'h264_videotoolbox', '-b:v', '8M',
        '-movflags', '+faststart',
        outputPath,
      ], { timeout: 120000 })
    } else {
      // Standard concat (hard cuts)
      const concatContent = segmentPaths.map((p) => `file '${p}'`).join('\n')
      fs.writeFileSync(concatListPath, concatContent)
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
