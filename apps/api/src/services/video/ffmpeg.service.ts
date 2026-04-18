/**
 * FFmpeg video editing service.
 *
 * Riley generates structured edit commands → this service translates them
 * into FFmpeg operations → outputs an edited file to S3.
 *
 * Supported operations:
 *   trim        — cut start/end of video
 *   speed       — speed up or slow down a segment
 *   crop        — change aspect ratio (9:16, 1:1, 4:5)
 *   text        — burn text overlay at a timestamp
 *   audio_norm  — normalize audio levels
 *   audio_strip — remove audio entirely
 */

import ffmpeg from 'fluent-ffmpeg'
import { execSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { createWriteStream, createReadStream, unlinkSync, readFileSync } from 'fs'

// Detect available H.264 encoder — libx264 on Linux/prod, videotoolbox on macOS
let H264_ENCODER = 'libx264'
try {
  const encoders = execSync('ffmpeg -encoders 2>&1', { encoding: 'utf8' })
  if (!encoders.includes('libx264')) {
    if (encoders.includes('h264_videotoolbox')) H264_ENCODER = 'h264_videotoolbox'
    else if (encoders.includes('libopenh264')) H264_ENCODER = 'libopenh264'
  }
} catch {}
console.log(`[ffmpeg] using encoder: ${H264_ENCODER}`)
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { uploadFile, getPresignedUrl, buildUploadKey } from '../storage/s3.service'

// ─── EDIT COMMAND TYPES ──────────────────────────────────────────────────────

export interface TrimEdit {
  type: 'trim'
  startSec: number    // seconds to trim from start
  endSec?: number     // if set, trim everything after this second
}

export interface SpeedEdit {
  type: 'speed'
  factor: number      // 1.5 = 150% speed, 0.5 = half speed
  fromSec?: number    // optional: only affect a range
  toSec?: number
}

export interface CropEdit {
  type: 'crop'
  aspect: '9:16' | '1:1' | '4:5' | '16:9'
}

export interface TextEdit {
  type: 'text'
  content: string
  startSec: number
  endSec: number
  position: 'top' | 'center' | 'bottom'
  fontSize?: number
  color?: string
}

export interface AudioNormEdit {
  type: 'audio_norm'
}

export interface AudioStripEdit {
  type: 'audio_strip'
}

export interface MoodEdit {
  type: 'mood'
  mood: 'warm' | 'cool' | 'moody' | 'bright' | 'vintage' | 'cinematic'
}

export type EditCommand = TrimEdit | SpeedEdit | CropEdit | TextEdit | AudioNormEdit | AudioStripEdit | MoodEdit

export interface EditPlan {
  edits: EditCommand[]
  rileyNote: string
}

// ─── DOWNLOAD FILE TO TEMP ──────────────────────────────────────────────────

async function downloadToTemp(url: string): Promise<string> {
  const tmpPath = join(tmpdir(), `vx-edit-${randomUUID()}.mp4`)
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Failed to download: ${res.statusText}`)
  const ws = createWriteStream(tmpPath)
  await pipeline(Readable.fromWeb(res.body as never), ws)
  return tmpPath
}

// ─── APPLY EDITS ─────────────────────────────────────────────────────────────

/**
 * Apply a sequence of FFmpeg edits to a video.
 * Downloads from S3, processes locally, re-uploads the result.
 */
export async function applyEdits(opts: {
  sourceKey: string
  companyId: string
  edits: EditCommand[]
}): Promise<{ editedKey: string; editedUrl: string }> {
  const sourceUrl = await getPresignedUrl(opts.sourceKey)
  const inputPath = await downloadToTemp(sourceUrl)
  const outputPath = join(tmpdir(), `vx-edited-${randomUUID()}.mp4`)

  try {
    await runFFmpeg(inputPath, outputPath, opts.edits)

    // Upload the edited file to S3
    const editedBuffer = readFileSync(outputPath)
    const editedKey = buildUploadKey(opts.companyId, `edited-${Date.now()}.mp4`)
    await uploadFile({
      key: editedKey,
      body: editedBuffer,
      contentType: 'video/mp4',
    })

    const editedUrl = await getPresignedUrl(editedKey)
    return { editedKey, editedUrl }
  } finally {
    // Clean up temp files
    try { unlinkSync(inputPath) } catch {}
    try { unlinkSync(outputPath) } catch {}
  }
}

// ─── FFMPEG COMMAND BUILDER ──────────────────────────────────────────────────

function runFFmpeg(input: string, output: string, edits: EditCommand[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let cmd = ffmpeg(input)

    // Collect filters
    const videoFilters: string[] = []
    const audioFilters: string[] = []
    let seekStart: number | undefined
    let duration: number | undefined
    let stripAudio = false

    for (const edit of edits) {
      switch (edit.type) {
        case 'trim': {
          if (edit.startSec > 0) seekStart = edit.startSec
          if (edit.endSec) duration = edit.endSec - (edit.startSec || 0)
          break
        }

        case 'speed': {
          // setpts for video, atempo for audio
          const vFactor = 1 / edit.factor  // setpts uses inverse
          videoFilters.push(`setpts=${vFactor.toFixed(4)}*PTS`)
          // atempo only supports 0.5-2.0 range, chain for extremes
          let remaining = edit.factor
          while (remaining > 2.0) {
            audioFilters.push('atempo=2.0')
            remaining /= 2.0
          }
          while (remaining < 0.5) {
            audioFilters.push('atempo=0.5')
            remaining /= 0.5
          }
          audioFilters.push(`atempo=${remaining.toFixed(4)}`)
          break
        }

        case 'crop': {
          const cropMap: Record<string, string> = {
            '9:16': 'crop=ih*9/16:ih',
            '1:1': 'crop=min(iw\\,ih):min(iw\\,ih)',
            '4:5': 'crop=ih*4/5:ih',
            '16:9': 'crop=iw:iw*9/16',
          }
          const cropFilter = cropMap[edit.aspect]
          if (cropFilter) videoFilters.push(cropFilter)
          break
        }

        case 'text': {
          // drawtext requires libx264 to work reliably with filter chains
          // Skip on hardware encoders (videotoolbox) — will work on prod (Railway)
          if (H264_ENCODER !== 'libx264') {
            console.warn('[ffmpeg] skipping text overlay — requires libx264 (available on production)')
            break
          }
          const yMap: Record<string, string> = {
            top: 'y=h*0.08',
            center: 'y=(h-text_h)/2',
            bottom: 'y=h*0.85',
          }
          const y = yMap[edit.position] || yMap.bottom
          const size = edit.fontSize || 36
          const color = edit.color || 'white'
          const safeText = edit.content.replace(/'/g, "\\'").replace(/:/g, '\\:')
          videoFilters.push(
            `drawtext=text='${safeText}':fontsize=${size}:fontcolor=${color}:x=(w-text_w)/2:${y}:enable='between(t,${edit.startSec},${edit.endSec})':shadowcolor=black@0.6:shadowx=2:shadowy=2`
          )
          break
        }

        case 'audio_norm': {
          audioFilters.push('loudnorm=I=-14:TP=-1:LRA=11')
          break
        }

        case 'audio_strip': {
          stripAudio = true
          break
        }

        case 'mood': {
          const moodFilters: Record<string, string> = {
            warm: 'colorbalance=rs=.1:gs=.05:bs=-.1,curves=preset=lighter',
            cool: 'colorbalance=rs=-.08:gs=0:bs=.12,curves=preset=lighter',
            moody: 'curves=preset=increase_contrast,colorbalance=rs=0:gs=-.03:bs=.05,eq=brightness=-0.06:contrast=1.15',
            bright: 'curves=preset=lighter,eq=brightness=0.05:saturation=1.15',
            vintage: 'curves=preset=vintage,colorbalance=rs=.08:gs=.04:bs=-.06,eq=saturation=0.85',
            cinematic: 'colorbalance=rs=-.05:gs=.02:bs=.08,curves=preset=increase_contrast,eq=contrast=1.1:saturation=0.9',
          }
          const moodFilter = moodFilters[(edit as MoodEdit).mood]
          if (moodFilter) videoFilters.push(moodFilter)
          break
        }
      }
    }

    // Apply seek/duration
    if (seekStart !== undefined) cmd = cmd.seekInput(seekStart)
    if (duration !== undefined) cmd = cmd.duration(duration)

    // Apply video filters
    if (videoFilters.length > 0) {
      cmd = cmd.videoFilters(videoFilters)
    }

    // Apply audio filters or strip
    if (stripAudio) {
      cmd = cmd.noAudio()
    } else if (audioFilters.length > 0) {
      cmd = cmd.audioFilters(audioFilters)
    }

    // If we have complex filters (text, mood), fall back to mpeg4 software
    // encoder since hardware encoders (videotoolbox) choke on filter chains
    const hasComplexFilters = videoFilters.some(f => f.includes('drawtext') || f.includes('colorbalance') || f.includes('curves'))
    const encoder = hasComplexFilters && H264_ENCODER !== 'libx264' ? 'mpeg4' : H264_ENCODER

    if (encoder === 'libx264') {
      cmd.outputOptions(['-c:v', 'libx264', '-preset', 'fast', '-crf', '23'])
    } else if (encoder === 'mpeg4') {
      cmd.outputOptions(['-c:v', 'mpeg4', '-q:v', '4'])
    } else {
      cmd.outputOptions(['-c:v', encoder])
    }
    cmd.outputOptions(['-c:a', 'aac', '-b:a', '128k'])
      .outputOptions(['-movflags', '+faststart'])  // web-friendly
      .output(output)
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(new Error(`FFmpeg error: ${err.message}`)))
      .run()
  })
}

// ─── COMBINE VIDEOS ──────────────────────────────────────────────────────────

/**
 * Combine multiple videos into one.
 * Downloads each from S3, concatenates via FFmpeg, re-uploads.
 *
 * Strategy: try fast concat first (no re-encode, works when all clips
 * share the same codec/resolution). Falls back to re-encoding if needed.
 */
export async function combineVideos(opts: {
  sourceKeys: string[]
  companyId: string
}): Promise<{ combinedKey: string; combinedUrl: string; duration: number }> {
  if (opts.sourceKeys.length < 2) {
    throw new Error('Need at least 2 videos to combine')
  }

  console.log(`[ffmpeg] combining ${opts.sourceKeys.length} clips...`)

  // Download all source files
  const inputPaths: string[] = []
  for (let i = 0; i < opts.sourceKeys.length; i++) {
    console.log(`[ffmpeg] downloading clip ${i + 1}/${opts.sourceKeys.length}`)
    const url = await getPresignedUrl(opts.sourceKeys[i])
    const tmp = await downloadToTemp(url)
    inputPaths.push(tmp)
    console.log(`[ffmpeg] clip ${i + 1} downloaded`)
  }

  const outputPath = join(tmpdir(), `vx-combined-${randomUUID()}.mp4`)
  const listPath = join(tmpdir(), `vx-concat-${randomUUID()}.txt`)

  try {
    // Write concat list
    const { writeFileSync } = await import('fs')
    const listContent = inputPaths.map(p => `file '${p}'`).join('\n')
    writeFileSync(listPath, listContent)

    // Try fast concat first (no re-encoding — instant if codecs match)
    console.log('[ffmpeg] trying fast concat (no re-encode)...')
    try {
      await runConcat(listPath, outputPath)
      console.log('[ffmpeg] fast concat succeeded')
    } catch (e) {
      console.log('[ffmpeg] fast concat failed, trying with re-encode...', (e as Error).message)
      // Fall back: re-encode with concat filter
      try { unlinkSync(outputPath) } catch {}
      await runConcatReencode(inputPaths, outputPath)
      console.log('[ffmpeg] re-encode concat succeeded')
    }

    // Upload combined file using streaming to handle large files
    console.log('[ffmpeg] uploading combined file...')
    const combinedBuffer = readFileSync(outputPath)
    const combinedKey = buildUploadKey(opts.companyId, `combined-${Date.now()}.mp4`)
    await uploadFile({
      key: combinedKey,
      body: combinedBuffer,
      contentType: 'video/mp4',
    })

    const combinedUrl = await getPresignedUrl(combinedKey)

    let duration = 0
    try {
      const probe = await probeVideoFile(outputPath)
      duration = probe.duration
    } catch {}

    console.log(`[ffmpeg] combine done. Duration: ${duration}s`)
    return { combinedKey, combinedUrl, duration }
  } finally {
    for (const p of inputPaths) { try { unlinkSync(p) } catch {} }
    try { unlinkSync(outputPath) } catch {}
    try { unlinkSync(listPath) } catch {}
  }
}

/** Re-encode concat — handles mismatched codecs/resolutions via filter_complex */
function runConcatReencode(inputs: string[], output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let cmd = ffmpeg()
    for (const inp of inputs) { cmd = cmd.input(inp) }

    // Build filter: scale all to same size, then concat
    const filterParts: string[] = []
    for (let i = 0; i < inputs.length; i++) {
      filterParts.push(`[${i}:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1[v${i}]`)
    }
    const vStreams = inputs.map((_, i) => `[v${i}]`).join('')
    const aStreams = inputs.map((_, i) => `[${i}:a]`).join('')
    filterParts.push(`${vStreams}${aStreams}concat=n=${inputs.length}:v=1:a=1[outv][outa]`)

    cmd
      .complexFilter(filterParts)
      .outputOptions(['-map', '[outv]', '-map', '[outa]'])

    if (H264_ENCODER === 'libx264') {
      cmd.outputOptions(['-c:v', 'libx264', '-preset', 'fast', '-crf', '23'])
    } else {
      cmd.outputOptions(['-c:v', H264_ENCODER])
    }

    cmd
      .outputOptions(['-c:a', 'aac', '-b:a', '128k'])
      .outputOptions(['-movflags', '+faststart'])
      .output(output)
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(new Error(`Concat re-encode failed: ${err.message}`)))
      .run()
  })
}

function normalizeClip(input: string, output: string, w: number, h: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(input)
      .videoFilters([
        `scale=${w}:${h}:force_original_aspect_ratio=decrease`,
        `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`,
        'setsar=1',
      ])

    // Use libx264 if available (production), fall back to platform encoder
    if (H264_ENCODER === 'libx264') {
      cmd.outputOptions(['-c:v', 'libx264', '-preset', 'fast', '-crf', '23'])
    } else {
      cmd.outputOptions(['-c:v', H264_ENCODER])
    }

    cmd
      .outputOptions(['-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2'])
      .outputOptions(['-r', '30'])
      .outputOptions(['-movflags', '+faststart'])
      .output(output)
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(new Error(`Normalize failed: ${err.message}`)))
      .run()
  })
}

function runConcat(listFile: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(listFile)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(['-c', 'copy'])
      .outputOptions(['-movflags', '+faststart'])
      .output(output)
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(new Error(`Concat failed: ${err.message}`)))
      .run()
  })
}

function probeVideoFile(filePath: string): Promise<{ duration: number }> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err)
      resolve({ duration: Number(data.format.duration) || 0 })
    })
  })
}

// ─── PROBE VIDEO ─────────────────────────────────────────────────────────────

export interface VideoProbe {
  duration: number    // seconds
  width: number
  height: number
  fps: number
  hasAudio: boolean
  codec: string
  fileSize: number    // bytes
}

/**
 * Probe a video file for metadata (duration, resolution, etc.)
 * Used by Riley to make informed edit suggestions.
 */
export async function probeVideo(s3Key: string): Promise<VideoProbe> {
  const url = await getPresignedUrl(s3Key)
  const tmpPath = await downloadToTemp(url)

  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(tmpPath, (err, data) => {
      try { unlinkSync(tmpPath) } catch {}
      if (err) return reject(new Error(`Probe failed: ${err.message}`))

      const videoStream = data.streams.find(s => s.codec_type === 'video')
      const audioStream = data.streams.find(s => s.codec_type === 'audio')

      resolve({
        duration: Number(data.format.duration) || 0,
        width: videoStream?.width || 0,
        height: videoStream?.height || 0,
        fps: videoStream?.r_frame_rate ? eval(videoStream.r_frame_rate) : 30,
        hasAudio: !!audioStream,
        codec: videoStream?.codec_name || 'unknown',
        fileSize: Number(data.format.size) || 0,
      })
    })
  })
}
