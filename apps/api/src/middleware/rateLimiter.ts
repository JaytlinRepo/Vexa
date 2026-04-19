import rateLimit from 'express-rate-limit'
import { Request } from 'express'
import { readSession } from './auth'

// Identify users by session userId, fall back to IP for unauthenticated requests.
// This ensures one user's burst doesn't affect another's rate limit bucket.
async function keyGenerator(req: Request): Promise<string> {
  const session = await readSession(req)
  if (session) return `user:${session.userId}`
  const forwarded = req.headers['x-forwarded-for']
  const ip = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.ip
  return `ip:${ip}`
}

// General API rate limit — 100 requests per minute per user/IP
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator,
  message: { error: 'rate_limited', message: 'Too many requests. Please slow down.' },
})

// Auth endpoints — stricter: 10 attempts per 15 minutes per IP
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const forwarded = req.headers['x-forwarded-for']
    return typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.ip ?? 'unknown'
  },
  message: { error: 'rate_limited', message: 'Too many login attempts. Try again later.' },
})

// Agent/Bedrock calls — 20 per minute per user (prevents cost runaway)
export const agentLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator,
  message: { error: 'rate_limited', message: 'Too many AI requests. Please wait a moment.' },
})
