/* Team Calendar — Monthly view of work + daily thoughts */
;(function () {
  // Use CSS custom properties matching vexa-shared.css platform tints
  const AGENT_COLORS = {
    analyst:           { css: 'var(--ig)',     initial: 'M', label: 'Maya' },
    strategist:        { css: 'var(--tt)',     initial: 'J', label: 'Jordan' },
    copywriter:        { css: 'var(--accent)', initial: 'A', label: 'Alex' },
    creative_director: { css: 'var(--yt)',     initial: 'R', label: 'Riley' },
    // Aliases for name-based lookup
    maya:    { css: 'var(--ig)',     initial: 'M', label: 'Maya' },
    jordan:  { css: 'var(--tt)',     initial: 'J', label: 'Jordan' },
    alex:    { css: 'var(--accent)', initial: 'A', label: 'Alex' },
    riley:   { css: 'var(--yt)',     initial: 'R', label: 'Riley' },
  }

  const TYPE_LABEL = {
    trend_report: 'Trend',
    content_plan: 'Plan',
    hooks: 'Hooks',
    caption: 'Caption',
    script: 'Script',
    shot_list: 'Brief',
    video: 'Video',
  }

  function getMonthDays(year, month) {
    const first = new Date(year, month, 1)
    const last = new Date(year, month + 1, 0)
    const daysInMonth = last.getDate()
    const startingDayOfWeek = first.getDay()

    const days = []
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null)
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i))
    }
    return days
  }

  function formatDate(d) {
    if (!d) return ''
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  function renderCalendar(tasks, thoughts) {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth()
    const days = getMonthDays(year, month)

    const monthName = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    const container = document.getElementById('team-calendar')
    if (!container) return

    // Group tasks by date
    const tasksByDate = {}
    if (Array.isArray(tasks)) {
      for (const t of tasks) {
        if (!t.completedAt && !t.createdAt) continue
        const d = formatDate(new Date(t.completedAt || t.createdAt))
        if (!tasksByDate[d]) tasksByDate[d] = []
        tasksByDate[d].push(t)
      }
    }

    // Group thoughts by date
    const thoughtsByDate = {}
    if (Array.isArray(thoughts)) {
      for (const th of thoughts) {
        const d = formatDate(new Date(th.createdAt))
        if (!thoughtsByDate[d]) thoughtsByDate[d] = []
        thoughtsByDate[d].push(th)
      }
    }

    let html = `
      <div class="calendar-header">
        <h2>${monthName}</h2>
        <div class="calendar-legend">
          <div class="legend-item">
            <div class="dot" style="background: ${AGENT_COLORS.maya.bg}"></div>
            <span>Maya</span>
          </div>
          <div class="legend-item">
            <div class="dot" style="background: ${AGENT_COLORS.jordan.bg}"></div>
            <span>Jordan</span>
          </div>
          <div class="legend-item">
            <div class="dot" style="background: ${AGENT_COLORS.alex.bg}"></div>
            <span>Alex</span>
          </div>
          <div class="legend-item">
            <div class="dot" style="background: ${AGENT_COLORS.riley.bg}"></div>
            <span>Riley</span>
          </div>
        </div>
      </div>

      <div class="calendar-grid">
        <div class="calendar-weekdays">
          <div class="weekday">Sun</div>
          <div class="weekday">Mon</div>
          <div class="weekday">Tue</div>
          <div class="weekday">Wed</div>
          <div class="weekday">Thu</div>
          <div class="weekday">Fri</div>
          <div class="weekday">Sat</div>
        </div>

        <div class="calendar-days">
    `

    for (const day of days) {
      if (!day) {
        html += '<div class="day empty"></div>'
        continue
      }

      const dateStr = formatDate(day)
      const dayTasks = tasksByDate[dateStr] || []
      const dayThoughts = thoughtsByDate[dateStr] || []

      const isToday = formatDate(new Date()) === dateStr

      html += `<div class="day ${isToday ? 'today' : ''}" data-date="${dateStr}" onclick="window.selectCalendarDay('${dateStr}')">`
      html += `  <div class="day-num">${day.getDate()}</div>`

      // Show work items (max 3)
      if (dayTasks.length > 0) {
        html += '  <div class="day-work">'
        for (const t of dayTasks.slice(0, 3)) {
          const roleKey = t.employee?.role
          const color = AGENT_COLORS[roleKey] || AGENT_COLORS.jordan
          const typeLabel = TYPE_LABEL[t.type] || t.type
          html += `    <div class="work-dot" style="background: ${color.css}" title="${typeLabel}"></div>`
        }
        if (dayTasks.length > 3) {
          html += `    <div class="work-overflow">+${dayTasks.length - 3}</div>`
        }
        html += '  </div>'
      }

      // Show thought indicator
      if (dayThoughts.length > 0) {
        html += `  <div class="thought-indicator" title="${dayThoughts.length} thought${dayThoughts.length > 1 ? 's' : ''}">${dayThoughts.length}</div>`
      }

      html += '</div>'
    }

    html += `
        </div>
      </div>
    `

    container.innerHTML = html
  }

  async function loadDayDetails(dateStr) {
    const resp = await fetch(`/api/thoughts?date=${dateStr}`, { credentials: 'include' })
    const data = await resp.json()
    return data.thoughts || []
  }

  window.selectCalendarDay = async function (dateStr) {
    const sidebar = document.getElementById('team-calendar-sidebar')
    if (!sidebar) return

    // Highlight selected day
    document.querySelectorAll('.calendar-days .day').forEach(d => d.classList.remove('selected'))
    document.querySelector(`[data-date="${dateStr}"]`)?.classList.add('selected')

    // Load thoughts for this day
    const thoughts = await loadDayDetails(dateStr)

    const d = new Date(dateStr + 'T00:00:00')
    const dayName = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

    let html = `
      <div class="sidebar-header">
        <div class="sidebar-date">${dayName}</div>
      </div>
      <div class="sidebar-content">
    `

    if (thoughts.length === 0) {
      html += `
        <div class="empty-state">
          <div class="empty-icon">NO ENTRIES</div>
          <p>No thoughts or responses yet.</p>
          <p class="hint">Add what's on your mind — your team will respond.</p>
        </div>
      `
    } else {
      html += '<div class="thoughts-list">'
      for (const thought of thoughts) {
        html += `
          <div class="thought">
            <div class="thought-header">
              <div class="thought-time">${new Date(thought.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
              <div class="thought-label">Your thought</div>
            </div>
            <div class="thought-content">${escapeHtml(thought.content)}</div>
        `

        // Render responses
        if (thought.thoughtResponses && thought.thoughtResponses.length > 0) {
          for (const resp of thought.thoughtResponses) {
            const role = resp.employee?.role
            const color = AGENT_COLORS[role] || AGENT_COLORS.jordan
            const agentName = color.label
            const respTime = new Date(resp.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })

            html += `
              <div class="response">
                <div class="response-header">
                  <div class="agent-badge">${color.initial}</div>
                  <div class="response-meta">
                    <div class="agent-name">${agentName}</div>
                    <div class="response-time">${respTime}</div>
                  </div>
                </div>
                <div class="response-content">${escapeHtml(resp.content)}</div>
              </div>
            `
          }
        } else {
          html += '<div class="response-pending">Team reviewing...</div>'
        }

        html += '</div>'
      }
      html += '</div>'
    }

    // Input for new thought
    html += `
      <div class="thought-input-area">
        <textarea id="new-thought-input" placeholder="What's on your mind?" rows="3"></textarea>
        <button class="btn-primary" onclick="window.submitThought('${dateStr}')">Share thought</button>
      </div>
    `

    html += '</div>'
    sidebar.innerHTML = html
  }

  function escapeHtml(text) {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  window.submitThought = async function (dateStr) {
    const input = document.getElementById('new-thought-input')
    if (!input || !input.value.trim()) return

    try {
      const resp = await fetch('/api/thoughts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: input.value.trim() }),
      })

      if (resp.ok) {
        input.value = ''
        // Reload the day
        window.selectCalendarDay(dateStr)
      }
    } catch (err) {
      console.error('[team-calendar] Failed to submit thought:', err)
    }
  }

  // Load initial data
  async function init() {
    try {
      const tasksResp = await fetch('/api/tasks', { credentials: 'include' })
      const tasksData = await tasksResp.json()

      const thoughtsResp = await fetch('/api/thoughts', { credentials: 'include' })
      const thoughtsData = await thoughtsResp.json()

      renderCalendar(tasksData.tasks || [], thoughtsData.thoughts || [])

      // Select today
      const today = formatDate(new Date())
      window.selectCalendarDay(today)
    } catch (err) {
      console.error('[team-calendar] Init failed:', err)
    }
  }

  // Hook into navigation — only init when Team tab is shown
  var calendarLoaded = false
  var origNav = window.navigate
  window.navigate = function (id) {
    var r = typeof origNav === 'function' ? origNav(id) : undefined
    if (id === 'db-team' && !calendarLoaded) {
      calendarLoaded = true
      setTimeout(init, 150)
    }
    return r
  }
})()
