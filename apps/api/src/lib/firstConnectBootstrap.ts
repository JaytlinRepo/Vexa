/**
 * First-connect bootstrap state.
 *
 * After a user finishes OAuth on Instagram or TikTok we kick off three
 * fire-and-forget tasks: a daily-snapshot backfill, Maya's first playbook,
 * and Jordan's opening goal. Each one can take 5-15s on Bedrock or fail
 * silently on a Meta API hiccup. Without surfacing state, the dashboard
 * lands in HQ and shows empty cards while the work is still in flight, or
 * stays empty forever after a silent failure.
 *
 * This module gives the frontend a single source of truth so it can show
 * "Maya is preparing your first playbook…" while the work runs and a real
 * "couldn't load — try refreshing" banner if any sub-step errored.
 *
 * State is stored in Redis with an in-memory fallback (parity with the rest
 * of rateLimitStore.ts). Each step is tracked individually; the aggregate
 * status is derived at read time.
 */

import IORedis from 'ioredis'
import { attachThrottledErrorHandler } from '../queues/connection'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

let _client: IORedis | null = null
function getClient(): IORedis {
  if (!_client) {
    _client = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      retryStrategy: (times) => Math.min(times * 200, 3000),
      lazyConnect: true,
    })
    attachThrottledErrorHandler(_client)
  }
  return _client
}

export type StepStatus = 'pending' | 'ready' | 'failed' | 'skipped'
export type AggregateStatus = 'pending' | 'ready' | 'partial' | 'failed' | 'empty_account'

export interface BootstrapState {
  status: AggregateStatus
  steps: { backfill: StepStatus; maya: StepStatus; goal: StepStatus }
  postCount: number | null
  startedAt: string | null
  finishedAt: string | null
  /** Friendly, sanitized message for users when status === 'failed' or 'partial'. */
  error: string | null
}

const TTL_SECONDS = 30 * 60 // 30 min — a fresh first-connect is short-lived

function key(companyId: string): string {
  return `bootstrap:${companyId}`
}

const _local = new Map<string, BootstrapState>()

const EMPTY: BootstrapState = {
  status: 'pending',
  steps: { backfill: 'pending', maya: 'pending', goal: 'pending' },
  postCount: null,
  startedAt: null,
  finishedAt: null,
  error: null,
}

async function read(companyId: string): Promise<BootstrapState | null> {
  try {
    const raw = await getClient().get(key(companyId))
    if (raw) return JSON.parse(raw) as BootstrapState
  } catch {
    // fall through to in-memory
  }
  return _local.get(companyId) ?? null
}

async function write(companyId: string, state: BootstrapState): Promise<void> {
  _local.set(companyId, state)
  try {
    await getClient().set(key(companyId), JSON.stringify(state), 'EX', TTL_SECONDS)
  } catch {
    // keep in-memory; caller doesn't need to know
  }
}

/** Mark the bootstrap as in flight and reset all step statuses to 'pending'. */
export async function startBootstrap(companyId: string, opts?: { postCount?: number }): Promise<void> {
  await write(companyId, {
    ...EMPTY,
    steps: { backfill: 'pending', maya: 'pending', goal: 'pending' },
    postCount: opts?.postCount ?? null,
    startedAt: new Date().toISOString(),
  })
}

/** Update one step's status. Recomputes the aggregate before writing. */
export async function setStep(
  companyId: string,
  step: keyof BootstrapState['steps'],
  status: StepStatus,
  errorMessage?: string,
): Promise<void> {
  const current = (await read(companyId)) ?? { ...EMPTY }
  const next: BootstrapState = {
    ...current,
    steps: { ...current.steps, [step]: status },
  }
  // Aggregate: ready when all steps !== pending. Failed if every step failed.
  // Partial when any step succeeded and any step failed. Empty when ready
  // but the account had zero posts to backfill.
  const vals = Object.values(next.steps)
  const stillPending = vals.includes('pending')
  if (!stillPending) {
    const fails = vals.filter((v) => v === 'failed').length
    const successes = vals.filter((v) => v === 'ready' || v === 'skipped').length
    if (fails === vals.length) next.status = 'failed'
    else if (fails > 0 && successes > 0) next.status = 'partial'
    else if (next.postCount === 0) next.status = 'empty_account'
    else next.status = 'ready'
    next.finishedAt = new Date().toISOString()
  } else {
    next.status = 'pending'
  }
  if (errorMessage && status === 'failed') {
    // Curate the message: never echo AWS / Meta / IAM internals to users.
    const safe = errorMessage.length > 0 && errorMessage.length < 160 &&
      !/arn:aws|aws |iam:|s3:|accessdenied|x-amz|presigned|signature|status code \d{3}|\bforbidden\b|\bunauthorized\b/i.test(errorMessage)
    next.error = safe
      ? errorMessage
      : "We couldn't finish setting up your dashboard. Please refresh in a minute."
  }
  await write(companyId, next)
}

/** Public read used by the route. Returns the EMPTY shape if nothing started. */
export async function getBootstrapState(companyId: string): Promise<BootstrapState> {
  return (await read(companyId)) ?? { ...EMPTY }
}
