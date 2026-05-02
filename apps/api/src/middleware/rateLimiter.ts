import rateLimit from 'express-rate-limit'
import { Request } from 'express'
import { readSession } from './auth'

const isDev = process.env.NODE_ENV !== 'production'

// App Runner forwards the real client IP in X-Forwarded-For. We trust the
// first (leftmost) address, which is the actual client, not the load balancer.
function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for']
  if (forwarded) {
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',')[0].trim()
    if (first) return first
  }
  return req.ip ?? 'unknown'
}

// Identify users by session userId, fall back to real IP for unauthenticated requests.
async function keyGenerator(req: Request): Promise<string> {
  const session = await readSession(req)
  if (session) return `user:${session.userId}`
  return `ip:${clientIp(req)}`
}

// Skip rate limiting entirely in dev
function skipInDev(_req: Request): boolean {
  return isDev
}

// General API rate limit — 100 requests per minute per user/IP
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator,
  skip: skipInDev,
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
  message: { error: 'rate_limited', message: 'Too many requests. Please slow down.' },
})

// Auth endpoints — 30 attempts per 15 minutes per real client IP (production only)
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req: Request) => clientIp(req),
  skip: skipInDev,
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
  message: { error: 'rate_limited', message: 'Too many login attempts. Try again later.' },
})

// Agent/Bedrock calls — 20 per minute per user (production only)
export const agentLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator,
  skip: skipInDev,
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
  message: { error: 'rate_limited', message: 'Too many AI requests. Please wait a moment.' },
})
