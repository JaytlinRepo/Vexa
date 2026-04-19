import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { createSession, clearSession, readSession } from '../middleware/auth'
import { trialEnd } from '../lib/plans'
import { rolloverTrialIfDue } from '../lib/usage'

import prisma from '../lib/prisma'
const router = Router()

const signupSchema = z.object({
  email: z.string().email(),
  username: z.string().min(2).max(40),
  password: z.string().min(8).max(200),
  fullName: z.string().max(120).optional(),
})

const loginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
})

router.post('/signup', async (req, res, next) => {
  try {
    const data = signupSchema.parse(req.body)
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: data.email }, { username: data.username }] },
    })
    if (existing) {
      res.status(409).json({ error: 'email_or_username_in_use' })
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

router.get('/me', async (req, res, next) => {
  try {
    const session = await readSession(req)
    if (!session) {
      res.status(401).json({ error: 'unauthorized' })
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
    res.json({
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
    })
  } catch (err) {
    next(err)
  }
})

export default router
