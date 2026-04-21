/**
 * Weekly Routes
 *
 * GET /api/weekly/data           — Get weekly metrics + aggregations
 * GET /api/weekly/maya-pulse     — Get Maya's weekly pulse task
 * GET /api/weekly/jordan-plan    — Get Jordan's weekly plan task
 * GET /api/weekly/alex-hooks     — Get Alex's weekly hooks task
 * GET /api/weekly/riley-briefs   — Get Riley's weekly briefs task
 */

import { Router, Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import { getWeeklyData } from '../lib/dailyBrief.service'

const router = Router()
let prisma: PrismaClient

export function initWeeklyRoutes(_prisma: PrismaClient) {
  prisma = _prisma

  // ── Weekly Data ────────────────────────────────────────────────────────────

  /**
   * GET /api/weekly/data
   * Get aggregated weekly metrics (formats, cohorts, timing, etc.)
   * This is what agents read to make decisions.
   */
  router.get('/data', requireAuth, async (req: Request, res: Response) => {
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
      if (!companyId) {
        return res.status(401).json({ error: 'Not authenticated' })
      }

      const weeklyData = await getWeeklyData(prisma, companyId)
      res.json(weeklyData)
    } catch (err) {
      console.error('[weekly] data error:', err)
      res.status(500).json({ error: 'Failed to fetch weekly data' })
    }
  })

  // ── Maya's Weekly Pulse ────────────────────────────────────────────────────

  /**
   * GET /api/weekly/maya-pulse
   * Get Maya's weekly pulse task (learnings + recommendations)
   */
  router.get('/maya-pulse', requireAuth, async (req: Request, res: Response) => {
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
      if (!companyId) {
        return res.status(401).json({ error: 'Not authenticated' })
      }

      const task = await prisma.task.findFirst({
        where: {
          companyId,
          type: 'weekly_pulse',
        },
        orderBy: { createdAt: 'desc' },
        include: {
          outputs: { take: 1 },
          employee: true,
        },
      })

      if (!task) {
        return res.status(404).json({ error: 'No weekly pulse yet' })
      }

      res.json({
        taskId: task.id,
        status: task.status,
        createdAt: task.createdAt,
        employee: task.employee.name,
        output: task.outputs[0]?.content || null,
      })
    } catch (err) {
      console.error('[weekly] maya-pulse error:', err)
      res.status(500).json({ error: 'Failed to fetch Maya\'s weekly pulse' })
    }
  })

  // ── Jordan's Weekly Plan ───────────────────────────────────────────────────

  /**
   * GET /api/weekly/jordan-plan
   * Get Jordan's weekly content plan
   */
  router.get('/jordan-plan', requireAuth, async (req: Request, res: Response) => {
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
      if (!companyId) {
        return res.status(401).json({ error: 'Not authenticated' })
      }

      const task = await prisma.task.findFirst({
        where: {
          companyId,
          type: 'content_plan',
        },
        orderBy: { createdAt: 'desc' },
        include: {
          outputs: { take: 1 },
          employee: true,
        },
      })

      if (!task) {
        return res.status(404).json({ error: 'No weekly plan yet' })
      }

      res.json({
        taskId: task.id,
        status: task.status,
        createdAt: task.createdAt,
        employee: task.employee.name,
        output: task.outputs[0]?.content || null,
      })
    } catch (err) {
      console.error('[weekly] jordan-plan error:', err)
      res.status(500).json({ error: 'Failed to fetch Jordan\'s weekly plan' })
    }
  })

  // ── Alex's Weekly Hooks ────────────────────────────────────────────────────

  /**
   * GET /api/weekly/alex-hooks
   * Get Alex's weekly hooks (3 per day for the week)
   */
  router.get('/alex-hooks', requireAuth, async (req: Request, res: Response) => {
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
      if (!companyId) {
        return res.status(401).json({ error: 'Not authenticated' })
      }

      const task = await prisma.task.findFirst({
        where: {
          companyId,
          type: 'hooks',
        },
        orderBy: { createdAt: 'desc' },
        include: {
          outputs: { take: 1 },
          employee: true,
        },
      })

      if (!task) {
        return res.status(404).json({ error: 'No weekly hooks yet' })
      }

      res.json({
        taskId: task.id,
        status: task.status,
        createdAt: task.createdAt,
        employee: task.employee.name,
        output: task.outputs[0]?.content || null,
      })
    } catch (err) {
      console.error('[weekly] alex-hooks error:', err)
      res.status(500).json({ error: 'Failed to fetch Alex\'s weekly hooks' })
    }
  })

  // ── Riley's Weekly Production Briefs ───────────────────────────────────────

  /**
   * GET /api/weekly/riley-briefs
   * Get Riley's weekly production direction
   */
  router.get('/riley-briefs', requireAuth, async (req: Request, res: Response) => {
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
      if (!companyId) {
        return res.status(401).json({ error: 'Not authenticated' })
      }

      const task = await prisma.task.findFirst({
        where: {
          companyId,
          type: 'shot_list',
        },
        orderBy: { createdAt: 'desc' },
        include: {
          outputs: { take: 1 },
          employee: true,
        },
      })

      if (!task) {
        return res.status(404).json({ error: 'No weekly briefs yet' })
      }

      res.json({
        taskId: task.id,
        status: task.status,
        createdAt: task.createdAt,
        employee: task.employee.name,
        output: task.outputs[0]?.content || null,
      })
    } catch (err) {
      console.error('[weekly] riley-briefs error:', err)
      res.status(500).json({ error: 'Failed to fetch Riley\'s weekly briefs' })
    }
  })

  // ── Approve/Reject Weekly Plan ─────────────────────────────────────────────

  /**
   * POST /api/weekly/plan/approve
   * Approve the weekly plan (auto-trigger Alex/Riley tasks)
   */
  router.post('/plan/approve', requireAuth, async (req: Request, res: Response) => {
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
      if (!companyId) {
        return res.status(401).json({ error: 'Not authenticated' })
      }

      // Find the latest content_plan task
      const planTask = await prisma.task.findFirst({
        where: { companyId, type: 'content_plan' },
        orderBy: { createdAt: 'desc' },
      })

      if (!planTask) {
        return res.status(404).json({ error: 'No weekly plan found' })
      }

      // Mark as approved
      await prisma.task.update({
        where: { id: planTask.id },
        data: { status: 'approved' },
      })

      // TODO: Auto-trigger Alex and Riley tasks since plan was approved
      // The auto-chain should handle this, but if not, manually trigger:
      // await triggerWeeklyAlexHooks(prisma, companyId)
      // await triggerWeeklyRileyBriefs(prisma, companyId)

      res.json({ success: true, message: 'Weekly plan approved. Alex and Riley are next.' })
    } catch (err) {
      console.error('[weekly] plan/approve error:', err)
      res.status(500).json({ error: 'Failed to approve plan' })
    }
  })

  /**
   * POST /api/weekly/plan/reject
   * Reject the weekly plan (Jordan generates new one)
   */
  router.post('/plan/reject', requireAuth, async (req: Request, res: Response) => {
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
      const { reason } = req.body

      if (!companyId) {
        return res.status(401).json({ error: 'Not authenticated' })
      }

      // Find latest plan
      const planTask = await prisma.task.findFirst({
        where: { companyId, type: 'content_plan' },
        orderBy: { createdAt: 'desc' },
      })

      if (!planTask) {
        return res.status(404).json({ error: 'No weekly plan found' })
      }

      // Mark as rejected
      await prisma.task.update({
        where: { id: planTask.id },
        data: { status: 'rejected' },
      })

      // Create new task for Jordan to rethink
      const jordanEmployee = await prisma.employee.findUnique({
        where: { companyId_role: { companyId, role: 'strategist' } },
      })

      if (jordanEmployee) {
        await prisma.task.create({
          data: {
            companyId,
            employeeId: jordanEmployee.id,
            title: 'Rethink weekly plan',
            description: `User rejected the plan. Reason: ${reason || 'No specific reason'}. Generate a new plan.`,
            type: 'plan_adjustment',
            status: 'pending',
          },
        })
      }

      res.json({ success: true, message: 'Plan rejected. Jordan is rethinking it.' })
    } catch (err) {
      console.error('[weekly] plan/reject error:', err)
      res.status(500).json({ error: 'Failed to reject plan' })
    }
  })

  return router
}

export default router
