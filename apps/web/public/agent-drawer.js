/* Sovexa — Agent Drawer Panel
 *
 * Slide-out panel from the right showing an agent's profile, services,
 * schedule, current work, and history. Opens when a team card is clicked
 * (not the Brief/Meeting buttons). Each service is a one-tap task creator.
 */
;(function () {
  var drawer = null
  var backdrop = null
  var currentRole = null

  var AGENTS = {
    analyst: {
      name: 'Maya',
      title: 'Trend & Insights Analyst',
      init: 'M',
      color: '#6ab4ff',
      personality: 'Data-driven and precise. References numbers, spots patterns, and delivers insights with urgency.',
      schedule: 'Delivers a weekly pulse every Monday at 9am automatically. Scans your niche daily.',
      services: [
        { kind: 'weekly_trends', label: 'Weekly Trends', desc: 'What\'s rising in your niche right now — growth %, urgency, and suggested hooks.', type: 'trend_analysis' },
        { kind: 'competitor_scan', label: 'Competitor Scan', desc: 'What competitors are doing, what\'s working for them, and where you can win.', type: 'trend_analysis' },
        { kind: 'audience_deep_dive', label: 'Audience Deep Dive', desc: 'Who your audience really is — demographics, peak times, and what they engage with.', type: 'trend_analysis' },
        { kind: 'hashtag_report', label: 'Hashtag Strategy', desc: 'Big, mid, and small hashtag buckets optimized for your niche and audience size.', type: 'trend_analysis' },
        { kind: 'engagement_diagnosis', label: 'Engagement Diagnosis', desc: 'Why your engagement dropped and exactly what to fix.', type: 'performance_review' },
      ],
    },
    strategist: {
      name: 'Jordan',
      title: 'Content Strategist',
      init: 'J',
      color: '#c8f060',
      personality: 'Calm and organized. Thinks in systems, frameworks, and long-term growth. Plans your content week by week.',
      schedule: 'Delivers a weekly content plan every Sunday at 7pm. Audits and adjusts mid-week automatically.',
      services: [
        { kind: 'weekly_plan', label: 'Weekly Plan', desc: 'A full week of content — formats, topics, angles, and timing. Ready to approve.', type: 'content_planning' },
        { kind: 'pillar_rebuild', label: 'Pillar Rebuild', desc: 'Rebuild your content pillars from scratch. What to keep, what to kill, what to start.', type: 'content_planning' },
        { kind: 'cadence_plan', label: 'Posting Cadence', desc: 'When to post, how often, and which formats — optimized for your audience.', type: 'content_planning' },
        { kind: 'ninety_day_plan', label: '90-Day Plan', desc: 'Three months mapped out — themes, goals, and must-ship content per month.', type: 'content_planning' },
        { kind: 'slot_audit', label: 'Slot Audit', desc: 'Find your 2 weakest content slots and replace them with higher-performing formats.', type: 'content_planning' },
      ],
    },
    copywriter: {
      name: 'Alex',
      title: 'Copywriter & Script Writer',
      init: 'A',
      color: '#e8c87a',
      personality: 'Creative, punchy, and opinionated. Pushes back on weak briefs. Tells you which hook is the one.',
      schedule: 'Auto-briefed when Jordan\'s plan is approved. Delivers hooks, scripts, and captions on demand.',
      services: [
        { kind: 'top_trend_hooks', label: 'Trend Hooks', desc: '5 scroll-stopping hooks for the hottest trend in your niche. Includes Alex\'s pick.', type: 'hook_writing' },
        { kind: 'reel_script_30s', label: '30s Reel Script', desc: 'Beat-by-beat script: hook, tension, reframe, payoff. Ready to film.', type: 'script_writing' },
        { kind: 'caption_next_post', label: 'Caption', desc: 'Full ready-to-paste caption with CTA and line break strategy.', type: 'caption_writing' },
        { kind: 'carousel_opening_lines', label: 'Carousel Openers', desc: '3 opening lines for slide 1. Alex tells you which one wins and why.', type: 'hook_writing' },
        { kind: 'bio_rewrite', label: 'Bio Rewrite', desc: '3 bio options — outcome-first, identity-first, and punchy. With a recommendation.', type: 'caption_writing' },
      ],
    },
    creative_director: {
      name: 'Riley',
      title: 'Creative Director',
      init: 'R',
      color: '#b482ff',
      personality: 'Visual thinker, detail-obsessed. Speaks in shots and scenes. Makes sure your content looks as good as it reads.',
      schedule: 'Auto-briefed when Alex\'s copy is approved. Audits your feed and format performance bi-weekly.',
      services: [
        { kind: 'reel_shot_list', label: 'Shot List', desc: 'Exactly what to film — shots, duration, camera angles, audio notes, and pacing.', type: 'shot_list' },
        { kind: 'pacing_notes', label: 'Pacing Notes', desc: 'Frame-by-frame timing so your video holds attention from start to finish.', type: 'shot_list' },
        { kind: 'visual_direction', label: 'Visual Direction', desc: 'Scene composition, color, lighting, and energy for your next piece of content.', type: 'shot_list' },
        { kind: 'thumbnail_brief', label: 'Thumbnail Brief', desc: 'First-frame optimization — what your video cover should look like to get clicks.', type: 'shot_list' },
        { kind: 'fix_weak_reel', label: 'Fix a Weak Reel', desc: 'Specific edits to rescue underperforming content — trim, speed, mood, text overlays.', type: 'shot_list' },
      ],
    },
  }

  function esc(s) { return String(s || '').replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] }) }

  function createDrawer() {
    if (drawer) return

    backdrop = document.createElement('div')
    backdrop.id = 'vx-agent-backdrop'
    backdrop.style.cssText = 'position:fixed;inset:0;z-index:8500;background:rgba(0,0,0,.3);opacity:0;transition:opacity .3s ease;pointer-events:none'
    backdrop.addEventListener('click', closeDrawer)
    document.body.appendChild(backdrop)

    drawer = document.createElement('div')
    drawer.id = 'vx-agent-drawer'
    drawer.style.cssText = 'position:fixed;top:0;right:0;bottom:0;width:min(420px,90vw);z-index:8501;background:var(--bg);border-left:1px solid var(--b1);overflow-y:auto;transform:translateX(100%);transition:transform .35s cubic-bezier(.16,1,.3,1);box-shadow:-20px 0 60px rgba(0,0,0,.1);font-family:DM Sans,sans-serif'
    document.body.appendChild(drawer)
  }

  function openDrawer(role) {
    createDrawer()
    currentRole = role
    var agent = AGENTS[role]
    if (!agent) return

    // Get tasks for this role
    var tasks = []
    try {
      var allTasks = window.__vxDashState?.tasks || []
      tasks = allTasks.filter(function (t) { return t.employee?.role === role })
    } catch (e) {}

    var delivered = tasks.filter(function (t) { return t.status === 'delivered' })
    var history = tasks.filter(function (t) { return t.status === 'approved' || t.status === 'rejected' }).slice(0, 5)

    drawer.innerHTML = ''
      // Close button
      + '<div style="padding:20px 24px 0;display:flex;justify-content:flex-end">'
      + '<button onclick="window.closeAgentDrawer()" style="background:none;border:none;color:var(--t3);font-size:18px;cursor:pointer;padding:4px 8px;line-height:1">&times;</button>'
      + '</div>'

      // Agent header
      + '<div style="padding:8px 28px 28px;border-bottom:1px solid var(--b1)">'
      + '<div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">'
      + '<div style="width:48px;height:48px;border-radius:12px;background:var(--s2,#f0efed);color:var(--t1,#1a1a1a);display:grid;place-items:center;font-weight:700;font-size:18px;font-family:Syne,sans-serif;flex-shrink:0">' + agent.init + '</div>'
      + '<div>'
      + '<div style="font-size:20px;font-weight:600;color:var(--t1)">' + esc(agent.name) + '</div>'
      + '<div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--t3)">' + esc(agent.title) + '</div>'
      + '</div>'
      + '</div>'
      + '<p style="font-size:13px;color:var(--t2);line-height:1.6;margin:0">' + esc(agent.personality) + '</p>'
      + '</div>'

      // Schedule
      + '<div style="padding:20px 28px;border-bottom:1px solid var(--b1)">'
      + '<div style="font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--t3);margin-bottom:8px;font-weight:500">Schedule</div>'
      + '<p style="font-size:12px;color:var(--t2);line-height:1.5;margin:0">' + esc(agent.schedule) + '</p>'
      + '</div>'

      // Services
      + '<div style="padding:20px 28px;border-bottom:1px solid var(--b1)">'
      + '<div style="font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--t3);margin-bottom:14px;font-weight:500">What ' + esc(agent.name) + ' can do</div>'
      + '<div style="display:flex;flex-direction:column;gap:8px">'
      + agent.services.map(function (s) {
          return '<button data-vx-service="' + s.kind + '" data-vx-type="' + s.type + '" data-vx-role="' + role + '" data-vx-label="' + esc(s.label) + '" style="text-align:left;background:var(--s1);border:1px solid var(--b1);border-radius:10px;padding:14px 16px;cursor:pointer;transition:all .2s;font-family:inherit">'
            + '<div style="font-size:13px;font-weight:500;color:var(--t1);margin-bottom:4px">' + esc(s.label) + '</div>'
            + '<div style="font-size:11px;color:var(--t2);line-height:1.5">' + esc(s.desc) + '</div>'
            + '</button>'
        }).join('')
      + '</div>'
      + '</div>'

      // Current work
      + '<div style="padding:20px 28px;border-bottom:1px solid var(--b1)">'
      + '<div style="font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--t3);margin-bottom:10px;font-weight:500">Current work</div>'
      + (delivered.length > 0
        ? delivered.map(function (t) {
            return '<div style="background:var(--s1);border:1px solid var(--b1);border-radius:8px;padding:12px 14px;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between">'
              + '<div>'
              + '<div style="font-size:12px;color:var(--t1);font-weight:500">' + esc(t.title) + '</div>'
              + '<div style="font-size:10px;color:var(--t3);margin-top:2px">Delivered ' + timeAgo(t.createdAt) + '</div>'
              + '</div>'
              + '<button data-vx-review="' + t.id + '" style="background:var(--t1);color:var(--bg);border:none;padding:5px 12px;border-radius:6px;font-size:10px;font-weight:600;cursor:pointer;font-family:inherit">Review</button>'
              + '</div>'
          }).join('')
        : '<div style="font-size:12px;color:var(--t3);line-height:1.5">No deliverables waiting. Assign a task above or wait for ' + esc(agent.name) + '\'s next scheduled delivery.</div>'
      )
      + '</div>'

      // History
      + '<div style="padding:20px 28px 32px">'
      + '<div style="font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--t3);margin-bottom:10px;font-weight:500">Recent history</div>'
      + (history.length > 0
        ? history.map(function (t) {
            var icon = t.status === 'approved' ? '<span style="color:#34d27a">&#10003;</span>' : '<span style="color:#e87a7a">&#10007;</span>'
            return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--b1);font-size:12px">'
              + icon
              + '<div style="flex:1;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(t.title) + '</div>'
              + '<div style="color:var(--t3);font-size:10px;flex-shrink:0">' + timeAgo(t.createdAt) + '</div>'
              + '</div>'
          }).join('')
        : '<div style="font-size:12px;color:var(--t3)">No completed tasks yet.</div>'
      )
      + '</div>'

    // Show
    backdrop.style.opacity = '1'
    backdrop.style.pointerEvents = 'auto'
    drawer.style.transform = 'translateX(0)'

    // Wire service buttons
    drawer.querySelectorAll('[data-vx-service]').forEach(function (btn) {
      btn.addEventListener('mouseenter', function () { btn.style.borderColor = 'var(--t3)' })
      btn.addEventListener('mouseleave', function () { btn.style.borderColor = 'var(--b1)' })
      btn.addEventListener('click', function () {
        var kind = btn.dataset.vxService
        var type = btn.dataset.vxType
        var role = btn.dataset.vxRole
        var label = btn.dataset.vxLabel
        assignService(role, type, kind, label)
      })
    })

    // Wire review buttons
    drawer.querySelectorAll('[data-vx-review]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        closeDrawer()
        // Navigate to work page to review
        if (typeof window.navigate === 'function') window.navigate('db-tasks')
      })
    })
  }

  function closeDrawer() {
    if (!drawer) return
    backdrop.style.opacity = '0'
    backdrop.style.pointerEvents = 'none'
    drawer.style.transform = 'translateX(100%)'
    currentRole = null
  }

  function assignService(role, type, briefKind, label) {
    var agent = AGENTS[role]
    if (!agent) return

    // Find employee ID
    var companies = window.__vxDashState?.me?.companies
    var company = companies && companies[0]
    if (!company) return
    var employee = company.employees.find(function (e) { return e.role === role })
    if (!employee) return

    // Show confirmation in the button
    var btn = drawer.querySelector('[data-vx-service="' + briefKind + '"]')
    if (btn) {
      btn.style.borderColor = '#34d27a'
      btn.innerHTML = '<div style="font-size:12px;font-weight:500;color:#34d27a;text-align:center">Assigning to ' + esc(agent.name) + '...</div>'
    }

    // Create the task
    fetch('/api/tasks', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId: employee.id,
        title: label,
        description: label,
        type: type,
        briefKind: briefKind,
      }),
    })
    .then(function (r) { return r.json() })
    .then(function (d) {
      if (btn) {
        btn.innerHTML = '<div style="font-size:12px;font-weight:500;color:#34d27a;text-align:center">&#10003; ' + esc(agent.name) + ' is on it</div>'
      }
      // Refresh after a moment
      setTimeout(function () { closeDrawer() }, 1500)
    })
    .catch(function () {
      if (btn) {
        btn.innerHTML = '<div style="font-size:12px;color:#e87a7a;text-align:center">Something went wrong. Try again.</div>'
        setTimeout(function () { btn.style.borderColor = 'var(--b1)' }, 2000)
      }
    })
  }

  function timeAgo(d) {
    if (!d) return ''
    var ms = Date.now() - new Date(d).getTime()
    var m = Math.floor(ms / 60000)
    if (m < 1) return 'just now'
    if (m < 60) return m + 'm ago'
    var h = Math.floor(m / 60)
    if (h < 24) return h + 'h ago'
    var days = Math.floor(h / 24)
    return days + 'd ago'
  }

  // ─── SIDE TABS ─────────────────────────────────────────────────
  // Persistent tabs on the right edge of the screen. Always visible
  // when the dashboard is active. Click to open the agent drawer.

  var tabsContainer = null

  function createSideTabs() {
    if (tabsContainer) return
    tabsContainer = document.createElement('div')
    tabsContainer.id = 'vx-agent-tabs'
    tabsContainer.style.cssText = 'position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:8000;display:flex;flex-direction:column;gap:6px;padding:4px 0'

    var roles = ['analyst', 'strategist', 'copywriter', 'creative_director']
    roles.forEach(function (role) {
      var a = AGENTS[role]
      var tab = document.createElement('button')
      tab.dataset.vxTab = role
      tab.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 12px 8px 14px;border:none;border-radius:10px 0 0 10px;cursor:pointer;font-family:DM Sans,sans-serif;transition:all .25s cubic-bezier(.16,1,.3,1);background:var(--s1);border:1px solid var(--b1);border-right:none;box-shadow:-4px 2px 12px rgba(0,0,0,.04)'
      var avatar = document.createElement('div')
      avatar.style.cssText = 'width:28px;height:28px;border-radius:7px;background:var(--s2,#f0efed);color:var(--t1,#1a1a1a);display:grid;place-items:center;font-weight:700;font-size:11px;font-family:Syne,sans-serif;flex-shrink:0'
      avatar.textContent = a.init

      var tabLabel = document.createElement('div')
      tabLabel.style.cssText = 'overflow:hidden;max-width:0;transition:max-width .25s cubic-bezier(.16,1,.3,1);white-space:nowrap'
      tabLabel.innerHTML = '<div style="font-size:11px;font-weight:600;color:var(--t1);line-height:1.2">' + esc(a.name) + '</div>'
        + '<div style="font-size:9px;color:var(--t3)">' + esc(a.title.split(' ')[0]) + '</div>'

      tab.appendChild(avatar)
      tab.appendChild(tabLabel)

      tab.addEventListener('mouseenter', function () {
        tabLabel.style.maxWidth = '120px'
        tab.style.paddingRight = '16px'
      })
      tab.addEventListener('mouseleave', function () {
        if (currentRole !== role) {
          tabLabel.style.maxWidth = '0px'
          tab.style.paddingRight = '12px'
        }
      })
      tab.addEventListener('click', function () {
        openDrawer(role)
      })
      tabsContainer.appendChild(tab)
    })

    document.body.appendChild(tabsContainer)
  }

  function showSideTabs() {
    createSideTabs()
    if (tabsContainer) tabsContainer.style.display = 'flex'
  }

  function hideSideTabs() {
    if (tabsContainer) tabsContainer.style.display = 'none'
  }

  // Show tabs when dashboard is active, hide otherwise
  function checkDashboardActive() {
    var dbView = document.getElementById('view-db-dashboard')
    if (dbView && dbView.classList.contains('active')) {
      showSideTabs()
    } else {
      hideSideTabs()
    }
  }

  // Check on load and on navigation
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(checkDashboardActive, 500) })
  } else {
    setTimeout(checkDashboardActive, 500)
  }

  // Re-check when navigation happens
  var origNav = window.navigate
  if (typeof origNav === 'function') {
    window.navigate = function () {
      var r = origNav.apply(this, arguments)
      setTimeout(checkDashboardActive, 300)
      return r
    }
  }

  // Also check periodically in case dashboard-v2 renders late
  var tabCheckCount = 0
  var tabCheckInterval = setInterval(function () {
    checkDashboardActive()
    tabCheckCount++
    if (tabCheckCount > 30) clearInterval(tabCheckInterval)
  }, 1000)

  // Expose globally
  window.openAgentDrawer = openDrawer
  window.closeAgentDrawer = closeDrawer
  window.showAgentTabs = showSideTabs
  window.hideAgentTabs = hideSideTabs
})()
