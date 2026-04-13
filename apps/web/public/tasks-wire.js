/* Vexa — task list + approve/reject wiring
 *
 * After dashboard-wire.js enters the dashboard, swap the static "Recent
 * activity" rows for real tasks from /api/tasks. Wire each row's action
 * buttons to POST /api/tasks/:id/action. Re-renders after every action.
 */
;(function () {
  const API = ''
  let companyId = null

  const EMP_COLOR = {
    Maya: '#6ab4ff',
    Jordan: '#c8f060',
    Alex: '#e8c87a',
    Riley: '#b482ff',
  }

  const STATUS_LABEL = {
    delivered: 'Awaiting approval',
    pending: 'In progress',
    in_progress: 'Working',
    approved: 'Approved',
    rejected: 'Rejected',
    revision: 'Reworking',
  }

  async function fetchTasks() {
    try {
      const res = await fetch(API + '/api/tasks', { credentials: 'include' })
      if (!res.ok) return { tasks: [], companyId: null }
      return res.json()
    } catch {
      return { tasks: [], companyId: null }
    }
  }

  async function sendAction(taskId, action) {
    const res = await fetch(API + '/api/tasks/' + taskId + '/action', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    return res.ok
  }

  function timeAgo(ts) {
    const d = new Date(ts)
    const diff = Math.max(0, Date.now() - d.getTime())
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return mins + ' min ago'
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return hrs + ' hr ago'
    const days = Math.floor(hrs / 24)
    return days + 'd ago'
  }

  function renderRows(tasks) {
    const host = document.querySelector('#view-db-dashboard .task-list')
    if (!host) return
    host.innerHTML = ''
    if (tasks.length === 0) {
      const empty = document.createElement('div')
      empty.style.cssText = 'padding:18px;color:var(--t3);font-size:13px;border:1px dashed var(--b1);border-radius:10px'
      empty.textContent = 'No tasks yet. Your team is warming up — new work will show up here as it is delivered.'
      host.appendChild(empty)
      return
    }
    for (const t of tasks) {
      const row = document.createElement('div')
      row.className = 'task-row'
      row.dataset.taskId = t.id
      const name = t.employee?.name || 'Vexa'
      const color = EMP_COLOR[name] || '#ffffff'
      const initial = name.charAt(0)
      const actionable = t.status === 'delivered'
      row.innerHTML = `
        <div class="task-init" style="color:${color}">${initial}</div>
        <div>
          <div class="task-title">${escapeHtml(t.title)}</div>
          <div class="task-sub">${escapeHtml(name)} &middot; Delivered ${timeAgo(t.createdAt)}</div>
        </div>
        <div class="task-status ${t.status}">${STATUS_LABEL[t.status] || t.status}</div>
        ${actionable ? `
          <div style="display:flex;gap:6px">
            <button class="task-btn" data-action="approve">Approve</button>
            <button class="task-btn" data-action="reject" style="opacity:.7">Reject</button>
          </div>` : '<button class="task-btn" disabled style="opacity:.4;cursor:default">Done</button>'}
      `
      if (actionable) {
        row.querySelectorAll('[data-action]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            btn.disabled = true
            btn.textContent = '…'
            const ok = await sendAction(t.id, btn.dataset.action)
            if (ok) refresh()
            else btn.textContent = btn.dataset.action
          })
        })
      }
      host.appendChild(row)
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  async function refresh() {
    const { tasks, companyId: cid } = await fetchTasks()
    if (cid) companyId = cid
    renderRows(tasks || [])
  }

  // Rewire the dashboard refresh hook: after enterDashboard completes, pull tasks.
  const prevEnter = window.enterDashboard
  window.enterDashboard = async function () {
    if (typeof prevEnter === 'function') await prevEnter()
    refresh()
  }

  // If already on dashboard (e.g. session auto-restored), refresh now.
  document.addEventListener('DOMContentLoaded', () => setTimeout(refresh, 150))
  if (document.readyState !== 'loading') setTimeout(refresh, 300)
})()
