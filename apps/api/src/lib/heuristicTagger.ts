/**
 * Caption + media-type based fast tagger. Lightweight fallback for the
 * Bedrock-based community tagger so the dashboard's content-mix tile
 * populates immediately on first connect, before the throttled Bedrock
 * pass has had a chance to run.
 *
 * Format vocabulary mirrors communityTagging.service.ts so a later
 * Bedrock pass can overwrite tags without taxonomy drift.
 */

import { PrismaClient, Prisma } from '@prisma/client'

interface MinimalTags {
  format: string
  mood: string
  visualStyle: string
  audienceType: string
  hookType: string
  contentLength: string
  topic: string[]
  niche: string
  subNiche: string | null
}

function classifyFormat(caption: string, mediaType: string): string {
  const c = caption.toLowerCase()
  // Strong caption signals (ordered by specificity).
  if (/\bgrwm\b|get ready with me/.test(c)) return 'GRWM'
  if (/day in (?:my|the) life|dim?l\b/.test(c)) return 'day-in-my-life'
  if (/\bhaul\b|\bunboxing\b/.test(c)) return /unbox/.test(c) ? 'unboxing' : 'haul'
  if (/before.*after|transformation/.test(c)) return 'before-after'
  if (/\brecipe\b|how to (?:cook|make|bake)/.test(c)) return 'recipe'
  if (/\bworkout\b|leg day|push day|reps?\b/.test(c)) return 'workout'
  if (/\breview\b|honest opinion/.test(c)) return 'review'
  if (/q&a|q and a|answering your questions/.test(c)) return 'Q-and-A'
  if (/storytime|story time|let me tell you/.test(c)) return 'storytime'
  if (/\btutorial\b|step.by.step|how to/.test(c)) return 'tutorial'
  if (/behind the scenes|\bbts\b/.test(c)) return 'behind-the-scenes'
  if (/transition|wait for it/.test(c)) return 'transition'
  if (/skit|when (?:you|she|he|they)/.test(c)) return 'skit'
  if (/vlog/.test(c)) return 'vlog'
  // Media-type fallbacks.
  if (mediaType === 'CAROUSEL_ALBUM' || mediaType === 'CAROUSEL') return 'slideshow'
  if (mediaType === 'VIDEO' || mediaType === 'REELS') return 'talking-head'
  return 'talking-head'
}

function classifyMood(caption: string): string {
  const c = caption.toLowerCase()
  if (/\bmotivat|push yourself|grind|let's go\b/.test(c)) return 'motivational'
  if (/\blol\b|\bhaha|funny|joke/.test(c)) return 'funny'
  if (/learn|tip|lesson|guide/.test(c)) return 'educational'
  if (/aesthetic|vibes|cozy/.test(c)) return 'aesthetic'
  if (/honest|real talk|raw/.test(c)) return 'raw'
  if (/\bluxur|premium|elite/.test(c)) return 'luxurious'
  if (/\benergy|hyped|pumped/.test(c)) return 'energetic'
  if (/\binspir|dream|vision/.test(c)) return 'inspiring'
  if (/throwback|miss the days|remember when/.test(c)) return 'nostalgic'
  if (/empower|you got this|you can/.test(c)) return 'empowering'
  return 'calm'
}

function classifyHook(caption: string): string {
  const c = caption.trim()
  if (!c) return 'statement'
  if (/^[^.!]*\?/.test(c)) return 'question'
  if (/^\d|\d+ (?:ways|things|reasons|tips)/i.test(c)) return 'statistic'
  if (/^pov|\bme when|when you|relatable/i.test(c)) return 'relatable-moment'
  if (/^stop|nobody|everyone|unpopular opinion/i.test(c)) return 'contrarian'
  if (/^try|challenge|i dare you|let's see/i.test(c)) return 'challenge'
  if (/^i (?:was|am|got|started|tried)|my journey|my story/i.test(c)) return 'personal-story'
  if (/^the (?:best|worst|secret|truth)|always|never/i.test(c)) return 'bold-claim'
  return 'statement'
}

function buildTags(post: { caption: string | null; mediaType: string | null; videoDuration?: number | null }, niche: string, subNiche: string | null): MinimalTags {
  const caption = (post.caption || '').slice(0, 500)
  const mediaType = (post.mediaType || '').toUpperCase()
  // Length bucket — best-effort (most platform_posts don't carry duration).
  let contentLength = 'standard'
  const dur = post.videoDuration
  if (typeof dur === 'number' && dur > 0) {
    if (dur < 15) contentLength = 'micro'
    else if (dur < 30) contentLength = 'short'
    else if (dur < 60) contentLength = 'standard'
    else contentLength = 'long'
  } else if (mediaType === 'IMAGE' || mediaType === 'CAROUSEL_ALBUM' || mediaType === 'CAROUSEL') {
    contentLength = 'standard'
  }

  return {
    format: classifyFormat(caption, mediaType),
    mood: classifyMood(caption),
    visualStyle: 'natural', // neutral default — only Bedrock vision can guess this from the thumbnail
    audienceType: 'young-professionals',
    hookType: classifyHook(caption),
    contentLength,
    topic: [],
    niche,
    subNiche,
  }
}

/**
 * Bulk-tag every post for a company that doesn't already have communityTags
 * set. Idempotent — skips already-tagged rows. Marks each row with
 * communityTaggedAt so the Bedrock pass can later identify rows that still
 * need vision-based upgrades.
 */
export async function heuristicTagAllPosts(prisma: PrismaClient, companyId: string): Promise<number> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { niche: true, subNiche: true },
  })
  if (!company) return 0

  const accounts = await prisma.platformAccount.findMany({
    where: { companyId },
    select: { id: true },
  })
  if (accounts.length === 0) return 0
  const acctIds = accounts.map((a) => a.id)

  const posts = await prisma.platformPost.findMany({
    where: { accountId: { in: acctIds }, communityTags: { equals: Prisma.DbNull } },
    select: { id: true, caption: true, mediaType: true },
    take: 200,
  })
  if (posts.length === 0) return 0

  let tagged = 0
  for (const p of posts) {
    const tags = buildTags(p, company.niche, company.subNiche)
    await prisma.platformPost.update({
      where: { id: p.id },
      data: {
        communityTags: tags as unknown as object,
        communityTaggedAt: new Date(),
      },
    }).then(() => { tagged++ }).catch(() => {})
  }
  return tagged
}
