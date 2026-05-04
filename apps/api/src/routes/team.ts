/**
 * Team status endpoint.
 *
 * Powers the thin status bar at the top of HQ. Polled every ~30s by the
 * client, so it's deliberately cheap: a 30-second in-process cache per
 * companyId means a creator hammering the dashboard touches the database
 * once every half-minute, not once every poll.
 *
 * Status semantics:
 *   - `working`        — the agent has a fresh in-flight task or output
 *                        within the last hour
 *   - `waiting_on_you` — there's something delivered/ready that needs the
 *                        creator's call (Maya playbook from today, Jordan
 *                        plan in `delivered`, Riley clips in `pending_approval`)
 *   - `done`           — the agent finished a deliverable in the last 10 min
 *                        and nothing is waiting on the user
 *   - `idle`           — no recent activity; the bar still renders ("standing by")
 *
 * Identity layer per the design brief: name + role are returned in the
 * canonical small-caps shape so the frontend can drop them straight in.
 */

import { Router, Request, Response } from 'express'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import prisma from '../lib/prisma'

const router = Router()

type EmployeeStatus = 'working' | 'idle' | 'done' | 'waiting_on_you'

interface EmployeeRow {
  id: 'maya' | 'jordan' | 'riley'
  name: 'MAYA' | 'JORDAN' | 'RILEY'
  role: 'ANALYST' | 'STRATEGIST' | 'CREATIVE DIRECTOR'
  status: EmployeeStatus
  message: string
  cta: { label: string; href: string } | null
}

interface TeamStatusResponse {
  employees: EmployeeRow[]
}

const CACHE_TTL_MS = 30_000
const cache = new Map<string, { at: number; value: TeamStatusResponse }>()

const HOUR = 60 * 60 * 1000
const TEN_MIN = 10 * 60 * 1000

function within(ms: number, since: Date | null | undefined): boolean {
  if (!since) return false
  return Date.now() - new Date(since).getTime() < ms
}

router.get('/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const cacheKey = `team:${userId}`
    const hit = cache.get(cacheKey)
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      res.json(hit.value)
      return
    }

    const company = await prisma.company.findFirst({
      where: { userId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    })

    // No company yet: return the canonical idle shape so the bar still
    // renders cleanly during the new-user bootstrap window.
    if (!company) {
      const emptyShape: TeamStatusResponse = {
        employees: [
          { id: 'maya',   name: 'MAYA',   role: 'ANALYST',           status: 'idle', message: 'standing by',    cta: null },
          { id: 'jordan', name: 'JORDAN', role: 'STRATEGIST',        status: 'idle', message: 'standing by',    cta: null },
          { id: 'riley',  name: 'RILEY',  role: 'CREATIVE DIRECTOR', status: 'idle', message: 'standing by',    cta: null },
        ],
      }
      cache.set(cacheKey, { at: Date.now(), value: emptyShape })
      res.json(emptyShape)
      return
    }

    // Pull the three signals we need in parallel — every query is indexed
    // and cheap, so this is well within the 30s cache budget.
    const [latestPlaybook, mayaWorking, latestPlanTask, pendingClips, readyClips, latestRileyClip] = await Promise.all([
      // Maya — latest brand_memory entry of type 'playbook' OR latest analyst output
      prisma.output.findFirst({
        where: { companyId: company.id, employee: { role: 'analyst' } },
        select: { createdAt: true, status: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.task.findFirst({
        where: { companyId: company.id, employee: { role: 'analyst' }, status: { in: ['in_progress', 'pending'] } },
        select: { id: true },
      }),
      // Jordan — latest content_plan task
      prisma.task.findFirst({
        where: { companyId: company.id, type: 'content_plan' },
        select: { id: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      // Riley — pending-approval Studio clips
      prisma.videoClip.count({
        where: { companyId: company.id, OR: [{ visualApprovalStatus: 'pending' }, { copyApprovalStatus: 'pending' }] },
      }),
      prisma.videoClip.count({
        where: { companyId: company.id, status: 'ready' },
      }),
      prisma.videoClip.findFirst({
        where: { companyId: company.id },
        select: { createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    // ── Maya ───────────────────────────────────────────────────────────
    const maya: EmployeeRow = (() => {
      if (latestPlaybook && latestPlaybook.status === 'draft' && within(HOUR * 24, latestPlaybook.createdAt)) {
        // Deep-link to the playbook tile on the dashboard. The frontend
        // recognises the `#hq:` prefix and scrolls + highlights the matching
        // selector instead of treating it as a top-level view name.
        return { id: 'maya', name: 'MAYA', role: 'ANALYST', status: 'waiting_on_you', message: 'fresh playbook is ready', cta: { label: 'review', href: '#hq:playbook' } }
      }
      if (mayaWorking) {
        return { id: 'maya', name: 'MAYA', role: 'ANALYST', status: 'working', message: 'reading your weekly performance', cta: null }
      }
      if (latestPlaybook && within(TEN_MIN, latestPlaybook.createdAt)) {
        return { id: 'maya', name: 'MAYA', role: 'ANALYST', status: 'done', message: 'playbook delivered', cta: null }
      }
      return { id: 'maya', name: 'MAYA', role: 'ANALYST', status: 'idle', message: 'standing by', cta: null }
    })()

    // ── Jordan ─────────────────────────────────────────────────────────
    const jordan: EmployeeRow = (() => {
      if (!latestPlanTask) {
        return { id: 'jordan', name: 'JORDAN', role: 'STRATEGIST', status: 'idle', message: 'standing by', cta: null }
      }
      if (latestPlanTask.status === 'delivered') {
        return { id: 'jordan', name: 'JORDAN', role: 'STRATEGIST', status: 'waiting_on_you', message: 'plan needs your call', cta: { label: 'review plan', href: '#hq:weekly-plan' } }
      }
      if (latestPlanTask.status === 'in_progress' || latestPlanTask.status === 'pending') {
        return { id: 'jordan', name: 'JORDAN', role: 'STRATEGIST', status: 'working', message: "drafting next week's plan", cta: null }
      }
      if (within(TEN_MIN, latestPlanTask.createdAt)) {
        return { id: 'jordan', name: 'JORDAN', role: 'STRATEGIST', status: 'done', message: 'plan approved', cta: null }
      }
      return { id: 'jordan', name: 'JORDAN', role: 'STRATEGIST', status: 'idle', message: 'standing by', cta: null }
    })()

    // ── Riley ──────────────────────────────────────────────────────────
    const riley: EmployeeRow = (() => {
      if (pendingClips > 0) {
        const label = pendingClips === 1 ? '1 clip needs your review' : `${pendingClips} clips need your review`
        return { id: 'riley', name: 'RILEY', role: 'CREATIVE DIRECTOR', status: 'waiting_on_you', message: label, cta: { label: 'open studio', href: '#db-studio' } }
      }
      if (readyClips > 0) {
        const label = readyClips === 1 ? '1 clip ready to post' : `${readyClips} clips ready to post`
        return { id: 'riley', name: 'RILEY', role: 'CREATIVE DIRECTOR', status: 'done', message: label, cta: { label: 'open studio', href: '#db-studio' } }
      }
      if (latestRileyClip && within(TEN_MIN, latestRileyClip.createdAt)) {
        return { id: 'riley', name: 'RILEY', role: 'CREATIVE DIRECTOR', status: 'done', message: 'clip just delivered', cta: { label: 'open studio', href: '#db-studio' } }
      }
      return { id: 'riley', name: 'RILEY', role: 'CREATIVE DIRECTOR', status: 'idle', message: 'standing by', cta: null }
    })()

    const value: TeamStatusResponse = { employees: [maya, jordan, riley] }
    cache.set(cacheKey, { at: Date.now(), value })
    res.json(value)
  } catch (err) {
    console.error('[team] status failed:', err)
    res.status(500).json({ error: 'team_status_failed' })
  }
})

export default router
