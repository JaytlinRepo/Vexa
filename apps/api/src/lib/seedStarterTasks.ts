import { PrismaClient, TaskStatus, OutputType, Prisma } from '@prisma/client'

interface SeedInput {
  companyId: string
  niche: string
}

interface NichePack {
  pillars: [string, string, string]
  posts: [
    { format: string; topic: string; angle: string },
    { format: string; topic: string; angle: string },
    { format: string; topic: string; angle: string },
  ]
  trends: [
    { topic: string; growth: string; window: string; verdict: string },
    { topic: string; growth: string; window: string; verdict: string },
    { topic: string; growth: string; window: string; verdict: string },
  ]
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
        { topic: 'weighted walking', growth: '+340%', window: '48h', verdict: 'act now — top accounts already moving' },
        { topic: 'protein-first breakfast', growth: '+180%', window: '7d', verdict: 'slower burn — ride this through the month' },
        { topic: 'mini-band booty prep', growth: '+90%', window: '7d', verdict: 'skip — oversaturated in your sub-niche' },
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
        { topic: 'HYSA rate drops', growth: '+210%', window: '72h', verdict: 'act now — rate-chase content wins this week' },
        { topic: 'house-hacking ADUs', growth: '+150%', window: '14d', verdict: 'slower burn — build a pillar post' },
        { topic: 'roth ladder for FI', growth: '+85%', window: '7d', verdict: 'skip — too niche for your sub-audience' },
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
        { topic: 'cottage cheese dessert', growth: '+410%', window: '72h', verdict: 'act now — trend is peaking this week' },
        { topic: 'no-flour bread', growth: '+140%', window: '14d', verdict: 'slower burn — build a series' },
        { topic: 'keto ice cream', growth: '+60%', window: '7d', verdict: 'skip — saturated' },
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
        { topic: 'micro-habits over goals', growth: '+190%', window: '7d', verdict: 'act now — ride this for two posts' },
        { topic: 'burnout recovery frameworks', growth: '+110%', window: '14d', verdict: 'build a pillar post' },
        { topic: 'productivity stack videos', growth: '+40%', window: '7d', verdict: 'skip — saturated' },
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
    { topic: 'first trend to monitor', growth: '+0%', window: 'pending sync', verdict: 'analyst will pull fresh numbers after your first daily sync' },
    { topic: 'second trend to monitor', growth: '+0%', window: 'pending sync', verdict: 'placeholder until Maya has your niche data' },
    { topic: 'third trend to monitor', growth: '+0%', window: 'pending sync', verdict: 'placeholder until Maya has your niche data' },
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
        trends: pack.trends,
      },
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
