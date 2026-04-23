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
        { kind: 'weekly_analysis', label: 'Weekly Analysis', desc: 'How your content performed this week — what worked, what didn\'t, and what to do next.', type: 'performance_review', requires: 'platform' },
        { kind: 'trending_now', label: 'Trending Now', desc: 'What\'s rising in your content space right now from Google Trends, Reddit, YouTube, and RSS.', type: 'trend_analysis', requires: 'feed' },
        { kind: 'audience_deep_dive', label: 'Audience Breakdown', desc: 'Who your audience really is — age, gender, location, and what content they engage with.', type: 'trend_analysis', requires: 'audience' },
        { kind: 'engagement_diagnosis', label: 'Engagement Diagnosis', desc: 'Why your engagement shifted and exactly what to do about it.', type: 'performance_review', requires: 'platform' },
        { kind: 'competitor_scan', label: 'Competitor Scan', desc: 'What competitors are doing, what\'s working for them, and where you can win.', type: 'trend_analysis', requires: 'competitors' },
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
        { kind: 'weekly_plan', label: 'Weekly Plan', desc: 'A full week of content — formats, topics, angles, and timing. Ready to approve.', type: 'content_planning', requires: 'platform' },
        { kind: 'pillar_rebuild', label: 'Pillar Rebuild', desc: 'Rebuild your content pillars from scratch. What to keep, what to kill, what to start.', type: 'content_planning', requires: 'platform' },
        { kind: 'cadence_plan', label: 'Posting Cadence', desc: 'When to post, how often, and which formats — optimized for your audience.', type: 'content_planning', requires: 'platform' },
        { kind: 'ninety_day_plan', label: '90-Day Plan', desc: 'Three months mapped out — themes, goals, and must-ship content per month.', type: 'content_planning', requires: 'none' },
        { kind: 'slot_audit', label: 'Slot Audit', desc: 'Find your 2 weakest content slots and replace them with higher-performing formats.', type: 'content_planning', requires: 'posts' },
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
        { kind: 'top_trend_hooks', label: 'Trend Hooks', desc: '5 scroll-stopping hooks for what\'s trending right now. Includes Alex\'s pick.', type: 'hook_writing', requires: 'none' },
        { kind: 'reel_script_30s', label: '30s Reel Script', desc: 'Beat-by-beat script: hook, tension, reframe, payoff. Ready to film.', type: 'script_writing', requires: 'none' },
        { kind: 'caption_next_post', label: 'Caption', desc: 'Full ready-to-paste caption with CTA and line break strategy.', type: 'caption_writing', requires: 'none' },
        { kind: 'carousel_opening_lines', label: 'Carousel Openers', desc: '3 opening lines for slide 1. Alex tells you which one wins and why.', type: 'hook_writing', requires: 'none' },
        { kind: 'bio_rewrite', label: 'Bio Rewrite', desc: '3 bio options — outcome-first, identity-first, and punchy. With a recommendation.', type: 'caption_writing', requires: 'platform' },
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
        { kind: 'reel_shot_list', label: 'Shot List', desc: 'Exactly what to film — shots, duration, camera angles, audio notes, and pacing.', type: 'shot_list', requires: 'none' },
        { kind: 'pacing_notes', label: 'Pacing Notes', desc: 'Frame-by-frame timing so your video holds attention from start to finish.', type: 'shot_list', requires: 'none' },
        { kind: 'visual_direction', label: 'Visual Direction', desc: 'Scene composition, color, lighting, and energy for your next piece of content.', type: 'shot_list', requires: 'none' },
        { kind: 'thumbnail_brief', label: 'Thumbnail Brief', desc: 'First-frame optimization — what your video cover should look like to get clicks.', type: 'shot_list', requires: 'none' },
        { kind: 'fix_weak_reel', label: 'Fix a Weak Reel', desc: 'Specific edits to rescue underperforming content — trim, speed, mood, text overlays.', type: 'shot_list', requires: 'posts' },
      ],
    },
  }

  var AGENT_SCHEDULES = {
    analyst: ['maya_pulse'],
    strategist: ['jordan_plan', 'jordan_audit', 'jordan_adjustment', 'jordan_growth'],
    copywriter: [],
    creative_director: ['riley_feed_audit', 'riley_format', 'riley_competitor'],
  }

  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  // Check if the user has the data needed for a service
  function canFulfill(requires) {
    if (!requires || requires === 'none') return true
    var state = window.__vxDashState || {}
    var hasPlatform = !!(state.tiktok || state.insights)
    var hasPosts = !!(state.tasks && state.tasks.length > 0) || hasPlatform
    // Audience data syncs with platform — if platform is connected, audience should be available
    var hasAudience = hasPlatform
    // Competitor data requires external feeds — check if knowledge feed has data
    var hasCompetitors = !!(state.feed && state.feed.length > 0)

    switch (requires) {
      case 'platform': return hasPlatform
      case 'posts': return hasPosts
      case 'audience': return hasAudience
      case 'competitors': return hasCompetitors
      case 'hashtags': return false // no hashtag data pipeline yet
      case 'feed': return !!(state.feed && state.feed.length > 0)
      default: return true
    }
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
    var working = tasks.filter(function (t) { return t.status === 'pending' || t.status === 'in_progress' || t.status === 'revision' })
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

      // ── 1. READY FOR REVIEW (delivered work — the primary thing) ──
      + '<div style="padding:20px 28px;border-bottom:1px solid var(--b1)">'
      + '<div style="font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--t3);margin-bottom:10px;font-weight:500">Ready for you</div>'
      + (delivered.length > 0
        ? delivered.map(function (t) {
            return '<div style="background:var(--s1);border:1px solid var(--b1);border-radius:8px;padding:14px 16px;margin-bottom:6px">'
              + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">'
              + '<div style="font-size:13px;color:var(--t1);font-weight:500">' + esc(t.title) + '</div>'
              + '<button data-vx-review="' + t.id + '" style="background:var(--t1);color:var(--bg);border:none;padding:5px 14px;border-radius:6px;font-size:10px;font-weight:600;cursor:pointer;font-family:inherit">Review</button>'
              + '</div>'
              + '<div style="font-size:10px;color:var(--t3)">Delivered ' + timeAgo(t.createdAt) + '</div>'
              + '</div>'
          }).join('')
        : (working.length > 0
          ? '<div style="font-size:12px;color:var(--t2);line-height:1.5;display:flex;align-items:center;gap:8px"><span style="width:6px;height:6px;border-radius:50%;background:#e8c87a;flex-shrink:0;animation:pulse 2s infinite"></span>' + esc(agent.name) + ' is working on: ' + esc(working[0].title) + '</div>'
          : '<div style="font-size:12px;color:var(--t3);line-height:1.5">' + esc(agent.name) + ' is on watch. Next delivery: see schedule below.</div>'
        )
      )
      + '</div>'

      // ── 2. IN PROGRESS (what they're working on) ──
      + (working.length > 0 && delivered.length > 0
        ? '<div style="padding:16px 28px;border-bottom:1px solid var(--b1)">'
          + '<div style="font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--t3);margin-bottom:8px;font-weight:500">Working on</div>'
          + working.map(function (t) {
              return '<div style="font-size:12px;color:var(--t2);display:flex;align-items:center;gap:8px;padding:4px 0">'
                + '<span style="width:6px;height:6px;border-radius:50%;background:#e8c87a;flex-shrink:0"></span>'
                + esc(t.title)
                + '</div>'
            }).join('')
          + '</div>'
        : ''
      )

      // ── 3. SCHEDULE (editable) ──
      + '<div style="padding:20px 28px;border-bottom:1px solid var(--b1)">'
      + '<div style="font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--t3);margin-bottom:12px;font-weight:500">Schedule</div>'
      + '<div id="vx-drawer-schedules" style="display:flex;flex-direction:column;gap:8px">'
      + '<div style="font-size:12px;color:var(--t3)">Loading...</div>'
      + '</div>'
      + '</div>'

      // ── 4. MEET WITH AGENT (services as meeting topics) ──
      + '<div style="padding:20px 28px;border-bottom:1px solid var(--b1)">'
      + '<div style="font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--t3);margin-bottom:6px;font-weight:500">Meet with ' + esc(agent.name) + '</div>'
      + '<div style="font-size:11px;color:var(--t2);line-height:1.5;margin-bottom:14px">Start a conversation about any of these topics. ' + esc(agent.name) + ' comes prepared with your data.</div>'
      + '<div style="display:flex;flex-direction:column;gap:6px">'
      + agent.services.filter(function (s) { return canFulfill(s.requires) }).map(function (s) {
          return '<button data-vx-meeting-topic="' + s.kind + '" data-vx-role="' + role + '" data-vx-agent-name="' + esc(agent.name) + '" data-vx-agent-title="' + esc(agent.title) + '" data-vx-agent-init="' + agent.init + '" data-vx-topic-label="' + esc(s.label) + '" style="text-align:left;background:var(--s1);border:1px solid var(--b1);border-radius:10px;padding:12px 14px;cursor:pointer;transition:all .2s;font-family:inherit;display:flex;align-items:center;gap:12px">'
            + '<div style="flex:1">'
            + '<div style="font-size:12px;font-weight:500;color:var(--t1)">' + esc(s.label) + '</div>'
            + '<div style="font-size:11px;color:var(--t2);line-height:1.4;margin-top:2px">' + esc(s.desc) + '</div>'
            + '</div>'
            + '<div style="font-size:10px;color:var(--t3);flex-shrink:0;padding:4px 10px;border:1px solid var(--b1);border-radius:6px">Meet</div>'
            + '</button>'
        }).join('')
      + '</div>'
      + '</div>'

      // ── 5. HISTORY ──
      + '<div style="padding:20px 28px 32px">'
      + '<div style="font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--t3);margin-bottom:10px;font-weight:500">History</div>'
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

    // Wire meeting topic buttons
    drawer.querySelectorAll('[data-vx-meeting-topic]').forEach(function (btn) {
      btn.addEventListener('mouseenter', function () { btn.style.borderColor = 'var(--t3)' })
      btn.addEventListener('mouseleave', function () { btn.style.borderColor = 'var(--b1)' })
      btn.addEventListener('click', function () {
        var name = btn.dataset.vxAgentName
        var title = btn.dataset.vxAgentTitle
        var init = btn.dataset.vxAgentInit
        var topic = btn.dataset.vxTopicLabel
        closeDrawer()
        // Open meeting with topic context
        if (typeof window.openMeeting === 'function') {
          window.openMeeting(name, title, init, null, topic)
        }
      })
    })

    // Load schedules for this agent
    loadAgentSchedules(role)

    // Wire review buttons
    drawer.querySelectorAll('[data-vx-review]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        closeDrawer()
        // Navigate to work page to review
        if (typeof window.navigate === 'function') window.navigate('db-tasks')
      })
    })
  }

  function loadAgentSchedules(role) {
    var container = document.getElementById('vx-drawer-schedules')
    if (!container) return
    var keys = AGENT_SCHEDULES[role] || []
    if (keys.length === 0) {
      container.innerHTML = '<div style="font-size:12px;color:var(--t2);line-height:1.5">Auto-briefed when upstream agent delivers. No fixed schedule.</div>'
      return
    }

    fetch('/api/company/schedules', { credentials: 'include' })
      .then(function (r) { return r.json() })
      .then(function (data) {
        var schedules = data.schedules || []
        var relevant = schedules.filter(function (s) { return keys.indexOf(s.key) !== -1 })
        if (relevant.length === 0) { container.innerHTML = '<div style="font-size:12px;color:var(--t3)">No schedules configured.</div>'; return }

        container.innerHTML = relevant.map(function (s) {
          var isMonthly = s.dayOfMonth !== undefined && s.dayOfMonth !== null
          return '<div style="background:var(--s1);border:1px solid var(--b1);border-radius:8px;padding:12px 14px">'
            + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
            + '<div style="font-size:12px;font-weight:500;color:var(--t1)">' + esc(s.label) + '</div>'
            + (s.isCustom ? '<span style="font-size:9px;color:var(--t3);letter-spacing:.08em;text-transform:uppercase">Custom</span>' : '')
            + '</div>'
            + '<div style="display:flex;gap:8px;align-items:center">'
            // Day selector
            + (isMonthly
              ? '<select data-sched-key="' + s.key + '" data-sched-field="dayOfMonth" style="flex:1;padding:6px 8px;border-radius:6px;border:1px solid var(--b1);background:var(--bg);color:var(--t1);font-size:11px;font-family:inherit">'
                + Array.from({length:28}, function(_,i) { return '<option value="' + (i+1) + '"' + ((i+1) === s.dayOfMonth ? ' selected' : '') + '>' + (i+1) + ordinal(i+1) + '</option>' }).join('')
                + '</select>'
              : '<select data-sched-key="' + s.key + '" data-sched-field="day" style="flex:1;padding:6px 8px;border-radius:6px;border:1px solid var(--b1);background:var(--bg);color:var(--t1);font-size:11px;font-family:inherit">'
                + DAY_NAMES.map(function(d, i) { return '<option value="' + i + '"' + (i === s.day ? ' selected' : '') + '>' + d + '</option>' }).join('')
                + '</select>'
            )
            // Hour selector
            + '<select data-sched-key="' + s.key + '" data-sched-field="hour" style="flex:1;padding:6px 8px;border-radius:6px;border:1px solid var(--b1);background:var(--bg);color:var(--t1);font-size:11px;font-family:inherit">'
            + Array.from({length:24}, function(_,i) {
                var h = i % 12 || 12
                var ap = i < 12 ? 'am' : 'pm'
                return '<option value="' + i + '"' + (i === s.hour ? ' selected' : '') + '>' + h + ap + '</option>'
              }).join('')
            + '</select>'
            + '</div>'
            + '</div>'
        }).join('')

        // Wire change events
        container.querySelectorAll('select').forEach(function (sel) {
          sel.addEventListener('change', function () {
            var key = sel.dataset.schedKey
            var field = sel.dataset.schedField
            var value = parseInt(sel.value, 10)

            // Build the update payload
            var sched = relevant.find(function (s) { return s.key === key })
            var payload = { key: key, hour: sched.hour }
            if (sched.dayOfMonth !== undefined && sched.dayOfMonth !== null) payload.dayOfMonth = sched.dayOfMonth
            else if (sched.day !== undefined) payload.day = sched.day
            payload[field] = value

            // Update local state
            sched[field] = value

            fetch('/api/company/schedules', {
              method: 'PATCH',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            }).then(function (r) {
              if (r.ok) {
                sel.style.borderColor = '#34d27a'
                setTimeout(function () { sel.style.borderColor = 'var(--b1)' }, 1500)
              }
            }).catch(function () {})
          })
        })
      })
      .catch(function () {
        container.innerHTML = '<div style="font-size:12px;color:var(--t3)">Could not load schedules.</div>'
      })
  }

  function ordinal(n) {
    if (n === 1 || n === 21) return 'st'
    if (n === 2 || n === 22) return 'nd'
    if (n === 3 || n === 23) return 'rd'
    return 'th'
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
    tabsContainer.style.cssText = 'position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:8000;display:flex;flex-direction:column;gap:2px;padding:4px 0'

    var roles = ['analyst', 'strategist', 'copywriter', 'creative_director']
    roles.forEach(function (role) {
      var a = AGENTS[role]
      var tab = document.createElement('button')
      tab.dataset.vxTab = role
      tab.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px 6px 10px;border:none;border-radius:8px 0 0 8px;cursor:pointer;font-family:DM Sans,sans-serif;transition:all .25s cubic-bezier(.16,1,.3,1);background:var(--s1);border:1px solid var(--b1);border-right:none;box-shadow:-2px 1px 8px rgba(0,0,0,.03)'
      var avatar = document.createElement('div')
      avatar.style.cssText = 'width:24px;height:24px;border-radius:6px;background:var(--s2,#f0efed);color:var(--t1,#1a1a1a);display:grid;place-items:center;font-weight:700;font-size:10px;font-family:Syne,sans-serif;flex-shrink:0'
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
    // Side tabs removed — agents accessible from Team calendar + pipeline
    return
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
