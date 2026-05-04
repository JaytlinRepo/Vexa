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

        case 'trim-learning': {
          // Aggregate the trim signal across every company with recent
          // edits when fan-out is requested. Per-company flow is also
          // supported in case we want to trigger it on-demand later.
          const { computeTrimLearning, saveTrimLearning, runTrimLearningForAllCompanies } = await import('../services/trimLearning.service')
          if (companyId === '__fan-out__') {
            const result = await runTrimLearningForAllCompanies(prisma)
            console.log(`[worker:content] trim-learning: scanned ${result.companies} companies, wrote ${result.profiles} profiles`)
          } else {
            const profile = await computeTrimLearning(prisma, companyId)
            if (profile) {
              await saveTrimLearning(prisma, companyId, profile)
              console.log(`[worker:content] trim-learning: ${companyId} → ${profile.dropPatterns.length} patterns, preferredCutSpeed=${profile.preferredCutSpeed}`)
            } else {
              console.log(`[worker:content] trim-learning: ${companyId} — not enough edited clips yet`)
            }
          }
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
