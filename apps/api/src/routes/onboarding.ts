import { Router } from 'express'
import { EmployeeRole } from '@prisma/client'
import prisma from '../lib/prisma'
import { z } from 'zod'
import { requireAuth, AuthedRequest, createSession, readSession } from '../middleware/auth'
import { readPendingSignup, clearPendingSignup } from './auth'
import { seedStarterTasks } from '../lib/seedStarterTasks'
import { createNotification } from '../services/notifications/notification.service'
import {
  containsBlockedLanguage,
  DISALLOWED_LANGUAGE_MESSAGE,
} from '../lib/badLanguage'

const router = Router()

// Three-employee team: Alex (copywriter) was retired. New companies seed
// Maya / Jordan / Riley only. Existing companies that already have an Alex
// row are unaffected — the enum value still exists in the schema for
// backward compat, we just don't create new ones.
const EMPLOYEE_SEED: Array<{ role: EmployeeRole; name: string }> = [
  { role: 'analyst', name: 'Maya' },
  { role: 'strategist', name: 'Jordan' },
  { role: 'creative_director', name: 'Riley' },
]

const companySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    niche: z.string().trim().min(1).max(2000),
    subNiche: z.string().max(200).optional(),
    brandVoice: z.record(z.any()).optional(),
    audience: z.record(z.any()).optional(),
    goals: z.record(z.any()).optional(),
    agentTools: z.record(z.any()).optional(),
  })
  .superRefine((data, ctx) => {
    if (containsBlockedLanguage(data.name)) {
      ctx.addIssue({
        code: 'custom',
        message: DISALLOWED_LANGUAGE_MESSAGE,
        path: ['name'],
      })
    }
    if (containsBlockedLanguage(data.niche)) {
      ctx.addIssue({
        code: 'custom',
        message: DISALLOWED_LANGUAGE_MESSAGE,
        path: ['niche'],
      })
    }
  })

router.post('/company', async (req, res, next) => {
  try {
    const data = companySchema.parse(req.body)

    // Resolve userId: existing session (returning user adding a company) takes
    // priority; otherwise consume the pending signup cookie set by /signup.
    let userId: string
    let newUser: { id: string; email: string; username: string | null; fullName: string | null } | null = null

    const session = await readSession(req)

    if (session) {
      userId = session.userId
    } else {
      const pending = await readPendingSignup(req)
      if (!pending) {
        res.status(401).json({ error: 'unauthorized' })
        return
      }
      // Create user + company atomically — no orphan row if this fails.
      const created = await prisma.user.create({
        data: {
          email: pending.email,
          username: pending.username,
          passwordHash: pending.passwordHash,
          fullName: pending.fullName ?? null,
        },
        select: { id: true, email: true, username: true, fullName: true },
      })
      newUser = created
      userId = created.id
      clearPendingSignup(res)
      await createSession(res, { userId, email: created.email })
    }

    const company = await prisma.company.create({
      data: {
        userId,
        name: data.name,
        niche: data.niche,
        subNiche: data.subNiche,
        brandVoice: data.brandVoice ?? {},
        audience: data.audience ?? {},
        goals: data.goals ?? {},
        agentTools: data.agentTools ?? {},
        employees: {
          create: EMPLOYEE_SEED.map((e) => ({ role: e.role, name: e.name })),
        },
      },
      include: { employees: true },
    })

    await seedStarterTasks(prisma, { companyId: company.id, niche: company.niche })

    try {
      await createNotification({
        userId,
        companyId: company.id,
        type: 'team_update',
        emoji: '👋',
        title: `${company.name} — your team is assembled`,
        body: 'Maya, Jordan, and Riley are active. Three deliveries are already waiting on you.',
      })
    } catch (e) {
      console.warn('[onboarding] welcome notification failed', e)
    }

    try {
      const { triggerWelcomeEmail } = await import('../lib/emailTriggers')
      triggerWelcomeEmail(userId)
    } catch {}

    res.status(201).json({ company, ...(newUser ? { user: newUser } : {}) })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'invalid_input', issues: err.issues })
      return
    }
    next(err)
  }
})

// ── First-connect bootstrap status ──────────────────────────────────
// Returns whether Maya / Jordan / backfill have finished running for the
// user's first company. Frontend polls this on dashboard mount so it can
// show a "preparing your dashboard" loader instead of empty cards while
// Bedrock is busy, and a real failure banner if any step errored.
router.get('/bootstrap-status', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const company = await prisma.company.findFirst({
      where: { userId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    })
    if (!company) {
      res.json({ status: 'pending', steps: { backfill: 'pending', maya: 'pending', goal: 'pending' }, postCount: null, startedAt: null, finishedAt: null, error: null })
      return
    }
    const { getBootstrapState } = await import('../lib/firstConnectBootstrap')
    const state = await getBootstrapState(company.id)
    res.json(state)
  } catch (err) {
    next(err)
  }
})

export default router
