/**
 * Content Analysis Worker
 *
 * Handles: community content tagging, video style analysis,
 * content profile building.
 */

import { Worker, Job } from 'bullmq'
import { createRedisConnection } from '../queues/connection'
import type { ContentAnalysisJobData } from '../queues/types'
import prisma from '../lib/prisma'

export function createContentAnalysisWorker(): Worker {
  const connection = createRedisConnection()

  const worker = new Worker<ContentAnalysisJobData>(
    'content-analysis',
    async (job: Job<ContentAnalysisJobData>) => {
      const { kind, companyId } = job.data
      console.log(`[worker:content] ${kind} for ${companyId}`)

      switch (kind) {
        case 'tag-posts': {
          const { tagUntaggedPostsForCompany } = await import('../services/communityTagging.service')
          const result = await tagUntaggedPostsForCompany(prisma, companyId)
          console.log(`[worker:content] tagged ${result.tagged} posts (${result.errors} errors)`)
          break
        }

        case 'style-analysis': {
          const { analyzeUserVideoStyle } = await import('../services/videoStyleAnalyzer.service')
          const profile = await analyzeUserVideoStyle(companyId)
          console.log(`[worker:content] style analysis complete: ${profile.contentAngles.length} angles detected`)
          break
        }

        case 'content-profile': {
          const { createContentProfile } = await import('../services/contentProfile.service')
          const profileService = createContentProfile(prisma)
          const profile = await profileService.buildProfileFromUploads(companyId)
          await profileService.saveProfileToMemory(companyId, profile)
          console.log(`[worker:content] content profile built for ${companyId}`)
          break
        }

        default:
          console.warn(`[worker:content] unknown kind: ${kind}`)
      }
    },
    {
      connection,
      concurrency: 2,
      limiter: { max: 3, duration: 10_000 }, // max 3 per 10s (Bedrock vision rate)
    },
  )

  worker.on('failed', (job, err) => {
    console.error(`[worker:content] FAILED ${job?.data.kind}: ${err.message}`)
  })

  console.log('[worker:content] started (concurrency: 2, rate: 3/10s)')
  return worker
}
