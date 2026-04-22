import { Router } from 'express'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import prisma from '../lib/prisma'

const router = Router()

// Get all employees for a company with recent task summary
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const companyId = (req.query.companyId as string | undefined) ?? undefined

    // Scope by user's companies
    const company = companyId
      ? await prisma.company.findFirst({ where: { id: companyId, userId } })
      : await prisma.company.findFirst({ where: { userId } })
    if (!company) {
      res.json({ employees: [] })
      return
    }

    const employees = await prisma.employee.findMany({
      where: { companyId: company.id },
      orderBy: { role: 'asc' },
    })

    // Enrich with recent task data
    const enriched = await Promise.all(
      employees.map(async (emp) => {
        const recentTasks = await prisma.task.findMany({
          where: { employeeId: emp.id },
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: { outputs: true },
        })

        const allTasks = await prisma.task.findMany({
          where: { employeeId: emp.id },
        })

        // Calculate metrics
        const completed = allTasks.filter(
          (t) => t.status === 'approved' || t.status === 'delivered'
        ).length
        const rejected = allTasks.filter((t) => t.status === 'rejected').length
        const inProgress = allTasks.filter(
          (t) => t.status === 'in_progress' || t.status === 'pending'
        ).length
        const completionRate = allTasks.length > 0 ? Math.round((completed / allTasks.length) * 100) : 0

        // Get latest task status
        const latest = recentTasks[0]
        let status = 'idle'
        if (latest?.status === 'in_progress' || latest?.status === 'pending') {
          status = 'working'
        } else if (latest?.status === 'delivered') {
          status = 'awaiting_review'
        }

        return {
          ...emp,
          recentTasks,
          metrics: {
            totalTasks: allTasks.length,
            completed,
            rejected,
            inProgress,
            completionRate,
          },
          currentStatus: status,
          lastTaskCreated: latest?.createdAt || emp.lastActive,
        }
      })
    )

    res.json({ employees: enriched, companyId: company.id })
  } catch (err) {
    next(err)
  }
})

// Get single employee with detailed history
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session

    const employee = await prisma.employee.findUnique({
      where: { id: req.params.id },
      include: {
        company: true,
      },
    })

    if (!employee || employee.company.userId !== userId) {
      res.status(404).json({ error: 'employee_not_found' })
      return
    }

    // Get all tasks for this employee
    const tasks = await prisma.task.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: 'desc' },
      include: { outputs: true },
    })

    // Calculate comprehensive metrics
    const completed = tasks.filter((t) => t.status === 'approved' || t.status === 'delivered').length
    const rejected = tasks.filter((t) => t.status === 'rejected').length
    const revisions = tasks.filter((t) => t.status === 'revision').length
    const inProgress = tasks.filter((t) => t.status === 'in_progress' || t.status === 'pending').length
    const completionRate = tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0

    // Calculate average turnaround time (for completed tasks)
    let avgTurnaroundMs = 0
    const completedTasks = tasks.filter((t) => t.completedAt)
    if (completedTasks.length > 0) {
      const totalTime = completedTasks.reduce((sum, t) => {
        if (!t.completedAt) return sum
        return sum + (new Date(t.completedAt).getTime() - new Date(t.createdAt).getTime())
      }, 0)
      avgTurnaroundMs = Math.round(totalTime / completedTasks.length)
    }

    // Get timeline of completed tasks (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const recentCompleted = tasks.filter(
      (t) => (t.status === 'approved' || t.status === 'delivered') && new Date(t.createdAt) > thirtyDaysAgo
    ).length

    // Get distribution by task type
    const typeDistribution: Record<string, number> = {}
    tasks.forEach((t) => {
      typeDistribution[t.type] = (typeDistribution[t.type] || 0) + 1
    })

    res.json({
      employee: {
        ...employee,
        metrics: {
          totalTasks: tasks.length,
          completed,
          rejected,
          revisions,
          inProgress,
          completionRate,
          avgTurnaroundMs,
          recentCompletedLast30Days: recentCompleted,
          typeDistribution,
        },
        recentTasks: tasks.slice(0, 10),
        allTasks: tasks,
      },
    })
  } catch (err) {
    next(err)
  }
})

// Get employee work history
router.get('/:id/history', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100)
    const offset = parseInt(req.query.offset as string) || 0

    const employee = await prisma.employee.findUnique({
      where: { id: req.params.id },
      include: { company: true },
    })

    if (!employee || employee.company.userId !== userId) {
      res.status(404).json({ error: 'employee_not_found' })
      return
    }

    // Get paginated task history with outputs
    const tasks = await prisma.task.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: 'desc' },
      include: { outputs: true },
      take: limit,
      skip: offset,
    })

    const totalCount = await prisma.task.count({
      where: { employeeId: employee.id },
    })

    res.json({
      employee: {
        id: employee.id,
        name: employee.name,
        role: employee.role,
      },
      tasks,
      pagination: {
        offset,
        limit,
        total: totalCount,
        hasMore: offset + limit < totalCount,
      },
    })
  } catch (err) {
    next(err)
  }
})

export default router
