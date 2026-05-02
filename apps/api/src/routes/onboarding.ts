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

const EMPLOYEE_SEED: Array<{ role: EmployeeRole; name: string }> = [
  { role: 'analyst', name: 'Maya' },
  { role: 'strategist', name: 'Jordan' },
  { role: 'copywriter', name: 'Alex' },
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
        body: 'Jordan, Maya, Alex, and Riley are active. Three deliveries are already waiting on you.',
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

export default router
