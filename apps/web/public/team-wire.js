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
          <button class="emp-card-btn view" data-assign-role="${emp.role}" data-assign-name="${emp.name}">Assign task</button>
          <button class="emp-card-btn meeting" onclick="openMeeting('${emp.name}','${emp.short}','${emp.init}')">Call meeting</button>
        </div>
      </div>
    `
  }

  const TYPE_BY_ROLE = {
    analyst: 'trend_report',
    strategist: 'content_plan',
    copywriter: 'hooks',
    creative_director: 'shot_list',
  }

  function openAssignModal(role, empName) {
    document.getElementById('vx-assign')?.remove()
    const el = document.createElement('div')
    el.id = 'vx-assign'
    el.style.cssText =
      'position:fixed;inset:0;z-index:9100;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);padding:24px'
    el.innerHTML = `
      <div style="width:100%;max-width:440px;background:var(--s1);border:1px solid var(--b1);border-radius:14px;padding:28px;color:var(--t1);font-family:'DM Sans',sans-serif">
        <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--t3);margin-bottom:4px">Assign task</div>
        <h3 style="font-family:'Syne',sans-serif;font-size:20px;margin:0 0 14px">Ask ${escapeHtml(empName)} to work on something</h3>
        <label style="display:block;font-size:11px;color:var(--t3);letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px">Title</label>
        <input id="vx-assign-title" placeholder="e.g. Hook set for morning routine Reel" style="width:100%;padding:11px 14px;background:var(--s2);border:1px solid var(--b1);border-radius:8px;color:var(--t1);font-size:14px;outline:none;font-family:inherit" />
        <label style="display:block;font-size:11px;color:var(--t3);letter-spacing:.08em;text-transform:uppercase;margin:14px 0 6px">Notes (optional)</label>
        <textarea id="vx-assign-desc" placeholder="Any context you want them to have..." rows="3" style="width:100%;padding:11px 14px;background:var(--s2);border:1px solid var(--b1);border-radius:8px;color:var(--t1);font-size:13px;resize:vertical;outline:none;font-family:inherit"></textarea>
        <div id="vx-assign-err" style="color:#ff6b6b;font-size:12px;margin-top:8px;min-height:16px"></div>
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px">
          <button id="vx-assign-cancel" style="background:none;border:1px solid var(--b2);color:var(--t2);padding:10px 16px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:12px">Cancel</button>
          <button id="vx-assign-go" style="background:var(--t1);color:var(--bg);border:none;padding:10px 18px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:600">Assign</button>
        </div>
      </div>
    `
    el.addEventListener('click', (e) => { if (e.target === el) el.remove() })
    document.body.appendChild(el)
    el.querySelector('#vx-assign-cancel').addEventListener('click', () => el.remove())
    el.querySelector('#vx-assign-go').addEventListener('click', async () => {
      const title = document.getElementById('vx-assign-title').value.trim()
      const desc = document.getElementById('vx-assign-desc').value.trim()
      const err = document.getElementById('vx-assign-err')
      if (title.length < 3) {
        err.textContent = 'Give it at least a short title.'
        return
      }
      // Look up the user's company + the employee id for this role
      const me = await fetch('/api/auth/me', { credentials: 'include' }).then((r) => r.ok ? r.json() : null).catch(() => null)
      const company = me?.companies?.[0]
      const employee = company?.employees?.find((e) => e.role === role)
      if (!company || !employee) {
        err.textContent = 'No company/employee found. Try refreshing.'
        return
      }
      const btn = document.getElementById('vx-assign-go')
      btn.disabled = true
      btn.textContent = 'Assigning…'
      const result = await (window.vxAssignTask ? window.vxAssignTask({
        companyId: company.id,
        employeeId: employee.id,
        title,
        description: desc || undefined,
        type: TYPE_BY_ROLE[role] || 'hooks',
      }) : { ok: false, error: 'not_ready' })
      if (result.ok) {
        el.remove()
        // Refresh the team page so the new task shows up
        render()
        // Also take them to tasks to see it
        if (typeof window.navigate === 'function') window.navigate('db-tasks')
      } else if (result.limitReached) {
        el.remove() // upgrade modal is already shown
      } else {
        err.textContent = 'Something went wrong: ' + (result.error || 'try again')
        btn.disabled = false
        btn.textContent = 'Assign'
      }
    })
  }

  function wireAssignButtons() {
    document.querySelectorAll('#view-db-team [data-assign-role]').forEach((btn) => {
      if (btn.dataset.vxWired) return
      btn.dataset.vxWired = '1'
      btn.addEventListener('click', () => openAssignModal(btn.dataset.assignRole, btn.dataset.assignName))
    })
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
    wireAssignButtons()
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
