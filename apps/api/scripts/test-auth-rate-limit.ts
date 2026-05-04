/**
 * Smoke-test auth login rate limiting + bypass.
 *
 * Requires NODE_ENV=production (otherwise authLimiter skips entirely).
 *
 * Usage (from repo root or apps/api):
 *   NODE_ENV=production SESSION_SECRET=test-secret-change-me-min-32-characters-long tsx apps/api/scripts/test-auth-rate-limit.ts
 */
import express, { Express } from 'express'
import { authLimiter } from '../src/middleware/rateLimiter'

function fail(message: string): never {
  console.error('[test-auth-rate-limit] FAIL:', message)
  process.exit(1)
}

function pickPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = express()
      .listen(0, '127.0.0.1', () => {
        const addr = s.address()
        s.close(() => {
          if (typeof addr === 'object' && addr?.port) resolve(addr.port)
          else reject(new Error('could not allocate port'))
        })
      })
      .on('error', reject)
  })
}

function mountApp(): Express {
  const app = express()
  app.use(express.json({ limit: '256kb' }))
  app.post('/login', authLimiter, (_req, res) => {
    res.json({ ok: true })
  })
  return app
}

async function postJson(port: number, body: object): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  let json: Record<string, unknown> = {}
  try {
    json = (await res.json()) as Record<string, unknown>
  } catch {
    /* empty body */
  }
  return { status: res.status, json }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== 'production') {
    fail('NODE_ENV must be production (authLimiter skips in dev). Example:\n  NODE_ENV=production SESSION_SECRET=... tsx apps/api/scripts/test-auth-rate-limit.ts')
  }
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 16) {
    fail('SESSION_SECRET env must be set (any 16+ char string for this script).')
  }

  const port = await pickPort()
  const app = mountApp()
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const s = app.listen(port, '127.0.0.1', () => resolve(s))
    s.on('error', reject)
  })

  const limit = Number(process.env.VEXA_AUTH_LOGIN_RATE_LIMIT ?? 30)
  const attackUser = 'not_a_bypass_user_xyz'

  try {
    // Non-bypass: exhaust limit, next should 429
    for (let i = 0; i < limit; i++) {
      const { status } = await postJson(port, { identifier: attackUser, password: 'x' })
      if (status !== 200) fail(`expected 200 for sub-limit request ${i + 1}, got ${status}`)
    }
    const blocked = await postJson(port, { identifier: attackUser, password: 'x' })
    if (blocked.status !== 429) {
      fail(`expected 429 after ${limit} attempts, got ${blocked.status} body=${JSON.stringify(blocked.json)}`)
    }
    if (blocked.json.message !== 'Too many login attempts. Try again later.') {
      fail(`unexpected 429 body: ${JSON.stringify(blocked.json)}`)
    }

    // Bypass: many more logins as jaytlin should still succeed (skip does not increment)
    for (let i = 0; i < limit + 5; i++) {
      const r = await postJson(port, { identifier: 'jaytlin', password: 'x' })
      if (r.status !== 200) {
        fail(`jaytlin bypass expected 200 on request ${i + 1}, got ${r.status} body=${JSON.stringify(r.json)}`)
      }
    }

    // Email local-part bypass
    const { status: st2 } = await postJson(port, { identifier: 'Jaytlin@example.com', password: 'x' })
    if (st2 !== 200) fail(`email local-part bypass expected 200, got ${st2}`)

    console.log('[test-auth-rate-limit] OK — limit enforced for strangers, jaytlin bypasses.')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
