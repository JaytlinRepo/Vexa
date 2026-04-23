/**
 * Platform Sync Worker
 *
 * Handles: Instagram/TikTok syncs, post-sync analysis chain
 * (Maya pulse, engagement capture, tagging, forecast, correlation, playbook).
 */

import { Worker, Job } from 'bullmq'
import { createRedisConnection } from '../queues/connection'
import type { PlatformSyncJobData } from '../queues/types'
import prisma from '../lib/prisma'

export function createPlatformSyncWorker(): Worker {
  const connection = createRedisConnection()

  const worker = new Worker<PlatformSyncJobData>(
    'platform-sync',
    async (job: Job<PlatformSyncJobData>) => {
      const data = job.data
      console.log(`[worker:sync] ${data.kind}${('companyId' in data) ? ` for ${data.companyId}` : ''}`)

      switch (data.kind) {
        case 'instagram-sync': {
          const { syncInstagramAccount } = await import('../lib/instagramSync')
          await syncInstagramAccount(prisma, data.companyId)
          // Enqueue post-sync analysis
          const { contentQueue, syncQueue } = await import('../queues')
          await syncQueue.add('post-sync', { kind: 'post-sync-analysis', companyId: data.companyId })
          await contentQueue.add('tag', { kind: 'tag-posts', companyId: data.companyId })
          break
        }

        case 'tiktok-sync': {
          const { syncTiktokAccount } = await import('../lib/tiktokRefreshSync')
          await syncTiktokAccount(prisma, data.companyId)
          const { contentQueue, syncQueue } = await import('../queues')
          await syncQueue.add('post-sync', { kind: 'post-sync-analysis', companyId: data.companyId })
          await contentQueue.add('tag', { kind: 'tag-posts', companyId: data.companyId })
          break
        }

        case 'post-sync-analysis': {
          // Sequential chain: Maya pulse → engagement → forecast → correlation → playbook
          const companyId = data.companyId
          try {
            const { triggerWeeklyPulse } = await import('../lib/proactiveAnalysis')
            await triggerWeeklyPulse(prisma, companyId)
          } catch {}
          try {
            const { evaluateOutputPerformance } = await import('../lib/metricTracking')
            await evaluateOutputPerformance(prisma, companyId)
          } catch {}
          try {
            const { captureDailyEngagement } = await import('../lib/metricTracking')
            await captureDailyEngagement(prisma, companyId)
          } catch {}
          try {
            const { generateNarrativeForecast } = await import('../lib/metricTracking')
            await generateNarrativeForecast(prisma, companyId)
          } catch {}
          try {
            const { computeCorrelationAnalysis } = await import('../lib/metricTracking')
            await computeCorrelationAnalysis(prisma, companyId)
          } catch {}
          try {
            const { generateMayaPlaybook } = await import('../lib/metricTracking')
            await generateMayaPlaybook(prisma, companyId)
          } catch {}
          // Rebuild retention intelligence (learns from new performance data)
          try {
            const { buildRetentionProfile } = await import('../services/intelligence/retentionIntelligence')
            await buildRetentionProfile(prisma, companyId)
          } catch {}
          break
        }

        case 'daily-sync-all': {
          // Fan-out: enqueue per-company sync jobs
          const { syncQueue } = await import('../queues')
          const igCompanies = await prisma.instagramConnection.findMany({ select: { companyId: true } })
          for (const { companyId } of igCompanies) {
            await syncQueue.add('ig-sync', { kind: 'instagram-sync', companyId }, {
              jobId: `ig-sync:${companyId}:${new Date().toISOString().slice(0, 10)}`,
            })
          }
          const ttCompanies = await prisma.tiktokConnection.findMany({ select: { companyId: true } })
          for (const { companyId } of ttCompanies) {
            await syncQueue.add('tt-sync', { kind: 'tiktok-sync', companyId }, {
              jobId: `tt-sync:${companyId}:${new Date().toISOString().slice(0, 10)}`,
            })
          }
          console.log(`[worker:sync] enqueued ${igCompanies.length} IG + ${ttCompanies.length} TT syncs`)
          break
        }

        case 'trial-emails': {
          // Check for expiring trials and send emails
          try {
            const threeDaysFromNow = new Date(Date.now() + 3 * 86400000)
            const expiring = await prisma.user.findMany({
              where: { subscriptionStatus: 'trial', createdAt: { lte: threeDaysFromNow } },
              select: { email: true, fullName: true },
            })
            if (expiring.length > 0) console.log(`[worker:sync] ${expiring.length} trials expiring soon`)
          } catch {}
          break
        }

        default:
          console.warn(`[worker:sync] unknown kind: ${(data as PlatformSyncJobData).kind}`)
      }
    },
    {
      connection,
      concurrency: 5,
      limiter: { max: 10, duration: 60_000 }, // respect platform API limits
    },
  )

  worker.on('failed', (job, err) => {
    console.error(`[worker:sync] FAILED ${job?.data.kind}: ${err.message}`)
  })

  console.log('[worker:sync] started (concurrency: 5, rate: 10/60s)')
  return worker
}
