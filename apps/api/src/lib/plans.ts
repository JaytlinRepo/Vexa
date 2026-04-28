import { Plan } from '@prisma/client'

export interface PlanLimits {
  tasksPerMonth: number
  videosPerMonth: number
  workspaces: number
  meetingFeature: boolean
  brandMemory: boolean
  // Agent capabilities
  bedrockCallsPerMonth: number     // LLM invocations (briefs, proactive analysis, etc.)
  briefCooldownMin: number         // minutes between briefs per agent
  proactiveAnalysis: boolean       // Maya auto-analyzes on connect + weekly
  weeklyPulse: boolean             // Monday morning pulse
  nicheDetection: boolean          // auto-detect niche from content
  syncOnLogin: boolean             // background TikTok refresh on dashboard load
  // Employee access
  employees: ('analyst' | 'strategist' | 'copywriter' | 'creative_director')[]
  revisionsPerOutput: number       // how many times user can reconsider/regenerate
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    // Audition tier — full team quality, hard wall on volume.
    tasksPerMonth: 5,
    videosPerMonth: 0,
    workspaces: 1,
    meetingFeature: false,
    brandMemory: false,
    bedrockCallsPerMonth: 25,
    briefCooldownMin: 60,           // 1-hour cooldown — slow drip
    proactiveAnalysis: false,       // no auto-pulses on Free
    weeklyPulse: false,
    nicheDetection: true,
    syncOnLogin: false,             // no platform sync until paid
    employees: ['analyst', 'strategist', 'copywriter', 'creative_director'],
    revisionsPerOutput: 0,          // one-shot per task on Free
  },
  starter: {
    tasksPerMonth: 50,
    videosPerMonth: 0,
    workspaces: 1,
    meetingFeature: false,
    brandMemory: false,
    bedrockCallsPerMonth: 200,
    briefCooldownMin: 5,
    proactiveAnalysis: true,
    weeklyPulse: false,
    nicheDetection: true,
    syncOnLogin: true,
    employees: ['analyst', 'strategist', 'copywriter', 'creative_director'],
    revisionsPerOutput: 2,
  },
  pro: {
    tasksPerMonth: 200,
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

export const TRIAL_DAYS = 7

export function trialEnd(from: Date = new Date()): Date {
  const d = new Date(from)
  d.setUTCDate(d.getUTCDate() + TRIAL_DAYS)
  return d
}
