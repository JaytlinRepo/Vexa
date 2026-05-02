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

    // Download all videos in parallel and stream each to disk so we never
    // hold a multi-hundred-MB arraybuffer per file in memory. Each file
    // emits its own compilation_progress event as it lands so the bar ticks
    // smoothly even with parallel completion.
    const localPaths: string[] = new Array(ordered.length)
    let completedCount = 0
    await Promise.all(
      ordered.map(async (upload, i) => {
        const localPath = path.join(workDir, `part-${String(i).padStart(3, '0')}.mp4`)
        const s3Key = extractS3Key(upload.sourceVideoUrl)
        const url = await getPresignedUrl(s3Key, 3600)
        const resp = await axios.get(url, { responseType: 'stream', timeout: 180000 })
        await new Promise<void>((resolve, reject) => {
          const w = fs.createWriteStream(localPath)
          resp.data.on('error', reject)
          w.on('error', reject)
          w.on('finish', () => resolve())
          resp.data.pipe(w)
        })
        localPaths[i] = localPath

        const sizeMB = (fs.statSync(localPath).size / 1024 / 1024).toFixed(1)
        console.log(`[compilation]   ${i + 1}/${ordered.length}: ${upload.fileName || 'video'} (${sizeMB}MB)`)

        completedCount++
        broadcastProcessingEvent('compilation_progress', {
          compilationId,
          completed: completedCount,
          total: ordered.length,
          fileName: upload.fileName,
        })
      }),
    )

    // ── Probe each input's duration so we can verify the concat result
    //    didn't silently drop any source. The ffmpeg concat demuxer is
    //    notorious for accepting heterogeneous inputs and quietly emitting
    //    a shorter file when codecs/resolutions/audio differ.
    // Probe all inputs in parallel — ffprobe is read-only, no contention.
    const inputDurations: number[] = await Promise.all(localPaths.map(ffprobeDuration))
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
    const normalizedPaths: string[] = new Array(localPaths.length)
    // Stabilization is shelved — `deshake` doubled encode time on iPhone
    // footage AND introduced micro-warping artifacts. Quality of the source
    // is on the creator; we no longer pre-process for shakiness. The
    // measureShakiness probe + deshake filter were removed from the pipeline.
    // Run normalize in parallel with bounded concurrency. Each process is
    // CPU-heavy; on Apple Silicon, h264_videotoolbox is hardware-accelerated
    // and 2-way concurrency keeps the GPU pipeline saturated without
    // thrashing. On x86/libx264 we still benefit because ffmpeg uses one
    // process tree per video.
    const NORMALIZE_CONCURRENCY = 2
    let normalizedCompleted = 0
    const normalizeOne = async (i: number): Promise<void> => {
      const inPath = localPaths[i]
      const outPath = path.join(workDir, `norm-${String(i).padStart(3, '0')}.mp4`)
      // Scale-and-pad to fit 1080x1920 (vertical reel). Order matters:
      //   1. scale long-edge to ≤1920 keeping aspect
      //   2. pad with black to exactly 1080x1920 (centered)
      // -af aresample=async=1 fixes timestamp drift from variable-rate audio.
      // -shortest is NOT used — we want full duration preserved.
      // anullsrc trick handles missing-audio inputs by mixing a silent track.
      const ffArgs = [
        '-y',
        '-i', inPath,
        // Generate silent audio if input has no audio stream — this keeps
        // every normalized file with exactly one video + one audio track.
        '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
        '-filter_complex',
        '[0:v]scale=w=1080:h=1920:force_original_aspect_ratio=decrease,' +
          'pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,fps=30,setsar=1' +
          '[v];' +
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
          '-vf', 'scale=w=1080:h=1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,fps=30,setsar=1',
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
      normalizedPaths[i] = outPath
      normalizedCompleted++
      // Map normalize progress into the combine band (40%-46%) so the bar
      // visibly moves through what used to be a multi-minute silent stretch.
      const pct = 40 + Math.round((normalizedCompleted / localPaths.length) * 6)
      broadcastProcessingEvent('compilation_progress', {
        compilationId,
        completed: localPaths.length, // downloads are done; we're past that
        total: localPaths.length,
        normalizing: true,
        normalizedCount: normalizedCompleted,
        pctHint: pct,
      })
    }
    // Run with a small worker pool — bounded concurrency keeps memory + CPU
    // steady. Promise.all over a chunked list gives us pool-of-N semantics
    // without pulling in a dependency.
    {
      let next = 0
      await Promise.all(
        Array.from({ length: Math.min(NORMALIZE_CONCURRENCY, localPaths.length) }, async () => {
          while (true) {
            const idx = next++
            if (idx >= localPaths.length) return
            await normalizeOne(idx)
          }
        }),
      )
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

    // Upload combined video to S3 by streaming from disk — buffering a
    // multi-hundred-MB compilation into memory served no purpose.
    const s3Key = `studio/clips/${compilation.companyId}/${Date.now()}-combined.mp4`
    await uploadFile({ key: s3Key, body: fs.createReadStream(combinedPath), contentType: 'video/mp4' })
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
    // Tell the connected client the job is dead so the progress bar stops
    // pretending. Sanitize the message so AWS / IAM / 4xx-stack chatter
    // never reaches end users — full error stays in the console.error above.
    const { clientSafeProcessingError } = await import('./clientSafeErrorMessage')
    const safe = clientSafeProcessingError(err)
    broadcastProcessingEvent('processing_error', {
      compilationId,
      code: safe.code,
      error: safe.message,
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
