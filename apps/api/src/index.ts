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
import feedRouter from './routes/feed'
import companyRouter from './routes/company'
import outputsRouter from './routes/outputs'
import usageRouter from './routes/usage'

if (!process.env.SESSION_SECRET) {
  console.warn('[api] SESSION_SECRET is unset — falling back to a dev-only value. Do NOT ship like this.')
  process.env.SESSION_SECRET = 'dev-only-insecure-secret-change-me'
}

const app = express()
const PORT = Number(process.env.PORT ?? 4000)

app.use(
  cors({
    origin: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    credentials: true,
  }),
)
app.use(express.json({ limit: '2mb' }))
app.use(cookieParser())

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'vexa-api', ts: new Date().toISOString() })
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
})
