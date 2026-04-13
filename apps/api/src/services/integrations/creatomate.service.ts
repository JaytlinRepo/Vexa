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

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
