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
import { invokeAgent, parseAgentOutput } from './bedrock/bedrock.service'
import { isTestMode } from '../lib/mode'

interface ExecuteOpts {
  taskId: string
  companyId: string
  niche: string
  role: AgentRole
  type: OutputType
  title: string
  description?: string | null
  briefKind?: string | null
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
}

const NICHE_TOKENS: Record<string, NicheTokens> = {
  fitness: {
    label: 'fitness',
    sampleTrend: 'weighted walking',
    sampleTrend2: 'protein-first breakfast',
    samplePillars: ['transformation', 'myth busting', 'behind the scenes'],
    sampleCompetitors: ['@strongmom_official', '@runlessfaster', '@coach.amanda'],
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
  },
  finance: {
    label: 'finance',
    sampleTrend: 'HYSA rate-chase',
    sampleTrend2: 'three-account system',
    samplePillars: ['frameworks', 'myth busting', 'real numbers'],
    sampleCompetitors: ['@humbledollar', '@moneywithkatie', '@gradmoneyguide'],
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
  },
  food: {
    label: 'food',
    sampleTrend: 'cottage cheese dessert',
    sampleTrend2: 'no-flour bread',
    samplePillars: ['quick wins', 'ingredient deep-dives', 'kitchen stories'],
    sampleCompetitors: ['@proteinchefmel', '@onepanwonders', '@baked.by.lo'],
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
  },
  coaching: {
    label: 'coaching',
    sampleTrend: 'micro-habits over goals',
    sampleTrend2: 'burnout recovery frameworks',
    samplePillars: ['frameworks', 'transformation proof', 'hot takes'],
    sampleCompetitors: ['@careerwithlina', '@emily.coaches', '@firstmanagerplaybook'],
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
  },
  lifestyle: {
    label: 'lifestyle',
    sampleTrend: 'Sunday reset',
    sampleTrend2: 'capsule wardrobe',
    samplePillars: ['aesthetic', 'routine', 'product discovery'],
    sampleCompetitors: ['@thathomemaker', '@morning.ritual.club', '@the.hosting.shop'],
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
  },
}

function tokensFor(niche: string): NicheTokens {
  const bucket = bucketForNiche(niche)
  return NICHE_TOKENS[bucket] || NICHE_TOKENS.default!
}

// ─────────────────────────────────────────────────────────────────────
// MAYA (analyst) — 5 briefKinds
// ─────────────────────────────────────────────────────────────────────
function maya_weeklyTrends(t: NicheTokens) {
  return {
    kind: 'weekly_trends',
    generatedAt: new Date().toISOString(),
    headline: `Three trends moving in ${t.label} this week`,
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
          ifAct: 'Conservative 2-3x your baseline Reel reach. Aggressive: a clean breakout in the 80-150K range if the hook lands.',
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

function maya_competitorScan(t: NicheTokens) {
  return {
    kind: 'competitor_scan',
    generatedAt: new Date().toISOString(),
    headline: `Top 3 competitors in ${t.label} — what is working this month`,
    competitors: [
      {
        name: t.sampleCompetitors[0],
        size: '180K followers',
        topFormat: 'Reel + pinned cornerstone carousel',
        posting: '4 feed posts/week · Mon/Wed/Fri 6am, Sun 8pm',
        pillars: [t.samplePillars[0], t.samplePillars[1]],
        hookPattern: 'Swap framing ("Stop X. Here is what actually works.")',
        whatIsWorking: 'Leans hard into the transformation pillar with a single recurring client story. Comments loop because they end every post with a direct question.',
        copyFromThem: 'The pinned cornerstone — one big reference carousel they drive every Reel toward. That asset does distribution for months.',
        dontCopy: 'The daily posting cadence. They have a team; you don\'t. Copy the strategy, not the volume.',
      },
      {
        name: t.sampleCompetitors[1],
        size: '62K followers',
        topFormat: 'Carousel-first',
        posting: '3 posts/week · Tue/Thu/Sat',
        pillars: [t.samplePillars[1], t.samplePillars[2]],
        hookPattern: 'Counter-conventional ("You do not have a [X] problem. You have a [Y] problem.")',
        whatIsWorking: 'Save rate is 2x yours because every carousel ends on a screenshot-friendly framework page. Audience uses their posts as reference material.',
        copyFromThem: 'The last-slide structure. Always a framework people want to bookmark. Steal the pattern, bring your own content.',
        dontCopy: 'Their voice — too academic for your audience. Keep yours warmer.',
      },
      {
        name: t.sampleCompetitors[2],
        size: '28K followers · closest comp to you',
        topFormat: 'Reel-heavy',
        posting: '5 posts/week',
        pillars: t.samplePillars.slice(0, 2),
        hookPattern: 'Confession ("I quit X for 30 days.")',
        whatIsWorking: 'Fastest-growing of the three. Identity-shift confessions pulling 2-3x their baseline reach. Audience projects themselves into the role.',
        copyFromThem: 'The identity-shift framing. Works even better on your account if you anchor it to a specific bottleneck your audience recognizes.',
        dontCopy: 'The publishing volume. You will burn out before you see the lift.',
      },
    ],
    nextStep: `${PERSONA_NAME.analyst} can brief Alex on a swap-framing hook set next — that is the single biggest lever you could pull from this scan.`,
    knowledgeApplied: [] as string[],
  }
}

function maya_hashtagReport(t: NicheTokens) {
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

function maya_audienceDeepDive(t: NicheTokens) {
  return {
    kind: 'audience_deep_dive',
    generatedAt: new Date().toISOString(),
    headline: `What we know about your audience · ${t.label}`,
    demographics: [
      { label: 'Primary segment', value: t.audiencePrimary },
      { label: 'Age skew', value: '72% in 25-44 (heavy 28-38)' },
      { label: 'Location', value: 'US-heavy, with NY/CA/TX leading' },
      { label: 'Device', value: '94% mobile, stories consumed vertical-first' },
    ],
    peakWindows: {
      label: 'When they are actually scrolling',
      value: t.peakWindow,
      note: 'Sunday evening is the highest-converting slot of the week — reserve your most structured CTA for that window.',
    },
    topPillars: {
      label: 'What they respond to best (from your own account + comp set)',
      items: t.samplePillars.map((p, i) => ({
        pillar: p,
        signal: i === 0 ? 'Highest save-rate' : i === 1 ? 'Highest comment-rate' : 'Highest profile-visit-to-follow',
      })),
    },
    oneThingToStop: 'Drop the generic motivation quotes. They pull your share rate up short-term but your save + follow rate has been trending down every time you post one. Replace with specific-number content from the transformation pillar.',
    whatWeStillDoNotKnow: [
      'Conversion intent (newsletter signup rate on IG-sourced traffic)',
      'Story-to-feed engagement crossover',
      'DM volume + sentiment',
    ],
    knowledgeApplied: [] as string[],
  }
}

function maya_engagementDiagnosis(t: NicheTokens) {
  return {
    kind: 'engagement_diagnosis',
    generatedAt: new Date().toISOString(),
    headline: 'Why your engagement dropped the last two weeks',
    summary: 'Engagement rate is down ~23% over 14 days. Three specific shifts drove it. None are catastrophic — all are fixable this week.',
    findings: [
      {
        label: 'Finding 1 · Cadence compression',
        detail: 'You posted 3 Reels in 4 days between day 8-11, then nothing for 6 days. Audience training tells the algorithm to depress your reach after a gap — the two posts after the gap both under-performed by ~40%.',
        fix: 'Space to every other day at minimum. Never more than 4 days dark.',
      },
      {
        label: 'Finding 2 · Off-pillar post on day 9',
        detail: 'The motivation quote post pulled your median share-rate up temporarily but save-rate for the three posts after it dropped below 0.8% — your lowest in 90 days. Your algorithmic audience shifted toward share-only consumers.',
        fix: 'Cut the motivation pillar entirely for 14 days. Back into the transformation + myth-busting pillars.',
      },
      {
        label: 'Finding 3 · Hook pattern fatigue',
        detail: '4 of your last 6 hooks started with the same specific-number pattern ("The X-minute..."). Audience recognizes the pattern and the swipe-away rate climbed. First-3-second retention dropped from 72% to 54%.',
        fix: 'Rotate to confession or swap framing for the next 3 posts. Ask Alex for a hook set.',
      },
    ],
    oneFixThisWeek: 'Ship a confession-style Reel on the transformation pillar by Thursday. Keep cadence tight (every other day) through the weekend. Engagement should normalize within 10 days.',
    knowledgeApplied: [] as string[],
  }
}

// ─────────────────────────────────────────────────────────────────────
// JORDAN (strategist) — 5 briefKinds
// ─────────────────────────────────────────────────────────────────────
function jordan_weeklyPlan(t: NicheTokens) {
  const today = new Date().toISOString().slice(0, 10)
  return {
    kind: 'weekly_plan',
    weekOf: today,
    headline: `Next week · anchored on ${t.label} pillars`,
    pillars: t.samplePillars,
    posts: [
      { day: 'Mon', format: 'Reel', topic: t.samplePillars[0], angle: `Transformation beat · lead with the specific-time-frame hook. Ship by 6am ET to catch the ${t.peakWindow} wave.` },
      { day: 'Wed', format: 'Carousel', topic: t.samplePillars[1], angle: `Myth + framework stack. End slide is the screenshot-friendly takeaway. ${t.savePattern}` },
      { day: 'Fri', format: 'Reel', topic: t.sampleTrend, angle: 'Trend-driven slot. Lean into Maya\'s weekly flag — swap framing.' },
      { day: 'Sun', format: 'Reel', topic: t.samplePillars[2], angle: 'Behind-the-scenes warmth. Sunday evening is the highest-converting window — include a soft CTA.' },
    ],
    cadenceNote: '4 feed posts + daily stories. Space posts every other day minimum to keep the algorithm warm without fatigue.',
    reserved: '1 trend-reactive slot (Fri) — we swap this based on Maya\'s mid-week trend pulse.',
    nextWeekNote: 'If Friday trend slot lands >1.5x baseline, extend into a 3-post mini-series the following week.',
    knowledgeApplied: [] as string[],
  }
}

function jordan_pillarRebuild(t: NicheTokens) {
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

function jordan_cadencePlan(t: NicheTokens) {
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

function jordan_ninetyDayPlan(t: NicheTokens) {
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

function jordan_slotAudit(t: NicheTokens) {
  return {
    kind: 'slot_audit',
    generatedAt: new Date().toISOString(),
    headline: 'Two weakest content slots · replace these first',
    slots: [
      {
        label: 'Weakest slot · Friday "quick tip" Reel',
        problem: 'Save-rate of 0.6% over the last 6 Fridays (vs your 2.1% account median). Hook pattern is tired — audience recognizes it and swipes.',
        replacement: `Friday becomes the trend-reactive slot. Whatever Maya flags mid-week, Alex writes the hook, Riley shot-lists by Thursday 2pm. Shipped Friday 5:30am.`,
        expectedLift: 'If trend discipline holds, expect 2-3x the reach this slot used to produce.',
      },
      {
        label: '2nd weakest · generic motivation quote post',
        problem: 'Pulls share rate up temporarily but audience that shares it never saves or converts. Pulls the algorithm toward a share-only audience that does not buy.',
        replacement: `Replace with a client-win carousel on the ${t.samplePillars[0]} pillar. Name + before-state + specific move + result. 1x/2 weeks max.`,
        expectedLift: 'Save-rate per post should triple. Follower conversion on this slot should shift from 0.2% to ~0.8%.',
      },
    ],
    keep: `The Sunday 8pm ${t.samplePillars[2]} Reel is your best slot. Leave it alone. ${t.peakWindow.includes('Sun') ? 'Peak window for your audience.' : ''}`,
    knowledgeApplied: [] as string[],
  }
}

// ─────────────────────────────────────────────────────────────────────
// ALEX (copywriter) — 5 briefKinds
// ─────────────────────────────────────────────────────────────────────
function alex_topTrendHooks(t: NicheTokens) {
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

function alex_reelScript30s(t: NicheTokens) {
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

function alex_captionNextPost(t: NicheTokens) {
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

function alex_carouselOpeningLines(t: NicheTokens) {
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

function alex_bioRewrite(t: NicheTokens) {
  return {
    kind: 'bio_rewrite',
    generatedAt: new Date().toISOString(),
    headline: 'Bio rewrite · three options',
    current: '(paste your current bio here — I\'ll critique it specifically once I see it)',
    options: [
      {
        label: 'Option A · outcome-first',
        text: `Helping ${t.audiencePrimary}\nship better content in 15 min/day\n↓ start here`,
        why: 'Who you help + what they get + one action. 3-line formula that converts best for this audience.',
      },
      {
        label: 'Option B · identity-first',
        text: `I was stuck too.\nNow I help ${t.audiencePrimary}\nbuild a system that compounds.\n↓ the first step`,
        why: 'Origin-story framing. Lower conversion short-term, higher trust long-term. Best if your pinned content is transformation-anchored.',
      },
      {
        label: 'Option C · punchy',
        text: `${t.label}. Without the noise.\n↓ what I actually do`,
        why: 'Minimalist. Works if your feed grid does the heavy lifting. Risky if a visitor can\'t infer your offer in 3 seconds.',
      },
    ],
    recommendation: 'Option A for most accounts. Option B if your best-performing content is transformation-pillar. Avoid C unless your feed is visually tight.',
    ctaRule: 'One link only. "Link in bio" phrasing underperforms a direct arrow + noun ("↓ start here").',
    knowledgeApplied: [] as string[],
  }
}

// ─────────────────────────────────────────────────────────────────────
// RILEY (creative_director) — 5 briefKinds
// ─────────────────────────────────────────────────────────────────────
function riley_reelShotList(t: NicheTokens) {
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

function riley_pacingNotes(t: NicheTokens) {
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

function riley_visualDirection(t: NicheTokens) {
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

function riley_thumbnailBrief(t: NicheTokens) {
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

function riley_fixWeakReel(t: NicheTokens) {
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
type BriefGenerator = (t: NicheTokens, knowledge: KnowledgeRow[]) => Record<string, unknown>

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
  trend_report: (t) => maya_weeklyTrends(t),
  content_plan: (t) => jordan_weeklyPlan(t),
  hooks: (t) => alex_topTrendHooks(t),
  script: (t) => alex_reelScript30s(t),
  caption: (t) => alex_captionNextPost(t),
  shot_list: (t) => riley_reelShotList(t),
  video: () => ({ status: 'pending', note: 'Video generation is briefed to Creatomate once a shot list is approved.' }),
}

// ─────────────────────────────────────────────────────────────────────
// MAIN EXECUTOR
// ─────────────────────────────────────────────────────────────────────

function bedrockSystemPrompt(opts: ExecuteOpts, knowledgeBlock: string): string {
  const persona = PERSONA_NAME[opts.role]
  return `You are ${persona}, the ${opts.role} on a content team. Execute the CEO's brief and return structured JSON matching the shape the team renders to them. Reason from the niche knowledge below — do not reference it by name.${knowledgeBlock}\n\nReturn ONLY valid JSON, no prose, no code fences. Output type: ${opts.type}. Brief kind: ${opts.briefKind || 'unspecified'}.`
}

function bedrockUserPrompt(opts: ExecuteOpts): string {
  return `Brief title: ${opts.title}\n\n${opts.description ? `Brief details:\n${opts.description}\n\n` : ''}Produce the structured output now.`
}

export async function executeBrief(prisma: PrismaClient, opts: ExecuteOpts): Promise<ExecutionResult> {
  const query = [opts.title, opts.description].filter(Boolean).join(' ')
  const knowledge = await retrieveNicheKnowledge(prisma, {
    niche: opts.niche,
    role: opts.role,
    query,
    limit: 8,
    fallbackToDefault: true,
  })
  const knowledgeRows: KnowledgeRow[] = knowledge.map((k) => ({
    kind: k.kind, title: k.title, body: k.body, tags: k.tags,
  }))

  const BEDROCK_TIMEOUT_MS = 8_000
  if (hasBedrockCreds()) {
    const knowledgeBlock = knowledgeRows.length
      ? `\n\n--- Niche knowledge (${opts.niche}) ---\n${knowledgeRows.map((k) => `[${k.kind}] ${k.title}: ${k.body}`).join('\n')}\n--- End knowledge ---`
      : ''
    const bedrockCall = (async () => {
      const raw = await invokeAgent({
        systemPrompt: bedrockSystemPrompt(opts, knowledgeBlock),
        messages: [{ role: 'user', content: bedrockUserPrompt(opts) }],
        maxTokens: 1500,
        temperature: 0.7,
      })
      return parseAgentOutput<Record<string, unknown>>(raw)
    })()
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), BEDROCK_TIMEOUT_MS))
    try {
      const bedrockResult = await Promise.race([bedrockCall, timeout])
      if (bedrockResult) {
        return { content: bedrockResult, knowledgeUsed: knowledgeRows.length, source: 'bedrock' }
      }
      console.warn(`[agentExecutor] bedrock exceeded ${BEDROCK_TIMEOUT_MS}ms, falling back to mock for task ${opts.taskId}`)
    } catch (err) {
      console.warn('[agentExecutor] bedrock path failed, falling back to mock', err)
    }
  }

  const tokens = tokensFor(opts.niche)
  // Prefer briefKind routing; fall back to OutputType generator.
  const byKind = opts.briefKind ? BRIEF_GENERATORS[opts.briefKind] : undefined
  const generator = byKind || TYPE_FALLBACK[opts.type]
  if (!generator) {
    return {
      content: { note: `No generator wired for type "${opts.type}" / kind "${opts.briefKind ?? 'none'}".` },
      knowledgeUsed: knowledgeRows.length, source: 'mock',
    }
  }
  const content = generator(tokens, knowledgeRows)
  if (knowledgeRows.length) {
    (content as Record<string, unknown>).knowledgeApplied = knowledgeRows.map((k) => `[${k.kind}] ${k.title}`)
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
