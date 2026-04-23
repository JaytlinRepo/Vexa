/* Team Calendar — Monthly view of work + daily thoughts
 * Dynamic month/year nav, agent filters, clickable days, sidebar details.
 */
;(function () {
  'use strict'

  var get = function (u) { return fetch(u, { credentials: 'include' }).then(function (r) { return r.ok ? r.json() : null }).catch(function () { return null }) }

  var AGENTS = {
    analyst:           { css: 'var(--ig)',     initial: 'M', label: 'Maya' },
    strategist:        { css: 'var(--tt)',     initial: 'J', label: 'Jordan' },
    copywriter:        { css: 'var(--accent)', initial: 'A', label: 'Alex' },
    creative_director: { css: 'var(--yt)',     initial: 'R', label: 'Riley' },
  }
  var ROLE_LIST = ['analyst', 'strategist', 'copywriter', 'creative_director']

  var TYPE_LABEL = {
    trend_report: 'Trend', content_plan: 'Plan', hooks: 'Hooks',
    caption: 'Caption', script: 'Script', shot_list: 'Brief',
    video: 'Video', morning_brief: 'Brief', evening_recap: 'Recap',
    weekly_pulse: 'Pulse',
  }

  // ── State ──
  var viewYear, viewMonth
  var allTasks = []
  var allThoughts = []
  var activeFilter = 'all' // 'all' or a role key
  var selectedDate = null

  function today() { return new Date() }

  function pad(n) { return n < 10 ? '0' + n : '' + n }

  function fmtDate(d) {
    if (!d) return ''
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  }

  function escHtml(text) {
    var d = document.createElement('div')
    d.textContent = text
    return d.innerHTML
  }

  function getMonthDays(y, m) {
    var first = new Date(y, m, 1)
    var last = new Date(y, m + 1, 0)
    var days = []
    for (var i = 0; i < first.getDay(); i++) days.push(null)
    for (var d = 1; d <= last.getDate(); d++) days.push(new Date(y, m, d))
    return days
  }

  // ── Group helpers ──
  function groupByDate(arr, dateField) {
    var map = {}
    if (!Array.isArray(arr)) return map
    for (var i = 0; i < arr.length; i++) {
      var item = arr[i]
      var raw = item[dateField]
      if (!raw) continue
      var key = fmtDate(new Date(raw))
      if (!map[key]) map[key] = []
      map[key].push(item)
    }
    return map
  }

  function filterTasks(tasks) {
    if (activeFilter === 'all') return tasks
    return tasks.filter(function (t) { return t.employee && t.employee.role === activeFilter })
  }

  // ── Render calendar ──
  function render() {
    var container = document.getElementById('team-calendar')
    if (!container) return

    var days = getMonthDays(viewYear, viewMonth)
    var monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    var todayStr = fmtDate(today())

    var filtered = filterTasks(allTasks)
    var tasksByDate = {}
    for (var i = 0; i < filtered.length; i++) {
      var t = filtered[i]
      var d = fmtDate(new Date(t.completedAt || t.createdAt))
      if (!tasksByDate[d]) tasksByDate[d] = []
      tasksByDate[d].push(t)
    }
    var thoughtsByDate = groupByDate(allThoughts, 'createdAt')

    // Header: prev/month/next + agent filters
    var html = '<div class="calendar-header">'
      + '<div style="display:flex;align-items:center;gap:12px">'
      + '<button class="cal-nav" data-dir="-1" style="cursor:pointer;background:none;border:1px solid var(--b1);border-radius:6px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;color:var(--t2);font-size:14px">&larr;</button>'
      + '<h2>' + monthLabel + '</h2>'
      + '<button class="cal-nav" data-dir="1" style="cursor:pointer;background:none;border:1px solid var(--b1);border-radius:6px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;color:var(--t2);font-size:14px">&rarr;</button>'
      + '</div>'
      + '<div class="calendar-legend">'
      + '<button class="cal-filter' + (activeFilter === 'all' ? ' on' : '') + '" data-role="all">All</button>'

    for (var ri = 0; ri < ROLE_LIST.length; ri++) {
      var role = ROLE_LIST[ri]
      var ag = AGENTS[role]
      html += '<button class="cal-filter' + (activeFilter === role ? ' on' : '') + '" data-role="' + role + '">'
        + '<span class="dot" style="background:' + ag.css + '"></span>' + ag.label
        + '</button>'
    }
    html += '</div></div>'

    // Grid
    html += '<div class="calendar-grid"><div class="calendar-weekdays">'
    var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    for (var di = 0; di < 7; di++) html += '<div class="weekday">' + dayNames[di] + '</div>'
    html += '</div><div class="calendar-days">'

    for (var ci = 0; ci < days.length; ci++) {
      var day = days[ci]
      if (!day) { html += '<div class="day empty"></div>'; continue }

      var dateStr = fmtDate(day)
      var dayTasks = tasksByDate[dateStr] || []
      var dayThoughts = thoughtsByDate[dateStr] || []
      var isToday = dateStr === todayStr
      var isSel = dateStr === selectedDate
      var cls = 'day' + (isToday ? ' today' : '') + (isSel ? ' selected' : '')

      html += '<div class="' + cls + '" data-date="' + dateStr + '">'
        + '<div class="day-num">' + day.getDate() + '</div>'

      if (dayTasks.length > 0) {
        html += '<div class="day-work">'
        var shown = dayTasks.slice(0, 3)
        for (var ti = 0; ti < shown.length; ti++) {
          var roleKey = shown[ti].employee ? shown[ti].employee.role : 'strategist'
          var ag = AGENTS[roleKey] || AGENTS.strategist
          var tLabel = TYPE_LABEL[shown[ti].type] || ''
          html += '<div class="work-chip" style="border-color:' + ag.css + '">'
            + '<span class="work-chip-dot" style="background:' + ag.css + '">' + ag.initial + '</span>'
            + (tLabel ? '<span class="work-chip-lbl">' + tLabel + '</span>' : '')
            + '</div>'
        }
        if (dayTasks.length > 3) html += '<span class="work-overflow">+' + (dayTasks.length - 3) + '</span>'
        html += '</div>'
      }

      if (dayThoughts.length > 0) {
        html += '<div class="thought-indicator">' + dayThoughts.length + '</div>'
      }

      html += '</div>'
    }

    html += '</div></div>'
    container.innerHTML = html

    // Wire events via delegation
    container.addEventListener('click', onCalendarClick)
  }

  function onCalendarClick(e) {
    // Month navigation
    var nav = e.target.closest('.cal-nav')
    if (nav) {
      var dir = parseInt(nav.dataset.dir, 10)
      viewMonth += dir
      if (viewMonth < 0) { viewMonth = 11; viewYear-- }
      if (viewMonth > 11) { viewMonth = 0; viewYear++ }
      render()
      return
    }

    // Agent filter
    var filter = e.target.closest('.cal-filter')
    if (filter) {
      activeFilter = filter.dataset.role
      render()
      // Re-select the current day if one was selected
      if (selectedDate) selectDay(selectedDate)
      return
    }

    // Day click
    var dayEl = e.target.closest('.day[data-date]')
    if (dayEl && !dayEl.classList.contains('empty')) {
      selectDay(dayEl.dataset.date)
    }
  }

  // ── Sidebar ──
  function selectDay(dateStr) {
    selectedDate = dateStr

    // Highlight
    document.querySelectorAll('.calendar-days .day').forEach(function (d) { d.classList.remove('selected') })
    var sel = document.querySelector('.day[data-date="' + dateStr + '"]')
    if (sel) sel.classList.add('selected')

    var sidebar = document.getElementById('team-calendar-sidebar')
    if (!sidebar) return

    // Show spinner while loading
    var d = new Date(dateStr + 'T00:00:00')
    var dayLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

    sidebar.innerHTML = '<div class="sidebar-header"><div class="sidebar-date">' + dayLabel + '</div></div>'
      + '<div class="sidebar-content" style="align-items:center;justify-content:center"><div class="vx-spin"></div></div>'

    // Fetch thoughts for this day
    get('/api/thoughts?date=' + dateStr).then(function (data) {
      var thoughts = (data && data.thoughts) || []

      // Also get tasks for this day
      var filtered = filterTasks(allTasks)
      var dayTasks = filtered.filter(function (t) {
        return fmtDate(new Date(t.completedAt || t.createdAt)) === dateStr
      })

      renderSidebar(sidebar, dayLabel, dateStr, dayTasks, thoughts)
    })
  }

  function renderSidebar(sidebar, dayLabel, dateStr, dayTasks, thoughts) {
    var html = '<div class="sidebar-header"><div class="sidebar-date">' + dayLabel + '</div></div>'
      + '<div class="sidebar-content">'

    // Tasks section
    if (dayTasks.length > 0) {
      html += '<div style="margin-bottom:4px"><div style="font-family:\'JetBrains Mono\',monospace;font-size:9px;font-weight:600;color:var(--t3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">WORK · ' + dayTasks.length + '</div>'
      for (var i = 0; i < dayTasks.length; i++) {
        var t = dayTasks[i]
        var roleKey = t.employee ? t.employee.role : 'strategist'
        var ag = AGENTS[roleKey] || AGENTS.strategist
        var typeLabel = TYPE_LABEL[t.type] || t.type
        var status = t.status || 'pending'
        html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--b1)">'
          + '<div class="agent-badge">' + ag.initial + '</div>'
          + '<div style="flex:1;min-width:0">'
          + '<div style="font-family:Inter,sans-serif;font-size:11px;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(t.title || typeLabel) + '</div>'
          + '<div style="font-family:\'JetBrains Mono\',monospace;font-size:9px;color:var(--t3);letter-spacing:.04em">' + ag.label + ' · ' + status + '</div>'
          + '</div></div>'
      }
      html += '</div>'
    }

    // Thoughts section
    if (thoughts.length > 0) {
      html += '<div style="font-family:\'JetBrains Mono\',monospace;font-size:9px;font-weight:600;color:var(--t3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">THOUGHTS · ' + thoughts.length + '</div>'
      html += '<div class="thoughts-list">'
      for (var j = 0; j < thoughts.length; j++) {
        var th = thoughts[j]
        html += '<div class="thought">'
          + '<div class="thought-header">'
          + '<div class="thought-label">You</div>'
          + '<div class="thought-time">' + new Date(th.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) + '</div>'
          + '</div>'
          + '<div class="thought-content">' + escHtml(th.content) + '</div>'

        if (th.thoughtResponses && th.thoughtResponses.length > 0) {
          for (var k = 0; k < th.thoughtResponses.length; k++) {
            var resp = th.thoughtResponses[k]
            var role = resp.employee ? resp.employee.role : 'strategist'
            var ag2 = AGENTS[role] || AGENTS.strategist
            html += '<div class="response">'
              + '<div class="response-header">'
              + '<div class="agent-badge">' + ag2.initial + '</div>'
              + '<div class="response-meta">'
              + '<div class="agent-name">' + ag2.label + '</div>'
              + '<div class="response-time">' + new Date(resp.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) + '</div>'
              + '</div></div>'
              + '<div class="response-content">' + escHtml(resp.content) + '</div>'
              + '</div>'
          }
        } else {
          html += '<div class="response-pending">Team reviewing...</div>'
        }
        html += '</div>'
      }
      html += '</div>'
    }

    // Empty state
    if (dayTasks.length === 0 && thoughts.length === 0) {
      html += '<div class="empty-state">'
        + '<div class="empty-icon">NO ENTRIES</div>'
        + '<p>Nothing for this day yet.</p>'
        + '<p class="hint">Share a thought — your team will respond.</p>'
        + '</div>'
    }

    // Input
    html += '</div>'
      + '<div class="thought-input-area">'
      + '<textarea id="new-thought-input" placeholder="What\'s on your mind?" rows="2"></textarea>'
      + '<button class="btn-primary" id="submit-thought-btn">Share thought</button>'
      + '</div>'

    sidebar.innerHTML = html

    // Wire submit
    var btn = document.getElementById('submit-thought-btn')
    if (btn) {
      btn.addEventListener('click', function () {
        submitThought(dateStr)
      })
    }
    // Enter to submit
    var textarea = document.getElementById('new-thought-input')
    if (textarea) {
      textarea.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          submitThought(dateStr)
        }
      })
    }
  }

  function submitThought(dateStr) {
    var input = document.getElementById('new-thought-input')
    if (!input || !input.value.trim()) return

    var content = input.value.trim()
    input.value = ''
    input.disabled = true

    fetch('/api/thoughts', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content }),
    }).then(function (r) {
      if (r.ok) {
        // Reload the sidebar
        selectDay(dateStr)
      } else {
        input.disabled = false
        input.value = content
      }
    }).catch(function () {
      input.disabled = false
      input.value = content
    })
  }

  // ── Init ──
  async function init() {
    var now = today()
    viewYear = now.getFullYear()
    viewMonth = now.getMonth()
    selectedDate = fmtDate(now)

    var container = document.getElementById('team-calendar')
    if (container) container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;padding:80px 0"><div class="vx-spin"></div></div>'

    var results = await Promise.all([
      get('/api/tasks'),
      get('/api/thoughts'),
    ])

    allTasks = (results[0] && results[0].tasks) || []
    allThoughts = (results[1] && results[1].thoughts) || []

    render()
    selectDay(selectedDate)
  }

  // Hook into navigation
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
