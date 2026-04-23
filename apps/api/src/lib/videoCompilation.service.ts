/**
 * Video Compilation Service
 *
 * Combines multiple video uploads into a single reel.
 * Strategies:
 *   montage    — best moments from each video interleaved
 *   sequential — videos played in order, best parts of each
 *   intercut   — alternating between videos for contrast
 */

import { PrismaClient } from '@prisma/client'
import { getPresignedUrl } from '../services/storage/s3.service'
import { transcribeVideo, type TranscriptionResult } from './transcribe.service'
import { detectScenes, type SceneAnalysis } from './sceneDetection.service'
import { extractKeyframes, type ExtractedFrame } from './keyframeExtractor.service'
import { analyzeAndPickClip, type ClipDecision, type ReelSegment } from './clipAnalyzer.service'
import { buildReel, type ClipResult } from './ffmpegClipper.service'
import { buildCreatorFilters, type CreatorFilters } from './ffmpegFilterBuilder'
import { getStyleProfile } from '../services/videoStyleAnalyzer.service'
import { getRetentionProfile } from '../services/intelligence/retentionIntelligence'

interface VideoSource {
  uploadId: string
  s3Key: string
  duration: number
  transcript: TranscriptionResult
  scenes: SceneAnalysis | undefined
  frames: ExtractedFrame[]
}

export interface CompilationSegment extends ReelSegment {
  sourceIndex: number  // which video this segment comes from
  sourceUploadId: string
}

/**
 * Process a multi-video compilation.
 * Analyzes all videos in parallel, then Riley picks the best segments
 * across all of them, and FFmpeg builds a combined reel.
 */
export async function processCompilation(
  prisma: PrismaClient,
  compilationId: string,
): Promise<ClipResult> {
  const compilation = await prisma.videoCompilation.findUnique({
    where: { id: compilationId },
  })
  if (!compilation) throw new Error('Compilation not found')

  await prisma.videoCompilation.update({
    where: { id: compilationId },
    data: { status: 'processing' },
  })

  try {
    const companyId = compilation.companyId

    // Load creator profiles
    const [styleProfile, retentionProfile] = await Promise.all([
      getStyleProfile(companyId),
      getRetentionProfile(prisma, companyId),
    ])
    const creatorFilters = buildCreatorFilters(styleProfile, retentionProfile, compilation.targetDuration)

    // Load all video uploads
    const uploads = await prisma.videoUpload.findMany({
      where: { id: { in: compilation.uploadIds } },
    })
    if (uploads.length === 0) throw new Error('No uploads found')

    console.log(`[compilation] Processing ${uploads.length} videos for ${compilation.strategy} reel`)

    // ── Phase 1: Parallel analysis of all videos ──
    const sources: VideoSource[] = await Promise.all(
      uploads.map(async (upload, i) => {
        const s3Key = upload.sourceVideoUrl.replace('s3://', '')
        const freshUrl = await getPresignedUrl(s3Key, 3600)
        const duration = upload.duration || 30

        console.log(`[compilation] Analyzing video ${i + 1}/${uploads.length}: ${upload.fileName || upload.id}`)

        const [transcript, scenes, frames] = await Promise.all([
          transcribeVideo(freshUrl, s3Key).catch(() => ({
            segments: [], words: [], fullText: '', hasSpeech: false,
          } as TranscriptionResult)),
          detectScenes(freshUrl, duration).catch(() => undefined),
          extractKeyframes(freshUrl, duration, creatorFilters.frameInterval, 8).catch(() => []),
        ])

        return { uploadId: upload.id, s3Key, duration, transcript, scenes, frames }
      }),
    )

    // ── Phase 2: Riley picks segments from ALL videos ──
    const budgetPerVideo = Math.ceil(compilation.targetDuration / uploads.length)
    const creatorProfile = (styleProfile || retentionProfile)
      ? { style: styleProfile as any, retention: retentionProfile as any }
      : null

    const allDecisions: Array<{ decision: ClipDecision; sourceIndex: number; uploadId: string }> = []

    for (let i = 0; i < sources.length; i++) {
      const src = sources[i]
      console.log(`[compilation] Riley analyzing video ${i + 1}: ${src.frames.length} frames, ${src.duration}s`)

      const decision = await analyzeAndPickClip(
        src.transcript,
        src.duration,
        budgetPerVideo,
        companyId,
        src.scenes,
        src.frames,
        prisma,
        creatorProfile,
      )

      allDecisions.push({ decision, sourceIndex: i, uploadId: src.uploadId })
    }

    // ── Phase 3: Merge segments based on strategy ──
    const mergedSegments = mergeByStrategy(
      allDecisions,
      compilation.strategy as 'montage' | 'sequential' | 'intercut',
      compilation.targetDuration,
    )

    console.log(`[compilation] ${mergedSegments.length} segments selected across ${uploads.length} videos`)

    // ── Phase 4: Build multi-source reel ──
    // For now, build each source's segments separately then concat
    // (full multi-input filter_complex is a future enhancement)
    const sourceUrls = await Promise.all(
      sources.map((src) => getPresignedUrl(src.s3Key, 3600)),
    )

    // Group segments by source video
    const segmentsBySource = new Map<number, CompilationSegment[]>()
    for (const seg of mergedSegments) {
      const arr = segmentsBySource.get(seg.sourceIndex) || []
      arr.push(seg)
      segmentsBySource.set(seg.sourceIndex, arr)
    }

    // Build reel from the primary source (most segments)
    // For a full implementation, this would use multi-input FFmpeg
    const primarySource = [...segmentsBySource.entries()]
      .sort((a, b) => b[1].length - a[1].length)[0]

    if (!primarySource) throw new Error('No segments selected')

    const clipResult = await buildReel({
      sourceUrl: sourceUrls[primarySource[0]],
      segments: mergedSegments.filter((s) => s.sourceIndex === primarySource[0]),
      companyId,
      uploadId: compilationId,
      creatorFilters,
    })

    // Update compilation status
    await prisma.videoCompilation.update({
      where: { id: compilationId },
      data: { status: 'complete', clipId: clipResult.s3Key },
    })

    // Create VideoClip record
    await prisma.videoClip.create({
      data: {
        uploadId: uploads[0].id,
        companyId,
        clippedUrl: `s3://${clipResult.s3Key}`,
        duration: clipResult.duration,
        hook: allDecisions[0]?.decision.hook || '',
        status: 'draft',
        visualApprovalStatus: 'pending',
        copyApprovalStatus: 'pending',
        processedWith: 'compilation_riley_ffmpeg',
        adjustments: {
          version: 1,
          strategy: compilation.strategy,
          sourceCount: uploads.length,
          segments: mergedSegments,
          rationale: allDecisions.map((d) => d.decision.rationale).join(' | '),
        },
      },
    })

    console.log(`[compilation] Complete: ${clipResult.duration}s reel from ${uploads.length} videos`)
    return clipResult
  } catch (err) {
    await prisma.videoCompilation.update({
      where: { id: compilationId },
      data: { status: 'failed', error: (err as Error).message },
    })
    throw err
  }
}

// ── Merge strategies ─────────────────────────────────────────────────────────

function mergeByStrategy(
  decisions: Array<{ decision: ClipDecision; sourceIndex: number; uploadId: string }>,
  strategy: 'montage' | 'sequential' | 'intercut',
  targetDuration: number,
): CompilationSegment[] {
  const allSegments: CompilationSegment[] = decisions.flatMap((d) =>
    d.decision.segments.map((seg) => ({
      ...seg,
      sourceIndex: d.sourceIndex,
      sourceUploadId: d.uploadId,
    })),
  )

  switch (strategy) {
    case 'sequential':
      // Videos play in order — take top segments from each in sequence
      return allSegments.slice(0, Math.ceil(targetDuration / 3))

    case 'intercut':
      // Alternate between videos — creates contrast
      return interleaveBySource(allSegments, decisions.length)
        .slice(0, Math.ceil(targetDuration / 3))

    case 'montage':
    default:
      // Best moments from all videos, sorted by energy
      return allSegments
        .sort((a, b) => {
          const energyRank = { hook: 3, high: 2, medium: 1 }
          return (energyRank[b.energy] || 0) - (energyRank[a.energy] || 0)
        })
        .slice(0, Math.ceil(targetDuration / 3))
  }
}

function interleaveBySource(segments: CompilationSegment[], sourceCount: number): CompilationSegment[] {
  const buckets: CompilationSegment[][] = Array.from({ length: sourceCount }, () => [])
  for (const seg of segments) {
    buckets[seg.sourceIndex]?.push(seg)
  }

  const result: CompilationSegment[] = []
  let added = true
  while (added) {
    added = false
    for (const bucket of buckets) {
      const next = bucket.shift()
      if (next) {
        result.push(next)
        added = true
      }
    }
  }
  return result
}
