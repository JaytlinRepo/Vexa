/**
 * Video Compilation Service
 *
 * Simple approach: concatenate all uploaded videos into one file
 * in upload order, then run the standard single-video pipeline.
 * Riley sees the combined footage and edits it as one piece.
 */

import { PrismaClient } from '@prisma/client'
import { execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import axios from 'axios'
import { getPresignedUrl } from '../services/storage/s3.service'
import { uploadFile } from '../services/storage/s3.service'
import VideoProcessingService from './videoProcessing.service'
import { setSourceBoundariesForUpload } from './sourceBoundaries'
// Use the indirected broadcaster so events route through Redis Pub/Sub
// when running inside the worker process. Importing directly from
// routes/video would silently drop events because sseClients lives in
// the API process, not the worker.
import { emitProcessingEvent as broadcastProcessingEvent } from './videoProcessing.service'

const execFileAsync = promisify(execFile)

/**
 * Process a multi-video compilation:
 * 1. Download all videos
 * 2. Concatenate into one file (in upload order)
 * 3. Upload combined file to S3
 * 4. Run the standard single-video pipeline on it
 */
export async function processCompilation(
  prisma: PrismaClient,
  compilationId: string,
): Promise<void> {
  const compilation = await prisma.videoCompilation.findUnique({
    where: { id: compilationId },
  })
  if (!compilation) throw new Error('Compilation not found')

  await prisma.videoCompilation.update({
    where: { id: compilationId },
    data: { status: 'processing' },
  })

  const workDir = path.join(os.tmpdir(), `sovexa-compile-${compilationId}`)

  try {
    fs.mkdirSync(workDir, { recursive: true })

    // Load all uploads in order
    const uploads = await prisma.videoUpload.findMany({
      where: { id: { in: compilation.uploadIds } },
    })

    // Sort by the order they appear in uploadIds (upload order)
    const ordered = compilation.uploadIds
      .map((id) => uploads.find((u) => u.id === id))
      .filter(Boolean) as typeof uploads

    if (ordered.length === 0) throw new Error('No uploads found')

    console.log(`[compilation] Downloading ${ordered.length} videos...`)
    // SSE: tell the frontend the combine phase is starting so the progress
    // bar advances out of the upload phase.
    broadcastProcessingEvent('compilation_progress', {
      compilationId,
      completed: 0,
      total: ordered.length,
    })

    // Download each video
    const localPaths: string[] = []
    for (let i = 0; i < ordered.length; i++) {
      const upload = ordered[i]
      const localPath = path.join(workDir, `part-${String(i).padStart(3, '0')}.mp4`)

      // Get fresh presigned URL
      const s3Key = extractS3Key(upload.sourceVideoUrl)
      const url = await getPresignedUrl(s3Key, 3600)

      const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 180000 })
      fs.writeFileSync(localPath, Buffer.from(resp.data))
      localPaths.push(localPath)

      const sizeMB = (resp.data.byteLength / 1024 / 1024).toFixed(1)
      console.log(`[compilation]   ${i + 1}/${ordered.length}: ${upload.fileName || 'video'} (${sizeMB}MB)`)

      // Per-file progress event so the frontend can tick the percentage
      broadcastProcessingEvent('compilation_progress', {
        compilationId,
        completed: i + 1,
        total: ordered.length,
        fileName: upload.fileName,
      })
    }

    // ── Probe each input's duration so we can verify the concat result
    //    didn't silently drop any source. The ffmpeg concat demuxer is
    //    notorious for accepting heterogeneous inputs and quietly emitting
    //    a shorter file when codecs/resolutions/audio differ.
    const inputDurations: number[] = []
    for (const p of localPaths) {
      const dur = await ffprobeDuration(p)
      inputDurations.push(dur)
    }
    const totalInputDuration = inputDurations.reduce((a, b) => a + b, 0)
    console.log(
      `[compilation] Input durations (s): ${inputDurations.map((d) => d.toFixed(1)).join(' + ')} = ${totalInputDuration.toFixed(1)}s`,
    )

    const codec = process.env.VEXA_VIDEO_CODEC
      || (process.platform === 'darwin' ? 'h264_videotoolbox' : 'libx264')
    const codecExtra = codec === 'libx264'
      ? ['-preset', 'veryfast', '-crf', '23']
      : ['-b:v', '8M']

    // ── Phase 1: normalize each input to a common format. The concat
    //    demuxer requires identical codecs / framerate / pixel format /
    //    audio config across inputs. iPhone footage mixes 30/60fps,
    //    1080p/4K, ProRes/H.264, and some clips may have no audio at all.
    //    Re-encode each to 1080p / 30fps / yuv420p / aac stereo 48kHz so
    //    the demuxer stage is bulletproof.
    console.log(`[compilation] Normalizing ${ordered.length} inputs to 1080p/30fps/aac...`)
    const normalizedPaths: string[] = []
    // Detect per-clip shakiness so we only apply stabilization where it
    // actually helps. Running deshake on already-steady footage costs
    // sharpness and adds the risk of micro-warping artifacts.
    const shakiness: number[] = []
    for (let i = 0; i < localPaths.length; i++) {
      const score = await measureShakiness(localPaths[i])
      shakiness.push(score)
    }
    const SHAKE_THRESHOLD = 0.012 // empirical: handheld iPhone walking ≈ 0.015–0.05; tripod < 0.005
    console.log(`[compilation] Shakiness scores: ${shakiness.map((s, i) => `${ordered[i].fileName?.slice(0, 16)}=${s.toFixed(3)}${s > SHAKE_THRESHOLD ? '*' : ''}`).join(', ')} (* = will stabilize)`)
    for (let i = 0; i < localPaths.length; i++) {
      const inPath = localPaths[i]
      const outPath = path.join(workDir, `norm-${String(i).padStart(3, '0')}.mp4`)
      // Scale-and-pad to fit 1080x1920 (vertical reel). Order matters:
      //   1. scale long-edge to ≤1920 keeping aspect
      //   2. pad with black to exactly 1080x1920 (centered)
      // -af aresample=async=1 fixes timestamp drift from variable-rate audio.
      // -shortest is NOT used — we want full duration preserved.
      // anullsrc trick handles missing-audio inputs by mixing a silent track.
      // Conditional stabilization: only deshake clips above threshold.
      // edge=mirror hides the cropped border. rx/ry must be multiples of 16.
      const stabilize = shakiness[i] > SHAKE_THRESHOLD
      const stabilizationFilter = stabilize ? ',deshake=rx=16:ry=16:edge=mirror' : ''
      const ffArgs = [
        '-y',
        '-i', inPath,
        // Generate silent audio if input has no audio stream — this keeps
        // every normalized file with exactly one video + one audio track.
        '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
        '-filter_complex',
        '[0:v]scale=w=1080:h=1920:force_original_aspect_ratio=decrease,' +
          'pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,fps=30,setsar=1' +
          stabilizationFilter + '[v];' +
          '[0:a?]aresample=async=1[a0];' +
          '[a0][1:a]amix=inputs=2:duration=first:dropout_transition=0[a]',
        '-map', '[v]',
        '-map', '[a]',
        '-c:v', codec, ...codecExtra,
        '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        outPath,
      ]
      try {
        await execFileAsync('ffmpeg', ffArgs, { timeout: 300000, maxBuffer: 1024 * 1024 * 8 })
      } catch (e: any) {
        // Some inputs simply don't have an audio stream — the [0:a?]
        // optional-input syntax above handles that with anullsrc, but if
        // ffmpeg still fails (e.g. unsupported codec), fall back to a
        // video-only normalize and we'll add silent audio in a separate pass.
        console.warn(`[compilation] normalize with audio mix failed for input ${i}, retrying video-only:`, e?.message?.slice(0, 200))
        await execFileAsync('ffmpeg', [
          '-y',
          '-i', inPath,
          '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
          '-shortest',
          '-vf', 'scale=w=1080:h=1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,fps=30,setsar=1' + (stabilize ? ',deshake=rx=16:ry=16:edge=mirror' : ''),
          '-map', '0:v:0',
          '-map', '1:a:0',
          '-c:v', codec, ...codecExtra,
          '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
          '-pix_fmt', 'yuv420p',
          '-movflags', '+faststart',
          outPath,
        ], { timeout: 300000, maxBuffer: 1024 * 1024 * 8 })
      }
      const normDur = await ffprobeDuration(outPath)
      console.log(
        `[compilation]   norm ${i + 1}/${ordered.length}: ${inputDurations[i].toFixed(1)}s → ${normDur.toFixed(1)}s`,
      )
      normalizedPaths.push(outPath)
    }

    // ── Phase 2: stream-copy concat. With identical inputs the concat
    //    demuxer can copy streams without re-encoding — fast and
    //    guaranteed to preserve every frame from every input.
    const concatPath = path.join(workDir, 'concat.txt')
    const concatContent = normalizedPaths.map((p) => `file '${p}'`).join('\n')
    fs.writeFileSync(concatPath, concatContent)

    const combinedPath = path.join(workDir, 'combined.mp4')
    console.log(`[compilation] Concatenating ${ordered.length} normalized clips...`)
    await execFileAsync('ffmpeg', [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatPath,
      '-c', 'copy',
      '-movflags', '+faststart',
      combinedPath,
    ], { timeout: 600000, maxBuffer: 1024 * 1024 * 8 })

    const combinedSize = (fs.statSync(combinedPath).size / 1024 / 1024).toFixed(1)
    const combinedDuration = await ffprobeDuration(combinedPath)
    const drift = combinedDuration - totalInputDuration
    console.log(
      `[compilation] Combined: ${combinedSize}MB, ${combinedDuration.toFixed(1)}s ` +
        `(expected ~${totalInputDuration.toFixed(1)}s, drift ${drift >= 0 ? '+' : ''}${drift.toFixed(2)}s)`,
    )
    // Hard fail if we lost more than 2 seconds of content — better to
    // surface the bug than ship a silently-truncated reel.
    if (Math.abs(drift) > 2.0) {
      throw new Error(
        `concat duration drift too large: combined=${combinedDuration.toFixed(1)}s vs input=${totalInputDuration.toFixed(1)}s`,
      )
    }

    // Upload combined video to S3
    const combinedBuffer = fs.readFileSync(combinedPath)
    const s3Key = `studio/clips/${compilation.companyId}/${Date.now()}-combined.mp4`
    await uploadFile({ key: s3Key, body: combinedBuffer, contentType: 'video/mp4' })
    const combinedUrl = await getPresignedUrl(s3Key, 86400)

    console.log(`[compilation] Uploaded combined video to S3`)

    // Create a VideoUpload record for the combined file
    const combinedUpload = await prisma.videoUpload.create({
      data: {
        companyId: compilation.companyId,
        sourceVideoUrl: combinedUrl,
        fileName: `compilation-${ordered.length}-videos.mp4`,
      },
    })

    // Tell the frontend the combine phase is done and hand it the new
    // uploadId so it can subscribe to Riley's edit-stage events.
    broadcastProcessingEvent('compilation_complete', {
      compilationId,
      uploadId: combinedUpload.id,
      combinedSizeMB: combinedSize,
    })

    // Stash source boundaries on the combined-timeline so Riley's
    // segment-picker can enforce per-source diversity. The processVideo
    // call below runs in the same process, so an in-memory map is fine.
    // Boundaries are cumulative offsets: e.g. inputs of [5.9, 7.3, 23.5]
    // become [{start: 0, end: 5.9}, {start: 5.9, end: 13.2}, {start: 13.2, end: 36.7}].
    const sourceBoundaries: { start: number; end: number; fileName: string }[] = []
    let offset = 0
    for (let i = 0; i < ordered.length; i++) {
      const dur = inputDurations[i]
      sourceBoundaries.push({
        start: offset,
        end: offset + dur,
        fileName: ordered[i].fileName ?? `clip-${i + 1}`,
      })
      offset += dur
    }
    setSourceBoundariesForUpload(combinedUpload.id, sourceBoundaries)

    // Get the user ID for processing
    const company = await prisma.company.findUnique({
      where: { id: compilation.companyId },
      select: { userId: true },
    })
    if (!company) throw new Error('Company not found')

    // Run the standard single-video pipeline on the combined file
    console.log(`[compilation] Running Riley on combined ${combinedSize}MB video...`)
    const svc = new VideoProcessingService(prisma)
    await svc.processVideo(combinedUpload.id, combinedUrl, company.userId)

    // Update compilation status
    await prisma.videoCompilation.update({
      where: { id: compilationId },
      data: { status: 'complete', clipId: combinedUpload.id },
    })

    console.log(`[compilation] Complete — ${ordered.length} videos → 1 reel`)
  } catch (err) {
    console.error(`[compilation] Failed:`, (err as Error).message)
    await prisma.videoCompilation.update({
      where: { id: compilationId },
      data: { status: 'failed', error: (err as Error).message },
    })
    throw err
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }) } catch {}
  }
}

/**
 * Estimate how shaky a video is by sampling frame-to-frame motion.
 * Returns the average mafd (mean absolute frame difference, normalized
 * 0-1) over a downsampled pass. Higher values = more motion = more shake.
 *
 * Reference points from real iPhone footage:
 *   tripod / steady establishing shot:  ~0.003-0.008
 *   handheld + light movement:          ~0.010-0.015  ← borderline
 *   handheld + walking / panning:       ~0.020-0.050
 *   running / fast action:              ~0.060+
 *
 * The actual stabilization threshold is set by the caller; this just
 * gives them a number to compare against.
 *
 * Implementation: ffmpeg's `signalstats` filter prints `lavfi.signalstats.YDIF`
 * (luma frame difference) for each frame. We average across the clip after
 * downscaling to 240p (cheap pass) and skipping the first/last frames.
 */
async function measureShakiness(filePath: string): Promise<number> {
  try {
    const { stderr } = await execFileAsync(
      'ffmpeg',
      [
        '-nostats',
        '-i', filePath,
        '-vf', 'fps=4,scale=240:-1,signalstats,metadata=print:key=lavfi.signalstats.YDIF',
        '-f', 'null',
        '-',
      ],
      { timeout: 60000, maxBuffer: 1024 * 1024 * 8 },
    )
    const matches = stderr.match(/lavfi\.signalstats\.YDIF=[\d.]+/g) || []
    if (matches.length < 3) return 0
    const values = matches
      .map((m) => parseFloat(m.split('=')[1]))
      .filter((v) => Number.isFinite(v))
    if (values.length < 3) return 0
    // Drop first and last frame (often anomalous) and average the rest.
    // Normalize by max-luma 255 → 0-1 range.
    const trimmed = values.slice(1, -1)
    const avg = trimmed.reduce((a, b) => a + b, 0) / trimmed.length
    return avg / 255
  } catch (e: any) {
    // If shake-measurement fails (corrupted clip, etc), fall back to
    // assuming "needs stabilization" — safer than skipping it.
    console.warn(`[compilation] shakiness measurement failed for ${path.basename(filePath)}: ${e?.message?.slice(0, 100)}`)
    return 0.02
  }
}

async function ffprobeDuration(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync(
    'ffprobe',
    [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ],
    { timeout: 30000 },
  )
  const dur = parseFloat(stdout.trim())
  return Number.isFinite(dur) ? dur : 0
}

function extractS3Key(url: string): string {
  if (url.startsWith('s3://')) return url.replace('s3://', '')
  // Extract key from presigned URL
  try {
    const u = new URL(url)
    return u.pathname.slice(1) // remove leading /
  } catch {
    return url
  }
}
