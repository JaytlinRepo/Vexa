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
import { extractKeyframes } from './keyframeExtractor.service'
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

      // Extract S3 key from the presigned URL
      const s3Key = this.extractS3Key(upload.sourceVideoUrl)

      // ── 1. Download source video ONCE ──────────────────────────────
      // The video was being downloaded 4 times (probe, scenes, keyframes, render).
      // Now we download once and reuse the local file for all stages.
      const localVideoPath = path.join(os.tmpdir(), `sovexa-source-${uploadId}.mp4`)
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

      const [transcript, sceneData, frames] = await Promise.all([
        transcribeVideo(s3Key).then((result) => {
          console.log(`[video] Transcript: ${result.hasSpeech ? result.words.length + ' words' : 'no speech detected'}`)
          return result
        }),

        detectScenes(localVideoPath, videoDuration).then((scenes) => {
          console.log(`[video] Scenes: ${scenes.totalScenes} detected, ${scenes.highMotionSegments} high-motion`)
          return scenes
        }).catch(() => undefined),

        extractKeyframes(localVideoPath, videoDuration, frameInterval, maxFrames).then((extracted) => {
          console.log(`[video] Keyframes: ${extracted.length} frames extracted (interval: ${frameInterval}s)`)
          return extracted
        }),
      ])

      await profilePromise

      const analysisTime = ((Date.now() - analysisStart) / 1000).toFixed(1)
      console.log(`[video] Parallel analysis complete in ${analysisTime}s (local file, no re-downloads)`)
      broadcastProcessingEvent('stage_done', { uploadId, stage: 'Analyze video', progress: 55 })

      // ── 3. Riley picks the best segments (with VISION + creator profile) ──
      const targetDuration = creatorFilters?.targetDuration || 60
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
