/**
 * Daily Briefs API Routes
 *
 * GET /api/briefs/morning   — Morning brief data
 * GET /api/briefs/midday    — Midday check data
 * GET /api/briefs/evening   — Evening recap data
 * GET /api/briefs/queue     — Queue status (used in multiple places)
 * POST /api/briefs/queue/:postId/post-now — Post immediately
 * POST /api/briefs/approve-trend — Approve trend pivot
 */

import { Router, Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import {
  getMorningBriefData,
  getMidayCheckData,
  getEveningRecapData,
  detectAnomalies,
} from '../lib/dailyBrief.service'

const router = Router()
let prisma: PrismaClient

export function initBriefRoutes(_prisma: PrismaClient) {
  prisma = _prisma

  // ── Morning Brief ──────────────────────────────────────────────────────────

  /**
   * GET /api/briefs/morning
   * Fetch morning brief data (trends + yesterday + queue)
   */
  router.get('/morning', requireAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as AuthedRequest).session
      const companyId = req.query.companyId as string
      if (!companyId) {
        return res.status(400).json({ error: 'companyId required' })
      }

      const company = await prisma.company.findFirst({ where: { id: companyId, userId } })
      if (!company) {
        return res.status(403).json({ error: 'Company not found' })
      }

      const data = await getMorningBriefData(prisma, companyId)
      res.json(data)
    } catch (err) {
      console.error('[briefs] morning brief error:', err)
      res.status(500).json({ error: 'Failed to fetch morning brief' })
    }
  })

  // ── Midday Check ───────────────────────────────────────────────────────────

  /**
   * GET /api/briefs/midday
   * Fetch midday check data (how today's posts are tracking)
   */
  router.get('/midday', requireAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as AuthedRequest).session
      const companyId = req.query.companyId as string
      if (!companyId) {
        return res.status(400).json({ error: 'companyId required' })
      }

      const company = await prisma.company.findFirst({ where: { id: companyId, userId } })
      if (!company) {
        return res.status(403).json({ error: 'Company not found' })
      }

      const data = await getMidayCheckData(prisma, companyId)
      res.json(data)
    } catch (err) {
      console.error('[briefs] midday check error:', err)
      res.status(500).json({ error: 'Failed to fetch midday check' })
    }
  })

  // ── Evening Recap ──────────────────────────────────────────────────────────

  /**
   * GET /api/briefs/evening
   * Fetch evening recap data (day summary + tomorrow forecast)
   */
  router.get('/evening', requireAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as AuthedRequest).session
      const companyId = req.query.companyId as string
      if (!companyId) {
        return res.status(400).json({ error: 'companyId required' })
      }

      const company = await prisma.company.findFirst({ where: { id: companyId, userId } })
      if (!company) {
        return res.status(403).json({ error: 'Company not found' })
      }

      const data = await getEveningRecapData(prisma, companyId)
      res.json(data)
    } catch (err) {
      console.error('[briefs] evening recap error:', err)
      res.status(500).json({ error: 'Failed to fetch evening recap' })
    }
  })

  // ── Queue Status ───────────────────────────────────────────────────────────

  /**
   * GET /api/briefs/queue
   * Get queue status (posts ready + in production)
   */
  router.get('/queue', requireAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as AuthedRequest).session
      const companyId = req.query.companyId as string
      if (!companyId) {
        return res.status(400).json({ error: 'companyId required' })
      }

      const company = await prisma.company.findFirst({ where: { id: companyId, userId } })
      if (!company) {
        return res.status(403).json({ error: 'Company not found' })
      }

      const tasks = await prisma.task.findMany({
        where: {
          companyId,
          type: { in: ['hooks', 'script', 'video', 'caption'] },
          status: { in: ['delivered', 'in_progress', 'pending'] },
        },
        include: {
          outputs: { take: 1 },
        },
        orderBy: { createdAt: 'asc' },
        take: 15,
      })

      const queuedPosts = tasks.map(task => ({
        id: task.id,
        title: task.title,
        type: task.type,
        status: task.status,
        createdAt: task.createdAt,
        output: task.outputs[0] ? task.outputs[0].content : null,
      }))

      res.json({ queue: queuedPosts, total: queuedPosts.length })
    } catch (err) {
      console.error('[briefs] queue status error:', err)
      res.status(500).json({ error: 'Failed to fetch queue status' })
    }
  })

  // ── Real-time Anomalies ────────────────────────────────────────────────────

  /**
   * GET /api/briefs/anomalies
   * Detect real-time anomalies (surges, underperformance)
   */
  router.get('/anomalies', requireAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as AuthedRequest).session
      const companyId = req.query.companyId as string
      if (!companyId) {
        return res.status(400).json({ error: 'companyId required' })
      }

      const company = await prisma.company.findFirst({ where: { id: companyId, userId } })
      if (!company) {
        return res.status(403).json({ error: 'Company not found' })
      }

      const anomalies = await detectAnomalies(prisma, companyId)
      res.json({ anomalies })
    } catch (err) {
      console.error('[briefs] anomalies error:', err)
      res.status(500).json({ error: 'Failed to detect anomalies' })
    }
  })

  // ── Post Now (Immediate) ───────────────────────────────────────────────────

  /**
   * POST /api/briefs/queue/:taskId/post-now
   * Immediately post queued content to platform
   */
  router.post('/queue/:taskId/post-now', requireAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as AuthedRequest).session
      const { taskId } = req.params
      const companyId = req.query.companyId as string
      if (!companyId) {
        return res.status(400).json({ error: 'companyId required' })
      }

      const company = await prisma.company.findFirst({ where: { id: companyId, userId } })
      if (!company) {
        return res.status(403).json({ error: 'Company not found' })
      }

      // Fetch task
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: { company: true, outputs: { take: 1 } },
      })

      if (!task || task.companyId !== companyId) {
        return res.status(404).json({ error: 'Task not found' })
      }

      if (!task.outputs[0]) {
        return res.status(400).json({ error: 'No output ready to post' })
      }

      // TODO: Integrate with platform posting service
      // For now, just mark as "posted" in task
      await prisma.task.update({
        where: { id: taskId },
        data: { status: 'approved' }, // Mark as approved/posted
      })

      res.json({ success: true, message: 'Post scheduled for posting', taskId })
    } catch (err) {
      console.error('[briefs] post-now error:', err)
      res.status(500).json({ error: 'Failed to post content' })
    }
  })

  // ── Approve Trend Pivot ────────────────────────────────────────────────────

  /**
   * POST /api/briefs/approve-trend
   * User approves an emerging trend opportunity
   * Creates task for Jordan to brief Alex on new trend
   */
  router.post('/approve-trend', requireAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as AuthedRequest).session
      const { trend, reason } = req.body
      const companyId = req.query.companyId as string

      if (!companyId || !trend) {
        return res.status(400).json({ error: 'companyId and trend required' })
      }

      const company = await prisma.company.findFirst({ where: { id: companyId, userId } })
      if (!company) {
        return res.status(403).json({ error: 'Company not found' })
      }

      // Create a task for Jordan (strategist)
      const jordanEmployee = await prisma.employee.findUnique({
        where: { companyId_role: { companyId, role: 'strategist' } },
      })

      if (!jordanEmployee) {
        return res.status(400).json({ error: 'No strategist employee found' })
      }

      const task = await prisma.task.create({
        data: {
          companyId,
          employeeId: jordanEmployee.id,
          title: `Brief on emerging trend: ${trend}`,
          description: `User approved this emerging trend: "${trend}". ${reason || ''}. Brief Alex on content opportunity.`,
          type: 'trend_hooks',
          status: 'pending',
        },
      })

      // TODO: Trigger Jordan's briefing task automatically
      // await orchestrateTask(prisma, task.id)

      res.json({ success: true, taskId: task.id, message: `Jordan briefed on trend: ${trend}` })
    } catch (err) {
      console.error('[briefs] approve-trend error:', err)
      res.status(500).json({ error: 'Failed to approve trend' })
    }
  })

  return router
}

export default router
