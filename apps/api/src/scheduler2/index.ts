/**
 * BullMQ Scheduler Registration
 *
 * Replaces node-cron with BullMQ repeatable jobs.
 * Called once at Express startup. Idempotent — safe to call on every restart.
 */

import { agentQueue, contentQueue, syncQueue } from '../queues'
import { SCHEDULES } from './schedules'
import type { PrismaClient } from '@prisma/client'

const queueMap = {
  'agent-tasks': agentQueue,
  'content-analysis': contentQueue,
  'platform-sync': syncQueue,
} as const

export async function registerBullMQSchedules(_prisma: PrismaClient): Promise<void> {
  console.log('[scheduler] registering BullMQ repeatable jobs...')

  for (const schedule of SCHEDULES) {
    const queue = queueMap[schedule.queue]
    if (!queue) {
      console.warn(`[scheduler] unknown queue: ${schedule.queue}`)
      continue
    }

    try {
      await queue.upsertJobScheduler(
        schedule.name,
        { pattern: schedule.pattern },
        {
          name: schedule.name,
          data: schedule.data as any,
        },
      )
      console.log(`[scheduler] registered: ${schedule.name} (${schedule.pattern}) → ${schedule.queue}`)
    } catch (err) {
      console.error(`[scheduler] failed to register ${schedule.name}:`, (err as Error).message)
    }
  }

  console.log(`[scheduler] ${SCHEDULES.length} schedules registered`)
}
