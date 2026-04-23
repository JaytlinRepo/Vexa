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

    // ── Header: month nav + filters ──
    var html = '<div class="cal-head">'
      + '<div class="cal-head-left">'
      + '<button class="cal-nav" data-dir="-1">&larr;</button>'
      + '<h2 class="cal-month">' + monthLabel + '</h2>'
      + '<button class="cal-nav" data-dir="1">&rarr;</button>'
      + '<button class="cal-nav cal-today" data-dir="0">Today</button>'
      + '</div>'
      + '<div class="cal-filters">'
      + '<button class="cal-filter' + (activeFilter === 'all' ? ' on' : '') + '" data-role="all">All</button>'

    for (var ri = 0; ri < ROLE_LIST.length; ri++) {
      var role = ROLE_LIST[ri]
      var ag = AGENTS[role]
      html += '<button class="cal-filter' + (activeFilter === role ? ' on' : '') + '" data-role="' + role + '">'
        + '<span class="cal-dot" style="background:' + ag.css + '"></span>' + ag.label
        + '</button>'
    }
    html += '</div></div>'

    // ── Grid ──
    html += '<div class="cal-grid"><div class="cal-weekdays">'
    var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    for (var di = 0; di < 7; di++) html += '<div class="cal-wd">' + dayNames[di] + '</div>'
    html += '</div><div class="cal-days">'

    for (var ci = 0; ci < days.length; ci++) {
      var day = days[ci]
      if (!day) { html += '<div class="cal-day empty"></div>'; continue }

      var dateStr = fmtDate(day)
      var dayTasks = tasksByDate[dateStr] || []
      var dayThoughts = thoughtsByDate[dateStr] || []
      var isToday = dateStr === todayStr
      var isSel = dateStr === selectedDate
      var hasWork = dayTasks.length > 0 || dayThoughts.length > 0
      var cls = 'cal-day' + (isToday ? ' today' : '') + (isSel ? ' selected' : '') + (hasWork ? ' has-work' : '')

      html += '<div class="' + cls + '" data-date="' + dateStr + '">'
        + '<div class="cal-day-top">'
        + '<span class="cal-day-num">' + day.getDate() + '</span>'
        + (dayThoughts.length > 0 ? '<span class="cal-day-thoughts">' + dayThoughts.length + '</span>' : '')
        + '</div>'

      if (dayTasks.length > 0) {
        html += '<div class="cal-day-items">'
        var shown = dayTasks.slice(0, 3)
        for (var ti = 0; ti < shown.length; ti++) {
          var roleKey = shown[ti].employee ? shown[ti].employee.role : 'strategist'
          var agc = AGENTS[roleKey] || AGENTS.strategist
          var tLabel = TYPE_LABEL[shown[ti].type] || ''
          html += '<div class="cal-chip" style="--chip-c:' + agc.css + '">'
            + '<span class="cal-chip-i">' + agc.initial + '</span>'
            + (tLabel ? '<span class="cal-chip-l">' + tLabel + '</span>' : '')
            + '</div>'
        }
        if (dayTasks.length > 3) html += '<span class="cal-chip-more">+' + (dayTasks.length - 3) + '</span>'
        html += '</div>'
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
      if (dir === 0) {
        var now = today()
        viewYear = now.getFullYear()
        viewMonth = now.getMonth()
        selectedDate = fmtDate(now)
      } else {
        viewMonth += dir
        if (viewMonth < 0) { viewMonth = 11; viewYear-- }
        if (viewMonth > 11) { viewMonth = 0; viewYear++ }
      }
      render()
      if (dir === 0) selectDay(selectedDate)
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
    var dayEl = e.target.closest('.cal-day[data-date]')
    if (dayEl && !dayEl.classList.contains('empty')) {
      selectDay(dayEl.dataset.date)
    }
  }

  // ── Sidebar ──
  function selectDay(dateStr) {
    selectedDate = dateStr

    // Highlight
    document.querySelectorAll('.cal-days .cal-day').forEach(function (d) { d.classList.remove('selected') })
    var sel = document.querySelector('.cal-day[data-date="' + dateStr + '"]')
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

  function renderOutputContent(content, taskType, ag) {
    if (!content || typeof content !== 'object') return ''
    var html = ''

    // Trend reports (Maya)
    if (content.trends && Array.isArray(content.trends)) {
      html += '<div class="sb-detail-section"><div class="sb-detail-label">Trends</div>'
      for (var i = 0; i < Math.min(content.trends.length, 3); i++) {
        var tr = content.trends[i]
        html += '<div class="sb-detail-item">'
          + '<div class="sb-detail-item-title">' + escHtml(tr.topic || tr.keyword || '') + '</div>'
          + (tr.whyItMatters ? '<div class="sb-detail-item-body">' + escHtml(tr.whyItMatters).slice(0, 150) + '</div>' : '')
          + (tr.growthPercent ? '<span class="sb-detail-tag ok">+' + tr.growthPercent + '%</span>' : '')
          + '</div>'
      }
      html += '</div>'
    }

    // Content plan (Jordan)
    if (content.days && Array.isArray(content.days)) {
      html += '<div class="sb-detail-section"><div class="sb-detail-label">Plan</div>'
      for (var j = 0; j < Math.min(content.days.length, 5); j++) {
        var day = content.days[j]
        html += '<div class="sb-detail-item">'
          + '<div class="sb-detail-item-title">' + escHtml(day.day || day.date || '') + '</div>'
          + '<div class="sb-detail-item-body">' + escHtml(day.topic || day.content || day.description || '').slice(0, 120) + '</div>'
          + '</div>'
      }
      html += '</div>'
    }

    // Hooks (Alex)
    if (content.hooks && Array.isArray(content.hooks)) {
      html += '<div class="sb-detail-section"><div class="sb-detail-label">Hooks</div>'
      for (var k = 0; k < Math.min(content.hooks.length, 5); k++) {
        var hook = content.hooks[k]
        var hookText = typeof hook === 'string' ? hook : (hook.text || hook.hook || '')
        html += '<div class="sb-detail-hook">' + escHtml(hookText) + '</div>'
      }
      html += '</div>'
    }

    // Captions / scripts
    if (content.caption) {
      html += '<div class="sb-detail-section"><div class="sb-detail-label">Caption</div>'
        + '<div class="sb-detail-text">' + escHtml(content.caption).slice(0, 300) + '</div></div>'
    }
    if (content.script) {
      html += '<div class="sb-detail-section"><div class="sb-detail-label">Script</div>'
        + '<div class="sb-detail-text">' + escHtml(typeof content.script === 'string' ? content.script : JSON.stringify(content.script)).slice(0, 300) + '</div></div>'
    }

    // Briefs (morning/evening)
    if (content.summary) {
      html += '<div class="sb-detail-section"><div class="sb-detail-label">Summary</div>'
        + '<div class="sb-detail-text">' + escHtml(content.summary).slice(0, 400) + '</div></div>'
    }

    // Fallback: show key-value pairs
    if (!html) {
      var keys = Object.keys(content).filter(function (k) { return k !== 'tags' && k !== 'version' })
      for (var m = 0; m < Math.min(keys.length, 4); m++) {
        var val = content[keys[m]]
        var display = typeof val === 'string' ? val.slice(0, 200) : (Array.isArray(val) ? val.length + ' items' : JSON.stringify(val).slice(0, 100))
        html += '<div class="sb-detail-section"><div class="sb-detail-label">' + escHtml(keys[m]) + '</div>'
          + '<div class="sb-detail-text">' + escHtml(display) + '</div></div>'
      }
    }

    return html
  }

  function statusClass(s) {
    if (s === 'delivered' || s === 'approved') return 'ok'
    if (s === 'in_progress') return 'accent'
    return ''
  }

  function timeShort(iso) {
    if (!iso) return ''
    var d = new Date(iso)
    var h = d.getHours(); var m = d.getMinutes()
    var ampm = h >= 12 ? 'pm' : 'am'
    h = h % 12 || 12
    return h + ':' + pad(m) + ampm
  }

  function renderSidebar(sidebar, dayLabel, dateStr, dayTasks, thoughts) {
    // ── Header ──
    var html = '<div class="sb-head">'
      + '<div class="sb-day">' + dayLabel + '</div>'
      + '<div class="sb-count">' + (dayTasks.length + thoughts.length) + ' items</div>'
      + '</div>'
      + '<div class="sb-body">'

    // ── Tasks section ──
    if (dayTasks.length > 0) {
      html += '<div class="sb-section">'
        + '<div class="sb-section-head">Tasks <em>' + dayTasks.length + '</em></div>'
        + '<table class="sb-tbl"><tbody>'

      for (var i = 0; i < dayTasks.length; i++) {
        var t = dayTasks[i]
        var roleKey = t.employee ? t.employee.role : 'strategist'
        var ag = AGENTS[roleKey] || AGENTS.strategist
        var typeLabel = TYPE_LABEL[t.type] || t.type
        var status = t.status || 'pending'
        var sc = statusClass(status)

        // Build detail content from task outputs
        var detailHtml = ''
        if (t.description) {
          detailHtml += '<div class="sb-detail-desc">' + escHtml(t.description) + '</div>'
        }
        if (t.outputs && t.outputs.length > 0) {
          var out = t.outputs[t.outputs.length - 1] // latest output
          var content = out.content
          if (content) {
            detailHtml += renderOutputContent(content, t.type, ag)
          }
        }
        if (!detailHtml) {
          detailHtml = '<div class="sb-detail-empty">No output yet</div>'
        }

        html += '<tr class="sb-task-expandable" data-task-idx="' + i + '">'
          + '<td><div class="sb-task-row">'
          + '<div class="sb-port" style="border-color:' + ag.css + '">' + ag.initial + '</div>'
          + '<div class="sb-task-info">'
          + '<div class="sb-task-title">' + escHtml(t.title || typeLabel) + '</div>'
          + '<div class="sb-task-meta">' + ag.label + ' · ' + typeLabel + '</div>'
          + '</div>'
          + '</div></td>'
          + '<td class="r"><span class="sb-status' + (sc ? ' ' + sc : '') + '">' + status + '</span></td>'
          + '</tr>'
      }
      html += '</tbody></table></div>'
    }

    // ── Thoughts section ──
    if (thoughts.length > 0) {
      html += '<div class="sb-section">'
        + '<div class="sb-section-head">Thoughts <em>' + thoughts.length + '</em></div>'

      for (var j = 0; j < thoughts.length; j++) {
        var th = thoughts[j]
        html += '<div class="sb-thought">'
          + '<div class="sb-thought-head">'
          + '<span class="sb-thought-you">You</span>'
          + '<span class="sb-thought-time">' + timeShort(th.createdAt) + '</span>'
          + '</div>'
          + '<div class="sb-thought-body">' + escHtml(th.content) + '</div>'

        if (th.thoughtResponses && th.thoughtResponses.length > 0) {
          for (var k = 0; k < th.thoughtResponses.length; k++) {
            var resp = th.thoughtResponses[k]
            var role = resp.employee ? resp.employee.role : 'strategist'
            var ag2 = AGENTS[role] || AGENTS.strategist
            html += '<div class="sb-reply">'
              + '<div class="sb-reply-head">'
              + '<div class="sb-port sm" style="border-color:' + ag2.css + '">' + ag2.initial + '</div>'
              + '<span class="sb-reply-name">' + ag2.label + '</span>'
              + '<span class="sb-reply-time">' + timeShort(resp.createdAt) + '</span>'
              + '</div>'
              + '<div class="sb-reply-body">' + escHtml(resp.content) + '</div>'
              + '</div>'
          }
        } else {
          html += '<div class="sb-pending"><span class="sb-pending-dot"></span>Team reviewing</div>'
        }
        html += '</div>'
      }
      html += '</div>'
    }

    // ── Empty state ──
    if (dayTasks.length === 0 && thoughts.length === 0) {
      html += '<div class="sb-empty">'
        + '<div class="sb-empty-lbl">No entries</div>'
        + '<div class="sb-empty-hint">Share a thought — your team will respond.</div>'
        + '</div>'
    }

    html += '</div>'

    // ── Input area ──
    html += '<div class="sb-input">'
      + '<textarea id="new-thought-input" placeholder="What\'s on your mind?" rows="2"></textarea>'
      + '<button class="btn-primary" id="submit-thought-btn">Share thought</button>'
      + '</div>'

    sidebar.innerHTML = html

    // Wire task click → modal
    sidebar._dayTasks = dayTasks
    var expandRows = sidebar.querySelectorAll('.sb-task-expandable')
    expandRows.forEach(function (row) {
      row.addEventListener('click', function () {
        var idx = parseInt(row.dataset.taskIdx, 10)
        var task = sidebar._dayTasks[idx]
        if (task) openTaskModal(task)
      })
    })

    // Wire submit
    var btn = document.getElementById('submit-thought-btn')
    if (btn) btn.addEventListener('click', function () { submitThought(dateStr) })
    var textarea = document.getElementById('new-thought-input')
    if (textarea) textarea.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitThought(dateStr) }
    })
  }

  function openTaskModal(task) {
    var existing = document.getElementById('task-modal-overlay')
    if (existing) existing.remove()

    var roleKey = task.employee ? task.employee.role : 'strategist'
    var ag = AGENTS[roleKey] || AGENTS.strategist
    var typeLabel = TYPE_LABEL[task.type] || task.type
    var status = task.status || 'pending'
    var sc = statusClass(status)
    var created = task.createdAt ? new Date(task.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
    var completed = task.completedAt ? new Date(task.completedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''

    // Build output detail
    var detailHtml = ''
    if (task.description) {
      detailHtml += '<div class="tm-desc">' + escHtml(task.description) + '</div>'
    }
    if (task.outputs && task.outputs.length > 0) {
      var out = task.outputs[task.outputs.length - 1]
      if (out.content) detailHtml += renderOutputContent(out.content, task.type, ag)
    }
    if (!detailHtml) {
      detailHtml = '<div class="sb-detail-empty">No output yet — task is ' + status + '</div>'
    }

    var overlay = document.createElement('div')
    overlay.id = 'task-modal-overlay'
    overlay.className = 'tm-overlay'
    overlay.innerHTML = '<div class="tm-backdrop"></div>'
      + '<div class="tm-modal">'
      + '<div class="tm-header">'
      + '<div class="tm-header-left">'
      + '<div class="sb-port" style="border-color:' + ag.css + ';width:36px;height:36px;font-size:14px">' + ag.initial + '</div>'
      + '<div>'
      + '<div class="tm-title">' + escHtml(task.title || typeLabel) + '</div>'
      + '<div class="tm-meta">' + ag.label + ' · ' + typeLabel + ' · <span class="sb-status ' + sc + '">' + status + '</span></div>'
      + '</div>'
      + '</div>'
      + '<button class="tm-close">&times;</button>'
      + '</div>'
      + '<div class="tm-timestamps">'
      + (created ? '<span>Created ' + created + '</span>' : '')
      + (completed ? '<span>Completed ' + completed + '</span>' : '')
      + '</div>'
      + '<div class="tm-body">' + detailHtml + '</div>'
      + '</div>'

    document.body.appendChild(overlay)

    overlay.querySelector('.tm-backdrop').addEventListener('click', function () { overlay.remove() })
    overlay.querySelector('.tm-close').addEventListener('click', function () { overlay.remove() })
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc) }
    })
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

  // ── localStorage cache ──
  var LS_KEY = 'vexa_team_cal'
  function saveCache() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ ts: Date.now(), tasks: allTasks, thoughts: allThoughts }))
    } catch (e) { /* quota */ }
  }
  function loadCache() {
    try {
      var raw = localStorage.getItem(LS_KEY)
      if (!raw) return false
      var obj = JSON.parse(raw)
      if (Date.now() - obj.ts > 30 * 60 * 1000) return false
      allTasks = obj.tasks || []
      allThoughts = obj.thoughts || []
      return true
    } catch (e) { return false }
  }

  // ── Init ──
  async function init() {
    var now = today()
    viewYear = now.getFullYear()
    viewMonth = now.getMonth()
    selectedDate = fmtDate(now)

    // Render from cache instantly if available
    var hadCache = loadCache()
    if (hadCache) {
      render()
      selectDay(selectedDate)
    } else {
      var container = document.getElementById('team-calendar')
      if (container) container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;padding:80px 0"><div class="vx-spin"></div></div>'
    }

    // Fetch fresh data in background
    var results = await Promise.all([
      get('/api/tasks'),
      get('/api/thoughts'),
    ])

    allTasks = (results[0] && results[0].tasks) || []
    allThoughts = (results[1] && results[1].thoughts) || []
    saveCache()

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
