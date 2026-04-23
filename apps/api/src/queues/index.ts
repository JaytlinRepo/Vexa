/**
 * BullMQ Queue Registry
 *
 * Creates all four queues with tuned settings.
 * Import individual queues where needed to enqueue jobs.
 */

import { Queue } from 'bullmq'
import { createRedisConnection } from './connection'
import type {
  VideoProcessingJobData,
  AgentTaskJobData,
  ScheduledAgentJobData,
  ContentAnalysisJobData,
  PlatformSyncJobData,
} from './types'

const connection = createRedisConnection()

// ── Video Processing ─────────────────────────────────────────────────────────
// High priority — user is watching SSE progress
export const videoQueue = new Queue<VideoProcessingJobData>('video-processing', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { age: 86400 },     // 24h
    removeOnFail: false,                   // keep for DLQ inspection
  },
})

// ── Agent Tasks ──────────────────────────────────────────────────────────────
// Task orchestration, briefs, agent pipeline chains
export const agentQueue = new Queue<AgentTaskJobData | ScheduledAgentJobData>('agent-tasks', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { age: 7 * 86400 }, // 7 days
    removeOnFail: false,
  },
})

// ── Content Analysis ─────────────────────────────────────────────────────────
// Tagging, style analysis, content profiles — lower priority
export const contentQueue = new Queue<ContentAnalysisJobData>('content-analysis', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 15_000 },
    removeOnComplete: { age: 7 * 86400 },
    removeOnFail: false,
  },
})

// ── Platform Sync ────────────────────────────────────────────────────────────
// IG/TikTok syncs + post-sync analysis jobs
export const syncQueue = new Queue<PlatformSyncJobData>('platform-sync', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 60_000 }, // API rate limits need cooling
    removeOnComplete: { age: 3 * 86400 },
    removeOnFail: false,
  },
})

// ── Graceful shutdown ────────────────────────────────────────────────────────

export async function closeAllQueues(): Promise<void> {
  await Promise.all([
    videoQueue.close(),
    agentQueue.close(),
    contentQueue.close(),
    syncQueue.close(),
  ])
  connection.disconnect()
}
