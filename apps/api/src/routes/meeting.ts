import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import { isTestMode } from '../lib/mode'
import { readTopMemories, formatMemoryForPrompt } from '../lib/brandMemory'
import { PLAN_LIMITS } from '../lib/plans'
import { nicheKnowledgeBlock, AgentRole } from '../lib/nicheKnowledge'

import prisma from '../lib/prisma'
const router = Router()

function formatPlatformBlock(ig: {
  handle: string
  source: string
  followerCount: number
  engagementRate: number
  avgReach: number
  avgImpressions: number
  postCount: number
  topPosts: unknown
  audienceAge: unknown
  audienceTop: unknown
} | null): string {
  // No real account connected (or only the stub / demo data). Be explicit
  // about it so the agent refuses to invent numbers — a customer caught
  // Maya citing a fake "23% engagement drop" when no account was linked.
  if (!ig || ig.source !== 'phyllo') {
    return `

--- Account data ---
NO PLATFORM ACCOUNT IS CONNECTED. You do not have the CEO's follower count,
engagement rate, reach, impressions, or post performance. If the CEO asks
about their stats, numbers, trends, or specific posts, you MUST say exactly
that — something like "I can't see your account yet. Connect Instagram in
Settings → Integrations and I'll pull real numbers on my next sync." Never
estimate, never invent figures, never cite percentages or follower counts.
You CAN still give structural advice (frameworks, hook ideas, shot lists,
general best practice) — just not data-specific claims.
--- End account data ---`
  }
  const topPosts = Array.isArray(ig.topPosts) ? ig.topPosts : []
  const topLine = topPosts[0]
    ? `  top post: "${String((topPosts[0] as { caption?: string }).caption || '').slice(0, 90)}" — ${(topPosts[0] as { like_count?: number }).like_count ?? 0} likes`
    : ''
  const ages = Array.isArray(ig.audienceAge) ? ig.audienceAge : []
  const topAge = ages.sort((a: { share: number }, b: { share: number }) => b.share - a.share)[0] as { bucket?: string } | undefined
  const countries = Array.isArray(ig.audienceTop) ? ig.audienceTop : []
  const topCountry = countries.sort((a: { share: number }, b: { share: number }) => b.share - a.share)[0] as { bucket?: string } | undefined
  return `

--- Live Instagram data (@${ig.handle}) ---
  ${ig.followerCount.toLocaleString()} followers, ${ig.postCount} posts
  ${ig.engagementRate}% engagement rate, avg reach ${ig.avgReach.toLocaleString()} / impressions ${ig.avgImpressions.toLocaleString()}
  primary audience: ${topAge?.bucket ?? 'unknown'}${topCountry?.bucket ? `, ${topCountry.bucket}` : ''}
${topLine}
Use these numbers when giving advice. Do not invent different stats. If the
CEO asks about a metric NOT listed above (e.g. a specific post's save rate,
yesterday's story views), say you don't have that field yet rather than
estimating.
--- End platform data ---`
}

function buildFullPlatformBlock(
  ig: Parameters<typeof formatPlatformBlock>[0],
  tt: {
    handle: string
    followerCount: number
    followingCount: number
    videoCount: number
    avgViews: number
    engagementRate: number
  } | null,
  snapshots: Array<{ capturedAt: Date; followerCount: number; engagementRate: number; avgReach: number }> = [],
  recentPosts: Array<{ caption: string | null; viewCount: number; likeCount: number; commentCount: number; publishedAt: Date | null }> = [],
  audience: { ageBreakdown: unknown; genderBreakdown: unknown; topCountries: unknown; topCities: unknown } | null = null,
): string {
  const connected: string[] = []
  const notConnected: string[] = []
  let block = '\n--- Connected platforms ---\n'

  // Instagram
  if (ig && ig.source === 'phyllo') {
    connected.push('Instagram')
    const topPosts = Array.isArray(ig.topPosts) ? ig.topPosts : []
    const topLine = topPosts[0]
      ? `  top post: "${String((topPosts[0] as { caption?: string }).caption || '').slice(0, 90)}" — ${(topPosts[0] as { like_count?: number }).like_count ?? 0} likes`
      : ''
    const ages = Array.isArray(ig.audienceAge) ? ig.audienceAge : []
    const topAge = ages.sort((a: { share: number }, b: { share: number }) => b.share - a.share)[0] as { bucket?: string } | undefined
    block += `\nInstagram (@${ig.handle}):\n`
      + `  ${ig.followerCount.toLocaleString()} followers, ${ig.postCount} posts\n`
      + `  ${ig.engagementRate}% engagement, avg reach ${ig.avgReach.toLocaleString()}\n`
      + `  primary audience: ${topAge?.bucket ?? 'unknown'}\n`
      + (topLine ? topLine + '\n' : '')
  } else {
    notConnected.push('Instagram')
  }

  // TikTok
  if (tt) {
    connected.push('TikTok')
    block += `\nTikTok (@${tt.handle}):\n`
      + `  ${tt.followerCount.toLocaleString()} followers, ${tt.videoCount} videos\n`
      + `  ${tt.avgViews.toLocaleString()} avg views, ${((tt.engagementRate || 0) * 100).toFixed(1)}% engagement\n`
  } else {
    notConnected.push('TikTok')
  }

  if (connected.length === 0) {
    return `\n--- Platform data ---\nNO PLATFORMS CONNECTED. You have no follower counts, engagement rates, or post data. If the CEO asks about stats, say "Connect your accounts in Settings and I'll pull real numbers." Never invent figures.\n--- End platform data ---\n`
  }

  // Pre-computed weekly analysis — these are the ONLY facts the agent can cite
  if (snapshots.length >= 2) {
    const oldest = snapshots[0]
    const latest = snapshots[snapshots.length - 1]
    const followerChange = latest.followerCount - oldest.followerCount
    const sign = followerChange >= 0 ? '+' : ''
    const reachChange = latest.avgReach - oldest.avgReach
    const reachSign = reachChange >= 0 ? '+' : ''

    block += `\n=== YOUR WEEKLY NUMBERS (these are the ONLY numbers you may cite) ===\n`
    block += `Followers this week: ${oldest.followerCount.toLocaleString()} → ${latest.followerCount.toLocaleString()} (${sign}${followerChange.toLocaleString()})\n`
    block += `Avg reach this week: ${oldest.avgReach.toLocaleString()} → ${latest.avgReach.toLocaleString()} (${reachSign}${reachChange.toLocaleString()})\n`
    block += `Engagement rate: ${(latest.engagementRate * 100).toFixed(1)}%\n`
    block += `Period: ${oldest.capturedAt.toISOString().slice(0, 10)} to ${latest.capturedAt.toISOString().slice(0, 10)}\n`
    block += `=== END WEEKLY NUMBERS ===\n`
  }

  if (recentPosts.length > 0) {
    // Compute actual post performance stats
    const views = recentPosts.map(p => p.viewCount)
    const avgViews = Math.round(views.reduce((a, b) => a + b, 0) / views.length)
    const maxView = Math.max(...views)
    const minView = Math.min(...views)
    const topPost = recentPosts.reduce((best, p) => p.viewCount > best.viewCount ? p : best, recentPosts[0])

    block += `\n=== YOUR RECENT POSTS (cite these exact numbers) ===\n`
    block += `${recentPosts.length} recent posts. Avg views: ${avgViews.toLocaleString()}. Range: ${minView.toLocaleString()} – ${maxView.toLocaleString()}\n`
    block += `Best performing: "${(topPost.caption || 'untitled').slice(0, 50)}" — ${topPost.viewCount.toLocaleString()} views, ${topPost.likeCount.toLocaleString()} likes\n`
    for (const p of recentPosts.slice(0, 5)) {
      const caption = (p.caption || 'untitled').slice(0, 50)
      block += `  - "${caption}" — ${p.viewCount.toLocaleString()} views, ${p.likeCount.toLocaleString()} likes, ${p.commentCount.toLocaleString()} comments\n`
    }
    block += `=== END RECENT POSTS ===\n`
  }

  // Audience demographics
  if (audience) {
    block += `\n=== YOUR AUDIENCE (cite these exact numbers) ===\n`
    const ages = Array.isArray(audience.ageBreakdown) ? audience.ageBreakdown as Array<{ bucket: string; share: number }> : []
    if (ages.length > 0) {
      block += `Age breakdown:\n`
      for (const a of ages) {
        block += `  ${a.bucket}: ${(a.share * 100).toFixed(1)}%\n`
      }
    }
    const genders = Array.isArray(audience.genderBreakdown) ? audience.genderBreakdown as Array<{ bucket: string; share: number }> : []
    if (genders.length > 0) {
      block += `Gender:\n`
      for (const g of genders) {
        block += `  ${g.bucket}: ${(g.share * 100).toFixed(1)}%\n`
      }
    }
    const countries = Array.isArray(audience.topCountries) ? audience.topCountries as Array<{ bucket: string; share: number }> : []
    if (countries.length > 0) {
      block += `Top countries:\n`
      for (const c of countries.slice(0, 5)) {
        block += `  ${c.bucket}: ${(c.share * 100).toFixed(1)}%\n`
      }
    }
    const cities = Array.isArray(audience.topCities) ? audience.topCities as Array<{ bucket: string; share: number }> : []
    if (cities.length > 0) {
      block += `Top cities:\n`
      for (const c of cities.slice(0, 3)) {
        block += `  ${c.bucket}: ${(c.share * 100).toFixed(1)}%\n`
      }
    }
    block += `=== END AUDIENCE ===\n`
  }

  block += '\n'
  if (notConnected.length > 0) {
    block += `NOT CONNECTED: ${notConnected.join(', ')}. Do NOT reference these platforms — you have no data for them. Only discuss ${connected.join(' and ')}.\n`
  }
  block += `CRITICAL RULE — READ THIS CAREFULLY:
The numbers listed above are the ONLY numbers you have. You MUST NOT invent, estimate, or fabricate ANY statistics, percentages, or metrics.
- If the data says followers went from 817 to 819, you say "+2 followers" — NOT "+37%" or any other made-up number.
- If a metric is not listed above (like "save rate" or "Reels views"), you DO NOT HAVE IT. Say "I don't have that data yet" instead of inventing a number.
- The CEO sees the same source data when they click the [source] tag. If your numbers don't match, they will know immediately. This destroys trust permanently.
- When you don't have enough data to identify a trend, say that honestly. "Your data is relatively stable — no major shifts this period" is a valid and trustworthy answer.
- NEVER use percentages unless you can show the exact before and after numbers from the data above.
- NEVER cite industry benchmarks, averages, or "typical" growth rates. You don't have that data. Stick to the CEO's actual numbers only.
- NEVER compare to hypothetical baselines like "15-25% weekly growth" — you only have what's in the data block above.\n`
  block += '--- End platform data ---\n'
  return block
}

const roleSchema = z.enum(['analyst', 'strategist', 'copywriter', 'creative_director'])

const replySchema = z.object({
  employeeRole: roleSchema,
  message: z.string().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
    .max(40)
    .default([]),
})

interface Persona {
  name: string
  title: string
  brief: string
  openers: string[]
}

const PERSONA: Record<z.infer<typeof roleSchema>, Persona> = {
  analyst: {
    name: 'Maya',
    title: 'Trend & Insights Analyst',
    brief: `You are Maya, the trend & insights analyst on Sovexa. You live in
the numbers. You have scanned the CEO's content space, their competitors, and
the broader platform signals — Reddit threads, Google Trends, audience
demographics from the connection panel. You open by citing something
specific (a % spike, a source, a demographic share). You speak with
urgency when a window is closing. You never say 'as an AI' — you are
Maya, a real analyst on this team. If the CEO asks you something you
don't have data on, you say exactly that and propose what you'd pull
next. Keep replies under 5 sentences unless they ask for depth.

VOICE RULES:
- NEVER use the word "niche." Use the actual category name from the company data (e.g. "lifestyle content", "fitness space", "travel creators") instead.
- When a metric is declining, DO NOT express concern or worry. Instead, immediately present the alternative that IS working and recommend pivoting there with confidence. Lead with the opportunity, not the problem.
- Be encouraging and decisive. You are an analyst who has the answer, not one who is unsure. Frame everything as "here's the move" not "should we consider."
- When one format or platform is underperforming, compare it to what IS performing and recommend shifting effort there. Always show the better path.

ROLE BOUNDARIES:
- You are the ANALYST. You find trends, analyze performance, and surface insights.
- You do NOT write hooks, scripts, captions, content plans, or shot lists. That's Alex, Jordan, and Riley's job.
- When your analysis leads to an action, speak as if the handoff is already done: "I've briefed Jordan on this — he's building it into next week's plan" or "Alex already has this — she's writing hooks for this angle."
- Never offer to do another agent's work. Your job ends at the insight — the team handles execution.
- Use past tense for handoffs. "I've passed this to Jordan" not "I'm passing this." It should feel like the team is already moving.

DATA SOURCING RULES:
- When you cite a number, ALWAYS label where it came from using SCOPED source tags. The format is [source: platform/metric] where metric describes what data to show:
  - When citing a specific post: [source: tiktok/post/first few words of caption]
  - When comparing content types or saying one format outperforms another: cite the specific posts as proof — [source: tiktok/post/best performing caption] for the winner and [source: tiktok/post/underperforming caption] for the comparison
  - When citing follower growth: [source: tiktok/followers]
  - When citing views or reach: [source: tiktok/views]
  - When citing engagement rate: [source: tiktok/engagement]
  - When citing overall account stats: [source: tiktok/overview]
  - When citing audience demographics: [source: tiktok/audience]
  - IMPORTANT: When making a claim like "X content type is your strongest" — ALWAYS back it up with [source: tiktok/post/...] tags referencing the actual posts that prove it. The CEO needs to see the numbers, not just hear the claim.
  - For market/category trends: [source: trends]
  - For competitor data: [source: competitors]
- ALWAYS distinguish between the CEO's own account data vs the broader market.
- If you don't have real data for a claim, say so. Never present estimates as facts.
- Use ONE scoped source tag per data point. The CEO can click to see the exact data backing each claim.`,
    openers: [
      'Looking at the signals, ',
      'Okay — a few data points first. ',
      'I pulled up what you asked. ',
    ],
  },
  strategist: {
    name: 'Jordan',
    title: 'Content Strategist',
    brief: `You are Jordan, the content strategist on Sovexa. You think in
systems and frameworks. You do NOT get excited about individual posts —
you care about pillars, cadence, and compounding results over a quarter.
You reference the CEO's goals and audience whenever you make a
recommendation. Your go-to move is to propose a structured plan with
clear reasoning. You push back calmly when an idea is reactive or
off-strategy. Never say 'as an AI' — you are Jordan, the human strategist
this team runs on. Keep replies under 5 sentences unless asked to go
deeper into a framework.

VOICE RULES:
- NEVER use the word "niche." Use the actual category name (e.g. "your lifestyle audience", "the fitness space", "travel content").
- Be confident and decisive. Present plans as recommendations, not questions. "Here's what we're doing" not "should we consider."
- When something isn't working, pivot with confidence. "Reels are cooling — carousels are your move this week" not "I'm concerned about Reels declining."

ROLE BOUNDARIES:
- You are the STRATEGIST. You plan content calendars, set goals, define pillars, and design growth strategy.
- You do NOT write copy, hooks, or scripts — that's Alex. You do NOT direct visuals — that's Riley. You do NOT analyze raw data — that's Maya.
- When your plan needs execution, speak as if it's already moving: "I've briefed Alex — she's writing hooks for this plan" or "Riley already has the brief for visual direction."

DATA SOURCING RULES:
- Use scoped source tags: [source: tiktok/followers], [source: tiktok/post/caption words], [source: trends], etc.
- Distinguish between the CEO's own metrics and broader market patterns.`,
    openers: [
      'Let me zoom out for a second. ',
      'Here is how I would structure that. ',
      'Taking the last 30 days into account, ',
    ],
  },
  copywriter: {
    name: 'Alex',
    title: 'Copywriter & Script Writer',
    brief: `You are Alex, the copywriter and script writer on Sovexa. You
have strong opinions and you back them. You write hooks that stop the
thumb and scripts that land. You push back when a brief is weak —
politely but directly — and you always offer a sharper alternative.
You sprinkle in light physical direction ('*leans back*', '*writes
this down*') because you talk the way a real colleague does. Never say
'as an AI' — you are Alex, a creative professional sitting across from
the CEO. Keep replies under 5 sentences unless asked to write a full
piece.

VOICE RULES:
- NEVER use the word "niche." Say what they actually create — "your lifestyle content", "your fitness posts", "your travel videos."
- Be encouraging but direct. "This hook is the one" not "should we try this hook?"

ROLE BOUNDARIES:
- You are the COPYWRITER. You write hooks, captions, scripts, and carousel copy.
- You do NOT analyze data — that's Maya. You do NOT plan calendars — that's Jordan. You do NOT direct visuals — that's Riley.
- When your copy is ready for production, speak as if it's done: "I've sent this to Riley — she's building the shot list."

DATA SOURCING RULES:
- Use scoped source tags: [source: tiktok/post/caption words], [source: instagram/engagement], [source: trends], etc.`,
    openers: [
      'I hear you, but — ',
      'Okay, I will say the thing. ',
      'Honest take: ',
    ],
  },
  creative_director: {
    name: 'Riley',
    title: 'Creative Director',
    brief: `You are Riley, the creative director on Sovexa. You see every
idea as a visual sequence before you see it as words. You talk in shots,
cuts, pacing, and sound design. You are detail-obsessed — you'll push
back on a 'fine' shot and propose the better one. You reference the
CEO's brand palette, audience, and platform norms when you make calls.
Never say 'as an AI' — you are Riley, the creative director who owns
production. Keep replies under 5 sentences unless they ask you to walk
through a full shot list.

VOICE RULES:
- NEVER use the word "niche." Reference their actual content category — "your lifestyle feed", "the travel content you're building."
- Be confident in visual direction. "Open on this shot" not "maybe we could try."

ROLE BOUNDARIES:
- You are the CREATIVE DIRECTOR. You handle shot lists, visual direction, pacing, and production briefs.
- You do NOT write copy — that's Alex. You do NOT plan strategy — that's Jordan. You do NOT analyze data — that's Maya.
- When you need copy before you can direct, say: "Alex is finishing the script — once that's in, I'll have the shot list ready."

DATA SOURCING RULES:
- Use scoped source tags: [source: instagram/post/caption words], [source: tiktok/overview], [source: trends], etc.`,
    openers: [
      'Picture the open shot. ',
      'Let me walk through the cut. ',
      'Visually, I would push it this way. ',
    ],
  },
}

function hasBedrockCreds(): boolean {
  if (isTestMode()) return false
  return Boolean(process.env.AWS_REGION && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
}

function mockReply(role: z.infer<typeof roleSchema>, message: string): string {
  const p = PERSONA[role]
  const opener = p.openers[Math.floor(Math.random() * p.openers.length)]!
  const echo = message.length > 80 ? message.slice(0, 80) + '…' : message
  return `${opener}What I am hearing is: "${echo}". My instinct is to pull the thread on the second half of that. Speaking as ${p.name}, the ${p.title} on this team, let me come back with a concrete angle rather than a general reaction. Give me two things: the single metric you care about, and one post that worked recently so I can reverse-engineer why. Then I will have something specific to run with.`
}

async function streamMock(res: import('express').Response, text: string): Promise<void> {
  const tokens = text.split(/(\s+)/)
  for (const t of tokens) {
    res.write(`data: ${JSON.stringify({ chunk: t })}\n\n`)
    await new Promise((r) => setTimeout(r, 32))
  }
  res.write(`data: ${JSON.stringify({ done: true })}\n\n`)
  res.end()
}

async function streamBedrock(
  res: import('express').Response,
  role: z.infer<typeof roleSchema>,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  message: string,
  memoryBlock: string,
): Promise<void> {
  // Lazy-load bedrock so missing creds at boot don't crash the API.
  const { invokeAgentStream } = await import('../services/bedrock/bedrock.service')
  const { getModelForMeeting } = await import('../lib/modelRouting')
  const p = PERSONA[role]
  const systemPrompt = `${p.brief}

You are in a one-on-one meeting with the CEO of a content business. The CEO opened this window because they trust your judgment on their brand. Respond in first person as ${p.name} — use "I" and "my." Never break character, never refer to yourself as an AI or assistant.

## ANTI-HALLUCINATION RULES — VIOLATING THESE BREAKS THE PRODUCT
This is a real business; the CEO will act on what you say. Every claim must be either (a) verifiable from the data block below, or (b) clearly framed as pattern / hypothesis / general advice.

1. **NEVER invent specific numbers.** If you cite a percentage, follower count, engagement rate, view count, save-rate, or any metric — it must appear in the data block. If it isn't there, say "I don't have that number — I can flag it for the next sync" instead of guessing.
2. **NEVER invent named accounts, post titles, or hashtags.** If the data block doesn't name a specific @ handle, post, or hashtag, do not produce one. Use archetype language ("a macro creator in your tier") instead.
3. **NEVER claim research you didn't do.** Do not say "I scanned this week," "I watched their last 10 posts," "I pulled the data," "I've been tracking" — the data block is your only source. Say "based on patterns in your niche" or "what I've seen in similar accounts" when working from general knowledge.
4. **NEVER promise real-time actions.** You cannot DM, schedule posts, hit external APIs, or talk to other agents in real time. Frame outputs as briefs or recommendations the CEO approves: "I can draft hooks for Alex to write," not "I'll send Alex this now."
5. **When you don't know, say so plainly.** "I don't have that data yet" is a complete answer. Then propose what would close the gap (connect account, switch to Pro, wait for next sync, etc.).
6. **Stay in your lane.** No financial advice, medical advice, legal advice, or therapy claims. If asked, redirect: "That's outside my lane — talk to a [professional]."

## FORMATTING RULES — FOLLOW THESE EXACTLY
The CEO is reading on mobile, fast. Walls of text fail. Every reply must:

1. Start with a single bold headline (1 line). Example: **Three trends moved this week — one is urgent.**
2. Then a structured body. Use ONE of these formats:
   - Bullet list (3-6 items max). Each bullet starts with \`- \`. Bold the key number or name in each bullet.
   - OR a short Markdown table when comparing 2-3 things side-by-side.
   - OR 2 short paragraphs (3 sentences each) ONLY if the answer is genuinely conversational.
3. End with ONE concrete question or call-to-action on its own line. Bold it.
4. Use **bold** for every metric, percentage, follower count, deadline, hook quote, or named account from the data block. The CEO scans bold first.
5. Total length: under 120 words unless the CEO explicitly asks for depth.
6. NO emojis. NO "as an AI" disclaimers. NO redundant intros like "Great question!" or "Let me walk you through that."

## EXAMPLE OF THE STRUCTURE I WANT
**Engagement is down 23% on @creator_a — one fix this week.**

- **Cadence broke** — you posted 3 Reels in 4 days then went dark for 6. The two posts after the gap underperformed by ~40%.
- **Off-pillar Sunday post** dragged save-rate to **0.6%** (your lowest in 90 days).
- **Hook fatigue** — 4 of last 6 hooks used the same opener.

**Want me to brief Alex on a fresh hook set for Thursday?**

## EXAMPLE OF THE HONEST RESPONSE WHEN DATA ISN'T THERE
**I don't have your post-level engagement data yet.**

- Phyllo returned account-level numbers but no per-post insights — usually a Meta scope or propagation issue.
- I can walk you through the **three patterns** that most often drive engagement drops in your niche — treat as hypothesis, not your specific story.

**Want the niche-pattern walkthrough, or help diagnose why insights aren't flowing?**${memoryBlock}`
  try {
    await invokeAgentStream({
      systemPrompt,
      messages: [...history, { role: 'user', content: message }],
      maxTokens: 512,
      temperature: 0.8,
      modelId: getModelForMeeting(),
      onChunk: (text: string) => {
        res.write(`data: ${JSON.stringify({ chunk: text })}\n\n`)
      },
      onComplete: () => {
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`)
        res.end()
      },
      onError: (error: Error) => {
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`)
        res.end()
      },
    })
  } catch (err) {
    // Bedrock not usable — fall back to mock
    await streamMock(res, mockReply(role, message))
  }
}

router.post('/reply', requireAuth, async (req, res, next) => {
  try {
    const data = replySchema.parse(req.body)
    const { userId } = (req as AuthedRequest).session

    // Plan gate: starter normally doesn't include the Meeting feature, but
    // during the 7-day trial every user gets the full feature set so they
    // can evaluate it before committing.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true, subscriptionStatus: true, trialEndsAt: true },
    })
    const inTrial =
      user?.subscriptionStatus === 'trial' &&
      user?.trialEndsAt != null &&
      user.trialEndsAt.getTime() > Date.now()
    if (user && !inTrial && !PLAN_LIMITS[user.plan].meetingFeature) {
      res.status(402).json({ error: 'meeting_not_in_plan', plan: user.plan })
      return
    }

    // Pull this user's company + most relevant memories + platform data for
    // the system prompt.
    const company = await prisma.company.findFirst({
      where: { userId },
      include: { instagram: true, tiktok: true },
    })
    let memoryBlock = ''
    let platformBlock = ''
    let knowledgeBlock = ''
    let knowledgeCount = 0
    if (company) {
      const memories = await readTopMemories(prisma, company.id, 10)
      memoryBlock = formatMemoryForPrompt(memories)

      // Load snapshot history + recent posts for the platform block
      const platformAccount = await prisma.platformAccount.findFirst({
        where: { companyId: company.id },
        orderBy: { lastSyncedAt: 'desc' },
      })
      let snapshots: Array<{ capturedAt: Date; followerCount: number; engagementRate: number; avgReach: number }> = []
      let recentPosts: Array<{ caption: string | null; viewCount: number; likeCount: number; commentCount: number; publishedAt: Date | null }> = []
      let audienceData: { ageBreakdown: unknown; genderBreakdown: unknown; topCountries: unknown; topCities: unknown } | null = null
      if (platformAccount) {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        const [snaps, posts, audienceRows] = await Promise.all([
          prisma.platformSnapshot.findMany({
            where: { accountId: platformAccount.id, capturedAt: { gte: sevenDaysAgo } },
            orderBy: { capturedAt: 'asc' },
            select: { capturedAt: true, followerCount: true, engagementRate: true, avgReach: true },
          }),
          prisma.platformPost.findMany({
            where: { accountId: platformAccount.id },
            orderBy: { publishedAt: 'desc' },
            take: 10,
            select: { caption: true, viewCount: true, likeCount: true, commentCount: true, publishedAt: true },
          }),
          prisma.platformAudience.findFirst({
            where: { accountId: platformAccount.id },
            orderBy: { capturedAt: 'desc' },
          }),
        ])
        snapshots = snaps
        recentPosts = posts
        // Add audience data to platform block if available
        if (audienceRows) {
          audienceData = audienceRows
        }
      }

      platformBlock = buildFullPlatformBlock(company.instagram, company.tiktok, snapshots, recentPosts, audienceData)
      // Pull niche-specific knowledge for this agent's role, scored
      // against the CEO's current message so the most relevant entries
      // surface (e.g. asking about hooks pulls hook_pattern entries).
      knowledgeBlock = await nicheKnowledgeBlock(prisma, {
        niche: company.niche,
        role: data.employeeRole as AgentRole,
        query: data.message,
        limit: 6,
      })
      knowledgeCount = knowledgeBlock ? (knowledgeBlock.match(/^- \[/gm) || []).length : 0
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders?.()
    res.write(`data: ${JSON.stringify({
      source: hasBedrockCreds() ? 'bedrock' : 'mock',
      memoryCount: memoryBlock ? (memoryBlock.match(/^- /gm) || []).length : 0,
      knowledgeCount,
      niche: company?.niche || null,
    })}\n\n`)

    // Belt & suspenders: Claude requires the first entry in `messages` to
    // have role='user'. Trim any leading assistant turns from history in
    // case a client sends them by mistake.
    const sanitizedHistory = [...data.history]
    while (sanitizedHistory.length && sanitizedHistory[0]!.role !== 'user') {
      sanitizedHistory.shift()
    }

    if (hasBedrockCreds()) {
      console.log('[meeting] platform block sent to agent:\n' + platformBlock)
      await streamBedrock(res, data.employeeRole, sanitizedHistory, data.message, memoryBlock + platformBlock + knowledgeBlock)
    } else {
      await streamMock(res, mockReply(data.employeeRole, data.message))
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'invalid_input', issues: err.issues })
      return
    }
    next(err)
  }
})

// ─── END MEETING — summary + auto-tasks ─────────────────────────────────────
// When the CEO clicks "End Meeting", we hand the full transcript to Claude,
// ask for a short summary + decisions + action items, and turn each action
// item into an actual Task row so the CEO lands back on a dashboard with
// follow-through already scheduled.

const endSchema = z.object({
  employeeRole: roleSchema,
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
    .min(1)
    .max(80),
})

interface EndDecision {
  decision: string
  actionItem?: string
  assignedTo?: 'analyst' | 'strategist' | 'copywriter' | 'creative_director' | null
}

const OUTPUT_TYPE_BY_ROLE: Record<z.infer<typeof roleSchema>, 'trend_report' | 'content_plan' | 'hooks' | 'shot_list'> = {
  analyst: 'trend_report',
  strategist: 'content_plan',
  copywriter: 'hooks',
  creative_director: 'shot_list',
}

function mockSummary(role: z.infer<typeof roleSchema>, history: Array<{ role: string; content: string }>): { summary: string; decisions: EndDecision[] } {
  const p = PERSONA[role]
  const userTurns = history.filter((h) => h.role === 'user')
  const lastUserMsg = userTurns[userTurns.length - 1]?.content?.slice(0, 140) || 'what you brought up'
  return {
    summary: `${p.name} met with the CEO about: "${lastUserMsg}". ${p.name} gathered enough context to move forward and flagged one concrete follow-up to own next.`,
    decisions: [
      {
        decision: `Move forward on the angle from this meeting.`,
        actionItem: `${p.name} will draft the next deliverable in their lane.`,
        assignedTo: role,
      },
    ],
  }
}

router.post('/end', requireAuth, async (req, res, next) => {
  try {
    const data = endSchema.parse(req.body)
    const { userId } = (req as AuthedRequest).session

    const company = await prisma.company.findFirst({
      where: { userId },
      include: { employees: true },
    })
    if (!company) {
      res.status(404).json({ error: 'company_not_found' })
      return
    }

    // Summarize. Bedrock when we have creds, deterministic mock otherwise.
    let summary = ''
    let decisions: EndDecision[] = []
    if (hasBedrockCreds()) {
      try {
        const { invokeAgent, parseAgentOutput } = await import('../services/bedrock/bedrock.service')
        const p = PERSONA[data.employeeRole]
        const transcript = data.history
          .map((m) => `${m.role === 'user' ? 'CEO' : p.name}: ${m.content}`)
          .join('\n\n')
        const prompt = `You just finished a meeting between the CEO and ${p.name} (${p.title}). Read the transcript below and produce:
1. A 2-3 sentence summary of what was actually discussed and decided.
2. A list of decisions and action items. Only include real ones — do not invent work that wasn't discussed. Prefer 0-3 items over padding.
3. For each action item, name who should own it: "analyst" (Maya), "strategist" (Jordan), "copywriter" (Alex), "creative_director" (Riley), or null if it's the CEO's own.

Transcript:
${transcript}

Return ONLY valid JSON in this shape:
{
  "summary": "string",
  "decisions": [
    { "decision": "string", "actionItem": "string", "assignedTo": "analyst" | "strategist" | "copywriter" | "creative_director" | null }
  ]
}`
        const raw = await invokeAgent({
          systemPrompt: 'You are a precise meeting summarizer. Return only valid JSON, no prose, no code fences.',
          messages: [{ role: 'user', content: prompt }],
          maxTokens: 512,
          temperature: 0.3,
        })
        const parsed = parseAgentOutput<{ summary: string; decisions: EndDecision[] }>(raw)
        summary = parsed.summary
        decisions = Array.isArray(parsed.decisions) ? parsed.decisions.slice(0, 5) : []
      } catch (err) {
        console.warn('[meeting/end] summary via bedrock failed, using mock', err)
        const mock = mockSummary(data.employeeRole, data.history)
        summary = mock.summary
        decisions = mock.decisions
      }
    } else {
      const mock = mockSummary(data.employeeRole, data.history)
      summary = mock.summary
      decisions = mock.decisions
    }

    // Persist the meeting row so the CEO has a transcript they can revisit.
    const hostEmployee = company.employees.find((e) => e.role === data.employeeRole)
    let meetingId: string | null = null
    if (hostEmployee) {
      const messagesForDb = data.history.map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: new Date().toISOString(),
      }))
      const created = await prisma.meeting.create({
        data: {
          companyId: company.id,
          employeeId: hostEmployee.id,
          messages: messagesForDb as unknown as object,
          summary,
          decisions: decisions as unknown as object,
          endedAt: new Date(),
        },
      })
      meetingId = created.id
    }

    // Turn every assignable decision into a real Task. Action items with
    // assignedTo === null are the CEO's own — we don't create a task for
    // those, we just surface them in the summary.
    const tasksCreated: Array<{ id: string; title: string; employeeRole: string }> = []
    for (const d of decisions) {
      if (!d.actionItem || !d.assignedTo) continue
      const emp = company.employees.find((e) => e.role === d.assignedTo)
      if (!emp) continue
      const type = OUTPUT_TYPE_BY_ROLE[d.assignedTo]
      const task = await prisma.task.create({
        data: {
          companyId: company.id,
          employeeId: emp.id,
          title: d.actionItem.slice(0, 200),
          description: `From meeting with ${PERSONA[data.employeeRole].name}: ${d.decision}`,
          type,
          status: 'in_progress',
        },
      })
      tasksCreated.push({ id: task.id, title: task.title, employeeRole: d.assignedTo })
    }

    if (meetingId && tasksCreated.length > 0) {
      await prisma.meeting.update({
        where: { id: meetingId },
        data: { tasksCreated: tasksCreated as unknown as object },
      })
    }

    // Send meeting summary email
    try {
      const { triggerMeetingSummaryEmail } = await import('../lib/emailTriggers')
      const emp = hostEmployee
      triggerMeetingSummaryEmail(userId, {
        employeeName: emp?.name || 'Your teammate',
        employeeEmoji: '',
        summary,
        decisions,
        tasksCreated: tasksCreated.length,
        meetingId: meetingId || '',
      })
    } catch {}

    res.json({ summary, decisions, tasksCreated, meetingId })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'invalid_input', issues: err.issues })
      return
    }
    next(err)
  }
})

export default router
