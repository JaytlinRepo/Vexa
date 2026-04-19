/**
 * Email triggers — fire-and-forget wrappers that send emails
 * from the right places in the app. All calls are non-blocking.
 */

import prisma from './prisma'
import {
  sendWelcomeEmail,
  sendOutputDeliveredEmail,
  sendMeetingSummaryEmail,
  sendTrialEndingEmail,
  sendPaymentFailedEmail,
} from '../services/email/email.service'
import { EMPLOYEE_CONFIGS, EmployeeRole } from '@vexa/types'


function safe(fn: () => Promise<unknown>): void {
  fn().catch(err => console.warn('[email] send failed:', (err as Error).message))
}

// ─── Welcome email — after onboarding completes ─────────────────────────────

export function triggerWelcomeEmail(userId: string): void {
  safe(async () => {
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user?.email) return
    const company = await prisma.company.findFirst({ where: { userId } })
    await sendWelcomeEmail({
      to: user.email,
      firstName: user.fullName?.split(' ')[0] || user.username || 'there',
      companyName: company?.name || 'Your company',
      niche: company?.niche || 'your niche',
    })
    console.log('[email] welcome sent to', user.email)
  })
}

// ─── Output delivered — when an agent finishes work ─────────────────────────

export function triggerOutputDeliveredEmail(userId: string, opts: {
  employeeRole: EmployeeRole
  outputType: string
  outputSummary: string
  taskId: string
}): void {
  safe(async () => {
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user?.email) return
    const emp = EMPLOYEE_CONFIGS[opts.employeeRole]

    // Format output type for display
    const typeLabels: Record<string, string> = {
      trend_report: 'Trend Report', content_plan: 'Posting Schedule', hooks: 'Captions',
      content_audit: 'Content Audit', growth_strategy: 'Growth Strategy',
      feed_audit: 'Feed Audit', format_analysis: 'Format Analysis',
      trend_hooks: 'Trend Captions', plan_adjustment: 'Schedule Adjustment',
      competitor_analysis: 'Competitor Analysis', weekly_pulse: 'Weekly Pulse',
      performance_review: 'Performance Review',
    }

    await sendOutputDeliveredEmail({
      to: user.email,
      firstName: user.fullName?.split(' ')[0] || user.username || 'there',
      employeeName: emp.name,
      employeeRole: opts.employeeRole,
      employeeEmoji: emp.emoji,
      outputType: typeLabels[opts.outputType] || opts.outputType,
      outputSummary: opts.outputSummary.slice(0, 200),
      taskId: opts.taskId,
    })
    console.log('[email] output delivered sent to', user.email, '—', emp.name, opts.outputType)
  })
}

// ─── Meeting summary — when a meeting ends ──────────────────────────────────

export function triggerMeetingSummaryEmail(userId: string, opts: {
  employeeName: string
  employeeEmoji: string
  summary: string
  decisions: Array<{ decision: string; actionItem?: string }>
  tasksCreated: number
  meetingId: string
}): void {
  safe(async () => {
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user?.email) return
    await sendMeetingSummaryEmail({
      to: user.email,
      firstName: user.fullName?.split(' ')[0] || user.username || 'there',
      ...opts,
    })
    console.log('[email] meeting summary sent to', user.email)
  })
}

// ─── Payment failed — from Stripe webhook ───────────────────────────────────

export function triggerPaymentFailedEmail(userId: string): void {
  safe(async () => {
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user?.email) return
    await sendPaymentFailedEmail({
      to: user.email,
      firstName: user.fullName?.split(' ')[0] || user.username || 'there',
    })
    console.log('[email] payment failed sent to', user.email)
  })
}

// ─── Trial ending check — run daily from scheduler ──────────────────────────

export async function checkTrialEndingEmails(): Promise<{ sent: number }> {
  const now = Date.now()
  const threeDays = new Date(now + 3 * 24 * 60 * 60 * 1000)
  const oneDay = new Date(now + 1 * 24 * 60 * 60 * 1000)

  // Find users with trials ending in ~3 days or ~1 day
  const users = await prisma.user.findMany({
    where: {
      subscriptionStatus: 'trial',
      trialEndsAt: { not: null },
      stripeSubscriptionId: null,  // haven't subscribed yet
    },
    select: { id: true, email: true, fullName: true, username: true, trialEndsAt: true },
  })

  let sent = 0
  for (const user of users) {
    if (!user.trialEndsAt || !user.email) continue
    const daysLeft = Math.ceil((user.trialEndsAt.getTime() - now) / 86400000)

    if (daysLeft === 3 || daysLeft === 1) {
      // Count their activity
      const tasksCompleted = await prisma.task.count({
        where: {
          company: { userId: user.id },
          status: { in: ['delivered', 'approved'] },
        },
      })
      const outputsApproved = await prisma.output.count({
        where: {
          company: { userId: user.id },
          status: 'approved',
        },
      })

      await sendTrialEndingEmail({
        to: user.email,
        firstName: user.fullName?.split(' ')[0] || user.username || 'there',
        daysLeft,
        tasksCompleted,
        outputsApproved,
      })
      sent++
      console.log(`[email] trial ending (${daysLeft}d) sent to`, user.email)
    }
  }

  return { sent }
}
