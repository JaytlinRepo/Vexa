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
import employeesRouter from './routes/employees'
import { getMode } from './lib/mode'
import feedRouter from './routes/feed'
import companyRouter from './routes/company'
import outputsRouter from './routes/outputs'
import usageRouter from './routes/usage'
import memoryRouter from './routes/memory'
import knowledgeRouter from './routes/knowledge'
import knowledgeAdminRouter from './routes/knowledge-admin'
import platformDataRouter from './routes/platformData'
import contactRouter from './routes/contact'
import tiktokRouter from './routes/tiktok'
import uploadsRouter from './routes/uploads'
import stripeRouter from './routes/stripe'
import adminRouter from './routes/admin'
import waitlistRouter from './routes/waitlist'
import { initBriefRoutes } from './routes/briefs'
import { initWeeklyRoutes } from './routes/weekly'
import { initVideoRoutes } from './routes/video'
import { initStudioRoutes } from './routes/studio'
import { registerScheduledJobs } from './scheduler'
import prisma from './lib/prisma'
import { apiLimiter, authLimiter, agentLimiter } from './middleware/rateLimiter'

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
      // Allow Amplify previews, sovexa.ai subdomains, and localhost
      try {
        const host = new URL(origin).hostname
        if (host.endsWith('.amplifyapp.com')) return cb(null, true)
        if (host.endsWith('.sovexa.ai') || host === 'sovexa.ai') return cb(null, true)
        if (host === 'localhost' || host === '127.0.0.1') return cb(null, true)
      } catch { /* fallthrough */ }
      cb(new Error(`Origin ${origin} not allowed by CORS`))
    },
    credentials: true,
  }),
)
// Stripe webhook needs raw body — must be before json parser
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }))
app.use(express.json({ limit: '2mb' }))
app.use(cookieParser())

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'vexa-api', mode: getMode(), ts: new Date().toISOString() })
})

// TikTok URL-prefix verification. TikTok hands out a token file (e.g.
// tiktokWwYdOs...txt) that must be reachable at the root of the domain
// we claim as a redirect URI. Content is a single-line key=value string.
app.get('/tiktokWwYdOsLEOC046Qb2SzdF0zIXg6GIQrVK.txt', (_req, res) => {
  res.type('text/plain').send('tiktok-developers-site-verification=WwYdOsLEOC046Qb2SzdF0zIXg6GIQrVK')
})

app.get('/api/mode', (_req, res) => {
  res.json({ mode: getMode() })
})

// Rate limiting — applied per-user (session) or per-IP (unauthenticated)
app.use('/api/auth', authLimiter)
app.use('/api/tasks', agentLimiter)
app.use('/api/meeting', agentLimiter)
app.use('/api/', apiLimiter)

app.use('/api/auth', authRouter)
app.use('/api/onboarding', onboardingRouter)
app.use('/api/instagram', instagramRouter)
app.use('/api/meeting', meetingRouter)
app.use('/api/tasks', tasksRouter)
app.use('/api/employees', employeesRouter)
app.use('/api/feed', feedRouter)
app.use('/api/company', companyRouter)
app.use('/api/outputs', outputsRouter)
app.use('/api/usage', usageRouter)
app.use('/api/memory', memoryRouter)
app.use('/api/knowledge', knowledgeRouter)
app.use('/api/knowledge-admin', knowledgeAdminRouter)
app.use('/api/platform', platformDataRouter)
app.use('/api/contact', contactRouter)
app.use('/api/tiktok', tiktokRouter)
app.use('/api/uploads', uploadsRouter)
app.use('/api/stripe', stripeRouter)
app.use('/api/admin', adminRouter)
app.use('/api/waitlist', waitlistRouter)
app.use('/api/briefs', initBriefRoutes(prisma))
app.use('/api/weekly', initWeeklyRoutes(prisma))
app.use('/api/video', initVideoRoutes(prisma))
app.use('/api/studio', initStudioRoutes(prisma))

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
  console.error('[api] request error:', err.message, err.stack?.split('\n').slice(0, 3).join(' '))
  if (res.headersSent) return
  res.status(500).json({ error: 'internal_error', message: err.message })
})

// Process-level error isolation — log and survive, never crash the whole server
process.on('unhandledRejection', (reason) => {
  console.error('[api] unhandled rejection:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[api] uncaught exception:', err.message, err.stack?.split('\n').slice(0, 5).join(' '))
  // Don't exit — App Runner will restart us, but we lose all in-flight requests.
  // Only exit on truly fatal errors (OOM will kill us anyway).
})

app.listen(PORT, () => {
  const mode = getMode()
  const bedrockOn = !!(process.env.AWS_REGION && process.env.AWS_ACCESS_KEY_ID)
  const stripeOn = !!process.env.STRIPE_SECRET_KEY
  console.log(`[api] listening on :${PORT}`)
  console.log(`[api] ╔════════════════════════════════════════════════════════════╗`)
  console.log(`[api] ║ MODE: ${String(mode).toUpperCase().padEnd(54)} ║`)
  console.log(`[api] ║ Bedrock: ${(bedrockOn ? 'enabled' : 'disabled (mocks only)').padEnd(51)} ║`)
  console.log(`[api] ║ Stripe:  ${(stripeOn ? 'enabled' : 'disabled').padEnd(51)} ║`)
  console.log(`[api] ╚════════════════════════════════════════════════════════════╝`)
  if (mode === 'test') {
    console.log(`[api] TEST MODE — this is the preview stack. Do not route real users.`)
  }
  registerScheduledJobs(prisma)
})
