/**
 * BullMQ Repeatable Job Schedules
 *
 * Maps all existing node-cron jobs to BullMQ repeatable jobs.
 * Each schedule targets the appropriate queue.
 */

export interface ScheduleDefinition {
  queue: 'agent-tasks' | 'platform-sync' | 'content-analysis'
  name: string
  data: Record<string, unknown>
  pattern: string     // cron expression
  description: string
}

export const SCHEDULES: ScheduleDefinition[] = [
  // ── Platform Sync ──
  {
    queue: 'platform-sync',
    name: 'daily-sync-all',
    data: { kind: 'daily-sync-all' },
    pattern: '0 9 * * *',
    description: 'Daily platform sync (9 AM UTC)',
  },
  {
    queue: 'platform-sync',
    name: 'trial-emails',
    data: { kind: 'trial-emails' },
    pattern: '0 8 * * *',
    description: 'Trial expiry check (8 AM UTC)',
  },

  // ── Agent Tasks ──
  {
    queue: 'agent-tasks',
    name: 'reset-stuck-tasks',
    data: { kind: 'reset-stuck-tasks' },
    pattern: '*/10 * * * *',
    description: 'Reset stuck tasks (every 10 min)',
  },
  {
    queue: 'agent-tasks',
    name: 'proactive-cycle',
    data: { kind: 'proactive-cycle' },
    pattern: '0 14 * * *',
    description: 'Daily proactive cycle (2 PM UTC)',
  },
  {
    queue: 'agent-tasks',
    name: 'keep-alive',
    data: { kind: 'keep-alive' },
    pattern: '0 12 * * *',
    description: 'Keep-alive (noon UTC)',
  },
  {
    queue: 'agent-tasks',
    name: 'hourly-agent-schedule',
    data: { kind: 'hourly-agent-schedule' },
    pattern: '0 * * * *',
    description: 'Hourly agent schedule check',
  },
  {
    queue: 'agent-tasks',
    name: 'morning-brief',
    data: { kind: 'morning-brief' },
    pattern: '0 8 * * *',
    description: 'Morning brief (8 AM UTC)',
  },
  {
    queue: 'agent-tasks',
    name: 'midday-check',
    data: { kind: 'midday-check' },
    pattern: '0 13 * * *',
    description: 'Midday check (1 PM UTC)',
  },
  {
    queue: 'agent-tasks',
    name: 'evening-recap',
    data: { kind: 'evening-recap' },
    pattern: '0 20 * * *',
    description: 'Evening recap (8 PM UTC)',
  },
  {
    queue: 'agent-tasks',
    name: 'weekly-maya-pulse',
    data: { kind: 'weekly-maya-pulse' },
    pattern: '0 18 * * 0',
    description: 'Weekly Maya pulse (Sun 6 PM UTC)',
  },
  {
    queue: 'agent-tasks',
    name: 'weekly-jordan-plan',
    data: { kind: 'weekly-jordan-plan' },
    pattern: '30 18 * * 0',
    description: 'Weekly Jordan plan (Sun 6:30 PM UTC)',
  },
  {
    queue: 'agent-tasks',
    name: 'weekly-alex-hooks',
    data: { kind: 'weekly-alex-hooks' },
    pattern: '0 19 * * 0',
    description: 'Weekly Alex hooks (Sun 7 PM UTC)',
  },
  {
    queue: 'agent-tasks',
    name: 'weekly-riley-briefs',
    data: { kind: 'weekly-riley-briefs' },
    pattern: '30 19 * * 0',
    description: 'Weekly Riley briefs (Sun 7:30 PM UTC)',
  },
  {
    queue: 'agent-tasks',
    name: 'thought-responses',
    data: { kind: 'thought-responses' },
    pattern: '0 */6 * * *',
    description: 'Process thought responses (every 6h)',
  },
  {
    queue: 'agent-tasks',
    name: 'generate-timeline',
    data: { kind: 'generate-timeline' },
    pattern: '0 20 * * 0',
    description: 'Generate weekly timeline (Sun 8 PM UTC)',
  },

  // ── Content Analysis ──
  {
    queue: 'content-analysis',
    name: 'daily-style-analysis',
    data: { kind: 'style-analysis', companyId: '__fan-out__' },
    pattern: '0 10 * * *',
    description: 'Daily video style analysis (10 AM UTC)',
  },
]
