/**
 * Agent Tasks Worker
 *
 * Handles: task orchestration, scheduled agent jobs (briefs, pulses),
 * stuck task cleanup, and agent pipeline chaining.
 */

import { Worker, Job } from 'bullmq'
import { createRedisConnection } from '../queues/connection'
import type { AgentTaskJobData, ScheduledAgentJobData } from '../queues/types'
import prisma from '../lib/prisma'

export function createAgentTasksWorker(): Worker {
  const connection = createRedisConnection()

  const worker = new Worker<AgentTaskJobData | ScheduledAgentJobData>(
    'agent-tasks',
    async (job: Job<AgentTaskJobData | ScheduledAgentJobData>) => {
      const data = job.data

      // Scheduled agent jobs (fan-out from cron)
      if ('kind' in data) {
        return handleScheduledJob(data)
      }

      // Direct task orchestration
      const { taskId, source } = data as AgentTaskJobData
      console.log(`[worker:agent] orchestrating task ${taskId} (${source})`)

      const { orchestrateTask } = await import('../agents/task-orchestrator')
      await orchestrateTask(taskId)

      console.log(`[worker:agent] completed task ${taskId} in ${((Date.now() - job.timestamp) / 1000).toFixed(1)}s`)
    },
    {
      connection,
      concurrency: 3,
      limiter: { max: 5, duration: 10_000 }, // max 5 per 10s (Bedrock rate limits)
    },
  )

  worker.on('failed', (job, err) => {
    console.error(`[worker:agent] FAILED: ${err.message}`, job?.data)
  })

  console.log('[worker:agent] started (concurrency: 3, rate: 5/10s)')
  return worker
}

async function handleScheduledJob(data: ScheduledAgentJobData): Promise<void> {
  console.log(`[worker:agent] scheduled job: ${data.kind}`)

  switch (data.kind) {
    case 'reset-stuck-tasks': {
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000)
      const result = await prisma.task.updateMany({
        where: { status: 'in_progress', createdAt: { lt: tenMinAgo } },
        data: { status: 'pending' },
      })
      if (result.count > 0) console.log(`[worker:agent] reset ${result.count} stuck tasks`)
      break
    }

    case 'morning-brief': {
      const { triggerMorningBrief } = await import('../lib/proactiveAnalysis')
      const companies = await prisma.company.findMany({ select: { id: true } })
      for (const { id } of companies) {
        try { await triggerMorningBrief(prisma, id) } catch {}
      }
      break
    }

    case 'midday-check': {
      const { triggerMidayCheck } = await import('../lib/proactiveAnalysis')
      const companies = await prisma.company.findMany({ select: { id: true } })
      for (const { id } of companies) {
        try { await triggerMidayCheck(prisma, id) } catch {}
      }
      break
    }

    case 'evening-recap': {
      const { triggerEveningRecap } = await import('../lib/proactiveAnalysis')
      const companies = await prisma.company.findMany({ select: { id: true } })
      for (const { id } of companies) {
        try { await triggerEveningRecap(prisma, id) } catch {}
      }
      break
    }

    case 'weekly-maya-pulse': {
      const { triggerWeeklyMayaPulse } = await import('../lib/proactiveAnalysis')
      const companies = await prisma.company.findMany({ select: { id: true } })
      for (const { id } of companies) {
        try { await triggerWeeklyMayaPulse(prisma, id) } catch {}
      }
      break
    }

    case 'weekly-jordan-plan': {
      const { triggerWeeklyJordanPlan } = await import('../lib/proactiveAnalysis')
      const companies = await prisma.company.findMany({ select: { id: true } })
      for (const { id } of companies) {
        try { await triggerWeeklyJordanPlan(prisma, id) } catch {}
      }
      break
    }

    case 'weekly-alex-hooks': {
      const { triggerWeeklyAlexHooks } = await import('../lib/proactiveAnalysis')
      const companies = await prisma.company.findMany({ select: { id: true } })
      for (const { id } of companies) {
        try { await triggerWeeklyAlexHooks(prisma, id) } catch {}
      }
      break
    }

    case 'weekly-riley-briefs': {
      const { triggerWeeklyRileyBriefs } = await import('../lib/proactiveAnalysis')
      const companies = await prisma.company.findMany({ select: { id: true } })
      for (const { id } of companies) {
        try { await triggerWeeklyRileyBriefs(prisma, id) } catch {}
      }
      break
    }

    case 'proactive-cycle': {
      const { triggerKeepAlive } = await import('../lib/proactiveAnalysis')
      const companies = await prisma.company.findMany({ select: { id: true } })
      for (const { id } of companies) {
        try { await triggerKeepAlive(prisma, id) } catch {}
      }
      break
    }

    case 'keep-alive': {
      const { triggerKeepAlive } = await import('../lib/proactiveAnalysis')
      const companies = await prisma.company.findMany({ select: { id: true } })
      for (const { id } of companies) {
        try { await triggerKeepAlive(prisma, id) } catch {}
      }
      break
    }

    case 'hourly-agent-schedule': {
      const { getScheduleForCompany, shouldRunNow } = await import('../lib/schedulePrefs')
      const companies = await prisma.company.findMany({ select: { id: true } })
      for (const { id } of companies) {
        try {
          const schedule = await getScheduleForCompany(prisma, id)
          if (schedule && shouldRunNow(schedule)) {
            const { agentQueue } = await import('../queues')
            await agentQueue.add('scheduled-delivery', { taskId: id, source: 'scheduler' } as AgentTaskJobData)
          }
        } catch {}
      }
      break
    }

    case 'thought-responses': {
      const { processThoughtResponses } = await import('../services/thoughts/thoughtResponse.service')
      await processThoughtResponses()
      break
    }

    case 'generate-timeline': {
      // Will be implemented in Phase 7
      console.log('[worker:agent] timeline generation not yet implemented')
      break
    }

    default:
      console.warn(`[worker:agent] unknown scheduled job kind: ${(data as ScheduledAgentJobData).kind}`)
  }
}
