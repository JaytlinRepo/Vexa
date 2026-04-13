/* Vexa — team page: render real per-employee status into #view-db-team.
 * Each of the four employee cards shows the most recent task's title +
 * a status pill derived from that task's state.
 */
;(function () {
  const EMPLOYEES = [
    { role: 'analyst',           name: 'Maya',   title: 'Trend & Insights Analyst', init: 'M', short: 'Trend Analyst' },
    { role: 'strategist',        name: 'Jordan', title: 'Content Strategist',       init: 'J', short: 'Content Strategist' },
    { role: 'copywriter',        name: 'Alex',   title: 'Copywriter & Script Writer', init: 'A', short: 'Copywriter' },
    { role: 'creative_director', name: 'Riley',  title: 'Creative Director',        init: 'R', short: 'Creative Director' },
  ]

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
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

  function statusFor(tasks) {
    if (tasks.length === 0) return { pill: 'Warming up', line: 'No deliveries yet — first output coming soon.' }
    const delivered = tasks.filter((t) => t.status === 'delivered')
    const inProgress = tasks.filter((t) => t.status === 'in_progress' || t.status === 'pending')
    const latest = tasks[0]
    if (delivered.length > 0) {
      return { pill: 'Output ready', line: `${delivered[0].title} — awaiting your review.` }
    }
    if (inProgress.length > 0) {
      return { pill: 'Working', line: `In progress: ${inProgress[0].title}` }
    }
    return { pill: 'Done', line: `Last: ${latest.title} (${latest.status}).` }
  }

  function cardHTML(emp, tasks) {
    const status = statusFor(tasks)
    return `
      <div class="emp-card">
        <div class="emp-card-top">
          <div class="emp-card-who">
            <div class="emp-card-init">${emp.init}</div>
            <div>
              <div class="emp-card-name">${escapeHtml(emp.name)}</div>
              <div class="emp-card-role">${escapeHtml(emp.title)}</div>
            </div>
          </div>
          <span class="emp-card-status-tag">${escapeHtml(status.pill)}</span>
        </div>
        <div class="emp-card-status">Status: <strong>${escapeHtml(status.line)}</strong></div>
        <div class="emp-card-actions">
          <button class="emp-card-btn view" onclick="navigate('db-tasks')">View work</button>
          <button class="emp-card-btn meeting" onclick="openMeeting('${emp.name}','${emp.short}','${emp.init}')">Call meeting</button>
        </div>
      </div>
    `
  }

  async function render() {
    const host = document.querySelector('#view-db-team .emp-cards')
    if (!host) return
    const tasks = await fetchTasks()
    const byRole = { analyst: [], strategist: [], copywriter: [], creative_director: [] }
    for (const t of tasks) {
      const role = t.employee?.role
      if (role && byRole[role]) byRole[role].push(t)
    }
    // Tasks already come back ordered by createdAt desc, so byRole[role][0] is newest.
    host.innerHTML = EMPLOYEES.map((e) => cardHTML(e, byRole[e.role] || [])).join('')
  }

  const origNavigate = window.navigate
  window.navigate = function (id) {
    const r = typeof origNavigate === 'function' ? origNavigate(id) : undefined
    if (id === 'db-team') setTimeout(render, 80)
    return r
  }

  const prevEnter = window.enterDashboard
  window.enterDashboard = async function () {
    if (typeof prevEnter === 'function') await prevEnter()
    setTimeout(render, 250)
  }
})()
