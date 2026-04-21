import cron from 'node-cron'
import { PrismaClient } from '@prisma/client'
import { syncAllConnectedAccounts } from './lib/phylloSync'
import { syncTiktokAccount } from './lib/tiktokRefreshSync'
import { syncInstagramAccount } from './lib/instagramSync'
import { triggerWeeklyPulse, triggerWeeklyPulses, triggerKeepAlive, triggerContentAudit, triggerGrowthStrategy, triggerFeedAudit, triggerFormatAnalysis, triggerPlanAdjustment, triggerCompetitorAnalysis, triggerMorningBrief, triggerMidayCheck, triggerEveningRecap } from './lib/proactiveAnalysis'
import { isTestMode } from './lib/mode'
import { getScheduleForCompany, shouldRunNow } from './lib/schedulePrefs'

let running = false
let lastRunAt: Date | null = null
let lastResultCount = 0

export function registerScheduledJobs(prisma: PrismaClient): void {
  if (isTestMode()) {
    console.log('[scheduler] VEXA_MODE=test — scheduled jobs disabled')
    return
  }

  // ── Daily 09:00 UTC — Platform data sync (Phyllo, TikTok, Instagram) ──
  const syncExpr = process.env.VEXA_SYNC_CRON || '0 9 * * *'
  cron.schedule(cron.validate(syncExpr) ? syncExpr : '0 9 * * *', async () => {
    if (running) return
    running = true
    console.log('[scheduler] platform sync starting')
    try {
      const results = await syncAllConnectedAccounts(prisma)
      lastResultCount = results.length
      lastRunAt = new Date()
      const ok = results.filter((r) => !r.error).length
      console.log(`[scheduler] phyllo sync: ${ok}/${results.length} ok`)

      // TikTok
      try {
        const ttCompanies = await prisma.tiktokConnection.findMany({ select: { companyId: true } })
        for (const { companyId } of ttCompanies) {
          try { await syncTiktokAccount(prisma, companyId) } catch {}
        }
      } catch {}

      // Instagram
      try {
        const igCompanies = await prisma.instagramConnection.findMany({
          where: { source: 'meta' },
          select: { companyId: true },
        })
        for (const { companyId } of igCompanies) {
          try { await syncInstagramAccount(prisma, companyId) } catch {}
        }
      } catch {}

      // ── Post-sync trigger: Maya analyzes what changed ──
      // After all platforms sync, trigger Maya's performance analysis
      // for each company so the pipeline always has fresh activity.
      try {
        const companies = await prisma.company.findMany({
          where: { OR: [{ tiktok: { isNot: null } }, { instagram: { isNot: null } }] },
          select: { id: true },
        })
        for (const { id } of companies) {
          try {
            await triggerWeeklyPulse(prisma, id)
            console.log(`[scheduler] post-sync: triggered Maya pulse for ${id}`)
          } catch (e) {
            console.warn(`[scheduler] post-sync Maya pulse failed for ${id}:`, (e as Error).message)
          }
        }
      } catch {}
    } catch (err) {
      console.error('[scheduler] platform sync threw', err)
    } finally {
      running = false
    }
  })
  console.log(`[scheduler] registered platform sync on '${syncExpr}' (UTC)`)

  // ── Every 10 min — Reset stuck tasks ──
  cron.schedule('*/10 * * * *', async () => {
    try {
      const staleThreshold = new Date(Date.now() - 10 * 60 * 1000)
      const stuck = await prisma.task.findMany({
        where: { status: 'in_progress', createdAt: { lt: staleThreshold } },
        select: { id: true, title: true },
      })
      if (stuck.length === 0) return
      await prisma.task.updateMany({
        where: { id: { in: stuck.map((t) => t.id) } },
        data: { status: 'pending' },
      })
      console.log(`[scheduler] reset ${stuck.length} stuck tasks`)
    } catch {}
  })
  console.log('[scheduler] registered stuck task cleanup (every 10 min)')

  // ── Daily 14:00 UTC — Proactive agent cycle ──
  // Triggers idle agents to produce work. Maya scans, Jordan plans,
  // Alex drafts, Riley analyzes. Auto-chain handles the rest.
  cron.schedule('0 14 * * *', async () => {
    try {
      const companies = await prisma.company.findMany({
        where: { OR: [{ tiktok: { isNot: null } }, { instagram: { isNot: null } }] },
        include: { employees: true },
      })
      for (const company of companies) {
        // Check if Maya has delivered anything in the last 12 hours
        const recentMaya = await prisma.task.findFirst({
          where: {
            companyId: company.id,
            employee: { role: 'analyst' },
            createdAt: { gt: new Date(Date.now() - 12 * 60 * 60 * 1000) },
          },
        })
        if (!recentMaya) {
          // Maya is idle — kick off a pulse. Auto-chain will flow to Jordan → Alex → Riley.
          try {
            await triggerWeeklyPulse(prisma, company.id)
            console.log(`[scheduler] daily cycle: started Maya pulse for ${company.id}`)
          } catch (e) {
            console.warn(`[scheduler] daily cycle failed for ${company.id}:`, (e as Error).message)
          }
        }
      }
    } catch {}
  })
  console.log('[scheduler] registered daily proactive cycle (14:00 UTC)')

  // ── Daily 08:00 UTC — Trial ending emails ──
  cron.schedule('0 8 * * *', async () => {
    try {
      const { checkTrialEndingEmails } = require('./lib/emailTriggers')
      const result = await checkTrialEndingEmails()
      if (result.sent > 0) console.log(`[scheduler] trial emails: ${result.sent} sent`)
    } catch {}
  })
  console.log('[scheduler] registered trial ending email check (daily 08:00 UTC)')

  // ── Daily 12:00 UTC — Keep-alive ──
  cron.schedule(process.env.VEXA_KEEPALIVE_CRON || '0 12 * * *', async () => {
    try {
      const result = await triggerKeepAlive(prisma)
      if (result.triggered > 0) console.log('[scheduler] keep-alive:', result)
    } catch {}
  })
  console.log('[scheduler] registered keep-alive (daily 12:00 UTC)')

  // ── Hourly — Per-company scheduled agent deliverables ──
  // Runs every hour at :00 and checks each company's schedule preferences.
  // If a company's schedule matches the current day+hour, trigger the task.
  cron.schedule('0 * * * *', async () => {
    const now = new Date()
    const companies = await prisma.company.findMany({
      where: { OR: [{ tiktok: { isNot: null } }, { instagram: { isNot: null } }] },
      select: { id: true, agentTools: true },
    })

    for (const company of companies) {
      const tools = (company.agentTools || {}) as Record<string, unknown>

      // Maya — Weekly Pulse
      const mayaSched = getScheduleForCompany(tools, 'maya_pulse')
      if (shouldRunNow(mayaSched, now)) {
        try { await triggerWeeklyPulse(prisma, company.id) } catch {}
      }

      // Jordan — Weekly Plan
      const jordanPlan = getScheduleForCompany(tools, 'jordan_plan')
      if (shouldRunNow(jordanPlan, now)) {
        const { triggerWeeklyPlan } = require('./lib/proactiveAnalysis')
        try { await triggerWeeklyPlan(prisma, company.id) } catch {}
      }

      // Jordan — Content Audit
      const jordanAudit = getScheduleForCompany(tools, 'jordan_audit')
      if (shouldRunNow(jordanAudit, now)) {
        try { await triggerContentAudit(prisma, company.id) } catch {}
      }

      // Jordan — Plan Adjustment
      const jordanAdj = getScheduleForCompany(tools, 'jordan_adjustment')
      if (shouldRunNow(jordanAdj, now)) {
        try { await triggerPlanAdjustment(prisma, company.id) } catch {}
      }

      // Jordan — Growth Strategy
      const jordanGrowth = getScheduleForCompany(tools, 'jordan_growth')
      if (shouldRunNow(jordanGrowth, now)) {
        try { await triggerGrowthStrategy(prisma, company.id) } catch {}
      }

      // Riley — Feed Audit
      const rileyFeed = getScheduleForCompany(tools, 'riley_feed_audit')
      if (shouldRunNow(rileyFeed, now)) {
        try { await triggerFeedAudit(prisma, company.id) } catch {}
      }

      // Riley — Format Analysis
      const rileyFormat = getScheduleForCompany(tools, 'riley_format')
      if (shouldRunNow(rileyFormat, now)) {
        try { await triggerFormatAnalysis(prisma, company.id) } catch {}
      }

      // Riley — Competitor Analysis
      const rileyComp = getScheduleForCompany(tools, 'riley_competitor')
      if (shouldRunNow(rileyComp, now)) {
        try { await triggerCompetitorAnalysis(prisma, company.id) } catch {}
      }
    }
  })
  console.log('[scheduler] registered hourly agent schedule check')

  // ── Daily Briefs ──────────────────────────────────────────────────────────

  // 8:00 AM UTC — Morning brief (trends + yesterday + queue)
  cron.schedule('0 8 * * *', async () => {
    try {
      const companies = await prisma.company.findMany({ select: { id: true } })
      let sent = 0
      for (const { id } of companies) {
        try {
          const result = await triggerMorningBrief(prisma, id)
          if (result.triggered) sent++
        } catch (e) {
          console.error(`[scheduler] morning brief failed for company ${id}:`, (e as Error).message)
        }
      }
      console.log(`[scheduler] morning briefs: ${sent}/${companies.length} sent`)
    } catch (e) {
      console.error('[scheduler] morning brief batch failed:', e)
    }
  })
  console.log('[scheduler] registered morning brief at 08:00 UTC')

  // 1:00 PM UTC — Midday check (performance tracking)
  cron.schedule('0 13 * * *', async () => {
    try {
      const companies = await prisma.company.findMany({ select: { id: true } })
      let sent = 0
      for (const { id } of companies) {
        try {
          const result = await triggerMidayCheck(prisma, id)
          if (result.triggered) sent++
        } catch (e) {
          console.error(`[scheduler] midday check failed for company ${id}:`, (e as Error).message)
        }
      }
      console.log(`[scheduler] midday checks: ${sent}/${companies.length} sent`)
    } catch (e) {
      console.error('[scheduler] midday check batch failed:', e)
    }
  })
  console.log('[scheduler] registered midday check at 13:00 UTC')

  // 8:00 PM UTC — Evening recap (day summary + tomorrow forecast)
  cron.schedule('0 20 * * *', async () => {
    try {
      const companies = await prisma.company.findMany({ select: { id: true } })
      let sent = 0
      for (const { id } of companies) {
        try {
          const result = await triggerEveningRecap(prisma, id)
          if (result.triggered) sent++
        } catch (e) {
          console.error(`[scheduler] evening recap failed for company ${id}:`, (e as Error).message)
        }
      }
      console.log(`[scheduler] evening recaps: ${sent}/${companies.length} sent`)
    } catch (e) {
      console.error('[scheduler] evening recap batch failed:', e)
    }
  })
  console.log('[scheduler] registered evening recap at 20:00 UTC')
}

export function schedulerStatus(): { lastRunAt: Date | null; lastResultCount: number; running: boolean } {
  return { lastRunAt, lastResultCount, running }
}
