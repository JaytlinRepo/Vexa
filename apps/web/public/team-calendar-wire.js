/* Team Calendar — Monthly view of work + daily thoughts
 * Dynamic month/year nav, agent filters, clickable days, sidebar details.
 */
;(function () {
  'use strict'

  var get = function (u) { return fetch(u, { credentials: 'include' }).then(function (r) { return r.ok ? r.json() : null }).catch(function () { return null }) }

  /** Surface API errors only when they look like human sentences */
  function friendlyAssignMsg (raw) {
    if (raw == null || raw === '') return 'Couldn\'t assign that. Try again.'
    var s = String(raw).trim()
    if (s.length > 100) return 'Couldn\'t assign that. Try again.'
    if (/^[a-z][a-z0-9_]*$/i.test(s) && s.indexOf('_') !== -1) return 'Couldn\'t assign that. Try again.'
    return s
  }

  var AGENTS = {
    analyst:           { css: 'var(--ig)',     initial: 'M', label: 'Maya' },
    strategist:        { css: 'var(--tt)',     initial: 'J', label: 'Jordan' },
    creative_director: { css: 'var(--yt)',     initial: 'R', label: 'Riley' },
  }
  // Alex (copywriter) is shelved — excluded from ROLE_LIST and filter pills
  var ROLE_LIST = ['analyst', 'strategist', 'creative_director']

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
  var allMeetings = []  // ended meetings with decisions/summaries
  var activeFilter = 'all' // 'all' or a role key
  var selectedDate = null
  var companyId = null
  var employeesByRole = {} // role → employee object (with id)
  // Persists which agent the user picked in the Assign modal so the
  // selection survives re-renders triggered by new task data arriving.
  var assignSelectedRole = null

  // Sensible default task type per role so a Maya pick doesn't ship 'caption'
  var DEFAULT_TYPE_BY_ROLE = {
    analyst: 'trend_report',
    strategist: 'content_plan',
    copywriter: 'hooks',
    creative_director: 'shot_list',
  }

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

  // ── Plan helper ──
  // Pulls the days array from the most recent approved content_plan output
  // and returns a date→entry map for overlaying on future calendar cells.
  // Plan day labels like "Monday"/"Tuesday" map to the next occurrence
  // starting today; explicit dates pass through.
  function getPlannedContentByDate() {
    var plans = allTasks.filter(function (t) {
      return t.type === 'content_plan' && t.status === 'approved' && t.outputs && t.outputs.length > 0
    })
    if (plans.length === 0) return {}
    plans.sort(function (a, b) {
      return new Date(b.completedAt || b.createdAt) - new Date(a.completedAt || a.createdAt)
    })
    var output = plans[0].outputs[0]
    var content = output && output.content
    var days = content && Array.isArray(content.days) ? content.days : []
    if (days.length === 0) return {}

    var dayNameMap = { sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6 }
    var todayDt = today()
    // Anchor at start of THIS week (Sunday). "Monday" in the plan means this
    // week's Monday — even if it's already past. Past plan days harmlessly
    // overlap with the actual activity chips that already render there.
    var planAnchor = new Date(todayDt)
    planAnchor.setHours(0, 0, 0, 0)
    planAnchor.setDate(planAnchor.getDate() - planAnchor.getDay())
    var byDate = {}
    var anchor = new Date(planAnchor)

    for (var i = 0; i < days.length; i++) {
      var d = days[i]
      if (!d) continue
      var dateStr = null

      // Explicit ISO/date string wins
      var rawDate = d.date || d.publishDate || d.scheduledFor || null
      if (rawDate) {
        var parsed = new Date(rawDate)
        if (!isNaN(parsed.getTime())) dateStr = fmtDate(parsed)
      }

      // Named day → next occurrence
      if (!dateStr && d.day) {
        var k = String(d.day).toLowerCase().trim()
        if (dayNameMap.hasOwnProperty(k)) {
          var target = dayNameMap[k]
          var cursor = new Date(anchor)
          while (cursor.getDay() !== target) cursor.setDate(cursor.getDate() + 1)
          dateStr = fmtDate(cursor)
          // Move anchor past this day so the next "Tuesday" lands on the
          // following week even when the plan lists multiple Tuesdays.
          anchor = new Date(cursor); anchor.setDate(anchor.getDate() + 1)
        }
      }

      // Index in plan → today + i (last-resort fallback)
      if (!dateStr) {
        var fallback = new Date(todayDt)
        fallback.setDate(fallback.getDate() + i)
        dateStr = fmtDate(fallback)
      }

      if (!byDate[dateStr]) byDate[dateStr] = []
      byDate[dateStr].push(d)
    }
    return byDate
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
    // Future cells get planned-content overlay from the latest approved
    // Jordan content_plan. This is the single biggest fix for the calendar
    // feeling like dead space ahead of today.
    var plannedByDate = getPlannedContentByDate()

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
      var dayPlanned = plannedByDate[dateStr] || []
      var isToday = dateStr === todayStr
      var isSel = dateStr === selectedDate
      var isFuture = dateStr > todayStr
      var hasWork = dayTasks.length > 0 || dayThoughts.length > 0 || dayPlanned.length > 0
      var cls = 'cal-day'
        + (isToday ? ' today' : '')
        + (isSel ? ' selected' : '')
        + (hasWork ? ' has-work' : '')
        + (dayPlanned.length > 0 ? ' has-plan' : '')

      html += '<div class="' + cls + '" data-date="' + dateStr + '">'
        + '<div class="cal-day-top">'
        + '<span class="cal-day-num">' + day.getDate() + '</span>'
        + '<div class="cal-day-top-r">'
        + (dayThoughts.length > 0 ? '<span class="cal-day-thoughts">' + dayThoughts.length + '</span>' : '')
        + '<button class="cal-day-add" data-add-date="' + dateStr + '">+</button>'
        + '</div>'
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

      // Planned-content overlay: shows what Jordan's approved content
      // plan calls for on this date. Italic serif to distinguish from
      // past-tense agent activity chips. Renders on all days — past
      // overlays harmlessly coexist with actual activity.
      if (dayPlanned.length > 0) {
        html += '<div class="cal-day-planned">'
        var planShown = dayPlanned.slice(0, 2)
        for (var pi = 0; pi < planShown.length; pi++) {
          var pd = planShown[pi]
          var planText = pd.topic || pd.content || pd.description || pd.title || pd.theme || ''
          if (!planText) continue
          html += '<div class="cal-day-plan">' + escHtml(String(planText).slice(0, 40)) + '</div>'
        }
        if (dayPlanned.length > 2) html += '<span class="cal-chip-more">+' + (dayPlanned.length - 2) + '</span>'
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

    // "+" button on day cell → open sidebar with add focus
    var addBtn = e.target.closest('.cal-day-add')
    if (addBtn) {
      e.stopPropagation()
      selectDay(addBtn.dataset.addDate)
      // Focus the textarea after sidebar renders
      setTimeout(function () {
        var ta = document.getElementById('new-thought-input')
        if (ta) ta.focus()
      }, 200)
      return
    }

    // Day click
    var dayEl = e.target.closest('.cal-day[data-date]')
    if (dayEl && !dayEl.classList.contains('empty')) {
      selectDay(dayEl.dataset.date)
    }
  }

  // ── Day click ──
  // Sidebar used to render per-day details. Now sidebar is the always-on
  // Operations panel and day click opens a modal showing that day's items.
  function selectDay(dateStr) {
    selectedDate = dateStr

    // Highlight
    document.querySelectorAll('.cal-days .cal-day').forEach(function (d) { d.classList.remove('selected') })
    var sel = document.querySelector('.cal-day[data-date="' + dateStr + '"]')
    if (sel) sel.classList.add('selected')

    openDayModal(dateStr)
  }

  function getDayItems(dateStr) {
    var thoughts = allThoughts.filter(function (th) {
      return th && th.createdAt && fmtDate(new Date(th.createdAt)) === dateStr
    })
    var filtered = filterTasks(allTasks)
    var dayTasks = filtered.filter(function (t) {
      return fmtDate(new Date(t.completedAt || t.createdAt)) === dateStr
    })
    return { thoughts: thoughts, dayTasks: dayTasks }
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

  /** Readable labels for task status (avoid raw enum strings in the UI). */
  function friendlyTaskStatus(s) {
    var raw = String(s || 'pending').trim()
    if (!raw) return 'Pending'
    var map = {
      pending: 'Pending',
      in_progress: 'In progress',
      delivered: 'Delivered',
      approved: 'Approved',
      failed: 'Needs attention',
      cancelled: 'Cancelled',
      canceled: 'Cancelled',
      queued: 'Queued',
      completed: 'Completed',
      ready: 'Ready',
      blocked: 'Blocked',
    }
    if (map[raw]) return map[raw]
    if (/^[a-z][a-z0-9_]*$/i.test(raw) && raw.indexOf('_') !== -1) {
      return raw.split('_').map(function (w) {
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
      }).join(' ')
    }
    return raw.charAt(0).toUpperCase() + raw.slice(1)
  }

  function timeShort(iso) {
    if (!iso) return ''
    var d = new Date(iso)
    var h = d.getHours(); var m = d.getMinutes()
    var ampm = h >= 12 ? 'pm' : 'am'
    h = h % 12 || 12
    return h + ':' + pad(m) + ampm
  }

  // ── Date helpers ──
  function relativeTime(iso) {
    if (!iso) return ''
    var ms = Date.now() - new Date(iso).getTime()
    var s = Math.round(ms / 1000)
    if (s < 60) return 'just now'
    var m = Math.round(s / 60)
    if (m < 60) return m + 'm ago'
    var h = Math.round(m / 60)
    if (h < 24) return h + 'h ago'
    var d = Math.round(h / 24)
    if (d < 7) return d + 'd ago'
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  function dayBucketLabel(iso) {
    var d = new Date(iso)
    var dStr = fmtDate(d)
    var todayStr = fmtDate(today())
    var yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
    var yStr = fmtDate(yesterday)
    if (dStr === todayStr) return 'Today'
    if (dStr === yStr) return 'Yesterday'
    var ageMs = Date.now() - d.getTime()
    if (ageMs < 7 * 86400000) return 'Earlier this week'
    if (ageMs < 30 * 86400000) return 'Earlier this month'
    return 'Older'
  }

  // Lightweight toast — used after journal posts to confirm the team got it.
  function showJournalToast(text) {
    var existing = document.getElementById('journal-toast')
    if (existing) existing.remove()
    var t = document.createElement('div')
    t.id = 'journal-toast'
    t.className = 'journal-toast'
    t.textContent = text
    document.body.appendChild(t)
    setTimeout(function () { t.classList.add('on') }, 10)
    setTimeout(function () {
      t.classList.remove('on')
      setTimeout(function () { if (t.parentNode) t.remove() }, 300)
    }, 3200)
  }

  // ── Brief strip (top of Team tab) ──
  // The Team tab is the home of THE PLAN. Other tabs handle metrics (HQ),
  // pending content (Studio), and tasks. This strip summarizes the plan's
  // shape and offers two ways to interact with the team.
  function renderBriefStrip() {
    var strip = document.getElementById('team-brief-strip')
    if (!strip) return

    var summary = getPlanSummary()

    strip.innerHTML = ''
      + '<div class="brief-main brief-' + escHtml(summary.kind) + '">'
      + '<div class="brief-msg">' + escHtml(summary.text) + '</div>'
      + '</div>'
      + '<div class="brief-actions">'
      + '<button class="brief-btn brief-btn-primary" data-action="brief">Brief work</button>'
      + '<button class="brief-btn brief-btn-secondary" data-action="talk">Talk to team</button>'
      + '</div>'

    // Wire CTAs
    strip.querySelectorAll('.brief-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var act = btn.dataset.action
        if (act === 'brief') {
          openAssignModal()
        } else if (act === 'talk') {
          // Scroll the journal into view and focus its textarea
          var sidebar = document.getElementById('team-calendar-sidebar')
          var ta = document.getElementById('new-thought-input')
          if (sidebar && ta) {
            // Scroll the input into view inside the sidebar's scroll container
            var sbRect = sidebar.getBoundingClientRect()
            var taRect = ta.getBoundingClientRect()
            sidebar.scrollTo({ top: sidebar.scrollTop + (taRect.top - sbRect.top) - 16, behavior: 'smooth' })
            setTimeout(function () { ta.focus() }, 300)
          } else if (ta) {
            ta.focus()
          }
        }
      })
    })
  }

  // Summarize the plan's shape over the next 7 days. Used by brief strip.
  function getPlanSummary() {
    var planned = getPlannedContentByDate()
    var todayStr = fmtDate(today())
    var coveredDays = 0
    var totalItems = 0
    for (var i = 0; i < 7; i++) {
      var d = new Date()
      d.setDate(d.getDate() + i)
      d.setHours(0, 0, 0, 0)
      var ds = fmtDate(d)
      if (planned[ds] && planned[ds].length > 0) {
        coveredDays++
        totalItems += planned[ds].length
      }
    }

    if (totalItems === 0) {
      return {
        kind: 'noplan',
        text: 'No content plan yet — brief Jordan to map out your week.',
      }
    }
    if (coveredDays >= 5) {
      return {
        kind: 'full',
        text: 'Your week is mapped: ' + totalItems + ' item' + (totalItems === 1 ? '' : 's') + ' across ' + coveredDays + ' days.',
      }
    }
    return {
      kind: 'partial',
      text: coveredDays + ' day' + (coveredDays === 1 ? '' : 's') + ' planned this week, ' + (7 - coveredDays) + ' open.',
    }
  }

  // ── Operations sidebar (always-on; replaces the per-day sidebar) ──
  // Three blocks, top to bottom:
  //   PLAN AHEAD — next 7 days from Jordan's approved content_plan
  //   DECIDED    — meeting decisions/summaries (the team's memory)
  //   JOURNAL    — thoughts with inline capture + agent threads
  // Removed: NOW (live agent status — Studio/HQ owns this) and APPROVED
  // (folder-list — folded into PLAN AHEAD with inline content).
  function renderOpsSidebar() {
    var sidebar = document.getElementById('team-calendar-sidebar')
    if (!sidebar) return

    // Reuse the input value if user was mid-typing — re-renders shouldn't
    // wipe the textarea. Same for assignSelectedRole (module state above).
    var draft = ''
    var existingInput = document.getElementById('new-thought-input')
    if (existingInput) draft = existingInput.value || ''

    var html = ''
    html += renderPlanAheadBlock()
    html += renderDecidedBlock()
    html += renderJournalBlock(draft)

    sidebar.innerHTML = html

    wireOpsSidebar()
  }

  // Plan ahead — next 7 days of Jordan's approved content_plan.
  // The Team tab's primary block: it's what the user came here to see.
  function renderPlanAheadBlock() {
    var planned = getPlannedContentByDate()

    // Find the most recent approved content_plan to attribute the plan
    var planTask = null
    for (var pi = 0; pi < allTasks.length; pi++) {
      var pt = allTasks[pi]
      if (pt.type === 'content_plan' && pt.status === 'approved') {
        if (!planTask || new Date(pt.completedAt || pt.createdAt) > new Date(planTask.completedAt || planTask.createdAt)) {
          planTask = pt
        }
      }
    }

    var html = '<section class="ops-block ops-plan">'
      + '<header class="ops-block-head"><h3>Plan ahead</h3>'
      + '<span class="ops-block-hint">Next 7 days</span>'
      + '</header>'

    // Build entries for the next 7 days (today inclusive)
    var entries = []
    for (var i = 0; i < 7; i++) {
      var d = new Date()
      d.setDate(d.getDate() + i)
      d.setHours(0, 0, 0, 0)
      var ds = fmtDate(d)
      var items = planned[ds] || []
      entries.push({ date: d, ds: ds, items: items })
    }

    var hasAny = entries.some(function (e) { return e.items.length > 0 })
    if (!hasAny) {
      html += '<div class="ops-empty">'
        + '<div class="ops-empty-lbl">No plan yet</div>'
        + '<div class="ops-empty-hint">Brief Jordan and they\u2019ll map your week.</div>'
        + '<button class="ops-empty-cta" data-action="assign:strategist">Brief Jordan</button>'
        + '</div></section>'
      return html
    }

    // Plan attribution row
    if (planTask) {
      var ag = AGENTS.strategist
      html += '<div class="ops-plan-source">'
        + '<div class="ops-port sm" style="border-color:' + ag.css + '">' + ag.initial + '</div>'
        + '<span class="ops-plan-source-text">From ' + ag.label + '\u2019s plan, ' + relativeTime(planTask.completedAt || planTask.createdAt) + '</span>'
        + '</div>'
    }

    // Day-by-day entries
    for (var ei = 0; ei < entries.length; ei++) {
      var e = entries[ei]
      var dayLabel = ei === 0 ? 'Today' : (ei === 1 ? 'Tomorrow' : e.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }))
      var isOpen = e.items.length === 0

      html += '<div class="ops-plan-day' + (isOpen ? ' open-slot' : '') + '">'
        + '<div class="ops-plan-day-label">' + escHtml(dayLabel) + '</div>'

      if (isOpen) {
        html += '<div class="ops-plan-day-empty">Open slot</div>'
      } else {
        for (var j = 0; j < e.items.length; j++) {
          var pd = e.items[j]
          var topic = pd.topic || pd.content || pd.description || pd.title || pd.theme || ''
          var notes = pd.notes || pd.brief || pd.detail || pd.why || ''
          html += '<div class="ops-plan-item">'
            + '<div class="ops-plan-item-topic">' + escHtml(String(topic).slice(0, 120)) + '</div>'
            + (notes ? '<div class="ops-plan-item-note">' + escHtml(String(notes).slice(0, 180)) + '</div>' : '')
            + '</div>'
        }
      }
      html += '</div>'
    }

    html += '</section>'
    return html
  }

  function renderDecidedBlock() {
    var html = '<section class="ops-block ops-decided">'
      + '<header class="ops-block-head"><h3>Decided</h3>'
      + '<span class="ops-block-hint">From meetings</span>'
      + '</header>'

    if (!allMeetings || allMeetings.length === 0) {
      html += '<div class="ops-empty-thin">No meeting decisions yet. Open a meeting from the Work tab to capture decisions.</div>'
        + '</section>'
      return html
    }

    var shown = 0
    for (var i = 0; i < allMeetings.length && shown < 5; i++) {
      var m = allMeetings[i]
      var decisions = Array.isArray(m.decisions) ? m.decisions : []
      var roleKey = m.employee ? m.employee.role : 'strategist'
      var ag = AGENTS[roleKey] || AGENTS.strategist

      // Skip empty meetings (no summary, no decisions)
      if (!m.summary && decisions.length === 0) continue
      shown++

      html += '<article class="ops-decision">'
        + '<div class="ops-decision-head">'
        + '<div class="ops-port sm" style="border-color:' + ag.css + '">' + ag.initial + '</div>'
        + '<div class="ops-decision-meta">'
        + '<span class="ops-decision-name">' + ag.label + '</span>'
        + '<span class="ops-decision-time">' + relativeTime(m.endedAt) + '</span>'
        + '</div>'
        + '</div>'

      if (m.summary) {
        html += '<div class="ops-decision-summary">' + escHtml(String(m.summary).slice(0, 220)) + '</div>'
      }
      if (decisions.length > 0) {
        html += '<ul class="ops-decision-list">'
        for (var d = 0; d < Math.min(decisions.length, 3); d++) {
          var dec = decisions[d]
          var line = typeof dec === 'string' ? dec : (dec && (dec.decision || dec.actionItem || dec.text)) || ''
          if (line) html += '<li>' + escHtml(String(line).slice(0, 180)) + '</li>'
        }
        html += '</ul>'
      }
      html += '</article>'
    }

    if (shown === 0) {
      html += '<div class="ops-empty-thin">No meeting decisions yet.</div>'
    }
    html += '</section>'
    return html
  }

  function renderJournalBlock(draft) {
    var html = '<section class="ops-block ops-journal">'
      + '<header class="ops-block-head"><h3>Journal</h3>'
      + '<span class="ops-block-hint">Thoughts \u2192 the team replies</span>'
      + '</header>'

      + '<div class="ops-thought-input">'
      + '<textarea id="new-thought-input" placeholder="Share a thought, observation, or constraint." rows="2">' + escHtml(draft) + '</textarea>'
      + '<button class="ops-thought-send" id="submit-thought-btn">Share</button>'
      + '</div>'

    if (allThoughts.length === 0) {
      html += '<div class="ops-empty-thin">Your thoughts and the team\u2019s replies will live here.</div>'
        + '</section>'
      return html
    }

    var lastBucket = ''
    var shown = 0
    for (var i = 0; i < allThoughts.length && shown < 12; i++) {
      var th = allThoughts[i]
      if (!th || !th.createdAt) continue
      shown++
      var bucket = dayBucketLabel(th.createdAt)
      if (bucket !== lastBucket) {
        html += '<div class="ops-bucket">' + bucket + '</div>'
        lastBucket = bucket
      }
      html += '<article class="ops-thought">'
        + '<div class="ops-thought-head">'
        + '<span class="ops-thought-you">You</span>'
        + '<span class="ops-thought-time">' + relativeTime(th.createdAt) + '</span>'
        + '</div>'
        + '<div class="ops-thought-body">' + escHtml(th.content) + '</div>'

      var responses = Array.isArray(th.thoughtResponses) ? th.thoughtResponses : []
      if (responses.length > 0) {
        for (var r = 0; r < responses.length; r++) {
          var resp = responses[r]
          var role = resp.employee ? resp.employee.role : 'strategist'
          var ag = AGENTS[role] || AGENTS.strategist
          html += '<div class="ops-reply">'
            + '<div class="ops-reply-head">'
            + '<div class="ops-port sm" style="border-color:' + ag.css + '">' + ag.initial + '</div>'
            + '<span class="ops-reply-name">' + ag.label + '</span>'
            + '<span class="ops-reply-time">' + relativeTime(resp.createdAt) + '</span>'
            + '</div>'
            + '<div class="ops-reply-body">' + escHtml(resp.content) + '</div>'
            + '</div>'
        }
      } else {
        html += '<div class="ops-pending"><span class="ops-pending-dot"></span>Team reviewing</div>'
      }
      html += '</article>'
    }

    html += '</section>'
    return html
  }

  function wireOpsSidebar() {
    var sidebar = document.getElementById('team-calendar-sidebar')
    if (!sidebar) return

    // Empty-state CTA in the Plan ahead block ("Brief Jordan")
    var emptyCta = sidebar.querySelector('.ops-empty-cta')
    if (emptyCta) {
      emptyCta.addEventListener('click', function () {
        var act = emptyCta.dataset.action || ''
        if (act.indexOf('assign:') === 0) {
          var role = act.slice('assign:'.length)
          if (role && AGENTS[role]) assignSelectedRole = role
          openAssignModal()
        }
      })
    }

    // Thought submit (Enter or button)
    var thoughtBtn = document.getElementById('submit-thought-btn')
    if (thoughtBtn) thoughtBtn.addEventListener('click', function () { submitThought(fmtDate(today())) })
    var thoughtArea = document.getElementById('new-thought-input')
    if (thoughtArea) thoughtArea.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitThought(fmtDate(today())) }
    })

  }

  // Legacy renderSidebar — kept as a stub in case anything still calls it.
  // Old per-day render path is replaced by openDayModal + renderOpsSidebar.
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
        var statusLabel = friendlyTaskStatus(status)
        var sc = statusClass(status)

        // Build detail content from task outputs
        var detailHtml = ''
        if (t.description) {
          detailHtml += '<div class="sb-detail-desc">' + escHtml(t.description) + '</div>'
        }
        if (t.outputs && t.outputs.length > 0) {
          var out = t.outputs[0] // latest output
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
          + '<td class="r"><span class="sb-status' + (sc ? ' ' + sc : '') + '">' + escHtml(statusLabel) + '</span></td>'
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
        + '<div class="sb-empty-hint">Share a thought or assign work below.</div>'
        + '</div>'
    }

    html += '</div>'

    // ── Add to calendar input ──
    html += '<div class="sb-add">'
      + '<div class="sb-add-tabs">'
      + '<button class="sb-add-tab on" data-tab="thought">Thought</button>'
      + '<button class="sb-add-tab" data-tab="task">Assign work</button>'
      + '</div>'

      // Thought input
      + '<div class="sb-add-pane" id="pane-thought">'
      + '<textarea id="new-thought-input" placeholder="What\'s on your mind?" rows="2"></textarea>'
      + '<button class="btn-primary" id="submit-thought-btn">Share thought</button>'
      + '</div>'

      // Task assignment input
      + '<div class="sb-add-pane" id="pane-task" style="display:none">'
      + '<div class="sb-add-agents">'
    for (var ai = 0; ai < ROLE_LIST.length; ai++) {
      var assignAg = AGENTS[ROLE_LIST[ai]]
      html += '<button class="sb-agent-pick" data-role="' + ROLE_LIST[ai] + '">'
        + '<div class="sb-port sm" style="border-color:' + assignAg.css + '">' + assignAg.initial + '</div>'
        + '<span>' + assignAg.label + '</span>'
        + '</button>'
    }
    html += '</div>'
      + '<select id="task-type-select" class="sb-add-select">'
      + '<option value="trend_report">Trend report</option>'
      + '<option value="content_plan">Content plan</option>'
      + '<option value="hooks">Hooks</option>'
      + '<option value="caption">Caption</option>'
      + '<option value="script">Script</option>'
      + '<option value="shot_list">Shot list</option>'
      + '</select>'
      + '<textarea id="new-task-desc" placeholder="Describe what you need..." rows="2"></textarea>'
      + '<button class="btn-primary" id="submit-task-btn">Assign</button>'
      + '</div>'
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

    // Wire add tabs
    var tabs = sidebar.querySelectorAll('.sb-add-tab')
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) { t.classList.remove('on') })
        tab.classList.add('on')
        var paneT = document.getElementById('pane-thought')
        var paneW = document.getElementById('pane-task')
        if (tab.dataset.tab === 'thought') {
          if (paneT) paneT.style.display = ''
          if (paneW) paneW.style.display = 'none'
        } else {
          if (paneT) paneT.style.display = 'none'
          if (paneW) paneW.style.display = ''
        }
      })
    })

    // Wire agent pick — also reset the type dropdown to that role's default
    var selectedRole = null
    var agentBtns = sidebar.querySelectorAll('.sb-agent-pick')
    var typeSelectEl = document.getElementById('task-type-select')
    agentBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        agentBtns.forEach(function (b) { b.classList.remove('on') })
        btn.classList.add('on')
        selectedRole = btn.dataset.role
        if (typeSelectEl && DEFAULT_TYPE_BY_ROLE[selectedRole]) {
          typeSelectEl.value = DEFAULT_TYPE_BY_ROLE[selectedRole]
        }
      })
    })

    // Wire thought submit
    var thoughtBtn = document.getElementById('submit-thought-btn')
    if (thoughtBtn) thoughtBtn.addEventListener('click', function () { submitThought(dateStr) })
    var thoughtArea = document.getElementById('new-thought-input')
    if (thoughtArea) thoughtArea.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitThought(dateStr) }
    })

    // Wire task submit
    var taskBtn = document.getElementById('submit-task-btn')
    if (taskBtn) taskBtn.addEventListener('click', function () {
      var desc = document.getElementById('new-task-desc')
      var typeSelect = document.getElementById('task-type-select')
      if (!selectedRole) {
        agentBtns.forEach(function (b) { b.classList.add('flash') })
        setTimeout(function () { agentBtns.forEach(function (b) { b.classList.remove('flash') }) }, 600)
        return
      }
      if (!desc || !desc.value.trim()) return

      var taskType = typeSelect ? typeSelect.value : (DEFAULT_TYPE_BY_ROLE[selectedRole] || 'hooks')
      submitTask(dateStr, selectedRole, taskType, desc.value.trim())
    })
  }

  // ── Day modal ──
  // Shows everything that happened (or is queued) on a given date. Replaces
  // the old "selectDay renders sidebar" pattern.
  function openDayModal(dateStr) {
    var existing = document.getElementById('day-modal-overlay')
    if (existing) existing.remove()

    var d = new Date(dateStr + 'T00:00:00')
    var dayLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    var items = getDayItems(dateStr)
    var dayTasks = items.dayTasks
    var thoughts = items.thoughts

    var bodyHtml = ''
    if (dayTasks.length === 0 && thoughts.length === 0) {
      bodyHtml += '<div class="dm-empty">No work or thoughts on this day.</div>'
    }

    if (dayTasks.length > 0) {
      bodyHtml += '<div class="dm-section"><div class="dm-section-head">Tasks <em>' + dayTasks.length + '</em></div>'
      for (var i = 0; i < dayTasks.length; i++) {
        var t = dayTasks[i]
        var roleKey = t.employee ? t.employee.role : 'strategist'
        var ag = AGENTS[roleKey] || AGENTS.strategist
        var typeLabel = TYPE_LABEL[t.type] || t.type
        var status = t.status || 'pending'
        var statusLabel = friendlyTaskStatus(status)
        var sc = statusClass(status)
        bodyHtml += '<button class="dm-task" data-task-id="' + escHtml(t.id) + '">'
          + '<div class="ops-port" style="border-color:' + ag.css + '">' + ag.initial + '</div>'
          + '<div class="dm-task-body">'
          + '<div class="dm-task-title">' + escHtml(t.title || typeLabel) + '</div>'
          + '<div class="dm-task-meta">' + ag.label + ' \u00b7 ' + typeLabel + '</div>'
          + '</div>'
          + '<span class="sb-status ' + sc + '">' + escHtml(statusLabel) + '</span>'
          + '</button>'
      }
      bodyHtml += '</div>'
    }

    if (thoughts.length > 0) {
      bodyHtml += '<div class="dm-section"><div class="dm-section-head">Thoughts <em>' + thoughts.length + '</em></div>'
      for (var j = 0; j < thoughts.length; j++) {
        var th = thoughts[j]
        bodyHtml += '<article class="dm-thought">'
          + '<div class="dm-thought-time">' + timeShort(th.createdAt) + '</div>'
          + '<div class="dm-thought-body">' + escHtml(th.content) + '</div>'
        var responses = Array.isArray(th.thoughtResponses) ? th.thoughtResponses : []
        for (var r = 0; r < responses.length; r++) {
          var resp = responses[r]
          var role = resp.employee ? resp.employee.role : 'strategist'
          var rag = AGENTS[role] || AGENTS.strategist
          bodyHtml += '<div class="dm-reply">'
            + '<span class="dm-reply-name" style="color:' + rag.css + '">' + rag.label + '</span>'
            + ' \u00b7 ' + escHtml(resp.content)
            + '</div>'
        }
        bodyHtml += '</article>'
      }
      bodyHtml += '</div>'
    }

    var overlay = document.createElement('div')
    overlay.id = 'day-modal-overlay'
    overlay.className = 'tm-overlay'
    overlay.innerHTML = '<div class="tm-backdrop"></div>'
      + '<div class="tm-modal dm-modal">'
      + '<div class="tm-header">'
      + '<div class="tm-header-left"><div><div class="tm-title">' + dayLabel + '</div>'
      + '<div class="tm-meta">' + (dayTasks.length + thoughts.length) + ' item' + (dayTasks.length + thoughts.length === 1 ? '' : 's') + '</div>'
      + '</div></div>'
      + '<button class="tm-close">&times;</button>'
      + '</div>'
      + '<div class="tm-body">' + bodyHtml + '</div>'
      + '</div>'

    document.body.appendChild(overlay)

    function onEsc(e) { if (e.key === 'Escape') closeOverlay() }
    function closeOverlay() {
      document.removeEventListener('keydown', onEsc)
      if (overlay.parentNode) overlay.remove()
    }
    overlay.querySelector('.tm-backdrop').addEventListener('click', closeOverlay)
    overlay.querySelector('.tm-close').addEventListener('click', closeOverlay)
    document.addEventListener('keydown', onEsc)

    overlay.querySelectorAll('[data-task-id]').forEach(function (el) {
      el.addEventListener('click', function () {
        var id = el.dataset.taskId
        var task = allTasks.find(function (t) { return t.id === id })
        if (task) { closeOverlay(); openTaskModal(task) }
      })
    })
  }

  // ── Assign modal ──
  // Replaces the old per-day "Assign work" panel that lived in the sidebar.
  // No longer date-bound — tasks are created with createdAt = now regardless,
  // so coupling assignment to a calendar day was misleading.
  function openAssignModal() {
    var existing = document.getElementById('assign-modal-overlay')
    if (existing) existing.remove()

    var html = '<div class="tm-backdrop"></div>'
      + '<div class="tm-modal am-modal">'
      + '<div class="tm-header">'
      + '<div class="tm-header-left"><div><div class="tm-title">Assign work</div>'
      + '<div class="tm-meta">Pick an agent and brief them</div>'
      + '</div></div>'
      + '<button class="tm-close">&times;</button>'
      + '</div>'
      + '<div class="tm-body am-body">'
      + '<div class="am-label">Who</div>'
      + '<div class="am-agents">'
    for (var ai = 0; ai < ROLE_LIST.length; ai++) {
      var role = ROLE_LIST[ai]
      var ag = AGENTS[role]
      var on = (assignSelectedRole === role) ? ' on' : ''
      html += '<button class="am-agent' + on + '" data-role="' + role + '">'
        + '<div class="ops-port" style="border-color:' + ag.css + '">' + ag.initial + '</div>'
        + '<span class="am-agent-name">' + ag.label + '</span>'
        + '</button>'
    }
    html += '</div>'
      + '<div class="am-label">What</div>'
      + '<select id="am-type" class="am-select">'
      + '<option value="trend_report">Trend report</option>'
      + '<option value="content_plan">Content plan</option>'
      + '<option value="hooks">Hooks</option>'
      + '<option value="caption">Caption</option>'
      + '<option value="script">Script</option>'
      + '<option value="shot_list">Shot list</option>'
      + '</select>'
      + '<div class="am-label">Brief</div>'
      + '<textarea id="am-desc" placeholder="What do you need? Be specific \u2014 the more context, the better the output." rows="4"></textarea>'
      + '<button class="am-submit" id="am-submit">Assign</button>'
      + '<div class="am-err" id="am-err"></div>'
      + '</div>'
      + '</div>'

    var overlay = document.createElement('div')
    overlay.id = 'assign-modal-overlay'
    overlay.className = 'tm-overlay'
    overlay.innerHTML = html
    document.body.appendChild(overlay)

    function onEsc(e) { if (e.key === 'Escape') closeOverlay() }
    function closeOverlay() {
      document.removeEventListener('keydown', onEsc)
      if (overlay.parentNode) overlay.remove()
    }
    overlay.querySelector('.tm-backdrop').addEventListener('click', closeOverlay)
    overlay.querySelector('.tm-close').addEventListener('click', closeOverlay)
    document.addEventListener('keydown', onEsc)

    var typeEl = document.getElementById('am-type')
    if (assignSelectedRole && DEFAULT_TYPE_BY_ROLE[assignSelectedRole]) {
      typeEl.value = DEFAULT_TYPE_BY_ROLE[assignSelectedRole]
    }
    var agentBtns = overlay.querySelectorAll('.am-agent')
    agentBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        agentBtns.forEach(function (b) { b.classList.remove('on') })
        btn.classList.add('on')
        assignSelectedRole = btn.dataset.role
        if (typeEl && DEFAULT_TYPE_BY_ROLE[assignSelectedRole]) {
          typeEl.value = DEFAULT_TYPE_BY_ROLE[assignSelectedRole]
        }
      })
    })

    var submit = document.getElementById('am-submit')
    var err = document.getElementById('am-err')
    submit.addEventListener('click', function () {
      err.textContent = ''
      var desc = document.getElementById('am-desc')
      if (!assignSelectedRole) {
        agentBtns.forEach(function (b) { b.classList.add('flash') })
        setTimeout(function () { agentBtns.forEach(function (b) { b.classList.remove('flash') }) }, 600)
        err.textContent = 'Pick an agent first.'
        return
      }
      var text = (desc && desc.value || '').trim()
      if (!text) { err.textContent = 'Add a brief.'; return }
      var taskType = typeEl ? typeEl.value : (DEFAULT_TYPE_BY_ROLE[assignSelectedRole] || 'hooks')
      submit.disabled = true
      submit.textContent = 'Assigning…'
      submitTaskFromModal(assignSelectedRole, taskType, text, closeOverlay, function (msg) {
        submit.disabled = false
        submit.textContent = 'Assign'
        if (err) err.textContent = msg || 'Couldn\'t assign that. Try again.'
      })
    })
  }

  // Variant of submitTask that doesn't depend on a sidebar button. Calls
  // back to the modal on success/failure to update its UI.
  function submitTaskFromModal(role, type, description, onSuccess, onFailure) {
    var employee = employeesByRole[role]
    if (!companyId || !employee) {
      loadIdentity().then(function () {
        var emp2 = employeesByRole[role]
        if (companyId && emp2) {
          submitTaskFromModal(role, type, description, onSuccess, onFailure)
        } else {
          onFailure('We couldn\'t load your team. Refresh the page and try again.')
        }
      })
      return
    }

    var payload = {
      companyId: companyId,
      employeeId: employee.id,
      title: description.slice(0, 80),
      description: description,
      type: type,
    }

    var send = window.vxAssignTask
      ? window.vxAssignTask(payload)
      : fetch('/api/tasks', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }).then(function (r) {
          if (!r.ok) return { ok: false }
          return r.json().then(function (data) { return { ok: true, task: data.task } })
        })

    Promise.resolve(send).then(function (result) {
      if (result && result.ok) {
        if (result.task) allTasks.unshift(result.task)
        render()
        renderOpsSidebar()
        onSuccess()
      } else {
        onFailure((result && result.error) ? friendlyAssignMsg(result.error) : 'Couldn\'t assign that. Try again.')
      }
    }).catch(function () { onFailure('Can\'t connect right now. Try again.') })
  }

  function openTaskModal(task) {
    var existing = document.getElementById('task-modal-overlay')
    if (existing) existing.remove()

    var roleKey = task.employee ? task.employee.role : 'strategist'
    var ag = AGENTS[roleKey] || AGENTS.strategist
    var typeLabel = TYPE_LABEL[task.type] || task.type
    var status = task.status || 'pending'
    var statusLabel = friendlyTaskStatus(status)
    var sc = statusClass(status)
    var created = task.createdAt ? new Date(task.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
    var completed = task.completedAt ? new Date(task.completedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''

    // Build output detail
    var detailHtml = ''
    if (task.description) {
      detailHtml += '<div class="tm-desc">' + escHtml(task.description) + '</div>'
    }
    if (task.outputs && task.outputs.length > 0) {
      var out = task.outputs[0]
      if (out.content) detailHtml += renderOutputContent(out.content, task.type, ag)
    }
    if (!detailHtml) {
      detailHtml = '<div class="sb-detail-empty">No output yet. Current step: ' + escHtml(statusLabel) + '</div>'
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
      + '<div class="tm-meta">' + ag.label + ' · ' + typeLabel + ' · <span class="sb-status ' + sc + '">' + escHtml(statusLabel) + '</span></div>'
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

    function onEsc(e) {
      if (e.key === 'Escape') closeModal()
    }
    function closeModal() {
      document.removeEventListener('keydown', onEsc)
      if (overlay.parentNode) overlay.remove()
    }
    overlay.querySelector('.tm-backdrop').addEventListener('click', closeModal)
    overlay.querySelector('.tm-close').addEventListener('click', closeModal)
    document.addEventListener('keydown', onEsc)
  }

  function submitTask(dateStr, role, type, description) {
    var btn = document.getElementById('submit-task-btn')
    if (btn) btn.disabled = true

    var employee = employeesByRole[role]
    if (!companyId || !employee) {
      // Identity not loaded yet (network blip or me-fetch failed at init).
      // Trigger a retry and re-attempt the assign once it lands.
      if (btn) btn.textContent = 'Loading team…'
      loadIdentity().then(function () {
        if (btn) btn.disabled = false
        var emp2 = employeesByRole[role]
        if (companyId && emp2) {
          if (btn) btn.textContent = 'Assign'
          // Recurse once with the now-populated identity.
          submitTask(dateStr, role, type, description)
        } else {
          if (btn) {
            btn.textContent = 'Team unavailable — retry'
            setTimeout(function () { if (btn) btn.textContent = 'Assign' }, 2400)
          }
        }
      })
      return
    }

    var payload = {
      companyId: companyId,
      employeeId: employee.id,
      title: description.slice(0, 80),
      description: description,
      type: type,
    }

    var send = window.vxAssignTask
      ? window.vxAssignTask(payload)
      : fetch('/api/tasks', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }).then(function (r) {
          if (!r.ok) return { ok: false }
          return r.json().then(function (data) { return { ok: true, task: data.task } })
        })

    Promise.resolve(send).then(function (result) {
      if (result && result.ok) {
        if (result.task) allTasks.unshift(result.task)
        // New tasks land on today's cell (createdAt = now). Jump the
        // calendar to today so the user sees the task they just assigned.
        var now = today()
        if (viewYear !== now.getFullYear() || viewMonth !== now.getMonth()) {
          viewYear = now.getFullYear()
          viewMonth = now.getMonth()
        }
        render()
        renderOpsSidebar()
      } else {
        if (btn) {
          btn.disabled = false
          if (result && result.error) {
            var raw = String(result.error)
            var friendly = /^[a-z][a-z0-9_]*$/i.test(raw.trim()) || raw.length > 80
              ? 'Couldn\'t assign — try again.'
              : raw.slice(0, 56)
            btn.textContent = friendly
            setTimeout(function () { if (btn) btn.textContent = 'Assign' }, 2200)
          } else {
            btn.textContent = 'Couldn\'t assign — try again.'
            setTimeout(function () { if (btn) btn.textContent = 'Assign' }, 2200)
          }
        }
      }
    }).catch(function () {
      if (btn) {
        btn.disabled = false
        btn.textContent = 'Can\'t connect — try again'
        setTimeout(function () { if (btn) btn.textContent = 'Assign' }, 2200)
      }
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
        return r.json().then(function (data) {
          // POST returns the thought directly (see thoughts.ts:112). Some old
          // shapes wrap it; tolerate either.
          var thought = (data && data.thought) ? data.thought : data
          if (thought && thought.id) {
            // Ensure the new thought has a thoughtResponses array so the
            // sidebar renders "Team reviewing" instead of crashing.
            if (!thought.thoughtResponses) thought.thoughtResponses = []
            allThoughts.unshift(thought)
          }
          // Re-render grid, ops sidebar, brief strip. Then surface a
          // toast confirming the team picked it up — closes the loop on
          // "is anything actually going to change because of this thought?"
          render()
          renderOpsSidebar()
          renderBriefStrip()
          showJournalToast('Captured. The team will fold this into upcoming briefs.')
        })
      } else {
        input.disabled = false
        input.value = content
      }
    }).catch(function () {
      input.disabled = false
      input.value = content
    })
  }

  // Server-side caching handles fast responses — no localStorage needed

  // ── Identity load (companyId + employees) ──
  // Cached for the page lifetime; re-runs only on explicit retry from submitTask.
  // identityState: 'idle' before first load, 'loading' during a fetch,
  // 'ready' once companyId is set, 'error' if the fetch returned no company.
  var identityState = 'idle'
  var identityLoadingPromise = null

  function loadIdentity() {
    if (identityLoadingPromise) return identityLoadingPromise
    identityState = 'loading'
    identityLoadingPromise = get('/api/auth/me').then(function (me) {
      var company = me && me.companies && me.companies[0]
      if (!company) {
        identityState = 'error'
        identityLoadingPromise = null
        return null
      }
      companyId = company.id
      employeesByRole = {}
      var emps = company.employees || []
      for (var i = 0; i < emps.length; i++) {
        if (emps[i] && emps[i].role) employeesByRole[emps[i].role] = emps[i]
      }
      identityState = 'ready'
      identityLoadingPromise = null
      return company
    }).catch(function () {
      identityState = 'error'
      identityLoadingPromise = null
      return null
    })
    return identityLoadingPromise
  }

  // ── Refresh tasks/thoughts/meetings from server (used by event listener + init) ──
  function refreshData() {
    return Promise.all([
      get('/api/tasks'),
      get('/api/thoughts'),
      get('/api/meeting'),
    ]).then(function (results) {
      allTasks = (results[0] && results[0].tasks) || []
      allThoughts = (results[1] && results[1].thoughts) || []
      allMeetings = (results[2] && results[2].meetings) || []
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

    // Identity + data in parallel. Identity failure isn't fatal for
    // viewing the calendar — only blocks Assign — so we don't bail here.
    await Promise.all([loadIdentity(), refreshData()])

    render()
    renderOpsSidebar()
    renderBriefStrip()
  }

  // Hook into navigation — refresh data on every visit so cross-wire changes
  // (e.g. an agent delivering an output, a meeting creating a task) reflect
  // when the user comes back to the Team tab.
  var calendarLoaded = false
  var origNav = window.navigate
  window.navigate = function (id) {
    var r = typeof origNav === 'function' ? origNav(id) : undefined
    if (id === 'db-team') {
      if (!calendarLoaded) {
        calendarLoaded = true
        setTimeout(init, 150)
      } else {
        // Re-fetch and re-render. Identity is stable.
        refreshData().then(function () {
          render()
          renderOpsSidebar()
        })
      }
    }
    return r
  }

  // Listen for cross-wire task changes so the calendar updates when, e.g.,
  // a meeting or the agent drawer creates/approves a task elsewhere.
  window.addEventListener('vx-task-changed', function () {
    if (!calendarLoaded) return
    refreshData().then(function () {
      render()
      renderOpsSidebar()
    })
  })
})()
