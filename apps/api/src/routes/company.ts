import { Router } from 'express'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import { requireAuth, AuthedRequest } from '../middleware/auth'

import prisma from '../lib/prisma'
const router = Router()

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  niche: z.string().min(1).max(80).optional(),
  subNiche: z.string().max(200).optional().nullable(),
  fullName: z.string().max(120).optional(),
  email: z.string().email().optional(),
  brandVoice: z.record(z.any()).optional(),
  audience: z.record(z.any()).optional(),
  goals: z.record(z.any()).optional(),
  agentTools: z.record(z.any()).optional(),
})

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const company = await prisma.company.findFirst({
      where: { userId },
      include: { instagram: true, employees: true },
    })
    res.json({ company })
  } catch (err) {
    next(err)
  }
})

router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const data = patchSchema.parse(req.body)

    const company = await prisma.company.findFirst({ where: { id: req.params.id, userId } })
    if (!company) {
      res.status(404).json({ error: 'company_not_found' })
      return
    }

    const { fullName, email, ...companyFields } = data

    // User-level fields are updated on the User row.
    if (fullName != null || email != null) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          ...(fullName != null ? { fullName } : {}),
          ...(email != null ? { email } : {}),
        },
      })
    }

    const updated = await prisma.company.update({
      where: { id: company.id },
      data: {
        ...(companyFields.name != null ? { name: companyFields.name } : {}),
        ...(companyFields.niche != null ? { niche: companyFields.niche } : {}),
        ...(companyFields.subNiche !== undefined ? { subNiche: companyFields.subNiche ?? null } : {}),
        ...(companyFields.brandVoice != null ? { brandVoice: companyFields.brandVoice } : {}),
        ...(companyFields.audience != null ? { audience: companyFields.audience } : {}),
        ...(companyFields.goals != null ? { goals: companyFields.goals } : {}),
        ...(companyFields.agentTools != null ? { agentTools: companyFields.agentTools } : {}),
      },
      include: { instagram: true },
    })

    res.json({ company: updated })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'invalid_input', issues: err.issues })
      return
    }
    next(err)
  }
})

// ─── GOALS — Jordan sets incremental, realistic targets ───────────────────
// The CEO doesn't pick a goal from a blank slate — Jordan (the strategist)
// proposes a single achievable next milestone grounded in the account's
// actual numbers. Goals can be on any of the platform metrics, not just
// follower count, and each one is sized to be a stretch-but-real win over
// 30-60 days. When a goal is met, expired, or explicitly cleared, Jordan
// picks the next one.
//
// Stored on company.goals.active:
//   { type, target, byDate, startedAt, baseline, rationale, metricLabel }

type MetricType = 'followers' | 'engagement' | 'avg_reach' | 'avg_impressions'

const METRIC_LABELS: Record<MetricType, string> = {
  followers: 'Followers',
  engagement: 'Engagement rate',
  avg_reach: 'Avg. reach per post',
  avg_impressions: 'Avg. impressions per post',
}

interface ActiveGoal {
  type: MetricType
  target: number
  byDate: string
  startedAt: string
  baseline: number
  rationale: string
  metricLabel: string
  source?: 'jordan' | 'manual'
}

async function currentMetric(
  prisma: PrismaClient,
  companyId: string,
  type: MetricType,
): Promise<number | null> {
  const account = await prisma.platformAccount.findFirst({
    where: { companyId },
    orderBy: { lastSyncedAt: 'desc' },
  })
  if (!account) {
    const ig = await prisma.instagramConnection.findUnique({ where: { companyId } })
    if (!ig) return null
    if (type === 'followers') return ig.followerCount
    if (type === 'engagement') return ig.engagementRate
    if (type === 'avg_reach') return ig.avgReach
    return ig.avgImpressions
  }
  const snap = await prisma.platformSnapshot.findFirst({
    where: { accountId: account.id },
    orderBy: { capturedAt: 'desc' },
  })
  if (!snap) return null
  if (type === 'followers') return snap.followerCount
  if (type === 'engagement') return snap.engagementRate
  if (type === 'avg_reach') return snap.avgReach
  return snap.avgImpressions
}

function computePacing(goal: ActiveGoal, now: Date, current: number) {
  const start = new Date(goal.startedAt).getTime()
  const end = new Date(goal.byDate + 'T23:59:59Z').getTime()
  const total = Math.max(1, end - start)
  const elapsed = Math.max(0, now.getTime() - start)
  const timePct = Math.min(1, elapsed / total)
  const delta = current - goal.baseline
  const need = goal.target - goal.baseline
  const progressPct = need === 0 ? 1 : Math.max(0, Math.min(1.2, delta / need))
  const projected = elapsed > 0 ? goal.baseline + (delta / elapsed) * total : goal.baseline
  const onTrack = progressPct >= timePct - 0.05
  const daysLeft = Math.max(0, Math.ceil((end - now.getTime()) / 86400000))
  return {
    current,
    progressPct,
    timePct,
    projected: Math.round(progressPct >= 1 ? goal.target : projected),
    onTrack,
    daysLeft,
    delta,
    need,
  }
}

function addDays(from: Date, days: number): string {
  const d = new Date(from.getTime() + days * 86400000)
  return d.toISOString().slice(0, 10)
}

interface GoalCandidate {
  type: MetricType
  target: number
  baseline: number
  byDate: string
  metricLabel: string
  rationale: string
  priority: number
}

/**
 * Jordan's goal generator.
 *
 * Reads the current snapshot + recent trend, then proposes ONE incremental
 * goal sized small enough to feel achievable but real enough to matter.
 *
 * Rules of thumb:
 *  - Follower lifts: +3–15% depending on account size (smaller accounts
 *    can post larger % gains; 100K+ accounts get 3–5% targets).
 *  - Engagement: +0.2–0.4 pp over 30 days. Meaningful without fantasy.
 *  - Reach / impressions: +15% over 30 days. These are the fastest-moving
 *    signals so they reward quick iteration.
 *  - Prefer the metric with the most headroom and highest priority given
 *    account state (e.g. stalled growth → engagement lever instead of
 *    follower target).
 *  - avoidType: when Jordan is picking a replacement after the CEO asked
 *    for "another one," skip the same metric so we get variety.
 */
async function generateJordanGoal(
  prisma: PrismaClient,
  companyId: string,
  avoidType?: MetricType,
): Promise<{ goal: ActiveGoal; rationale: string; metricLabel: string } | null> {
  const account = await prisma.platformAccount.findFirst({
    where: { companyId },
    orderBy: { lastSyncedAt: 'desc' },
  })
  const snap = account
    ? await prisma.platformSnapshot.findFirst({
        where: { accountId: account.id },
        orderBy: { capturedAt: 'desc' },
      })
    : null
  const ig = snap ? null : await prisma.instagramConnection.findUnique({ where: { companyId } })
  if (!snap && !ig) return null

  const followers = snap?.followerCount ?? ig?.followerCount ?? 0
  const engagement = snap?.engagementRate ?? ig?.engagementRate ?? 0
  const avgReach = snap?.avgReach ?? ig?.avgReach ?? 0
  const avgImpressions = snap?.avgImpressions ?? ig?.avgImpressions ?? 0

  // Detect stalled growth — if it is, Jordan biases toward engagement /
  // reach goals (faster levers) rather than another follower target.
  let growthStalled = false
  if (account) {
    const recent = await prisma.platformSnapshot.findMany({
      where: { accountId: account.id },
      orderBy: { capturedAt: 'desc' },
      take: 7,
    })
    if (recent.length >= 3) {
      const first = recent[recent.length - 1]!
      const last = recent[0]!
      const growthPct = first.followerCount > 0
        ? (last.followerCount - first.followerCount) / first.followerCount
        : 0
      growthStalled = growthPct < 0.005
    }
  }

  const now = new Date()
  const candidates: GoalCandidate[] = []

  // ── FOLLOWER LIFT ────────────────────────────────────────────────
  if (followers > 0 && avoidType !== 'followers') {
    let incPct: number, days: number, roundTo: number
    if (followers < 1000) { incPct = 0.15; days = 45; roundTo = 10 }
    else if (followers < 10_000) { incPct = 0.08; days = 60; roundTo = 50 }
    else if (followers < 100_000) { incPct = 0.05; days = 60; roundTo = 100 }
    else { incPct = 0.03; days = 60; roundTo = 500 }
    const target = Math.max(followers + roundTo, Math.round((followers * (1 + incPct)) / roundTo) * roundTo)
    const liftPct = Math.round(((target - followers) / followers) * 100)
    candidates.push({
      type: 'followers',
      target,
      baseline: followers,
      byDate: addDays(now, days),
      metricLabel: METRIC_LABELS.followers,
      rationale: `${followers.toLocaleString()} → ${target.toLocaleString()} in ${days} days. That's +${liftPct}% at your size — tight enough to feel like real progress, not a fantasy target.`,
      priority: growthStalled ? 3 : 8,
    })
  }

  // ── ENGAGEMENT LIFT ──────────────────────────────────────────────
  if (engagement > 0 && avoidType !== 'engagement') {
    // 0.3 pt lift is meaningful but realistic across most IG accounts.
    // We cap the target to a ceiling that matches bucket — nobody pushes
    // engagement past ~8% sustainably.
    const pt = engagement < 1 ? 0.4 : engagement < 3 ? 0.3 : 0.2
    const target = Math.min(10, Math.round((engagement + pt) * 100) / 100)
    candidates.push({
      type: 'engagement',
      target,
      baseline: engagement,
      byDate: addDays(now, 30),
      metricLabel: METRIC_LABELS.engagement,
      rationale: `Your engagement is ${engagement.toFixed(2)}%. Lifting to ${target.toFixed(2)}% in 30 days is realistic — Alex tightens hooks, I cut the weakest two slots from your pillar mix.`,
      priority: growthStalled ? 10 : engagement < 2 ? 9 : 6,
    })
  }

  // ── REACH LIFT ───────────────────────────────────────────────────
  if (avgReach > 0 && avoidType !== 'avg_reach') {
    const target = Math.round((avgReach * 1.15) / 10) * 10
    candidates.push({
      type: 'avg_reach',
      target,
      baseline: avgReach,
      byDate: addDays(now, 30),
      metricLabel: METRIC_LABELS.avg_reach,
      rationale: `Avg. reach is ${avgReach.toLocaleString()}. +15% to ${target.toLocaleString()} over 30 days usually comes from posting on stronger pillars and riding one of Maya's weekly trends instead of safe repeats.`,
      priority: 5,
    })
  }

  // ── IMPRESSIONS LIFT ─────────────────────────────────────────────
  if (avgImpressions > 0 && avoidType !== 'avg_impressions') {
    const target = Math.round((avgImpressions * 1.15) / 10) * 10
    candidates.push({
      type: 'avg_impressions',
      target,
      baseline: avgImpressions,
      byDate: addDays(now, 30),
      metricLabel: METRIC_LABELS.avg_impressions,
      rationale: `Impressions sit at ${avgImpressions.toLocaleString()} per post. +15% in 30 days typically comes from Riley tightening the first 3 seconds so the feed stops scrolling.`,
      priority: 4,
    })
  }

  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.priority - a.priority)
  const pick = candidates[0]!

  return {
    goal: {
      type: pick.type,
      target: pick.target,
      byDate: pick.byDate,
      startedAt: now.toISOString(),
      baseline: pick.baseline,
      rationale: pick.rationale,
      metricLabel: pick.metricLabel,
      source: 'jordan',
    },
    rationale: pick.rationale,
    metricLabel: pick.metricLabel,
  }
}

router.get('/goal', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const company = await prisma.company.findFirst({ where: { userId } })
    if (!company) {
      res.json({ goal: null, pacing: null })
      return
    }
    const goals = (company.goals as { active?: ActiveGoal } | null) || {}
    const goal = goals.active
    if (!goal) {
      res.json({ goal: null, pacing: null, hasBaseline: (await currentMetric(prisma, company.id, 'followers')) != null })
      return
    }
    const current = await currentMetric(prisma, company.id, goal.type)
    const pacing = current != null ? computePacing(goal, new Date(), current) : null
    res.json({ goal, pacing })
  } catch (err) {
    next(err)
  }
})

/**
 * Jordan picks a goal and writes it as the active target. Returns the new
 * goal + its initial pacing. Pass `?different=1` (or `?avoid=<metric>`)
 * when the CEO says "give me another" so Jordan picks a different lever
 * than the one currently active.
 */
router.post('/goal/generate', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const company = await prisma.company.findFirst({ where: { userId } })
    if (!company) {
      res.status(404).json({ error: 'company_not_found' })
      return
    }
    const existing = (company.goals as { active?: ActiveGoal } | null) || {}
    const different = req.query.different === '1'
    const avoidType = different && existing.active ? existing.active.type : undefined

    const result = await generateJordanGoal(prisma, company.id, avoidType)
    if (!result) {
      res.status(400).json({ error: 'no_baseline', message: 'Connect your account so Jordan has real numbers to build against.' })
      return
    }
    const updated = await prisma.company.update({
      where: { id: company.id },
      data: { goals: { ...existing, active: result.goal } as unknown as object },
    })
    const pacing = computePacing(result.goal, new Date(), result.goal.baseline)
    res.status(201).json({ goal: result.goal, pacing, company: updated })
  } catch (err) {
    next(err)
  }
})

// ─── MONTHLY SCORECARD ──────────────────────────────────────────────────────
// Aggregates three signals that let the CEO see if their team is earning
// their subscription this month: work shipped, approval rate on that work,
// and whether the underlying metric is lifting (30-day engagement delta).
router.get('/scorecard', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const company = await prisma.company.findFirst({ where: { userId } })
    if (!company) {
      res.json({ scorecard: null })
      return
    }
    const now = new Date()
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

    const [monthTasks, monthOutputs] = await Promise.all([
      prisma.task.findMany({
        where: { companyId: company.id, createdAt: { gte: monthStart } },
        select: { status: true },
      }),
      prisma.output.count({ where: { companyId: company.id, createdAt: { gte: monthStart } } }),
    ])

    const delivered = monthTasks.filter((t) => t.status === 'delivered' || t.status === 'approved' || t.status === 'rejected')
    const approved = monthTasks.filter((t) => t.status === 'approved').length
    const reviewed = monthTasks.filter((t) => t.status === 'approved' || t.status === 'rejected').length
    const approvalRate = reviewed === 0 ? null : approved / reviewed

    // Engagement lift — compare latest snapshot to one ~30 days ago.
    let engagementLift: { now: number; then: number; deltaPct: number } | null = null
    const account = await prisma.platformAccount.findFirst({
      where: { companyId: company.id },
      orderBy: { lastSyncedAt: 'desc' },
    })
    if (account) {
      const latest = await prisma.platformSnapshot.findFirst({
        where: { accountId: account.id },
        orderBy: { capturedAt: 'desc' },
      })
      const cutoff = new Date(Date.now() - 30 * 86400000)
      const baseline = await prisma.platformSnapshot.findFirst({
        where: { accountId: account.id, capturedAt: { lte: cutoff } },
        orderBy: { capturedAt: 'desc' },
      })
      if (latest && baseline && baseline.engagementRate > 0) {
        const delta = (latest.engagementRate - baseline.engagementRate) / baseline.engagementRate
        engagementLift = {
          now: latest.engagementRate,
          then: baseline.engagementRate,
          deltaPct: delta,
        }
      }
    }

    res.json({
      scorecard: {
        monthLabel: now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
        outputsShipped: monthOutputs,
        tasksDelivered: delivered.length,
        tasksApproved: approved,
        approvalRate,
        engagementLift,
      },
    })
  } catch (err) {
    next(err)
  }
})

router.delete('/goal', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const company = await prisma.company.findFirst({ where: { userId } })
    if (!company) {
      res.status(404).json({ error: 'company_not_found' })
      return
    }
    const existing = (company.goals as Record<string, unknown> | null) || {}
    delete (existing as { active?: unknown }).active
    await prisma.company.update({
      where: { id: company.id },
      data: { goals: existing as unknown as object },
    })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// ── Schedule Preferences ─────────────────────────────────────────────────────

import { SCHEDULE_DEFAULTS, formatSchedule, type ScheduleEntry } from '../lib/schedulePrefs'

// GET /api/company/schedules — get all schedule preferences for the user's company
router.get('/schedules', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const company = await prisma.company.findFirst({
      where: { userId },
      select: { agentTools: true },
    })
    if (!company) { res.status(404).json({ error: 'no_company' }); return }

    const tools = (company.agentTools || {}) as Record<string, unknown>
    const userPrefs = (tools.schedules || {}) as Record<string, ScheduleEntry>

    // Merge defaults with user overrides
    const schedules = Object.entries(SCHEDULE_DEFAULTS).map(([key, def]) => {
      const entry = userPrefs[key] || def
      return {
        key,
        label: def.label,
        agent: def.agent,
        description: def.description,
        day: entry.day,
        dayOfMonth: entry.dayOfMonth,
        hour: entry.hour,
        formatted: formatSchedule(entry),
        isCustom: !!userPrefs[key],
      }
    })

    res.json({ schedules })
  } catch (err) { next(err) }
})

// PATCH /api/company/schedules — update a schedule preference
const scheduleUpdateSchema = z.object({
  key: z.string(),
  day: z.number().min(0).max(6).optional(),
  dayOfMonth: z.number().min(1).max(28).optional(),
  hour: z.number().min(0).max(23),
})

router.patch('/schedules', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const data = scheduleUpdateSchema.parse(req.body)

    if (!SCHEDULE_DEFAULTS[data.key]) {
      res.status(400).json({ error: 'invalid_schedule_key' })
      return
    }

    const company = await prisma.company.findFirst({
      where: { userId },
      select: { id: true, agentTools: true },
    })
    if (!company) { res.status(404).json({ error: 'no_company' }); return }

    const tools = (company.agentTools || {}) as Record<string, unknown>
    const schedules = (tools.schedules || {}) as Record<string, ScheduleEntry>

    // Set the new preference
    const entry: ScheduleEntry = { hour: data.hour }
    if (data.dayOfMonth !== undefined) entry.dayOfMonth = data.dayOfMonth
    else if (data.day !== undefined) entry.day = data.day

    schedules[data.key] = entry

    await prisma.company.update({
      where: { id: company.id },
      data: { agentTools: { ...tools, schedules } as never },
    })

    res.json({ ok: true, schedule: { ...entry, formatted: formatSchedule(entry) } })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: 'invalid_input', issues: err.issues }); return }
    next(err)
  }
})

// DELETE /api/company/schedules/:key — reset a schedule to default
router.delete('/schedules/:key', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const key = req.params.key

    const company = await prisma.company.findFirst({
      where: { userId },
      select: { id: true, agentTools: true },
    })
    if (!company) { res.status(404).json({ error: 'no_company' }); return }

    const tools = (company.agentTools || {}) as Record<string, unknown>
    const schedules = (tools.schedules || {}) as Record<string, ScheduleEntry>
    delete schedules[key]

    await prisma.company.update({
      where: { id: company.id },
      data: { agentTools: { ...tools, schedules } as never },
    })

    const def = SCHEDULE_DEFAULTS[key]
    res.json({ ok: true, schedule: def ? { ...def, formatted: formatSchedule(def) } : null })
  } catch (err) { next(err) }
})

// ── Community feed opt-in ────────────────────────────────────────────────────
router.patch('/me/community-opt-in', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const { optIn } = req.body as { optIn: boolean }

    const company = await prisma.company.findFirst({ where: { userId } })
    if (!company) { res.status(404).json({ error: 'company_not_found' }); return }

    await prisma.company.update({
      where: { id: company.id },
      data: {
        communityOptIn: !!optIn,
        communityOptInAt: optIn ? new Date() : null,
      },
    })

    res.json({ ok: true, communityOptIn: !!optIn })
  } catch (err) {
    next(err)
  }
})

export default router
