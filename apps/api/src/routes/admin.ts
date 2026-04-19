import { Router, Request, Response, NextFunction } from 'express'
import { readSession } from '../middleware/auth'

import prisma from '../lib/prisma'
const router = Router()

// Admin emails — only these can access admin routes
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim()).filter(Boolean)

async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const session = await readSession(req)
  if (!session) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  if (!ADMIN_EMAILS.includes(session.email)) {
    res.status(403).json({ error: 'forbidden' })
    return
  }
  next()
}

router.use(requireAdmin)

// GET /api/admin/overview — high-level stats
router.get('/overview', async (_req, res, next) => {
  try {
    const [userCount, companyCount, taskCount, meetingCount] = await Promise.all([
      prisma.user.count(),
      prisma.company.count(),
      prisma.task.count(),
      prisma.meeting.count(),
    ])

    const recentUsers = await prisma.user.count({
      where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    })

    const tasksByStatus = await prisma.task.groupBy({
      by: ['status'],
      _count: true,
    })

    const planBreakdown = await prisma.user.groupBy({
      by: ['plan'],
      _count: true,
    })

    const subBreakdown = await prisma.user.groupBy({
      by: ['subscriptionStatus'],
      _count: true,
    })

    res.json({
      users: { total: userCount, lastSevenDays: recentUsers },
      companies: companyCount,
      tasks: { total: taskCount, byStatus: tasksByStatus },
      meetings: meetingCount,
      plans: planBreakdown,
      subscriptions: subBreakdown,
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/admin/users — list all users with companies
router.get('/users', async (req, res, next) => {
  try {
    const page = Number(req.query.page ?? 1)
    const limit = Math.min(Number(req.query.limit ?? 50), 100)
    const skip = (page - 1) * limit

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          username: true,
          fullName: true,
          plan: true,
          subscriptionStatus: true,
          trialEndsAt: true,
          stripeCustomerId: true,
          createdAt: true,
          updatedAt: true,
          companies: {
            select: {
              id: true,
              name: true,
              niche: true,
              detectedNiche: true,
              _count: { select: { employees: true } },
            },
          },
          _count: { select: { notifications: true } },
        },
      }),
      prisma.user.count(),
    ])

    res.json({ users, total, page, limit, pages: Math.ceil(total / limit) })
  } catch (err) {
    next(err)
  }
})

// GET /api/admin/users/:id — single user detail
router.get('/users/:id', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        companies: {
          include: {
            employees: true,
            _count: { select: { tasks: true, meetings: true, outputs: true } },
          },
        },
      },
    })
    if (!user) {
      res.status(404).json({ error: 'user_not_found' })
      return
    }

    // Recent tasks for this user's companies
    const companyIds = user.companies.map((c) => c.id)
    const recentTasks = await prisma.task.findMany({
      where: { companyId: { in: companyIds } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        title: true,
        type: true,
        status: true,
        createdAt: true,
        employee: { select: { name: true, role: true } },
      },
    })

    res.json({ user, recentTasks })
  } catch (err) {
    next(err)
  }
})

// GET /api/admin/activity — recent agent activity across all users
router.get('/activity', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200)

    const recentTasks = await prisma.task.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        type: true,
        status: true,
        createdAt: true,
        completedAt: true,
        employee: { select: { name: true, role: true } },
        company: { select: { name: true, user: { select: { email: true } } } },
      },
    })

    const recentMeetings = await prisma.meeting.findMany({
      orderBy: { endedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        summary: true,
        endedAt: true,
        employee: { select: { name: true, role: true } },
        company: { select: { name: true, user: { select: { email: true } } } },
      },
    })

    res.json({ tasks: recentTasks, meetings: recentMeetings })
  } catch (err) {
    next(err)
  }
})

// GET /api/admin/usage — Bedrock usage stats
router.get('/usage', async (req, res, next) => {
  try {
    const days = Number(req.query.days ?? 7)
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const tasksByDay = await prisma.task.groupBy({
      by: ['status'],
      where: { createdAt: { gte: since } },
      _count: true,
    })

    const tasksByType = await prisma.task.groupBy({
      by: ['type'],
      where: { createdAt: { gte: since } },
      _count: true,
      orderBy: { _count: { type: 'desc' } },
    })

    const outputsByType = await prisma.output.groupBy({
      by: ['type'],
      where: { createdAt: { gte: since } },
      _count: true,
    })

    res.json({
      period: { days, since: since.toISOString() },
      tasks: { byStatus: tasksByDay, byType: tasksByType },
      outputs: { byType: outputsByType },
    })
  } catch (err) {
    next(err)
  }
})

export default router
