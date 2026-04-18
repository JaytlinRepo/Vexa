/* Sovexa — tasks page (#view-db-tasks): render the full list with filter tabs.
 * Replaces the static .out-card entries in #tasks-list-view with a live render
 * off GET /api/tasks, grouped by status with clickable filter tabs.
 */
;(function () {
  const STATUS_LABEL = {
    delivered: 'Awaiting review',
    pending: 'In progress',
    in_progress: 'In progress',
    approved: 'Completed',
    rejected: 'Rejected',
    revision: 'Reworking',
  }

  const FILTER_GROUPS = {
    awaiting: ['delivered'],
    progress: ['pending', 'in_progress', 'revision'],
    completed: ['approved'],
    rejected: ['rejected'],
    all: ['delivered', 'pending', 'in_progress', 'revision', 'approved', 'rejected'],
  }

  let currentFilter = 'all'

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    } catch {
      return ''
    }
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

  async function sendAction(taskId, actionType, feedback) {
    const body = { action: actionType }
    if (feedback) body.feedback = feedback
    const res = await fetch('/api/tasks/' + taskId + '/action', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.ok
  }

  function taskCard(t) {
    const emp = t.employee?.name || 'Sovexa'
    const actionable = t.status === 'delivered'
    return `
      <div class="out-card" data-task-id="${t.id}" data-status="${t.status}">
        <div class="out-head">
          <span class="out-from">${escapeHtml(emp)} · ${escapeHtml(formatType(t.type))} · ${escapeHtml(t.title)}</span>
          <span class="out-when">${escapeHtml(fmtDate(t.createdAt))}</span>
        </div>
        <div class="out-body">
          <p style="color:var(--t2);font-size:13px;line-height:1.6;margin:0">${escapeHtml(t.description || '—')}</p>
          ${t.outputs && t.outputs[0] ? outputPreview(t.outputs[0]) : ''}
        </div>
        <div class="out-foot">
          <span class="task-status ${t.status}" style="font-size:10px;padding:4px 10px;border-radius:100px;background:var(--s3);color:var(--t2);letter-spacing:.1em;text-transform:uppercase">${escapeHtml(STATUS_LABEL[t.status] || t.status)}</span>
          ${actionable
            ? `<button class="ab approve" data-action="approve">Approve</button>
               <button class="ab recon" data-action="reject">Reject</button>`
            : ''}
        </div>
      </div>
    `
  }

  function formatType(t) {
    return String(t || 'task').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  }

  function outputPreview(output) {
    const c = output.content || {}
    if (Array.isArray(c.hooks)) {
      return `<ul style="margin:12px 0 0;padding-left:18px;color:var(--t2);font-size:13px;line-height:1.8">
        ${c.hooks.slice(0, 3).map((h) => `<li${h.flagged ? ' style="color:var(--t1);font-weight:500"' : ''}>${escapeHtml(h.text || '')}</li>`).join('')}
      </ul>`
    }
    if (Array.isArray(c.trends)) {
      return `<ul style="margin:12px 0 0;padding-left:18px;color:var(--t2);font-size:13px;line-height:1.8">
        ${c.trends.slice(0, 3).map((t) => `<li><strong>${escapeHtml(t.topic || '')}</strong> — ${escapeHtml(t.growth || '')} <span style="opacity:.7">· ${escapeHtml(t.verdict || '')}</span></li>`).join('')}
      </ul>`
    }
    if (Array.isArray(c.posts)) {
      return `<ul style="margin:12px 0 0;padding-left:18px;color:var(--t2);font-size:13px;line-height:1.8">
        ${c.posts.slice(0, 3).map((p) => `<li><strong>${escapeHtml(p.day || '')}</strong> — ${escapeHtml(p.format || '')}: ${escapeHtml(p.topic || '')}</li>`).join('')}
      </ul>`
    }
    return ''
  }

  function renderTabs(tasks) {
    const bar = document.querySelector('#view-db-tasks .out-nav')
    if (!bar) return
    const count = (group) => tasks.filter((t) => FILTER_GROUPS[group].includes(t.status)).length
    bar.innerHTML = `
      <button class="out-btn ${currentFilter === 'all' ? 'active' : ''}" data-f="all">All (${count('all')})</button>
      <button class="out-btn ${currentFilter === 'awaiting' ? 'active' : ''}" data-f="awaiting">Awaiting review (${count('awaiting')})</button>
      <button class="out-btn ${currentFilter === 'progress' ? 'active' : ''}" data-f="progress">In progress (${count('progress')})</button>
      <button class="out-btn ${currentFilter === 'completed' ? 'active' : ''}" data-f="completed">Completed (${count('completed')})</button>
      <button class="out-btn ${currentFilter === 'rejected' ? 'active' : ''}" data-f="rejected">Rejected (${count('rejected')})</button>
    `
    bar.querySelectorAll('button[data-f]').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentFilter = btn.dataset.f
        render()
      })
    })
  }

  async function render() {
    const listHost = document.getElementById('tasks-list-view')
    if (!listHost) return
    const tasks = await fetchTasks()
    renderTabs(tasks)

    const filtered = tasks.filter((t) => FILTER_GROUPS[currentFilter].includes(t.status))
    if (filtered.length === 0) {
      listHost.innerHTML = '<div style="padding:32px;text-align:center;color:var(--t3);font-size:13px;border:1px dashed var(--b1);border-radius:12px">No tasks match this filter yet.</div>'
      return
    }
    listHost.innerHTML = filtered.map(taskCard).join('')

    listHost.querySelectorAll('.out-card').forEach((card) => {
      const id = card.dataset.taskId
      card.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          btn.disabled = true
          let feedback
          if (btn.dataset.action === 'reject') {
            feedback = window.prompt('What should change? (optional but helps the revision)', '')
            if (feedback === null) {
              btn.disabled = false
              return
            }
          }
          const ok = await sendAction(id, btn.dataset.action, feedback || undefined)
          if (ok) render()
        })
      })
    })

    const focusId = sessionStorage.getItem('vxFocusTaskId')
    if (focusId) {
      sessionStorage.removeItem('vxFocusTaskId')
      if (typeof window.switchTasksView === 'function') window.switchTasksView('list')
      const el = listHost.querySelector('.out-card[data-task-id="' + focusId + '"]')
      if (el) {
        requestAnimationFrame(() => {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' })
          el.style.boxShadow = '0 0 0 2px var(--t1)'
          setTimeout(() => {
            el.style.boxShadow = ''
          }, 4500)
        })
      }
    }
  }

  // Pre-render the list so when the CEO toggles to it (or work-wire stacks
  // it below the calendar) it's already populated. Calendar remains the
  // default view — unified Work page expects it on top.
  const origNavigate = window.navigate
  window.navigate = function (id) {
    const r = typeof origNavigate === 'function' ? origNavigate(id) : undefined
    if (id === 'db-tasks') {
      setTimeout(() => {
        if (typeof window.switchTasksView === 'function') window.switchTasksView('calendar')
        render()
      }, 80)
    }
    return r
  }

  const prevEnter = window.enterDashboard
  window.enterDashboard = async function () {
    if (typeof prevEnter === 'function') await prevEnter()
    setTimeout(render, 300)
  }
})()
