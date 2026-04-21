/**
 * Scene Detection Service
 * Analyzes video visually when there's no/minimal speech.
 *
 * Uses FFmpeg to detect:
 * - Scene changes (cut points)
 * - Motion intensity per segment (high activity vs. static)
 *
 * Output: a list of scenes with timestamps and activity scores
 * that Riley can use to pick the best visual moments.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import axios from 'axios'

const execFileAsync = promisify(execFile)

export interface DetectedScene {
  startTime: number
  endTime: number
  duration: number
  motionScore: number   // 0-1, how much movement in this scene
  label: string         // auto-generated description
}

export interface SceneAnalysis {
  scenes: DetectedScene[]
  totalScenes: number
  avgSceneDuration: number
  highMotionSegments: number
}

/**
 * Detect scenes and measure motion in a video.
 * Works by:
 * 1. FFmpeg scene detection → finds visual cut points
 * 2. FFmpeg frame difference → measures motion intensity per scene
 */
export async function detectScenes(videoUrl: string, videoDuration: number): Promise<SceneAnalysis> {
  const tmpDir = os.tmpdir()
  const inputPath = path.join(tmpDir, `sovexa-scene-${Date.now()}.mp4`)

  try {
    // Download video
    console.log('[scene-detect] Downloading video for analysis...')
    const response = await axios.get(videoUrl, { responseType: 'arraybuffer', timeout: 180000 })
    fs.writeFileSync(inputPath, Buffer.from(response.data))

    // 1. Detect scene changes
    console.log('[scene-detect] Running scene detection...')
    const sceneTimestamps = await getSceneTimestamps(inputPath)

    // 2. Measure motion per scene
    console.log('[scene-detect] Measuring motion intensity...')
    const motionScores = await getMotionScores(inputPath, videoDuration)

    // 3. Build scenes from cut points
    const cutPoints = [0, ...sceneTimestamps, videoDuration]
    const scenes: DetectedScene[] = []

    for (let i = 0; i < cutPoints.length - 1; i++) {
      const start = cutPoints[i]
      const end = cutPoints[i + 1]
      const duration = end - start

      // Skip tiny scenes (< 0.5s — probably a flash/artifact)
      if (duration < 0.5) continue

      // Find motion score for this time range
      const relevantMotion = motionScores.filter(m => m.time >= start && m.time < end)
      const avgMotion = relevantMotion.length > 0
        ? relevantMotion.reduce((sum, m) => sum + m.score, 0) / relevantMotion.length
        : 0.5

      const label = avgMotion > 0.7 ? 'High action'
        : avgMotion > 0.4 ? 'Active'
        : avgMotion > 0.15 ? 'Moderate'
        : 'Static/slow'

      scenes.push({
        startTime: Math.round(start * 100) / 100,
        endTime: Math.round(end * 100) / 100,
        duration: Math.round(duration * 100) / 100,
        motionScore: Math.round(avgMotion * 100) / 100,
        label,
      })
    }

    // If no scene changes detected, create segments based on motion alone
    if (scenes.length <= 1) {
      console.log('[scene-detect] No scene cuts found, segmenting by motion...')
      return segmentByMotion(motionScores, videoDuration)
    }

    const highMotion = scenes.filter(s => s.motionScore > 0.4).length

    console.log(`[scene-detect] Found ${scenes.length} scenes, ${highMotion} high-motion`)
    scenes.forEach((s, i) => {
      console.log(`  ${i + 1}. [${s.startTime.toFixed(1)}s - ${s.endTime.toFixed(1)}s] motion: ${s.motionScore.toFixed(2)} — ${s.label}`)
    })

    return {
      scenes,
      totalScenes: scenes.length,
      avgSceneDuration: scenes.reduce((sum, s) => sum + s.duration, 0) / scenes.length,
      highMotionSegments: highMotion,
    }
  } finally {
    try { fs.unlinkSync(inputPath) } catch {}
  }
}

/**
 * Use FFmpeg scene detection to find visual cut points.
 * Returns array of timestamps where scene changes occur.
 */
async function getSceneTimestamps(inputPath: string): Promise<number[]> {
  try {
    const { stderr } = await execFileAsync('ffmpeg', [
      '-i', inputPath,
      '-vf', 'select=gt(scene\\,0.3),showinfo',
      '-vsync', 'vfr',
      '-f', 'null',
      '-',
    ], { timeout: 60000 })

    // Parse timestamps from showinfo output
    const timestamps: number[] = []
    const regex = /pts_time:(\d+\.?\d*)/g
    let match
    while ((match = regex.exec(stderr)) !== null) {
      timestamps.push(parseFloat(match[1]))
    }

    return timestamps.sort((a, b) => a - b)
  } catch (err: any) {
    // FFmpeg scene detect writes to stderr even on success
    const stderr = err.stderr || ''
    const timestamps: number[] = []
    const regex = /pts_time:(\d+\.?\d*)/g
    let match
    while ((match = regex.exec(stderr)) !== null) {
      timestamps.push(parseFloat(match[1]))
    }
    return timestamps.sort((a, b) => a - b)
  }
}

/**
 * Measure motion intensity throughout the video.
 * Uses frame differencing — higher difference = more motion.
 * Returns array of {time, score} sampled every ~0.5s.
 */
async function getMotionScores(inputPath: string, videoDuration: number): Promise<Array<{ time: number; score: number }>> {
  try {
    // Use FFmpeg to compute frame differences
    // mpdecimate detects duplicates; we use the inverse — high difference = high motion
    const { stderr } = await execFileAsync('ffmpeg', [
      '-i', inputPath,
      '-vf', 'fps=2,mpdecimate=hi=200:lo=100:frac=0.5,showinfo',
      '-f', 'null',
      '-',
    ], { timeout: 60000 })

    // Parse which frames were NOT decimated (these are the "different" frames = motion)
    const motionFrames: number[] = []
    const regex = /pts_time:(\d+\.?\d*)/g
    let match
    while ((match = regex.exec(stderr)) !== null) {
      motionFrames.push(parseFloat(match[1]))
    }

    // Build per-second motion scores
    const scores: Array<{ time: number; score: number }> = []
    const bucketSize = 1.0 // 1-second buckets
    for (let t = 0; t < videoDuration; t += bucketSize) {
      const framesInBucket = motionFrames.filter(f => f >= t && f < t + bucketSize).length
      // 2 fps = 2 frames per second max. Normalize to 0-1.
      const score = Math.min(1, framesInBucket / 2)
      scores.push({ time: t, score })
    }

    return scores
  } catch (err: any) {
    // Fallback: parse whatever we got
    const stderr = err.stderr || ''
    const motionFrames: number[] = []
    const regex = /pts_time:(\d+\.?\d*)/g
    let match
    while ((match = regex.exec(stderr)) !== null) {
      motionFrames.push(parseFloat(match[1]))
    }

    const scores: Array<{ time: number; score: number }> = []
    const bucketSize = 1.0
    for (let t = 0; t < videoDuration; t += bucketSize) {
      const framesInBucket = motionFrames.filter(f => f >= t && f < t + bucketSize).length
      const score = Math.min(1, framesInBucket / 2)
      scores.push({ time: t, score })
    }

    return scores
  }
}

/**
 * Fallback: when no scene cuts are detected, segment by motion intensity.
 * Groups consecutive high-motion seconds into segments.
 */
function segmentByMotion(motionScores: Array<{ time: number; score: number }>, videoDuration: number): SceneAnalysis {
  const scenes: DetectedScene[] = []
  let segStart: number | null = null
  let segScores: number[] = []

  for (const { time, score } of motionScores) {
    if (score > 0.2) {
      // Active frame
      if (segStart === null) segStart = time
      segScores.push(score)
    } else {
      // Static frame — close current segment if exists
      if (segStart !== null && segScores.length >= 2) {
        const avgMotion = segScores.reduce((a, b) => a + b) / segScores.length
        scenes.push({
          startTime: segStart,
          endTime: time,
          duration: time - segStart,
          motionScore: Math.round(avgMotion * 100) / 100,
          label: avgMotion > 0.7 ? 'High action' : avgMotion > 0.4 ? 'Active' : 'Moderate',
        })
      }
      segStart = null
      segScores = []
    }
  }

  // Close final segment
  if (segStart !== null && segScores.length >= 2) {
    const avgMotion = segScores.reduce((a, b) => a + b) / segScores.length
    scenes.push({
      startTime: segStart,
      endTime: videoDuration,
      duration: videoDuration - segStart,
      motionScore: Math.round(avgMotion * 100) / 100,
      label: avgMotion > 0.7 ? 'High action' : 'Active',
    })
  }

  // If we still got nothing, just split evenly
  if (scenes.length === 0) {
    const segDur = Math.min(8, videoDuration / 3)
    for (let i = 0; i < videoDuration; i += segDur) {
      scenes.push({
        startTime: i,
        endTime: Math.min(i + segDur, videoDuration),
        duration: Math.min(segDur, videoDuration - i),
        motionScore: 0.5,
        label: 'Segment',
      })
    }
  }

  return {
    scenes,
    totalScenes: scenes.length,
    avgSceneDuration: scenes.reduce((sum, s) => sum + s.duration, 0) / scenes.length,
    highMotionSegments: scenes.filter(s => s.motionScore > 0.4).length,
  }
}
