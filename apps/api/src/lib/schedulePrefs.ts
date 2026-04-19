/**
 * Schedule preferences — stored in company.agentTools JSON.
 *
 * Each schedule has a key, default day (0=Sun..6=Sat), and default hour (UTC).
 * Users can override per-company. The scheduler checks every hour whether
 * any company's schedule matches the current day+hour and triggers the task.
 *
 * Format in agentTools:
 * {
 *   "schedules": {
 *     "maya_pulse":       { "day": 1, "hour": 7 },
 *     "jordan_plan":      { "day": 0, "hour": 19 },
 *     "jordan_audit":     { "day": 3, "hour": 10 },
 *     "jordan_adjustment":{ "day": 3, "hour": 15 },
 *     "jordan_growth":    { "dayOfMonth": 1, "hour": 11 },
 *     "riley_feed_audit": { "day": 4, "hour": 14 },
 *     "riley_format":     { "day": 5, "hour": 14 },
 *     "riley_competitor": { "dayOfMonth": 15, "hour": 12 }
 *   }
 * }
 */

export interface ScheduleEntry {
  day?: number        // 0=Sun, 1=Mon ... 6=Sat (weekly schedules)
  dayOfMonth?: number // 1-28 (monthly schedules)
  hour: number        // 0-23 UTC
}

export interface SchedulePrefs {
  [key: string]: ScheduleEntry
}

export const SCHEDULE_DEFAULTS: Record<string, ScheduleEntry & { label: string; agent: string; description: string }> = {
  maya_pulse: {
    day: 1, hour: 7,
    label: 'Weekly Pulse',
    agent: 'Maya',
    description: 'Weekly performance review and trend report',
  },
  jordan_plan: {
    day: 0, hour: 19,
    label: 'Weekly Plan',
    agent: 'Jordan',
    description: 'Next week\'s content plan',
  },
  jordan_audit: {
    day: 3, hour: 10,
    label: 'Content Audit',
    agent: 'Jordan',
    description: 'Bi-weekly review of what\'s working',
  },
  jordan_adjustment: {
    day: 3, hour: 15,
    label: 'Plan Adjustment',
    agent: 'Jordan',
    description: 'Mid-week tweaks based on performance',
  },
  jordan_growth: {
    dayOfMonth: 1, hour: 11,
    label: 'Growth Strategy',
    agent: 'Jordan',
    description: 'Monthly growth plan',
  },
  riley_feed_audit: {
    day: 4, hour: 14,
    label: 'Feed Audit',
    agent: 'Riley',
    description: 'Bi-weekly visual brand review',
  },
  riley_format: {
    day: 5, hour: 14,
    label: 'Format Analysis',
    agent: 'Riley',
    description: 'Bi-weekly format performance review',
  },
  riley_competitor: {
    dayOfMonth: 15, hour: 12,
    label: 'Competitor Analysis',
    agent: 'Riley',
    description: 'Monthly competitor research',
  },
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function getScheduleForCompany(agentTools: Record<string, unknown>, key: string): ScheduleEntry {
  const prefs = (agentTools?.schedules || {}) as SchedulePrefs
  return prefs[key] || SCHEDULE_DEFAULTS[key]
}

export function shouldRunNow(entry: ScheduleEntry, now: Date): boolean {
  const currentHour = now.getUTCHours()
  if (currentHour !== entry.hour) return false

  if (entry.dayOfMonth !== undefined) {
    return now.getUTCDate() === entry.dayOfMonth
  }
  if (entry.day !== undefined) {
    return now.getUTCDay() === entry.day
  }
  return false
}

export function formatSchedule(entry: ScheduleEntry): string {
  const hour = entry.hour % 12 || 12
  const ampm = entry.hour < 12 ? 'am' : 'pm'
  if (entry.dayOfMonth !== undefined) {
    const suffix = entry.dayOfMonth === 1 ? 'st' : entry.dayOfMonth === 2 ? 'nd' : entry.dayOfMonth === 3 ? 'rd' : 'th'
    return `${entry.dayOfMonth}${suffix} of each month at ${hour}${ampm} UTC`
  }
  if (entry.day !== undefined) {
    return `${DAY_NAMES[entry.day]}s at ${hour}${ampm} UTC`
  }
  return `${hour}${ampm} UTC`
}
