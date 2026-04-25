import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { createSession, clearSession, readSession } from '../middleware/auth'
import { trialEnd } from '../lib/plans'
import { rolloverTrialIfDue } from '../lib/usage'

import prisma from '../lib/prisma'
const router = Router()

const signupSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  username: z.string()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username must be under 30 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(200)
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  fullName: z.string().min(1, 'Name is required').max(120).optional(),
})

const loginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
})

router.post('/signup', async (req, res, next) => {
  try {
    const data = signupSchema.parse(req.body)
    // Check email and username separately for specific error messages
    const existingEmail = await prisma.user.findFirst({ where: { email: data.email } })
    if (existingEmail) {
      res.status(409).json({ error: 'email_taken', message: 'An account with this email already exists.' })
      return
    }
    const existingUsername = await prisma.user.findFirst({ where: { username: data.username } })
    if (existingUsername) {
      res.status(409).json({ error: 'username_taken', message: 'This username is already taken.' })
      return
    }
    const passwordHash = await bcrypt.hash(data.password, 10)
    const user = await prisma.user.create({
      data: {
        email: data.email,
        username: data.username,
        passwordHash,
        fullName: data.fullName,
        trialEndsAt: trialEnd(),
      },
      select: { id: true, email: true, username: true, fullName: true },
    })
    await createSession(res, { userId: user.id, email: user.email })
    res.status(201).json({ user })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'invalid_input', issues: err.issues })
      return
    }
    next(err)
  }
})

router.post('/login', async (req, res, next) => {
  try {
    const data = loginSchema.parse(req.body)
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: data.identifier }, { username: data.identifier }] },
    })
    if (!user?.passwordHash) {
      res.status(401).json({ error: 'invalid_credentials' })
      return
    }
    const ok = await bcrypt.compare(data.password, user.passwordHash)
    if (!ok) {
      res.status(401).json({ error: 'invalid_credentials' })
      return
    }
    await createSession(res, { userId: user.id, email: user.email })
    res.json({
      user: { id: user.id, email: user.email, username: user.username, fullName: user.fullName },
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'invalid_input', issues: err.issues })
      return
    }
    next(err)
  }
})

router.post('/logout', (_req, res) => {
  clearSession(res)
  res.json({ ok: true })
})

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
})

router.post('/change-password', async (req, res, next) => {
  try {
    const session = await readSession(req)
    if (!session) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }
    const data = changePasswordSchema.parse(req.body)
    const user = await prisma.user.findUnique({ where: { id: session.userId } })
    if (!user || !user.passwordHash) {
      res.status(404).json({ error: 'user_not_found' })
      return
    }
    const ok = await bcrypt.compare(data.currentPassword, user.passwordHash)
    if (!ok) {
      res.status(403).json({ error: 'wrong_current_password' })
      return
    }
    const passwordHash = await bcrypt.hash(data.newPassword, 10)
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } })
    res.json({ ok: true })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'invalid_input', issues: err.issues })
      return
    }
    next(err)
  }
})

// ─── /me cache: avoid redundant DB queries on rapid page loads ───────────────
const meCache = new Map<string, { data: unknown; ts: number }>()
const ME_CACHE_TTL = 30_000 // 30 seconds

router.get('/me', async (req, res, next) => {
  try {
    const session = await readSession(req)
    if (!session) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }

    // Check cache
    const cached = meCache.get(session.userId)
    if (cached && Date.now() - cached.ts < ME_CACHE_TTL) {
      res.json(cached.data)
      return
    }

    // Auto-transition expired trials to active before reading the user row.
    await rolloverTrialIfDue(prisma, session.userId)
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      include: {
        companies: {
          include: {
            employees: true,
            instagram: true,
          },
        },
      },
    })
    if (!user) {
      clearSession(res)
      res.status(401).json({ error: 'unauthorized' })
      return
    }
    const result = {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        fullName: user.fullName,
        plan: user.plan,
        subscriptionStatus: user.subscriptionStatus,
        trialEndsAt: user.trialEndsAt,
      },
      companies: user.companies,
    }
    meCache.set(session.userId, { data: result, ts: Date.now() })
    res.json(result)
  } catch (err) {
    next(err)
  }
})

export default router
