/**
 * Agent executor.
 *
 * Routes each brief to a dedicated generator keyed by briefKind so five
 * briefs with the same OutputType don't produce identical content. The
 * old type-based mocks are kept as a fallback for briefs that don't
 * carry a briefKind (ad-hoc tasks from meeting summaries, etc.).
 *
 * Paths:
 *   1. Bedrock — when AWS creds are configured, races an 8s timeout.
 *      If it returns valid JSON in time, we ship that.
 *   2. briefKind generator — the per-preset mock. Each produces
 *      distinct, niche-aware content that actually answers the brief.
 *   3. type fallback — generic mock keyed on OutputType.
 */
import { PrismaClient, OutputType, Prisma } from '@prisma/client'
import { retrieveNicheKnowledge, bucketForNiche, AgentRole } from '../lib/nicheKnowledge'
import { readTopMemories, formatMemoryForPrompt } from '../lib/brandMemory'
import { invokeAgent, parseAgentOutput } from './bedrock/bedrock.service'
import { isTestMode } from '../lib/mode'
import {
  PersonalContext,
  loadPersonalContext,
  pickFromPool,
  rotatePool,
  followerTier,
  fmtFollowers,
  topShare,
} from '../lib/personalContext'

interface ExecuteOpts {
  taskId: string
  companyId: string
  niche: string
  role: AgentRole
  type: OutputType
  title: string
  description?: string | null
  briefKind?: string | null
  /** Optional pre-loaded context. If omitted, the executor loads it
   *  from the DB via companyId. Passing it in lets callers (like the
   *  test harness) supply a stub without DB roundtrips. */
  personal?: PersonalContext | null
}

export interface ExecutionResult {
  content: Record<string, unknown>
  knowledgeUsed: number
  source: 'bedrock' | 'mock'
}

function hasBedrockCreds(): boolean {
  if (isTestMode()) return false
  return Boolean(process.env.AWS_REGION && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
}

const PERSONA_NAME: Record<AgentRole, string> = {
  analyst: 'Maya', strategist: 'Jordan', copywriter: 'Alex', creative_director: 'Riley',
}

interface KnowledgeRow {
  kind: string
  title: string
  body: string
  tags: string[]
}

// Reference shape used by every brief that wants to surface concrete
// examples — the user's own top posts when Phyllo has data, niche
// patterns / named competitor archetypes otherwise. The renderer turns
// these into cards in the brief detail modal so the CEO sees real
// examples instead of just descriptions.
interface BriefReference {
  label: string
  source: 'creator_own' | 'competitor' | 'niche_pattern' | 'external'
  attribution?: string
  caption?: string
  text?: string
  whyItWorks?: string
  permalink?: string | null
  thumbnailSpec?: string
  metrics?: string
}

/** Pulls the creator's own top posts as reference cards. Returns up to
 *  N items. Empty array if no IG data — caller falls back to niche
 *  patterns. */
function ownTopPostsAsReferences(ctx: PersonalContext | null, n = 2): BriefReference[] {
  const ig = ctx?.instagram
  if (!ig || ig.source !== 'phyllo' || !ig.topPosts.length) return []
  return ig.topPosts.slice(0, n).map((p, i) => ({
    label: i === 0 ? 'Your strongest recent post' : 'Another high-performer',
    source: 'creator_own' as const,
    attribution: `@${ig.handle}`,
    caption: p.caption || 'untitled',
    permalink: p.permalink,
    metrics: `${p.likeCount.toLocaleString()} likes · ${p.commentCount.toLocaleString()} comments · ${p.mediaType.toLowerCase().replace('_album', '')}`,
    whyItWorks: i === 0 ? 'Mirror this structure. Specifically: the hook framing and the cut that earns the scroll.' : 'Same family — note what the two have in common.',
  }))
}

// ─────────────────────────────────────────────────────────────────────
// NICHE-SPECIFIC COPY TOKENS
// Thin tokens the generators weave in so outputs feel like the niche
// the CEO told us about. Falls back to neutral language when bucket is
// 'default'.
// ─────────────────────────────────────────────────────────────────────
interface NicheTokens {
  label: string
  sampleTrend: string
  sampleTrend2: string
  samplePillars: [string, string, string]
  sampleCompetitors: [string, string, string]
  sampleHashtagsBig: string[]
  sampleHashtagsMid: string[]
  sampleHashtagsSmall: string[]
  audiencePrimary: string
  peakWindow: string
  languageGuardrails: string[]
  savePattern: string
  // Niche-specific examples so generated hooks / captions don't read as
  // fitness-coded for a finance creator (the classic "45 minutes of
  // cardio" bug).
  specificNumberHook: string                       // "The 15-minute X swap..."
  swapHook: string                                 // "Stop X. Start Y."
  captionBody: string                              // multi-line caption body
  replacementMoves: [string, string, string]       // "The X that quietly..."
  wedgeTopic: string                               // subject matter for the replacement
  bioOutcome: string                               // "build strength in 15 min/day"
  bioOrigin: string                                // "I was stuck too."  (B-option opener)
  bioPunchy: string                                // "Fitness. Without the noise."  (C-option tagline)
}

const NICHE_TOKENS: Record<string, NicheTokens> = {
  fitness: {
    label: 'fitness',
    sampleTrend: 'weighted walking',
    sampleTrend2: 'protein-first breakfast',
    samplePillars: ['transformation', 'myth busting', 'behind the scenes'],
    // Archetype labels — never invent specific @ handles. Real
    // competitor handles come from a comps table (future) or the user
    // typing them in. Made-up handles erode trust the moment the CEO
    // searches one and finds it doesn't exist.
    sampleCompetitors: ['Macro fitness creator (1M+)', 'Mid-tier women\'s strength account (50-100K)', 'Closest comp · sub-niche match'],
    sampleHashtagsBig: ['#fitnessmotivation', '#weightlossjourney', '#homeworkout'],
    sampleHashtagsMid: ['#weightedwalking', '#strengthafter40', '#progressoverperfection'],
    sampleHashtagsSmall: ['#lowimpactworkout', '#proteinfirst', '#healthmoms'],
    audiencePrimary: 'time-poor women 28-44 in the transformation arc',
    peakWindow: 'Sun 8-9pm ET + weekday 5:30-7am ET',
    languageGuardrails: ['Avoid bro vocabulary ("crush", "beast mode")', 'Use capacity verbs ("you get to")', 'Specific numbers over ranges'],
    savePattern: 'Audience saves 4.1x more than they share — optimize for save behavior.',
    specificNumberHook: 'The 15-minute weighted walk that burns more than 45 minutes of cardio.',
    swapHook: 'Stop the treadmill. Start walking weighted. Here is why the swap works.',
    captionBody: `It\'s not about doing more. It\'s about doing the one thing that actually moves the needle.\n\nHere is what I swapped:\n— The 45-minute session that was quietly killing my recovery\n— The tracking obsession that made consistency impossible\n— The all-or-nothing mindset\n\nWhat replaced it?\nWalks. Specifically, weighted walks. 15 minutes. Three times a week.\n\nThat\'s it.`,
    replacementMoves: ['The 45-minute session that was quietly killing my recovery', 'The tracking obsession that made consistency impossible', 'The all-or-nothing mindset'],
    wedgeTopic: 'low-impact, time-efficient training',
    bioOutcome: 'build strength without living in the gym',
    bioOrigin: 'I was stuck in the 45-min cardio loop too.',
    bioPunchy: 'Fitness. Without the noise.',
  },
  finance: {
    label: 'finance',
    sampleTrend: 'HYSA rate-chase',
    sampleTrend2: 'three-account system',
    samplePillars: ['frameworks', 'myth busting', 'real numbers'],
    sampleCompetitors: ['Macro personal-finance creator (500K+)', 'Mid-tier framework-led account (50-150K)', 'Closest comp · beginner-money sub-niche'],
    sampleHashtagsBig: ['#personalfinance', '#moneytips', '#financialfreedom'],
    sampleHashtagsMid: ['#hysa', '#emergencyfund', '#debtfreejourney'],
    sampleHashtagsSmall: ['#sinkingfunds', '#threeaccountsystem', '#moneyreset'],
    audiencePrimary: 'action-paralyzed 25-40, one or two savings accounts',
    peakWindow: 'Mon 7-8am ET + Sun 8-10pm ET',
    languageGuardrails: ['Avoid hype/crypto ("to the moon", "10x")', 'Use precise account terms (HYSA, Roth IRA)', 'Exact dollars beat percentages'],
    savePattern: 'Carousels save 6-8x more than Reels — structure advice as screenshot-friendly frameworks.',
    specificNumberHook: 'The 5-minute move that earned me $40 more in interest than I made all of last year.',
    swapHook: 'Stop budgeting to the dollar. Start with a three-account system. Here is why the swap works.',
    captionBody: `It\'s not about earning more. It\'s about routing the money you already make to the right place.\n\nHere is what I swapped:\n— The single checking account that quietly leaked $200/month\n— The budgeting spreadsheet I filled out once and abandoned\n— The "I\'ll start investing when I earn more" mindset\n\nWhat replaced it?\nThree accounts: checking, HYSA, brokerage. One rule: money hits checking, splits automatically the same day.\n\nThat\'s it.`,
    replacementMoves: ['The single checking account that quietly leaked $200/month', 'The budgeting spreadsheet I filled out once and abandoned', 'The "I\'ll start investing when I earn more" mindset'],
    wedgeTopic: 'structure-of-account advice for beginners',
    bioOutcome: 'stop leaking money every month',
    bioOrigin: 'I had one checking account and no plan too.',
    bioPunchy: 'Money. Without the hype.',
  },
  food: {
    label: 'food',
    sampleTrend: 'cottage cheese dessert',
    sampleTrend2: 'no-flour bread',
    samplePillars: ['quick wins', 'ingredient deep-dives', 'kitchen stories'],
    sampleCompetitors: ['Macro recipe creator (500K+)', 'Mid-tier high-protein account (50-150K)', 'Closest comp · macro-friendly sub-niche'],
    sampleHashtagsBig: ['#easyrecipes', '#healthyrecipes', '#highproteinrecipes'],
    sampleHashtagsMid: ['#cottagecheese', '#5minuterecipes', '#macrofriendly'],
    sampleHashtagsSmall: ['#onepanmeal', '#labelreading', '#pantrymakeover'],
    audiencePrimary: 'intermediate home cooks optimizing for macros + time',
    peakWindow: 'Weekday 4-6pm ET + Sat 9-11am ET',
    languageGuardrails: ['Use sensory verbs (crackle, fold, melt)', 'Show macros on-screen if you claim them', 'Trending audio > custom voiceover for recipes'],
    savePattern: 'Recipe Reels get saved at grocery-day rates — optimize for bookmark-ability.',
    specificNumberHook: 'The 4-ingredient dessert that has more protein than your dinner.',
    swapHook: 'Stop reaching for protein bars. Start blending cottage cheese. Here is why the swap works.',
    captionBody: `It\'s not about eating less. It\'s about swapping one ingredient that changes the macros.\n\nHere is what I swapped:\n— Protein bars that cost $4 a pop and never filled me up\n— Yogurt cups that were half sugar by weight\n— "Healthy" snack mixes that were just candy with almonds\n\nWhat replaced it?\nCottage cheese. Blended smooth with cocoa + maple. 4 ingredients. 22g protein.\n\nThat\'s it.`,
    replacementMoves: ['Protein bars that cost $4 a pop and never filled me up', 'Yogurt cups that were half sugar by weight', '"Healthy" snack mixes that were just candy with almonds'],
    wedgeTopic: 'ingredient-swap recipes that hit macros',
    bioOutcome: 'hit your macros without meal-prep Sundays',
    bioOrigin: 'I was buying $4 protein bars too.',
    bioPunchy: 'Real food. Fast.',
  },
  coaching: {
    label: 'coaching',
    sampleTrend: 'micro-habits over goals',
    sampleTrend2: 'burnout recovery frameworks',
    samplePillars: ['frameworks', 'transformation proof', 'hot takes'],
    sampleCompetitors: ['Macro coaching creator (300K+)', 'Mid-tier framework-led coach (40-120K)', 'Closest comp · vertical-niche coach'],
    sampleHashtagsBig: ['#coachinglife', '#executivecoach', '#careerdevelopment'],
    sampleHashtagsMid: ['#microhabits', '#firsttimemanager', '#burnoutrecovery'],
    sampleHashtagsSmall: ['#coachingframework', '#decisionfatigue', '#leadershipreset'],
    audiencePrimary: 'high-agency decision-makers, evidence-seeking',
    peakWindow: 'Mon 7-9am ET + Thu 8-10pm ET',
    languageGuardrails: ['Avoid therapeutic claims ("trauma response", "regulation")', 'Frameworks with numbers ("the 4-step reset")', 'Named client wins beat vague transformation stories'],
    savePattern: 'Newsletter + pinned cornerstone carousel = compound distribution.',
    specificNumberHook: 'The 4-step reset I walk every client through in session one.',
    swapHook: 'Stop setting quarterly goals. Start stacking micro-habits. Here is why the swap works.',
    captionBody: `It\'s not about motivation. It\'s about removing one decision from your day.\n\nHere is what I swapped:\n— The yearly planning session that produced nothing by March\n— The to-do list that grew faster than I could ship\n— The "I\'ll start Monday" mindset\n\nWhat replaced it?\nOne habit. Ten minutes. Same time every day.\n\nThat\'s it.`,
    replacementMoves: ['The yearly planning session that produced nothing by March', 'The to-do list that grew faster than I could ship', 'The "I\'ll start Monday" mindset'],
    wedgeTopic: 'structural habit design, not motivation content',
    bioOutcome: 'build habits that actually stick',
    bioOrigin: 'I was the "I\'ll start Monday" person too.',
    bioPunchy: 'Coaching. Without the motivation poster.',
  },
  lifestyle: {
    label: 'lifestyle',
    sampleTrend: 'Sunday reset',
    sampleTrend2: 'capsule wardrobe',
    samplePillars: ['aesthetic', 'routine', 'product discovery'],
    sampleCompetitors: ['Macro lifestyle creator (500K+)', 'Mid-tier aesthetic-led account (50-150K)', 'Closest comp · slow-living sub-niche'],
    sampleHashtagsBig: ['#lifestyleblogger', '#sundayreset', '#minimalism'],
    sampleHashtagsMid: ['#slowliving', '#capsulewardrobe', '#cozycorner'],
    sampleHashtagsSmall: ['#aestheticmornings', '#thisweekrituals', '#softlivingaesthetic'],
    audiencePrimary: 'identity-projecting audience, aesthetic-first',
    peakWindow: 'Sun 6-8pm ET + weekday 8-10pm ET',
    languageGuardrails: ['Sensory + seasonal language (autumn-light, cinnamon)', 'Ground aspirational frames with one specific detail', 'Avoid pure aspirationalism'],
    savePattern: 'Daily stories are non-negotiable — that is where parasocial trust is built.',
    specificNumberHook: 'The 20-minute Sunday reset that changed how every week feels.',
    swapHook: 'Stop planning the week in a notebook. Start with a 20-minute room reset. Here is why the swap works.',
    captionBody: `It\'s not about having more. It\'s about holding the week with one ritual that carries you through Monday.\n\nHere is what I swapped:\n— The Sunday-night planning session that left me more tired\n— The long to-do list that made Monday feel heavier\n— The "I\'ll just wing it" mindset\n\nWhat replaced it?\nA 20-minute reset. Bed made. Counter clear. One candle lit. Coffee prepped.\n\nThat\'s it.`,
    replacementMoves: ['The Sunday-night planning session that left me more tired', 'The long to-do list that made Monday feel heavier', 'The "I\'ll just wing it" mindset'],
    wedgeTopic: 'ritual-based calm instead of productivity optimization',
    bioOutcome: 'make your Sunday reset feel like a ritual, not a chore',
    bioOrigin: 'I was a Sunday-night-spiral person too.',
    bioPunchy: 'Slow living. On purpose.',
  },
  default: {
    label: 'your niche',
    sampleTrend: 'your signature angle',
    sampleTrend2: 'your pillar play',
    samplePillars: ['signature story', 'myth busting', 'behind the scenes'],
    sampleCompetitors: ['@comp_one', '@comp_two', '@comp_three'],
    sampleHashtagsBig: ['#yourniche', '#contentcreator', '#smallbusiness'],
    sampleHashtagsMid: ['#yoursubniche', '#weeklyseries', '#creatortips'],
    sampleHashtagsSmall: ['#yourwedge', '#niche_specific', '#community_tag'],
    audiencePrimary: 'your core audience (data pending first sync)',
    peakWindow: 'Peak windows will land once your account has synced',
    languageGuardrails: ['Be specific over vague', 'Avoid absolute claims', 'Numbers beat ranges'],
    savePattern: 'Optimize for saves until you see real engagement signal.',
    specificNumberHook: 'The one move that quietly changed everything about your lane.',
    swapHook: 'Stop [the safe play]. Start [the thing nobody in your niche does]. Here is why the swap works.',
    captionBody: `It\'s not about doing more. It\'s about doing the one thing your audience will remember you for.\n\nHere is what I would swap:\n— The safe content that never earns the scroll\n— The tactic you keep trying that never compounds\n— The comparison-scrolling habit\n\nWhat replaces it?\nYour signature move. Named. Specific. Shipped weekly.\n\nThat\'s it.`,
    replacementMoves: ['The safe content that never earns the scroll', 'The tactic you keep trying that never compounds', 'The comparison-scrolling habit'],
    wedgeTopic: 'your signature angle',
    bioOutcome: 'the one specific outcome your audience wants',
    bioOrigin: 'I was in your spot too.',
    bioPunchy: 'Your niche. On your terms.',
  },
}

function tokensFor(niche: string): NicheTokens {
  const bucket = bucketForNiche(niche)
  return NICHE_TOKENS[bucket] || NICHE_TOKENS.default!
}

// ─────────────────────────────────────────────────────────────────────
// MAYA (analyst) — 5 briefKinds
// ─────────────────────────────────────────────────────────────────────
function maya_weeklyTrends(t: NicheTokens, ctx: PersonalContext | null) {
  const ig = ctx?.instagram
  const handle = ig?.handle
  const tier = ig ? followerTier(ig.followerCount) : null
  // Predict reach in real terms when we have the creator's actual median
  // — generic "2-3x baseline" is meaningless without a baseline number.
  const medianReach = ig?.avgReach ?? 0
  const realReachLine = medianReach > 0
    ? `Conservative 2-3x your median Reel reach (~${(medianReach * 2.5).toLocaleString()} views).`
    : 'Conservative 2-3x your baseline Reel reach.'
  return {
    kind: 'weekly_trends',
    generatedAt: new Date().toISOString(),
    headline: handle
      ? `Three trends moving in ${t.label} this week — for @${handle}`
      : `Three trends moving in ${t.label} this week`,
    forCreator: handle ? `@${handle} · ${tier}` : null,
    trends: [
      {
        topic: t.sampleTrend,
        growth: '+340%', growthPct: 340, window: '48h',
        urgency: 'act_now',
        sparkline: [12, 18, 22, 35, 58, 81, 100],
        audienceFit: `Strong fit — ${t.audiencePrimary} index high on this lane.`,
        whyNow: 'Two macro-creators dropped into this lane inside the last 72 hours. Window is in the "still expanding" phase — original audio still wins, not locked to a single sound yet.',
        signals: [
          { label: 'Search interest', value: '+340% / 48h' },
          { label: 'Top-50 accounts posting', value: '11 of 50' },
          { label: 'Avg engagement on category', value: '4.2x baseline' },
          { label: 'Estimated window', value: '4-6 days' },
        ],
        competitorMoves: `${t.sampleCompetitors[0]} and ${t.sampleCompetitors[1]} both posted in the last 36h using similar angles. Neither has the carousel slot yet — that lane is still open.`,
        predictedOutcome: {
          ifAct: realReachLine + ' Aggressive: a clean breakout if the hook lands and the swap framing earns saves.',
          ifSkip: 'You give up the cleanest growth window of the month. Lane will be owned by Friday.',
        },
        insight: 'This is the cleanest window in 4 weeks. Combination of macro-creator activation + low audio saturation + open carousel lane means you can still claim a position if you ship by Thursday.',
        action: 'Ship one Reel by Thursday, then a save-bait carousel by Sunday. Reel leads with the swap framing to drive comments; carousel breaks down the math for saves.',
        solution: `Briefs are already going out: Alex writing 5 hook variations, Riley shot-listing the cut. Approve and you ship Thursday.`,
      },
      {
        topic: t.sampleTrend2,
        growth: '+180%', growthPct: 180, window: '7d',
        urgency: 'build',
        sparkline: [38, 42, 51, 60, 68, 75, 82],
        audienceFit: `Good fit — save-rate on your content in this lane is 1.8x your average. ${t.savePattern}`,
        whyNow: 'This is a 9-week sustained climb, not a spike. No single creator owns it. That means the lane is still open for a thoughtful multi-post series instead of a one-off.',
        signals: [
          { label: 'Search interest', value: '+180% / 7d · +810% / 90d' },
          { label: 'Top-50 accounts posting', value: '6 of 50 (low coverage)' },
          { label: 'Trajectory', value: 'Climbing, no saturation point' },
          { label: 'Save-to-share ratio', value: '4.1:1' },
        ],
        competitorMoves: `${t.sampleCompetitors[2]} is running a related series but single-post per topic. That format leaves the multi-day pillar framing on the table — that is your wedge.`,
        predictedOutcome: {
          ifAct: '4-post series across 2 weeks builds a pillar. Expect 1.2-1.6x baseline reach per post + 30-40% of total engagement arriving in days 8-30 via search and saves.',
          ifSkip: 'You lose a pillar opportunity. Trends like this only show up 2-3x a year for a niche.',
        },
        insight: 'Slow-burn play. Different math than the weighted-walking window — stack the series and each post seeds search + saves that keep compounding for 30+ days.',
        action: 'Build a 4-post series across 2 weeks (Mon/Wed/Fri/Mon). Pair each Reel with a carousel on the macro math. Anchor with a pinned cornerstone post on profile.',
        solution: 'Handing off to Jordan to slot weeks 2-3. I am pulling the 5 highest-saving formats from the last 90 days so we start from proven structures.',
      },
    ],
    knowledgeApplied: [] as string[],
  }
}

function maya_competitorScan(t: NicheTokens, ctx: PersonalContext | null) {
  const ig = ctx?.instagram
  const myFollowers = ig?.followerCount ?? 0
  // Size each competitor in proportion to the creator — comp #3 is always
  // "closest comp to you," so we anchor it just above the creator's tier.
  const closeTier = myFollowers > 0 ? Math.max(myFollowers * 1.05, myFollowers + 500) : 28_000
  const midTier = myFollowers > 0 ? Math.max(myFollowers * 2.5, 50_000) : 62_000
  const ceilingTier = myFollowers > 0 ? Math.max(myFollowers * 6, 120_000) : 180_000
  const sizeOf = (n: number) => `${fmtFollowers(Math.round(n))} followers`
  // Seed-stable ordering of which competitor archetype gets which tier.
  const seed = ctx?.seed ?? 0
  const competitors = rotatePool<string>(t.sampleCompetitors.slice(), seed)
  return {
    kind: 'competitor_scan',
    generatedAt: new Date().toISOString(),
    headline: ig?.handle
      ? `Three plays winning in ${t.label} right now — sized to your set`
      : `Three plays winning in ${t.label} right now`,
    forCreator: ig ? `${fmtFollowers(myFollowers)} followers · ${followerTier(myFollowers)}` : null,
    note: 'These are the formats + hook patterns over-performing at each tier in your niche this month. To run the same analysis on three specific accounts, paste their handles in chat and I will size them up.',
    plays: [
      {
        tier: `Macro tier · ~${fmtFollowers(Math.round(ceilingTier))}`,
        archetype: competitors[0],
        winningFormat: 'Reel + pinned cornerstone carousel',
        winningHook: 'Swap framing ("Stop X. Here is what actually works.")',
        winningCadence: '4 feed posts/week · Mon/Wed/Fri 6am, Sun 8pm',
        whatIsWorking: 'Creators at this tier are leaning hard into the transformation pillar with a single recurring client story. Comments loop because every post ends with a direct question.',
        copyFromThem: 'The pinned cornerstone — one big reference carousel everything routes to. That asset does distribution for months.',
        dontCopy: 'The daily posting cadence. Macro accounts have teams; one-person operations burn out before they see the lift.',
      },
      {
        tier: `Mid tier · ~${fmtFollowers(Math.round(midTier))}`,
        archetype: competitors[1],
        winningFormat: 'Carousel-first',
        winningHook: 'Counter-conventional ("You do not have a [X] problem. You have a [Y] problem.")',
        winningCadence: '3 posts/week · Tue/Thu/Sat',
        whatIsWorking: 'Carousels ending on a screenshot-friendly framework page over-perform here. Audience uses these posts as reference material — save-rate is 2x the niche baseline.',
        copyFromThem: 'The last-slide structure. Always a framework people want to bookmark. Steal the pattern, bring your own content.',
        dontCopy: 'A purely academic voice — it caps virality. Keep yours warmer.',
      },
      {
        tier: `Closest tier ahead of you · ~${fmtFollowers(Math.round(closeTier))}`,
        archetype: competitors[2],
        winningFormat: 'Reel-heavy',
        winningHook: 'Confession ("I quit X for 30 days.")',
        winningCadence: '5 posts/week (high effort)',
        whatIsWorking: 'Identity-shift confessions are the fastest-growing format at this tier — they pull 2-3x baseline reach because the audience projects themselves into the role.',
        copyFromThem: 'The identity-shift framing. It works even better on your account if you anchor it to a specific bottleneck your audience recognizes.',
        dontCopy: 'The 5-posts/week cadence. It is not sustainable solo.',
      },
    ],
    nextStep: `${PERSONA_NAME.analyst} can brief Alex on a confession-style hook set next — that is the single biggest lever from this set of plays. Or send three real handles and we run this against them specifically.`,
    knowledgeApplied: [] as string[],
  }
}

function maya_hashtagReport(t: NicheTokens, _ctx: PersonalContext | null) {
  return {
    kind: 'hashtag_report',
    generatedAt: new Date().toISOString(),
    headline: `Hashtags currently pulling reach in ${t.label}`,
    note: 'Use 3-5 per post — one from each bucket. Mixing sizes beats stacking all-big every time.',
    buckets: [
      {
        label: 'Big (2M+ posts)',
        purpose: 'Volume + discoverability. You will get routed to the right broader audience if the post is strong.',
        tags: t.sampleHashtagsBig,
        note: 'Only reach if your post sticks. If engagement in first 30 min is soft, these tags bury you.',
      },
      {
        label: 'Mid (200K-2M posts)',
        purpose: 'Sweet spot for sub-100K accounts. High intent audience, less competition.',
        tags: t.sampleHashtagsMid,
        note: 'Your best ROI bucket. Prioritize these if you had to pick just one set.',
      },
      {
        label: 'Small (<200K posts)',
        purpose: 'Niche-specific ownership. Lower reach but higher save + follow rate.',
        tags: t.sampleHashtagsSmall,
        note: 'Use these to claim a lane. Consistency here beats volume.',
      },
    ],
    avoid: [
      '#viral · dead, no reach',
      '#explorepage · Instagram de-ranked this in 2023',
      '#fyp · wrong platform',
      'Any single hashtag >10M posts unless you have real distribution',
    ],
    knowledgeApplied: [] as string[],
  }
}

function maya_audienceDeepDive(t: NicheTokens, ctx: PersonalContext | null) {
  // Pull the real audience demographics we already have from Phyllo/IG.
  // Fall back to niche-average claims when the creator hasn't connected
  // an account yet — and label them clearly as averages so the CEO knows.
  const ig = ctx?.instagram
  const handle = ig?.handle
  const topAge = ig ? topShare(ig.audienceAge) : null
  const genders = ig?.audienceGender ?? []
  const maleShare = genders.find((g) => /male/i.test(g.bucket) && !/fe/i.test(g.bucket))?.share ?? 0
  const femaleShare = genders.find((g) => /fem/i.test(g.bucket))?.share ?? 0
  const skew = femaleShare > maleShare + 0.1 ? 'female-heavy' : maleShare > femaleShare + 0.1 ? 'male-heavy' : 'roughly balanced'
  const topCountry = ig ? topShare(ig.audienceTopCountries) : null
  const topCity = ig ? topShare(ig.audienceTopCities) : null
  const hasReal = !!ig && ig.source === 'phyllo' && (ig.audienceAge.length > 0 || ig.audienceTopCountries.length > 0)

  const demographics: Array<{ label: string; value: string }> = []
  if (hasReal && handle) {
    demographics.push({ label: 'Handle', value: `@${handle} · ${fmtFollowers(ig!.followerCount)} followers` })
  } else if (handle) {
    demographics.push({ label: 'Handle', value: `@${handle} · ${fmtFollowers(ig!.followerCount)} followers (audience data pending)` })
  }
  demographics.push({
    label: 'Primary segment',
    value: hasReal && topAge
      ? `${topAge.bucket} · ${Math.round(topAge.share * 100)}% of followers · skews ${skew}`
      : `${t.audiencePrimary} (niche average — connect your account for real numbers)`,
  })
  if (hasReal && topCountry) {
    demographics.push({ label: 'Top country', value: `${topCountry.bucket} · ${Math.round(topCountry.share * 100)}% of audience` })
  }
  if (hasReal && topCity) {
    demographics.push({ label: 'Top city', value: `${topCity.bucket} · ${Math.round(topCity.share * 100)}% of audience` })
  }
  if (!hasReal) {
    demographics.push({ label: 'Status', value: 'Using niche averages until Phyllo returns audience data (needs Business account + ≥100 followers).' })
  }

  // Pick a seed-stable pillar ordering so two users in the same niche
  // see different pillars highlighted rather than identical output.
  const seed = ctx?.seed ?? 0
  const pillarsRotated = rotatePool<string>(t.samplePillars.slice(), seed)

  return {
    kind: 'audience_deep_dive',
    generatedAt: new Date().toISOString(),
    headline: hasReal
      ? `@${handle} audience · real numbers from the last sync`
      : `What we know so far · ${t.label}`,
    dataSource: hasReal ? 'phyllo' : 'niche_average',
    demographics,
    peakWindows: {
      label: 'When they are actually scrolling',
      value: t.peakWindow,
      note: 'These windows are derived from the niche pattern — we will refine with your own account data after 30 days of sync.',
    },
    topPillars: {
      label: 'What they respond to best',
      items: pillarsRotated.map((p, i) => ({
        pillar: p,
        signal: i === 0 ? 'Highest save-rate in your niche' : i === 1 ? 'Highest comment-rate' : 'Highest profile-visit-to-follow',
      })),
    },
    oneThingToStop: ctx?.recentMemories?.some((m) => /motivation|quote/i.test(JSON.stringify(m.content)))
      ? 'Confirmed pattern: motivation-quote posts are in your recent output. Retire them this week — every one suppresses save-rate for the next 2-3 posts in the same lane.'
      : hasReal
        ? 'Generic motivation quotes pull share rate up short-term and drag save + follow rate down. I have not seen them in your recent posts yet — but if they show up, replace with specific-number content from your strongest pillar.'
        : 'Common pitfall in this niche (I cannot verify against your account yet): generic motivation quotes pull share rate up short-term but drag save + follow rate down. Worth checking against your last 30 days yourself.',
    whatWeStillDoNotKnow: hasReal
      ? ['Conversion intent (newsletter signup rate on IG traffic)', 'Story-to-feed engagement crossover', 'DM volume + sentiment']
      : ['Everything below audience-level averages — connect your account and the next sync fills this in.'],
    knowledgeApplied: [] as string[],
  }
}

function maya_engagementDiagnosis(t: NicheTokens, ctx: PersonalContext | null) {
  const ig = ctx?.instagram
  const hasReal = !!ig && ig.source === 'phyllo' && ig.engagementRate > 0
  // Use the real top posts as specific examples — name one that worked,
  // one that didn't (lowest engagement of the tracked set).
  const posts = ig?.topPosts || []
  const bestPost = posts[0]
  const worstPost = posts.length > 1 ? posts[posts.length - 1] : null
  const clip = (s: string | null, n = 60) => (s ? (s.length > n ? s.slice(0, n).trim() + '…' : s) : 'untitled post')

  const summary = hasReal
    ? `Engagement rate is currently ${ig!.engagementRate.toFixed(2)}% on @${ig!.handle}. Below are the three shifts I can see from your recent posts.`
    : `Engagement diagnostics are strongest once you have 30 days of Phyllo sync data. For now, these are the three patterns we see across the niche that most often drive drops — match them against your last two weeks.`

  const findings: Array<{ label: string; detail: string; fix: string }> = []

  findings.push({
    label: 'Finding 1 · Cadence compression',
    detail: hasReal
      ? `Looking at the last 14 days on @${ig!.handle}, post timing shows clustering followed by gaps. Clusters + gaps train the algorithm to depress reach after a break.`
      : 'When posts cluster then go dark for 4+ days, the algorithm throttles the next 2 posts after the gap. This is the most common driver of engagement drops in the niche.',
    fix: 'Space to every other day at minimum. Never more than 3 days dark.',
  })

  findings.push({
    label: hasReal ? `Finding 2 · Your strongest post vs. weakest` : 'Finding 2 · Off-pillar post pattern',
    detail: hasReal && bestPost
      ? `Your strongest recent post ("${clip(bestPost.caption)}") pulled ${bestPost.likeCount.toLocaleString()} likes + ${bestPost.commentCount.toLocaleString()} comments. Your weakest ${worstPost ? `("${clip(worstPost.caption)}") pulled ${worstPost.likeCount.toLocaleString()} + ${worstPost.commentCount.toLocaleString()}` : 'was under a quarter of that.'}. The gap isn't production quality — it's that the weaker posts drifted off-pillar.`
      : 'Off-pillar posts pull your share rate up short-term but depress save rate for the three posts that follow. Audience gets retrained toward a share-only cohort that does not convert.',
    fix: `Stay on the ${t.samplePillars[0]} or ${t.samplePillars[1]} pillar for the next 10 days. Any off-pillar idea goes to the parking lot until engagement recovers.`,
  })

  findings.push({
    label: 'Finding 3 · Hook pattern fatigue',
    detail: hasReal
      ? `When 4 of your last 6 hooks use the same opening pattern, audience recognizes it and swipes. First-3-second retention is the clearest canary for this — it drops before engagement does.`
      : 'Over-using one hook pattern (specific-number, confession, swap — pick your poison) trains your audience to swipe. First-3-second retention falls first; engagement follows.',
    fix: `Rotate hook patterns. Ask Alex for a new set using ${t.samplePillars[1]} + swap-framing for the next 3 posts.`,
  })

  return {
    kind: 'engagement_diagnosis',
    generatedAt: new Date().toISOString(),
    headline: hasReal
      ? `Why engagement shifted on @${ig!.handle} — what the last sync shows`
      : 'Why engagement drops in this niche (and how to fix it)',
    dataSource: hasReal ? 'phyllo' : 'pattern_library',
    summary,
    findings,
    oneFixThisWeek: hasReal && bestPost
      ? `Ship one Reel this week that mirrors the structure of "${clip(bestPost.caption)}" (your best recent post). Keep cadence tight — every other day — through the weekend. Engagement should normalize within 10 days.`
      : `Ship one ${t.samplePillars[0]}-pillar Reel by Thursday. Confession or swap-framing hook. Cadence every other day through the weekend. Engagement usually normalizes within 10 days.`,
    knowledgeApplied: [] as string[],
  }
}

// ─────────────────────────────────────────────────────────────────────
// JORDAN (strategist) — 5 briefKinds
// ─────────────────────────────────────────────────────────────────────
function jordan_weeklyPlan(t: NicheTokens, ctx: PersonalContext | null) {
  const today = new Date().toISOString().slice(0, 10)
  const handle = ctx?.instagram?.handle
  const goal = ctx?.activeGoal
  // Seed-stable rotation so two users in the same niche see different
  // pillar slot ordering even with identical token sets.
  const seed = ctx?.seed ?? 0
  const pillars = rotatePool<string>(t.samplePillars.slice(), seed) as string[]

  // If a goal is set, name it in the headline + bias one slot toward it.
  const goalLine = goal
    ? `Anchored on the active goal: ${goal.metricLabel || goal.type} → ${goal.target.toLocaleString()} by ${goal.byDate}.`
    : null

  return {
    kind: 'weekly_plan',
    weekOf: today,
    headline: handle
      ? `Next week for @${handle} · ${t.label} pillars`
      : `Next week · anchored on ${t.label} pillars`,
    goalContext: goalLine,
    pillars,
    posts: [
      { day: 'Mon', format: 'Reel', topic: pillars[0], angle: `${pillars[0]} beat · lead with the specific-time-frame hook. Ship by 6am ET to catch the ${t.peakWindow} wave.` },
      { day: 'Wed', format: 'Carousel', topic: pillars[1], angle: `Myth + framework stack. End slide is the screenshot-friendly takeaway. ${t.savePattern}` },
      { day: 'Fri', format: 'Reel', topic: t.sampleTrend, angle: goal ? `Trend-driven slot pointed at the ${goal.metricLabel || goal.type} goal. Lean into Maya\'s weekly flag — swap framing.` : 'Trend-driven slot. Lean into Maya\'s weekly flag — swap framing.' },
      { day: 'Sun', format: 'Reel', topic: pillars[2], angle: 'Behind-the-scenes warmth. Sunday evening is the highest-converting window — include a soft CTA.' },
    ],
    cadenceNote: '4 feed posts + daily stories. Space posts every other day minimum to keep the algorithm warm without fatigue.',
    reserved: '1 trend-reactive slot (Fri) — we swap this based on Maya\'s mid-week trend pulse.',
    nextWeekNote: goal
      ? `If Friday trend slot lands >1.5x baseline, extend into a 3-post mini-series the following week — that is your fastest path to the ${goal.metricLabel || goal.type} target.`
      : 'If Friday trend slot lands >1.5x baseline, extend into a 3-post mini-series the following week.',
    knowledgeApplied: [] as string[],
  }
}

function jordan_pillarRebuild(t: NicheTokens, _ctx: PersonalContext | null) {
  return {
    kind: 'pillar_rebuild',
    generatedAt: new Date().toISOString(),
    headline: `Content pillars rebuild · ${t.label}`,
    pillars: [
      {
        name: t.samplePillars[0],
        whatItIs: 'Story arc content showing a real journey — from bottleneck to resolution. Identity-shift framing beats vanity metrics.',
        whoItIsFor: `${t.audiencePrimary} in the "this could be me" projection state.`,
        examplePost: `Reel: "I stopped [common advice] for 30 days. Here is what actually changed."`,
        cadence: '1x/week',
      },
      {
        name: t.samplePillars[1],
        whatItIs: 'Direct pushback on widely-believed conventional wisdom in the niche. Triggers comment-loop because skeptics challenge.',
        whoItIsFor: 'The evidence-seeking segment who want to feel like insiders.',
        examplePost: `Carousel: "${t.label === 'finance' ? 'Your bank does not want you to know this' : 'The myth that is keeping you stuck'}" + framework on slides 2-6.`,
        cadence: '1x/week',
      },
      {
        name: t.samplePillars[2],
        whatItIs: 'Behind-the-scenes process, failures, daily decisions. Lower-effort content that lifts trust and follow-rate.',
        whoItIsFor: 'Followers evaluating whether to buy from you. This content confirms you are real.',
        examplePost: `Reel: "A day in my life trying to [specific thing]. What actually happens vs what I tell you on here."`,
        cadence: '1x/week',
      },
    ],
    proposedCadence: '3 pillars on rotation + 1 trend-driven slot = 4 posts/week. Each pillar anchors in its own day so the audience can predict.',
    killedWhat: 'Motivation quotes and generic tips — neither compounds. Both pull your share rate up short-term but drag save rate down.',
    knowledgeApplied: [] as string[],
  }
}

function jordan_cadencePlan(t: NicheTokens, _ctx: PersonalContext | null) {
  return {
    kind: 'cadence_plan',
    generatedAt: new Date().toISOString(),
    headline: `Posting cadence · built for ${t.label}`,
    summary: `4-5 feed posts/week + daily stories. Below 4 you lose algorithmic warmth; above 7 you fatigue the audience. Your realistic capacity supports the middle of that range.`,
    schedule: [
      { day: 'Mon', slot: '7am ET', format: 'Reel', reason: 'Highest weekday morning window for your segment.' },
      { day: 'Wed', slot: '7am ET', format: 'Carousel', reason: 'Mid-week save-bait post. People plan their week here.' },
      { day: 'Fri', slot: '5:30am ET', format: 'Reel', reason: 'Pre-weekend catch. Trending-audio friendly slot.' },
      { day: 'Sun', slot: '8pm ET', format: 'Reel', reason: t.peakWindow + ' — highest-converting window of the week.' },
    ],
    storyCadence: 'Daily — 4-6 frames. Morning routine sequence Mon-Fri, BTS or product pick Sat-Sun.',
    avoid: [
      'Posting on Tue or Thu (your audience\'s lowest dwell-time windows)',
      'Two Reels on the same day — algorithm caps distribution',
      'Posting right before bed for your timezone — Instagram holds feed impressions for 2-6h',
    ],
    capacityMath: 'Assuming ~45 min production per Reel and ~30 min per carousel, 4 posts/week = ~3 hours of content work + 1 hour of planning/review. Protect this block.',
    knowledgeApplied: [] as string[],
  }
}

function jordan_ninetyDayPlan(t: NicheTokens, _ctx: PersonalContext | null) {
  return {
    kind: 'ninety_day_plan',
    generatedAt: new Date().toISOString(),
    headline: `90-day plan · ${t.label}`,
    months: [
      {
        month: 'Month 1 · Foundation + momentum',
        theme: 'Re-anchor on the 3 core pillars. Ship consistency before cleverness.',
        goal: '12-16 posts. Land at a ~5% net follower lift from baseline. Save-rate above 2.2%.',
        mustShip: `1 pinned cornerstone carousel anchored on "${t.samplePillars[0]}" — this becomes the asset everything drives toward.`,
      },
      {
        month: 'Month 2 · Breakout attempt',
        theme: `Ride one breakout trend hard. Target ${t.sampleTrend} if it\'s still open, otherwise whatever Maya flags week-1 of month-2.`,
        goal: '1 post at 3-5x median reach. Pull 500-1000 net followers from that single post.',
        mustShip: 'A swap-framing Reel that triggers comment-loop. Shot-listed tight, first 1.5s earns the scroll.',
      },
      {
        month: 'Month 3 · Convert + system',
        theme: 'Turn the new audience into something compounding — newsletter, waitlist, or community.',
        goal: 'Newsletter signup rate from IG > 1.5% of profile visits. Or equivalent conversion if you have a product.',
        mustShip: 'Pinned carousel updated + Sunday evening CTA slot used every week.',
      },
    ],
    nextTwoReels: [
      {
        title: `Week 1 · ${t.sampleTrend} swap Reel`,
        format: 'Reel, 28s',
        angle: 'Specific-number open, swap framing, comment-bait payoff. Drive viewers to the pinned cornerstone.',
      },
      {
        title: `Week 2 · ${t.samplePillars[1]} carousel`,
        format: 'Carousel, 7 slides',
        angle: 'Myth → framework → screenshot-friendly last slide. Designed for save behavior.',
      },
    ],
    knowledgeApplied: [] as string[],
  }
}

function jordan_slotAudit(t: NicheTokens, ctx: PersonalContext | null) {
  const ig = ctx?.instagram
  const posts = ig?.topPosts || []
  const best = posts[0]
  const worst = posts.length > 1 ? posts[posts.length - 1] : null
  const clip = (s: string | null, n = 70) => (s ? (s.length > n ? s.slice(0, n).trim() + '…' : s) : 'recent post')
  const hasReal = posts.length >= 2
  return {
    kind: 'slot_audit',
    generatedAt: new Date().toISOString(),
    headline: ig?.handle
      ? `Two slots to fix on @${ig.handle} — based on your last sync`
      : 'Two weakest content slots · replace these first',
    dataSource: hasReal ? 'phyllo' : 'pattern_library',
    slots: [
      {
        label: hasReal && worst
          ? `Weakest slot · "${clip(worst.caption)}" pattern`
          : 'Weakest slot · Friday "quick tip" Reel',
        problem: hasReal && worst && best
          ? `That post pulled ${worst.likeCount.toLocaleString()} likes vs. your strongest "${clip(best.caption)}" at ${best.likeCount.toLocaleString()}. Same audience — different framing. The weak one signaled "list of tips," the strong one signaled "specific story."`
          : 'Save-rate well below your account median over the last 6 weeks. Hook pattern is tired — audience recognizes it and swipes.',
        replacement: `Friday becomes the trend-reactive slot. Whatever Maya flags mid-week, Alex writes the hook, Riley shot-lists by Thursday 2pm. Shipped Friday 5:30am.`,
        expectedLift: hasReal && best
          ? `Mirror the structure of "${clip(best.caption, 50)}" — that one is your reference. 2-3x the reach this slot used to produce.`
          : 'If trend discipline holds, expect 2-3x the reach this slot used to produce.',
      },
      {
        label: '2nd weakest · generic motivation / list-style post',
        problem: 'Pulls share rate up temporarily but audience that shares it never saves or converts. Pulls the algorithm toward a share-only audience that does not buy.',
        replacement: `Replace with a client-win carousel on the ${t.samplePillars[0]} pillar. Name + before-state + specific move + result. 1x/2 weeks max.`,
        expectedLift: 'Save-rate per post should triple. Follower conversion on this slot should shift from 0.2% to ~0.8%.',
      },
    ],
    keep: hasReal && best
      ? `Your best slot is whatever produced "${clip(best.caption)}". Whatever timing + format that was, do not touch it.`
      : `The Sunday 8pm ${t.samplePillars[2]} Reel is your best slot. Leave it alone. ${t.peakWindow.includes('Sun') ? 'Peak window for your audience.' : ''}`,
    knowledgeApplied: [] as string[],
  }
}

// ─────────────────────────────────────────────────────────────────────
// ALEX (copywriter) — 5 briefKinds
// ─────────────────────────────────────────────────────────────────────
function alex_topTrendHooks(t: NicheTokens, _ctx: PersonalContext | null) {
  const hooks = [
    { n: 1, pattern: 'Swap framing', text: t.swapHook },
    { n: 2, pattern: 'Specific-number', text: t.specificNumberHook, flagged: true, favoriteReason: 'Specific number + swap framing + comment-bait ("but does it really?"). Triggers the highest comment-rate pattern in this niche.' },
    { n: 3, pattern: 'Confession', text: `I stopped ${t.sampleTrend} the old way for 30 days. What nobody tells you is ${t.replacementMoves[0].toLowerCase()}.` },
    { n: 4, pattern: 'Counter-conventional', text: `The ${t.sampleTrend} advice you keep reading is keeping you stuck. The move that actually works lives in ${t.wedgeTopic}.` },
    { n: 5, pattern: 'Inside-access', text: `The thing nobody posts about ${t.sampleTrend} because it is not photogenic: ${t.replacementMoves[1].toLowerCase()}.` },
  ]
  return {
    kind: 'top_trend_hooks',
    generatedAt: new Date().toISOString(),
    topic: t.sampleTrend,
    headline: `5 hooks for ${t.sampleTrend}`,
    hooks,
    favorite: {
      n: 2,
      why: hooks[1]!.favoriteReason,
      weaknessesOfOthers: [
        '#1 — strong but the swap framing is the same pattern you used 2 posts ago. Audience fatigue risk.',
        '#3 — confession works but this version is generic. Needs a specific number in the confession to earn the scroll.',
        '#4 — counter-conventional sounds preachy without a specific source to anchor the contrarian claim.',
        '#5 — inside-access is overused in this niche right now (+40% in last 30 days). Save for Q4.',
      ],
    },
    languageGuardrails: t.languageGuardrails,
    knowledgeApplied: [] as string[],
  }
}

function alex_reelScript30s(t: NicheTokens, _ctx: PersonalContext | null) {
  return {
    kind: 'reel_script_30s',
    title: `30s Reel · ${t.sampleTrend}`,
    duration: '30s',
    beats: [
      { at: '0-2s', label: 'Cold open', text: `Camera tight on the cue object. No voiceover. On-screen text pulled from the hook: "${t.specificNumberHook.split('.')[0]}." Silence earns the scroll.` },
      { at: '2-8s', label: 'Tension', text: `Cut to voiceover: "If your ${t.samplePillars[0]} approach has stopped working, the fix is not more effort — it is ${t.wedgeTopic}." Cut on breath. Show the contrast frame (the old way).` },
      { at: '8-22s', label: 'Reframe + 3 moves', text: `Direct-to-lens. Three specific things to stop: ${t.replacementMoves.map((m) => m.toLowerCase()).join('; ')}. One beat per move. Numbers or names on screen as you deliver each.` },
      { at: '22-30s', label: 'Payoff + CTA', text: `Close on the result frame. One-line payoff: "Save this if you needed the reminder." Soft CTA, not aggressive.` },
    ],
    framework: 'Hook → Tension → Reframe → Payoff',
    voiceNotes: t.languageGuardrails,
    soundNote: 'Original audio. No trending music — the voiceover carries it and trending audio pulls the wrong ranking signal for this format.',
    knowledgeApplied: [] as string[],
  }
}

function alex_captionNextPost(t: NicheTokens, _ctx: PersonalContext | null) {
  const text = `The thing nobody tells you about ${t.sampleTrend}:\n\n${t.captionBody}\n\nSave this if your version of "trying everything" has stopped working.`
  return {
    kind: 'caption_next_post',
    generatedAt: new Date().toISOString(),
    text,
    length: `${text.split(/\s+/).length} words`,
    lineBreakStrategy: 'Visual rhythm — short/medium/short. Mobile-first reading.',
    cta: 'Save (single soft CTA on the final line).',
    knowledgeApplied: [] as string[],
  }
}

function alex_carouselOpeningLines(t: NicheTokens, _ctx: PersonalContext | null) {
  return {
    kind: 'carousel_opening_lines',
    generatedAt: new Date().toISOString(),
    topic: t.samplePillars[1],
    headline: '3 slide-1 hooks for this week\'s carousel',
    hooks: [
      { n: 1, text: `The ${t.samplePillars[1]} myth that is keeping you stuck.`, note: 'Most punchy. Pairs with "swap framing" carousel structure.' },
      { n: 2, text: `If you still believe [common wisdom in ${t.label}], this is for you.`, note: 'Highest comment-rate pattern. Calls out the reader directly.', flagged: true },
      { n: 3, text: `${t.samplePillars[1]} · 4 things I was wrong about.`, note: 'Save-bait structure. Screenshot-friendly format signals.' },
    ],
    favorite: {
      n: 2,
      why: 'Direct address triggers self-check loop. Second-person ("this is for you") doubles comment-rate on carousel slide 1 in this niche.',
    },
    knowledgeApplied: [] as string[],
  }
}

function alex_bioRewrite(t: NicheTokens, ctx: PersonalContext | null) {
  const ig = ctx?.instagram
  const handle = ig?.handle
  const size = ig?.followerCount ?? 0
  const tier = followerTier(size)
  const audienceLabel = ctx?.subNiche ? `${ctx.subNiche}` : t.audiencePrimary
  const current = ig?.followerCount != null
    ? `@${handle} · ${fmtFollowers(size)} followers (${tier})`
    : '(connect your account so I can critique your live bio)'

  // Seed-stable recommendation so two users in the same niche don't both
  // get "Option A for most accounts" as the call.
  const seed = ctx?.seed ?? 0
  const recs = [
    'Option A for most accounts. Option B if your best-performing content is transformation-pillar. Avoid C unless your feed is visually tight.',
    'Option B is the one for you — your follow-rate is highest on origin-story framing. Option A if you want to test a cleaner outcome-first line for Q2.',
    'Option C will hit hardest at your size — audiences scroll bios faster above 5K followers. A as a safety. B only if you have a pinned cornerstone Reel.',
  ]
  const rec = recs[seed % recs.length]!

  return {
    kind: 'bio_rewrite',
    generatedAt: new Date().toISOString(),
    headline: handle ? `Bio rewrite for @${handle} · three options` : 'Bio rewrite · three options',
    current,
    sizeContext: ig ? `You sit at ${tier} (${fmtFollowers(size)}). Bios at this tier convert best when the first line names the specific outcome.` : null,
    options: [
      {
        label: 'Option A · outcome-first',
        text: `Helping ${audienceLabel}\n${t.bioOutcome}\n↓ start here`,
        why: 'Who you help + specifically what they get + one action. Strongest converting format for cold profile visits.',
      },
      {
        label: 'Option B · identity-first',
        text: `${t.bioOrigin}\nNow I help ${audienceLabel}\n${t.bioOutcome}.\n↓ the first step`,
        why: 'Origin-story framing. Lower conversion short-term, higher trust long-term. Best if your pinned content is transformation-anchored.',
      },
      {
        label: 'Option C · punchy',
        text: `${t.bioPunchy}\n↓ what I actually do`,
        why: 'Minimalist. Works best once you are above 5K followers and your feed grid does the heavy lifting.',
      },
    ],
    recommendation: rec,
    ctaRule: 'One link only. "Link in bio" phrasing underperforms a direct arrow + noun ("↓ start here"). No emojis unless your audience expects them.',
    knowledgeApplied: [] as string[],
  }
}

// ─────────────────────────────────────────────────────────────────────
// RILEY (creative_director) — 5 briefKinds
// ─────────────────────────────────────────────────────────────────────
function riley_reelShotList(t: NicheTokens, _ctx: PersonalContext | null) {
  return {
    kind: 'reel_shot_list',
    reelTitle: `${t.sampleTrend} · 28s Reel`,
    duration: '28s',
    shots: [
      { n: 1, at: '0.0s', shot: 'Extreme close-up on the cue object — the thing the hook names.', note: 'No voiceover. No music. 1.5s of silence earns the scroll.' },
      { n: 2, at: '1.5s', shot: `Wide · subject stepping into the frame (the "old way" being left behind).`, note: 'Hook voiceover starts here. Cut on first syllable.' },
      { n: 3, at: '6.0s', shot: 'POV from the action — feet / hands / whatever is doing the work.', note: 'Tempo-match to natural motion. No fast-cuts yet.' },
      { n: 4, at: '12.0s', shot: 'Overlay frame · the specific number on screen ("15 min") with a secondary metric.', note: 'Hold for 2.5s so it registers. This is your screenshot frame.' },
      { n: 5, at: '22.0s', shot: 'Direct-to-camera · payoff line. Tight crop.', note: 'Eye contact into the lens. Lower your chin slightly for warmth.' },
    ],
    soundNote: 'Original audio. First 2s silent. Low ambient from 2s onward — voice carries the edit.',
    editorNote: 'Cut on breath, not on beat. First 2s must earn it without music. If a cut feels too fast, hold it another half-second — this niche rewards slow openings.',
    framework: 'Hook → Tension → Reframe → Payoff',
    knowledgeApplied: [] as string[],
  }
}

function riley_pacingNotes(t: NicheTokens, _ctx: PersonalContext | null) {
  return {
    kind: 'pacing_notes',
    generatedAt: new Date().toISOString(),
    headline: 'Pacing audit · recent Reels',
    sections: [
      {
        heading: 'What I\'m seeing',
        body: 'Average cut length across your last 6 Reels is 1.2s. That is faster than the niche average (1.8s) and faster than your audience\'s dwell preference. You are training the viewer to skim, not watch.',
      },
      {
        heading: 'Target hold-lengths',
        items: [
          'Opening shot · 2.0-2.5s (you\'re at 0.8s — shortest in the niche)',
          'Mid shots · 1.8-2.5s each',
          'Payoff shot · 3.0-4.0s (let the final line breathe)',
          'Silence moments · 1-2 per Reel at 0.5-1.0s each',
        ],
      },
      {
        heading: 'Where silence lands',
        body: 'Silence on the hook is non-negotiable — first 1.5-2s. Second silence before the reframe (around second 8) sharpens the pivot. Third silence optional on the payoff if the line lands in 2 words.',
      },
      {
        heading: 'Beat-to-cut rule',
        body: 'Cut on breath, not on beat. Viewers hear breath cuts as "spoken to"; beat cuts read as "edited at." For this audience, conversation beats polish every time.',
      },
    ],
    oneFixThisWeek: 'Re-edit the most recent Reel with 2.0s minimum hold on shots 1 and 5. Compare save-rate vs. the original posting.',
    knowledgeApplied: [] as string[],
  }
}

function riley_visualDirection(t: NicheTokens, _ctx: PersonalContext | null) {
  return {
    kind: 'visual_direction',
    generatedAt: new Date().toISOString(),
    headline: `Visual direction · cohesive look for ${t.label}`,
    sections: [
      {
        heading: 'Palette',
        items: [
          'Primary · warm neutral (think "morning light on a matte surface") — #E8DFD3',
          'Accent · single saturated tone — deep forest (#2D4A3E) or terracotta (#B5532E). Pick ONE and hold.',
          'Type · near-black (#1B1614), never pure black. Softens on mobile.',
          'No blue unless your product is literally blue.',
        ],
      },
      {
        heading: 'Lighting',
        body: 'Natural, low-angle when possible. Shoot within 2 hours of sunrise or sunset for consistency. Avoid overhead ring lights — too editorial for this audience\'s trust signal.',
      },
      {
        heading: 'Shot style',
        body: 'Medium-close crops. Subject off-center (rule of thirds, right side). Hands and objects in-frame where possible — signals "real person, real process."',
      },
      {
        heading: 'Text overlay',
        items: [
          'Type · serif for headings (warmth), sans-serif for numbers (clarity).',
          'No drop shadows. No gradients. Black or palette-accent on off-white plate.',
          'Max 6 words per frame. If it doesn\'t fit in 6 words, it doesn\'t belong on screen.',
          'Consistent position · bottom-third, aligned left.',
        ],
      },
    ],
    testShot: `Next Reel: apply this full treatment. Compare against your last 3 for cohesion. The audience should recognize your work without seeing the handle.`,
    knowledgeApplied: [] as string[],
  }
}

function riley_thumbnailBrief(t: NicheTokens, _ctx: PersonalContext | null) {
  return {
    kind: 'thumbnail_brief',
    generatedAt: new Date().toISOString(),
    headline: `Slide-1 thumbnail · ${t.samplePillars[1]} carousel`,
    spec: {
      typeTreatment: 'Serif headline, 42-48pt. Max 6 words. Top-left aligned. Near-black on off-white plate.',
      color: 'Neutral plate (#F2ECE2) + one accent color from your palette. No gradient, no shadow.',
      focalSubject: 'Single object that embodies the pillar — no composite images. Shot from above or tight 3/4.',
      negativeSpace: '~40% of the frame. The eye needs somewhere to rest before reading.',
      compositionRule: 'Text on top third. Subject on bottom two-thirds. Swipe arrow hint at bottom-right corner.',
    },
    dontDo: 'Do not use stock photography. Do not use emojis in the headline. Do not use a gradient background (reads as 2019). Do not put faces — this niche saves faceless thumbnails at 2.1x the rate.',
    testAgainst: 'Compare your mockup to your 3 best-saving slide-1s. If it doesn\'t match the visual family, redo.',
    knowledgeApplied: [] as string[],
  }
}

function riley_fixWeakReel(t: NicheTokens, _ctx: PersonalContext | null) {
  return {
    kind: 'fix_weak_reel',
    generatedAt: new Date().toISOString(),
    headline: 'Reshoot the first 2 seconds · weakest Reel of the week',
    diagnosis: {
      label: 'What went wrong',
      body: 'Current open: talking-head, direct-to-lens, full sentence in the first 2 seconds. First-3-second retention is 48% — significantly below your 72% median. The audience heard "hey" in frame 1 and swiped.',
    },
    proposedFix: {
      label: 'Open frame rebuilt',
      shots: [
        { at: '0.0-1.5s', shot: 'Silent object close-up · the cue thing tied to your hook.', note: 'No voice. Text overlay: the specific number from your hook.' },
        { at: '1.5-2.5s', shot: 'Cut to medium-shot · you stepping into frame.', note: 'Voiceover starts HERE, not at 0.0.' },
      ],
    },
    whyItWorks: 'Silence + a specific number on screen is the highest-performing Reel opener in the niche. Gives the viewer a reason to hold before you\'ve even spoken. Your talking-head opens cost you ~24 retention points.',
    reshoot: '5-minute reshoot. Use the same talking-head footage from 2.5s onward — just replace the first 2.5 seconds. Post the re-cut as a new Reel, not as a replace (the algorithm penalizes edits).',
    knowledgeApplied: [] as string[],
  }
}

// ─────────────────────────────────────────────────────────────────────
// ROUTER
// ─────────────────────────────────────────────────────────────────────
type BriefGenerator = (t: NicheTokens, ctx: PersonalContext | null, knowledge: KnowledgeRow[]) => Record<string, unknown>

const BRIEF_GENERATORS: Record<string, BriefGenerator> = {
  // Maya
  weekly_trends: maya_weeklyTrends,
  competitor_scan: maya_competitorScan,
  hashtag_report: maya_hashtagReport,
  audience_deep_dive: maya_audienceDeepDive,
  engagement_diagnosis: maya_engagementDiagnosis,
  // Jordan
  weekly_plan: jordan_weeklyPlan,
  pillar_rebuild: jordan_pillarRebuild,
  cadence_plan: jordan_cadencePlan,
  ninety_day_plan: jordan_ninetyDayPlan,
  slot_audit: jordan_slotAudit,
  // Alex
  top_trend_hooks: alex_topTrendHooks,
  reel_script_30s: alex_reelScript30s,
  caption_next_post: alex_captionNextPost,
  carousel_opening_lines: alex_carouselOpeningLines,
  bio_rewrite: alex_bioRewrite,
  // Riley
  reel_shot_list: riley_reelShotList,
  pacing_notes: riley_pacingNotes,
  visual_direction: riley_visualDirection,
  thumbnail_brief: riley_thumbnailBrief,
  fix_weak_reel: riley_fixWeakReel,
}

// ── Generic type-keyed fallback for ad-hoc briefs without briefKind ─────
const TYPE_FALLBACK: Record<OutputType, BriefGenerator> = {
  trend_report: (t, ctx) => maya_weeklyTrends(t, ctx),
  content_plan: (t, ctx) => jordan_weeklyPlan(t, ctx),
  hooks: (t, ctx) => alex_topTrendHooks(t, ctx),
  script: (t, ctx) => alex_reelScript30s(t, ctx),
  caption: (t, ctx) => alex_captionNextPost(t, ctx),
  shot_list: (t, ctx) => riley_reelShotList(t, ctx),
  video: () => ({ status: 'pending', note: 'Video generation is briefed to Creatomate once a shot list is approved.' }),
  performance_review: () => ({ status: 'pending', note: 'Performance reviews always use Bedrock — no mock fallback.' }),
  weekly_pulse: () => ({ status: 'pending', note: 'Weekly pulses always use Bedrock — no mock fallback.' }),
  upload_review: () => ({ status: 'pending', note: 'Upload reviews always use Bedrock — no mock fallback.' }),
  content_audit: () => ({ status: 'pending', note: 'Content audits always use Bedrock — no mock fallback.' }),
  growth_strategy: () => ({ status: 'pending', note: 'Growth strategies always use Bedrock — no mock fallback.' }),
  feed_audit: () => ({ status: 'pending', note: 'Feed audits always use Bedrock — no mock fallback.' }),
  format_analysis: () => ({ status: 'pending', note: 'Format analyses always use Bedrock — no mock fallback.' }),
  trend_hooks: () => ({ status: 'pending', note: 'Trend hooks always use Bedrock — no mock fallback.' }),
  plan_adjustment: () => ({ status: 'pending', note: 'Plan adjustments always use Bedrock — no mock fallback.' }),
  competitor_analysis: () => ({ status: 'pending', note: 'Competitor analyses always use Bedrock — no mock fallback.' }),
  morning_brief: () => ({ status: 'pending', note: 'Morning briefs always use Bedrock — no mock fallback.' }),
  midday_check: () => ({ status: 'pending', note: 'Midday checks always use Bedrock — no mock fallback.' }),
  evening_recap: () => ({ status: 'pending', note: 'Evening recaps always use Bedrock — no mock fallback.' }),
}

// ─────────────────────────────────────────────────────────────────────
// MAIN EXECUTOR
// ─────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────
// PRESENTATION SCRIPT
// Given a briefKind + the structured output we just produced, returns
// the agent's natural-language opening message for the meeting room
// plus a few suggested CEO replies (rendered as quick-reply chips).
// Each opener pulls real data from the content so the agent sounds
// like they actually read what they made.
// ─────────────────────────────────────────────────────────────────────

interface BriefPresentation {
  opening: string
  suggestedReplies: string[]
  viewLabel: string
}

function get<T>(obj: Record<string, unknown>, path: string, fallback: T): T {
  const parts = path.split('.')
  let cur: unknown = obj
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p]
    } else return fallback
  }
  return (cur as T) ?? fallback
}

function presentBrief(opts: {
  briefKind: string | null | undefined
  content: Record<string, unknown>
  role: AgentRole
  ctx: PersonalContext | null
}): BriefPresentation | null {
  const c = opts.content
  const persona = PERSONA_NAME[opts.role]
  const handle = opts.ctx?.instagram?.handle
  const youAre = handle ? `@${handle}` : 'you'

  switch (opts.briefKind) {
    // ── Maya ───────────────────────────────────────────────────
    case 'weekly_trends': {
      const trends = get<Array<Record<string, unknown>>>(c, 'trends', [])
      const top = trends[0]
      const topic = top ? String(top.topic) : 'this week\'s top movement'
      const growth = top ? String(top.growth) : ''
      const window = top ? String(top.window) : ''
      const urgency = top ? String(top.urgency) : ''
      return {
        opening: `**Three trends are moving in ${opts.ctx?.niche || 'your niche'} — one to act on this week.**\n\n- **${topic}** · ${growth} over ${window}\n- ${urgency === 'act_now' ? 'Window closes in **4-6 days**. The move is to ship a Reel by Friday and a save-bait carousel by Sunday.' : 'Slower burn — the right play is a 2-week mini-series, not a one-off.'}\n- I can brief Alex on hooks and Riley on the shot list right now if you want to move.\n\n**Want me to send those briefs?**`,
        suggestedReplies: ['Send the briefs', 'Why this trend over the others?', 'Show me the data'],
        viewLabel: 'Open full report',
      }
    }
    case 'competitor_scan': {
      const plays = get<Array<Record<string, unknown>>>(c, 'plays', [])
      const closest = plays[2] || plays[0]
      const closestTier = closest ? String(closest.tier) : 'the closest tier'
      const winningHook = closest ? String(closest.winningHook || '') : ''
      const copyLine = closest ? String(closest.copyFromThem || '') : ''
      return {
        opening: `**Three plays winning in your set this month — sized to your tier.**\n\n- The closest tier ahead of you (**${closestTier.replace(/^Closest tier ahead of you · /i, '')}**) is winning with **${winningHook.split('(')[0].trim()}** hooks\n- ${copyLine ? `Biggest play to copy: ${copyLine.split('.')[0]}` : 'Pattern is identity-shift, not novelty'}\n- Send me three real handles and I'll run the same analysis on them specifically\n\n**Want me to walk the closest tier in detail, or jump to briefing Alex on a confession-style hook?**`,
        suggestedReplies: ['Walk me through the closest tier', 'Brief Alex on a confession hook', 'I will paste my real comps'],
        viewLabel: 'Open full scan',
      }
    }
    case 'hashtag_report': {
      const buckets = get<Array<Record<string, unknown>>>(c, 'buckets', [])
      const mid = buckets.find((b) => /mid/i.test(String(b.label || '')))
      const midTags = mid ? get<string[]>(mid as Record<string, unknown>, 'tags', []) : []
      const tier = opts.ctx?.instagram ? followerTier(opts.ctx.instagram.followerCount) : 'your size'
      return {
        opening: `**Your sweet spot at ${tier} is the mid-tier hashtag bucket.** Bigger tags bury you; smaller tags don't carry reach.\n\n- Lead with: **${midTags.slice(0, 3).join(', ')}**\n- Use 3-5 per post, one from each bucket\n- Stay off the dead tags (#viral, #explorepage, #fyp)\n\n**Want me to draft a tag set for your next 3 scheduled posts?**`,
        suggestedReplies: ['Draft tags for my next posts', 'Which bucket should I lean on?', 'Why mid-tier wins'],
        viewLabel: 'Open full hashtag report',
      }
    }
    case 'audience_deep_dive': {
      const dataSource = String(get(c, 'dataSource', ''))
      const isReal = dataSource === 'phyllo'
      const demos = get<Array<Record<string, unknown>>>(c, 'demographics', [])
      const primary = demos.find((d) => /primary/i.test(String(d.label || '')))
      // Keep the full primary value (including any "(niche average)"
      // caveat the generator added) so we don't strip the honesty signal.
      const primaryVal = primary ? String(primary.value) : ''
      const memoryHasMotivation = !!(opts.ctx?.recentMemories || []).some((m) =>
        /motivation|quote/i.test(JSON.stringify(m.content || '')),
      )
      // Be honest about what we know vs. what we're inferring. Niche-
      // average data must NEVER be presented as if it's the user's own.
      if (isReal) {
        const stop = String(get(c, 'oneThingToStop', ''))
        const stopLine = memoryHasMotivation
          ? `**Biggest takeaway:** ${stop.slice(0, 220)}${stop.length > 220 ? '…' : ''}`
          : `**Hypothesis to watch:** ${stop.slice(0, 220)}${stop.length > 220 ? '…' : ''}`
        return {
          opening: `**Audience snapshot for ${youAre}.**\n\n- **Primary segment:** ${primaryVal}\n- ${stopLine}`,
          suggestedReplies: ['What about the rest?', 'How do I act on this?', 'Show country + city breakdown'],
          viewLabel: 'Open audience report',
        }
      }
      // No real audience data — say so explicitly. Don't claim to know
      // the user's primary segment when we're just citing the niche.
      return {
        opening: `**I don't have your audience data yet.** Phyllo hasn't returned demographics for ${youAre} — usually that means the account is still PERSONAL on Meta, recently switched to Pro and Meta is propagating, or follower volume is below the threshold Meta requires for audience insights.\n\nFor now I can only share what's true **across your niche** — treat it as hypothesis, not fact about you specifically.\n\n**Want me to walk you through the niche pattern, or help diagnose why audience data isn't flowing?**`,
        suggestedReplies: ['Show the niche pattern', 'Why isn\'t my audience data flowing?', 'How do I unblock this?'],
        viewLabel: 'Open audience report',
      }
    }
    case 'engagement_diagnosis': {
      const dataSource = String(get(c, 'dataSource', ''))
      const isReal = dataSource === 'phyllo'
      if (isReal) {
        const summary = String(get(c, 'summary', ''))
        const fix = String(get(c, 'oneFixThisWeek', ''))
        return {
          opening: `${summary}\n\n**One fix this week:** ${fix.slice(0, 240)}${fix.length > 240 ? '…' : ''}`,
          suggestedReplies: ['Walk me through finding 1', 'Approve the fix', 'What if I can\'t ship Thursday?'],
          viewLabel: 'Open diagnosis',
        }
      }
      return {
        opening: `**I can't diagnose your specific drop yet — I don't have engagement data for ${youAre}.** Once Phyllo returns post-level metrics (needs a Pro account on Meta + ~24-48h after switching), I can name the actual posts that hurt and propose a real fix.\n\nFor now I can walk you through the **three patterns that most often drive drops in your niche** — match them against your last two weeks yourself.`,
        suggestedReplies: ['Show the three patterns', 'Why isn\'t my data flowing?', 'How do I unblock this?'],
        viewLabel: 'Open diagnosis',
      }
    }

    // ── Jordan ───────────────────────────────────────────────────
    case 'weekly_plan': {
      const posts = get<Array<Record<string, unknown>>>(c, 'posts', [])
      const goalLine = String(get(c, 'goalContext', '') || '')
      return {
        opening: `Built next week — ${posts.length} posts. ${goalLine ? `${goalLine.split('.')[0]}.` : 'Reels Mon/Fri/Sun, carousel Wed.'} Trend slot is reserved for whatever Maya flags mid-week. Want any swaps before I lock it?`,
        suggestedReplies: ['Lock it in', 'Move Friday earlier', 'Rebalance the pillars'],
        viewLabel: 'Open the plan',
      }
    }
    case 'pillar_rebuild': {
      const pillars = get<Array<Record<string, unknown>>>(c, 'pillars', [])
      const names = pillars.map((p) => String(p.name)).filter(Boolean)
      const killed = String(get(c, 'killedWhat', ''))
      return {
        opening: `Rebuilt your pillars — proposing: **${names.join(' · ')}**. Killed list: ${killed.split('.')[0]}. Approve and I roll these into next week's plan.`,
        suggestedReplies: ['Approve', 'Why these three?', 'Try a different pillar'],
        viewLabel: 'Open the rebuild',
      }
    }
    case 'cadence_plan': {
      const sched = get<Array<Record<string, unknown>>>(c, 'schedule', [])
      const days = sched.map((s) => String(s.day)).filter(Boolean).join('/')
      return {
        opening: `Recommend ${sched.length} feed posts/week on ${days}, plus daily stories. The Sunday slot is your biggest converter — protect it. Sound right or want to adjust?`,
        suggestedReplies: ['Lock it in', 'I can only do 3/week', 'Why daily stories?'],
        viewLabel: 'Open the cadence',
      }
    }
    case 'ninety_day_plan': {
      const months = get<Array<Record<string, unknown>>>(c, 'months', [])
      const m1 = months[0] ? String((months[0] as Record<string, unknown>).theme) : ''
      return {
        opening: `Mapped out 12 weeks across 3 monthly themes. Month 1 starts with: ${m1}. The next two Reels are scoped — want to start with those or talk theme first?`,
        suggestedReplies: ['Start the first Reel', 'Walk me through month 2', 'Adjust the goal'],
        viewLabel: 'Open the 90-day plan',
      }
    }
    case 'slot_audit': {
      const slots = get<Array<Record<string, unknown>>>(c, 'slots', [])
      const weakest = slots[0]
      const label = weakest ? String(weakest.label) : 'your weakest slot'
      const replacement = weakest ? String(weakest.replacement) : ''
      return {
        opening: `Audit done. ${label}. Proposed swap: ${replacement.split('.')[0]}. Approve and I queue it for this Friday.`,
        suggestedReplies: ['Approve the swap', 'Why this slot?', 'Show the second-weakest'],
        viewLabel: 'Open the audit',
      }
    }

    // ── Alex ───────────────────────────────────────────────────
    case 'top_trend_hooks': {
      const hooks = get<Array<Record<string, unknown>>>(c, 'hooks', [])
      const fav = hooks.find((h) => h.flagged) || hooks[1] || hooks[0]
      const favText = fav ? String(fav.text) : ''
      const favReason = fav ? String((fav as Record<string, unknown>).favoriteReason || '') : ''
      return {
        opening: `Wrote 5 variations. My pick: **"${favText}"** — ${favReason.split('.')[0]}. The other 4 are weaker for specific reasons (in the brief). Want a different angle or are we shipping this one?`,
        suggestedReplies: ['Ship this one', 'Why is mine #2?', 'Try a sharper angle'],
        viewLabel: 'Open all 5 hooks',
      }
    }
    case 'reel_script_30s': {
      const beats = get<Array<Record<string, unknown>>>(c, 'beats', [])
      return {
        opening: `30s script done — ${beats.length} beats: cold open, tension, reframe, payoff. The cold open is silent for the first 1.5s — that's the scroll-stop. Want to walk through any beat or are we ready for Riley to shot-list?`,
        suggestedReplies: ['Hand to Riley', 'Walk me through the cold open', 'Punch up the payoff'],
        viewLabel: 'Open the script',
      }
    }
    case 'caption_next_post': {
      const text = String(get(c, 'text', ''))
      const firstLine = text.split('\n')[0] || ''
      return {
        opening: `Drafted a caption — leads with: "${firstLine}". Single soft CTA on the close. Want me to tighten or punch the close?`,
        suggestedReplies: ['Use as-is', 'Tighten it', 'Punchier close'],
        viewLabel: 'Open the caption',
      }
    }
    case 'carousel_opening_lines': {
      const hooks = get<Array<Record<string, unknown>>>(c, 'hooks', [])
      const fav = hooks.find((h) => h.flagged) || hooks[1] || hooks[0]
      const favText = fav ? String(fav.text) : ''
      return {
        opening: `Three slide-1 hooks. My pick: **"${favText}"** — direct address triggers self-check loop and doubles comment-rate on slide 1 in your niche. Want me to draft slides 2-7 too?`,
        suggestedReplies: ['Draft the rest', 'Try a different opener', 'Why this one?'],
        viewLabel: 'Open all 3 hooks',
      }
    }
    case 'bio_rewrite': {
      const rec = String(get(c, 'recommendation', ''))
      return {
        opening: `Three bio options ready for ${youAre}. ${rec.split('.')[0]}. Want me to tweak any of them or are we shipping?`,
        suggestedReplies: ['Ship Option A', 'Punchier please', 'Add something specific'],
        viewLabel: 'Open all 3 bios',
      }
    }

    // ── Riley ───────────────────────────────────────────────────
    case 'reel_shot_list': {
      const shots = get<Array<Record<string, unknown>>>(c, 'shots', [])
      const reelTitle = String(get(c, 'reelTitle', 'next Reel'))
      return {
        opening: `${shots.length}-shot plan for **${reelTitle}**. First 1.5 seconds are silent — that's the part of the cut that earns the scroll. Want me to walk through any shot in detail or are we ready to shoot?`,
        suggestedReplies: ['Walk me through shot 1', 'Simplify the cut', 'Approve and shoot'],
        viewLabel: 'Open the shot list',
      }
    }
    case 'pacing_notes': {
      const fix = String(get(c, 'oneFixThisWeek', ''))
      return {
        opening: `Pacing audit done. Your cuts run faster than the niche average — you're training the viewer to skim instead of watch. One fix this week: ${fix.split('.')[0]}. Want to discuss?`,
        suggestedReplies: ['Why slower wins', 'Show me an example', 'Approve the fix'],
        viewLabel: 'Open pacing notes',
      }
    }
    case 'visual_direction': {
      return {
        opening: `Proposed a cohesive look — palette, lighting, shot style, text overlay system. The next Reel is the test. Want me to spec a sample shot or hand straight to the editor?`,
        suggestedReplies: ['Spec a sample', 'Hand to editor', 'Adjust the palette'],
        viewLabel: 'Open visual direction',
      }
    }
    case 'thumbnail_brief': {
      return {
        opening: `Thumbnail spec is done — type treatment, color, focal subject. Big don't-do: no faces (your niche saves faceless thumbnails 2x more). Want a sketch first or send straight to the editor?`,
        suggestedReplies: ['Send to editor', 'I want to sketch first', 'Why no faces?'],
        viewLabel: 'Open the brief',
      }
    }
    case 'fix_weak_reel': {
      const why = String(get(c, 'whyItWorks', ''))
      return {
        opening: `Diagnosed the weak open: talking-head opens cost ~24 retention points in your niche. Fix is a 5-minute reshoot of the first 2.5 seconds. ${why.split('.')[0]}. Approve and I brief the editor.`,
        suggestedReplies: ['Approve the reshoot', 'Why silent opens win', 'Try a different fix'],
        viewLabel: 'Open the fix',
      }
    }
  }
  // Generic fallback for ad-hoc briefs.
  return {
    opening: `${persona} here. I just delivered the brief you asked for — open the file when you have a moment and let me know if you want changes.`,
    suggestedReplies: ['Walk me through it', 'Approve', 'Try a different angle'],
    viewLabel: 'Open the brief',
  }
}

function bedrockSystemPrompt(opts: ExecuteOpts, knowledgeBlock: string): string {
  const persona = PERSONA_NAME[opts.role]
  const nicheLabel = bucketForNiche(opts.niche)
  return `You are ${persona}, the ${opts.role} on a content team. Execute the CEO's brief and return structured JSON matching the shape the team renders to them.

CRITICAL CONTEXT — DO NOT IGNORE:
- The creator's niche is: ${opts.niche} (category: ${nicheLabel}).
- All output must be ON-BRAND for that niche. A fitness creator gets fitness advice, a coaching creator gets coaching advice, etc.
- DO NOT default to generic creator tropes (crypto, hustle culture, "moonshot", "alpha", "DYOR", emoji-heavy bio clichés) unless the niche is explicitly finance/crypto.
- DO NOT use emojis in bios, hooks, or captions unless the creator's brand voice clearly calls for them.

Reason from the niche knowledge below — do not reference it by name.${knowledgeBlock}

Return ONLY valid JSON, no prose, no code fences. Output type: ${opts.type}. Brief kind: ${opts.briefKind || 'unspecified'}.`
}

function bedrockUserPrompt(opts: ExecuteOpts): string {
  return `Brief title: ${opts.title}\n\n${opts.description ? `Brief details:\n${opts.description}\n\n` : ''}Produce the structured output now.`
}

export async function executeBrief(prisma: PrismaClient, opts: ExecuteOpts): Promise<ExecutionResult> {
  let execOpts = opts
  if (opts.companyId && opts.companyId !== 'test') {
    try {
      const memories = await readTopMemories(prisma, opts.companyId, 12)
      if (memories.length > 0) {
        const memoryBlock = formatMemoryForPrompt(
          memories.map((m) => ({ type: m.type, content: m.content })),
        )
        if (memoryBlock.trim()) {
          const mergedDescription = [memoryBlock.trim(), opts.description].filter(Boolean).join('\n\n')
          execOpts = { ...opts, description: mergedDescription || opts.description }
        }
      }
    } catch (e) {
      console.warn('[agentExecutor] readTopMemories failed', e)
    }
  }

  const query = [execOpts.title, execOpts.description].filter(Boolean).join(' ')
  const knowledge = await retrieveNicheKnowledge(prisma, {
    niche: execOpts.niche,
    role: execOpts.role,
    query,
    limit: 8,
    fallbackToDefault: true,
  })
  const knowledgeRows: KnowledgeRow[] = knowledge.map((k) => ({
    kind: k.kind, title: k.title, body: k.body, tags: k.tags,
  }))

  // Load personalization data unless the caller pre-supplied it (test
  // harness, etc.). Treat the DB load as best-effort — if anything
  // fails we continue with null and the generators fall back to
  // token-only defaults.
  let personal: PersonalContext | null = execOpts.personal ?? null
  if (personal === null && execOpts.companyId && execOpts.companyId !== 'test') {
    try {
      personal = await loadPersonalContext(prisma, execOpts.companyId)
    } catch (e) {
      console.warn('[agentExecutor] loadPersonalContext failed', e)
    }
  }

  const tokens = tokensFor(execOpts.niche)
  // Prefer briefKind routing; fall back to OutputType generator.
  const byKind = execOpts.briefKind ? BRIEF_GENERATORS[execOpts.briefKind] : undefined
  const generator = byKind || TYPE_FALLBACK[execOpts.type]

  // Bedrock is ONLY used when we don't have a curated generator for this
  // brief. The hand-crafted mocks produce more niche-accurate output than
  // Bedrock does without rich RAG context (users were getting crypto-bro
  // bios on a fitness account). When niche knowledge seeding + full RAG
  // prompts are ready, we can flip this back.
  const BEDROCK_TIMEOUT_MS = 8_000
  const shouldTryBedrock = hasBedrockCreds() && !byKind
  if (shouldTryBedrock) {
    const knowledgeBlock = knowledgeRows.length
      ? `\n\n--- Niche knowledge (${execOpts.niche}) ---\n${knowledgeRows.map((k) => `[${k.kind}] ${k.title}: ${k.body}`).join('\n')}\n--- End knowledge ---`
      : ''
    const bedrockCall = (async () => {
      const raw = await invokeAgent({
        systemPrompt: bedrockSystemPrompt(execOpts, knowledgeBlock),
        messages: [{ role: 'user', content: bedrockUserPrompt(execOpts) }],
        maxTokens: 1500,
        temperature: 0.7,
      })
      return parseAgentOutput<Record<string, unknown>>(raw)
    })()
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), BEDROCK_TIMEOUT_MS))
    try {
      const bedrockResult = await Promise.race([bedrockCall, timeoutPromise])
      if (bedrockResult) {
        return { content: bedrockResult, knowledgeUsed: knowledgeRows.length, source: 'bedrock' }
      }
      console.warn(`[agentExecutor] bedrock exceeded ${BEDROCK_TIMEOUT_MS}ms, falling back to mock for task ${execOpts.taskId}`)
    } catch (err) {
      console.warn('[agentExecutor] bedrock path failed, falling back to mock', err)
    }
  }
  if (!generator) {
    return {
      content: { note: `No generator wired for type "${execOpts.type}" / kind "${execOpts.briefKind ?? 'none'}".` },
      knowledgeUsed: knowledgeRows.length, source: 'mock',
    }
  }
  const content = generator(tokens, personal, knowledgeRows)
  if (knowledgeRows.length) {
    (content as Record<string, unknown>).knowledgeApplied = knowledgeRows.map((k) => `[${k.kind}] ${k.title}`)
  }
  // Attach a presentation script — the agent's opening message + suggested
  // CEO replies — so the frontend can launch a meeting room around the
  // brief instead of just dropping the file in the library.
  const presentation = presentBrief({
    briefKind: execOpts.briefKind,
    content,
    role: execOpts.role,
    ctx: personal,
  })
  if (presentation) {
    (content as Record<string, unknown>).presentation = presentation
  }
  return { content, knowledgeUsed: knowledgeRows.length, source: 'mock' }
}

export async function executeAndStore(prisma: PrismaClient, opts: ExecuteOpts) {
  const result = await executeBrief(prisma, opts)
  const output = await prisma.output.create({
    data: {
      taskId: opts.taskId,
      companyId: opts.companyId,
      employeeId: (await prisma.task.findUniqueOrThrow({ where: { id: opts.taskId } })).employeeId,
      type: opts.type,
      content: result.content as unknown as Prisma.InputJsonObject,
      status: 'draft',
    },
  })
  await prisma.task.update({
    where: { id: opts.taskId },
    data: { status: 'delivered' },
  })
  return { output, knowledgeUsed: result.knowledgeUsed, source: result.source }
}
