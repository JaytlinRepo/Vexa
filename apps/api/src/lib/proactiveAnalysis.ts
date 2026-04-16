import { PrismaClient } from '@prisma/client'
import { orchestrateTask } from '../agents/task-orchestrator'
import { createNotification } from '../services/notifications/notification.service'

const DEDUP_WINDOW_MS = 6 * 24 * 60 * 60 * 1000 // 6 days

export async function triggerProactiveMayaAnalysis(
  prisma: PrismaClient,
  companyId: string,
): Promise<{ triggered: boolean; reason?: string; taskId?: string }> {
  const since = new Date(Date.now() - DEDUP_WINDOW_MS)
  const existing = await prisma.task.findFirst({
    where: { companyId, type: 'performance_review', createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
  })
  if (existing) {
    return { triggered: false, reason: 'recent_analysis_exists' }
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: { employees: { where: { role: 'analyst', isActive: true } } },
  })
  if (!company) return { triggered: false, reason: 'company_not_found' }

  const analyst = company.employees[0]
  if (!analyst) return { triggered: false, reason: 'no_active_analyst' }

  const task = await prisma.task.create({
    data: {
      companyId,
      employeeId: analyst.id,
      title: 'TikTok performance analysis',
      description: 'Proactive analysis of your TikTok content — what\'s working, what\'s not, and what to do next.',
      type: 'performance_review',
      status: 'in_progress',
    },
  })

  try {
    await orchestrateTask(task.id)

    try {
      await createNotification({
        userId: company.userId,
        companyId,
        type: 'team_update',
        emoji: '📊',
        title: 'Maya analyzed your TikTok',
        body: 'Performance review is ready — what\'s working, what\'s not, and what to do next.',
        actionLabel: 'Review analysis',
        metadata: { taskId: task.id },
      })
    } catch (e) {
      console.warn('[proactive] notification failed', e)
    }

    return { triggered: true, taskId: task.id }
  } catch (err) {
    await prisma.task.update({
      where: { id: task.id },
      data: { status: 'pending' },
    })
    console.error('[proactive] Maya analysis failed, task reset to pending', err)
    return { triggered: false, reason: 'execution_failed', taskId: task.id }
  }
}

export async function triggerWeeklyPerformanceReviews(
  prisma: PrismaClient,
): Promise<{ total: number; triggered: number; skipped: number; errors: number }> {
  const companies = await prisma.company.findMany({
    where: { tiktok: { isNot: null } },
    select: { id: true },
  })

  let triggered = 0
  let skipped = 0
  let errors = 0

  for (const company of companies) {
    try {
      const result = await triggerProactiveMayaAnalysis(prisma, company.id)
      if (result.triggered) triggered++
      else skipped++
    } catch {
      errors++
    }
  }

  return { total: companies.length, triggered, skipped, errors }
}
