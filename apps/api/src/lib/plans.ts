import { Plan } from '@prisma/client'

export interface PlanLimits {
  /** For daily-reset plans this is the per-DAY cap; for monthly-reset plans
   *  it is the per-MONTH cap. Field name is historical; usage.ts respects
   *  resetWindow when picking the time slice it counts against. */
  tasksPerMonth: number
  resetWindow: 'daily' | 'monthly'
  videosPerMonth: number
  /** Cap on Studio uploads (Riley clip pipeline) per month. Counted against
   *  VideoUpload rows. Distinct from videosPerMonth, which counts
   *  Creatomate-rendered Output rows of type='video'. */
  studioEditsPerMonth: number
  workspaces: number
  meetingFeature: boolean
  brandMemory: boolean
  // Agent capabilities — bedrockCallsPerMonth is also bucketed by resetWindow:
  // for daily-reset plans the counter rolls over every UTC midnight.
  bedrockCallsPerMonth: number
  briefCooldownMin: number
  proactiveAnalysis: boolean
  weeklyPulse: boolean
  nicheDetection: boolean
  syncOnLogin: boolean
  // Employee access
  employees: ('analyst' | 'strategist' | 'creative_director')[]
  revisionsPerOutput: number
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  // Freemium with daily resets — no trial, no upfront cost, light per-day
  // cap. Resets at 00:00 UTC so users get a fresh runway each day; this is
  // the upgrade nudge instead of a 7-day countdown.
  // Free — audition tier. Daily resets so a curious user comes back tomorrow
  // instead of blowing the month in one weekend. Studio is monthly so we can
  // give a real "1 edit per week" demo experience without daily noise.
  free: {
    tasksPerMonth: 3, // per-DAY (resetWindow: 'daily')
    resetWindow: 'daily',
    videosPerMonth: 0,
    studioEditsPerMonth: 3, // monthly — full iteration loop demo
    workspaces: 1,
    meetingFeature: true, // parity: every tier gets every feature; volume varies
    brandMemory: true,
    bedrockCallsPerMonth: 25, // per-DAY
    briefCooldownMin: 60,
    proactiveAnalysis: false, // no auto-pulses on Free — first-impression hooks come from manual Maya/Jordan briefs
    weeklyPulse: false,
    nicheDetection: true,
    syncOnLogin: false,
    employees: ['analyst', 'strategist', 'creative_director'],
    revisionsPerOutput: 1,
  },
  // Pro — entry paid tier ($19). Daily resets. Same team quality as Max,
  // smaller daily runway. Quotas tuned so a real user doing 1 post/day with
  // light iteration never hits the wall organically.
  pro: {
    tasksPerMonth: 8, // per-DAY (resetWindow: 'daily')
    resetWindow: 'daily',
    videosPerMonth: 3, // monthly — Creatomate-rendered Reels
    studioEditsPerMonth: 8, // monthly — Riley clip pipeline (expensive; capped tighter)
    workspaces: 1,
    meetingFeature: true,
    brandMemory: true,
    bedrockCallsPerMonth: 200, // per-DAY abuse ceiling
    briefCooldownMin: 10,
    proactiveAnalysis: true,
    weeklyPulse: true, // Sonnet 4 weekly pulse from $19 \u2014 quality parity with Max
    nicheDetection: true,
    syncOnLogin: true,
    employees: ['analyst', 'strategist', 'creative_director'],
    revisionsPerOutput: 5,
  },
  // Max — flagship tier ($59). Daily resets. The "real working creator" plan.
  max: {
    tasksPerMonth: 20, // per-DAY
    resetWindow: 'daily',
    videosPerMonth: 15,
    studioEditsPerMonth: 25, // monthly
    workspaces: 1,
    meetingFeature: true,
    brandMemory: true,
    bedrockCallsPerMonth: 500, // per-DAY abuse ceiling
    briefCooldownMin: 5,
    proactiveAnalysis: true,
    weeklyPulse: true,
    nicheDetection: true,
    syncOnLogin: true,
    employees: ['analyst', 'strategist', 'creative_director'],
    revisionsPerOutput: 10,
  },
  // Agency — multi-workspace tier ($149). Cap is per-USER (across all
  // workspaces), not per-workspace. 150 tasks/day = 30/ws \u00d7 5 workspaces.
  agency: {
    tasksPerMonth: 150, // per-DAY (across all owned workspaces)
    resetWindow: 'daily',
    videosPerMonth: 75,
    studioEditsPerMonth: 100, // monthly across all 5 workspaces
    workspaces: 5,
    meetingFeature: true,
    brandMemory: true,
    bedrockCallsPerMonth: 1500, // per-DAY abuse ceiling
    briefCooldownMin: 2,
    proactiveAnalysis: true,
    weeklyPulse: true,
    nicheDetection: true,
    syncOnLogin: true,
    employees: ['analyst', 'strategist', 'creative_director'],
    revisionsPerOutput: 999,
  },
}

export function startOfMonthUTC(d: Date = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0))
}

export function startOfNextMonthUTC(d: Date = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0))
}

export function startOfDayUTC(d: Date = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0))
}

export function startOfNextDayUTC(d: Date = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0))
}
