/**
 * Job payload types for each BullMQ queue.
 */

// ── Video Processing ─────────────────────────────────────────────────────────

export interface VideoProcessingJobData {
  uploadId: string
  videoUrl: string
  userId: string
  companyId: string
  s3Key: string
}

// ── Agent Tasks ──────────────────────────────────────────────────────────────

export interface AgentTaskJobData {
  taskId: string
  source: 'user-brief' | 'auto-chain' | 'scheduler' | 'meeting'
}

export interface ScheduledAgentJobData {
  kind:
    | 'reset-stuck-tasks'
    | 'proactive-cycle'
    | 'keep-alive'
    | 'hourly-agent-schedule'
    | 'morning-brief'
    | 'midday-check'
    | 'evening-recap'
    | 'weekly-maya-pulse'
    | 'weekly-jordan-plan'
    | 'weekly-alex-hooks'
    | 'weekly-riley-briefs'
    | 'thought-responses'
    | 'generate-timeline'
}

// ── Content Analysis ─────────────────────────────────────────────────────────

export type ContentAnalysisJobData =
  | { kind: 'tag-posts'; companyId: string }
  | { kind: 'style-analysis'; companyId: string }
  | { kind: 'content-profile'; companyId: string }

// ── Platform Sync ────────────────────────────────────────────────────────────

export type PlatformSyncJobData =
  | { kind: 'instagram-sync'; companyId: string }
  | { kind: 'tiktok-sync'; companyId: string }
  | { kind: 'post-sync-analysis'; companyId: string }
  | { kind: 'daily-sync-all' }
  | { kind: 'trial-emails' }
