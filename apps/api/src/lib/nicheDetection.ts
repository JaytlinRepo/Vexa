/**
 * Detect the creator's actual content niche from their video captions
 * using Bedrock (Claude Haiku). Compares against the supported niches
 * and returns a primary + sub-niche with confidence score.
 *
 * Called on TikTok connect so the knowledge feed serves relevant
 * content from day one — even if the user picked the wrong niche
 * during onboarding.
 */

import { PrismaClient } from '@prisma/client'
import { invokeAgent, parseAgentOutput } from '../services/bedrock/bedrock.service'

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

export async function detectNicheFromContent(
  prisma: PrismaClient,
  companyId: string,
): Promise<NicheDetectionResult | null> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: { tiktok: true, instagram: true },
  })
  if (!company) return null

  // Gather captions from TikTok (primary source — has real video data)
  const captions: string[] = []
  if (company.tiktok) {
    const vids = (company.tiktok.recentVideos as Array<{ title?: string }>) || []
    for (const v of vids) {
      if (v.title?.trim()) captions.push(v.title.trim())
    }
  }

  // Also pull from PlatformPost if TikTok recentVideos is sparse
  if (captions.length < 5) {
    const posts = await prisma.platformPost.findMany({
      where: { account: { companyId } },
      orderBy: { publishedAt: 'desc' },
      take: 20,
      select: { caption: true },
    })
    for (const p of posts) {
      if (p.caption?.trim() && !captions.includes(p.caption.trim())) {
        captions.push(p.caption.trim())
      }
    }
  }

  if (captions.length < 3) return null // not enough data to detect

  const captionBlock = captions
    .slice(0, 20)
    .map((c, i) => `${i + 1}. ${c.slice(0, 200)}`)
    .join('\n')

  const subNicheList = Object.entries(SUB_NICHES)
    .map(([niche, subs]) => `  ${niche}: ${subs.join(', ')}`)
    .join('\n')

  const systemPrompt = `You are a content niche classifier. Given a list of video captions from a creator's social media account, determine which content niche best describes their work.

Supported niches: ${SUPPORTED_NICHES.join(', ')}

Sub-niches per niche (pick the closest match):
${subNicheList}

Rules:
- Pick the SINGLE best-matching niche from the supported list
- Pick the closest sub-niche from the list above for that niche. If none match well, you may use a short custom label (2-3 words max)
- Confidence: 0.0 to 1.0 — how confident are you?
- If the content spans multiple niches, pick the dominant one
- "lifestyle" is the catch-all — only use it when content genuinely IS lifestyle (daily routines, aesthetics, travel, personal vlogs) not as a fallback for unclear content

Return ONLY valid JSON:
{
  "detectedNiche": "one of: ${SUPPORTED_NICHES.join(', ')}",
  "detectedSubNiche": "one of the sub-niches listed above, or a short custom label",
  "confidence": 0.85,
  "reasoning": "one sentence explaining why"
}`

  try {
    const raw = await invokeAgent({
      systemPrompt,
      messages: [{ role: 'user', content: `Classify this creator's niche from their ${captions.length} most recent video captions:\n\n${captionBlock}` }],
      maxTokens: 256,
      temperature: 0.2,
    })
    const result = parseAgentOutput<NicheDetectionResult>(raw)

    // Validate the niche is one we support
    if (!SUPPORTED_NICHES.includes(result.detectedNiche as typeof SUPPORTED_NICHES[number])) {
      result.detectedNiche = 'lifestyle' // safe fallback
      result.confidence = Math.min(result.confidence, 0.5)
    }

    // Persist to the company
    await prisma.company.update({
      where: { id: companyId },
      data: {
        detectedNiche: result.detectedNiche,
        detectedSubNiche: result.detectedSubNiche,
        nicheConfidence: result.confidence,
      },
    })

    console.log(`[niche] detected ${result.detectedNiche}/${result.detectedSubNiche} (${(result.confidence * 100).toFixed(0)}%) for company ${companyId}: ${result.reasoning}`)
    return result
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
