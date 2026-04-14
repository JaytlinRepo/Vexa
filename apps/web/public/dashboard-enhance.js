/* Vexa — dashboard overview improvements
 *
 * Adds three live sections to #view-db-dashboard:
 *   1) Quick stats row (awaiting / in progress / approved / total)
 *   2) Team status pill bar (4 employees, live state)
 *   3) Fresh trend snippet (top item from /api/feed)
 * And replaces the static .briefing-grid mock with one card per employee
 * built from their most recent delivered task.
 */
;(function () {
  const EMPLOYEES = [
    { role: 'strategist',        name: 'Jordan', init: 'J', short: 'Content Strategist', color: '#c8f060' },
    { role: 'analyst',           name: 'Maya',   init: 'M', short: 'Trend Analyst',      color: '#6ab4ff' },
    { role: 'copywriter',        name: 'Alex',   init: 'A', short: 'Copywriter',         color: '#e8c87a' },
    { role: 'creative_director', name: 'Riley',  init: 'R', short: 'Creative Director',  color: '#b482ff' },
  ]

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  function timeAgo(ts) {
    const diff = Math.max(0, Date.now() - new Date(ts).getTime())
    const m = Math.floor(diff / 60000)
    if (m < 1) return 'just now'
    if (m < 60) return m + ' min ago'
    const h = Math.floor(m / 60)
    if (h < 24) return h + ' hr ago'
    return Math.floor(h / 24) + 'd ago'
  }

  async function fetchJSON(url) {
    try {
      const res = await fetch(url, { credentials: 'include' })
      if (!res.ok) return null
      return res.json()
    } catch {
      return null
    }
  }

  // ── Quick stats row ──────────────────────────────────────────────────────
  function buildStatsRow(tasks) {
    const awaiting = tasks.filter((t) => t.status === 'delivered').length
    const progress = tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress' || t.status === 'revision').length
    const approved = tasks.filter((t) => t.status === 'approved').length
    const total = tasks.length
    const stats = [
      { label: 'Awaiting review', value: awaiting, accent: 'var(--accent, #c8f060)' },
      { label: 'In progress',     value: progress, accent: '#e8c87a' },
      { label: 'Approved',        value: approved, accent: '#c8f060' },
      { label: 'Total tasks',     value: total,    accent: 'var(--t2)' },
    ]
    return `
      <div id="vx-quickstats" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0 8px">
        ${stats.map((s) => `
          <div style="padding:14px 16px;background:var(--s2);border:1px solid var(--b1);border-radius:10px">
            <div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--t3);margin-bottom:6px">${s.label}</div>
            <div style="font-family:'Cormorant Garamond',serif;font-size:32px;font-weight:500;color:${s.accent};line-height:1">${s.value}</div>
          </div>`).join('')}
      </div>
    `
  }

  // ── Team status pill bar ─────────────────────────────────────────────────
  function statusForEmployee(role, tasks) {
    const mine = tasks.filter((t) => t.employee?.role === role)
    if (mine.length === 0) return { pill: 'Idle', dot: 'var(--t3)' }
    const delivered = mine.find((t) => t.status === 'delivered')
    if (delivered) return { pill: 'Output ready', dot: '#c8f060' }
    const working = mine.find((t) => t.status === 'pending' || t.status === 'in_progress' || t.status === 'revision')
    if (working) return { pill: 'Working', dot: '#e8c87a' }
    return { pill: 'Done', dot: 'var(--t3)' }
  }

  function buildTeamBar(tasks) {
    return `
      <div id="vx-teambar" style="display:flex;gap:8px;margin:8px 0 20px;flex-wrap:wrap">
        ${EMPLOYEES.map((e) => {
          const s = statusForEmployee(e.role, tasks)
          return `
            <button
              onclick="openMeeting('${e.name}','${e.short}','${e.init}')"
              style="flex:1;min-width:160px;display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--s2);border:1px solid var(--b1);border-radius:10px;cursor:pointer;font-family:inherit;text-align:left;transition:border-color .2s"
              onmouseenter="this.style.borderColor='var(--b2)'"
              onmouseleave="this.style.borderColor='var(--b1)'"
              title="Call a meeting with ${e.name}"
            >
              <div style="width:28px;height:28px;border-radius:8px;background:${e.color}22;color:${e.color};display:grid;place-items:center;font-size:12px;font-weight:600">${e.init}</div>
              <div style="flex:1;min-width:0">
                <div style="font-size:12px;font-weight:600;color:var(--t1)">${e.name}</div>
                <div style="font-size:11px;color:var(--t3);display:flex;align-items:center;gap:6px">
                  <span style="width:6px;height:6px;border-radius:50%;background:${s.dot}"></span>
                  <span>${s.pill}</span>
                </div>
              </div>
            </button>`
        }).join('')}
      </div>
    `
  }

  // ── Fresh trend snippet ──────────────────────────────────────────────────
  function buildTrendSnippet(feed) {
    if (!feed || feed.length === 0) return ''
    const top = feed[0]
    return `
      <div id="vx-trend" style="margin:8px 0 20px;padding:16px 18px;background:var(--s2);border:1px solid var(--b1);border-radius:12px;display:flex;gap:14px;align-items:flex-start">
        <div style="flex:1;min-width:0">
          <div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--t3);margin-bottom:4px">Fresh trend — ${escapeHtml(top.source)}</div>
          <a href="${escapeHtml(top.url)}" target="_blank" rel="noopener" style="font-size:14px;font-weight:500;color:var(--t1);text-decoration:none;line-height:1.4;display:block;margin-bottom:6px">${escapeHtml(top.title)}</a>
          <div style="font-size:12px;color:var(--t2);line-height:1.5">${escapeHtml(top.mayaTake)}</div>
        </div>
        <button onclick="navigate('db-knowledge')" style="background:transparent;border:1px solid var(--b2);color:var(--t2);font-size:11px;padding:6px 12px;border-radius:6px;cursor:pointer;font-family:inherit;white-space:nowrap;flex-shrink:0">Full feed</button>
      </div>
    `
  }

  // ── Live briefing cards ──────────────────────────────────────────────────
  function buildBriefingCards(tasks) {
    const toShow = EMPLOYEES.map((emp) => {
      const mine = tasks.filter((t) => t.employee?.role === emp.role)
      // Prefer the most recent delivered task; fall back to anything recent.
      const task = mine.find((t) => t.status === 'delivered') || mine[0]
      return { emp, task }
    }).filter((x) => x.task)

    if (toShow.length === 0) {
      return `<div style="padding:32px;text-align:center;color:var(--t3);font-size:13px;border:1px dashed var(--b1);border-radius:12px">Your team is warming up — first deliveries will surface here.</div>`
    }

    return `
      <div class="briefing-grid">
        ${toShow.slice(0, 3).map(({ emp, task }) => {
          const statusLabel = task.status === 'delivered' ? 'Ready for review'
            : task.status === 'approved' ? 'Approved'
            : task.status === 'rejected' ? 'Rejected'
            : 'Working'
          const preview = previewFromTask(task)
          return `
            <div class="brief-card" data-task-id="${task.id}">
              <div class="brief-from">${escapeHtml(emp.name)}
                <div class="brief-status"><div class="brief-dot"></div>${escapeHtml(statusLabel)}</div>
              </div>
              <div class="brief-body">${escapeHtml(preview)}</div>
              <div class="brief-actions">
                <button class="ab approve" style="font-size:10px;padding:7px 14px" onclick="navigate('db-tasks')">Review</button>
                <button class="ab recon" style="font-size:10px;padding:7px 14px" onclick="openMeeting('${emp.name}','${emp.short}','${emp.init}')">Meeting</button>
              </div>
            </div>`
        }).join('')}
      </div>
    `
  }

  function previewFromTask(task) {
    if (task.description) return task.description
    const o = Array.isArray(task.outputs) ? task.outputs[0] : null
    if (!o) return task.title
    const c = o.content || {}
    if (Array.isArray(c.hooks) && c.hooks.length) {
      const flagged = c.hooks.find((h) => h.flagged) || c.hooks[0]
      return `"${flagged.text || c.hooks[0].text}" — that's the one.`
    }
    if (Array.isArray(c.trends) && c.trends.length) {
      const t = c.trends[0]
      return `${t.topic} is up ${t.growth}. ${t.verdict}`
    }
    if (Array.isArray(c.posts) && c.posts.length) {
      return `Week built around ${c.pillars?.slice(0,2).join(', ') || c.posts.length + ' posts'}.`
    }
    return task.title
  }

  // ── Compose and insert ───────────────────────────────────────────────────
  async function render() {
    const main = document.querySelector('#view-db-dashboard .db-main-col')
    if (!main) return

    const sub = main.querySelector('.db-section-sub')
    if (!sub) return

    const [tasksRes, feedRes] = await Promise.all([fetchJSON('/api/tasks'), fetchJSON('/api/feed')])
    const tasks = tasksRes?.tasks || []
    const feed = feedRes?.items || []

    // Quick stats (after greeting/sub)
    removeIfExists('vx-quickstats')
    sub.insertAdjacentHTML('afterend', buildStatsRow(tasks))

    // Team bar (after quick stats)
    removeIfExists('vx-teambar')
    document.getElementById('vx-quickstats').insertAdjacentHTML('afterend', buildTeamBar(tasks))

    // Trend snippet (after team bar)
    removeIfExists('vx-trend')
    const trendHTML = buildTrendSnippet(feed)
    if (trendHTML) document.getElementById('vx-teambar').insertAdjacentHTML('afterend', trendHTML)

    // Rebuild the briefing grid in place
    const oldGrid = main.querySelector('.briefing-grid')
    const newGridHTML = buildBriefingCards(tasks)
    const placeholder = document.createElement('div')
    placeholder.innerHTML = newGridHTML
    if (oldGrid) {
      oldGrid.replaceWith(placeholder.firstElementChild)
    } else {
      const insertAfter = document.getElementById('vx-trend') || document.getElementById('vx-teambar') || sub
      insertAfter.insertAdjacentElement('afterend', placeholder.firstElementChild)
    }
  }

  function removeIfExists(id) {
    document.getElementById(id)?.remove()
  }

  // Trigger after enterDashboard completes and whenever the user lands on
  // the dashboard view.
  const prevEnter = window.enterDashboard
  window.enterDashboard = async function () {
    if (typeof prevEnter === 'function') await prevEnter()
    setTimeout(render, 400)
  }

  const origNavigate = window.navigate
  window.navigate = function (id) {
    const r = typeof origNavigate === 'function' ? origNavigate(id) : undefined
    if (id === 'db-dashboard') setTimeout(render, 120)
    return r
  }

  // Initial best-effort load (session-restore path)
  if (document.readyState !== 'loading') setTimeout(render, 600)
  document.addEventListener('DOMContentLoaded', () => setTimeout(render, 700))
})()
