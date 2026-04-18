/**
 * Detect the creator's actual content niche from their video data.
 *
 * Strategy (in order):
 * 1. Text-based: analyze captions, titles, hashtags via Bedrock
 * 2. Visual fallback: if text confidence < 0.5 or too few captions,
 *    download video thumbnails and send as images to Bedrock
 *
 * Called on TikTok connect so the knowledge feed serves relevant
 * content from day one.
 */

import { PrismaClient } from '@prisma/client'
import { invokeAgent, parseAgentOutput } from '../services/bedrock/bedrock.service'
import https from 'https'
import http from 'http'

const SUPPORTED_NICHES = ['fitness', 'finance', 'food', 'coaching', 'lifestyle', 'personal_development'] as const

const SUB_NICHES: Record<string, string[]> = {
  lifestyle: ['travel', 'college', 'mom', 'minimalism', 'wellness', 'luxury', 'day in my life'],
  fitness: ['weight loss', 'bodybuilding', 'yoga', 'running', 'crossfit', 'home workouts'],
  finance: ['investing', 'budgeting', 'crypto', 'real estate', 'side hustles'],
  food: ['baking', 'meal prep', 'vegan', 'restaurant reviews', 'healthy eating'],
  coaching: ['business', 'life coaching', 'career', 'mindset', 'productivity'],
  personal_development: ['habits', 'reading', 'mindfulness', 'goal setting', 'journaling'],
}

interface NicheDetectionResult {
  detectedNiche: string
  detectedSubNiche: string
  confidence: number
  reasoning: string
}

function buildSystemPrompt(): string {
  const subNicheList = Object.entries(SUB_NICHES)
    .map(([niche, subs]) => `  ${niche}: ${subs.join(', ')}`)
    .join('\n')

  return `You are a content niche classifier. Determine which content niche best describes a creator's work.

Supported niches: ${SUPPORTED_NICHES.join(', ')}

Sub-niches per niche (pick the closest match):
${subNicheList}

Rules:
- Pick the SINGLE best-matching niche from the supported list
- Pick the closest sub-niche from the list above. If none match well, use a short custom label (2-3 words max)
- Confidence: 0.0 to 1.0
- If the content spans multiple niches, pick the dominant one
- "lifestyle" is for content that genuinely IS lifestyle (daily routines, aesthetics, travel, personal vlogs) — not a fallback for unclear content

Return ONLY valid JSON:
{
  "detectedNiche": "one of: ${SUPPORTED_NICHES.join(', ')}",
  "detectedSubNiche": "sub-niche label",
  "confidence": 0.85,
  "reasoning": "one sentence explaining why"
}`
}

function validateResult(result: NicheDetectionResult): NicheDetectionResult {
  if (!SUPPORTED_NICHES.includes(result.detectedNiche as typeof SUPPORTED_NICHES[number])) {
    result.detectedNiche = 'lifestyle'
    result.confidence = Math.min(result.confidence, 0.5)
  }
  return result
}

async function persistResult(prisma: PrismaClient, companyId: string, result: NicheDetectionResult): Promise<void> {
  await prisma.company.update({
    where: { id: companyId },
    data: {
      detectedNiche: result.detectedNiche,
      detectedSubNiche: result.detectedSubNiche,
      nicheConfidence: result.confidence,
    },
  })
  console.log(`[niche] detected ${result.detectedNiche}/${result.detectedSubNiche} (${(result.confidence * 100).toFixed(0)}%) for company ${companyId}: ${result.reasoning}`)
}

// ─── HASHTAG EXTRACTION ─────────────────────────────────────────────────────

function extractHashtags(captions: string[]): string[] {
  const counts: Record<string, number> = {}
  for (const c of captions) {
    const tags = c.match(/#[a-zA-Z0-9_]+/g) || []
    for (const tag of tags) {
      const normalized = tag.toLowerCase()
      // Skip noise hashtags
      if (['#fyp', '#fypシ', '#viral', '#fy', '#foryou', '#foryoupage', '#trending'].includes(normalized)) continue
      counts[normalized] = (counts[normalized] || 0) + 1
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([tag, count]) => `${tag} (${count}x)`)
}

// ─── TEXT-BASED DETECTION ────────────────────────────────────────────────────

async function detectFromText(captions: string[], bios: string[] = []): Promise<NicheDetectionResult | null> {
  if (captions.length < 3 && bios.length === 0) return null

  const captionBlock = captions
    .slice(0, 20)
    .map((c, i) => `${i + 1}. ${c.slice(0, 200)}`)
    .join('\n')

  const hashtags = extractHashtags(captions)
  const hashtagBlock = hashtags.length > 0
    ? `\n\nMost used hashtags (excluding #fyp/#viral noise):\n${hashtags.join(', ')}`
    : ''

  const bioBlock = bios.length > 0
    ? `\n\nBio/profile descriptions:\n${bios.map(b => `- ${b}`).join('\n')}`
    : ''

  const raw = await invokeAgent({
    systemPrompt: buildSystemPrompt(),
    messages: [{ role: 'user', content: `Classify this creator's niche from their content:\n\n${captions.length} most recent captions:\n${captionBlock}${hashtagBlock}${bioBlock}` }],
    maxTokens: 256,
    temperature: 0.2,
  })
  return validateResult(parseAgentOutput<NicheDetectionResult>(raw))
}

// ─── VISUAL (THUMBNAIL) DETECTION ────────────────────────────────────────────

async function downloadImageAsBase64(url: string, timeoutMs = 8000): Promise<{ data: string; mediaType: string } | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs)
    const get = url.startsWith('https') ? https.get : http.get
    get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) { clearTimeout(timer); resolve(null); return }
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        clearTimeout(timer)
        const buf = Buffer.concat(chunks)
        // Cap at 1MB per image to stay within Bedrock limits
        if (buf.length > 1_000_000) { resolve(null); return }
        const ct = (res.headers['content-type'] || 'image/jpeg').split(';')[0].trim()
        resolve({ data: buf.toString('base64'), mediaType: ct })
      })
      res.on('error', () => { clearTimeout(timer); resolve(null) })
    }).on('error', () => { clearTimeout(timer); resolve(null) })
  })
}

async function detectFromThumbnails(thumbnailUrls: string[]): Promise<NicheDetectionResult | null> {
  if (thumbnailUrls.length === 0) return null

  // Download up to 8 thumbnails in parallel
  const urls = thumbnailUrls.slice(0, 8)
  console.log(`[niche] downloading ${urls.length} thumbnails for visual detection...`)
  const images = (await Promise.all(urls.map((u) => downloadImageAsBase64(u)))).filter(Boolean) as Array<{ data: string; mediaType: string }>

  if (images.length < 2) {
    console.log(`[niche] only ${images.length} thumbnails downloaded, skipping visual detection`)
    return null
  }

  const contentBlocks: Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }> = [
    { type: 'text', text: `Classify this creator's content niche based on these ${images.length} video thumbnails. Look at the visual style, settings, subjects, and activities shown.` },
  ]
  for (const img of images) {
    contentBlocks.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.data },
    })
  }

  const raw = await invokeAgent({
    systemPrompt: buildSystemPrompt(),
    messages: [{ role: 'user', content: contentBlocks }],
    maxTokens: 256,
    temperature: 0.2,
  })
  return validateResult(parseAgentOutput<NicheDetectionResult>(raw))
}

// ─── MAIN ENTRY POINT ────────────────────────────────────────────────────────

export async function detectNicheFromContent(
  prisma: PrismaClient,
  companyId: string,
): Promise<NicheDetectionResult | null> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: { tiktok: true },
  })
  if (!company) return null

  // Gather captions, bios, thumbnails
  const captions: string[] = []
  const bios: string[] = []
  const thumbnailUrls: string[] = []

  if (company.tiktok) {
    const vids = (company.tiktok.recentVideos as Array<{ title?: string; cover?: string }>) || []
    for (const v of vids) {
      if (v.title?.trim()) captions.push(v.title.trim())
      if (v.cover) thumbnailUrls.push(v.cover)
    }
    const ttBio = (company.tiktok as Record<string, unknown>).bio as string | undefined
    if (ttBio?.trim()) bios.push(ttBio.trim())
  }

  // Pull bios from PlatformAccount
  const accounts = await prisma.platformAccount.findMany({
    where: { companyId },
    select: { bio: true },
  })
  for (const a of accounts) {
    if (a.bio?.trim() && !bios.includes(a.bio.trim())) bios.push(a.bio.trim())
  }

  // Pull from InstagramConnection bio
  const igConn = await prisma.instagramConnection.findFirst({
    where: { companyId },
    select: { bio: true },
  })
  if (igConn?.bio?.trim() && !bios.includes(igConn.bio.trim())) bios.push(igConn.bio.trim())

  // Pull captions + thumbnails from PlatformPost
  if (captions.length < 5 || thumbnailUrls.length < 5) {
    const posts = await prisma.platformPost.findMany({
      where: { account: { companyId } },
      orderBy: { publishedAt: 'desc' },
      take: 20,
      select: { caption: true, thumbnailUrl: true },
    })
    for (const p of posts) {
      if (p.caption?.trim() && !captions.includes(p.caption.trim())) captions.push(p.caption.trim())
      if (p.thumbnailUrl && !thumbnailUrls.includes(p.thumbnailUrl)) thumbnailUrls.push(p.thumbnailUrl)
    }
  }

  try {
    // Step 1: try text-based detection (captions + hashtags + bios)
    const textResult = await detectFromText(captions, bios).catch(() => null)

    if (textResult && textResult.confidence >= 0.5) {
      await persistResult(prisma, companyId, textResult)
      return textResult
    }

    // Step 2: text was low-confidence or failed — try thumbnails
    console.log(`[niche] text detection ${textResult ? `low confidence (${(textResult.confidence * 100).toFixed(0)}%)` : 'failed'}, trying visual fallback...`)
    const visualResult = await detectFromThumbnails(thumbnailUrls).catch(() => null)

    if (visualResult) {
      // If we have both, pick the higher-confidence one
      const best = textResult && textResult.confidence > visualResult.confidence ? textResult : visualResult
      await persistResult(prisma, companyId, best)
      return best
    }

    // Step 3: visual also failed — use text result if we have one, even if low confidence
    if (textResult) {
      await persistResult(prisma, companyId, textResult)
      return textResult
    }

    return null
  } catch (err) {
    console.warn('[niche] detection failed', err)
    return null
  }
}

/** Return the best niche to use for feed/RAG: detected (if confident) > user-selected */
export function effectiveNiche(company: {
  niche: string
  detectedNiche?: string | null
  nicheConfidence?: number | null
}): string {
  if (company.detectedNiche && (company.nicheConfidence ?? 0) >= 0.6) {
    return company.detectedNiche
  }
  return company.niche
}
