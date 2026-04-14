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

  // Preset briefs per employee. No free-text input — the CEO picks one of
  // these cards and the task is assigned immediately with the preset's
  // title, description, and output type. Keeps the brief UX button-first.
  const BRIEFS_BY_ROLE = {
    analyst: [
      { title: 'Scan my niche for this week\'s trends', description: 'Pull the top 3 trends moving in my niche with growth %, window, and a verdict for each. Flag anything I should act on in the next 48 hours.', type: 'trend_report' },
      { title: 'Competitor scan — top 3 in my niche', description: 'Identify the three best-performing accounts in my sub-niche right now and summarize what is working for them: post formats, pillars, posting times, hook patterns.', type: 'trend_report' },
      { title: 'Which hashtags are actually working', description: 'Return 10-15 hashtags that are currently pulling reach in my niche, bucketed by size (big / mid / small). Avoid dead or oversaturated tags.', type: 'trend_report' },
      { title: 'Audience deep dive', description: 'Summarize what I know about my audience right now: demographics, peak engagement windows, content pillars they respond to best, and one thing I should stop posting.', type: 'trend_report' },
      { title: 'Why my engagement dropped', description: 'Look at the last two weeks and explain what changed. Name the posts, the formats, or the cadence shift. Propose one specific fix I can ship this week.', type: 'trend_report' },
    ],
    strategist: [
      { title: 'Plan next week\'s content', description: 'Build my weekly content calendar. 3-5 posts. Each has day, format, topic, and angle. Anchor it on my pillars and leave room for one trend-driven slot.', type: 'content_plan' },
      { title: 'Rebuild my content pillars', description: 'Look at my niche + the last month of what landed, then propose 3-4 pillars I should rotate through. Define what each pillar is, who it is for, and one example post.', type: 'content_plan' },
      { title: 'Suggest a posting cadence', description: 'Recommend how often I should post per week and on which days, based on my audience\'s active windows and my realistic production capacity.', type: 'content_plan' },
      { title: '90-day growth plan', description: 'Map out what we should ship over the next 12 weeks to move toward the goal. Break it into monthly themes and name the first two Reels for the next two weeks.', type: 'content_plan' },
      { title: 'Audit what is not working', description: 'Review recent outputs and posts and name the two weakest content slots. Propose what replaces them.', type: 'content_plan' },
    ],
    copywriter: [
      { title: '5 hooks for this week\'s top trend', description: 'Write 5 hook variations aimed at the trend Maya flagged this week. Flag your favorite and tell me why the other 4 are weaker.', type: 'hooks' },
      { title: 'Reel script — 30 seconds', description: 'Write a 30-second Reel script for the top item in this week\'s plan. Cold open, 3 beats, payoff line. No fluff.', type: 'script' },
      { title: 'Caption for my next post', description: 'Draft a caption for my next scheduled post. Keep it tight, use line breaks, punch at the end, and include a single CTA.', type: 'caption' },
      { title: '3 opening lines for a carousel', description: 'Three slide-1 hooks for a carousel on this week\'s pillar. Each needs to stop the thumb on slide 1 alone.', type: 'hooks' },
      { title: 'Rewrite my bio', description: 'Rewrite my Instagram bio to reflect my current niche, audience, and the one thing I want a new visitor to remember about me.', type: 'caption' },
    ],
    creative_director: [
      { title: 'Shot list for next Reel', description: 'Shot list for the top Reel in this week\'s plan. Opening shot, 3-5 mid shots with timestamps, closing shot, sound + editor notes.', type: 'shot_list' },
      { title: 'Pacing notes for an existing cut', description: 'Review the current pacing rhythm of my recent Reels and recommend how to cut tighter: hold lengths, beat-to-cut timing, where to add silence.', type: 'shot_list' },
      { title: 'Visual direction — new aesthetic', description: 'Propose a refreshed visual direction: palette, lighting cues, shot style, text overlay treatment. One cohesive look I can hold across posts.', type: 'shot_list' },
      { title: 'Thumbnail brief for a carousel', description: 'Design direction for a slide-1 thumbnail: type treatment, color, focal subject, and one don\'t-do that would kill the scroll stop.', type: 'shot_list' },
      { title: 'Fix the weakest Reel of the week', description: 'Pick the Reel from the last week with the weakest opening and propose exactly how to reshoot or re-edit the first 2 seconds.', type: 'shot_list' },
    ],
  }

  function openAssignModal(role, empName) {
    document.getElementById('vx-assign')?.remove()
    const briefs = BRIEFS_BY_ROLE[role] || []
    const el = document.createElement('div')
    el.id = 'vx-assign'
    el.style.cssText =
      'position:fixed;inset:0;z-index:9100;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);padding:24px'

    const cardsHtml = briefs.map((b, i) => `
      <button type="button" data-brief-idx="${i}" style="display:block;width:100%;text-align:left;background:var(--s2);border:1px solid var(--b1);border-radius:10px;padding:14px 16px;cursor:pointer;font-family:inherit;color:var(--t1);transition:border-color .15s,background .15s">
        <div style="font-size:14px;font-weight:600;margin-bottom:4px;font-family:'Syne',sans-serif">${escapeHtml(b.title)}</div>
        <div style="color:var(--t3);font-size:11px;line-height:1.5">${escapeHtml(b.description)}</div>
      </button>
    `).join('')

    el.innerHTML = `
      <div style="width:100%;max-width:520px;background:var(--s1);border:1px solid var(--b1);border-radius:14px;padding:26px;color:var(--t1);font-family:'DM Sans',sans-serif;max-height:92vh;overflow:auto">
        <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--t3);margin-bottom:4px">Brief</div>
        <h3 style="font-family:'Syne',sans-serif;font-size:20px;margin:0 0 6px">What do you want ${escapeHtml(empName)} working on?</h3>
        <div style="color:var(--t3);font-size:12px;margin-bottom:16px">Pick one. ${escapeHtml(empName)} will start on it right away.</div>
        <div id="vx-brief-list" style="display:flex;flex-direction:column;gap:10px"></div>
        <div id="vx-assign-err" style="color:#ff6b6b;font-size:12px;margin-top:10px;min-height:16px"></div>
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:14px">
          <button id="vx-assign-cancel" style="background:none;border:1px solid var(--b2);color:var(--t2);padding:10px 16px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:12px">Cancel</button>
        </div>
      </div>
    `
    el.addEventListener('click', (e) => { if (e.target === el) el.remove() })
    document.body.appendChild(el)
    const listHost = el.querySelector('#vx-brief-list')
    listHost.innerHTML = cardsHtml
    listHost.querySelectorAll('[data-brief-idx]').forEach((card) => {
      card.addEventListener('mouseenter', () => { card.style.borderColor = 'var(--t2)'; card.style.background = 'var(--s3)' })
      card.addEventListener('mouseleave', () => { card.style.borderColor = 'var(--b1)'; card.style.background = 'var(--s2)' })
      card.addEventListener('click', async () => {
        const i = Number(card.dataset.briefIdx)
        const brief = briefs[i]
        if (!brief) return
        const err = document.getElementById('vx-assign-err')
        const me = await fetch('/api/auth/me', { credentials: 'include' }).then((r) => r.ok ? r.json() : null).catch(() => null)
        const company = me?.companies?.[0]
        const employee = company?.employees?.find((e) => e.role === role)
        if (!company || !employee) {
          err.textContent = 'No company/employee found. Try refreshing.'
          return
        }
        listHost.querySelectorAll('[data-brief-idx]').forEach((c) => { c.style.opacity = '0.4'; c.disabled = true })
        card.style.opacity = '1'
        card.style.borderColor = 'var(--t1)'
        card.innerHTML += '<div style="color:var(--t3);font-size:11px;margin-top:8px">Sending…</div>'
        const result = await (window.vxAssignTask ? window.vxAssignTask({
          companyId: company.id,
          employeeId: employee.id,
          title: brief.title,
          description: brief.description,
          type: brief.type,
        }) : { ok: false, error: 'not_ready' })
        if (result.ok) {
          el.remove()
          if (typeof render === 'function') render()
          if (typeof window.navigate === 'function') window.navigate('db-tasks')
        } else if (result.limitReached) {
          el.remove()
        } else {
          err.textContent = 'Something went wrong: ' + (result.error || 'try again')
          listHost.querySelectorAll('[data-brief-idx]').forEach((c) => { c.style.opacity = '1'; c.disabled = false })
        }
      })
    })
    el.querySelector('#vx-assign-cancel').addEventListener('click', () => el.remove())
  }

  window.vxOpenAssignModal = openAssignModal

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
