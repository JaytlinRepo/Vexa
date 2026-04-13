import { Plan } from '@prisma/client'

export interface PlanLimits {
  tasksPerMonth: number
  videosPerMonth: number
  workspaces: number
  meetingFeature: boolean
  brandMemory: boolean
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  starter: {
    tasksPerMonth: 30,
    videosPerMonth: 0,
    workspaces: 1,
    meetingFeature: false,
    brandMemory: false,
  },
  pro: {
    tasksPerMonth: 9999,
    videosPerMonth: 10,
    workspaces: 1,
    meetingFeature: true,
    brandMemory: true,
  },
  agency: {
    tasksPerMonth: 99999,
    videosPerMonth: 50,
    workspaces: 5,
    meetingFeature: true,
    brandMemory: true,
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
