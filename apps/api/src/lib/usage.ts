import { PrismaClient } from '@prisma/client'
import { PLAN_LIMITS, startOfMonthUTC, startOfNextMonthUTC } from './plans'

export interface UsageReport {
  plan: 'starter' | 'pro' | 'agency'
  subscriptionStatus: 'trial' | 'active' | 'canceled' | 'past_due'
  trialEndsAt: string | null
  tasks: { used: number; limit: number; resetAt: string }
  videos: { used: number; limit: number; resetAt: string }
  workspaces: { used: number; limit: number }
  meetingFeature: boolean
  brandMemory: boolean
}

/**
 * Apply a pending trial->active transition. Call at the top of every auth'd
 * request that cares about subscription state (auth/me and usage).
 */
export async function rolloverTrialIfDue(prisma: PrismaClient, userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscriptionStatus: true, trialEndsAt: true },
  })
  if (!user) return
  if (user.subscriptionStatus !== 'trial') return
  if (!user.trialEndsAt) return
  if (user.trialEndsAt.getTime() > Date.now()) return
  // Trial expired — auto-renew to active. Stripe integration (future) will
  // replace this block: it will be triggered by invoice.paid / payment_failed
  // webhooks instead of a time check.
  await prisma.user.update({
    where: { id: userId },
    data: { subscriptionStatus: 'active' },
  })
}

export async function computeUsage(prisma: PrismaClient, userId: string): Promise<UsageReport> {
  await rolloverTrialIfDue(prisma, userId)

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, subscriptionStatus: true, trialEndsAt: true },
  })
  if (!user) throw new Error('user_not_found')

  const companies = await prisma.company.findMany({
    where: { userId },
    select: { id: true },
  })
  const companyIds = companies.map((c) => c.id)

  const monthStart = startOfMonthUTC()
  const monthEnd = startOfNextMonthUTC()

  const [taskCount, videoCount] = await Promise.all([
    companyIds.length
      ? prisma.task.count({
          where: { companyId: { in: companyIds }, createdAt: { gte: monthStart, lt: monthEnd } },
        })
      : 0,
    companyIds.length
      ? prisma.output.count({
          where: {
            companyId: { in: companyIds },
            type: 'video',
            createdAt: { gte: monthStart, lt: monthEnd },
          },
        })
      : 0,
  ])

  const limits = PLAN_LIMITS[user.plan]

  return {
    plan: user.plan,
    subscriptionStatus: user.subscriptionStatus,
    trialEndsAt: user.trialEndsAt?.toISOString() ?? null,
    tasks: { used: taskCount, limit: limits.tasksPerMonth, resetAt: monthEnd.toISOString() },
    videos: { used: videoCount, limit: limits.videosPerMonth, resetAt: monthEnd.toISOString() },
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
