import { Request, Response, NextFunction } from 'express'
import { SignJWT, jwtVerify } from 'jose'

const SESSION_COOKIE = 'vx_session'
const SESSION_TTL_DAYS = 7

function secret(): Uint8Array {
  const raw = process.env.SESSION_SECRET
  if (!raw) throw new Error('SESSION_SECRET is not set')
  return new TextEncoder().encode(raw)
}

export interface SessionPayload {
  userId: string
  email: string
}

export async function createSession(res: Response, payload: SessionPayload): Promise<void> {
  const token = await new SignJWT({ userId: payload.userId, email: payload.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_DAYS}d`)
    .sign(secret())

  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  })
}

export function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' })
}

export async function readSession(req: Request): Promise<SessionPayload | null> {
  const token = req.cookies?.[SESSION_COOKIE]
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret())
    return { userId: payload.userId as string, email: payload.email as string }
  } catch {
    return null
  }
}

export interface AuthedRequest extends Request {
  session: SessionPayload
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const session = await readSession(req)
  if (!session) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  ;(req as AuthedRequest).session = session
  next()
}
