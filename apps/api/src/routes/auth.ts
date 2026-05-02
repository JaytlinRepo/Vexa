import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { z } from 'zod'
import { SignJWT, jwtVerify } from 'jose'
import { createSession, clearSession, readSession } from '../middleware/auth'
import { sendPasswordResetEmail } from '../services/email/email.service'
import prisma from '../lib/prisma'
import {
  containsBlockedLanguage,
  DISALLOWED_LANGUAGE_MESSAGE,
} from '../lib/badLanguage'
import {
  EMAIL_DOMAIN_REJECT_MESSAGE,
  isRejectedMailboxEmail,
} from '../lib/emailMailbox'

// Anti-abuse / quotas follow-up — see ../../../../memory.md (Auth / quotas — anti-abuse hardening).
const router = Router()

const PENDING_COOKIE = 'vx_pending_signup'
const PENDING_TTL_SECONDS = 3600 // 1 hour

function pendingSecret(): Uint8Array {
  const raw = process.env.SESSION_SECRET
  if (!raw) throw new Error('SESSION_SECRET is not set')
  return new TextEncoder().encode(raw + ':pending')
}

export interface PendingSignupData {
  email: string
  username: string
  passwordHash: string
  fullName?: string
  companyName?: string
  niche?: string
}

export async function writePendingSignup(
  res: import('express').Response,
  data: PendingSignupData
): Promise<void> {
  const token = await new SignJWT(data as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${PENDING_TTL_SECONDS}s`)
    .sign(pendingSecret())
  res.cookie(PENDING_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: PENDING_TTL_SECONDS * 1000,
    path: '/',
  })
}

export async function readPendingSignup(
  req: import('express').Request
): Promise<PendingSignupData | null> {
  const token = req.cookies?.[PENDING_COOKIE]
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, pendingSecret())
    return payload as unknown as PendingSignupData
  } catch {
    return null
  }
}

export function clearPendingSignup(res: import('express').Response): void {
  res.clearCookie(PENDING_COOKIE, { path: '/' })
}

/** Kept in sync with signup field hints in apps/web/public/auth-ui.js */
const signupSchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email('Enter a valid email address')
      .refine((e) => !isRejectedMailboxEmail(e), EMAIL_DOMAIN_REJECT_MESSAGE),
    username: z
      .string()
      .trim()
      .min(3, 'Username must be at least 3 characters')
      .max(30, 'Username must be under 30 characters')
      .regex(
        /^[a-zA-Z0-9_]+$/,
        'Username can only contain letters, numbers, and underscores'
      ),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(200, 'Password must be under 200 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[0-9]/, 'Password must contain at least one number'),
    /** Omit or leave blank until we require it in the modal; blanks fail min(1) if sent as "". */
    fullName: z.string().trim().min(1).max(120).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.fullName && containsBlockedLanguage(data.fullName)) {
      ctx.addIssue({
        code: 'custom',
        message: DISALLOWED_LANGUAGE_MESSAGE,
        path: ['fullName'],
      })
    }
    if (containsBlockedLanguage(data.username)) {
      ctx.addIssue({
        code: 'custom',
        message: DISALLOWED_LANGUAGE_MESSAGE,
        path: ['username'],
      })
    }
  })

const loginSchema = z.object({
  identifier: z.string().trim().min(1),
  password: z.string().min(1),
})

const pendingCompanySchema = z
  .object({
    companyName: z.string().trim().min(1, 'Company name is required').max(120),
    niche: z.string().trim().min(1, 'Add at least one content tag').max(2000),
  })
  .superRefine((data, ctx) => {
    if (containsBlockedLanguage(data.companyName)) {
      ctx.addIssue({
        code: 'custom',
        message: DISALLOWED_LANGUAGE_MESSAGE,
        path: ['companyName'],
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

router.post('/signup', async (req, res, next) => {
  try {
    const data = signupSchema.parse(req.body)
    const existingEmail = await prisma.user.findFirst({
      where: { email: { equals: data.email, mode: 'insensitive' } },
    })
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
    // Do NOT create the user yet — store pending data in a short-lived signed
    // cookie. The user+company row is created atomically with the first
    // platform connection so abandoned signups leave no orphan rows.
    await writePendingSignup(res, {
      email: data.email,
      username: data.username,
      passwordHash,
      ...(data.fullName !== undefined ? { fullName: data.fullName } : {}),
    })
    res.status(200).json({ status: 'pending' })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'invalid_input', issues: err.issues })
      return
    }
    next(err)
  }
})

// Stores company name + niche into the pending signup cookie so the OAuth
// callback can create user + company + connection all in one transaction.
router.patch('/pending-company', async (req, res, next) => {
  try {
    const pending = await readPendingSignup(req)
    if (!pending) {
      res.status(401).json({ error: 'no_pending_signup' })
      return
    }
    const { companyName, niche } = pendingCompanySchema.parse(req.body)
    await writePendingSignup(res, { ...pending, companyName, niche })
    res.json({ status: 'ok' })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'invalid_input', issues: err.issues })
      return
    }
    next(err)
  }
})

// Pre-computed bcrypt hash of the string "dummy". Used as a constant-time
// stand-in when the user isn't found so response timing doesn't leak
// whether an email/username is registered.
const DUMMY_HASH = '$2a$10$dummyhashfortimingneutrality000000000000000000000000000'

router.post('/login', async (req, res, next) => {
  try {
    const data = loginSchema.parse(req.body)
    const idRaw = data.identifier
    const user = await prisma.user.findFirst({
      where: idRaw.includes('@')
        ? { email: { equals: idRaw, mode: 'insensitive' } }
        : { username: idRaw },
    })
    // Always run bcrypt — even when user not found — so response time is
    // identical whether the account exists or not. Early return would leak
    // user existence via timing.
    const ok = await bcrypt.compare(data.password, user?.passwordHash ?? DUMMY_HASH)
    if (!ok || !user) {
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
  newPassword: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(200)
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
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

// Mirror of admin.ts ADMIN_EMAILS — read once at module load. The list is
// short and changes only on env update, so duplicating the parse is fine.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

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
        isAdmin: ADMIN_EMAILS.includes((user.email || '').toLowerCase()),
      },
      companies: user.companies,
    }
    meCache.set(session.userId, { data: result, ts: Date.now() })
    res.json(result)
  } catch (err) {
    next(err)
  }
})

// ─── POST /forgot-password ────────────────────────────────────────────────────
// Always returns 200 — never reveal whether the email exists.

router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = z
      .object({
        email: z
          .string()
          .trim()
          .toLowerCase()
          .email('Enter a valid email address')
          .refine((e) => !isRejectedMailboxEmail(e), EMAIL_DOMAIN_REJECT_MESSAGE),
      })
      .parse(req.body)

    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    })
    if (user) {
      // Invalidate any existing unused tokens for this user
      await prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      })

      const token = randomBytes(32).toString('hex')
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000) // 15 min

      await prisma.passwordResetToken.create({
        data: { id: randomBytes(16).toString('hex'), userId: user.id, token, expiresAt },
      })

      const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.sovexa.ai'
      const resetUrl = `${BASE_URL}/reset-password?token=${token}`

      sendPasswordResetEmail({
        to: user.email!,
        firstName: user.fullName?.split(' ')[0] || user.username || 'there',
        resetUrl,
      }).catch((err) => console.warn('[auth] reset email failed:', (err as Error).message))
    }

    // Return 200 regardless so enumeration isn't possible
    res.json({ ok: true })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'invalid_input', issues: err.issues })
      return
    }
    next(err)
  }
})

// ─── POST /reset-password ─────────────────────────────────────────────────────

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(200)
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
})

router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, password } = resetPasswordSchema.parse(req.body)

    const record = await prisma.passwordResetToken.findUnique({ where: { token } })

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      res.status(400).json({ error: 'invalid_or_expired_token', message: 'This reset link is invalid or has expired.' })
      return
    }

    const passwordHash = await bcrypt.hash(password, 10)

    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      prisma.passwordResetToken.update({ where: { token }, data: { usedAt: new Date() } }),
    ])

    // Invalidate the /me cache for this user
    meCache.delete(record.userId)

    res.json({ ok: true })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'invalid_input', issues: err.issues })
      return
    }
    next(err)
  }
})

export default router
