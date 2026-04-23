/**
 * Community Content Tagging Service
 *
 * Uses Bedrock Haiku to analyze posts (caption + thumbnail) and assign
 * structured tags for the community Knowledge Feed.
 */

import { PrismaClient } from '@prisma/client'
import axios from 'axios'
import { invokeAgent, parseAgentOutput } from './bedrock/bedrock.service'
import { effectiveNiche } from '../lib/nicheDetection'

// ── Tag taxonomy ─────────────────────────────────────────────────────────────

export interface CommunityTags {
  topic: string[]
  format: string
  mood: string
  visualStyle: string
  audienceType: string
  hookType: string
  contentLength: string
  niche: string
  subNiche: string | null
}

const SYSTEM_PROMPT = `You are a content tagger for social media posts. Analyze the post and return ONLY valid JSON matching this exact schema. No other text.

{
  "topic": ["topic1", "topic2"],
  "format": "one of: talking-head, b-roll-montage, tutorial, vlog, transition, slideshow, skit, storytime, GRWM, haul, day-in-my-life, before-after, workout, recipe, review, unboxing, Q-and-A, behind-the-scenes",
  "mood": "one of: motivational, calm, funny, educational, aesthetic, raw, luxurious, energetic, inspiring, nostalgic, empowering",
  "visualStyle": "one of: warm-tones, cool-tones, cinematic, bright, muted, high-contrast, dark-moody, pastel, natural, vintage",
  "audienceType": "one of: young-professionals, parents, students, fitness-enthusiasts, entrepreneurs, creatives, budget-conscious, luxury-seekers, wellness-seekers, travelers",
  "hookType": "one of: question, statement, curiosity, contrarian, personal-story, statistic, challenge, relatable-moment, bold-claim",
  "contentLength": "one of: micro, short, standard, long"
}

Rules:
- topic: 2-4 specific topics from the caption and visual. Be specific, not generic.
- format: pick the closest match based on the content type and style.
- contentLength: micro (<15s), short (15-30s), standard (30-60s), long (60s+). For images/carousels, use "standard".
- If the image shows the creator talking to camera, format is "talking-head".
- If it shows scenic cuts, format is "b-roll-montage".
- Analyze BOTH the caption text AND the visual content (if provided).`

// ── Image download ───────────────────────────────────────────────────────────

async function downloadImageAsBase64(url: string): Promise<string | null> {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 8000,
      headers: { 'User-Agent': 'Sovexa/1.0' },
      maxRedirects: 3,
    })
    const buffer = Buffer.from(response.data)
    // Skip if too small (likely a broken image) or too large
    if (buffer.length < 1000 || buffer.length > 5_000_000) return null
    return buffer.toString('base64')
  } catch {
    return null
  }
}

// ── Tag a single post ────────────────────────────────────────────────────────

export async function tagPost(
  prisma: PrismaClient,
  postId: string,
  companyNiche: string,
  companySubNiche: string | null,
): Promise<CommunityTags | null> {
  const post = await prisma.platformPost.findUnique({
    where: { id: postId },
    select: { caption: true, mediaType: true, thumbnailUrl: true, publishedAt: true },
  })
  if (!post) return null

  // Build message content — text + optional image
  const contentBlocks: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  > = []

  // Try to get thumbnail as base64 for vision analysis
  if (post.thumbnailUrl) {
    const imageBase64 = await downloadImageAsBase64(post.thumbnailUrl)
    if (imageBase64) {
      contentBlocks.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 },
      })
    }
  }

  // Build the text prompt
  const caption = (post.caption || '').slice(0, 500)
  const mediaType = post.mediaType || 'IMAGE'
  const textPrompt = [
    `Media type: ${mediaType}`,
    `Niche: ${companyNiche}${companySubNiche ? ' / ' + companySubNiche : ''}`,
    caption ? `Caption: "${caption}"` : 'No caption provided.',
    'Tag this post.',
  ].join('\n')

  contentBlocks.push({ type: 'text', text: textPrompt })

  try {
    const raw = await invokeAgent({
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: contentBlocks }],
      maxTokens: 256,
      temperature: 0.2,
    })

    const tags = parseAgentOutput<Omit<CommunityTags, 'niche' | 'subNiche'>>(raw)

    const fullTags: CommunityTags = {
      ...tags,
      topic: Array.isArray(tags.topic) ? tags.topic.slice(0, 4) : [],
      niche: companyNiche,
      subNiche: companySubNiche,
    }

    // Save to database
    await prisma.platformPost.update({
      where: { id: postId },
      data: {
        communityTags: fullTags as any,
        communityTaggedAt: new Date(),
      },
    })

    return fullTags
  } catch (err) {
    console.warn(`[communityTagging] failed to tag post ${postId}:`, (err as Error).message)
    return null
  }
}

// ── Batch tag untagged posts for a company ───────────────────────────────────

export async function tagUntaggedPostsForCompany(
  prisma: PrismaClient,
  companyId: string,
): Promise<{ tagged: number; errors: number }> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { niche: true, detectedNiche: true, detectedSubNiche: true, subNiche: true },
  })
  if (!company) return { tagged: 0, errors: 0 }

  const niche = company.detectedNiche || company.niche || 'lifestyle'
  const subNiche = company.detectedSubNiche || company.subNiche || null

  // Get untagged posts (max 30 per run to limit Bedrock costs)
  const accounts = await prisma.platformAccount.findMany({
    where: { companyId },
    select: { id: true },
  })
  if (accounts.length === 0) return { tagged: 0, errors: 0 }

  const untagged = await prisma.platformPost.findMany({
    where: {
      accountId: { in: accounts.map((a) => a.id) },
      communityTaggedAt: null,
      caption: { not: null }, // need at least a caption to tag
    },
    select: { id: true },
    orderBy: { publishedAt: 'desc' },
    take: 30,
  })

  let tagged = 0
  let errors = 0

  // Process in batches of 5 with delay to respect Bedrock rate limits
  for (let i = 0; i < untagged.length; i++) {
    try {
      const result = await tagPost(prisma, untagged[i].id, niche, subNiche)
      if (result) tagged++
      else errors++
    } catch {
      errors++
    }

    // Delay between posts to avoid Bedrock throttling
    if (i < untagged.length - 1) {
      await new Promise((r) => setTimeout(r, 1200))
    }
  }

  return { tagged, errors }
}
