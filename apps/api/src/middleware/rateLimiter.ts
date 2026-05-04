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

// Auth rate limiter — accounts in this set bypass the 30-attempt gate.
// Matched case-insensitively against the request body's `identifier`
// (login), `email` (signup/forgot-password), or `username` field.
// Used during demos / repeated-login testing where the limiter would
// otherwise lock out a known-good test account on a shared IP.
//
// Keep the list short and obviously non-production. Adding a real
// customer here defeats the brute-force protection for that account.
const AUTH_LIMITER_BYPASS_IDENTIFIERS = new Set<string>([
  'jaytlin',           // test account — repeated login flows
  // add more usernames or emails as needed
])

function isAuthLimiterBypassed(req: Request): boolean {
  const body = (req.body ?? {}) as Record<string, unknown>
  for (const field of ['identifier', 'email', 'username']) {
    const v = body[field]
    if (typeof v === 'string' && v.trim().length > 0
        && AUTH_LIMITER_BYPASS_IDENTIFIERS.has(v.trim().toLowerCase())) {
      return true
    }
  }
  return false
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
// Skips entirely in dev, AND for known test accounts (see bypass set above).
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req: Request) => clientIp(req),
  skip: (req: Request) => skipInDev(req) || isAuthLimiterBypassed(req),
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
