/**
 * AWS Transcribe Service
 * Transcribes video/audio with word-level timestamps.
 * Falls back gracefully when there's no speech.
 */

import {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
} from '@aws-sdk/client-transcribe'
import axios from 'axios'

const REGION = process.env.AWS_REGION || 'us-east-1'
const BUCKET = process.env.AWS_S3_BUCKET || 'vexa-outputs'
const client = new TranscribeClient({ region: REGION })

export interface TranscriptWord {
  text: string
  startTime: number // seconds
  endTime: number
  confidence: number
}

export interface TranscriptSegment {
  text: string
  startTime: number
  endTime: number
  words: TranscriptWord[]
}

export interface TranscriptionResult {
  fullText: string
  segments: TranscriptSegment[]
  words: TranscriptWord[]
  duration: number // total audio duration in seconds
  hasSpeech: boolean
}

/**
 * Transcribe a video stored in S3.
 * @param s3Key - The S3 object key (e.g. "uploads/company-id/video.mp4")
 */
export async function transcribeVideo(s3Key: string): Promise<TranscriptionResult> {
  const jobName = `sovexa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const s3Uri = `s3://${BUCKET}/${s3Key}`

  console.log(`[transcribe] Starting job ${jobName} for ${s3Uri}`)

  // Start transcription
  await client.send(
    new StartTranscriptionJobCommand({
      TranscriptionJobName: jobName,
      LanguageCode: 'en-US',
      MediaFormat: getMediaFormat(s3Key),
      Media: { MediaFileUri: s3Uri },
      OutputBucketName: BUCKET,
      OutputKey: `transcripts/${jobName}.json`,
    }),
  )

  // Poll until complete
  let status = 'IN_PROGRESS'
  let attempts = 0
  while (status === 'IN_PROGRESS' && attempts < 60) {
    await new Promise(r => setTimeout(r, 3000))
    const res = await client.send(
      new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }),
    )
    status = res.TranscriptionJob?.TranscriptionJobStatus || 'FAILED'
    attempts++
    if (attempts % 5 === 0) console.log(`[transcribe] ${jobName}: ${status} (${attempts * 3}s)`)
  }

  if (status === 'FAILED') {
    console.error(`[transcribe] Job ${jobName} failed`)
    return emptyResult()
  }

  // Fetch the transcript JSON from S3 via presigned URL
  const transcriptKey = `transcripts/${jobName}.json`
  try {
    const { getPresignedUrl } = await import('../services/storage/s3.service')
    const presignedUrl = await getPresignedUrl(transcriptKey, 300)
    const res = await axios.get(presignedUrl)
    return parseTranscribeOutput(res.data)
  } catch (err) {
    console.error(`[transcribe] Failed to fetch transcript:`, err)
    return emptyResult()
  }
}

/**
 * Parse AWS Transcribe JSON output into our format.
 */
function parseTranscribeOutput(data: any): TranscriptionResult {
  const results = data?.results
  if (!results) return emptyResult()

  const transcripts = results.transcripts || []
  const fullText = transcripts.map((t: any) => t.transcript).join(' ').trim()

  const items = results.items || []
  const words: TranscriptWord[] = items
    .filter((item: any) => item.type === 'pronunciation')
    .map((item: any) => ({
      text: item.alternatives?.[0]?.content || '',
      startTime: parseFloat(item.start_time || '0'),
      endTime: parseFloat(item.end_time || '0'),
      confidence: parseFloat(item.alternatives?.[0]?.confidence || '0'),
    }))

  // Build segments from the transcript (group by natural pauses > 1s)
  const segments: TranscriptSegment[] = []
  let currentSegment: TranscriptWord[] = []

  for (let i = 0; i < words.length; i++) {
    currentSegment.push(words[i])
    const nextWord = words[i + 1]
    const gap = nextWord ? nextWord.startTime - words[i].endTime : 999

    if (gap > 1.0 || i === words.length - 1) {
      if (currentSegment.length > 0) {
        segments.push({
          text: currentSegment.map(w => w.text).join(' '),
          startTime: currentSegment[0].startTime,
          endTime: currentSegment[currentSegment.length - 1].endTime,
          words: [...currentSegment],
        })
      }
      currentSegment = []
    }
  }

  const duration = words.length > 0 ? words[words.length - 1].endTime : 0

  return {
    fullText,
    segments,
    words,
    duration,
    hasSpeech: words.length > 20 && duration > 0 && (words.length / duration) > 0.5, // Need substantial speech: 20+ words AND > 0.5 words/sec
  }
}

function emptyResult(): TranscriptionResult {
  return { fullText: '', segments: [], words: [], duration: 0, hasSpeech: false }
}

function getMediaFormat(key: string): 'mp4' | 'mp3' | 'wav' | 'flac' {
  const ext = key.split('.').pop()?.toLowerCase()
  if (ext === 'mp3') return 'mp3'
  if (ext === 'wav') return 'wav'
  if (ext === 'flac') return 'flac'
  return 'mp4'
}
