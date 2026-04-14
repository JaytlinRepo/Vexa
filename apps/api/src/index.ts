import 'dotenv/config'
import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import {
  registerSSEClient,
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
} from './services/notifications/notification.service'
import { requireAuth, AuthedRequest } from './middleware/auth'
import authRouter from './routes/auth'
import onboardingRouter from './routes/onboarding'
import instagramRouter from './routes/instagram'
import meetingRouter from './routes/meeting'
import tasksRouter from './routes/tasks'
import { getMode } from './lib/mode'
import feedRouter from './routes/feed'
import companyRouter from './routes/company'
import outputsRouter from './routes/outputs'
import usageRouter from './routes/usage'
import memoryRouter from './routes/memory'
import phylloRouter from './routes/phyllo'
import platformDataRouter from './routes/platformData'
import { registerScheduledJobs } from './scheduler'
import { PrismaClient } from '@prisma/client'

if (!process.env.SESSION_SECRET) {
  console.warn('[api] SESSION_SECRET is unset — falling back to a dev-only value. Do NOT ship like this.')
  process.env.SESSION_SECRET = 'dev-only-insecure-secret-change-me'
}

const app = express()
const PORT = Number(process.env.PORT ?? 4000)

// CORS — accept any origin in CORS_ORIGINS (comma-separated), plus the
// legacy single-origin NEXT_PUBLIC_APP_URL. Also auto-allows Vercel
// preview deployments (*.vercel.app) so PR previews work without
// reconfig. Localhost stays open for dev.
const allowedOrigins = (process.env.CORS_ORIGINS ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
app.use(
  cors({
    origin: (origin, cb) => {
      // Same-origin / curl / server-to-server requests have no Origin header
      if (!origin) return cb(null, true)
      if (allowedOrigins.includes(origin)) return cb(null, true)
      // Allow any Vercel preview / production subdomain
      try {
        const host = new URL(origin).hostname
        if (host.endsWith('.vercel.app')) return cb(null, true)
        if (host === 'localhost' || host === '127.0.0.1') return cb(null, true)
      } catch { /* fallthrough */ }
      cb(new Error(`Origin ${origin} not allowed by CORS`))
    },
    credentials: true,
  }),
)
app.use(express.json({ limit: '2mb' }))
app.use(cookieParser())

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'vexa-api', mode: getMode(), ts: new Date().toISOString() })
})

app.get('/api/mode', (_req, res) => {
  res.json({ mode: getMode() })
})

app.use('/api/auth', authRouter)
app.use('/api/onboarding', onboardingRouter)
app.use('/api/instagram', instagramRouter)
app.use('/api/meeting', meetingRouter)
app.use('/api/tasks', tasksRouter)
app.use('/api/feed', feedRouter)
app.use('/api/company', companyRouter)
app.use('/api/outputs', outputsRouter)
app.use('/api/usage', usageRouter)
app.use('/api/memory', memoryRouter)
app.use('/api/phyllo', phylloRouter)
app.use('/api/platform', platformDataRouter)

app.get('/api/notifications/stream', requireAuth, (req, res) => {
  const { userId } = (req as AuthedRequest).session
  registerSSEClient(userId, res)
})

app.get('/api/notifications', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const [items, unread] = await Promise.all([getNotifications(userId), getUnreadCount(userId)])
    res.json({ items, unread })
  } catch (err) {
    next(err)
  }
})

app.post('/api/notifications/:id/read', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    await markAsRead(req.params.id, userId)
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

app.post('/api/notifications/read-all', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    await markAllAsRead(userId)
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[api]', err)
  res.status(500).json({ error: 'internal_error', message: err.message })
})

app.listen(PORT, () => {
  console.log(`[api] listening on http://localhost:${PORT}`)
  registerScheduledJobs(new PrismaClient())
})
