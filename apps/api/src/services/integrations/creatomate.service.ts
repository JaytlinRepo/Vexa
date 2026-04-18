import axios from 'axios'

/**
 * Creatomate Video Generation Integration
 *
 * What it does: Takes a template + data → renders a finished video file
 * Use case: Riley's shot list + Alex's script → rendered Reel ready to post
 * Pricing: Starts at $29/mo (1,000 renders). Well within budget.
 * Sign up: https://creatomate.com
 * Docs: https://creatomate.com/docs/api/introduction
 */

const CREATOMATE_API_KEY = process.env.CREATOMATE_API_KEY || ''
const BASE_URL = 'https://api.creatomate.com/v1'

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type RenderStatus = 'planned' | 'waiting' | 'transcribing' | 'rendering' | 'succeeded' | 'failed'

export interface RenderJob {
  id: string
  status: RenderStatus
  url?: string
  snapshotUrl?: string
  errorMessage?: string
  createdAt: string
  finishedAt?: string
}

export interface ReelRenderRequest {
  scriptText: string
  hookLine: string
  textOverlays: Array<{
    timestamp: string
    text: string
    style?: 'title' | 'subtitle' | 'caption'
  }>
  musicMood: string
  brandColor?: string
  logoUrl?: string
  backgroundVideoUrl?: string   // from Pexels/Pixabay
  aspectRatio?: '9:16' | '1:1' | '16:9'
}

// ─── TEMPLATE IDS ─────────────────────────────────────────────────────────────

/**
 * You create these templates in Creatomate's template editor.
 * Each is a base layout — data gets injected at render time.
 * Start with one template and expand as you learn what users need.
 */
const TEMPLATES = {
  reelBasic:      process.env.CREATOMATE_TEMPLATE_REEL_BASIC || '',
  reelTextHeavy:  process.env.CREATOMATE_TEMPLATE_REEL_TEXT || '',
  carouselBasic:  process.env.CREATOMATE_TEMPLATE_CAROUSEL || '',
}

// ─── RENDER A REEL ────────────────────────────────────────────────────────────

/**
 * Main function: takes Riley's output and renders a finished Reel.
 * Returns immediately with a job ID — use pollRenderStatus() to check completion.
 */
export async function renderReel(request: ReelRenderRequest): Promise<RenderJob> {
  if (!CREATOMATE_API_KEY) {
    throw new Error('CREATOMATE_API_KEY not set')
  }

  const templateId = request.textOverlays.length > 3
    ? TEMPLATES.reelTextHeavy
    : TEMPLATES.reelBasic

  if (!templateId) {
    throw new Error('Creatomate template ID not configured. Create a template at creatomate.com first.')
  }

  // Build the modifications object — this injects data into the template
  const modifications: Record<string, string> = {
    'hook-text': request.hookLine,
    'script-text': request.scriptText.slice(0, 500),
  }

  // Add text overlays
  request.textOverlays.forEach((overlay, i) => {
    modifications[`overlay-${i + 1}-text`] = overlay.text
    if (overlay.style) {
      modifications[`overlay-${i + 1}-style`] = overlay.style
    }
  })

  // Add branding if provided
  if (request.brandColor) {
    modifications['brand-color'] = request.brandColor
  }
  if (request.logoUrl) {
    modifications['logo-url'] = request.logoUrl
  }
  if (request.backgroundVideoUrl) {
    modifications['background-video'] = request.backgroundVideoUrl
  }

  const response = await axios.post(
    `${BASE_URL}/renders`,
    {
      template_id: templateId,
      modifications,
      output_format: 'mp4',
      frame_rate: 30,
    },
    {
      headers: {
        Authorization: `Bearer ${CREATOMATE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  )

  const render = Array.isArray(response.data) ? response.data[0] : response.data

  return {
    id: render.id,
    status: render.status,
    url: render.url,
    snapshotUrl: render.snapshot_url,
    createdAt: render.created_at,
  }
}

// ─── POLL RENDER STATUS ───────────────────────────────────────────────────────

/**
 * Check the status of a render job.
 * Poll this every 5-10 seconds until status is 'succeeded' or 'failed'.
 * Typical render time: 10-60 seconds depending on length.
 */
export async function getRenderStatus(renderId: string): Promise<RenderJob> {
  if (!CREATOMATE_API_KEY) throw new Error('CREATOMATE_API_KEY not set')

  const response = await axios.get(`${BASE_URL}/renders/${renderId}`, {
    headers: { Authorization: `Bearer ${CREATOMATE_API_KEY}` },
    timeout: 8000,
  })

  const render = response.data

  return {
    id: render.id,
    status: render.status,
    url: render.url,
    snapshotUrl: render.snapshot_url,
    errorMessage: render.error_message,
    createdAt: render.created_at,
    finishedAt: render.finished_at,
  }
}

// ─── WAIT FOR COMPLETION ──────────────────────────────────────────────────────

/**
 * Poll until the render completes or fails.
 * Use this for synchronous workflows. For production, use webhooks instead.
 */
export async function waitForRender(
  renderId: string,
  maxWaitSeconds = 120
): Promise<RenderJob> {
  const startTime = Date.now()
  const intervalMs = 5000

  while (Date.now() - startTime < maxWaitSeconds * 1000) {
    const job = await getRenderStatus(renderId)

    if (job.status === 'succeeded' || job.status === 'failed') {
      return job
    }

    await sleep(intervalMs)
  }

  throw new Error(`Render ${renderId} timed out after ${maxWaitSeconds}s`)
}

// ─── BUILD RENDER REQUEST FROM RILEY'S OUTPUT ─────────────────────────────────

/**
 * Takes Riley's structured shot list + Alex's script
 * and builds a Creatomate render request.
 */
export function buildRenderRequestFromOutputs(
  rileyOutput: {
    shots: Array<{ timestamp?: string; textOverlay?: string }>
    musicMood: string
    textOverlayGuide: string
  },
  alexOutput: {
    hookLine: string
    sections: Array<{ timestamp: string; speakingText?: string; textOverlay?: string }>
    cta: string
  },
  backgroundVideoUrl?: string
): ReelRenderRequest {
  const textOverlays: Array<{ timestamp: string; text: string; style: 'caption' | 'title' }> =
    alexOutput.sections
      .filter(s => s.textOverlay)
      .map(s => ({
        timestamp: s.timestamp,
        text: s.textOverlay!,
        style: 'caption',
      }))

  // Add CTA as final overlay
  textOverlays.push({
    timestamp: 'end',
    text: alexOutput.cta,
    style: 'title',
  })

  const fullScript = alexOutput.sections
    .filter(s => s.speakingText)
    .map(s => s.speakingText)
    .join(' ')

  return {
    scriptText: fullScript,
    hookLine: alexOutput.hookLine,
    textOverlays,
    musicMood: rileyOutput.musicMood,
    backgroundVideoUrl,
    aspectRatio: '9:16',
  }
}

// ─── RENDER FROM RILEY'S EDIT SUGGESTIONS (template-less) ────────────────────

export interface EditRenderRequest {
  videoUrl: string
  videoDuration?: number
  edits: Array<{
    type: string
    label?: string
    startSec?: number
    endSec?: number
    factor?: number
    aspect?: string
    content?: string
    position?: string
    mood?: string
  }>
  aspectRatio?: '9:16' | '1:1' | '4:5' | '16:9'
}

/**
 * Build a Creatomate RenderScript from Riley's edit suggestions.
 * No template needed — generates the full render JSON dynamically.
 */
export async function renderFromEdits(request: EditRenderRequest): Promise<RenderJob> {
  if (!CREATOMATE_API_KEY) {
    throw new Error('CREATOMATE_API_KEY not set')
  }

  // Determine output dimensions based on aspect ratio
  const aspectMap: Record<string, { width: number; height: number }> = {
    '9:16': { width: 1080, height: 1920 },
    '1:1': { width: 1080, height: 1080 },
    '4:5': { width: 1080, height: 1350 },
    '16:9': { width: 1920, height: 1080 },
  }

  // Check if any edit requests a specific crop
  const cropEdit = request.edits.find(e => e.type === 'crop')
  const aspect = cropEdit?.aspect || request.aspectRatio || '9:16'
  const dims = aspectMap[aspect] || aspectMap['9:16']

  // Build trim properties
  const trimEdit = request.edits.find(e => e.type === 'trim')
  let trimStart: number | undefined
  let trimDuration: number | undefined
  if (trimEdit) {
    trimStart = trimEdit.startSec || 0
    if (trimEdit.endSec && request.videoDuration) {
      trimDuration = trimEdit.endSec - (trimEdit.startSec || 0)
    } else if (trimEdit.endSec) {
      trimDuration = trimEdit.endSec - (trimEdit.startSec || 0)
    }
  }

  // Build color filter from mood edit
  const moodEdit = request.edits.find(e => e.type === 'mood')
  const moodMap: Record<string, { filter?: string; overlay?: string; filterValue?: number }> = {
    warm: { filter: 'sepia', filterValue: 30 },
    cool: { filter: 'hue-rotate', filterValue: 20 },
    moody: { filter: 'contrast', filterValue: 30, overlay: 'rgba(0,0,20,0.15)' },
    bright: { filter: 'brightness', filterValue: 15 },
    vintage: { filter: 'sepia', filterValue: 50, overlay: 'rgba(255,240,200,0.08)' },
    cinematic: { filter: 'contrast', filterValue: 20, overlay: 'rgba(0,20,30,0.12)' },
  }
  const moodStyle = moodEdit?.mood ? moodMap[moodEdit.mood] : null

  // Build the video element
  const videoElement: Record<string, unknown> = {
    type: 'video',
    track: 1,
    source: request.videoUrl,
    fit: 'cover',
  }
  if (trimStart !== undefined) videoElement.trim_start = trimStart
  if (trimDuration !== undefined) videoElement.trim_duration = trimDuration
  if (moodStyle?.filter) {
    videoElement.color_filter = moodStyle.filter
    if (moodStyle.filterValue) videoElement.color_filter_value = `${moodStyle.filterValue}%`
  }

  // Speed edit — Creatomate doesn't have a playback_rate, so we adjust trim_duration
  const speedEdit = request.edits.find(e => e.type === 'speed')
  if (speedEdit?.factor && speedEdit.factor !== 1) {
    // Adjust duration to simulate speed change
    // Faster = shorter duration, slower = longer duration
    const currentDuration = trimDuration || request.videoDuration || 10
    const adjustedDuration = currentDuration / speedEdit.factor
    videoElement.duration = adjustedDuration
  }

  const elements: Array<Record<string, unknown>> = [videoElement]

  // Add color overlay for mood
  if (moodStyle?.overlay) {
    elements.push({
      type: 'shape',
      track: 2,
      fill_color: moodStyle.overlay,
      width: '100%',
      height: '100%',
      time: 0,
      duration: null,  // match video
    })
  }

  // Add text overlays
  const textEdits = request.edits.filter(e => e.type === 'text')
  textEdits.forEach((te, i) => {
    const yMap: Record<string, string> = {
      top: '10%',
      center: '50%',
      bottom: '85%',
    }
    elements.push({
      type: 'text',
      track: 3 + i,
      text: te.content || '',
      font_family: 'Montserrat',
      font_weight: '700',
      font_size: '7 vmin',
      fill_color: '#ffffff',
      shadow_color: 'rgba(0,0,0,0.6)',
      shadow_blur: 4,
      shadow_y: 2,
      x: '50%',
      y: yMap[te.position || 'bottom'] || '85%',
      width: '85%',
      x_alignment: '50%',
      y_alignment: '50%',
      time: te.startSec || 0,
      duration: (te.endSec || 3) - (te.startSec || 0),
      animations: [
        { type: 'text-appear', duration: 0.5 },
        { type: 'text-disappear', duration: 0.3, time: 'end' },
      ],
    })
  })

  // Strip audio edit
  const stripAudio = request.edits.some(e => e.type === 'audio_strip')
  if (stripAudio) {
    videoElement.volume = '0%'
  }

  // Audio normalize — Creatomate doesn't have a direct equiv, but we can set volume
  const normAudio = request.edits.some(e => e.type === 'audio_norm')
  if (normAudio && !stripAudio) {
    videoElement.volume = '100%'
    videoElement.audio_fade_in = 0.3
    videoElement.audio_fade_out = 0.3
  }

  const body = {
    output_format: 'mp4',
    width: dims.width,
    height: dims.height,
    frame_rate: 30,
    elements,
  }

  console.log('[creatomate] rendering with', elements.length, 'elements, dims:', dims.width, 'x', dims.height)

  const response = await axios.post(
    `${BASE_URL}/renders`,
    { source: body },
    {
      headers: {
        Authorization: `Bearer ${CREATOMATE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  )

  const render = Array.isArray(response.data) ? response.data[0] : response.data

  return {
    id: render.id,
    status: render.status,
    url: render.url,
    snapshotUrl: render.snapshot_url,
    createdAt: render.created_at,
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
