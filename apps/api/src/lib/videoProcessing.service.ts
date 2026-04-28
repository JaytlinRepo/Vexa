/**
 * Video Processing Orchestration
 * Flow: S3 upload → AWS Transcribe → Riley (Bedrock) picks clip → FFmpeg cuts → Alex (Bedrock) writes captions
 *
 * No external video APIs. Everything runs on AWS + local FFmpeg.
 * Typical processing time: 30-60 seconds for a 5-minute video.
 */

import { PrismaClient } from '@prisma/client'
import { EventEmitter } from 'events'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { transcribeVideo, TranscriptionResult } from './transcribe.service'
import { analyzeAndPickClip } from './clipAnalyzer.service'
import { buildReel } from './ffmpegClipper.service'
import { detectScenes, SceneAnalysis } from './sceneDetection.service'
import { extractKeyframes, extractFramesAt } from './keyframeExtractor.service'
import { buildMotionCurve, smoothCurve } from './motionCurve.service'
import { buildAudioEnergyCurve } from './audioEnergy.service'
import { buildQualityCurve, HARD_EXCLUDE_THRESHOLD } from './qualityCurve.service'
import { detectBeats } from './beatDetector.service'
import { classifySubjects, type SubjectKind } from './subjectClassifier.service'

// Local alias for span.subjectKind values
type ActionSpanSubject = SubjectKind
import StudioCopywritingService from './studioCopywriting.service'
import { getPresignedUrl } from '../services/storage/s3.service'
import { broadcastProcessingEvent as _defaultBroadcast } from '../routes/video'

// Allow workers to override the broadcast function (for Redis Pub/Sub relay)
let _broadcastFn: (event: string, data: unknown) => void = _defaultBroadcast
export function setBroadcastFn(fn: (event: string, data: unknown) => void): void {
  _broadcastFn = fn
}
function broadcastProcessingEvent(event: string, data: unknown): void {
  _broadcastFn(event, data)
}

export interface ProcessingStage {
  name: string
  startTime: number
  endTime: number
}

export class VideoProcessingService extends EventEmitter {
  private copywriting: StudioCopywritingService
  private processingStages: ProcessingStage[] = []

  constructor(private prisma: PrismaClient) {
    super()
    this.copywriting = new StudioCopywritingService(prisma)
  }

  /**
   * Main video processing workflow
   */
  async processVideo(uploadId: string, videoUrl: string, userId: string) {
    // Hoist this so the `finally` block (line ~271) can clean up the temp
    // file. Previously declared inside the try, which made it out of scope
    // in finally — fs.unlinkSync threw ReferenceError silently and every
    // run leaked a multi-MB temp file.
    const localVideoPath = path.join(os.tmpdir(), `sovexa-source-${uploadId}.mp4`)
    try {
      console.log(`[video] Starting processing for ${uploadId}`)
      this.processingStages = []
      this.currentUploadId = uploadId

      broadcastProcessingEvent('processing_start', { uploadId })

      // Get company
      const company = await this.prisma.company.findFirst({
        where: { user: { id: userId } },
      })
      if (!company) throw new Error('Company not found')

      // Get the S3 key from the upload record
      const upload = await this.prisma.videoUpload.findUnique({
        where: { id: uploadId },
      })
      if (!upload) throw new Error('Upload not found')

      // Idempotency: if a clip already exists for this upload (worker retry, double
      // dispatch from queue + HTTP path, etc.), short-circuit instead of producing
      // a duplicate. uploadId has a non-unique index today; we still rely on the
      // app-layer check here. Add `@@unique([uploadId])` in a future migration.
      const existingClip = await this.prisma.videoClip.findFirst({
        where: { uploadId },
        orderBy: { createdAt: 'desc' },
      })
      if (existingClip) {
        console.log(`[video] Clip already exists for upload ${uploadId} (${existingClip.id}) — skipping reprocess.`)
        broadcastProcessingEvent('processing_complete', {
          uploadId,
          clipId: existingClip.id,
          duration: existingClip.duration,
          hook: existingClip.hook,
          progress: 100,
          alreadyProcessed: true,
        })
        this.emit('complete', {
          uploadId,
          clipId: existingClip.id,
          s3Key: existingClip.clippedUrl.replace(/^s3:\/\//, ''),
          duration: existingClip.duration,
          hook: existingClip.hook,
        })
        return { videoClip: existingClip }
      }

      // Extract S3 key from the presigned URL
      const s3Key = this.extractS3Key(upload.sourceVideoUrl)

      // ── 1. Download source video ONCE ──────────────────────────────
      // The video was being downloaded 4 times (probe, scenes, keyframes, render).
      // Now we download once and reuse the local file for all stages.
      const videoDuration = await this.stage('Download + probe', async () => {
        const freshUrl = await getPresignedUrl(s3Key, 3600)
        const axios = (await import('axios')).default
        const resp = await axios.get(freshUrl, { responseType: 'arraybuffer', timeout: 180000 })
        fs.writeFileSync(localVideoPath, Buffer.from(resp.data))
        const sizeMB = (resp.data.byteLength / 1024 / 1024).toFixed(1)
        console.log(`[video] Downloaded ${sizeMB}MB to ${localVideoPath}`)

        // Probe duration from local file (instant — no network)
        const { getVideoDuration } = await import('./ffmpegClipper.service')
        const dur = await getVideoDuration(localVideoPath)
        console.log(`[video] Duration: ${dur}s`)
        return dur
      })

      // Update upload with duration
      await this.prisma.videoUpload.update({
        where: { id: uploadId },
        data: { duration: Math.round(videoDuration) },
      })

      // ── 2. Parallel analysis using LOCAL file (no re-downloads) ────
      broadcastProcessingEvent('stage_start', { uploadId, stage: 'Analyze video', progress: 25 })
      const analysisStart = Date.now()

      // Load creator profile (fast DB query)
      let creatorProfile: { style: Record<string, unknown> | null; retention: Record<string, unknown> | null } | null = null
      let creatorFilters: import('./ffmpegFilterBuilder').CreatorFilters | null = null

      const profilePromise = (async () => {
        try {
          const { getStyleProfile } = await import('../services/videoStyleAnalyzer.service')
          const { getRetentionProfile } = await import('../services/intelligence/retentionIntelligence')
          const { buildCreatorFilters } = await import('./ffmpegFilterBuilder')
          const [styleProfile, retentionProfile] = await Promise.all([
            getStyleProfile(company.id),
            getRetentionProfile(this.prisma, company.id),
          ])
          if (styleProfile || retentionProfile) {
            creatorProfile = { style: styleProfile as any, retention: retentionProfile as any }
            creatorFilters = buildCreatorFilters(styleProfile, retentionProfile, videoDuration)
            console.log(`[video] Creator profile loaded: ${creatorFilters.targetDuration}s target, ${creatorFilters.maxSegments} max segments`)
          }
        } catch (err) {
          console.warn('[video] Could not load creator profile:', (err as Error).message)
        }
      })()

      // Frame extraction scales with duration — more frames for longer videos
      // Target: ~1 frame per 5s for short videos, ~1 per 8s for long ones
      // Max frames scales too: 15 for ≤60s, up to 30 for longer compilations
      const maxFrames = Math.min(30, Math.max(15, Math.ceil(videoDuration / 8)))
      const frameInterval = Math.max(2, Math.ceil(videoDuration / maxFrames))
      console.log(`[video] Frame strategy: ${maxFrames} frames at ${frameInterval}s intervals for ${videoDuration.toFixed(0)}s video`)

      const [transcript, sceneData, baseFrames, motionResult, audioResult] = await Promise.all([
        transcribeVideo(s3Key).then((result) => {
          console.log(`[video] Transcript: ${result.hasSpeech ? result.words.length + ' words' : 'no speech detected'}`)
          return result
        }),

        detectScenes(localVideoPath, videoDuration).then((scenes) => {
          console.log(`[video] Scenes: ${scenes.totalScenes} detected, ${scenes.highMotionSegments} high-motion`)
          return scenes
        }).catch(() => undefined),

        extractKeyframes(localVideoPath, videoDuration, frameInterval, maxFrames).then((extracted) => {
          console.log(`[video] Keyframes (uniform): ${extracted.length} frames extracted (interval: ${frameInterval}s)`)
          return extracted
        }),

        // New: per-second motion curve for action / rest / beat detection.
        buildMotionCurve(localVideoPath, videoDuration).catch((err) => {
          console.warn('[video] Motion curve failed — beat detection disabled:', (err as Error).message)
          return null
        }),

        // New: audio energy curve for sub-peak detection inside actions.
        buildAudioEnergyCurve(localVideoPath, videoDuration).catch((err) => {
          console.warn('[video] Audio curve failed — audio anomaly beats disabled:', (err as Error).message)
          return null
        }),
      ])

      await profilePromise

      // ── 2b. Quality assessment (sequential — needs the motion curve) ─────
      // Detects shake, blur, and frozen frames. Bad windows get masked so
      // Riley never sees beats inside garbage footage.
      let qualityResult: Awaited<ReturnType<typeof buildQualityCurve>> | null = null
      if (motionResult) {
        try {
          qualityResult = await buildQualityCurve(localVideoPath, videoDuration, motionResult.curve)
        } catch (err) {
          console.warn('[video] Quality curve failed — proceeding without quality filtering:', (err as Error).message)
        }
      }

      // ── 2c. Detect beats and pull extra keyframes targeted at action peaks ──
      // The uniform extractor gives Riley general coverage; the beat extractor
      // adds dense visual context exactly where decisions matter (start/end of
      // each action + motion sub-peaks + audio anomalies).
      let beatAnalysis: ReturnType<typeof detectBeats> | null = null
      let beatFrames: typeof baseFrames = []
      if (motionResult) {
        const smoothed = smoothCurve(motionResult.curve, 3)
        const sceneCuts = sceneData?.cutTimestamps ?? []
        beatAnalysis = detectBeats(smoothed, audioResult?.curve || [], videoDuration, sceneCuts)

        // Suppress actions/beats that fall entirely inside bad-quality windows
        // (HARD severity). Soft windows are kept but Riley will be told.
        if (qualityResult && qualityResult.badWindows.length > 0) {
          const hardBad = qualityResult.badWindows.filter((w) => w.severity >= 0.6)
          if (hardBad.length > 0) {
            const beforeActions = beatAnalysis.actions.length
            beatAnalysis.actions = beatAnalysis.actions.filter((a) => {
              const overlapsHard = hardBad.some((w) => a.startTime >= w.startTime && a.endTime <= w.endTime)
              return !overlapsHard
            })
            // Drop individual beats inside hard-bad windows
            beatAnalysis.actions = beatAnalysis.actions.map((a) => ({
              ...a,
              beats: a.beats.filter((b) => !hardBad.some((w) => b.time >= w.startTime && b.time <= w.endTime)),
            }))
            const dropped = beforeActions - beatAnalysis.actions.length
            if (dropped > 0) console.log(`[video] Quality filter dropped ${dropped} action(s) inside hard-bad windows`)
          }
        }

        // Pull a frame at every beat we found (up to a budget — Bedrock caps at
        // 100 images/request; we already use up to 30 from baseFrames).
        const beatTimes = beatAnalysis.actions.flatMap((a) => a.beats.map((b) => b.time))
        const BUDGET = 30
        const limited = beatTimes.length > BUDGET
          ? beatTimes.filter((_, i) => i % Math.ceil(beatTimes.length / BUDGET) === 0)
          : beatTimes
        if (limited.length > 0) {
          try {
            beatFrames = await extractFramesAt(localVideoPath, limited)
          } catch (err) {
            console.warn('[video] Beat-targeted extraction failed — using uniform frames only:', (err as Error).message)
          }
        }
      }

      // Merge base + beat frames, dedupe, sort by timestamp.
      const allFrames = [...baseFrames, ...beatFrames]
        .filter((f, i, arr) => arr.findIndex((g) => Math.abs(g.timestamp - f.timestamp) < 0.4) === i)
        .sort((a, b) => a.timestamp - b.timestamp)
        .map((f, i) => ({ ...f, index: i }))
      const frames = allFrames

      // ── 2d. Per-frame subject classification + span aggregation ──────────
      // Per-frame classification means a 24s span that has a real-person
      // intro AND a screen pan in the middle gets correctly identified as
      // MIXED, and we split it at the transition point. Sequential calls
      // with throttle-aware retry to avoid Bedrock 429s.
      if (beatAnalysis && beatAnalysis.actions.length > 0) {
        try {
          const verdicts = await classifySubjects(beatAnalysis.actions, frames, company.id)

          // First pass: split MIXED spans at the screen/real-person boundary
          const splitActions: typeof beatAnalysis.actions = []
          beatAnalysis.actions.forEach((a, i) => {
            const v = verdicts[i]
            if (!v || !v.mixed || !v.splitAt || v.splitAt <= a.startTime + 0.5 || v.splitAt >= a.endTime - 0.5) {
              a.subjectKind = v?.subject || 'unknown'
              splitActions.push(a)
              return
            }
            // Determine which side gets which subject by looking at frame
            // verdicts on each side of the split.
            const leftFrames = v.frameVerdicts.filter((fv) => fv.frameTimestamp < v.splitAt!)
            const rightFrames = v.frameVerdicts.filter((fv) => fv.frameTimestamp >= v.splitAt!)
            const dominantOf = (fs: typeof v.frameVerdicts) => {
              const tally: Record<string, number> = {}
              for (const f of fs) tally[f.subject] = (tally[f.subject] || 0) + Math.max(0.1, f.confidence)
              return Object.entries(tally).sort((x, y) => y[1] - x[1])[0]?.[0] as typeof v.subject || 'unknown'
            }
            const leftSubject = dominantOf(leftFrames) as ActionSpanSubject
            const rightSubject = dominantOf(rightFrames) as ActionSpanSubject
            const mkSubAction = (start: number, end: number, subject: ActionSpanSubject) => {
              const dur = end - start
              return {
                startTime: start,
                endTime: end,
                duration: dur,
                durationClass: (dur <= 3 ? 'short' : dur <= 5.5 ? 'medium' : 'long') as typeof a.durationClass,
                peakMotion: a.peakMotion,
                meanMotion: a.meanMotion,
                hasAudioAnomaly: a.hasAudioAnomaly,
                subjectKind: subject,
                beats: a.beats.filter((b) => b.time >= start && b.time <= end),
              }
            }
            // Ensure each side has at least its own boundary beats
            const left = mkSubAction(a.startTime, v.splitAt, leftSubject)
            if (left.beats.length === 0) {
              left.beats.push(
                { time: left.startTime, kind: 'start', strength: 1.0, suggestedWidth: 1.6, required: true },
                { time: left.endTime, kind: 'end', strength: 1.0, suggestedWidth: 1.6, required: true },
              )
            }
            const right = mkSubAction(v.splitAt, a.endTime, rightSubject)
            if (right.beats.length === 0) {
              right.beats.push(
                { time: right.startTime, kind: 'start', strength: 1.0, suggestedWidth: 1.6, required: true },
                { time: right.endTime, kind: 'end', strength: 1.0, suggestedWidth: 1.6, required: true },
              )
            }
            splitActions.push(left, right)
            console.log(`[video] split MIXED action [${a.startTime.toFixed(1)}-${a.endTime.toFixed(1)}s] at ${v.splitAt.toFixed(1)}s into ${leftSubject} + ${rightSubject}`)
          })
          beatAnalysis.actions = splitActions

          // Second pass: split SCREEN actions ≥ 4s into 2.5s chunks
          const SCREEN_CHUNK = 2.5
          const SCREEN_SPLIT_AT = 4.0
          const refined: typeof beatAnalysis.actions = []
          for (const a of beatAnalysis.actions) {
            if (a.subjectKind !== 'screen' || a.duration < SCREEN_SPLIT_AT) {
              refined.push(a)
              continue
            }
            const nChunks = Math.max(2, Math.round(a.duration / SCREEN_CHUNK))
            const chunkDur = a.duration / nChunks
            for (let i = 0; i < nChunks; i++) {
              const sStart = a.startTime + i * chunkDur
              const sEnd = a.startTime + (i + 1) * chunkDur
              refined.push({
                startTime: sStart,
                endTime: sEnd,
                duration: chunkDur,
                durationClass: chunkDur <= 3 ? 'short' : chunkDur <= 5.5 ? 'medium' : 'long',
                peakMotion: a.peakMotion,
                meanMotion: a.meanMotion,
                hasAudioAnomaly: a.hasAudioAnomaly,
                subjectKind: 'screen',
                beats: [
                  { time: sStart, kind: 'start', strength: 1.0, suggestedWidth: chunkDur, required: true },
                  { time: sEnd, kind: 'end', strength: 1.0, suggestedWidth: chunkDur, required: true },
                ],
              })
            }
            console.log(`[video] split screen action [${a.startTime.toFixed(1)}-${a.endTime.toFixed(1)}s] into ${nChunks} chunks of ~${chunkDur.toFixed(1)}s`)
          }
          beatAnalysis.actions = refined

          // Rebuild rest points to include all the new chunk/split boundaries
          const restSet = new Set(beatAnalysis.restPoints.map((t) => Math.round(t * 10) / 10))
          for (const a of beatAnalysis.actions) {
            restSet.add(Math.round(a.startTime * 10) / 10)
            restSet.add(Math.round(a.endTime * 10) / 10)
          }
          beatAnalysis.restPoints = [...restSet].sort((x, y) => x - y)
        } catch (err) {
          console.warn('[video] Subject classification failed — proceeding with default rules:', (err as Error).message)
        }
      }

      const analysisTime = ((Date.now() - analysisStart) / 1000).toFixed(1)
      console.log(`[video] Parallel analysis complete in ${analysisTime}s — ${frames.length} frames (uniform: ${baseFrames.length}, beat-targeted: ${beatFrames.length})${beatAnalysis ? `, ${beatAnalysis.actions.length} actions` : ''}`)
      broadcastProcessingEvent('stage_done', { uploadId, stage: 'Analyze video', progress: 55 })

      // ── 3. Riley picks the best segments (with VISION + creator profile) ──
      // creatorFilters is assigned inside an IIFE closure (line ~118) so TS
      // narrows the outer let to `null`. Cast back to its declared union to
      // restore optional-chaining behavior.
      const cf = creatorFilters as import('./ffmpegFilterBuilder').CreatorFilters | null
      const targetDuration = cf?.targetDuration || 60
      const clipDecision = await this.stage('Analyze clip (Riley)', async () => {
        const decision = await analyzeAndPickClip(
          transcript,
          videoDuration,
          targetDuration,
          company.id,
          sceneData,
          frames,
          this.prisma,
          creatorProfile,
          beatAnalysis || undefined,
          qualityResult?.badWindows,
          audioResult?.curve,
        )
        console.log(`[video] Riley picked ${decision.segments.length} segments, ${decision.totalDuration.toFixed(1)}s total — hook: "${decision.hook}"`)
        return decision
      })

      // ── 4. FFmpeg builds the reel from LOCAL file (no re-download) ──
      const clipResult = await this.stage('Build reel (FFmpeg)', async () => {
        return buildReel({
          sourceUrl: localVideoPath,
          segments: clipDecision.segments,
          companyId: company.id,
          uploadId,
          creatorFilters,
          localSource: true,
        })
      })

      console.log(`[video] Reel saved to S3: ${clipResult.s3Key} (${clipResult.segmentCount} cuts, ${clipResult.duration}s)`)

      // ── 5. Alex writes captions using Riley's visual descriptions ──
      const visualDescription = clipDecision.segments
        .map(s => `[${s.energy}] ${s.label}`)
        .join(' → ')
      const fullDescription = `${clipDecision.hook}\n\nVisual sequence: ${visualDescription}\n\nRiley's rationale: ${clipDecision.rationale}`

      const copyResult = await this.stage('Write captions (Alex)', async () => {
        return this.copywriting.generateCopyOptions({
          companyId: company.id,
          contentType: 'video',
          contentDescription: fullDescription,
          clipTranscript: clipDecision.transcript,
        })
      })

      const captionOptions = [
        ...copyResult.hooks.map(h => ({ ...h, type: 'hook' as const })),
        ...copyResult.captions.map(c => ({ ...c, type: 'caption' as const })),
      ]

      // ── 6. Save clip to database ────────────────────────────────────
      const videoClip = await this.prisma.videoClip.create({
        data: {
          uploadId,
          companyId: company.id,
          clippedUrl: `s3://${clipResult.s3Key}`,
          duration: Math.round(clipResult.duration),
          hook: clipDecision.hook || captionOptions[0]?.text || '',
          captionOptions,
          status: 'draft',
          visualApprovalStatus: 'pending',
          copyApprovalStatus: 'pending',
          processedWith: 'transcribe_riley_ffmpeg',
          adjustments: {
            version: 1,
            segments: clipDecision.segments as any,
            rationale: clipDecision.rationale,
            lengthTier: clipDecision.lengthTier,
          } as any,
          styleMetrics: {
            hasSpeech: transcript.hasSpeech,
            wordCount: transcript.words.length,
            clipDuration: clipResult.duration,
            segmentCount: clipResult.segmentCount,
          },
        },
      })

      // ── 7. Log timing ──────────────────────────────────────────────
      const totalTime = this.processingStages.reduce((sum, s) => sum + (s.endTime - s.startTime), 0)
      console.log(`[video] Processing complete: ${videoClip.id} (${(totalTime / 1000).toFixed(1)}s total)`)
      this.processingStages.forEach(s => {
        console.log(`  ${s.name}: ${((s.endTime - s.startTime) / 1000).toFixed(1)}s`)
      })

      // ── 8. Broadcast + emit completion ─────────────────────────────
      broadcastProcessingEvent('processing_complete', {
        uploadId,
        clipId: videoClip.id,
        duration: videoClip.duration,
        hook: videoClip.hook,
        progress: 100,
      })

      this.emit('complete', {
        uploadId,
        clipId: videoClip.id,
        s3Key: clipResult.s3Key,
        duration: videoClip.duration,
        hook: videoClip.hook,
      })

      return { videoClip }
    } catch (err) {
      console.error(`[video] Processing failed:`, err)
      broadcastProcessingEvent('processing_error', {
        uploadId,
        error: err instanceof Error ? err.message : 'Unknown error',
      })
      this.emit('error', {
        uploadId,
        error: err instanceof Error ? err.message : 'Unknown error',
      })
      throw err
    } finally {
      // Cleanup temp source file
      try { fs.unlinkSync(localVideoPath) } catch {}
    }
  }

  /**
   * Extract the S3 key from a presigned URL or s3:// URI.
   */
  private extractS3Key(url: string): string {
    if (url.startsWith('s3://')) return url.replace('s3://', '')
    // Parse presigned URL: https://bucket.s3.region.amazonaws.com/KEY?params
    const match = url.match(/\.amazonaws\.com\/([^?]+)/)
    if (match) return decodeURIComponent(match[1])
    throw new Error(`Cannot extract S3 key from URL: ${url}`)
  }

  private currentUploadId = ''

  private async stage<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const stageIndex = this.processingStages.length
    const stages = ['Get video duration', 'Transcribe (AWS)', 'Detect scenes (FFmpeg)', 'Extract keyframes', 'Analyze clip (Riley)', 'Build reel (FFmpeg)', 'Write captions (Alex)']
    const progress = Math.round(((stageIndex) / stages.length) * 100)

    broadcastProcessingEvent('stage_start', {
      uploadId: this.currentUploadId,
      stage: name,
      progress,
      stageIndex,
      totalStages: stages.length,
    })

    const startTime = Date.now()
    const result = await fn()
    const endTime = Date.now()
    this.processingStages.push({ name, startTime, endTime })

    const doneProgress = Math.round(((stageIndex + 1) / stages.length) * 100)
    broadcastProcessingEvent('stage_done', {
      uploadId: this.currentUploadId,
      stage: name,
      progress: doneProgress,
      durationMs: endTime - startTime,
    })

    return result
  }
}

export default VideoProcessingService
