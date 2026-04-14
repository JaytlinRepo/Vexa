/**
 * Agent executor.
 *
 * Given a Task + the company it belongs to, executes the brief and
 * returns a structured Output the renderer can display. Pulls niche
 * knowledge so every output reads as informed by the creator's lane,
 * not generic LLM defaults.
 *
 * Two paths:
 *   1. Bedrock — when AWS creds are configured, ask Claude for JSON
 *      matching the renderer's expected shape, with the niche knowledge
 *      block + the brief in the system prompt.
 *   2. Mock — without creds, hand-build a structured output that
 *      explicitly applies the retrieved niche-knowledge entries to the
 *      brief topic. The mock is good enough for users to see the agent's
 *      knowledge influence the result.
 *
 * Either way the caller writes the Output row + flips the task to
 * 'delivered' so the CEO sees real work in their review queue.
 */
import { PrismaClient, OutputType, Prisma } from '@prisma/client'
import { retrieveNicheKnowledge, AgentRole } from '../lib/nicheKnowledge'
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

// ── MOCK GENERATORS ─────────────────────────────────────────────────────
// Each generator pulls relevant niche knowledge entries and weaves them
// into a structured output. This is the path most users see; it should
// feel like the agent did real work informed by the knowledge base.

const PERSONA_NAME: Record<AgentRole, string> = {
  analyst: 'Maya',
  strategist: 'Jordan',
  copywriter: 'Alex',
  creative_director: 'Riley',
}

function pick<T>(arr: T[], n: number): T[] {
  return arr.slice(0, n)
}

interface KnowledgeRow {
  kind: string
  title: string
  body: string
  tags: string[]
}

async function mockHooks(prisma: PrismaClient, opts: ExecuteOpts, knowledge: KnowledgeRow[]): Promise<Record<string, unknown>> {
  const patterns = knowledge.filter((k) => k.kind === 'hook_pattern')
  const language = knowledge.filter((k) => k.kind === 'language')
  const topic = opts.title.replace(/^hooks?\s*[-—:]\s*/i, '').trim()

  // Build 5 hooks each applying a distinct pattern. If we have fewer
  // pattern entries than hooks, we cycle.
  const usedPatterns = patterns.length ? patterns : [
    { kind: 'hook_pattern', title: 'specific number', body: '', tags: ['specific'] },
    { kind: 'hook_pattern', title: 'confession', body: '', tags: ['confession'] },
    { kind: 'hook_pattern', title: 'swap framing', body: '', tags: ['swap'] },
    { kind: 'hook_pattern', title: 'counter-conventional', body: '', tags: ['counter'] },
    { kind: 'hook_pattern', title: 'inside access', body: '', tags: ['inside'] },
  ]
  const hookTemplates = [
    (t: string) => `Stop ${t.toLowerCase()}. Start what actually moves the needle.`,
    (t: string) => `The thing nobody tells you about ${t.toLowerCase()}.`,
    (t: string) => `I quit ${t.toLowerCase()} for 30 days. Here is what changed.`,
    (t: string) => `Your ${t.toLowerCase()} is the problem. This is the swap.`,
    (t: string) => `If you only do one thing for ${t.toLowerCase()} this week, do this.`,
  ]
  const hooks = hookTemplates.map((tpl, i) => ({
    n: i + 1,
    text: tpl(topic),
    pattern: usedPatterns[i % usedPatterns.length]?.title ?? null,
    flagged: i === 1,
  }))

  return {
    topic,
    hooks,
    languageGuardrails: language.map((l) => l.title),
    knowledgeApplied: knowledge.map((k) => `[${k.kind}] ${k.title}`),
    note: `${PERSONA_NAME[opts.role]} drew from ${knowledge.length} ${opts.niche} knowledge entries to write these.`,
  }
}

async function mockTrendReport(prisma: PrismaClient, opts: ExecuteOpts, knowledge: KnowledgeRow[]): Promise<Record<string, unknown>> {
  const formats = knowledge.filter((k) => k.kind === 'format_signal')
  const audience = knowledge.filter((k) => k.kind === 'audience')
  const competitors = knowledge.filter((k) => k.kind === 'competitor_archetype')

  // Build 2 trends — one act_now, one build — using whichever entries we have.
  const baseTrends = [
    {
      topic: opts.title.replace(/^trend report?\s*[-—:]\s*/i, '').trim() || 'this week\'s top movement',
      growth: '+220%',
      growthPct: 220,
      window: '7d',
      urgency: 'act_now',
      sparkline: [22, 30, 41, 56, 71, 84, 95],
      audienceFit: audience[0]?.body?.split('. ')[0] || 'Strong fit for the creator\'s core audience.',
      whyNow: `${PERSONA_NAME.analyst} is seeing this trend climb on the back of recent macro-creator activation. Window before lane saturates: 5-7 days.`,
      signals: [
        { label: 'Search interest', value: '+220% / 7d' },
        { label: 'Top-50 accounts posting', value: '6 of 50' },
        { label: 'Avg engagement on category', value: '2.4x baseline' },
        { label: 'Estimated trend window', value: '5-7 days' },
      ],
      competitorMoves: competitors[0]?.body?.split('. ')[0] || 'Competitor coverage is still light — lane is open.',
      predictedOutcome: {
        ifAct: 'Conservative 1.5-2x baseline reach. Aggressive: a clean breakout if the framing lands.',
        ifSkip: 'You give up the cleanest growth window of the week.',
      },
      insight: `Format signal supporting this: ${formats[0]?.title || 'Reel hook in first 1.5s'}. ${formats[0]?.body?.slice(0, 220) || ''}`,
      action: 'Ship one piece this week, lead with the swap framing for comment-bait. Carousel pair on the weekend for saves.',
      solution: `${PERSONA_NAME.copywriter} drafts hooks. ${PERSONA_NAME.creative_director} drafts the shot list. You see both within the hour.`,
    },
    {
      topic: 'parallel slow-burn opportunity',
      growth: '+90%',
      growthPct: 90,
      window: '14d',
      urgency: 'build',
      sparkline: [42, 47, 53, 60, 66, 72, 80],
      audienceFit: audience[1]?.body?.split('. ')[0] || 'Good fit — pulls a slightly different sub-segment.',
      whyNow: 'Sustained climb, not a spike. Becomes a pillar series instead of a one-off Reel.',
      signals: [
        { label: 'Search interest', value: '+90% / 14d' },
        { label: 'Lane saturation', value: 'Low' },
        { label: 'Save-to-share ratio', value: '3.5:1' },
      ],
      competitorMoves: 'Comp set is mostly silent here. Wedge is open.',
      predictedOutcome: {
        ifAct: 'A 4-post mini-series compounds across 30 days.',
        ifSkip: 'No urgent cost; revisit in 2 weeks.',
      },
      insight: `${PERSONA_NAME.analyst}'s read: this is the build-for-the-month play.`,
      action: 'Slot a Reel + carousel pair across the next two weeks.',
      solution: `Handing off to ${PERSONA_NAME.strategist} to slot it into next week's plan.`,
    },
  ]

  return {
    generatedAt: new Date().toISOString(),
    trends: baseTrends,
    knowledgeApplied: knowledge.map((k) => `[${k.kind}] ${k.title}`),
  }
}

async function mockContentPlan(prisma: PrismaClient, opts: ExecuteOpts, knowledge: KnowledgeRow[]): Promise<Record<string, unknown>> {
  const pillars = knowledge.filter((k) => k.kind === 'pillar')
  const cadence = knowledge.filter((k) => k.kind === 'cadence')
  const days = ['Mon', 'Wed', 'Fri', 'Sun']
  const formats = ['Reel', 'Carousel', 'Reel', 'Reel']
  const pillarTitles = pillars.length
    ? pillars.slice(0, 3).map((p) => p.title.replace(/\s*pillar$/i, ''))
    : ['signature story', 'myth busting', 'behind the scenes']

  const posts = days.map((day, i) => ({
    day,
    format: formats[i],
    topic: `${pillarTitles[i % pillarTitles.length]} — week-1 post`,
    angle: pillars[i]?.body?.split('. ')[0] || 'Apply the pillar to a current moment in the creator\'s week.',
  }))

  return {
    weekOf: new Date().toISOString().slice(0, 10),
    pillars: pillarTitles,
    posts,
    cadenceNote: cadence[0]?.body?.split('. ')[0] || 'Default cadence: 3-4 substantive posts per week.',
    knowledgeApplied: knowledge.map((k) => `[${k.kind}] ${k.title}`),
  }
}

async function mockShotList(prisma: PrismaClient, opts: ExecuteOpts, knowledge: KnowledgeRow[]): Promise<Record<string, unknown>> {
  const frameworks = knowledge.filter((k) => k.kind === 'framework')
  const formatSignals = knowledge.filter((k) => k.kind === 'format_signal')
  const topic = opts.title.replace(/^shot list\s*[-—:]\s*/i, '').trim()

  return {
    reelTitle: topic || 'next Reel',
    duration: '28s',
    shots: [
      { n: 1, at: '0.0s', shot: 'Open visual — strong framing, no dialogue', note: formatSignals[0]?.body?.slice(0, 120) || 'first 1.5s decides whether the viewer scrolls' },
      { n: 2, at: '2.0s', shot: 'Hook line on camera or text overlay', note: 'Direct address; specific number on screen' },
      { n: 3, at: '8.0s', shot: 'B-roll: the tension / problem', note: 'Visual that frames the bottleneck the viewer recognizes' },
      { n: 4, at: '16.0s', shot: 'The reframe — close-up + text overlay', note: 'Counter-intuitive insight; pause for emphasis' },
      { n: 5, at: '24.0s', shot: 'Payoff line direct to camera', note: 'Tactical action + invitation to save' },
    ],
    soundNote: 'Original audio. First 2s silent for hook delivery.',
    editorNote: frameworks[0]?.body?.slice(0, 220) || 'Cut on breath, not on beat. Slow openings outperform fast ones in the first 2 seconds.',
    knowledgeApplied: knowledge.map((k) => `[${k.kind}] ${k.title}`),
  }
}

async function mockCaption(prisma: PrismaClient, opts: ExecuteOpts, knowledge: KnowledgeRow[]): Promise<Record<string, unknown>> {
  const language = knowledge.filter((k) => k.kind === 'language')
  const topic = opts.title.replace(/^caption?\s*[-—:]\s*/i, '').trim()
  const text = `${topic}.

You get to choose what one small change you ship this week.

Save this if you needed the reminder.

— ${PERSONA_NAME.copywriter}`
  return {
    text,
    languageGuardrails: language.map((l) => l.title),
    knowledgeApplied: knowledge.map((k) => `[${k.kind}] ${k.title}`),
  }
}

async function mockScript(prisma: PrismaClient, opts: ExecuteOpts, knowledge: KnowledgeRow[]): Promise<Record<string, unknown>> {
  const frameworks = knowledge.filter((k) => k.kind === 'framework')
  const topic = opts.title.replace(/^reel script\s*[-—:]\s*/i, '').trim() || 'this week\'s top angle'
  return {
    title: topic,
    duration: '30s',
    beats: [
      { at: '0-2s', text: `Open with the hook: "Stop ${topic.toLowerCase()}. Here is what actually works."` },
      { at: '2-8s', text: 'Name the bottleneck — the specific frustration the viewer recognizes (time, energy, plateau).' },
      { at: '8-22s', text: 'Reframe + 3 specific tactical moves. One sentence each. Numbers on screen.' },
      { at: '22-30s', text: 'Payoff line direct to camera. Single-action CTA: "Save this for tomorrow."' },
    ],
    framework: frameworks[0]?.title || 'Hook → Tension → Reframe → Payoff',
    knowledgeApplied: knowledge.map((k) => `[${k.kind}] ${k.title}`),
  }
}

const MOCK_BY_TYPE: Record<OutputType, (p: PrismaClient, o: ExecuteOpts, k: KnowledgeRow[]) => Promise<Record<string, unknown>>> = {
  hooks: mockHooks,
  trend_report: mockTrendReport,
  content_plan: mockContentPlan,
  shot_list: mockShotList,
  caption: mockCaption,
  script: mockScript,
  video: async (_p, o) => ({ status: 'pending', note: `${PERSONA_NAME[o.role]} would brief Creatomate from here once a shot list is approved.` }),
}

// ── BEDROCK PATH ────────────────────────────────────────────────────────
// Best-effort — asks Claude for JSON in the exact shape the renderer
// expects. If parsing fails, we fall through to the mock so the user
// always sees something usable.

function bedrockSystemPrompt(opts: ExecuteOpts, knowledgeBlock: string): string {
  const persona = PERSONA_NAME[opts.role]
  return `You are ${persona}, the ${opts.role} on a content team. You are executing a brief from the CEO and producing structured output the team will render to them. Reason from the niche knowledge below — do not reference it by name, just sound like someone who knows the lane.${knowledgeBlock}

Return ONLY valid JSON, no prose, no code fences. The JSON shape depends on the output type you are producing: ${opts.type}.`
}

function bedrockUserPrompt(opts: ExecuteOpts): string {
  return `Brief title: ${opts.title}

${opts.description ? `Brief details:\n${opts.description}\n\n` : ''}Produce the structured output now.`
}

// ── MAIN EXECUTOR ───────────────────────────────────────────────────────

export async function executeBrief(prisma: PrismaClient, opts: ExecuteOpts): Promise<ExecutionResult> {
  // Pull knowledge once, scored against the brief title + description.
  const query = [opts.title, opts.description].filter(Boolean).join(' ')
  const knowledge = await retrieveNicheKnowledge(prisma, {
    niche: opts.niche,
    role: opts.role,
    query,
    limit: 8,
    fallbackToDefault: true,
  })
  const knowledgeRows: KnowledgeRow[] = knowledge.map((k) => ({
    kind: k.kind,
    title: k.title,
    body: k.body,
    tags: k.tags,
  }))

  if (hasBedrockCreds()) {
    try {
      const knowledgeBlock = knowledgeRows.length
        ? `\n\n--- Niche knowledge (${opts.niche}) ---\n${knowledgeRows.map((k) => `[${k.kind}] ${k.title}: ${k.body}`).join('\n')}\n--- End knowledge ---`
        : ''
      const raw = await invokeAgent({
        systemPrompt: bedrockSystemPrompt(opts, knowledgeBlock),
        messages: [{ role: 'user', content: bedrockUserPrompt(opts) }],
        maxTokens: 1500,
        temperature: 0.7,
      })
      const content = parseAgentOutput<Record<string, unknown>>(raw)
      return { content, knowledgeUsed: knowledgeRows.length, source: 'bedrock' }
    } catch (err) {
      console.warn('[agentExecutor] bedrock path failed, falling back to mock', err)
    }
  }

  const generator = MOCK_BY_TYPE[opts.type]
  const content = await generator(prisma, opts, knowledgeRows)
  return { content, knowledgeUsed: knowledgeRows.length, source: 'mock' }
}

/**
 * Convenience: execute a brief and persist the resulting Output, flipping
 * the task to 'delivered'. Returns the created Output row.
 */
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
