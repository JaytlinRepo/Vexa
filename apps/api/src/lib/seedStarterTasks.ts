import { PrismaClient, TaskStatus, OutputType, Prisma } from '@prisma/client'

interface SeedInput {
  companyId: string
  niche: string
}

interface TrendItem {
  topic: string
  growth: string
  growthPct: number
  window: string
  urgency: 'act_now' | 'build' | 'skip'
  sparkline: number[] // 7 normalized values 0-100 representing the last week
  audienceFit: string
  // Maya's analytical reasoning. The renderer treats every field below as
  // optional so older seeds with just insight/action/solution still render.
  whyNow?: string                                       // What triggered the spike
  signals?: Array<{ label: string; value: string }>    // Concrete data Maya pulled
  competitorMoves?: string                             // Who else is in the lane
  predictedOutcome?: { ifAct: string; ifSkip: string } // What happens either way
  insight: string   // Maya's overall read
  action: string    // The 3-step play
  solution: string  // What Maya is briefing the team on
}

interface NichePack {
  pillars: [string, string, string]
  posts: [
    { format: string; topic: string; angle: string },
    { format: string; topic: string; angle: string },
    { format: string; topic: string; angle: string },
  ]
  trends: [TrendItem, TrendItem, TrendItem]
  hookTopic: string
  hooks: [string, string, string, string, string]
  flaggedHookIndex: number
  shotList: {
    reelTitle: string
    duration: string
    shots: Array<{ n: number; at: string; shot: string; note: string }>
    soundNote: string
    editorNote: string
  }
}

// Each niche gets a day-1 set that feels specific, not generic. We keep the
// shape identical so the UI can render any pack without branching. Niches
// are matched by substring so "fitness & wellness" and "health+fitness" both
// land on the fitness pack.
const NICHE_PACKS: Array<{ match: RegExp; pack: NichePack }> = [
  {
    match: /fit|gym|health|wellness|workout/i,
    pack: {
      pillars: ['transformation', 'myth busting', 'behind the scenes'],
      posts: [
        { format: 'Reel', topic: 'one-change transformation', angle: 'the 10-min swap' },
        { format: 'Carousel', topic: 'myth: more cardio = more fat loss', angle: 'the bench study' },
        { format: 'Reel', topic: 'client win', angle: 'from tired to on-plan' },
      ],
      trends: [
        {
          topic: 'weighted walking',
          growth: '+340%',
          growthPct: 340,
          window: '48h',
          urgency: 'act_now',
          sparkline: [12, 18, 22, 35, 58, 81, 100],
          audienceFit: 'Strong — your followers index 1.8x against the "low-impact, time-poor" segment that is driving this trend. Save rate on your last three transformation posts (12.4%) suggests this audience is actively bookmarking solutions, not just watching.',
          whyNow: 'Two macro-creators (1.2M and 840K followers) dropped vest-walk Reels within 18 hours of each other on Tuesday. Combined they pulled 4.1M views in the first 24 hours, which triggered the algorithm to start routing weighted-walking content to fitness watchers across the platform. The trend is in the "still expanding" phase — not yet locked to a single sound, so original audio is still rewarded. Historically these windows close in 5-7 days as the lane fills with copycat content and the algorithm shifts to penalizing repetition.',
          signals: [
            { label: 'Search interest (Google + IG)', value: '+340% / 48h' },
            { label: 'Top-50 fitness accounts posting', value: '11 of 50' },
            { label: 'Avg engagement on category', value: '4.2x baseline' },
            { label: 'Estimated trend window remaining', value: '4-6 days' },
            { label: 'Competing audios', value: '3 (none dominant yet)' },
            { label: 'Hashtag saturation', value: 'Low (#weightedwalking 84K posts)' },
          ],
          competitorMoves: 'Two of your direct comp set (@strongmom_official and @runlessfaster) posted within the last 36 hours. Both used the "treadmill swap" angle. Neither has hit the carousel format yet — that lane is still open and historically out-saves Reels for this kind of content by 2.1x.',
          predictedOutcome: {
            ifAct: 'Conservative: 2-3x your last-30-day median Reel reach (~28K views). Aggressive: a clean breakout in the 80K-150K range if the hook lands and the swap framing earns saves. Either way you pick up 200-500 followers from the right audience.',
            ifSkip: 'You give up the cleanest growth window of the month. The lane will be owned by Friday. Re-entering after that means competing with creators 5-10x your size for the same algorithmic surface.',
          },
          insight: 'This is the cleanest trend window we have had in 4 weeks. The combination of macro-creator activation, low audio saturation, and an open carousel lane means you can still claim a position if you ship by Thursday. The swap framing (treadmill → weighted walk) is doing 3.4x the engagement of generic vest-walk content because it triggers the comment-bait loop ("but does it actually burn more than running?"). That comment volume is what the algorithm reads as quality signal.',
          action: 'Ship a Reel by Thursday, then a save-bait carousel by Sunday. Reel leads with the swap framing and the heart-rate-zone visual to drive comments. Carousel breaks down the math (calorie burn comparison, time efficiency, gear cost) for the saves. Stack them so the carousel rides the comment momentum from the Reel.',
          solution: 'Briefs already going out: Alex is writing 5 hook variations (the "your treadmill is the problem" angle is in the queue), Riley is shot-listing the 28-second cut with the heart-rate overlay. You will see all of it in your review queue within the hour. Approve and you ship Thursday.',
        },
        {
          topic: 'protein-first breakfast',
          growth: '+180%',
          growthPct: 180,
          window: '7d',
          urgency: 'build',
          sparkline: [38, 42, 51, 60, 68, 75, 82],
          audienceFit: 'Good — your audience has high overlap with the macro-counting sub-segment. Posts about food rank #2 in your historical save-rate (behind transformation). Engagement skews female 25-39, which is the demographic driving the search.',
          whyNow: 'This is a 9-week sustained climb, not a spike. Search interest has been ladder-stepping up since the start of January as the "quit dieting, start fueling" reframing has caught on. No single creator is owning it, which means the lane is still open for a thoughtful series rather than a one-off Reel.',
          signals: [
            { label: 'Search interest (Google + IG)', value: '+180% / 7d, +810% / 90d' },
            { label: 'Top-50 fitness accounts posting', value: '6 of 50 (low coverage)' },
            { label: 'Avg engagement on category', value: '1.8x baseline' },
            { label: 'Trend trajectory', value: 'Climbing, no saturation point' },
            { label: 'Save-to-share ratio', value: '4.1:1 (heavy save behavior)' },
            { label: 'Best format (your audience)', value: 'Carousel + Reel pair' },
          ],
          competitorMoves: 'Comp set is mostly silent on this one. @nutritionwithnatalie is the only direct competitor running a series, and their format (single Reel per breakfast) is leaving the multi-day macro framing on the table. That is your wedge.',
          predictedOutcome: {
            ifAct: 'A 4-post series builds a pillar that compounds. Expect each post to pull 1.2-1.6x your baseline reach on the post day, plus 30-40% of total engagement coming in days 8-30 from search and saves. Likely 600-1200 net followers across the series.',
            ifSkip: 'You lose a pillar opportunity. Trends like this only show up 2-3x a year for a niche, and accounts that own them become the default reference point in their lane.',
          },
          insight: 'This is the opposite kind of opportunity from weighted walking — slow-burn instead of spike. The math here favors a series, not a single post. Each post seeds search + saves that keep working for 30+ days, so by post 4 you have a stack of evergreen distribution. The save-to-share ratio (4.1:1) tells me this audience treats this content like reference material — they bookmark it for grocery day. That changes the format: tight macros visible on screen, label readable, screenshot-friendly composition.',
          action: 'Build a 4-post series across 2 weeks (Mon/Wed/Fri/Mon). Each post anchors on one breakfast — eggs, cottage cheese, Greek yogurt, overnight oats — with the macros stacked visibly on the visual itself. Pair each Reel with a carousel covering the macro math. Anchor the series with a pinned cornerstone post on profile.',
          solution: 'Handing off to Jordan now to slot the series into weeks 2-3. I am pulling the 5 highest-saving breakfast formats from the last 90 days so we start from proven structures instead of guessing. Riley will spec a consistent visual treatment so the series reads as a system, not 4 unrelated posts.',
        },
        {
          topic: 'mini-band booty prep',
          growth: '+90%',
          growthPct: 90,
          window: '7d',
          urgency: 'skip',
          sparkline: [55, 58, 61, 64, 67, 69, 72],
          audienceFit: 'Weak — your audience is broader than the booty-prep sub-niche. Followers who came in for transformation content actively unfollow when accounts pivot too hard into glute-isolation work (we saw a small dip in May 2025 after one such post).',
          whyNow: 'Spring/summer prep cycle as expected — this trend climbs every Q1 and peaks late March. Nothing new about the angle and no fresh creator activation, just calendar.',
          signals: [
            { label: 'Search interest (Google + IG)', value: '+90% / 7d' },
            { label: 'Top-50 fitness accounts posting', value: '34 of 50 (heavy saturation)' },
            { label: 'Avg engagement on category', value: '0.6x baseline (suppressed)' },
            { label: 'Lane ownership', value: '12 accounts hold 80% of impressions' },
            { label: 'Estimated reach if you post', value: '20-35% of your baseline' },
            { label: 'Predicted follower delta', value: 'Net -10 to -40' },
          ],
          competitorMoves: 'The lane is owned. @bandbootybuilder, @glutebible, and 10 others have posted in the last 14 days. Combined they hold 80% of category impressions. The remaining 20% is split across 200+ accounts — that is the bucket you would land in.',
          predictedOutcome: {
            ifAct: 'Below-baseline reach (likely 6K-12K vs your 28K median). Expect 0-50 followers gained, plus a small unfollow event from your transformation audience as they read the pivot. Net: lose ground.',
            ifSkip: 'No cost. The category will normalize after spring and your slot stays uncluttered for the trends that actually fit your audience.',
          },
          insight: 'This is the trap of trend reports — a +90% number looks compelling until you check who actually owns the lane. Of the last 200 viral Reels in this category, 80% came from 12 accounts you cannot out-distribute. The algorithm has already routed this audience to those creators. Your post would hit your existing followers and stop. Worse, posting this kind of isolation work signals a niche shift to your audience that does not match what they followed you for.',
          action: 'Pass. Spend the week on the weighted walking play and the protein breakfast series. If you really want a glute angle, the open lane is "compound lifts that grow glutes" — none of the booty-prep accounts are touching it because it is harder and less video-friendly. I can scope that as a follow-up if you want.',
          solution: 'No brief on this one. Holding the slot. I will pulse-check this category weekly — if a sub-angle (e.g. mini-band for postpartum recovery) breaks open with less competition, I will flag it as a separate trend.',
        },
      ],
      hookTopic: 'weighted walking',
      hooks: [
        'The 15-minute walk that burns more than cardio.',
        'Your treadmill is the problem. Here is what I swapped to.',
        'Why I stopped running and started walking weighted.',
        'I quit the gym for 30 days. This is what replaced it.',
        'One change made fat loss feel easy again.',
      ],
      flaggedHookIndex: 2,
      shotList: {
        reelTitle: 'Weighted walking — 15 min swap',
        duration: '28s',
        shots: [
          { n: 1, at: '0.0s', shot: 'Close-up on the vest clip', note: 'silence, 1.5s' },
          { n: 2, at: '1.5s', shot: 'Wide: stepping onto the trail', note: 'hook voiceover starts' },
          { n: 3, at: '6.0s', shot: 'POV of feet on gravel, light jog-to-walk', note: 'tempo match on beat' },
          { n: 4, at: '12.0s', shot: 'Chest text overlay — heart-rate range', note: 'b-roll from watch' },
          { n: 5, at: '22.0s', shot: 'Face to camera, delivering the payoff line', note: 'direct to lens' },
        ],
        soundNote: 'Subtle ambient, no licensed music — voiceover carries it.',
        editorNote: 'Cut on breath, not on beat. Keep the first 2s quiet.',
      },
    },
  },
  {
    match: /financ|money|invest|wealth|bank/i,
    pack: {
      pillars: ['myth busting', 'frameworks', 'real numbers'],
      posts: [
        { format: 'Carousel', topic: 'the three-account system', angle: 'what every HYSA is missing' },
        { format: 'Reel', topic: 'myth: you need to budget to the dollar', angle: 'the 60/20/20 shortcut' },
        { format: 'Reel', topic: 'client paid off 40k', angle: 'the one move that did it' },
      ],
      trends: [
        {
          topic: 'HYSA rate drops',
          growth: '+210%',
          growthPct: 210,
          window: '72h',
          urgency: 'act_now',
          sparkline: [18, 24, 31, 48, 67, 88, 100],
          audienceFit: 'High fit — your audience overlaps heavily with the rate-chasing sub-segment.',
          insight: 'The Fed signaling pulled the discussion into the mainstream this week. Rate-chase content always over-performs in the 5-day window after a Fed move because people are actively searching for the next move.',
          action: 'Post a "where I just moved my emergency fund" Reel + a carousel comparing 5 current HYSA rates. Carousel does the saves; Reel does the reach.',
          solution: 'I am pulling current rates for the top 8 HYSAs right now. Alex will draft both the Reel hook and the carousel slides. You will see both before EOD.',
        },
        {
          topic: 'house-hacking ADUs',
          growth: '+150%',
          growthPct: 150,
          window: '14d',
          urgency: 'build',
          sparkline: [32, 40, 47, 55, 60, 68, 76],
          audienceFit: 'Medium fit — pulls a slightly older demographic than your core. Real estate-curious sub-segment.',
          insight: 'This is the slow-burn version of the rate-drop story. People are looking for cash-flow plays now that yield is dropping. ADU content is sticky because the audience saves it for "someday."',
          action: 'Build one detailed carousel walking through the math of a real ADU build. Skip Reels — this is a save, not a share.',
          solution: 'Jordan will slot it into week 3. I will pull two real cost breakdowns from public permits to make it credible.',
        },
        {
          topic: 'roth ladder for FI',
          growth: '+85%',
          growthPct: 85,
          window: '7d',
          urgency: 'skip',
          sparkline: [60, 62, 65, 67, 70, 72, 75],
          audienceFit: 'Weak fit — too niche for your audience. Skews 35+ FIRE crowd.',
          insight: 'Real growth, but in a sub-segment that is not yours. The FI crowd already has its trusted creators and your account does not have the credibility signal they look for in tax-strategy content.',
          action: 'Pass. If you post this you will get traffic from the wrong audience and your follow-rate will drop.',
          solution: 'No deliverable on this one. I will keep watching for a beginner-side angle that fits your audience.',
        },
      ],
      hookTopic: 'the three-account system',
      hooks: [
        'If you only have one checking account, you are leaking money.',
        'Your bank is designed to keep you broke. Here is the fix.',
        'The three-account system that killed my overspending.',
        'I stopped budgeting and started saving more. Here is how.',
        'Stop watching finance content. Start moving money instead.',
      ],
      flaggedHookIndex: 2,
      shotList: {
        reelTitle: 'Three-account system — 30s explainer',
        duration: '30s',
        shots: [
          { n: 1, at: '0.0s', shot: 'Overhead of three envelopes on a table', note: 'text overlay: "the only three you need"' },
          { n: 2, at: '2.0s', shot: 'Talking head, direct to lens', note: 'hook delivery' },
          { n: 3, at: '7.0s', shot: 'Phone screen — mock bank app, three accounts', note: 'zoom + highlight each' },
          { n: 4, at: '18.0s', shot: 'Hand writing dollar amounts on cards', note: 'specific numbers, not percentages' },
          { n: 5, at: '25.0s', shot: 'Talking head — payoff line', note: 'tight framing, direct eye contact' },
        ],
        soundNote: 'No music first 2s. Low-tempo lo-fi underneath from :02.',
        editorNote: 'Cut fast between shots. Pace = urgency.',
      },
    },
  },
  {
    match: /food|chef|cook|recipe|bakery|nutrition/i,
    pack: {
      pillars: ['quick wins', 'ingredient deep-dives', 'kitchen stories'],
      posts: [
        { format: 'Reel', topic: '5-minute dinner', angle: 'the one-pan cheat' },
        { format: 'Carousel', topic: 'how to read an ingredient label', angle: 'the 3 red flags' },
        { format: 'Reel', topic: 'pantry makeover', angle: 'what I threw out and why' },
      ],
      trends: [
        {
          topic: 'cottage cheese dessert',
          growth: '+410%',
          growthPct: 410,
          window: '72h',
          urgency: 'act_now',
          sparkline: [10, 14, 22, 38, 64, 88, 100],
          audienceFit: 'Strong fit — high-protein dessert is a perfect match for your audience.',
          insight: 'A single audio is carrying this trend right now (you can spot it by the consistent 12-second cuts in the top posts). The window before it crests and noise overtakes it is roughly 4-6 days.',
          action: 'Use the trending audio (non-negotiable for this one), keep the first 3 seconds silent ASMR, payoff with the bite-to-camera. Post by Thursday.',
          solution: 'Riley already drafted the shot list (in your queue). Alex will write 3 hook options that work with the audio. Approve and we ship.',
        },
        {
          topic: 'no-flour bread',
          growth: '+140%',
          growthPct: 140,
          window: '14d',
          urgency: 'build',
          sparkline: [40, 46, 52, 58, 65, 71, 78],
          audienceFit: 'Strong fit — overlaps with the "what I eat in a day" search intent.',
          insight: 'Slower trajectory than cottage cheese but with longer life. Looks like a 6-week window before saturation. Good for a 3-recipe mini-series anchored on different proteins.',
          action: 'Build a Reel + carousel pair. Reel does the recipe, carousel does the macro breakdown people will save and reference.',
          solution: 'I will gather 3 recipe variations that have been pulling 50K+ saves so we are starting from proven formats. Jordan slots into next week.',
        },
        {
          topic: 'keto ice cream',
          growth: '+60%',
          growthPct: 60,
          window: '7d',
          urgency: 'skip',
          sparkline: [62, 64, 66, 68, 70, 71, 73],
          audienceFit: 'Weak fit — saturated and the keto angle does not match your broader-audience positioning.',
          insight: 'Trend is real but the lane is owned by 6-8 keto-specific accounts. Your audience is not actively saving keto content, so the algorithm will not push your post past its first cohort.',
          action: 'Skip. If you want a high-protein dessert play, cottage cheese is the better bet this week.',
          solution: 'No brief on this one. Rolling up cottage cheese as the protein-dessert play instead.',
        },
      ],
      hookTopic: 'cottage cheese dessert',
      hooks: [
        'This dessert has more protein than your dinner.',
        'Cottage cheese ice cream is not a gimmick. Here is why it works.',
        'I replaced dessert for 30 days. I lost weight without trying.',
        'The viral cottage cheese thing? Here is the only way to make it actually good.',
        'Your grocery cart is keeping you hungry. Swap one thing.',
      ],
      flaggedHookIndex: 1,
      shotList: {
        reelTitle: 'Cottage cheese dessert — 22s',
        duration: '22s',
        shots: [
          { n: 1, at: '0.0s', shot: 'Close-up: cottage cheese going into blender', note: 'ASMR-forward, no voiceover yet' },
          { n: 2, at: '2.0s', shot: 'Hand adding cocoa + maple', note: 'overhead' },
          { n: 3, at: '6.0s', shot: 'Blender spinning — slow-mo', note: 'music drops here' },
          { n: 4, at: '12.0s', shot: 'Pour into bowl, garnish', note: 'top-down with shallow depth' },
          { n: 5, at: '18.0s', shot: 'First bite, direct to camera', note: 'payoff reaction shot' },
        ],
        soundNote: 'Trending audio is non-negotiable for this one. Sound > script.',
        editorNote: 'Every cut on the beat. First 3s silent ASMR.',
      },
    },
  },
  {
    match: /coach|consult|executive|career|leadership/i,
    pack: {
      pillars: ['transformation proof', 'frameworks', 'hot takes'],
      posts: [
        { format: 'Carousel', topic: 'the 4-step reset', angle: 'what I walk every new client through' },
        { format: 'Reel', topic: 'myth: motivation is the problem', angle: 'the real bottleneck' },
        { format: 'Reel', topic: 'client story', angle: 'from stuck to promoted in 90 days' },
      ],
      trends: [
        {
          topic: 'micro-habits over goals',
          growth: '+190%',
          growthPct: 190,
          window: '7d',
          urgency: 'act_now',
          sparkline: [22, 30, 41, 56, 71, 84, 95],
          audienceFit: 'Strong fit — your audience is action-oriented and frustrated with the goal-setting playbook.',
          insight: 'The conversation flipped this week from "habits vs goals" debate to "here is the smallest possible habit to start with." That is the wedge you can own — concrete starter habits, not theory.',
          action: 'Ship two pieces back-to-back: a Reel hot take ("goals are vanity, habits ship"), then a carousel listing 5 specific 2-minute habits. Reel pulls reach, carousel pulls saves.',
          solution: 'Jordan is queuing both posts for this week. Alex will write the hot-take hook. You will have everything to approve by tomorrow.',
        },
        {
          topic: 'burnout recovery frameworks',
          growth: '+110%',
          growthPct: 110,
          window: '14d',
          urgency: 'build',
          sparkline: [42, 47, 53, 60, 66, 72, 80],
          audienceFit: 'Medium-strong fit — pulls a slightly older audience who are your highest-value buyers.',
          insight: 'Sustained climb, not a spike. This becomes a pillar post — something pinned to your profile that does evergreen distribution for months.',
          action: 'Build one cornerstone carousel walking through your 4-step reset framework. Treat this like a long-form artifact people screenshot and save.',
          solution: 'I will pull 3 burnout frameworks from credible sources you can attribute and frame against. Jordan slots it for week 2 so Alex has time to write it well.',
        },
        {
          topic: 'productivity stack videos',
          growth: '+40%',
          growthPct: 40,
          window: '7d',
          urgency: 'skip',
          sparkline: [65, 66, 68, 69, 71, 72, 73],
          audienceFit: 'Weak fit — saturated and pulls a tech-tool audience that overlaps poorly with your buyers.',
          insight: 'This trend is two years old and only minor growth. The accounts winning here are productivity-tool-specific creators, not coaches. Posting will pull the wrong audience.',
          action: 'Skip. If you want to do a tools post, frame it as "one tool that replaced 4 sessions" so it stays in your coaching lane.',
          solution: 'No brief. I will keep the radar on for a coaching-specific tool angle.',
        },
      ],
      hookTopic: 'micro-habits over goals',
      hooks: [
        'Goals are a vanity metric. Habits are the only thing that ships.',
        'You do not have a motivation problem. You have a starting problem.',
        'I killed my to-do list and got more done. Here is how.',
        'The 4-step reset I walk every client through in session one.',
        'Stop setting quarterly goals. Start setting 10-minute ones.',
      ],
      flaggedHookIndex: 1,
      shotList: {
        reelTitle: 'Micro-habits > goals — 26s',
        duration: '26s',
        shots: [
          { n: 1, at: '0.0s', shot: 'Talking head, tight crop, direct to lens', note: 'hook line only, no b-roll' },
          { n: 2, at: '4.0s', shot: 'Hand writing on paper — two columns', note: 'text overlay: goals vs. habits' },
          { n: 3, at: '10.0s', shot: 'B-roll of client session (blurred or anonymized)', note: 'voiceover continues' },
          { n: 4, at: '18.0s', shot: 'Talking head, same crop as open', note: 'payoff line' },
        ],
        soundNote: 'Subtle score, no trending audio. Authority > virality.',
        editorNote: 'Slow cuts. Give the words room.',
      },
    },
  },
]

const DEFAULT_PACK: NichePack = {
  pillars: ['signature story', 'myth busting', 'behind the scenes'],
  posts: [
    { format: 'Reel', topic: 'signature story', angle: 'your origin, one moment at a time' },
    { format: 'Carousel', topic: 'myth in your niche', angle: 'the one you hear most — debunked' },
    { format: 'Reel', topic: 'behind the scenes', angle: 'what a normal day looks like' },
  ],
  trends: [
    {
      topic: 'first trend — pending niche sync',
      growth: '+0%',
      growthPct: 0,
      window: 'pending sync',
      urgency: 'build',
      sparkline: [50, 50, 50, 50, 50, 50, 50],
      audienceFit: 'Will assess after the first sync pulls real account data.',
      insight: 'I have not pulled live trend data for your niche yet — this is a placeholder. Connect your account in Settings and I will replace this with real movement on my next sync.',
      action: 'Connect Instagram so I can scan your niche\'s top accounts and competitors.',
      solution: 'No briefs from this one yet. The first real trend report lands within 24h of connection.',
    },
    {
      topic: 'second trend — pending niche sync',
      growth: '+0%',
      growthPct: 0,
      window: 'pending sync',
      urgency: 'build',
      sparkline: [50, 50, 50, 50, 50, 50, 50],
      audienceFit: 'Pending real data.',
      insight: 'Same as above — placeholder until I have your niche feed indexed.',
      action: 'No action needed yet.',
      solution: 'No brief.',
    },
    {
      topic: 'third trend — pending niche sync',
      growth: '+0%',
      growthPct: 0,
      window: 'pending sync',
      urgency: 'build',
      sparkline: [50, 50, 50, 50, 50, 50, 50],
      audienceFit: 'Pending real data.',
      insight: 'Placeholder. After sync I will replace this slot with whatever is actually third on the trend list for your niche.',
      action: 'No action needed yet.',
      solution: 'No brief.',
    },
  ],
  hookTopic: 'your signature story',
  hooks: [
    'Start here — this is the one most people miss.',
    'The single thing I wish I knew when I started.',
    'If you are early in this, read this first.',
    'Everyone gets this wrong. Here is the version that works.',
    'One question changed everything for me.',
  ],
  flaggedHookIndex: 1,
  shotList: {
    reelTitle: 'Day-1 signature story — 25s',
    duration: '25s',
    shots: [
      { n: 1, at: '0.0s', shot: 'Talking head, direct to lens', note: 'hook line' },
      { n: 2, at: '4.0s', shot: 'B-roll: hands, object, or setting tied to the story', note: 'visual anchor' },
      { n: 3, at: '12.0s', shot: 'Talking head, closer crop', note: 'turn into the lesson' },
      { n: 4, at: '20.0s', shot: 'Wide — the payoff moment', note: 'quiet, let it breathe' },
    ],
    soundNote: 'No music first 2s.',
    editorNote: 'Slow cuts. Clarity over pace.',
  },
}

function packForNiche(niche: string): NichePack {
  for (const { match, pack } of NICHE_PACKS) {
    if (match.test(niche)) return pack
  }
  return DEFAULT_PACK
}

export async function seedStarterTasks(prisma: PrismaClient, input: SeedInput): Promise<void> {
  const pack = packForNiche(input.niche)
  const today = new Date().toISOString().slice(0, 10)
  const days = ['Mon', 'Wed', 'Fri']

  const seeds: Array<{
    role: 'analyst' | 'strategist' | 'copywriter' | 'creative_director'
    title: string
    type: OutputType
    description: string
    output: Prisma.InputJsonValue
  }> = [
    {
      role: 'strategist',
      title: 'Week one — content plan',
      type: 'content_plan',
      description: 'Your first weekly plan. Approve to kick off Alex on copy.',
      output: {
        weekOf: today,
        pillars: pack.pillars,
        posts: pack.posts.map((p, i) => ({ day: days[i], ...p })),
      },
    },
    {
      role: 'analyst',
      title: 'Trend report — this week',
      type: 'trend_report',
      description: 'The trends moving fastest in your niche. Two are viable this week.',
      output: {
        generatedAt: new Date().toISOString(),
        trends: pack.trends as unknown as Prisma.InputJsonValue,
      } as Prisma.InputJsonObject,
    },
    {
      role: 'copywriter',
      title: `Hooks — ${pack.hookTopic}`,
      type: 'hooks',
      description: `5 hook variations. #${pack.flaggedHookIndex + 1} is the one.`,
      output: {
        hooks: pack.hooks.map((text, i) => ({
          n: i + 1,
          text,
          flagged: i === pack.flaggedHookIndex || undefined,
        })),
      },
    },
    {
      role: 'creative_director',
      title: `Shot list — ${pack.shotList.reelTitle}`,
      type: 'shot_list',
      description: 'Full production brief. Ready to hand to whoever shoots it.',
      output: pack.shotList as unknown as Prisma.InputJsonValue,
    },
  ]

  const employees = await prisma.employee.findMany({ where: { companyId: input.companyId } })
  const employeeByRole = new Map(employees.map((e) => [e.role, e]))

  for (const seed of seeds) {
    const employee = employeeByRole.get(seed.role)
    if (!employee) continue
    await prisma.task.create({
      data: {
        companyId: input.companyId,
        employeeId: employee.id,
        title: seed.title,
        description: seed.description,
        type: seed.type,
        // Every day-1 task is delivered — the whole point of seeding is that
        // the CEO opens the dashboard to real outputs to approve, not empty
        // "warming up" cards.
        status: 'delivered',
        outputs: {
          create: {
            companyId: input.companyId,
            employeeId: employee.id,
            type: seed.type,
            content: seed.output,
            status: 'draft',
          },
        },
      },
    })
  }
}
