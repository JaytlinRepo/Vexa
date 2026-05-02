import { PrismaClient } from '@prisma/client'
import {
  PLAN_LIMITS,
  startOfMonthUTC,
  startOfNextMonthUTC,
  startOfDayUTC,
  startOfNextDayUTC,
} from './plans'

export interface UsageReport {
  plan: 'free' | 'pro' | 'max' | 'agency'
  subscriptionStatus: 'active' | 'canceled' | 'past_due'
  tasks: { used: number; limit: number; resetAt: string; resetWindow: 'daily' | 'monthly' }
  videos: { used: number; limit: number; resetAt: string }
  workspaces: { used: number; limit: number }
  meetingFeature: boolean
  brandMemory: boolean
}

export async function computeUsage(prisma: PrismaClient, userId: string): Promise<UsageReport> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, subscriptionStatus: true },
  })
  if (!user) throw new Error('user_not_found')

  const companies = await prisma.company.findMany({
    where: { userId },
    select: { id: true },
  })
  const companyIds = companies.map((c) => c.id)

  const limits = PLAN_LIMITS[user.plan]
  const isDaily = limits.resetWindow === 'daily'

  const windowStart = isDaily ? startOfDayUTC() : startOfMonthUTC()
  const windowEnd = isDaily ? startOfNextDayUTC() : startOfNextMonthUTC()

  const [taskCount, videoCount] = await Promise.all([
    companyIds.length
      ? prisma.task.count({
          where: { companyId: { in: companyIds }, createdAt: { gte: windowStart, lt: windowEnd }, isSeeded: false },
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
