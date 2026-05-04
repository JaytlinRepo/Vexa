import rateLimit from 'express-rate-limit'
import { Request } from 'express'
import { readSession } from './auth'

const isDev = process.env.NODE_ENV !== 'production'

function stripIpv4Port(raw: string): string {
  const t = raw.trim()
  // CloudFront / similar: dotted IPv4 + ":port" only (avoid breaking IPv6 literals).
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}$/.test(t)) return t.slice(0, t.lastIndexOf(':'))
  return t
}

function splitFirstIp(hdr: unknown): string | null {
  if (hdr == null) return null
  const s = (Array.isArray(hdr) ? hdr[0] : String(hdr)).split(',')[0]?.trim()
  return s ? stripIpv4Port(s) : null
}

/** Best-effort client IP behind CDNs / reverse proxies (used for coarse rate limits only). */
function clientIp(req: Request): string {
  const singleton =
    splitFirstIp(req.headers['cf-connecting-ip'])
    || splitFirstIp(req.headers['true-client-ip'])
    || splitFirstIp(req.headers['x-real-ip'])
    || splitFirstIp(req.headers['cloudfront-viewer-address'])
    || splitFirstIp(req.headers['fastly-client-ip'])
  if (singleton) return singleton

  const fromExpress = typeof req.ip === 'string' && req.ip ? stripIpv4Port(req.ip) : ''
  if (fromExpress && fromExpress !== '::1' && fromExpress !== '127.0.0.1') return fromExpress

  const forwarded = req.headers['x-forwarded-for']
  if (forwarded) {
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',')[0].trim()
    if (first) return stripIpv4Port(first)
  }
  return fromExpress || 'unknown'
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
const AUTH_LIMITER_BASE_BYPASS = ['jaytlin'] as const // matches username or jaytlin@… (local-part)

/** NFC + strip invisible unicode (copy/paste); trim + lowercase. */
function normalizeAuthBypassToken(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[\uFEFF\u200B-\u200D\u2060]/g, '')
    .trim()
    .toLowerCase()
}

function mergedAuthBypassSet(): Set<string> {
  const merged = new Set<string>()
  for (const id of AUTH_LIMITER_BASE_BYPASS) merged.add(id.toLowerCase())
  const extra = (process.env.VEXA_AUTH_LOGIN_RATE_LIMIT_BYPASS ?? '')
    .split(',')
    .map((s) => normalizeAuthBypassToken(s))
    .filter(Boolean)
  for (const id of extra) merged.add(id)
  return merged
}

let memoBypassSet: Set<string> | undefined
function authBypassIdentifiers(): Set<string> {
  if (!memoBypassSet) memoBypassSet = mergedAuthBypassSet()
  return memoBypassSet
}

function bodyValueMatchesBypassList(raw: string): boolean {
  const v = normalizeAuthBypassToken(raw)
  if (!v) return false
  for (const allowed of authBypassIdentifiers()) {
    if (allowed.includes('@')) {
      if (v === allowed) return true
      continue
    }
    if (v === allowed) return true
    const at = v.indexOf('@')
    if (at > 0 && v.slice(0, at) === allowed) return true
  }
  return false
}

function coerceBodyString(v: unknown): string | null {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null
}

function authLoginRateLimiterDisabled(): boolean {
  const v = (process.env.VEXA_AUTH_LOGIN_RATE_LIMIT_DISABLED ?? '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

function isAuthLimiterBypassed(req: Request): boolean {
  const body = (req.body ?? {}) as Record<string, unknown>
  for (const field of ['identifier', 'email', 'username']) {
    const raw = coerceBodyString(body[field])
    if (raw !== null && bodyValueMatchesBypassList(raw)) return true
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

function authLoginRateLimitEnv(): number {
  const raw = (process.env.VEXA_AUTH_LOGIN_RATE_LIMIT ?? '').trim()
  if (!raw) return 30
  const n = Number(raw)
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 10_000) : 30
}

// Auth endpoints — 30 attempts per 15 minutes per real client IP (production only)
// Skips entirely in dev; test accounts bypass (AUTH_LIMITER_BASE_BYPASS +
// VEXA_AUTH_LOGIN_RATE_LIMIT_BYPASS). Set TRUST_PROXY_HOPS if multiple reverse proxies sit in front.
// VEXA_AUTH_LOGIN_RATE_LIMIT_DISABLED=1 skips this limit entirely (staging only).
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: authLoginRateLimitEnv(),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req: Request) => clientIp(req),
  skip: (req: Request) =>
    skipInDev(req) || authLoginRateLimiterDisabled() || isAuthLimiterBypassed(req),
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
