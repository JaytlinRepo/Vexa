import cron from 'node-cron'
import { PrismaClient } from '@prisma/client'
import { syncAllConnectedAccounts } from './lib/phylloSync'
import { syncTiktokAccount } from './lib/tiktokRefreshSync'
import { triggerWeeklyPulses } from './lib/proactiveAnalysis'
import { isTestMode } from './lib/mode'

/**
 * In-process cron. Single job: once a day at 09:00 UTC, call Phyllo and
 * append a new snapshot for every connected account. Appending (never
 * overwriting) is what gives us the 30 / 90 / 365-day history the
 * dashboard charts feed off.
 *
 * For production we'd want an out-of-process worker (BullMQ + Redis or
 * AWS EventBridge + Lambda). For dev + early prod this is good enough:
 * job locks itself per run to prevent overlap, and skipped runs don't
 * compound (Phyllo data is cumulative).
 */

let running = false
let lastRunAt: Date | null = null
let lastResultCount = 0

export function registerScheduledJobs(prisma: PrismaClient): void {
  if (isTestMode()) {
    console.log('[scheduler] VEXA_MODE=test — scheduled Phyllo sync is disabled')
    return
  }

  // Every day at 09:00 UTC. Override with VEXA_SYNC_CRON if you want a
  // different cadence (e.g. '0 */6 * * *' for every 6 hours).
  const expr = process.env.VEXA_SYNC_CRON || '0 9 * * *'
  if (!cron.validate(expr)) {
    console.warn('[scheduler] invalid VEXA_SYNC_CRON; falling back to 0 9 * * *')
  }

  cron.schedule(cron.validate(expr) ? expr : '0 9 * * *', async () => {
    if (running) {
      console.log('[scheduler] skip — previous run still in flight')
      return
    }
    running = true
    const started = Date.now()
    console.log('[scheduler] phyllo sync starting')
    try {
      const results = await syncAllConnectedAccounts(prisma)
      lastResultCount = results.length
      lastRunAt = new Date()
      const ok = results.filter((r) => !r.error).length
      const failed = results.length - ok
      console.log(`[scheduler] phyllo sync done in ${Date.now() - started}ms: ${ok} ok, ${failed} failed`)

      // Also refresh all TikTok connections (token refresh + data pull)
      try {
        const ttCompanies = await prisma.tiktokConnection.findMany({ select: { companyId: true } })
        let ttOk = 0, ttFail = 0
        for (const { companyId } of ttCompanies) {
          try {
            await syncTiktokAccount(prisma, companyId)
            ttOk++
          } catch { ttFail++ }
        }
        if (ttCompanies.length > 0) console.log(`[scheduler] tiktok sync: ${ttOk} ok, ${ttFail} failed`)
      } catch (err) {
        console.error('[scheduler] tiktok sync threw', err)
      }
    } catch (err) {
      console.error('[scheduler] phyllo sync threw', err)
    } finally {
      running = false
    }
  })

  console.log(`[scheduler] registered phyllo sync on '${expr}' (UTC)`)

  // Weekly Monday 08:00 UTC — Maya proactive TikTok performance analysis.
  // Runs 1 hour before Phyllo sync; aligns with CLAUDE.md's "Monday
  // morning trend report" cadence.
  let mayaRunning = false
  const mayaExpr = process.env.VEXA_MAYA_CRON || '0 8 * * 1'
  cron.schedule(cron.validate(mayaExpr) ? mayaExpr : '0 8 * * 1', async () => {
    if (mayaRunning) {
      console.log('[scheduler] maya skip — previous run still in flight')
      return
    }
    mayaRunning = true
    const started = Date.now()
    console.log('[scheduler] maya weekly pulse starting')
    try {
      const result = await triggerWeeklyPulses(prisma)
      console.log(`[scheduler] maya pulse done in ${Date.now() - started}ms:`, result)
    } catch (err) {
      console.error('[scheduler] maya pulse threw', err)
    } finally {
      mayaRunning = false
    }
  })
  console.log(`[scheduler] registered maya weekly review on '${mayaExpr}' (UTC)`)

  // Every 10 minutes: reset stuck tasks (in_progress > 10 min) so they
  // don't block the CEO's queue forever if a Bedrock call crashed.
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
      console.log(`[scheduler] reset ${stuck.length} stuck tasks:`, stuck.map((t) => t.title).join(', '))
    } catch (err) {
      console.error('[scheduler] stuck task cleanup threw', err)
    }
  })
  console.log('[scheduler] registered stuck task cleanup (every 10 min)')
}

export function schedulerStatus(): { lastRunAt: Date | null; lastResultCount: number; running: boolean } {
  return { lastRunAt, lastResultCount, running }
}
