import { PrismaClient, EmployeeRole } from '@prisma/client'
import { orchestrateTask } from '../agents/task-orchestrator'
import { createNotification } from '../services/notifications/notification.service'
import { PLAN_LIMITS } from './plans'

const DEDUP_WINDOW_MS = 6 * 24 * 60 * 60 * 1000 // 6 days

/**
 * First connect — fires a batch of initial analyses so the user
 * opens their dashboard to real work, not an empty inbox.
 * Triggers: Maya performance review + trend report, Jordan weekly plan.
 */
export async function triggerFirstConnectBatch(
  prisma: PrismaClient,
  companyId: string,
): Promise<void> {
  // Maya: Performance review (what's working)
  await triggerProactiveMayaAnalysis(prisma, companyId).catch(() => {})

  // Maya: Trend report (what's trending in your niche)
  await triggerAgentTask(prisma, companyId, 'analyst' as EmployeeRole, {
    type: 'trend_analysis',
    title: 'Trend report — your niche right now',
    description: 'What\'s trending in your niche this week. Opportunities ranked by urgency and audience fit.',
    notifTitle: 'Maya spotted trends in your niche',
    notifBody: 'Your first trend report is ready — see what\'s moving.',
    dedupDays: 3,
  }).catch(() => {})

  // Jordan: First content plan
  await triggerWeeklyPlan(prisma, companyId).catch(() => {})
}

/**
 * Full performance review — triggered once on first TikTok connect.
 * Deep dive: what's working, what's not, recent activity, trajectory.
 */
export async function triggerProactiveMayaAnalysis(
  prisma: PrismaClient,
  companyId: string,
): Promise<{ triggered: boolean; reason?: string; taskId?: string }> {
  return triggerMayaTask(prisma, companyId, {
    type: 'performance_review',
    title: 'TikTok performance analysis',
    description: 'Proactive analysis of your TikTok content — what\'s working, what\'s not, and what to do next.',
    notifTitle: 'Maya analyzed your TikTok',
    notifBody: 'Performance review is ready — what\'s working, what\'s not, and what to do next.',
  })
}

/**
 * Weekly pulse — triggered every Monday. Quick snapshot: win, miss,
 * trajectory, one thing to do. Not a full report.
 */
export async function triggerWeeklyPulse(
  prisma: PrismaClient,
  companyId: string,
): Promise<{ triggered: boolean; reason?: string; taskId?: string }> {
  return triggerMayaTask(prisma, companyId, {
    type: 'weekly_pulse',
    title: 'Weekly TikTok pulse',
    description: 'Monday morning check-in — win of the week, miss of the week, and one thing to do.',
    notifTitle: 'Maya\'s Monday pulse is in',
    notifBody: 'Quick snapshot of your TikTok this week — win, miss, and what to focus on.',
  })
}

async function triggerMayaTask(
  prisma: PrismaClient,
  companyId: string,
  opts: { type: string; title: string; description: string; notifTitle: string; notifBody: string },
): Promise<{ triggered: boolean; reason?: string; taskId?: string }> {
  const since = new Date(Date.now() - DEDUP_WINDOW_MS)
  const existing = await prisma.task.findFirst({
    where: { companyId, type: opts.type, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
  })
  if (existing) {
    return { triggered: false, reason: 'recent_analysis_exists' }
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: {
      employees: { where: { role: 'analyst', isActive: true } },
      user: { select: { plan: true } },
    },
  })
  if (!company) return { triggered: false, reason: 'company_not_found' }

  // Check plan allows this feature
  const plan = PLAN_LIMITS[company.user.plan]
  const isPerformanceReview = opts.type === 'performance_review'
  const isPulse = opts.type === 'weekly_pulse'
  if (isPerformanceReview && !plan.proactiveAnalysis) return { triggered: false, reason: 'plan_locked' }
  if (isPulse && !plan.weeklyPulse) return { triggered: false, reason: 'plan_locked' }

  const analyst = company.employees[0]
  if (!analyst) return { triggered: false, reason: 'no_active_analyst' }

  const task = await prisma.task.create({
    data: {
      companyId,
      employeeId: analyst.id,
      title: opts.title,
      description: opts.description,
      type: opts.type,
      status: 'in_progress',
    },
  })

  try {
    await orchestrateTask(task.id)

    try {
      await createNotification({
        userId: company.userId,
        companyId,
        type: 'team_update',
        emoji: '📊',
        title: opts.notifTitle,
        body: opts.notifBody,
        actionLabel: 'Review',
        metadata: { taskId: task.id },
      })
    } catch (e) {
      console.warn('[proactive] notification failed', e)
    }

    return { triggered: true, taskId: task.id }
  } catch (err) {
    await prisma.task.update({
      where: { id: task.id },
      data: { status: 'pending' },
    })
    console.error(`[proactive] ${opts.type} failed, task reset to pending`, err)
    return { triggered: false, reason: 'execution_failed', taskId: task.id }
  }
}

/**
 * Weekly cron handler — fires a weekly_pulse for every company with
 * a connected TikTok. Processes sequentially to avoid Bedrock rate limits.
 */
export async function triggerWeeklyPulses(
  prisma: PrismaClient,
): Promise<{ total: number; triggered: number; skipped: number; errors: number }> {
  const companies = await prisma.company.findMany({
    where: { tiktok: { isNot: null } },
    select: { id: true },
  })

  let triggered = 0
  let skipped = 0
  let errors = 0

  for (const company of companies) {
    try {
      const result = await triggerWeeklyPulse(prisma, company.id)
      if (result.triggered) triggered++
      else skipped++
    } catch {
      errors++
    }
  }

  return { total: companies.length, triggered, skipped, errors }
}

/**
 * Jordan's weekly content plan — triggered Sunday evening.
 * Builds on Maya's latest trends to create next week's posting schedule.
 */
export async function triggerWeeklyPlan(
  prisma: PrismaClient,
  companyId: string,
): Promise<{ triggered: boolean; reason?: string; taskId?: string }> {
  return triggerAgentTask(prisma, companyId, 'strategist', {
    type: 'content_plan',
    title: 'Next week — posting schedule',
    description: 'Weekly posting schedule based on current trends, audience data, and what performed best recently.',
    notifTitle: 'Jordan\'s posting schedule is ready',
    notifBody: 'Next week\'s posting schedule is waiting for your review.',
    dedupDays: 6,
  })
}

/**
 * Alex's proactive hooks — triggered mid-week if no hooks exist.
 * Writes hooks for the most relevant upcoming content.
 */
export async function triggerProactiveHooks(
  prisma: PrismaClient,
  companyId: string,
): Promise<{ triggered: boolean; reason?: string; taskId?: string }> {
  return triggerAgentTask(prisma, companyId, 'copywriter', {
    type: 'hooks',
    title: 'Captions — this week\'s top angle',
    description: 'Scroll-stopping captions for the strongest content opportunity this week.',
    notifTitle: 'Alex delivered captions',
    notifBody: 'Fresh captions are ready — pick one and film.',
    dedupDays: 5,
  })
}

/**
 * Generic agent task trigger — works for any role.
 */
async function triggerAgentTask(
  prisma: PrismaClient,
  companyId: string,
  role: EmployeeRole,
  opts: { type: string; title: string; description: string; notifTitle: string; notifBody: string; dedupDays: number },
): Promise<{ triggered: boolean; reason?: string; taskId?: string }> {
  const since = new Date(Date.now() - opts.dedupDays * 24 * 60 * 60 * 1000)
  const existing = await prisma.task.findFirst({
    where: { companyId, type: opts.type, createdAt: { gte: since } },
  })
  if (existing) return { triggered: false, reason: 'recent_exists' }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: {
      employees: { where: { role, isActive: true } },
      user: { select: { plan: true } },
    },
  })
  if (!company) return { triggered: false, reason: 'company_not_found' }

  const employee = company.employees[0]
  if (!employee) return { triggered: false, reason: 'no_active_employee' }

  const task = await prisma.task.create({
    data: {
      companyId,
      employeeId: employee.id,
      title: opts.title,
      description: opts.description,
      type: opts.type,
      status: 'in_progress',
    },
  })

  try {
    await orchestrateTask(task.id)
    try {
      await createNotification({
        userId: company.userId,
        companyId,
        type: 'team_update',
        emoji: '📋',
        title: opts.notifTitle,
        body: opts.notifBody,
        actionLabel: 'Review',
        metadata: { taskId: task.id },
      })
    } catch {}
    return { triggered: true, taskId: task.id }
  } catch (err) {
    await prisma.task.update({ where: { id: task.id }, data: { status: 'pending' } })
    console.error(`[proactive] ${opts.type} failed`, err)
    return { triggered: false, reason: 'execution_failed', taskId: task.id }
  }
}

// ─── JORDAN PROACTIVE DELIVERABLES ───────────────────────────────────────────

/**
 * Jordan's content audit — bi-weekly. Analyzes posting patterns,
 * format mix, content pillars, and what's working vs not.
 */
export async function triggerContentAudit(
  prisma: PrismaClient,
  companyId: string,
): Promise<{ triggered: boolean; reason?: string; taskId?: string }> {
  return triggerAgentTask(prisma, companyId, 'strategist', {
    type: 'content_audit',
    title: 'Content audit — what\'s working',
    description: 'Analyze my recent posting history. What formats, topics, and patterns are driving engagement? Where are the gaps?',
    notifTitle: 'Jordan delivered a content audit',
    notifBody: 'Your posting history analyzed — what\'s working, what\'s not, and where to adjust.',
    dedupDays: 12,
  })
}

/**
 * Jordan's growth strategy — monthly. Prioritized action plan
 * for growing the account based on current data.
 */
export async function triggerGrowthStrategy(
  prisma: PrismaClient,
  companyId: string,
): Promise<{ triggered: boolean; reason?: string; taskId?: string }> {
  return triggerAgentTask(prisma, companyId, 'strategist', {
    type: 'growth_strategy',
    title: 'Growth strategy — next moves',
    description: 'Build a prioritized growth plan. What should I focus on to grow my account based on current performance?',
    notifTitle: 'Jordan built your growth strategy',
    notifBody: 'Prioritized action plan for growing your account — based on your real data.',
    dedupDays: 25,
  })
}

/**
 * Jordan's mid-week plan adjustment — Wednesday. Compares current plan
 * vs actual performance and suggests swaps for remaining days.
 */
export async function triggerPlanAdjustment(
  prisma: PrismaClient,
  companyId: string,
): Promise<{ triggered: boolean; reason?: string; taskId?: string }> {
  return triggerAgentTask(prisma, companyId, 'strategist', {
    type: 'plan_adjustment',
    title: 'Mid-week plan check',
    description: 'Compare this week\'s plan vs actual performance. What should we adjust for the rest of the week?',
    notifTitle: 'Jordan adjusted the plan',
    notifBody: 'Mid-week performance check — some posts swapped based on what\'s working.',
    dedupDays: 6,
  })
}

/**
 * Alex's trend hooks — triggered when Maya delivers a trend report.
 * Writes hooks specifically for the top trending topic.
 */
export async function triggerTrendHooks(
  prisma: PrismaClient,
  companyId: string,
  trendTopic: string,
  trendContext: string,
): Promise<{ triggered: boolean; reason?: string; taskId?: string }> {
  return triggerAgentTask(prisma, companyId, 'copywriter', {
    type: 'trend_hooks',
    title: 'Hooks for: ' + trendTopic.slice(0, 60),
    description: JSON.stringify({ trendTopic, trendContext }),
    notifTitle: 'Alex wrote hooks for a trend',
    notifBody: 'Maya spotted "' + trendTopic.slice(0, 40) + '" — Alex wrote 5 hooks for it.',
    dedupDays: 3,
  })
}

// ─── RILEY PROACTIVE DELIVERABLES ────────────────────────────────────────────

/**
 * Riley's feed audit — bi-weekly. Evaluates visual consistency,
 * aesthetic cohesion, color palette, and brand alignment.
 */
export async function triggerFeedAudit(
  prisma: PrismaClient,
  companyId: string,
): Promise<{ triggered: boolean; reason?: string; taskId?: string }> {
  return triggerAgentTask(prisma, companyId, 'creative_director', {
    type: 'feed_audit',
    title: 'Feed audit — visual brand check',
    description: 'How does my feed look as a whole? Is my visual identity cohesive? What\'s on-brand and what\'s off?',
    notifTitle: 'Riley audited your feed',
    notifBody: 'Visual brand check — how cohesive your feed looks and what to adjust.',
    dedupDays: 12,
  })
}

/**
 * Riley's format analysis — bi-weekly. Which content formats
 * (reels, carousels, statics) perform best and what to change.
 */
export async function triggerFormatAnalysis(
  prisma: PrismaClient,
  companyId: string,
): Promise<{ triggered: boolean; reason?: string; taskId?: string }> {
  return triggerAgentTask(prisma, companyId, 'creative_director', {
    type: 'format_analysis',
    title: 'Format analysis — what\'s performing',
    description: 'Which content formats are working best? Reels vs carousels vs statics — where should I lean in?',
    notifTitle: 'Riley analyzed your formats',
    notifBody: 'Format performance breakdown — which types of content drive the most engagement.',
    dedupDays: 12,
  })
}

/**
 * Riley's competitor analysis — monthly. Studies what similar creators
 * in the niche are doing, identifies patterns and gaps.
 */
export async function triggerCompetitorAnalysis(
  prisma: PrismaClient,
  companyId: string,
): Promise<{ triggered: boolean; reason?: string; taskId?: string }> {
  return triggerAgentTask(prisma, companyId, 'creative_director', {
    type: 'competitor_analysis',
    title: 'Competitor landscape — patterns & gaps',
    description: 'What are similar creators doing? What patterns dominate, what gaps can I fill?',
    notifTitle: 'Riley analyzed the competition',
    notifBody: 'Competitor patterns, gaps you can fill, and threats to watch.',
    dedupDays: 25,
  })
}

/**
 * Keep-alive cycle — runs daily. If the CEO hasn't interacted (no approvals
 * or rejections) in 3+ days, agents proactively generate fresh work so the
 * inbox never looks empty.
 */
export async function triggerKeepAlive(
  prisma: PrismaClient,
): Promise<{ total: number; triggered: number }> {
  const companies = await prisma.company.findMany({
    where: {
      OR: [
        { tiktok: { isNot: null } },
        { instagram: { isNot: null } },
      ],
    },
    select: { id: true },
  })

  let triggered = 0
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)

  for (const { id: companyId } of companies) {
    // Check if CEO interacted recently
    const recentAction = await prisma.task.findFirst({
      where: {
        companyId,
        status: { in: ['approved', 'rejected'] },
        completedAt: { gte: threeDaysAgo },
      },
    })
    if (recentAction) continue // CEO is active, skip

    // Check if there's already unreviewed work
    const unreviewed = await prisma.task.count({
      where: { companyId, status: 'delivered' },
    })
    if (unreviewed >= 3) continue // Already enough in the inbox

    // Generate work based on what's missing
    const recentTypes = await prisma.task.findMany({
      where: { companyId, createdAt: { gte: threeDaysAgo } },
      select: { type: true },
    })
    const types = recentTypes.map(t => t.type)

    try {
      if (!types.includes('trend_report') && !types.includes('weekly_pulse')) {
        await triggerWeeklyPulse(prisma, companyId)
        triggered++
      } else if (!types.includes('content_plan')) {
        await triggerWeeklyPlan(prisma, companyId)
        triggered++
      } else if (!types.includes('content_audit')) {
        await triggerContentAudit(prisma, companyId)
        triggered++
      } else if (!types.includes('growth_strategy')) {
        await triggerGrowthStrategy(prisma, companyId)
        triggered++
      } else if (!types.includes('feed_audit')) {
        await triggerFeedAudit(prisma, companyId)
        triggered++
      } else if (!types.includes('format_analysis')) {
        await triggerFormatAnalysis(prisma, companyId)
        triggered++
      } else if (!types.includes('competitor_analysis')) {
        await triggerCompetitorAnalysis(prisma, companyId)
        triggered++
      } else if (!types.includes('plan_adjustment')) {
        await triggerPlanAdjustment(prisma, companyId)
        triggered++
      } else if (!types.includes('hooks') && !types.includes('trend_hooks')) {
        await triggerProactiveHooks(prisma, companyId)
        triggered++
      }
    } catch (err) {
      console.error(`[keep-alive] failed for company ${companyId}`, err)
    }
  }

  return { total: companies.length, triggered }
}

// ─── DAILY BRIEFS ─────────────────────────────────────────────────────────────

/**
 * 8:00 AM UTC — Morning brief (trends + yesterday + queue)
 */
export async function triggerMorningBrief(
  prisma: PrismaClient,
  companyId: string,
): Promise<{ triggered: boolean; reason?: string; taskId?: string }> {
  return triggerDailyBriefTask(prisma, companyId, {
    type: 'morning_brief',
    title: 'Morning brief — trends + queue status',
    description: "What's trending overnight, how yesterday's posts performed, and what's queued for today.",
    notifTitle: "Maya's morning briefing is ready",
    notifBody: "See what's trending, yesterday's wins, and today's queue.",
    dedupHours: 22,
  })
}

/**
 * 1:00 PM UTC — Midday check (performance tracking)
 */
export async function triggerMidayCheck(
  prisma: PrismaClient,
  companyId: string,
): Promise<{ triggered: boolean; reason?: string; taskId?: string }> {
  return triggerDailyBriefTask(prisma, companyId, {
    type: 'midday_check',
    title: 'Midday performance check',
    description: "How are today's posts tracking? Early performance signals and forecast.",
    notifTitle: 'How are your posts doing today?',
    notifBody: 'Quick midday performance snapshot and forecast.',
    dedupHours: 22,
  })
}

/**
 * 8:00 PM UTC — Evening recap (full summary + tomorrow forecast)
 */
export async function triggerEveningRecap(
  prisma: PrismaClient,
  companyId: string,
): Promise<{ triggered: boolean; reason?: string; taskId?: string }> {
  return triggerDailyBriefTask(prisma, companyId, {
    type: 'evening_recap',
    title: 'Evening recap — day summary + tomorrow forecast',
    description: "What worked today, key learnings, and what to expect from tomorrow's queue.",
    notifTitle: "Maya's evening recap is in",
    notifBody: "Today's summary, learnings, and tomorrow's forecast.",
    dedupHours: 22,
  })
}

async function triggerDailyBriefTask(
  prisma: PrismaClient,
  companyId: string,
  opts: {
    type: string
    title: string
    description: string
    notifTitle: string
    notifBody: string
    dedupHours: number
  },
): Promise<{ triggered: boolean; reason?: string; taskId?: string }> {
  const since = new Date(Date.now() - opts.dedupHours * 60 * 60 * 1000)
  const existing = await prisma.task.findFirst({
    where: { companyId, type: opts.type, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
  })
  if (existing) return { triggered: false, reason: 'recent_brief_exists' }

  return triggerAgentTask(prisma, companyId, 'analyst' as EmployeeRole, {
    type: opts.type,
    title: opts.title,
    description: opts.description,
    notifTitle: opts.notifTitle,
    notifBody: opts.notifBody,
    dedupDays: 0, // dedup already handled above
  })
}

// ─── WEEKLY ORCHESTRATION ─────────────────────────────────────────────────────

/**
 * Sunday 6:00 PM UTC — Maya's weekly pulse (dedicated weekly trigger)
 */
export async function triggerWeeklyMayaPulse(
  prisma: PrismaClient,
  companyId: string,
): Promise<{ triggered: boolean; reason?: string; taskId?: string }> {
  return triggerDailyBriefTask(prisma, companyId, {
    type: 'weekly_pulse',
    title: 'Weekly pulse — learnings + next week opportunity',
    description: "Maya analyzes this week's performance and identifies opportunities for next week.",
    notifTitle: "Maya's weekly pulse is ready",
    notifBody: 'See what worked this week and what to focus on next.',
    dedupHours: 168, // 7 days
  })
}

/**
 * Sunday 6:30 PM UTC — Jordan's weekly plan
 */
export async function triggerWeeklyJordanPlan(
  prisma: PrismaClient,
  companyId: string,
): Promise<{ triggered: boolean; reason?: string; taskId?: string }> {
  return triggerAgentTask(prisma, companyId, 'strategist' as EmployeeRole, {
    type: 'content_plan',
    title: 'Weekly content plan — next 7 days',
    description: "Jordan plans next week's content informed by Maya's weekly pulse findings.",
    notifTitle: "Jordan's weekly plan is ready",
    notifBody: "Next week's strategy informed by this week's data.",
    dedupDays: 6,
  })
}

/**
 * Sunday 7:00 PM UTC — Alex's weekly hooks
 */
export async function triggerWeeklyAlexHooks(
  prisma: PrismaClient,
  companyId: string,
): Promise<{ triggered: boolean; reason?: string; taskId?: string }> {
  return triggerAgentTask(prisma, companyId, 'copywriter' as EmployeeRole, {
    type: 'hooks',
    title: 'Weekly hooks — 3 per content piece',
    description: "Alex generates hooks for this week's content, informed by hook performance data.",
    notifTitle: "Alex's weekly hooks are ready",
    notifBody: "Hooks for this week's content, ranked by predicted performance.",
    dedupDays: 6,
  })
}

/**
 * Sunday 7:30 PM UTC — Riley's weekly production briefs
 */
export async function triggerWeeklyRileyBriefs(
  prisma: PrismaClient,
  companyId: string,
): Promise<{ triggered: boolean; reason?: string; taskId?: string }> {
  return triggerAgentTask(prisma, companyId, 'creative_director' as EmployeeRole, {
    type: 'shot_list',
    title: 'Weekly production briefs — optimized direction',
    description: "Riley creates production direction for this week's content, informed by format/pacing data.",
    notifTitle: "Riley's weekly production briefs are ready",
    notifBody: 'Production direction optimized for what worked this week.',
    dedupDays: 6,
  })
}
