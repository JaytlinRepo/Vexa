import { PrismaClient } from '@prisma/client'
import {
  PLAN_LIMITS,
  startOfMonthUTC,
  startOfNextMonthUTC,
  startOfDayUTC,
  startOfNextDayUTC,
} from './plans'
import { isUnlimitedUser, UNLIMITED_LIMITS } from './unlimitedAccounts'

export interface UsageReport {
  plan: 'free' | 'pro' | 'max' | 'agency'
  subscriptionStatus: 'active' | 'canceled' | 'past_due'
  tasks: { used: number; limit: number; resetAt: string; resetWindow: 'daily' | 'monthly' }
  videos: { used: number; limit: number; resetAt: string }
  studioEdits: { used: number; limit: number; resetAt: string }
  workspaces: { used: number; limit: number }
  meetingFeature: boolean
  brandMemory: boolean
}

export async function computeUsage(prisma: PrismaClient, userId: string): Promise<UsageReport> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, subscriptionStatus: true, username: true },
  })
  if (!user) throw new Error('user_not_found')

  const companies = await prisma.company.findMany({
    where: { userId },
    select: { id: true },
  })
  const companyIds = companies.map((c) => c.id)

  const limits = isUnlimitedUser(user) ? UNLIMITED_LIMITS : PLAN_LIMITS[user.plan]
  const isDaily = limits.resetWindow === 'daily'

  const windowStart = isDaily ? startOfDayUTC() : startOfMonthUTC()
  const windowEnd = isDaily ? startOfNextDayUTC() : startOfNextMonthUTC()

  const [taskCount, videoCount, studioEditCount] = await Promise.all([
    // Only `source = 'user'` tasks count against the quota. Proactive cron
    // briefs (source='system') and onboarding seeds (source='seed') never
    // burn user budget — that was the architectural bug a Pro user could
    // hit before clicking anything. isSeeded:false is left as a belt-and-
    // braces guard for any pre-source-enum rows that lingered through
    // migration without a source value being set.
    companyIds.length
      ? prisma.task.count({
          where: {
            companyId: { in: companyIds },
            createdAt: { gte: windowStart, lt: windowEnd },
            source: 'user',
            isSeeded: false,
          },
        })
      : 0,
    companyIds.length
      ? prisma.output.count({
          where: {
            companyId: { in: companyIds },
            type: 'video',
            createdAt: { gte: startOfMonthUTC(), lt: startOfNextMonthUTC() },
          },
        })
      : 0,
    companyIds.length
      ? prisma.videoUpload.count({
          where: {
            companyId: { in: companyIds },
            createdAt: { gte: startOfMonthUTC(), lt: startOfNextMonthUTC() },
          },
        })
      : 0,
  ])

  return {
    plan: user.plan,
    subscriptionStatus: user.subscriptionStatus as 'active' | 'canceled' | 'past_due',
    tasks: {
      used: taskCount,
      limit: limits.tasksPerMonth,
      resetAt: windowEnd.toISOString(),
      resetWindow: limits.resetWindow,
    },
    videos: {
      used: videoCount,
      limit: limits.videosPerMonth,
      resetAt: startOfNextMonthUTC().toISOString(),
    },
    studioEdits: {
      used: studioEditCount,
      limit: limits.studioEditsPerMonth,
      resetAt: startOfNextMonthUTC().toISOString(),
    },
    workspaces: { used: companies.length, limit: limits.workspaces },
    meetingFeature: limits.meetingFeature,
    brandMemory: limits.brandMemory,
  }
}

/** Throws if the user is at or above their task limit. */
export async function assertTaskQuota(prisma: PrismaClient, userId: string): Promise<UsageReport> {
  const usage = await computeUsage(prisma, userId)
  if (usage.tasks.used >= usage.tasks.limit) {
    const err = new Error('plan_limit_exceeded')
    ;(err as Error & { code: string; usage: UsageReport }).code = 'plan_limit_exceeded'
    ;(err as Error & { code: string; usage: UsageReport }).usage = usage
    throw err
  }
  return usage
}

/** Throws if the user is at or above their Studio (Riley clip) edit limit. */
export async function assertStudioEditQuota(prisma: PrismaClient, userId: string): Promise<UsageReport> {
  const usage = await computeUsage(prisma, userId)
  if (usage.studioEdits.used >= usage.studioEdits.limit) {
    const err = new Error('studio_limit_exceeded')
    ;(err as Error & { code: string; usage: UsageReport }).code = 'studio_limit_exceeded'
    ;(err as Error & { code: string; usage: UsageReport }).usage = usage
    throw err
  }
  return usage
}
