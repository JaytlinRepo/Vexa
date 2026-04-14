import cron from 'node-cron'
import { PrismaClient } from '@prisma/client'
import { syncAllConnectedAccounts } from './lib/phylloSync'
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
    } catch (err) {
      console.error('[scheduler] phyllo sync threw', err)
    } finally {
      running = false
    }
  })

  console.log(`[scheduler] registered phyllo sync on '${expr}' (UTC)`)
}

export function schedulerStatus(): { lastRunAt: Date | null; lastResultCount: number; running: boolean } {
  return { lastRunAt, lastResultCount, running }
}
