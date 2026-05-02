import { Plan } from '@prisma/client'

export interface PlanLimits {
  tasksPerMonth: number        // for daily-reset plans, this is the per-day cap
  resetWindow: 'daily' | 'monthly'
  videosPerMonth: number
  workspaces: number
  meetingFeature: boolean
  brandMemory: boolean
  // Agent capabilities
  bedrockCallsPerMonth: number
  briefCooldownMin: number
  proactiveAnalysis: boolean
  weeklyPulse: boolean
  nicheDetection: boolean
  syncOnLogin: boolean
  // Employee access
  employees: ('analyst' | 'strategist' | 'copywriter' | 'creative_director')[]
  revisionsPerOutput: number
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    tasksPerMonth: 5,
    resetWindow: 'monthly',
    videosPerMonth: 0,
    workspaces: 1,
    meetingFeature: false,
    brandMemory: false,
    bedrockCallsPerMonth: 25,
    briefCooldownMin: 60,
    proactiveAnalysis: false,
    weeklyPulse: false,
    nicheDetection: true,
    syncOnLogin: false,
    employees: ['analyst', 'strategist', 'copywriter', 'creative_director'],
    revisionsPerOutput: 0,
  },
  pro: {
    tasksPerMonth: 75,
    resetWindow: 'monthly',
    videosPerMonth: 5,
    workspaces: 1,
    meetingFeature: false,
    brandMemory: false,
    bedrockCallsPerMonth: 400,
    briefCooldownMin: 15,
    proactiveAnalysis: true,
    weeklyPulse: false,
    nicheDetection: true,
    syncOnLogin: true,
    employees: ['analyst', 'strategist', 'copywriter', 'creative_director'],
    revisionsPerOutput: 5,
  },
  max: {
    tasksPerMonth: 200,
    resetWindow: 'monthly',
    videosPerMonth: 15,
    workspaces: 1,
    meetingFeature: true,
    brandMemory: true,
    bedrockCallsPerMonth: 1200,
    briefCooldownMin: 5,
    proactiveAnalysis: true,
    weeklyPulse: true,
    nicheDetection: true,
    syncOnLogin: true,
    employees: ['analyst', 'strategist', 'copywriter', 'creative_director'],
    revisionsPerOutput: 10,
  },
  agency: {
    tasksPerMonth: 1000,
    resetWindow: 'monthly',
    videosPerMonth: 75,
    workspaces: 5,
    meetingFeature: true,
    brandMemory: true,
    bedrockCallsPerMonth: 5500,
    briefCooldownMin: 2,
    proactiveAnalysis: true,
    weeklyPulse: true,
    nicheDetection: true,
    syncOnLogin: true,
    employees: ['analyst', 'strategist', 'copywriter', 'creative_director'],
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
