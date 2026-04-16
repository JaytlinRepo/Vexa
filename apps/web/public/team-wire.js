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

  function pickLatestOutput(task) {
    const outs = task?.outputs
    if (!outs || outs.length === 0) return null
    return outs.reduce((a, b) => (new Date(a.createdAt) > new Date(b.createdAt) ? a : b))
  }

  async function openTeamMeetingForRole(role) {
    const emp = EMPLOYEES.find((e) => e.role === role)
    if (!emp) return
    const tasks = await fetchTasks()
    const mine = tasks.filter((t) => t.employee?.role === role)
    const delivered = mine.find((t) => t.status === 'delivered')
    if (delivered && typeof window.openMeetingWithTaskOutput === 'function') {
      window.openMeetingWithTaskOutput({
        name: emp.name,
        role: emp.short,
        init: emp.init,
        task: delivered,
        output: pickLatestOutput(delivered),
      })
    } else if (typeof window.openMeeting === 'function') {
      window.openMeeting(emp.name, emp.short, emp.init)
    }
  }

  function wireMeetingButtons() {
    document.querySelectorAll('[data-team-meeting-role]').forEach((btn) => {
      if (btn.dataset.vxMeetingWired) return
      btn.dataset.vxMeetingWired = '1'
      btn.addEventListener('click', () => openTeamMeetingForRole(btn.dataset.teamMeetingRole))
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
          <button type="button" class="emp-card-btn meeting" data-team-meeting-role="${emp.role}">Call meeting</button>
        </div>
      </div>
    `
  }

  // Preset briefs per employee. Each one has a briefKind slug so the
  // backend routes to a specific generator — otherwise five briefs with
  // the same OutputType all produce identical output.
  // ── Free-text brief modal (replaces prebuilt topic picker) ──────
  // Agents work proactively — deliverables land in the inbox without
  // the CEO asking. This modal is for ad-hoc requests only ("I need
  // a script about X" or "Analyze this competitor").

  const DEFAULT_TYPE_BY_ROLE = {
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
      'position:fixed;inset:0;z-index:9100;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);padding:24px'

    el.innerHTML = `
      <div style="width:100%;max-width:480px;background:var(--bg);border:1px solid var(--b1);border-radius:16px;padding:28px;color:var(--t1);font-family:'DM Sans',sans-serif;backdrop-filter:blur(20px)">
        <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--t3);margin-bottom:4px">Quick brief</div>
        <h3 style="font-family:'Syne',sans-serif;font-size:20px;margin:0 0 6px">What do you need from ${escapeHtml(empName)}?</h3>
        <div style="color:var(--t3);font-size:12px;margin-bottom:16px">${escapeHtml(empName)} will start on it right away. Be specific — the more detail, the better the output.</div>
        <textarea id="vx-brief-input" rows="3" placeholder="e.g. Write 5 hooks for a carousel about morning routines" style="width:100%;padding:12px 14px;border:1px solid var(--b1);border-radius:8px;background:var(--s2);color:var(--t1);font-family:inherit;font-size:13px;line-height:1.5;resize:vertical"></textarea>
        <div id="vx-assign-err" style="color:#ff6b6b;font-size:12px;margin-top:8px;min-height:16px"></div>
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:14px">
          <button id="vx-assign-cancel" style="background:none;border:1px solid var(--b2);color:var(--t2);padding:10px 16px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:12px">Cancel</button>
          <button id="vx-assign-send" style="background:var(--t1);color:var(--inv,var(--bg));border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-family:'Syne',sans-serif;font-size:12px;font-weight:600">Send</button>
        </div>
      </div>
    `
    el.addEventListener('click', (e) => { if (e.target === el) el.remove() })
    document.body.appendChild(el)
    document.getElementById('vx-brief-input')?.focus()

    el.querySelector('#vx-assign-cancel').addEventListener('click', () => el.remove())
    el.querySelector('#vx-assign-send').addEventListener('click', async () => {
      const input = document.getElementById('vx-brief-input')
      const text = (input?.value || '').trim()
      if (!text) { document.getElementById('vx-assign-err').textContent = 'Tell ' + empName + ' what you need.'; return }

      const err = document.getElementById('vx-assign-err')
      const me = await fetch('/api/auth/me', { credentials: 'include' }).then((r) => r.ok ? r.json() : null).catch(() => null)
      const company = me?.companies?.[0]
      const employee = company?.employees?.find((e) => e.role === role)
      if (!company || !employee) { err.textContent = 'No company/employee found.'; return }

      el.querySelector('#vx-assign-send').disabled = true
      el.querySelector('#vx-assign-send').textContent = 'Sending…'

      const result = await (window.vxAssignTask ? window.vxAssignTask({
        companyId: company.id,
        employeeId: employee.id,
        title: text.slice(0, 80),
        description: text,
        type: DEFAULT_TYPE_BY_ROLE[role] || 'hooks',
      }) : { ok: false, error: 'not_ready' })

      if (result.ok) {
        el.remove()
        const init = (empName || '?')[0].toUpperCase()
        const roleTitle = role === 'analyst' ? 'Trend Analyst'
          : role === 'strategist' ? 'Content Strategist'
          : role === 'copywriter' ? 'Copywriter & Script Writer'
          : role === 'creative_director' ? 'Creative Director'
          : 'Teammate'
        // Open meeting room with working message
        if (typeof window.openMeeting === 'function') {
          window.openMeeting(empName, roleTitle, init)
          setTimeout(function () {
            var msgs = document.getElementById('mr-msgs')
            if (msgs) msgs.innerHTML = '<div class="mr-msg"><div class="mr-bubble" style="color:var(--t2);font-style:italic">On it — give me a moment.</div></div>'
          }, 200)
        }
        if (typeof render === 'function') render()
        pollAndPresent(empName, roleTitle, init, result.task?.id)
      } else if (result.limitReached) {
        el.remove()
      } else {
        err.textContent = result.error || 'Something went wrong'
        el.querySelector('#vx-assign-send').disabled = false
        el.querySelector('#vx-assign-send').textContent = 'Send'
      }
    })
  }

  window.vxOpenAssignModal = openAssignModal

  function pollAndPresent(empName, roleTitle, init, taskId) {
    if (!taskId) return
    var attempts = 0
    var poll = setInterval(async function () {
      attempts++
      if (attempts > 40) { clearInterval(poll); return }
      try {
        var res = await fetch('/api/tasks', { credentials: 'include' })
        if (!res.ok) return
        var json = await res.json()
        var task = (json.tasks || []).find(function (t) { return t.id === taskId })
        if (!task || task.status === 'in_progress' || task.status === 'pending') return
        clearInterval(poll)
        if (task.status === 'delivered') {
          var output = task.outputs && task.outputs[0]
          if (output && typeof window.openMeetingWithTaskOutput === 'function') {
            window.openMeetingWithTaskOutput({
              name: empName,
              role: roleTitle,
              init: init,
              output: output,
              task: task,
            })
          }
          if (typeof render === 'function') render()
        }
      } catch (e) { /* retry */ }
    }, 3000)
  }

  function showWorkingToast(empName, taskId) {
    const existing = document.getElementById('vx-working-toast')
    if (existing) existing.remove()
    const toast = document.createElement('div')
    toast.id = 'vx-working-toast'
    toast.setAttribute('role', 'status')
    toast.style.cssText =
      'position:fixed;bottom:22px;left:50%;transform:translateX(-50%);z-index:9300;max-width:min(420px,92vw);padding:16px 20px;border-radius:12px;background:var(--bg);border:1px solid var(--b1);color:var(--t2);font-size:13px;line-height:1.5;font-family:inherit;box-shadow:0 8px 28px rgba(0,0,0,.3);backdrop-filter:blur(20px)'
    toast.innerHTML = `<strong>${escapeHtml(empName)}</strong> is working on it…`
    document.body.appendChild(toast)

    if (!taskId) { setTimeout(() => toast.remove(), 8000); return }

    // Poll until the task is delivered, then open the meeting room
    let attempts = 0
    const poll = setInterval(async () => {
      attempts++
      if (attempts > 40) { clearInterval(poll); toast.remove(); return } // give up after ~2 min
      try {
        const res = await fetch('/api/tasks', { credentials: 'include' })
        if (!res.ok) return
        const json = await res.json()
        const task = (json.tasks || []).find((t) => t.id === taskId)
        if (!task || task.status === 'in_progress' || task.status === 'pending') return
        clearInterval(poll)
        toast.remove()
        if (task.status === 'delivered') {
          const output = task.outputs?.[0]
          if (output && typeof window.openMeetingWithTaskOutput === 'function') {
            const init = (empName || '?')[0].toUpperCase()
            const emp = EMPLOYEES.find((e) => e.name === empName)
            window.openMeetingWithTaskOutput({
              name: empName,
              role: emp?.short || 'Teammate',
              init,
              output,
              task,
            })
          }
          if (typeof render === 'function') render()
        }
      } catch { /* network blip, retry next tick */ }
    }, 3000)
  }

  function wireAssignButtons() {
    document.querySelectorAll('.emp-cards [data-assign-role]').forEach((btn) => {
      if (btn.dataset.vxWired) return
      btn.dataset.vxWired = '1'
      btn.addEventListener('click', () => openAssignModal(btn.dataset.assignRole, btn.dataset.assignName))
    })
  }

  async function render() {
    // Find every .emp-cards container on the page — could be the standalone
    // team view, the unified Work page's team section, or both.
    const hosts = document.querySelectorAll('.emp-cards')
    if (hosts.length === 0) return
    const tasks = await fetchTasks()
    const byRole = { analyst: [], strategist: [], copywriter: [], creative_director: [] }
    for (const t of tasks) {
      const role = t.employee?.role
      if (role && byRole[role]) byRole[role].push(t)
    }
    const html = EMPLOYEES.map((e) => cardHTML(e, byRole[e.role] || [])).join('')
    hosts.forEach((host) => { host.innerHTML = html })
    wireAssignButtons()
    wireMeetingButtons()
  }

  const origNavigate = window.navigate
  window.navigate = function (id) {
    const r = typeof origNavigate === 'function' ? origNavigate(id) : undefined
    if (id === 'db-team' || id === 'db-tasks') setTimeout(render, 80)
    return r
  }

  const prevEnter = window.enterDashboard
  window.enterDashboard = async function () {
    if (typeof prevEnter === 'function') await prevEnter()
    setTimeout(render, 250)
  }

  // Expose for work-wire.js so the unified Work page can re-render team
  // cards into its own host the moment it's built.
  window.vxRenderTeam = render

  // Any time a task changes (brief just landed delivered) re-render the
  // team cards so the pill flips from Working → Output ready.
  window.addEventListener('vx-task-changed', () => setTimeout(render, 60))
})()
