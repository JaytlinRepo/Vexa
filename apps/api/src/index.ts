import 'dotenv/config'
import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import { registerSSEClient, getNotifications, getUnreadCount, markAsRead, markAllAsRead } from './services/notifications/notification.service'

const app = express()
const PORT = Number(process.env.PORT ?? 4000)

app.use(cors({ origin: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000', credentials: true }))
app.use(express.json({ limit: '2mb' }))

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'vexa-api', ts: new Date().toISOString() })
})

// Placeholder auth: reads userId from header. Replace with Cognito JWT verification.
function requireUser(req: Request, res: Response, next: NextFunction): void {
  const userId = req.header('x-user-id')
  if (!userId) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  ;(req as Request & { userId: string }).userId = userId
  next()
}

app.get('/api/notifications/stream', requireUser, (req, res) => {
  const userId = (req as Request & { userId: string }).userId
  registerSSEClient(userId, res)
})

app.get('/api/notifications', requireUser, async (req, res, next) => {
  try {
    const userId = (req as Request & { userId: string }).userId
    const [items, unread] = await Promise.all([getNotifications(userId), getUnreadCount(userId)])
    res.json({ items, unread })
  } catch (err) {
    next(err)
  }
})

app.post('/api/notifications/:id/read', requireUser, async (req, res, next) => {
  try {
    const userId = (req as Request & { userId: string }).userId
    await markAsRead(req.params.id, userId)
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

app.post('/api/notifications/read-all', requireUser, async (req, res, next) => {
  try {
    const userId = (req as Request & { userId: string }).userId
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
