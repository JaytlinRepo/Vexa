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
  free: {
    tasksPerMonth: 3, // per-DAY cap (resetWindow: 'daily')
    resetWindow: 'daily',
    videosPerMonth: 0,
    studioEditsPerMonth: 2,
    workspaces: 1,
    meetingFeature: false,
    brandMemory: false,
    bedrockCallsPerMonth: 15, // per-DAY (resetWindow: 'daily')
    briefCooldownMin: 60,
    proactiveAnalysis: false,
    weeklyPulse: false,
    nicheDetection: true,
    syncOnLogin: false,
    employees: ['analyst', 'strategist', 'creative_director'],
    revisionsPerOutput: 0,
  },
  pro: {
    tasksPerMonth: 75,
    resetWindow: 'monthly',
    videosPerMonth: 5,
    studioEditsPerMonth: 6,
    workspaces: 1,
    meetingFeature: false,
    brandMemory: false,
    bedrockCallsPerMonth: 400,
    briefCooldownMin: 15,
    proactiveAnalysis: true,
    weeklyPulse: false,
    nicheDetection: true,
    syncOnLogin: true,
    employees: ['analyst', 'strategist', 'creative_director'],
    revisionsPerOutput: 5,
  },
  max: {
    tasksPerMonth: 200,
    resetWindow: 'monthly',
    videosPerMonth: 15,
    studioEditsPerMonth: 20,
    workspaces: 1,
    meetingFeature: true,
    brandMemory: true,
    bedrockCallsPerMonth: 1200,
    briefCooldownMin: 5,
    proactiveAnalysis: true,
    weeklyPulse: true,
    nicheDetection: true,
    syncOnLogin: true,
    employees: ['analyst', 'strategist', 'creative_director'],
    revisionsPerOutput: 10,
  },
  agency: {
    tasksPerMonth: 1000,
    resetWindow: 'monthly',
    videosPerMonth: 75,
    studioEditsPerMonth: 30,
    workspaces: 5,
    meetingFeature: true,
    brandMemory: true,
    bedrockCallsPerMonth: 5500,
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
