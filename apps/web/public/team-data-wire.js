/* Team page — wire real employee + task data into the static layout.
 * Reads from window.__vxDashState (populated by dashboard-v2.js).
 */
;(function () {
  'use strict'

  var ROLES = {
    analyst:           { name: 'Maya',   title: 'Trend & Insights Analyst', init: 'M' },
    strategist:        { name: 'Jordan', title: 'Content Strategist',       init: 'J' },
    copywriter:        { name: 'Alex',   title: 'Copywriter & Script Writer', init: 'A' },
    creative_director: { name: 'Riley',  title: 'Creative Director',        init: 'R' },
  }

  function esc(s) { return String(s || '').replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] }) }
  function timeAgo(dateStr) {
    if (!dateStr) return ''
    var diff = Date.now() - new Date(dateStr).getTime()
    var mins = Math.floor(diff / 60000)
    if (mins < 60) return mins + 'm ago'
    var hrs = Math.floor(mins / 60)
    if (hrs < 24) return hrs + 'h ago'
    return Math.floor(hrs / 24) + 'd ago'
  }

  var populated = false

  function populate() {
    var view = document.getElementById('view-db-team')
    if (!view) return
    var S = window.__vxDashState
    if (!S || !S.me) return
    if (populated) return
    populated = true

    var tasks = S.tasks || []
    var company = S.me.companies && S.me.companies[0]
    var employees = company && company.employees ? company.employees : []
    var usage = S.usage

    // ── MASTHEAD STATS ──
    var stats = view.querySelectorAll('.mast .mini-stats .stat')
    if (stats.length >= 3) {
      // Active agents count
      var activeCount = employees.filter(function (e) { return e.isActive }).length
      var s0v = stats[0].querySelector('.v')
      if (s0v) s0v.innerHTML = '<em>' + activeCount + '</em>/4'

      // CEO hours saved (estimate based on tasks completed)
      var completedTasks = tasks.filter(function (t) { return t.status === 'approved' || t.status === 'delivered' }).length
      var hoursSaved = (completedTasks * 1.2).toFixed(1) // ~1.2h per task
      var s1v = stats[1].querySelector('.v')
      if (s1v) s1v.innerHTML = '<em>' + hoursSaved + '</em>h'

      // Autonomy % (tasks auto-approved vs needing review)
      var autoTasks = tasks.filter(function (t) { return t.status === 'approved' }).length
      var totalDecided = tasks.filter(function (t) { return t.status === 'approved' || t.status === 'rejected' || t.status === 'revision' }).length
      var autonomy = totalDecided > 0 ? Math.round(autoTasks / totalDecided * 100) : 0
      var s2v = stats[2].querySelector('.v')
      if (s2v) s2v.textContent = autonomy + '%'
    }

    // ── LANE STATUS UPDATES ──
    var lanes = view.querySelectorAll('.lane')
    var roleOrder = ['analyst', 'strategist', 'copywriter', 'creative_director']
    roleOrder.forEach(function (role, i) {
      if (i >= lanes.length) return
      var lane = lanes[i]
      var roleTasks = tasks.filter(function (t) { return t.employee && t.employee.role === role })
      var emp = employees.find(function (e) { return e.role === role })

      // Update status indicator
      var stEl = lane.querySelector('.st')
      if (stEl && emp) {
        var working = roleTasks.find(function (t) { return t.status === 'in_progress' })
        var delivered = roleTasks.find(function (t) { return t.status === 'delivered' })
        if (working) {
          stEl.innerHTML = '<span class="dt"></span>WORKING · ' + timeAgo(working.createdAt)
          lane.className = lane.className.replace(/\b(idle|working)\b/g, '') + ' working'
        } else if (delivered) {
          stEl.innerHTML = '<span class="dt"></span>DELIVERED · ' + timeAgo(delivered.completedAt || delivered.createdAt)
          lane.className = lane.className.replace(/\b(idle|working)\b/g, '') + ' idle'
        } else {
          stEl.innerHTML = '<span class="dt"></span>IDLE · ' + (emp.lastActive ? timeAgo(emp.lastActive) : 'ready')
          lane.className = lane.className.replace(/\b(idle|working)\b/g, '') + ' idle'
        }
      }

      // Update latest task in lane body
      var latestTask = roleTasks[0]
      if (latestTask) {
        var firstTaskEl = lane.querySelector('.task .ttl')
        if (firstTaskEl) {
          firstTaskEl.innerHTML = esc(latestTask.title || '')
        }
      }
    })

    // ── MEMBER CARD KPIs ──
    var mcards = view.querySelectorAll('.mcard')
    roleOrder.forEach(function (role, i) {
      if (i >= mcards.length) return
      var card = mcards[i]
      var roleTasks = tasks.filter(function (t) { return t.employee && t.employee.role === role })
      var emp = employees.find(function (e) { return e.role === role })

      // Update status
      var stEl = card.querySelector('.stts .st')
      if (stEl && emp) {
        var working = roleTasks.find(function (t) { return t.status === 'in_progress' })
        if (working) {
          stEl.textContent = 'WORKING · ' + timeAgo(working.createdAt)
          card.className = card.className.replace(/\b(idle|working)\b/g, '') + ' working'
        } else {
          stEl.textContent = 'IDLE · ' + (emp.lastActive ? timeAgo(emp.lastActive) : 'ready')
          card.className = card.className.replace(/\b(idle|working)\b/g, '') + ' idle'
        }
      }

      // Update KPIs
      var kpis = card.querySelectorAll('.mc-kpis .k')
      if (kpis.length >= 2) {
        // Tasks this week
        var weekAgo = Date.now() - 7 * 86400000
        var thisWeek = roleTasks.filter(function (t) { return new Date(t.createdAt).getTime() > weekAgo }).length
        var k0v = kpis[0].querySelector('.v')
        if (k0v) k0v.textContent = thisWeek

        // Completion rate
        var completed = roleTasks.filter(function (t) { return t.status === 'approved' || t.status === 'delivered' }).length
        var rate = roleTasks.length > 0 ? Math.round(completed / roleTasks.length * 100) : 0
        var k1v = kpis[1].querySelector('.v')
        if (k1v) k1v.innerHTML = '<em>' + rate + '</em>%'
      }
    })
  }

  // Wait for state then populate
  function waitAndPopulate() {
    var attempts = 0
    function check() {
      if (window.__vxDashState && window.__vxDashState.me) { populate(); return }
      if (++attempts < 40) setTimeout(check, 250)
    }
    check()
  }

  // Run on navigate to Team
  var origNav = window.navigate
  window.navigate = function (id) {
    var r = typeof origNav === 'function' ? origNav(id) : undefined
    if (id === 'db-team') setTimeout(function () { populated = false; waitAndPopulate() }, 150)
    return r
  }

  // Initial load if already on team
  waitAndPopulate()
})()
