/**
 * Sovexa runtime mode.
 *
 * "test"  — every external paid/rate-limited service is short-circuited to a
 *            local mock (Bedrock, Stripe, Meta, Creatomate, Resend). Safe for
 *            rapid iteration without spending money or hitting rate limits.
 * "live"  — services run for real if their credentials are present. If a
 *            credential is missing, a specific service may still fall back to
 *            mock (e.g. the meeting endpoint already does this for Bedrock).
 *
 * Default is "live". Flip to "test" by setting `VEXA_MODE=test` in
 * apps/api/.env (or the environment of whatever hosts the API).
 */

export type Mode = 'test' | 'live'

export function getMode(): Mode {
  const raw = (process.env.VEXA_MODE || 'live').toLowerCase()
  return raw === 'test' ? 'test' : 'live'
}

export function isTestMode(): boolean {
  return getMode() === 'test'
}
