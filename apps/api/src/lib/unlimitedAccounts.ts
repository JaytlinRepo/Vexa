import { PlanLimits } from './plans'

/** Test/owner accounts that bypass every plan-tier limit and feature gate.
 *  Match is case-insensitive on `username`. Keep this list short — adding a
 *  real customer disables brute-force, quota, and cost protections for them. */
const UNLIMITED_USERNAMES = new Set<string>(['jaytlin'])

export function isUnlimitedUser(user: { username?: string | null } | null | undefined): boolean {
  if (!user?.username) return false
  return UNLIMITED_USERNAMES.has(user.username.trim().toLowerCase())
}

/** Synthetic plan that grants every feature with effectively-infinite quota.
 *  Returned by `getLimitsForUser` when `isUnlimitedUser` matches. */
export const UNLIMITED_LIMITS: PlanLimits = {
  tasksPerMonth: 999_999,
  resetWindow: 'monthly',
  videosPerMonth: 999_999,
  studioEditsPerMonth: 999_999,
  workspaces: 999,
  meetingFeature: true,
  brandMemory: true,
  bedrockCallsPerMonth: 999_999,
  briefCooldownMin: 0,
  proactiveAnalysis: true,
  weeklyPulse: true,
  nicheDetection: true,
  syncOnLogin: true,
  employees: ['analyst', 'strategist', 'creative_director'],
  revisionsPerOutput: 999_999,
}
