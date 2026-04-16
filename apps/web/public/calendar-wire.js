/* Vexa — keep the tasks calendar in sync with real work.
 *
 * Merges GET /api/tasks into window.calEntries (alongside demo + user ideas)
 * and adds meeting recaps. Entries we own use ids prefixed with vx-task-,
 * vx-plan-, or vx-mtg- so we can replace them on each sync without touching
 * seed data (e1…) or CEO ideas (u…).
 */
;(function () {
  const ROLE_WHO = {
    analyst: 'maya',
    strategist: 'jordan',
    copywriter: 'alex',
    creative_director: 'riley',
  }

  const WHO_LABEL = {
    maya: 'Maya',
    jordan: 'Jordan',
    alex: 'Alex',
    riley: 'Riley',
  }

  const TYPE_CAL = {
    trend_report: 'Trend',
    content_plan: 'Plan',
    hooks: 'Hooks',
    caption: 'Caption',
    script: 'Script',
    shot_list: 'Shoot',
    video: 'Video',
  }

  const DAY_OFF = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }

  function ymd(d) {
    const x = new Date(d)
    const y = x.getFullYear()
    const m = String(x.getMonth() + 1).padStart(2, '0')
    const day = String(x.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  function mondayOf(iso) {
    const d = new Date(iso)
    const day = d.getDay()
    const diff = day === 0 ? -6 : 1 - day
    d.setDate(d.getDate() + diff)
    d.setHours(12, 0, 0, 0)
    return d
  }

  function dayLabelToYmd(dayLabel, weekAnchorIso) {
    if (!dayLabel || typeof dayLabel !== 'string') return null
    const short = dayLabel.trim().slice(0, 3)
    const off = DAY_OFF[short]
    if (off === undefined) return null
    const mon = mondayOf(weekAnchorIso)
    mon.setDate(mon.getDate() + off)
    return ymd(mon)
  }

  function escAttr(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
  }

  function calStatusForTask(t) {
    if (t.status === 'approved') return 'approved'
    if (t.status === 'delivered') return 'scripted'
    return 'scripted'
  }

  function buildEntriesForTask(t) {
    const out = []
    const role = t.employee?.role
    const who = ROLE_WHO[role] || 'jordan'
    const label = WHO_LABEL[who] || 'Vexa'
    const typeLabel = TYPE_CAL[t.type] || String(t.type || 'Task').replace(/_/g, ' ')
    const titleBase = (t.title || 'Task').slice(0, 80)

    const latest = pickLatestOutput(t)
    const content = latest?.content && typeof latest.content === 'object' ? latest.content : {}

    if (t.type === 'content_plan' && Array.isArray(content.posts) && content.posts.length > 0) {
      const anchor = content.weekOf || t.createdAt || t.updatedAt
      content.posts.slice(0, 5).forEach((p, i) => {
        const dayLabel = p.day || p.weekday
        const dateStr = dayLabelToYmd(String(dayLabel || ''), anchor) || ymd(t.createdAt)
        const fmt = p.format || p.type || 'Post'
        const topic = (p.topic || p.angle || titleBase).slice(0, 72)
        out.push({
          id: `vx-plan-${t.id}-${i}`,
          date: dateStr,
          type: String(fmt).slice(0, 24),
          title: topic,
          who,
          status: calStatusForTask(t),
          label,
          vxSource: 'content_plan',
          vxTaskId: t.id,
        })
      })
      return out
    }

    const anchorDate = t.completedAt || t.createdAt || new Date().toISOString()
    out.push({
      id: `vx-task-${t.id}`,
      date: ymd(anchorDate),
      type: typeLabel,
      title: titleBase,
      who,
      status: calStatusForTask(t),
      label,
      vxSource: 'task',
      vxTaskId: t.id,
    })
    return out
  }

  function pickLatestOutput(task) {
    const outs = task?.outputs
    if (!outs || outs.length === 0) return null
    return outs.reduce((a, b) => (new Date(a.createdAt) > new Date(b.createdAt) ? a : b))
  }

  /** Drop task/plan rows we regenerate; keep meeting recaps (vx-mtg-) and demo/user rows. */
  function stripVexaGenerated(entries) {
    return entries.filter((e) => {
      const id = String(e.id || '')
      return !(id.startsWith('vx-task-') || id.startsWith('vx-plan-'))
    })
  }

  async function fetchTasks() {
    try {
      const res = await fetch('/api/tasks', { credentials: 'include' })
      if (!res.ok) return []
      const json = await res.json()
      return json.tasks || []
    } catch {
      return []
    }
  }

  let syncInFlight = false
  let pendingSync = false

  function syncCalendarFromTasks() {
    const list = window.calEntries
    if (!Array.isArray(list)) return

    if (syncInFlight) {
      pendingSync = true
      return
    }
    syncInFlight = true

    fetchTasks()
      .then((tasks) => {
        const preserved = stripVexaGenerated(list)
        const byTaskId = new Map()
        for (const t of tasks) {
          if (t && t.id && !byTaskId.has(t.id)) byTaskId.set(t.id, t)
        }
        const SKIP_TYPES = { performance_review: 1, weekly_pulse: 1 }
        const uniqueTasks = [...byTaskId.values()].filter((t) => !SKIP_TYPES[t.type])

        const byEntryId = new Map()
        for (const t of uniqueTasks) {
          for (const row of buildEntriesForTask(t)) {
            byEntryId.set(row.id, row)
          }
        }
        const generated = [...byEntryId.values()]

        list.length = 0
        list.push(...preserved, ...generated)
        if (typeof window.renderCalendar === 'function') window.renderCalendar()
      })
      .finally(() => {
        syncInFlight = false
        if (pendingSync) {
          pendingSync = false
          syncCalendarFromTasks()
        }
      })
  }

  /** After /api/meeting/end — pin a recap on today’s date. */
  function addMeetingRecap(opts) {
    const list = window.calEntries
    if (!Array.isArray(list)) return
    const { name, employeeRole, summary } = opts
    const who = ROLE_WHO[employeeRole] || 'jordan'
    const label = WHO_LABEL[who] || name || 'Vexa'
    const title = (summary || 'Team meeting').replace(/\s+/g, ' ').trim().slice(0, 72) || 'Meeting recap'
    list.push({
      id: `vx-mtg-${Date.now()}`,
      date: ymd(new Date()),
      type: 'Meeting',
      title,
      who,
      status: 'approved',
      label,
      vxSource: 'meeting',
    })
    if (typeof window.renderCalendar === 'function') window.renderCalendar()
  }

  window.vxSyncCalendarFromTasks = syncCalendarFromTasks
  window.vxCalendarAddMeetingRecap = addMeetingRecap

  let taskChangeTimer
  window.addEventListener('vx-task-changed', () => {
    clearTimeout(taskChangeTimer)
    taskChangeTimer = setTimeout(syncCalendarFromTasks, 220)
  })

  const prevEnter = window.enterDashboard
  window.enterDashboard = async function () {
    if (typeof prevEnter === 'function') await prevEnter.apply(this, arguments)
    setTimeout(syncCalendarFromTasks, 500)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(syncCalendarFromTasks, 700))
  } else {
    setTimeout(syncCalendarFromTasks, 700)
  }
})()
