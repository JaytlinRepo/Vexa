/* HQ v3 data wire.
 *
 * Populates the new HQ v3 dashboard markup (#view-db-dashboard.hq-v3) from
 * window.__vxDashState (hydrated by dashboard-v2.js). The legacy
 * hq-data-wire.js still exists but skips the v3 view; this wire is the
 * canonical populator for the v3 selectors.
 *
 * Data path:
 *   dashboard-v2.js → fetchAll() → STATE.{me, tasks, usage, overview, ...}
 *                  → dispatches `vx-dash-ready` (twice — early + after platform)
 *                  → this wire reads STATE and writes into v3 selectors
 *
 * Wire goals (in priority order):
 *   1. Forecast hero — combined follower count + 30d pace + milestones
 *   2. Mini stat strip — reach / followers / quota
 *   3. Forecast chart — replace static SVG path with sparkline-derived past line
 *   4. Pipeline nodes — Maya/Jordan/Alex/Riley status from tasks
 *   5. Top posts — from overview.posts or per-platform recentMedia
 *
 * Stubbed for follow-up (need additional API endpoints / signal):
 *   - Heatmap (.hm-cell) — needs publish-time × engagement matrix
 *   - Correlations (.corr-row) — needs hook/length/CTA correlation analysis
 *   - Maya's take bodies — could pull from /api/platform/maya-playbook
 */
;(function () {
  'use strict'

  // ───── helpers ─────────────────────────────────────────────────────
  function $ (sel, root) { return (root || document).querySelector(sel) }
  function $$ (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)) }

  function escHtml (s) {
    return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) {
      return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]
    })
  }

  /** Task/workflow status for labels — avoid raw snake_case */
  function friendlyStatusLabel (raw) {
    var s = String(raw || '').trim()
    if (!s) return ''
    var map = {
      in_progress: 'In progress',
      pending: 'Queued',
      delivered: 'Done',
      approved: 'Approved',
      rejected: 'Needs attention',
      cancelled: 'Cancelled',
      blocked: 'Waiting',
      failed: 'Needs attention',
    }
    if (map[s]) return map[s]
    return s.replace(/_/g, ' ').replace(/\b\w/g, function (ch) { return ch.toUpperCase() })
  }

  // The 12 known bad-reach IG posts have engagementRate exactly 1.0 (eng/reach
  // where reach == likes). After API normalization fields are 0–1, so this is
  // also the right fence for engagementRate7d / engagementRate28d.
  function isValidEngPost (p) { return p && p.engagementRate > 0 && p.engagementRate < 1 }

  // Coalesced /timeseries fetch — every Phase 2 renderer below shares one
  // promise per dashboard render. resetTsCache() runs on every render() call
  // so refreshes pick up new data.
  var get = function (u) {
    return fetch(u, { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null })
      .catch(function () { return null })
  }
  var tsPromise = null
  function getTimeseries () {
    if (!tsPromise) tsPromise = get('/api/platform/timeseries')
    return tsPromise
  }
  function resetTsCache () { tsPromise = null }

  // ─── "What's new since last visit" tracking ───────────────────────
  // The hero used to count tasks completed in the last 24h, which made
  // every refresh inflate the same boilerplate ("Maya finished Morning brief")
  // even when nothing genuinely new had happened. Now we read a per-user
  // lastSeen timestamp from localStorage and only count tasks completed
  // AFTER that. The timestamp is frozen for the duration of a session
  // (so refreshes don't immediately make the count drop to 0) and is
  // updated when the user navigates away from HQ or closes the tab.
  var LAST_SEEN_KEY = 'vx-hq3-last-seen'
  var sessionLastSeen = null
  function getEffectiveLastSeen () {
    if (sessionLastSeen != null) return sessionLastSeen
    try {
      var raw = localStorage.getItem(LAST_SEEN_KEY)
      var parsed = raw ? parseInt(raw, 10) : NaN
      if (isNaN(parsed)) {
        // First visit — anchor at 24h ago so the user sees recent activity
        parsed = Date.now() - 24 * 3600 * 1000
      }
      sessionLastSeen = parsed
    } catch {
      sessionLastSeen = Date.now() - 24 * 3600 * 1000
    }
    return sessionLastSeen
  }
  function markHqSeen () {
    try { localStorage.setItem(LAST_SEEN_KEY, String(Date.now())) } catch {}
    // Reset session-frozen value so the NEXT time the user opens HQ in this
    // tab, it picks up the updated lastSeen.
    sessionLastSeen = null
  }

  // ─── Platform registry — single source of truth ───────────────────
  // Adding a new platform integration (YouTube, X, LinkedIn, etc.) only
  // requires registering it here. Display labels, CSS class shorthands,
  // and sort order all flow from this object. Renderers must NOT
  // hardcode platform-specific strings — they look up via platformInfo().
  var PLATFORM_REGISTRY = {
    instagram: { label: 'Instagram', classKey: 'ig', sort: 1 },
    tiktok:    { label: 'TikTok',    classKey: 'tt', sort: 2 },
    youtube:   { label: 'YouTube',   classKey: 'yt', sort: 3 },
    // x:        { label: 'X',         classKey: 'x',  sort: 4 },  // future
    // linkedin: { label: 'LinkedIn',  classKey: 'li', sort: 5 },  // future
    _default:  { label: 'Source',    classKey: '',   sort: 99 },
  }
  function platformInfo (key) {
    return PLATFORM_REGISTRY[key] || PLATFORM_REGISTRY._default
  }
  function platformLabel (key) { return platformInfo(key).label }
  function platformClass (key) { return platformInfo(key).classKey }
  function connectedPlatforms (accounts) {
    return (accounts || []).map(function (a) { return a.platform })
      .filter(function (p) { return p && PLATFORM_REGISTRY[p] })
  }

  // Convert (attribute, category) from communityTags into a creator-readable
  // phrase. The raw tags are tooling vocabulary (e.g. "hookType: contrarian").
  // We translate them so the correlation chart reads like English, not a
  // schema. Falls back gracefully for unknown values.
  function humanizeTagLabel (attr, category) {
    var prettyCat = String(category || '').replace(/_/g, ' ')
    switch (attr) {
      case 'format':         return prettyCat + ' videos'
      case 'mood':           return prettyCat.charAt(0).toUpperCase() + prettyCat.slice(1) + ' mood'
      case 'visualStyle':    return prettyCat.charAt(0).toUpperCase() + prettyCat.slice(1) + ' look'
      case 'audienceType':   return 'Posts for ' + prettyCat
      case 'hookType':       return prettyCat.charAt(0).toUpperCase() + prettyCat.slice(1) + ' openings'
      case 'contentLength':  return prettyCat.charAt(0).toUpperCase() + prettyCat.slice(1) + '-form posts'
      case 'niche':          return prettyCat + ' content'
      default:               return prettyCat
    }
  }

  // ─── platform filter (All / Instagram / TikTok / future) ──────────
  // Module-level state. Updated by the toggle handler in wirePlatformToggle()
  // and read by every renderer that filters posts/snapshots/sparkline.
  // 'all' = no filter, 'instagram' / 'tiktok' = scope to that platform only.
  var currentPlatform = (function () { try { return localStorage.getItem('hq3-platform') || 'all' } catch { return 'all' } })()

  function filterPostsByPlatform (posts, accountPlatforms) {
    if (currentPlatform === 'all') return posts
    return posts.filter(function (p) { return (accountPlatforms || {})[p.accountId] === currentPlatform })
  }
  function filterSnapshotsByPlatform (snapshots, accountPlatforms) {
    if (currentPlatform === 'all') return snapshots
    return snapshots.filter(function (s) { return (accountPlatforms || {})[s.accountId] === currentPlatform })
  }
  // Sparkline entries have a `byPlatform: { instagram: N, tiktok: N }` shape.
  // For 'all' use d.total; for a specific platform pull from byPlatform.
  function scopeSparklineToPlatform (sparkline) {
    if (currentPlatform === 'all') return sparkline
    return sparkline.map(function (s) {
      var perPlatform = (s.byPlatform || {})[currentPlatform] || 0
      return { date: s.date, total: perPlatform, byPlatform: s.byPlatform }
    })
  }
  function followersForPlatform (accounts, sparkline) {
    if (currentPlatform === 'all') {
      return accounts.reduce(function (s, a) { return s + (a.latestFollowers || 0) }, 0)
    }
    var acct = accounts.find(function (a) { return a.platform === currentPlatform })
    return acct ? (acct.latestFollowers || 0) : 0
  }

  // Returns a shallow copy of the timeseries response with posts and snapshots
  // filtered by the current platform. Audiences are NOT filtered — they're
  // already labeled by source ('Instagram audience', etc.) and TikTok sandbox
  // returns no audience data anyway.
  function scopeTimeseriesToPlatform (ts) {
    if (!ts || currentPlatform === 'all') return ts
    return Object.assign({}, ts, {
      posts: filterPostsByPlatform(ts.posts || [], ts.accountPlatforms),
      snapshots: filterSnapshotsByPlatform(ts.snapshots || [], ts.accountPlatforms),
    })
  }

  /**
   * Compute pace, milestones, and confidence for a given window.
   * Pulled out so the pill-tab handler (7D / 30D / 90D / 1Y) re-uses the
   * same math when the user changes the window. Pure function — no DOM.
   *
   * If the sparkline doesn't have enough days for the requested window,
   * we fall back to whatever we have. Numbers stay honest.
   */
  function computeForecastFor (sparkline, followers, windowDays) {
    var out = {
      pacePerDay: null, milestone1: null, milestone2: null,
      daysToM1: null, daysToM2: null, confidence: null,
      scopedSparkline: sparkline || [],
      coverage: 0, // how many days we actually had
    }
    if (!sparkline || sparkline.length < 2) return out

    // Take the last `windowDays` entries (or fewer if not available)
    var n = Math.min(windowDays, sparkline.length)
    var scoped = sparkline.slice(-n)
    out.scopedSparkline = scoped
    out.coverage = scoped.length

    var first = scoped[0]
    var last = scoped[scoped.length - 1]
    var spanDays = Math.max(1, scoped.length - 1)
    out.pacePerDay = Math.round((last.total - first.total) / spanDays)

    // Milestones scale to current follower count
    var rungs = [1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000, 2500000, 5000000]
    var nextRungs = rungs.filter(function (r) { return r > followers }).slice(0, 2)
    out.milestone1 = nextRungs[0] || null
    out.milestone2 = nextRungs[1] || null
    if (out.pacePerDay > 0) {
      if (out.milestone1) out.daysToM1 = Math.ceil((out.milestone1 - followers) / out.pacePerDay)
      if (out.milestone2) out.daysToM2 = Math.ceil((out.milestone2 - followers) / out.pacePerDay)
    }

    // Confidence proxy: flat = high, jagged = low. Range clamped to [0.5, 0.95].
    var deltas = []
    for (var i = 1; i < scoped.length; i++) deltas.push(scoped[i].total - scoped[i - 1].total)
    if (deltas.length > 1) {
      var mean = deltas.reduce(function (a, b) { return a + b }, 0) / deltas.length
      var variance = deltas.reduce(function (a, b) { return a + (b - mean) * (b - mean) }, 0) / deltas.length
      var stdev = Math.sqrt(variance)
      var ratio = Math.abs(mean) > 0.5 ? stdev / Math.abs(mean) : 1
      out.confidence = Math.max(0.5, Math.min(0.95, 1 / (1 + ratio)))
    } else {
      out.confidence = 0.7
    }
    return out
  }

  function hqRoot () {
    var v = document.getElementById('view-db-dashboard')
    return (v && v.classList.contains('hq-v3')) ? v : null
  }

  // Below 10K we show the full follower count with comma separators
  // (e.g. 7,130 — feels real, accurate for small accounts). At 10K and
  // above we abbreviate (10K, 12.4K, 1.2M) so the headline stays compact.
  function fmtShort (n) {
    if (n == null || isNaN(n)) return '—'
    var abs = Math.abs(n)
    if (abs >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
    if (abs >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'
    return Math.round(n).toLocaleString('en-US')
  }
  function fmtNumWithUnit (n) {
    // For .fc-num — splits magnitude from unit so SVG markup
    // (<span class="unit">K</span>) renders as designed.
    if (n == null || isNaN(n)) return ['—', '']
    var abs = Math.abs(n)
    if (abs >= 1e6) return [(n / 1e6).toFixed(1).replace(/\.0$/, ''), 'M']
    if (abs >= 1e4) return [(n / 1e3).toFixed(1).replace(/\.0$/, ''), 'K']
    return [Math.round(n).toLocaleString('en-US'), '']
  }
  function fmtDelta (n, suffix) {
    if (n == null || isNaN(n) || n === 0) return ''
    var sign = n > 0 ? '▲ ' : '▼ '
    return sign + fmtShort(Math.abs(n)) + (suffix || '')
  }

  function setText (sel, value, root) {
    var el = (root || document).querySelector(sel)
    if (el) el.textContent = value
  }
  function setHTML (sel, value, root) {
    var el = (root || document).querySelector(sel)
    if (el) el.innerHTML = value
  }

  // ───── data derivation ────────────────────────────────────────────
  function deriveHQData (state) {
    var ov = state && state.overview
    var tasks = (state && state.tasks) || []
    var usage = state && state.usage
    var data = {
      followers: null,        // combined follower count (number)
      followersDelta: null,   // weekly delta
      pacePerDay: null,       // sliding 30-day pace
      daysTo350K: null,
      daysTo400K: null,
      confidence: null,       // 0..1
      sparkline: null,        // [{date, total, byPlatform}]
      reach7d: null,          // 7-day reach (from posts if available)
      reach7dDelta: null,
      bedrockUsed: null,      // /api/usage current count
      bedrockLimit: null,
      bedrockPlan: null,
      tasksByRole: {},        // role → most-recent task
      topPosts: [],
      accounts: [],
    }
    if (ov) {
      data.accounts = ov.accounts || []
      // Apply current platform filter to follower headline + sparkline.
      // currentPlatform is module-level, set by wirePlatformToggle().
      var rawSparkline = ov.sparkline || []
      data.sparkline = scopeSparklineToPlatform(rawSparkline)
      if (currentPlatform === 'all') {
        data.followers = ov.combinedFollowers
        data.followersDelta = ov.combinedFollowersDelta
      } else {
        data.followers = followersForPlatform(data.accounts, rawSparkline)
        // Per-platform delta = last - first of scoped sparkline (real, not all)
        if (data.sparkline.length >= 2) {
          data.followersDelta = data.sparkline[data.sparkline.length - 1].total - data.sparkline[0].total
        } else {
          data.followersDelta = 0
        }
      }
      // Initial render uses the full sparkline window (30D). The pill tabs
      // below the section head re-run computeForecastFor() with a different
      // windowDays to scope all four side-stats + the chart.
      var fc = computeForecastFor(data.sparkline, data.followers, 30)
      data.pacePerDay = fc.pacePerDay
      data.milestone1 = fc.milestone1; data.milestone2 = fc.milestone2
      data.daysToM1 = fc.daysToM1; data.daysToM2 = fc.daysToM2
      data.confidence = fc.confidence
      data.scopedSparkline = fc.scopedSparkline
      data.topPosts = ov.posts || (ov.topPost ? [ov.topPost] : [])
      // Approximate 7-day reach from the top posts when available
      if (data.topPosts.length) {
        var weekCutoff = Date.now() - 7 * 86400000
        var sum = 0, count = 0
        data.topPosts.forEach(function (p) {
          var ts = p.publishedAt ? Date.parse(p.publishedAt) : NaN
          if (!isNaN(ts) && ts >= weekCutoff) {
            sum += (p.reachCount || p.viewCount || 0)
            count++
          }
        })
        if (count > 0) data.reach7d = sum
      }
    }
    if (usage && typeof usage === 'object') {
      // Use the persistent /api/usage tasks counter rather than the in-memory
      // bedrockUsage tracker (resets on every server restart). Field names
      // that survived: usage.tasks.used / usage.tasks.limit — see the
      // /api/usage response shape.
      var tk = usage.tasks
      if (tk && typeof tk === 'object') {
        data.tasksUsed = tk.used
        data.tasksLimit = tk.limit
      }
      data.plan = usage.plan || (state.me && state.me.user && state.me.user.plan) || null
    }
    // Pass full tasks array through for the cockpit strip (renderCockpit
     // filters by status='delivered'). The role-specific most-recent task is
     // still computed below for the pipeline node detail.
    data.tasksRaw = tasks

    // Most recent task per role
    // Three-employee team. `copywriter` (Alex) is no longer mapped — any
    // legacy task with that role is excluded from the live pipeline view.
    var roleMap = { analyst: 'maya', strategist: 'jordan', creative_director: 'riley' }
    tasks.forEach(function (t) {
      var role = roleMap[t.employee && t.employee.role]
      if (!role) return
      var existing = data.tasksByRole[role]
      var ts = Date.parse(t.completedAt || t.createdAt)
      if (!existing || ts > existing._ts) {
        t._ts = ts
        data.tasksByRole[role] = t
      }
    })

    // Activity counts — net-new since the user's last HQ visit, NOT the
    // last 24 hours. This is what makes the hero stop inflating with the
    // same daily boilerplate cron output every refresh. If nothing genuinely
    // new has happened, the headline says so honestly.
    var lastSeenMs = getEffectiveLastSeen()
    data.lastSeenMs = lastSeenMs

    // Tasks finished since lastSeen — with cluster dedupe.
    // Backstory: the auto-task cron occasionally triple-fires (3 identical
    // task rows within ~30 seconds). We don't want the headline to count
    // those as 3 separate "things." Group by `role + title` and only keep
    // the first occurrence within any 10-minute window. The backend bug
    // is being fixed in parallel; this layer is defensive.
    var rawFinished = tasks.filter(function (t) {
      if (t.status !== 'approved' && t.status !== 'delivered') return false
      var ts = Date.parse(t.completedAt || t.createdAt)
      return !isNaN(ts) && ts > lastSeenMs
    }).sort(function (a, b) {
      return Date.parse(a.completedAt || a.createdAt) - Date.parse(b.completedAt || b.createdAt)
    })
    var DEDUP_WINDOW_MS = 10 * 60 * 1000
    var seenClusters = {} // key = role::title → most-recent kept timestamp
    data.tasksFinishedSinceLastSeen = rawFinished.filter(function (t) {
      var role = (t.employee && t.employee.role) || 'unknown'
      var key = role + '::' + (t.title || '')
      var ts = Date.parse(t.completedAt || t.createdAt)
      var prevTs = seenClusters[key]
      if (prevTs != null && Math.abs(ts - prevTs) < DEDUP_WINDOW_MS) return false
      seenClusters[key] = ts
      return true
    })
    data.duplicatesSuppressed = rawFinished.length - data.tasksFinishedSinceLastSeen.length

    // Most-recent NET-NEW task per role (overrides the always-most-recent map
    // above for hero rendering — sub-line should only show roles that did
    // something new since you last looked).
    data.netNewTasksByRole = {}
    data.tasksFinishedSinceLastSeen.forEach(function (t) {
      var role = roleMap[t.employee && t.employee.role]
      if (!role) return
      var existing = data.netNewTasksByRole[role]
      var ts = Date.parse(t.completedAt || t.createdAt)
      if (!existing || ts > existing._ts) {
        t._ts = ts
        data.netNewTasksByRole[role] = t
      }
    })

    // Time since last visit, formatted
    var sinceMs = Math.max(0, Date.now() - lastSeenMs)
    if (sinceMs < 60 * 1000) data.lastSeenAgo = 'just now'
    else if (sinceMs < 3600 * 1000) data.lastSeenAgo = Math.round(sinceMs / 60000) + ' min ago'
    else if (sinceMs < 24 * 3600 * 1000) data.lastSeenAgo = Math.round(sinceMs / 3600000) + 'h ago'
    else data.lastSeenAgo = Math.round(sinceMs / 86400000) + 'd ago'

    // First name for greeting
    var u = (state.me && state.me.user) || {}
    data.firstName = (u.fullName || u.username || '').split(/\s+/)[0] || ''
    return data
  }

  // ───── render: cockpit action strip ───────────────────────────────
  // The cockpit converts HQ from a report into an operations console. It
  // surfaces the highest-priority items needing the CEO's attention:
  //   1. Tasks delivered awaiting approval (Maya/Jordan/Alex/Riley → CEO)
  //   2. Anomaly callouts (a post taking off — needs separate compute)
  //   3. Empty state: "All clear · team is on it" (honest, not faux-busy)
  function renderCockpit (root, d) {
    var strip = root.querySelector('#hq3-cockpit')
    var summary = root.querySelector('#hq3-cockpit-summary')
    var chips = root.querySelector('#hq3-cockpit-chips')
    if (!strip || !summary || !chips) return

    // Tasks needing CEO action: status='delivered' (output is in, awaiting
    // approve / reject). 'pending' = queued, 'approved' = done — neither
    // needs review.
    // Active-role allowlist — Alex (copywriter) was retired, but legacy
    // delivered tasks of that role still exist in some DBs. Skipping them
    // here keeps the headline ("N things need your review") aligned with
    // what we actually render in chips, and avoids a phantom "+1 more".
    var ACTIVE_ROLES = { analyst: 1, strategist: 1, creative_director: 1 }
    var delivered = ((d && d.tasksRaw) || [])
      .filter(function (t) { return t.status === 'delivered' })
      .filter(function (t) {
        var r = (t.employee && t.employee.role) || ''
        return ACTIVE_ROLES[r] === 1
      })
    // Group by role so chips read as "Review · 3 plans from Jordan" not
    // "Review · output #abc-123"
    var byRole = {}
    delivered.forEach(function (t) {
      var role = (t.employee && t.employee.role) || 'unknown'
      if (!byRole[role]) byRole[role] = []
      byRole[role].push(t)
    })
    // Three-employee team (Alex retired). Legacy `copywriter` rows fall
    // through to the Team default below.
    var roleLabels = {
      analyst: { who: 'Maya', what: 'brief', what_pl: 'briefs' },
      strategist: { who: 'Jordan', what: 'plan', what_pl: 'plans' },
      creative_director: { who: 'Riley', what: 'brief', what_pl: 'briefs' },
    }

    chips.innerHTML = ''
    if (delivered.length === 0) {
      summary.innerHTML = 'You\u2019re <em>all clear</em>. The team is shipping.'
      // Hide chips entirely on the clean state — keep the strip though
      strip.removeAttribute('hidden')
      return
    }

    var n = delivered.length
    summary.innerHTML = '<em>' + n + '</em> ' + (n === 1 ? 'thing needs' : 'things need') + ' your review.'

    // Build up to 3 role-grouped chips, then "+N more" only when tasks
    // remain that aren't covered. tasksChipped sums bucket lengths so a
    // single chip standing in for 3 tasks subtracts 3, not 1.
    var roleOrder = ['analyst', 'strategist', 'creative_director']
    var rendered = 0
    var tasksChipped = 0
    roleOrder.forEach(function (role) {
      var bucket = byRole[role]
      if (!bucket || bucket.length === 0 || rendered >= 3) return
      var meta = roleLabels[role] || { who: 'Team', what: 'output', what_pl: 'outputs' }
      var label = bucket.length === 1
        ? 'Review · ' + meta.who + '\u2019s ' + meta.what
        : 'Review · ' + bucket.length + ' ' + meta.what_pl + ' from ' + meta.who
      var btn = document.createElement('button')
      btn.className = 'hq3-cockpit-chip' + (rendered === 0 ? ' primary' : '')
      btn.textContent = label
      btn.onclick = function () {
        var firstId = bucket[0] && bucket[0].id
        if (typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new CustomEvent('vx-hq3-focus-pipeline', { detail: { taskId: firstId } }))
        }
      }
      chips.appendChild(btn)
      rendered++
      tasksChipped += bucket.length
    })
    if (delivered.length > tasksChipped) {
      var more = document.createElement('button')
      more.className = 'hq3-cockpit-chip muted'
      var remaining = delivered.length - tasksChipped
      more.textContent = '+' + remaining + ' more'
      more.onclick = function () {
        var firstDelivered = delivered[0] && delivered[0].id
        if (typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new CustomEvent('vx-hq3-focus-pipeline', { detail: { taskId: firstDelivered } }))
        }
      }
      chips.appendChild(more)
    }
    strip.removeAttribute('hidden')
  }

  // ───── render: eyebrow date ───────────────────────────────────────
  // Today's date in the format "Monday · April 20" — refreshed each render
  // so a tab left open across midnight rolls forward correctly.
  function renderEyebrowDate (root) {
    var el = root.querySelector('#hq3-eyebrow-date')
    if (!el) return
    var d = new Date()
    var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    el.textContent = days[d.getDay()] + ' · ' + months[d.getMonth()] + ' ' + d.getDate()
  }

  var HQ3_TS_NOTICE_ID = 'hq3-ts-unavailable'
  function setHqMetricsDataNotice (root, show) {
    if (!root) return
    var el = document.getElementById(HQ3_TS_NOTICE_ID)
    if (!el) {
      el = document.createElement('div')
      el.id = HQ3_TS_NOTICE_ID
      el.setAttribute('role', 'status')
      el.style.cssText = 'margin:0 40px 20px;max-width:min(720px,92vw);padding:14px 18px;background:var(--s2);border:1px solid var(--b1);border-radius:12px;color:var(--t2);font-size:13px;line-height:1.55;display:none;font-family:inherit'
      el.textContent = 'We couldn\u2019t refresh the detailed charts (audience, posts, reach). Check your connection and reload this page.'
      var strip = root.querySelector('.eyebrow-strip')
      if (strip && strip.parentNode) {
        strip.parentNode.insertBefore(el, strip.nextSibling)
      } else {
        root.insertBefore(el, root.firstChild)
      }
    }
    el.style.display = show ? 'block' : 'none'
  }

  // ───── render: hero greeting (H1 + sub-line) ──────────────────────
  // The hardcoded "Your team shipped 4 posts overnight" gets replaced with
  // a count keyed off real task activity, falling back to a quiet message
  // when nothing happened. Sub-line summarizes each agent's latest work.
  function renderHeroGreeting (root, d) {
    var heroH1 = root.querySelector('.hq3-hero h1')
    var heroSub = root.querySelector('.hq3-hero .sub')
    var netNew = d.tasksFinishedSinceLastSeen || []
    var n = netNew.length

    if (heroH1) {
      var hour = new Date().getHours()
      var greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
      var name = (d.firstName || 'CEO').replace(/[<>&]/g, '')
      var bodyHtml
      if (n > 0) {
        bodyHtml = '<em>' + n + '</em> new ' + (n === 1 ? 'thing' : 'things')
          + '<br/>since you were last here.'
      } else {
        bodyHtml = 'Nothing new<br/>since you were last here.'
      }
      heroH1.innerHTML = greeting + ', ' + name + '.<br/>' + bodyHtml
    }
    if (heroSub) {
      // Sub-line: ONLY show roles that did something net-new. If nothing's
      // new, give an honest status pinned to the lastSeen window — never
      // recycle yesterday's boilerplate.
      var roleNames = { maya: 'Maya', jordan: 'Jordan', riley: 'Riley' }
      var parts = []
      ;['maya', 'jordan', 'riley'].forEach(function (role) {
        var t = (d.netNewTasksByRole || {})[role]
        if (!t) return
        var title = (t.title || '').slice(0, 60).replace(/[<>&]/g, '')
        if (!title) return
        var verb = (t.status === 'in_progress') ? 'is on'
                 : (t.status === 'pending') ? 'has queued'
                 : 'finished'
        parts.push(roleNames[role] + ' ' + verb + ' ' + title)
      })
      if (parts.length > 0) {
        heroSub.textContent = parts.join(' \u00b7 ')
      } else {
        // Quiet state — give the user a useful next signal instead of repeating
        // boilerplate. Mention when they last visited so the silence reads
        // as honest, not broken.
        var lastSeenAgo = d.lastSeenAgo ? ' (you last looked ' + d.lastSeenAgo + ')' : ''
        heroSub.textContent = 'Team is steady' + lastSeenAgo + '. Maya runs the next pulse on the morning cron — open a brief to kick off custom work.'
      }
    }
  }

  // ───── render: forecast hero numbers ──────────────────────────────
  function renderForecastHead (root, d) {
    // Guard: if overview hasn't loaded yet (followers === null), keep whatever
    // was previously rendered rather than flashing "—" over good data.
    if (d.followers == null) return
    var nu = fmtNumWithUnit(d.followers)
    var fcNum = $('.fc-num', root)
    if (fcNum) fcNum.innerHTML = nu[0] + (nu[1] ? '<span class="unit">' + nu[1] + '</span>' : '')

    var stats = $$('.fc-side .stat', root)
    function setStat (i, label, valueHTML) {
      var s = stats[i]; if (!s) return
      var k = s.querySelector('.k'); var v = s.querySelector('.v')
      if (k && label != null) k.textContent = label
      if (v) v.innerHTML = valueHTML
    }
    setStat(0, '30d pace', d.pacePerDay != null ? (d.pacePerDay >= 0 ? '+' : '−') + fmtShort(Math.abs(d.pacePerDay)) + '/day' : '—')
    // Suppress milestone timelines beyond 1 year — those project on assumptions
    // that won't hold and read as defeating ("→ 25K · 2,979 days").
    function milestoneVal (rung, days) {
      if (days == null) return '—'
      if (days > 365) return '<em>1y+</em>'
      return '<em>' + days + '</em> days'
    }
    setStat(1, d.milestone1 ? '→ ' + fmtShort(d.milestone1) : '→ —', milestoneVal(d.milestone1, d.daysToM1))
    setStat(2, d.milestone2 ? '→ ' + fmtShort(d.milestone2) : '→ —', milestoneVal(d.milestone2, d.daysToM2))
    setStat(3, 'Confidence', d.confidence != null ? d.confidence.toFixed(2) : '—')
  }

  // ───── render: mini stat strip ────────────────────────────────────
  function renderMiniStats (root, d) {
    // Same guard as renderForecastHead: skip overview-derived stats when
    // overview hasn't loaded yet so we don't flash "—" over good values.
    var hasOverview = d.followers != null
    var rows = $$('.hq3-hero-mini .row', root)
    if (rows[0]) {
      var v = rows[0].querySelector('.v')
      var del = rows[0].querySelector('.d .u')
      if (v && hasOverview) {
        if (d.reach7d != null) {
          var rn = fmtNumWithUnit(d.reach7d)
          v.innerHTML = '<em>' + rn[0] + '</em>' + rn[1]
        } else {
          v.textContent = '—'
        }
      }
      if (del && d.reach7dDelta != null) del.textContent = fmtDelta(d.reach7dDelta, '%')
    }
    if (rows[1] && hasOverview) {
      var v2 = rows[1].querySelector('.v')
      var del2 = rows[1].querySelector('.d .u')
      if (v2) v2.textContent = fmtShort(d.followers)
      if (del2) del2.textContent = (d.followersDelta != null ? fmtDelta(d.followersDelta) : '')
    }
  }

  // ───── render: forecast chart past-line ───────────────────────────
  // Replace the static `path.past-line` and `path.past-fill` with a curve
  // derived from STATE.overview.sparkline. Future-line is left as-is until
  // /api/platform/forecast is wired in.
  function renderForecastChart (root, d) {
    var svg = root.querySelector('#hq3-fc-chart svg')
    var series = d.scopedSparkline && d.scopedSparkline.length >= 2 ? d.scopedSparkline : d.sparkline
    if (!svg || !series || series.length < 1) return
    // Fresh accounts only have one snapshot — synthesize a second point at the
    // same value so the renderer draws a flat line instead of bailing out.
    if (series.length === 1) series = [series[0], series[0]]
    var pastLine = svg.querySelector('path.past-line')
    var pastFill = svg.querySelector('path.past-fill')
    if (!pastLine) return

    // Existing markup uses 0 → 420 for the past portion (NOW line at x=420).
    // y=20 is top, y=260 is bottom. Map sparkline to that band, with vertical
    // range pinned to the current min/max so the curve always fills the box.
    var values = series.map(function (s) { return s.total })
    var minV = Math.min.apply(null, values)
    var maxV = Math.max.apply(null, values)
    var span = maxV - minV || 1
    var xMax = 420
    var yTop = 30
    var yBottom = 250
    var yRange = yBottom - yTop
    var n = series.length

    var pts = series.map(function (s, i) {
      var x = (i / (n - 1)) * xMax
      var y = yBottom - ((s.total - minV) / span) * yRange
      return [x, y]
    })
    var line = pts.map(function (p, i) { return (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1) }).join(' ')
    pastLine.setAttribute('d', line)
    if (pastFill) {
      pastFill.setAttribute('d', line + ' L' + xMax + ',260 L0,260 Z')
    }

    // ── Future projection (NOW=x420 → x800 = ~60 days forward) ──
    // Use pacePerDay from the same scope. We project the next 60 days at
    // current pace, scaling y back into the same min/max band as the past.
    var futureLine = svg.querySelector('path.future-line')
    var nowVal = pts[pts.length - 1] ? values[values.length - 1] : null
    var futureDays = 60
    var futurePts = []
    if (futureLine && d.pacePerDay != null && nowVal != null) {
      var pace = d.pacePerDay
      // Re-evaluate min/max so the projected segment shares the past axis.
      // Adjust max if the projection exceeds it; floor at current min.
      var projTotalMax = nowVal + pace * futureDays
      var newMin = Math.min(minV, projTotalMax)
      var newMax = Math.max(maxV, projTotalMax)
      var newSpan = newMax - newMin || 1
      // Recompute past pts on the new band so past + future align
      var pts2 = values.map(function (v, i) {
        var x = (i / (n - 1)) * xMax
        var y = yBottom - ((v - newMin) / newSpan) * yRange
        return [x, y]
      })
      var line2 = pts2.map(function (p, i) { return (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1) }).join(' ')
      pastLine.setAttribute('d', line2)
      if (pastFill) pastFill.setAttribute('d', line2 + ' L' + xMax + ',260 L0,260 Z')
      // Build future points across [420, 800] = 380px = ~60 days
      var futureXMax = 800 - 420
      for (var fi = 0; fi <= futureDays; fi += 5) {
        var fx = 420 + (fi / futureDays) * futureXMax
        var fv = nowVal + pace * fi
        var fy = yBottom - ((fv - newMin) / newSpan) * yRange
        futurePts.push([fx, fy])
      }
      var fline = futurePts.map(function (p, i) { return (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1) }).join(' ')
      futureLine.setAttribute('d', fline)
    } else if (futureLine) {
      futureLine.setAttribute('d', '')
    }

    // ── Milestone dots — projected real arrival on the future line ──
    var msGroup = svg.querySelector('g.hq3-milestones')
    if (msGroup) {
      while (msGroup.firstChild) msGroup.removeChild(msGroup.firstChild)
      ;[d.milestone1, d.milestone2].forEach(function (m, idx) {
        if (!m || !d.pacePerDay || d.pacePerDay <= 0) return
        var daysOut = Math.ceil((m - nowVal) / d.pacePerDay)
        if (daysOut <= 0) return
        // If milestone falls beyond our 60d horizon, pin to right edge
        var clampedDays = Math.min(daysOut, futureDays)
        var mx = 420 + (clampedDays / futureDays) * (800 - 420)
        // y position based on the milestone follower count on the same band
        var newMin2 = Math.min(minV, nowVal + d.pacePerDay * futureDays)
        var newMax2 = Math.max(maxV, nowVal + d.pacePerDay * futureDays)
        var span2 = newMax2 - newMin2 || 1
        var my = yBottom - ((m - newMin2) / span2) * yRange
        var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
        dot.setAttribute('cx', mx.toFixed(1)); dot.setAttribute('cy', my.toFixed(1))
        dot.setAttribute('r', '3.5'); dot.setAttribute('class', 'milestone-dot')
        msGroup.appendChild(dot)
        var lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text')
        var labelText = (m >= 1000 ? (m / 1000) + 'K' : String(m)) + ' · ' + (daysOut > 365 ? '1y+' : daysOut + 'd')
        lbl.setAttribute('x', (mx + 6).toFixed(1)); lbl.setAttribute('y', (my - 6).toFixed(1))
        lbl.setAttribute('class', 'milestone-label')
        lbl.textContent = labelText
        msGroup.appendChild(lbl)
      })
    }

    // ── X-axis date labels — HTML overlay so text stays crisp (SVG
    //    uses preserveAspectRatio:none which distorts SVG text horizontally)
    var xAxisEl = root.querySelector('#hq3-x-axis')
    if (xAxisEl) {
      var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      var firstDate = series[0] && series[0].date ? new Date(series[0].date) : null
      var lastDate = series[series.length - 1] && series[series.length - 1].date ? new Date(series[series.length - 1].date) : null
      var labels = []
      if (firstDate) labels.push({ pct: 0, text: months[firstDate.getMonth()] + ' ' + firstDate.getDate() })
      if (lastDate) labels.push({ pct: 52.5, text: months[lastDate.getMonth()] + ' ' + lastDate.getDate() })
      if (d.pacePerDay != null) {
        labels.push({ pct: 76.25, text: '+30d' })
        labels.push({ pct: 99, text: '+60d' })
      }
      xAxisEl.innerHTML = labels.map(function (l) {
        return '<span style="left:' + l.pct + '%">' + l.text + '</span>'
      }).join('')
    }

    // ── Crosshair + tooltip on hover ─────────────────────────────────
    var chart = root.querySelector('#hq3-fc-chart')
    if (chart && !chart._crossWired) {
      chart._crossWired = true
      var crossSvg = chart.querySelector('.fc-cross')
      var crossLine = crossSvg && crossSvg.querySelector('.vline')
      var crossDot = crossSvg && crossSvg.querySelector('.dot')
      var tooltip = chart.querySelector('.fc-tooltip')
      var ttVal = tooltip && tooltip.querySelector('.fc-tt-val')
      var ttDate = tooltip && tooltip.querySelector('.fc-tt-date')

      chart.addEventListener('mousemove', function (e) {
        var rect = chart.getBoundingClientRect()
        var mx = e.clientX - rect.left
        var my = e.clientY - rect.top
        var xFrac = Math.max(0, Math.min(1, mx / rect.width))
        var svgX = xFrac * 800

        // Resolve value + label at cursor position
        var val = null
        var dateStr = ''
        var dotY = 140

        // Grab the live series/pts baked on the chart element by renderForecastChart
        var _pts = chart._chartPts
        var _series = chart._chartSeries
        var _nowVal = chart._chartNowVal
        var _pace = chart._chartPace
        var _yBottom = 250
        var _yTop = 30
        var _yRange = _yBottom - _yTop

        if (svgX <= 420 && _pts && _pts.length >= 2) {
          var idx = Math.round(xFrac / (420 / 800) * (_pts.length - 1))
          idx = Math.max(0, Math.min(_pts.length - 1, idx))
          val = _series && _series[idx] ? _series[idx].total : null
          dateStr = _series && _series[idx] && _series[idx].date
            ? new Date(_series[idx].date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : ''
          dotY = _pts[idx] ? _pts[idx][1] : 140
        } else if (svgX > 420 && _pace != null && _nowVal != null) {
          var daysFwd = Math.round((svgX - 420) / (800 - 420) * 60)
          val = Math.round(_nowVal + _pace * daysFwd)
          dateStr = '+' + daysFwd + 'd (projected)'
          // y position: need the same scale used for future line
          var _minV = chart._chartMinV || 0
          var _maxV = chart._chartMaxV || val
          var _span = Math.max(1, _maxV - _minV)
          dotY = _yBottom - ((val - _minV) / _span) * _yRange
        }

        // Position crosshair in SVG coordinates
        if (crossLine) { crossLine.setAttribute('x1', svgX.toFixed(1)); crossLine.setAttribute('x2', svgX.toFixed(1)) }
        if (crossDot) { crossDot.setAttribute('cx', svgX.toFixed(1)); crossDot.setAttribute('cy', dotY.toFixed(1)) }

        // Position tooltip in CSS pixels
        if (tooltip) {
          tooltip.style.left = mx + 'px'
          tooltip.style.top = my + 'px'
        }
        if (ttVal && val != null) ttVal.textContent = val.toLocaleString()
        if (ttDate) ttDate.textContent = dateStr
      })
    }

    // Store chart state on element so mousemove can read it
    chart._chartPts = pts2 || pts
    chart._chartSeries = series
    chart._chartNowVal = nowVal
    chart._chartPace = d.pacePerDay != null ? d.pacePerDay : null
    chart._chartMinV = futurePts.length ? Math.min(minV, nowVal + (d.pacePerDay || 0) * 60) : minV
    chart._chartMaxV = futurePts.length ? Math.max(maxV, nowVal + (d.pacePerDay || 0) * 60) : maxV
  }

  // ───── render: forecast legend ────────────────────────────────────
  function renderForecastLegend (root, d) {
    var legend = root.querySelector('.fc-legend')
    if (!legend || !d.accounts || d.accounts.length === 0) return
    var rows = []
    // Combined total first
    if (d.followers != null) {
      var deltaStr = d.followersDelta != null && d.followersDelta !== 0
        ? ' · ' + (d.followersDelta > 0 ? '▲ ' : '▼ ') + Math.abs(d.followersDelta)
        : ''
      rows.push('<span class="li on"><span class="sw"></span>All platforms · ' + fmtShort(d.followers) + deltaStr + '</span>')
    }
    // Per-platform — labels and class shorthands flow from PLATFORM_REGISTRY
    d.accounts.forEach(function (a) {
      var pf = platformClass(a.platform)
      var pfName = platformLabel(a.platform)
      rows.push('<span class="li ' + pf + '"><span class="sw"></span>' + pfName + ' · ' + fmtShort(a.latestFollowers) + '</span>')
    })
    legend.innerHTML = rows.join('')
  }

  // ───── render: goal anchor (DB-backed) ───────────────────────────
  // Goal is stored on company.goals.active via /api/company/goal.
  // Jordan auto-generates from real snapshot data (POST /goal/generate).
  // User can also set manually. Pacing computed server-side.

  var _goalCache = null    // { data, ts }
  var GOAL_CACHE_TTL = 30000 // 30 s — avoids spinner on every dashboard re-render

  function fetchGoal (cb) {
    if (_goalCache && Date.now() - _goalCache.ts < GOAL_CACHE_TTL) {
      cb(_goalCache.data)
      return
    }
    fetch('/api/company/goal', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (data) { _goalCache = { data: data, ts: Date.now() }; cb(data) })
      .catch(function () { cb(null) })
  }

  function _invalidateGoalCache () { _goalCache = null }

  function renderGoal (root) {
    var panel = root.querySelector('#hq3-goal')
    var form = root.querySelector('#hq3-goal-form')
    if (!panel || !form) return

    // Only show spinner on cold load (no cache yet)
    if (!_goalCache) {
      panel.innerHTML = '<span style="color:var(--t3);font-size:12px"><span class="vx-spin" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:6px"></span></span>'
      panel.removeAttribute('hidden')
    }
    form.setAttribute('hidden', '')

    fetchGoal(function (data) {
      if (!data || !data.goal) {
        // No goal — offer Jordan's auto-generate
        panel.innerHTML = '<span style="color:var(--t3);font-size:12px">No goal set yet.</span>'
          + '<button type="button" data-goal-action="generate" style="margin-left:10px">Let Jordan set one</button>'
          + '<button type="button" data-goal-action="manual" style="margin-left:6px;color:var(--t3)">Set manually</button>'
        panel.removeAttribute('hidden')
        _wireGoalButtons(root, panel, form, null)
        return
      }

      var goal = data.goal
      var pacing = data.pacing
      var label = goal.metricLabel || 'Followers'
      var targetFmt = goal.type === 'engagement'
        ? goal.target.toFixed(2) + '%'
        : goal.target.toLocaleString()

      var pct = 0
      var daysLeft = 0
      var onTrack = true
      var goalReached = false
      if (pacing) {
        goalReached = pacing.progressPct >= 1
        pct = goalReached ? 100 : Math.round(pacing.progressPct * 100)
        daysLeft = pacing.daysLeft || 0
        onTrack = pacing.onTrack !== false
      }

      var barColor = goalReached ? 'var(--ok)' : (onTrack ? 'var(--ok)' : 'var(--accent)')
      var barFill = Math.min(pct, 100)
      // min 2px visual so the fill dot is always visible even at 0%
      var barFillStyle = barFill === 0
        ? 'height:100%;width:2px;background:' + barColor + ';border-radius:100px'
        : 'height:100%;width:' + barFill + '%;background:' + barColor + ';border-radius:100px;transition:width .4s ease'
      var barHtml = pacing
        ? '<div style="margin:8px 0 4px;background:var(--hair-strong);border-radius:100px;height:5px;overflow:visible">'
            + '<div style="' + barFillStyle + '"></div>'
          + '</div>'
          + '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--t3)">'
            + '<span style="color:' + barColor + '">' + (goalReached ? '✓ Goal reached' : (onTrack ? '▲' : '▼') + ' ' + pct + '% there') + '</span>'
            + (daysLeft > 0 && !goalReached ? '<span>' + daysLeft + 'd left</span>' : '')
          + '</div>'
        : ''

      var sourceTag = goal.source === 'jordan'
        ? '<span style="font-size:10px;color:var(--t3);letter-spacing:.08em;text-transform:uppercase;margin-left:6px">Jordan</span>'
        : ''

      panel.innerHTML = '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:2px">'
        + '<span style="font-size:12px;font-weight:500;color:var(--t1)">' + label + ' → ' + targetFmt + '</span>'
        + sourceTag
        + '</div>'
        + barHtml
        + '<div style="font-size:11px;color:var(--t3);margin-top:4px">' + escHtml(goal.rationale.replace(/\bin \d+ days?\b/gi, 'in ' + daysLeft + (daysLeft === 1 ? ' day' : ' days'))) + '</div>'
      panel.removeAttribute('hidden')
      _wireGoalButtons(root, panel, form, goal)
    })
  }

  function _wireGoalButtons (root, panel, form, goal) {
    panel.addEventListener('click', function handler (e) {
      var btn = e.target.closest('[data-goal-action]')
      if (!btn) return
      var action = btn.dataset.goalAction

      if (action === 'generate' || action === 'different') {
        btn.disabled = true
        btn.textContent = '⏳ Jordan is thinking…'
        var url = '/api/company/goal/generate' + (action === 'different' ? '?different=1' : '')
        fetch(url, { method: 'POST', credentials: 'include' })
          .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status) })
          .then(function () { _invalidateGoalCache(); panel.removeEventListener('click', handler); renderGoal(root) })
          .catch(function () { btn.disabled = false; btn.textContent = action === 'different' ? 'Different goal' : 'Let Jordan set one' })
        return
      }

      if (action === 'manual') {
        panel.setAttribute('hidden', '')
        form.removeAttribute('hidden')
        var t = form.querySelector('input[name="target"]')
        if (t) t.focus()
        return
      }

      if (action === 'clear') {
        fetch('/api/company/goal', { method: 'DELETE', credentials: 'include' })
          .then(function () { _invalidateGoalCache(); panel.removeEventListener('click', handler); renderGoal(root) })
        return
      }
    }, { once: false })
  }

  function wireGoalForm (root) {
    var form = root.querySelector('#hq3-goal-form')
    if (!form || form._goalWired) return
    form._goalWired = true
    form.onsubmit = function (e) {
      e.preventDefault()
      var t = form.querySelector('input[name="target"]')
      var dd = form.querySelector('input[name="deadline"]')
      var target = parseFloat(t && t.value)
      var deadline = dd && dd.value
      if (!target || !deadline) return
      var submit = form.querySelector('button[type="submit"]')
      if (submit) { submit.disabled = true; submit.textContent = '⏳ Saving…' }
      fetch('/api/company/goal', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: target, byDate: deadline }),
      })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status) })
        .then(function () {
          _invalidateGoalCache()
          form.setAttribute('hidden', '')
          renderGoal(root)
        })
        .catch(function () {
          if (submit) { submit.disabled = false; submit.textContent = 'Save' }
        })
    }
    var cancel = form.querySelector('[data-cancel]')
    if (cancel) cancel.onclick = function () {
      form.setAttribute('hidden', '')
      renderGoal(root)
    }
  }

  // ───── wire: platform toggle (All / connected platforms) ─────────
  // Buttons are GENERATED from the connected accounts list — no hardcoded
  // platform names in the wire. When a new integration is added (YouTube,
  // X, etc.), it appears in the toggle automatically as soon as the user
  // connects an account. Order follows PLATFORM_REGISTRY[*].sort.
  function wirePlatformToggle (root) {
    var toggle = root.querySelector('#hq3-platform-toggle')
    if (!toggle) return
    var state = window.__vxDashState
    var accounts = (state && state.overview && state.overview.accounts) || []
    var connected = connectedPlatforms(accounts)
      .sort(function (a, b) { return platformInfo(a).sort - platformInfo(b).sort })

    // Re-build button set every render so connecting a new integration is
    // picked up without a page reload. We keep `currentPlatform` as
    // module-level state — preserves selection across re-renders.
    var html = '<button data-platform="all">All</button>'
    connected.forEach(function (p) {
      html += '<button data-platform="' + p + '">' + escHtml(platformLabel(p)) + '</button>'
    })
    // Only one connected platform → hide the toggle entirely (no choice = no
    // toggle to make). The "All" view tells the same story as the only one.
    if (connected.length <= 1) {
      toggle.innerHTML = ''
      toggle.style.display = 'none'
      currentPlatform = 'all'
      return
    }
    toggle.style.display = ''
    toggle.innerHTML = html

    // Apply current selection
    toggle.querySelectorAll('button').forEach(function (btn) {
      if (btn.dataset.platform === currentPlatform) btn.classList.add('on')
      btn.onclick = function () {
        var newPlatform = btn.dataset.platform || 'all'
        if (newPlatform === currentPlatform) return
        currentPlatform = newPlatform
        try { localStorage.setItem('hq3-platform', newPlatform) } catch {}
        toggle.querySelectorAll('button').forEach(function (b) { b.classList.remove('on') })
        btn.classList.add('on')
        var cap = root.querySelector('#hq3-platform-cap')
        if (cap) {
          cap.textContent = newPlatform === 'all' ? 'all platforms' : platformLabel(newPlatform)
        }
        render()
      }
    })
  }

  // ───── wire: posts-filter platform chips ──────────────────────────
  // The posts table sidebar has a filter strip with Instagram/TikTok/YouTube
  // chips. Hide platform chips for unconnected platforms so the user never
  // sees a "YouTube" button when they have no YouTube account.
  function wirePostsFilterChips (root) {
    var strip = root.querySelector('[data-hq3-filters]')
    if (!strip) return
    var accounts = (window.__vxDashState && window.__vxDashState.overview && window.__vxDashState.overview.accounts) || []
    var connected = {}
    connectedPlatforms(accounts).forEach(function (p) { connected[p] = true })
    strip.querySelectorAll('[data-filter-platform]').forEach(function (chip) {
      var p = chip.dataset.filterPlatform
      if (p === 'all') { chip.style.display = ''; return }
      chip.style.display = connected[p] ? '' : 'none'
    })
  }

  // ───── wire: forecast pill tabs (7D / 30D / 90D / 1Y) ─────────────
  // Re-scopes the forecast chart + side stats to the chosen window. Uses
  // onclick (not addEventListener) so re-runs of render() replace handlers
  // instead of stacking. Numbers always reflect the actually-available data
  // window — if there are only 26 days of history, 90D/1Y just show all 26.
  function wireForecastTabs (root, d) {
    var tabsEl = root.querySelector('[data-hq3-tabs]')
    if (!tabsEl) return
    var buttons = $$('button', tabsEl)
    if (!buttons.length) return
    var WINDOW_BY_LABEL = { '7D': 7, '30D': 30, '90D': 90, '1Y': 365 }

    // Disable tabs whose window exceeds available data. Meta caps daily
    // insights at ~30 days, so longer windows only become meaningful as
    // we accumulate fresh daily snapshots over time.
    var available = (d.sparkline && d.sparkline.length) || 0
    var activeBtn = null
    buttons.forEach(function (btn) {
      var label = (btn.textContent || '').trim().toUpperCase()
      var windowDays = WINDOW_BY_LABEL[label] || 30
      var insufficient = windowDays > available
      if (insufficient) {
        btn.disabled = true
        btn.classList.add('hq3-tab-locked')
        btn.classList.remove('on')
        btn.title = available > 0
          ? 'Only ' + available + ' day' + (available === 1 ? '' : 's') + ' of data so far — fills in over time'
          : 'Connect a platform to start collecting data'
      } else {
        btn.disabled = false
        btn.classList.remove('hq3-tab-locked')
        btn.title = ''
        if (btn.classList.contains('on')) activeBtn = btn
      }
    })
    // If the previously-active tab got disabled, fall back to the longest
    // enabled window so the chart still shows something meaningful.
    if (!activeBtn) {
      var fallback = null
      buttons.forEach(function (btn) {
        if (btn.disabled) return
        var w = WINDOW_BY_LABEL[(btn.textContent || '').trim().toUpperCase()] || 0
        if (!fallback || w > (WINDOW_BY_LABEL[(fallback.textContent || '').trim().toUpperCase()] || 0)) fallback = btn
      })
      if (fallback) {
        buttons.forEach(function (b) { b.classList.remove('on') })
        fallback.classList.add('on')
      }
    }

    buttons.forEach(function (btn) {
      btn.onclick = function () {
        if (btn.disabled) return
        buttons.forEach(function (b) { b.classList.remove('on') })
        btn.classList.add('on')
        var label = (btn.textContent || '').trim().toUpperCase()
        var windowDays = WINDOW_BY_LABEL[label] || 30
        var fc = computeForecastFor(d.sparkline, d.followers, windowDays)
        var scoped = {
          followers: d.followers,
          followersDelta: d.followersDelta,
          sparkline: d.sparkline,
          scopedSparkline: fc.scopedSparkline,
          pacePerDay: fc.pacePerDay,
          milestone1: fc.milestone1, milestone2: fc.milestone2,
          daysToM1: fc.daysToM1, daysToM2: fc.daysToM2,
          confidence: fc.confidence,
          accounts: d.accounts,
        }
        try { renderForecastHead(root, scoped) } catch (e) { console.error('[hq-v3] forecast head re-render', e) }
        try { renderForecastChart(root, scoped) } catch (e) { console.error('[hq-v3] forecast chart re-render', e) }
      }
    })
  }

  // ───── render: pipeline nodes ─────────────────────────────────────
  function renderPipelineNodes (root, d) {
    ['maya', 'jordan', 'riley'].forEach(function (role) {
      var node = root.querySelector('[data-node="' + role + '"]')
      if (!node) return
      var task = d.tasksByRole[role]
      if (!task) return
      var status = node.querySelector('.hq3-node-status')
      var taskEl = node.querySelector('.hq3-node-task')
      var prog = node.querySelector('.hq3-node-prog > span')
      var eta = node.querySelector('.hq3-node-eta')

      var typePretty = task.type ? friendlyStatusLabel(task.type) : ''
      var statusPretty = friendlyStatusLabel(task.status || 'in_progress')
      if (status) {
        status.innerHTML = '<span class="dt"></span>' + (typePretty ? typePretty + ' · ' + statusPretty : statusPretty)
      }
      if (taskEl && task.title) {
        // Set the task title from real data. enhancePipelineNodes() may
        // overwrite this with a richer summary pulled from the linked
        // weekly brief output once it loads (async).
        var safe = task.title.replace(/[<>&]/g, function (c) { return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] })
        taskEl.innerHTML = safe
      }
      var pct = task.status === 'approved' || task.status === 'delivered' ? 100
              : task.status === 'in_progress' ? 60
              : task.status === 'pending' ? 0 : 30
      if (prog) prog.style.width = pct + '%'
      if (eta) {
        var t = task.completedAt || task.createdAt
        var hhmm = t ? new Date(t).toTimeString().slice(0, 5) : '—'
        eta.innerHTML = '<span>' + pct + '%</span><span>· ' + hhmm + '</span>'
      }
    })
  }

  // ───── enhance pipeline cards with real brief summaries ──────────
  // The pipeline card titles default to cron template strings ("Build this
  // week's posting schedule") because that's what's in `task.title`. The
  // ACTUAL one-line summary lives in the linked weekly brief output
  // (e.g., Jordan's `weeklyGoal`, Alex's first hook, Riley's `musicMood`).
  // We fetch those four endpoints in parallel and overwrite each card's
  // .hq3-node-task with a real summary so a CEO scanning the pipeline
  // reads "Cozy autumn lifestyle: cinnamon mornings…" instead of the
  // template title.
  function enhancePipelineNodes (root, state) {
    var companyId = state && state.me && state.me.companies && state.me.companies[0] && state.me.companies[0].id
    if (!companyId) return
    var q = 'companyId=' + encodeURIComponent(companyId)

    // Per-role: which endpoint, which output field gets surfaced as the title.
    // The extractor returns a short string or null (null = leave title as-is).
    var FETCHES = [
      {
        role: 'maya',
        url: '/api/weekly/maya-pulse?' + q,
        extract: function (r) {
          var o = r && r.output
          if (!o) return null
          // Maya's "one thing to do" is the most actionable one-liner;
          // fall back to the trajectory summary which Bedrock writes for
          // every pulse.
          return o.oneThingToDo || (o.trajectory && o.trajectory.summary) || null
        },
      },
      {
        role: 'jordan',
        url: '/api/weekly/jordan-plan?' + q,
        extract: function (r) {
          var o = r && r.output
          if (!o) return null
          // Jordan's plan: prefer the explicit weekly goal, otherwise
          // describe the cadence + format mix.
          var plan = o.content_plan || o
          if (plan.weeklyGoal) return plan.weeklyGoal
          if (plan.weekly_goal) return plan.weekly_goal
          if (Array.isArray(plan.formats) && plan.formats.length > 0) {
            var top = plan.formats[0]
            return 'Plan: ' + top.name + ' priority' + (plan.cadence && plan.cadence.feed_posts ? ' · ' + plan.cadence.feed_posts + ' posts/wk' : '')
          }
          return null
        },
      },
      // Alex (copywriter) retired — the alex-hooks fetch entry was removed.
      {
        role: 'riley',
        url: '/api/studio/weekly-status?' + q + '&lite=1',
        extract: function (r) {
          if (!r) return null
          var na = (r.needsApproval && r.needsApproval.length) || 0
          var rp = (r.readyToPost && r.readyToPost.length) || 0
          if (na === 0 && rp === 0) return 'Nothing waiting in Studio'
          var parts = []
          if (na > 0) parts.push(na + (na === 1 ? ' needs your approval' : ' need your approval'))
          if (rp > 0) parts.push(rp + ' ready to post')
          return parts.join(' \u00b7 ')
        },
      },
    ]

    FETCHES.forEach(function (f) {
      get(f.url).then(function (r) {
        if (!r) return
        var node = root.querySelector('[data-node="' + f.role + '"]')
        if (!node) return
        // Cache the full payload + role config so the drawer can render
        // the full brief on click. Keyed on role; one fetch per role per
        // render cycle so we don't need staleness logic here.
        PIPELINE_DRAWER_CACHE[f.role] = { payload: r, role: f.role }
        if (r.taskId) node.setAttribute('data-task-id', r.taskId)
        if (r.status) node.setAttribute('data-task-status', r.status)
        node.classList.add('has-task')
        var summary = null
        try { summary = f.extract(r) } catch { return }
        if (summary) {
          var taskEl = node.querySelector('.hq3-node-task')
          // textContent: brief output is user-derived data
          if (taskEl) taskEl.textContent = summary
        }
      })
    })

    // ── Riley queue chips — needs approval + ready to post counts ──
    fetch('/api/studio/counts?companyId=' + encodeURIComponent(companyId), { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (data) {
        if (!data) return
        var queueEl = root.querySelector('#hq3-riley-queue')
        if (!queueEl) return
        var chips = []
        if (data.needsApproval > 0) {
          chips.push('<button class="hq3-riley-chip needs" data-navigate="db-studio">'
            + '<span class="dot"></span>'
            + data.needsApproval + ' need' + (data.needsApproval === 1 ? 's' : '') + ' approval'
            + '</button>')
        }
        if (data.readyToPost > 0) {
          chips.push('<button class="hq3-riley-chip ready" data-navigate="db-studio">'
            + '<span class="dot"></span>'
            + data.readyToPost + ' ready to post'
            + '</button>')
        }
        if (chips.length > 0) {
          queueEl.innerHTML = chips.join('')
          queueEl.removeAttribute('hidden')
          queueEl.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-navigate]')
            if (btn) window.navigate(btn.dataset.navigate)
          })
        }
      })
      .catch(function () {})
  }

  // ───── pipeline node drawer (Approve / Reject / Reconsider) ──────
  // Cache populated by enhancePipelineNodes() above. The drawer renders
  // off this cache so a click is instantaneous — no second fetch.
  var PIPELINE_DRAWER_CACHE = {}
  // Three-employee team after Alex (copywriter) was retired. Lookups for
  // `alex` will return undefined — drawer rendering bails cleanly.
  var ROLE_META = {
    maya:   { name: 'Maya',   role: 'Trend & Insights Analyst', letter: 'M' },
    jordan: { name: 'Jordan', role: 'Content Strategist',       letter: 'J' },
    riley:  { name: 'Riley',  role: 'Creative Director',        letter: 'R' },
  }

  function ensurePipelineDrawer () {
    var existing = document.getElementById('hq3-node-drawer')
    if (existing) return existing
    var d = document.createElement('div')
    d.id = 'hq3-node-drawer'
    d.className = 'hq3-drawer'
    d.setAttribute('aria-hidden', 'true')
    d.innerHTML = ''
      + '<div class="hq3-drawer-scrim" data-drawer-close></div>'
      + '<aside class="hq3-drawer-panel" role="dialog" aria-labelledby="hq3-drawer-name">'
      +   '<header class="hq3-drawer-head">'
      +     '<div class="hq3-drawer-port"><span class="ltr"></span></div>'
      +     '<div class="hq3-drawer-id"><div class="hq3-drawer-name" id="hq3-drawer-name"></div><div class="hq3-drawer-role"></div></div>'
      +     '<button class="hq3-drawer-close" data-drawer-close aria-label="Close">×</button>'
      +   '</header>'
      +   '<div class="hq3-drawer-status"></div>'
      +   '<div class="hq3-drawer-title"></div>'
      +   '<div class="hq3-drawer-body"></div>'
      +   '<footer class="hq3-drawer-actions">'
      +     '<button class="hq3-drawer-btn hq3-drawer-btn--primary" data-drawer-action="approve">Approve</button>'
      +     '<button class="hq3-drawer-btn" data-drawer-action="reconsider">Reconsider</button>'
      +     '<button class="hq3-drawer-btn hq3-drawer-btn--danger" data-drawer-action="reject">Reject</button>'
      +   '</footer>'
      +   '<div class="hq3-drawer-msg" data-drawer-msg></div>'
      + '</aside>'
    document.body.appendChild(d)

    d.addEventListener('click', function (e) {
      var navBtn = e.target.closest('[data-navigate]')
      if (navBtn && navBtn.getAttribute('data-navigate')) {
        var dest = navBtn.getAttribute('data-navigate')
        closePipelineDrawer()
        if (typeof window.navigate === 'function') window.navigate(dest)
        return
      }
      if (e.target.closest('[data-drawer-close]')) {
        closePipelineDrawer()
        return
      }
      var btn = e.target.closest('[data-drawer-action]')
      if (btn) handleDrawerAction(btn)
    })
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && d.classList.contains('is-open')) closePipelineDrawer()
    })
    return d
  }

  function closePipelineDrawer () {
    var d = document.getElementById('hq3-node-drawer')
    if (!d) return
    d.classList.remove('is-open')
    d.setAttribute('aria-hidden', 'true')
  }

  function clipLineFromStudio (c) {
    var desc = c && c.description && String(c.description).trim()
    var hook = c && c.hook && String(c.hook).trim()
    var cap = c && c.caption && String(c.caption).trim()
    var line = desc || hook || cap || 'Video clip'
    return line.length > 100 ? line.slice(0, 97) + '\u2026' : line
  }

  function studioPendingLabel (c) {
    var v = c && c.visualApprovalStatus === 'pending'
    var cp = c && c.copyApprovalStatus === 'pending'
    if (v && cp) return 'Visual + caption'
    if (v) return 'Visual edit'
    if (cp) return 'Caption'
    return 'Review'
  }

  function studioVideoHtml (c) {
    var url = c && c.previewUrl && String(c.previewUrl).trim()
    if (!url) {
      return '<div class="hq3-drawer-studio-video hq3-drawer-studio-video--missing">No preview available</div>'
    }
    return '<div class="hq3-drawer-studio-video">'
      + '<video controls playsinline preload="metadata" '
      + 'src="' + escHtml(url) + '" '
      + 'aria-label="Edited clip preview"></video>'
      + '</div>'
  }

  function renderRileyStudioQueueBody (payload) {
    var needs = Array.isArray(payload.needsApproval) ? payload.needsApproval : []
    var ready = Array.isArray(payload.readyToPost) ? payload.readyToPost : []
    if (needs.length === 0 && ready.length === 0) {
      return '<p class="hq3-drawer-empty">Nothing is waiting in Studio. Upload or finish an edit to see it here.</p>'
        + '<p class="hq3-drawer-studio-cta"><button type="button" class="hq3-drawer-btn hq3-drawer-btn--primary" data-navigate="db-studio">Open Studio</button></p>'
    }
    var blocks = []
    if (needs.length > 0) {
      var rows = needs.map(function (c) {
        var dur = c.duration != null && !isNaN(c.duration) ? Math.round(Number(c.duration)) + 's' : ''
        return '<div class="hq3-drawer-studio-row">'
          + studioVideoHtml(c)
          + '<div class="hq3-drawer-studio-main">' + escHtml(clipLineFromStudio(c)) + '</div>'
          + '<div class="hq3-drawer-studio-meta">' + escHtml(studioPendingLabel(c)) + (dur ? ' \u00b7 ' + dur : '') + '</div>'
          + '</div>'
      }).join('')
      blocks.push('<div class="hq3-drawer-row"><div class="hq3-drawer-k">Needs your approval</div><div class="hq3-drawer-v"><div class="hq3-drawer-studio-list">' + rows + '</div></div></div>')
    }
    if (ready.length > 0) {
      var rows2 = ready.map(function (c) {
        var dur = c.duration != null && !isNaN(c.duration) ? Math.round(Number(c.duration)) + 's \u00b7 ' : ''
        return '<div class="hq3-drawer-studio-row">'
          + studioVideoHtml(c)
          + '<div class="hq3-drawer-studio-main">' + escHtml(clipLineFromStudio(c)) + '</div>'
          + '<div class="hq3-drawer-studio-meta">' + dur + 'Ready to publish</div>'
          + '</div>'
      }).join('')
      blocks.push('<div class="hq3-drawer-row"><div class="hq3-drawer-k">Ready to post</div><div class="hq3-drawer-v"><div class="hq3-drawer-studio-list">' + rows2 + '</div></div></div>')
    }
    blocks.push('<p class="hq3-drawer-studio-cta"><button type="button" class="hq3-drawer-btn hq3-drawer-btn--primary" data-navigate="db-studio">Open Studio</button></p>')
    return blocks.join('')
  }

  // Render the same posting-strategy panel Studio shows under "When to
  // post" — three ranked slots (primary / alternative / testing) plus
  // the audience-peak headline. Fetched on demand when Jordan's drawer
  // opens so the cost is paid only when the user actually clicks.
  function fmtStrategyTime (isoOrDate) {
    var d = new Date(isoOrDate)
    if (isNaN(d.getTime())) return ''
    var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    var h = d.getUTCHours()
    var period = h >= 12 ? 'PM' : 'AM'
    var display = (h % 12 || 12) + ':00 ' + period
    return days[d.getUTCDay()] + ', ' + months[d.getUTCMonth()] + ' ' + d.getUTCDate() + ' · ' + display
  }
  function fmtPeakHour (hour) {
    if (hour == null) return '—'
    var period = hour >= 12 ? 'PM' : 'AM'
    var hr12 = period === 'PM' ? hour - 12 || 12 : hour || 12
    return hr12 + ' ' + period + ' · typical peak'
  }
  function jordanStrategyHtml (strategy) {
    if (!strategy) {
      return '<p class="hq3-drawer-empty">Once your connected account has a few weeks of activity, Jordan calls your peak posting windows here.</p>'
    }
    var ctx = strategy.context || {}
    var dayPart = ctx.bestDayOfWeek ? ctx.bestDayOfWeek.slice(0, 3) + ' ' : ''
    var peak = ctx.audiencePeakHour != null ? (dayPart + fmtPeakHour(ctx.audiencePeakHour)) : '—'
    var SLOTS = [
      { key: 'primary',   label: 'Primary' },
      { key: 'secondary', label: 'Alternative' },
      { key: 'tertiary',  label: 'Testing window' },
    ]
    var slotHtml = SLOTS.map(function (slot) {
      var rec = strategy[slot.key]
      if (!rec) return ''
      var pct = Math.round((rec.confidence || 0) * 100) + '%'
      var timeStr = fmtStrategyTime(rec.recommendedTime)
      var tags = [
        rec.audiencePeak ? '<span class="hq3-drawer-pill">Audience peak</span>' : '',
        rec.formatPerformance ? '<span class="hq3-drawer-pill">' + escHtml(rec.formatPerformance) + '</span>' : '',
      ].filter(Boolean).join('')
      return ''
        + '<div class="hq3-drawer-slot">'
        +   '<div class="hq3-drawer-slot-head">'
        +     '<div>'
        +       '<div class="hq3-drawer-slot-label">' + slot.label + '</div>'
        +       '<div class="hq3-drawer-slot-time">' + escHtml(timeStr) + '</div>'
        +     '</div>'
        +     '<span class="hq3-drawer-slot-conf">' + pct + '</span>'
        +   '</div>'
        +   (rec.rationale ? '<div class="hq3-drawer-slot-rationale">' + escHtml(rec.rationale) + '</div>' : '')
        +   (tags ? '<div class="hq3-drawer-slot-tags">' + tags + '</div>' : '')
        + '</div>'
    }).join('')
    return ''
      + '<div class="hq3-drawer-row"><div class="hq3-drawer-k">Audience peak</div><div class="hq3-drawer-v">' + escHtml(peak) + '</div></div>'
      + slotHtml
  }
  function hydrateJordanStrategy () {
    var slot = document.getElementById('hq3-jordan-strategy')
    if (!slot) return
    // Resolve company id via /api/auth/me — the local `state` IIFE-closure
    // var was the wrong scope here. Single round-trip; cheap.
    fetch('/api/auth/me', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (me) {
        var company = me && me.companies && me.companies[0]
        if (!company || !company.id) {
          var slotA = document.getElementById('hq3-jordan-strategy')
          if (slotA) slotA.innerHTML = '<p class="hq3-drawer-empty">Connect your account to see Jordan’s strategy.</p>'
          return
        }
        return fetch('/api/studio/posting-strategy', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId: company.id, contentType: 'video' }),
        }).then(function (r) { return r.ok ? r.json() : null })
      })
      .then(function (strategy) {
        // Drawer might already be closed by now (user moved on). Don't
        // overwrite stale DOM.
        var still = document.getElementById('hq3-jordan-strategy')
        if (!still) return
        if (strategy === undefined) return // already handled the no-company branch
        still.innerHTML = jordanStrategyHtml(strategy)
      })
      .catch(function () {
        var still = document.getElementById('hq3-jordan-strategy')
        if (still) still.innerHTML = '<p class="hq3-drawer-empty">Couldn’t load Jordan’s strategy right now. Refresh in a moment.</p>'
      })
  }

  function renderDrawerBody (role, payload) {
    // Riley: Studio queue (pending / ready to post) — no weekly brief `output`
    if (role === 'riley' && payload && !payload.output
      && (Array.isArray(payload.needsApproval) || Array.isArray(payload.readyToPost))) {
      return renderRileyStudioQueueBody(payload)
    }

    var o = payload && payload.output
    if (!o) return '<p class="hq3-drawer-empty">This brief hasn’t produced output yet. Once the agent ships, you’ll see the details here.</p>'
    var rows = []
    function row (k, v) {
      if (!v) return
      rows.push('<div class="hq3-drawer-row"><div class="hq3-drawer-k">' + escHtml(k) + '</div><div class="hq3-drawer-v">' + v + '</div></div>')
    }
    if (role === 'maya') {
      row('One thing to do', o.oneThingToDo ? escHtml(o.oneThingToDo) : null)
      row('Trajectory', o.trajectory && o.trajectory.summary ? escHtml(o.trajectory.summary) : null)
      if (Array.isArray(o.signals) && o.signals.length) {
        row('Signals', o.signals.slice(0, 4).map(function (s) { return '<span class="hq3-drawer-pill">' + escHtml(typeof s === 'string' ? s : (s.label || s.title || '')) + '</span>' }).join(''))
      }
    } else if (role === 'jordan') {
      // Jordan's drawer mirrors the Studio "When to Post" panel — that's
      // the actual deliverable surface for him now (audience peaks +
      // ranked posting windows). The hydration is async; we return a
      // placeholder here and openPipelineDrawer fills it after fetch.
      rows.push('<div id="hq3-jordan-strategy" class="hq3-drawer-strategy"><div class="hq3-drawer-empty">Loading Jordan’s strategy…</div></div>')
    } else if (role === 'riley') {
      if (o.kind === 'reel_shot_list' || (Array.isArray(o.shots) && !o.proposedFix)) {
        // ── Shot list ───────────────────────────────────────────────
        var desc = 'Shot list'
          + (o.reelTitle ? ' for <em>' + escHtml(o.reelTitle) + '</em>' : '')
          + (o.duration ? ' · ' + escHtml(o.duration) : '')
          + (o.framework ? '. <em>' + escHtml(o.framework) + '</em>.' : '.')
        rows.push('<p class="hq3-drawer-desc">' + desc + '</p>')
        if (Array.isArray(o.shots) && o.shots.length) {
          var shotLines = o.shots.map(function (s) {
            return '<div class="hq3-drawer-shot">'
              + '<span class="hq3-drawer-shot-at">' + escHtml(s.at || '') + '</span>'
              + '<span class="hq3-drawer-shot-desc">' + escHtml(s.shot || '') + '</span>'
              + (s.note ? '<span class="hq3-drawer-shot-note">' + escHtml(s.note) + '</span>' : '')
              + '</div>'
          }).join('')
          row('Shots', shotLines)
        }
        if (o.soundNote) row('Sound', escHtml(o.soundNote))
        if (o.editorNote) row('Editor note', escHtml(o.editorNote))

      } else if (o.kind === 'pacing_notes') {
        // ── Pacing notes ─────────────────────────────────────────────
        var seeingSection = Array.isArray(o.sections) && o.sections.find(function (s) { return /seeing/i.test(s.heading || '') })
        var seeingBody = seeingSection && seeingSection.body
        if (seeingBody) rows.push('<p class="hq3-drawer-desc">' + escHtml(seeingBody) + '</p>')
        var holdSection = Array.isArray(o.sections) && o.sections.find(function (s) { return /hold|target/i.test(s.heading || '') })
        if (holdSection && Array.isArray(holdSection.items)) {
          row('Target holds', holdSection.items.map(function (it) {
            return '<div class="hq3-drawer-line">' + escHtml(it) + '</div>'
          }).join(''))
        }
        if (o.oneFixThisWeek) row('This week', escHtml(o.oneFixThisWeek))

      } else if (o.kind === 'visual_direction') {
        // ── Visual direction ─────────────────────────────────────────
        rows.push('<p class="hq3-drawer-desc">' + escHtml(o.headline || 'Visual direction') + '</p>')
        if (Array.isArray(o.sections)) {
          o.sections.forEach(function (s) {
            var content = ''
            if (Array.isArray(s.items) && s.items.length) {
              content = s.items.map(function (it) { return '<div class="hq3-drawer-line">' + escHtml(it) + '</div>' }).join('')
            } else if (s.body) {
              content = escHtml(s.body)
            }
            if (content) row(s.heading || '', content)
          })
        }
        if (o.testShot) row('Test shot', escHtml(o.testShot))

      } else if (o.kind === 'thumbnail_brief') {
        // ── Thumbnail brief ───────────────────────────────────────────
        rows.push('<p class="hq3-drawer-desc">' + escHtml(o.headline || 'Thumbnail brief') + '</p>')
        if (o.spec) {
          if (o.spec.typeTreatment) row('Type', escHtml(o.spec.typeTreatment))
          if (o.spec.color) row('Colour', escHtml(o.spec.color))
          if (o.spec.focalSubject) row('Subject', escHtml(o.spec.focalSubject))
          if (o.spec.negativeSpace) row('Negative space', escHtml(o.spec.negativeSpace))
          if (o.spec.compositionRule) row('Composition', escHtml(o.spec.compositionRule))
        }
        if (o.dontDo) row("Don't", escHtml(o.dontDo))
        if (o.testAgainst) row('Test against', escHtml(o.testAgainst))

      } else if (o.kind === 'fix_weak_reel') {
        // ── Fix weak reel ─────────────────────────────────────────────
        rows.push('<p class="hq3-drawer-desc">' + escHtml(o.headline || 'Fix weak reel') + '</p>')
        if (o.diagnosis && o.diagnosis.body) row('What went wrong', escHtml(o.diagnosis.body))
        if (o.proposedFix && Array.isArray(o.proposedFix.shots)) {
          var fixLines = o.proposedFix.shots.map(function (s) {
            return '<div class="hq3-drawer-shot">'
              + '<span class="hq3-drawer-shot-at">' + escHtml(s.at || '') + '</span>'
              + '<span class="hq3-drawer-shot-desc">' + escHtml(s.shot || '') + '</span>'
              + (s.note ? '<span class="hq3-drawer-shot-note">' + escHtml(s.note) + '</span>' : '')
              + '</div>'
          }).join('')
          row('New open', fixLines)
        }
        if (o.whyItWorks) row('Why it works', escHtml(o.whyItWorks))
        if (o.reshoot) row('Reshoot', escHtml(o.reshoot))

      } else {
        // fallback for older/generic outputs
        if (o.musicMood || o.mood) row('Mood', escHtml(o.musicMood || o.mood))
        if (Array.isArray(o.shots)) row('Shots', escHtml(o.shots.length + ' staged'))
      }
    }
    if (!rows.length) return '<p class="hq3-drawer-empty">Brief is in flight. Detail will appear once the agent finalizes.</p>'
    return rows.join('')
  }

  function openPipelineDrawer (role) {
    var meta = ROLE_META[role]
    if (!meta) return
    var entry = PIPELINE_DRAWER_CACHE[role]
    var d = ensurePipelineDrawer()
    var payload = entry && entry.payload
    var taskId = payload && payload.taskId
    var status = payload && payload.status
    d.setAttribute('data-role', role)
    d.setAttribute('data-task-id', taskId || '')
    d.querySelector('.hq3-drawer-port .ltr').textContent = meta.letter
    d.querySelector('.hq3-drawer-name').textContent = meta.name
    d.querySelector('.hq3-drawer-role').textContent = meta.role
    var statusEl = d.querySelector('.hq3-drawer-status')
    var rileyStudio = role === 'riley' && payload && !payload.output
      && (Array.isArray(payload.needsApproval) || Array.isArray(payload.readyToPost))
    if (rileyStudio) {
      var nNeed = (payload.needsApproval && payload.needsApproval.length) || 0
      var nReady = (payload.readyToPost && payload.readyToPost.length) || 0
      statusEl.textContent = nNeed + ' to review \u00b7 ' + nReady + ' ready to post'
      d.querySelector('.hq3-drawer-title').textContent = 'What’s waiting in Studio'
    } else {
      statusEl.textContent = status ? ('Status · ' + friendlyStatusLabel(status)) : 'Nothing in progress right now'
      var title = (payload && payload.output && (payload.output.title || payload.output.briefTitle)) || (entry ? meta.name + '’s latest brief' : meta.name + ' has nothing in flight')
      d.querySelector('.hq3-drawer-title').textContent = title
    }
    d.querySelector('.hq3-drawer-body').innerHTML = renderDrawerBody(role, payload)
    if (rileyStudio) d.classList.add('hq3-drawer--studio-queue')
    else d.classList.remove('hq3-drawer--studio-queue')

    // Jordan's drawer body renders the same posting-strategy data that
    // lives in Studio's "When to Post" sidebar. The fetch is async, so
    // we hydrate the placeholder div right after the body innerHTML is
    // installed. Override drawer title + status to read like a strategy
    // surface, not a one-shot brief.
    if (role === 'jordan' && !rileyStudio) {
      d.querySelector('.hq3-drawer-title').textContent = 'When to post'
      statusEl.textContent = 'Strategy · audience peaks + ranked windows'
      hydrateJordanStrategy()
    }

    // Decide whether Approve / Reconsider / Reject make sense here, and if
    // not, *explain why*. Three buttons greying out with no copy looks like
    // the product is broken. Hide the row entirely for cases where action
    // would be nonsensical (Riley's studio-queue view) and surface a short
    // explanation in the msg slot for the others.
    var footerEl = d.querySelector('.hq3-drawer-actions')
    var msgEl = d.querySelector('[data-drawer-msg]')
    var reason = null
    if (rileyStudio) {
      reason = 'hidden' // queue view — actions belong inside Studio, not here
    } else if (role === 'jordan') {
      // Jordan's drawer is a strategy surface (When to post). Approve /
      // reject don't apply — the body itself is the deliverable. Hide
      // the footer entirely; no info banner needed.
      reason = 'hidden'
    } else if (!taskId) {
      reason = entry
        ? 'Nothing here needs your call right now. New work shows up the moment ' + meta.name + ' has a draft for you.'
        : meta.name + ' is between briefs. We’ll surface the next one as soon as it’s ready.'
    } else if (status === 'approved') {
      reason = 'You already approved this. ' + meta.name + ' has moved on to the next step.'
    } else if (status === 'rejected') {
      reason = 'You rejected this one. ' + meta.name + ' will deliver a fresh take soon.'
    }

    if (reason === 'hidden') {
      if (footerEl) footerEl.style.display = 'none'
      if (msgEl) {
        msgEl.textContent = ''
        msgEl.classList.remove('is-error', 'is-info')
      }
    } else if (reason) {
      if (footerEl) footerEl.style.display = 'none' // disabled buttons are dead UI; remove them
      if (msgEl) {
        msgEl.textContent = reason
        msgEl.classList.add('is-info')
        msgEl.classList.remove('is-error')
      }
    } else {
      if (footerEl) footerEl.style.display = ''
      d.querySelectorAll('[data-drawer-action]').forEach(function (b) {
        b.disabled = false
        b.classList.remove('is-disabled')
      })
      if (msgEl) {
        msgEl.textContent = ''
        msgEl.classList.remove('is-error', 'is-info')
      }
    }

    d.classList.add('is-open')
    d.setAttribute('aria-hidden', 'false')
  }

  async function handleDrawerAction (btn) {
    var d = document.getElementById('hq3-node-drawer')
    if (!d) return
    var taskId = d.getAttribute('data-task-id')
    var role = d.getAttribute('data-role')
    var action = btn.getAttribute('data-drawer-action')
    if (!taskId) return
    var feedback
    if (action === 'reject' || action === 'reconsider') {
      var promptMsg = action === 'reject'
        ? 'Why is this off? (optional — the agent uses this to revise)'
        : 'What angle should the agent rethink? (optional)'
      feedback = window.prompt(promptMsg, '')
      if (feedback === null) return
    }
    var msgEl = d.querySelector('[data-drawer-msg]')
    var btns = d.querySelectorAll('[data-drawer-action]')
    btns.forEach(function (b) { b.disabled = true })
    msgEl.textContent = 'Sending…'
    msgEl.classList.remove('is-error')
    try {
      var res = await fetch('/api/tasks/' + encodeURIComponent(taskId) + '/action', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action, ...(feedback ? { feedback: feedback } : {}) }),
      })
      if (!res.ok) throw new Error('http ' + res.status)
      var data = await res.json().catch(function () { return {} })
      var verb = action === 'approve' ? 'Approved' : action === 'reject' ? 'Rejected' : 'Sent for reconsideration'
      var chain = data && data.chain
      if (action === 'approve' && chain && chain.ok && chain.nextEmployeeName) {
        msgEl.textContent = verb + ' · ' + chain.nextEmployeeName + ' picked up the next step.'
      } else {
        msgEl.textContent = verb + '.'
      }
      // Mirror status onto the source node so the dashboard reflects it
      // without a full reload.
      var node = document.querySelector('#hq3-pipe .hq3-node[data-node="' + role + '"]')
      if (node) node.setAttribute('data-task-status', action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'revision')
      setTimeout(closePipelineDrawer, 1400)
    } catch (e) {
      msgEl.textContent = 'Couldn’t save that. Check your connection and try again.'
      msgEl.classList.add('is-error')
      btns.forEach(function (b) { b.disabled = false })
    }
  }

  // Expose for the body.html click handler
  window.openHQPipelineDrawer = openPipelineDrawer

  // ───── Bell / deep-link — expand HQ pipeline & open drawer for a task ─
  function expandHqPipelineSection () {
    var sect = document.getElementById('hq3-pipeline-sect')
    var btn = document.getElementById('hq3-pipeline-toggle')
    if (!sect) return
    if (!sect.classList.contains('collapsed')) return
    sect.classList.remove('collapsed')
    if (btn) {
      btn.textContent = 'Hide pipeline'
      btn.setAttribute('aria-expanded', 'true')
    }
    try {
      localStorage.setItem('hq3.pipelineCollapsed.v2', '0')
    } catch (_) { /* noop */ }
  }

  function scrollHqPipelineIntoView () {
    var sect = document.getElementById('hq3-pipeline-sect')
    if (sect) sect.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function pollOpenDrawerForTaskId (taskId, attempt) {
    if (!taskId) return
    var max = 28
    var i = attempt || 0
    var nodes = document.querySelectorAll('#hq3-pipe .hq3-node[data-task-id]')
    var found = null
    for (var j = 0; j < nodes.length; j++) {
      if (nodes[j].getAttribute('data-task-id') === taskId) {
        found = nodes[j]
        break
      }
    }
    if (found) {
      var role = found.getAttribute('data-node')
      document.querySelectorAll('#hq3-pipe .hq3-node').forEach(function (x) {
        x.classList.remove('active')
      })
      found.classList.add('active')
      if (typeof window.openHQPipelineDrawer === 'function' && role) {
        window.openHQPipelineDrawer(role)
      }
      return
    }
    if (i < max) {
      setTimeout(function () {
        pollOpenDrawerForTaskId(taskId, i + 1)
      }, 200)
    }
  }

  window.addEventListener('vx-hq3-focus-pipeline', function (ev) {
    var detail = (ev && ev.detail) || {}
    expandHqPipelineSection()
    try {
      window.dispatchEvent(new CustomEvent('vx-dash-ready'))
    } catch (_) { /* noop */ }
    scrollHqPipelineIntoView()
    setTimeout(function () {
      pollOpenDrawerForTaskId(detail.taskId, 0)
    }, 140)
  })

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 2 RENDERERS — fed by /api/platform/timeseries (snapshots, posts,
  // accountPlatforms, audiences) + /api/platform/maya-playbook.
  // ═══════════════════════════════════════════════════════════════════

  // ───── reach 7d from snapshots (fix the null-when-no-recent-posts case) ─
  // The hero "Reach · 7d" tile previously could only compute from posts in
  // last 7 days. For accounts that haven't posted in a while it would show '—'.
  // Snapshots carry per-platform `reach7d` directly — much more reliable.
  function renderReach7dFromSnapshots (root, ts) {
    if (!ts || !ts.snapshots) return
    var apMap = ts.accountPlatforms || {}
    // Latest snapshot per account
    var latest = {}
    ts.snapshots.forEach(function (s) {
      var key = s.accountId
      if (!latest[key] || new Date(s.capturedAt) > new Date(latest[key].capturedAt)) latest[key] = s
    })
    var totalReach7d = 0
    var totalReachPrev = 0
    Object.keys(latest).forEach(function (id) {
      totalReach7d += latest[id].reach7d || 0
      // 7-day-ago snapshot for delta. Pick the snapshot closest to (now - 7d).
      var target = Date.now() - 7 * 86400000
      var candidates = ts.snapshots.filter(function (s) { return s.accountId === id && new Date(s.capturedAt).getTime() <= target })
      if (candidates.length > 0) {
        var prev = candidates[candidates.length - 1]
        totalReachPrev += prev.reach7d || 0
      }
    })
    if (totalReach7d === 0) return
    var rows = $$('.hq3-hero-mini .row', root)
    if (!rows[0]) return
    var v = rows[0].querySelector('.v')
    var del = rows[0].querySelector('.d .u')
    if (v) {
      var unit = totalReach7d >= 1e6 ? 'M' : (totalReach7d >= 1e3 ? 'K' : '')
      var num = totalReach7d >= 1e6 ? (totalReach7d / 1e6).toFixed(1).replace(/\.0$/, '')
              : totalReach7d >= 1e3 ? (totalReach7d / 1e3).toFixed(1).replace(/\.0$/, '')
              : String(totalReach7d)
      v.innerHTML = '<em>' + num + '</em>' + unit
    }
    if (del && totalReachPrev > 0) {
      var pct = ((totalReach7d - totalReachPrev) / totalReachPrev) * 100
      del.textContent = (pct >= 0 ? '▲ ' : '▼ ') + Math.abs(pct).toFixed(0) + '%'
    } else if (del) {
      del.textContent = ''
    }
  }

  // ───── audience signals: 3 KPI tiles with mini-sparklines ─────────
  // Tiles are `.kv` inside `.kv-row`. Each contains: .k label, .v value,
  // .kv-spark SVG with two paths (.area + line) and an .end-dot circle, .d delta.
  // Order in markup: Engagement → Watch time · Reels → Daily growth.
  function renderAudienceSignals (root, ts) {
    if (!ts || !ts.snapshots) return
    var snaps = ts.snapshots.slice() // already asc by capturedAt
    if (snaps.length < 2) return

    // Build daily-resolution series by collapsing snapshots from multiple
    // accounts on the same day. We use the latest snapshot per (date, account)
    // and SUM across accounts for cumulative metrics; AVG for rates.
    var apMap = ts.accountPlatforms || {}
    var byDate = {}
    snaps.forEach(function (s) {
      var d = (s.capturedAt || '').slice(0, 10)
      if (!d) return
      if (!byDate[d]) byDate[d] = {}
      byDate[d][s.accountId] = s
    })
    var dates = Object.keys(byDate).sort()
    var engSeries = [] // array of fractions (0–1) per day, weighted by reach
    var watchSeries = []
    var growthSeries = []
    dates.forEach(function (d) {
      // Engagement: weight per-account engagementRate by reach
      var rEng = 0, totalReach = 0, growthSum = 0, n = 0
      Object.values(byDate[d]).forEach(function (s) {
        if (s.engagementRate7d != null) { rEng += s.engagementRate7d * (s.reach7d || 1); totalReach += (s.reach7d || 1) }
        if (s.growthRate7d != null) { growthSum += s.growthRate7d; n++ }
      })
      engSeries.push({ d: d, v: totalReach > 0 ? rEng / totalReach : 0 })
      growthSeries.push({ d: d, v: n > 0 ? growthSum : 0 })
    })

    // Watch time: posts only (Reels). Build daily avg of avgWatchTimeMs > 0.
    var postsByDay = {}
    ;(ts.posts || []).forEach(function (p) {
      if (!p.publishedAt || !p.avgWatchTimeMs) return
      var d = p.publishedAt.slice(0, 10)
      if (!postsByDay[d]) postsByDay[d] = []
      postsByDay[d].push(p.avgWatchTimeMs / 1000) // sec
    })
    Object.keys(postsByDay).sort().forEach(function (d) {
      var arr = postsByDay[d]
      watchSeries.push({ d: d, v: arr.reduce(function (a, b) { return a + b }, 0) / arr.length })
    })

    var tiles = $$('.kv-row .kv', root)
    function paintTile (tile, label, valueHtml, deltaHtml, series) {
      if (!tile) return
      var k = tile.querySelector('.k')
      var v = tile.querySelector('.v')
      var dEl = tile.querySelector('.d')
      var spark = tile.querySelector('.kv-spark')
      if (k && label) k.textContent = label
      if (v) v.innerHTML = valueHtml
      if (dEl) dEl.innerHTML = deltaHtml
      if (spark && series && series.length >= 2) {
        var values = series.map(function (s) { return s.v })
        var minV = Math.min.apply(null, values)
        var maxV = Math.max.apply(null, values)
        var span = maxV - minV || 1
        var pts = values.map(function (val, i) {
          var x = (i / (values.length - 1)) * 100
          var y = 28 - ((val - minV) / span) * 24 // 28 bottom, 4 top
          return [x, y]
        })
        var line = pts.map(function (p, i) { return (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1) }).join(' ')
        var fill = line + ' L100,32 L0,32 Z'
        var paths = spark.querySelectorAll('path')
        if (paths[0]) paths[0].setAttribute('d', fill) // .area
        if (paths[1]) paths[1].setAttribute('d', line) // line
        var dot = spark.querySelector('.end-dot')
        if (dot) {
          dot.setAttribute('cx', pts[pts.length - 1][0].toFixed(1))
          dot.setAttribute('cy', pts[pts.length - 1][1].toFixed(1))
        }
      }
    }

    // Niche benchmarks add a "X.Xx niche median" overlay on each KPI's
    // delta line — turns "12.4% engagement" into "12.4% · 4.5× lifestyle median".
    var niche = getCompanyNiche(window.__vxDashState)
    function benchmarkSuffix (value, metric) {
      var bm = getBenchmark(niche, metric)
      if (!bm || bm <= 0 || value <= 0) return ''
      var ratio = value / bm
      var nicheLabel = (niche || 'creators in your space').toLowerCase()
      // Plain English — say what the multiplier means, not "× median".
      if (ratio >= 1.5) return ' \u00b7 <em style="color:var(--accent)">' + ratio.toFixed(1) + '\u00d7 typical for ' + nicheLabel + ' creators</em>'
      if (ratio >= 0.85) return ' \u00b7 right around average for ' + nicheLabel + ' creators'
      return ' \u00b7 about ' + Math.round(ratio * 100) + '% of typical for ' + nicheLabel + ' creators'
    }

    // Tile 1: Engagement (28d)
    if (engSeries.length >= 2) {
      var first = engSeries[0].v
      var last = engSeries[engSeries.length - 1].v
      var deltaPts = (last - first) * 100
      paintTile(
        tiles[0],
        'Engagement',
        '<em>' + (last * 100).toFixed(1) + '</em>%',
        '<span class="u">' + (deltaPts >= 0 ? '▲ ' : '▼ ') + Math.abs(deltaPts).toFixed(1) + 'pt</span> · ' + engSeries.length + 'd trend' + benchmarkSuffix(last, 'engRate'),
        engSeries,
      )
    }

    // Tile 2: Watch time · Reels (avg seconds across all Reels)
    if (watchSeries.length >= 1) {
      var allSec = watchSeries.flatMap ? watchSeries.flatMap(function (s) { return [s.v] }) : watchSeries.map(function (s) { return s.v })
      var avgSec = allSec.reduce(function (a, b) { return a + b }, 0) / allSec.length
      var dPt = watchSeries.length >= 2 ? (watchSeries[watchSeries.length - 1].v - watchSeries[0].v) : 0
      paintTile(
        tiles[1],
        'Watch time · Reels',
        '<em>' + avgSec.toFixed(1) + '</em>s',
        '<span class="u">' + (dPt >= 0 ? '▲ ' : '▼ ') + Math.abs(dPt).toFixed(1) + 's</span> · ' + watchSeries.length + ' reels' + benchmarkSuffix(avgSec, 'watchTimeSec'),
        watchSeries,
      )
    }

    // Tile 3: Daily growth (followers/day, smoothed)
    if (growthSeries.length >= 1) {
      var lastGrowth = growthSeries[growthSeries.length - 1].v
      var lastNumber = lastGrowth
      var unit = 'followers/day'
      var growthLabel = lastNumber.toFixed(0)
      // For larger accounts, show in K. Modest accounts (<1000/day) show raw.
      if (Math.abs(lastNumber) >= 1000) growthLabel = (lastNumber / 1000).toFixed(1) + 'K'
      var firstGrowth = growthSeries[0].v
      var deltaPctG = firstGrowth !== 0 ? ((lastGrowth - firstGrowth) / Math.abs(firstGrowth)) * 100 : 0
      paintTile(
        tiles[2],
        'Daily growth',
        '<em>' + growthLabel + '</em><span style="font-family:Inter,sans-serif;font-size:18px;color:var(--t3);font-style:normal">/day</span>',
        '<span class="u">' + (deltaPctG >= 0 ? '▲ ' : '▼ ') + Math.abs(deltaPctG).toFixed(0) + '%</span> · ' + (deltaPctG > 5 ? 'accelerating' : deltaPctG < -5 ? 'slowing' : 'steady'),
        growthSeries,
      )
    }
  }

  // ───── best-time heatmap ──────────────────────────────────────────
  // Markup: 7-col day header + 6 hour rows (06/09/12/15/18/21) of 7 cells
  // each. Cells already have data-pct attributes — we'll overwrite both pct
  // text/title-style and CSS opacity (used for the heat color via opacity:.X
  // on a fixed accent fill in hq-v3.css).

  // Empty-state copy for the heatmap. Without this, when the schedule
  // fields aren't populated the placeholder grid sits there looking like
  // real (worthless) data and users assume the product is broken.
  function renderHeatmapEmpty (root, kind) {
    var hmWrap = root.querySelector('.hm-wrap')
    if (hmWrap) hmWrap.style.display = 'none'
    var hmFoot = root.querySelector('.hm-foot')
    if (hmFoot) hmFoot.style.display = 'none'

    var tile = root.querySelector('.tile:nth-of-type(2)')
    if (!tile) return
    var holder = tile.querySelector('.hq3-empty-heatmap')
    if (!holder) {
      holder = document.createElement('div')
      holder.className = 'hq3-empty-heatmap'
      holder.style.cssText = 'padding:24px 16px;border:1px dashed var(--b1);border-radius:10px;background:var(--s1);color:var(--t2);font-size:12px;line-height:1.6;text-align:center'
      var ref = tile.querySelector('.hq3-maya-take')
      tile.insertBefore(holder, ref || tile.firstChild)
    }
    holder.innerHTML = kind === 'no_posts'
      ? '<strong style="color:var(--t1);font-size:13px">No posts to chart yet</strong><br>Your best-time heatmap fills in once you have a few published Reels. The first chart appears after 2-3 posts.'
      : '<strong style="color:var(--t1);font-size:13px">Still pulling your post times</strong><br>Your posts are connected, but the publish-time metadata hasn\'t synced yet. This usually finishes within a few minutes — refresh in a moment.'

    var take = root.querySelector('.tile:nth-of-type(2) .hq3-maya-take .body')
    if (take) {
      take.textContent = kind === 'no_posts'
        ? 'Once you have a couple of posts in the same time window, I can call your sweet spot.'
        : 'I can\'t read your post times yet — they\'ll appear once the next sync finishes.'
    }
  }

  function renderHeatmap (root, ts) {
    if (!ts || !ts.posts) return

    var allPosts = (ts.posts || []).filter(function (p) { return p.publishedAt && isValidEngPost(p) })
    var posts = allPosts.filter(function (p) { return p.publishHour != null && p.publishDayOfWeek != null })

    // Distinguish three empty states so users aren't staring at a blank
    // grid wondering if the product is broken:
    //   (a) zero published posts → "post a Reel"
    //   (b) posts exist but publishHour/publishDayOfWeek aren't populated
    //       → sync hasn't filled the schedule fields; tell them it'll fill in
    //   (c) only 1-2 posts in same window → keep going (rendered below by peakKey logic)
    if (posts.length === 0) {
      renderHeatmapEmpty(root, allPosts.length === 0 ? 'no_posts' : 'no_metadata')
      return
    }

    // Bucket: dayOfWeek (0=Sun..6=Sat) × hour-band index (0..5 corresponding to 6/9/12/15/18/21)
    // The markup grid is Mon..Sun (col order), so we remap. Day 1=Mon → col 0, ..., Day 0=Sun → col 6.
    var hourBands = [6, 9, 12, 15, 18, 21]
    function bandFor (h) {
      var nearest = 0, bestDiff = Infinity
      for (var i = 0; i < hourBands.length; i++) {
        var diff = Math.abs(h - hourBands[i])
        if (diff < bestDiff) { bestDiff = diff; nearest = i }
      }
      return nearest
    }
    function colFor (dow) { return dow === 0 ? 6 : dow - 1 }

    var grid = {} // bandIdx-col → array of engagementRate
    posts.forEach(function (p) {
      var b = bandFor(p.publishHour)
      var c = colFor(p.publishDayOfWeek)
      var key = b + '-' + c
      if (!grid[key]) grid[key] = []
      grid[key].push(p.engagementRate)
    })

    // Compute max avg for color scaling
    var maxAvg = 0, peakKey = null, peakAvg = 0
    Object.keys(grid).forEach(function (k) {
      var arr = grid[k]
      var avg = arr.reduce(function (a, b) { return a + b }, 0) / arr.length
      if (avg > maxAvg) maxAvg = avg
      if (arr.length >= 2 && avg > peakAvg) { peakAvg = avg; peakKey = k }
    })

    // Walk all 7×6 cells in DOM order (markup goes row by row: 06/09/12/15/18/21).
    // Markup pattern: each row = 1 .lab + 7 .hm-cell siblings.
    var hmWrap = root.querySelector('.hm-wrap')
    if (!hmWrap) return
    // Restore the grid + footer if a previous empty-state render hid them
    // (e.g. user comes back after a sync filled in publishHour).
    hmWrap.style.display = ''
    var hmFootEl = root.querySelector('.hm-foot')
    if (hmFootEl) hmFootEl.style.display = ''
    var hmTile = root.querySelector('.tile:nth-of-type(2)')
    if (hmTile) {
      var staleEmpty = hmTile.querySelector('.hq3-empty-heatmap')
      if (staleEmpty) staleEmpty.remove()
    }
    // Find all rows by .lab elements (in order). For each lab, the next 7
    // .hm-cell siblings are the cells.
    var cellsByRow = []
    var labs = $$('.hm-wrap .lab', root)
    labs.forEach(function (lab) {
      var rowCells = []
      var sib = lab.nextElementSibling
      for (var i = 0; i < 7 && sib; i++) {
        if (sib.classList && sib.classList.contains('hm-cell')) rowCells.push(sib)
        sib = sib.nextElementSibling
      }
      cellsByRow.push(rowCells)
    })

    // Each row corresponds to a band (06,09,12,15,18,21 = bands 0..5)
    cellsByRow.forEach(function (cells, bandIdx) {
      cells.forEach(function (cell, col) {
        cell.classList.remove('peak')
        var key = bandIdx + '-' + col
        var arr = grid[key] || []
        var avg = arr.length > 0 ? arr.reduce(function (a, b) { return a + b }, 0) / arr.length : 0
        var ranked = arr.length >= 2
        var opacity = 0.05
        if (maxAvg > 0 && avg > 0) {
          var raw = avg / maxAvg
          // Single-post slots cap at 0.18 so they don't outshine ranked slots
          opacity = ranked ? Math.max(0.08, raw) : Math.min(0.18, Math.max(0.05, raw))
        }
        cell.style.opacity = opacity.toFixed(2)
        cell.dataset.pct = arr.length > 0 ? Math.round(avg * 100) : 0
        if (key === peakKey) cell.classList.add('peak')
      })
    })

    // Footer peak label
    var hmFoot = root.querySelector('.hm-foot')
    if (hmFoot) {
      var peakLabelEl = hmFoot.querySelector('span:first-child')
      if (peakLabelEl) {
        if (peakKey) {
          var parts = peakKey.split('-').map(Number)
          var dayShort = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][parts[1]]
          var hour = hourBands[parts[0]]
          var hr12 = hour > 12 ? (hour - 12) + 'pm' : hour === 12 ? '12pm' : hour + 'am'
          peakLabelEl.innerHTML = 'best window \u00b7 <em>' + dayShort + ' ' + hr12 + '</em> \u00b7 ' + (peakAvg * 100).toFixed(0) + '% engagement'
        } else {
          peakLabelEl.innerHTML = '<em>Still gathering data</em> \u00b7 needs a couple more posts in the same window'
        }
      }
    }

    // Maya's take — plain English
    var take = root.querySelector('.tile:nth-of-type(2) .hq3-maya-take .body')
    if (take) {
      if (peakKey) {
        var pp = peakKey.split('-').map(Number)
        var dayName = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][pp[1]]
        var hr = hourBands[pp[0]]
        var hr12s = hr > 12 ? (hr - 12) + 'pm' : hr === 12 ? '12pm' : hr + 'am'
        var n = (grid[peakKey] || []).length
        take.innerHTML = 'Your sweet spot is <em>' + dayName + ' around ' + hr12s + '</em> \u2014 posts there get <em>' + (peakAvg * 100).toFixed(1) + '%</em> engagement, across ' + n + ' post' + (n === 1 ? '' : 's') + '. Darker squares are stronger windows; faded squares only have one post so far, so it\u2019s too early to read them.'
      } else {
        take.textContent = 'Once you have a couple of posts in the same time window, I can call your sweet spot. Keep posting and this fills in.'
      }
    }
  }

  // ───── correlation chart from communityTags ───────────────────────
  // Replaces the placeholder rows ("Hook length <3s", "POV-mirror format", etc.)
  // with real correlations between communityTags categorical attributes and
  // engagement rate. We use a lift-vs-baseline measure (avg of category /
  // overall avg − 1) since Pearson on one-hot binaries is lossy.
  // Empty-state for the correlation tile. Same rationale as the heatmap —
  // without this, the static placeholder rows ("Hook length <3s" etc.) read
  // as real data when the underlying communityTags fields haven't been
  // populated yet, and users have no idea what's going on.
  function renderCorrelationEmpty (root, kind, postCount) {
    var tile = root.querySelector('.tile:nth-of-type(3)')
    if (!tile) return
    var corr = tile.querySelector('.corr')
    if (corr) corr.style.display = 'none'

    var holder = tile.querySelector('.hq3-empty-correlation')
    if (!holder) {
      holder = document.createElement('div')
      holder.className = 'hq3-empty-correlation'
      holder.style.cssText = 'padding:24px 16px;border:1px dashed var(--b1);border-radius:10px;background:var(--s1);color:var(--t2);font-size:12px;line-height:1.6;text-align:center'
      var ref = tile.querySelector('.hq3-maya-take')
      tile.insertBefore(holder, ref || tile.firstChild)
    }
    if (kind === 'no_posts') {
      holder.innerHTML = '<strong style="color:var(--t1);font-size:13px">No posts to compare yet</strong><br>Maya needs at least 5 published posts to spot what\'s driving your engagement. Keep posting and this fills in.'
    } else if (kind === 'few_posts') {
      var n = postCount || 0
      holder.innerHTML = '<strong style="color:var(--t1);font-size:13px">Need a few more posts</strong><br>You have ' + n + ' tagged post' + (n === 1 ? '' : 's') + '. Maya needs at least 5 to call patterns reliably.'
    } else if (kind === 'no_tags') {
      holder.innerHTML = '<strong style="color:var(--t1);font-size:13px">Still tagging your posts</strong><br>Your posts are connected but their content categories haven\'t been classified yet. This finishes a few minutes after you connect — refresh in a moment.'
    } else {
      holder.innerHTML = '<strong style="color:var(--t1);font-size:13px">Not enough variety yet</strong><br>Your posts so far have similar attributes, so there\'s nothing strong to call out. Once you mix in different formats, hooks, or moods, Maya can show what\'s working.'
    }

    var take = root.querySelector('.tile:nth-of-type(3) .hq3-maya-take .body')
    if (take) {
      take.textContent = kind === 'no_posts' || kind === 'few_posts'
        ? 'I\'ll call out what\'s working as soon as you have enough posts to compare.'
        : kind === 'no_tags'
          ? 'I can\'t read your post categories yet — they\'ll appear once tagging finishes.'
          : 'Mix in different formats and I\'ll call out what\'s pulling its weight.'
    }
  }

  function renderCorrelation (root, ts) {
    if (!ts || !ts.posts) return
    var allPosts = (ts.posts || []).filter(function (p) { return isValidEngPost(p) })
    var taggedPosts = allPosts.filter(function (p) { return p.communityTags })
    var validPosts = taggedPosts

    // Three failure modes, three messages:
    //   (a) no posts at all → "post a Reel"
    //   (b) posts exist but communityTags hasn't been populated by the
    //       heuristicTagger / Bedrock pipeline → "still tagging"
    //   (c) we have tagged posts but fewer than 5 → "need a few more"
    if (allPosts.length === 0) {
      renderCorrelationEmpty(root, 'no_posts')
      return
    }
    if (taggedPosts.length === 0) {
      renderCorrelationEmpty(root, 'no_tags')
      return
    }
    if (validPosts.length < 5) {
      renderCorrelationEmpty(root, 'few_posts', validPosts.length)
      return
    }

    var overallAvg = validPosts.reduce(function (a, p) { return a + p.engagementRate }, 0) / validPosts.length

    // For each tag attribute, compute lift per category. Keep the max-magnitude
    // category per attribute as our representative factor.
    var attrs = ['hookType', 'format', 'mood', 'contentLength', 'audienceType', 'visualStyle']
    var liftRows = []
    attrs.forEach(function (attr) {
      var byCat = {}
      validPosts.forEach(function (p) {
        var v = p.communityTags && p.communityTags[attr]
        if (!v) return
        if (!byCat[v]) byCat[v] = []
        byCat[v].push(p.engagementRate)
      })
      // Find the category with the strongest lift (positive or negative)
      var bestCat = null, bestLift = 0, bestN = 0
      Object.keys(byCat).forEach(function (cat) {
        var arr = byCat[cat]
        if (arr.length < 2) return // need at least 2 posts in the category
        var avg = arr.reduce(function (a, b) { return a + b }, 0) / arr.length
        var lift = (avg / overallAvg) - 1
        if (Math.abs(lift) > Math.abs(bestLift)) { bestLift = lift; bestCat = cat; bestN = arr.length }
      })
      if (bestCat) {
        liftRows.push({ label: humanizeTagLabel(attr, bestCat), lift: bestLift, n: bestN })
      }
    })

    // Plus a numeric correlation: caption length vs engagement (Pearson)
    var withCap = validPosts.filter(function (p) { return p.captionLength > 0 })
    if (withCap.length >= 5) {
      var x = withCap.map(function (p) { return p.captionLength })
      var y = withCap.map(function (p) { return p.engagementRate })
      var mx = x.reduce(function (a, b) { return a + b }, 0) / x.length
      var my = y.reduce(function (a, b) { return a + b }, 0) / y.length
      var sx = Math.sqrt(x.reduce(function (s, v) { return s + (v - mx) * (v - mx) }, 0) / x.length)
      var sy = Math.sqrt(y.reduce(function (s, v) { return s + (v - my) * (v - my) }, 0) / y.length)
      var r = (sx > 0 && sy > 0)
        ? x.reduce(function (s, v, i) { return s + (v - mx) * (y[i] - my) }, 0) / (x.length * sx * sy)
        : 0
      // Convert correlation r to a comparable lift-ish magnitude: r is already
      // -1..1. Treat magnitude ≥ 0.2 as worth showing.
      if (Math.abs(r) >= 0.15) liftRows.push({ label: 'Caption length', lift: r, n: withCap.length, isNumericFactor: true })
    }

    // Sort by absolute magnitude, take top 6
    liftRows.sort(function (a, b) { return Math.abs(b.lift) - Math.abs(a.lift) })
    liftRows = liftRows.slice(0, 6)

    if (liftRows.length === 0) {
      renderCorrelationEmpty(root, 'low_variety')
      return
    }
    // We have data — make sure the static placeholder isn't still hiding
    // the real chart from a previous empty render and tear down our tile.
    var tile = root.querySelector('.tile:nth-of-type(3)')
    if (tile) {
      var stale = tile.querySelector('.hq3-empty-correlation')
      if (stale) stale.remove()
      var corrEl = tile.querySelector('.corr')
      if (corrEl) corrEl.style.display = ''
    }
    var maxAbs = Math.max.apply(null, liftRows.map(function (r) { return Math.abs(r.lift) }))

    // Render into the existing .corr-row markup. Re-build innerHTML of .corr.
    var corr = root.querySelector('.tile:nth-of-type(3) .corr') || root.querySelector('.corr')
    if (!corr) return
    corr.innerHTML = liftRows.map(function (row) {
      var widthPct = (Math.abs(row.lift) / maxAbs) * 50 // chart uses ~50% max width
      var sign = row.lift >= 0 ? '+' : '−'
      var displayVal = row.isNumericFactor
        ? sign + Math.abs(row.lift).toFixed(2)
        : sign + (Math.abs(row.lift) * 100).toFixed(0) + '%'
      var negClass = row.lift < 0 ? ' neg' : ''
      return '<div class="corr-row">'
        + '<span class="name">' + escHtml(row.label) + '</span>'
        + '<span class="bar"><span class="axis"></span><span class="' + negClass.trim() + '" style="width:' + widthPct.toFixed(1) + '%"></span></span>'
        + '<span class="v">' + displayVal + '</span>'
        + '</div>'
    }).join('')

    // Maya's take — plain English, no jargon (no 'baseline', no 'n=', no 'lift')
    var take = root.querySelector('.tile:nth-of-type(3) .hq3-maya-take .body')
    if (take && liftRows.length > 0) {
      var top = liftRows[0]
      var bottom = liftRows.filter(function (r) { return r.lift < 0 }).pop()
      // Translate lift into a multiplier — easier to read than a percentage
      var topMult = 1 + top.lift
      var topPhrase = top.lift > 0
        ? '<em>' + escHtml(top.label) + '</em> get <em>' + topMult.toFixed(1) + '×</em> the engagement of your typical post'
        : '<em>' + escHtml(top.label) + '</em> are pulling engagement down — about <em>' + Math.abs(top.lift * 100).toFixed(0) + '% lower</em> than your usual'
      var sample = top.n === 1 ? '(only 1 post though — too early to call)' : '(' + top.n + ' posts so far)'
      var topMsg = topPhrase + ' ' + sample + '.'

      var tail
      if (bottom && bottom !== top) {
        tail = ' On the flip side, <em>' + escHtml(bottom.label) + '</em> are getting about <em>' + Math.abs(bottom.lift * 100).toFixed(0) + '% less</em> engagement. Lean into what\u2019s working; ease back on what isn\u2019t.'
      } else {
        tail = ' Lean into what\u2019s working.'
      }
      take.innerHTML = topMsg + tail
    }
  }

  // ───── posts table sidebar ────────────────────────────────────────
  // The .posts aside has hardcoded .post-row entries. Replace them with
  // real recent posts, sorted by publishedAt desc. Filter clicks remain
  // managed by the inline script in body.html.
  function renderPostsTable (root, ts) {
    if (!ts || !ts.posts) return
    var apMap = ts.accountPlatforms || {}
    var posts = ts.posts.slice()
      .filter(function (p) { return p.publishedAt })
      .sort(function (a, b) { return new Date(b.publishedAt) - new Date(a.publishedAt) })
    var posts8 = posts.slice(0, 8)
    if (posts8.length === 0) return

    var aside = root.querySelector('.posts')
    if (!aside) return
    var existing = aside.querySelectorAll('.post-row')
    existing.forEach(function (el) { el.remove() })

    var filterStrip = aside.querySelector('.post-filters')
    var html = posts8.map(function (p) {
      var platform = apMap[p.accountId] || 'instagram'
      var pf = platformClass(platform)
      var pfName = platformLabel(platform)
      var fmtName = (p.mediaType || '').replace('CAROUSEL_ALBUM', 'Carousel').replace('REEL', 'Reel').replace('VIDEO', 'Video').replace('IMAGE', 'Photo')
      // Thumbnail: prefer the real post image when we have one
      // (PlatformPost.thumbnailUrl is populated for IG carousels via the
      // first child fetch + for Reels via Meta's thumbnail). Fall back to
      // a media-type glyph when missing — covers brand-new posts where
      // sync hasn't finished yet.
      var thumbChar = (p.mediaType === 'REEL' || p.mediaType === 'VIDEO') ? '\u25B6'
                    : p.mediaType === 'CAROUSEL_ALBUM' ? '\u25EB'
                    : p.mediaType === 'IMAGE' ? '\u2B1C' : '\u25EF'
      var thumbHtml
      if (p.thumbnailUrl) {
        // Use <img> instead of background-image so broken URLs surface
        // (onerror swap to glyph) and the image can be lazy-loaded.
        var safeUrl = String(p.thumbnailUrl).replace(/"/g, '&quot;')
        thumbHtml = '<div class="thumb hq3-thumb-img"><img loading="lazy" decoding="async" src="' + safeUrl + '" alt="" onerror="this.parentNode.classList.remove(\'hq3-thumb-img\');this.parentNode.textContent=\'' + thumbChar + '\'"/></div>'
      } else {
        thumbHtml = '<div class="thumb">' + thumbChar + '</div>'
      }
      var caption = (p.caption || '(no caption)').slice(0, 60)
      var ago = (function (d) {
        var diff = Date.now() - new Date(d).getTime()
        var hrs = Math.floor(diff / 3600000)
        if (hrs < 24) return hrs + 'h'
        var days = Math.floor(hrs / 24)
        if (days < 30) return days + 'd'
        var months = Math.floor(days / 30)
        return months + 'mo'
      })(p.publishedAt)
      var views = p.viewCount || p.reachCount || 0
      var viewsFmt = views >= 1e6 ? (views / 1e6).toFixed(1) + 'M' : views >= 1e3 ? (views / 1e3).toFixed(1) + 'K' : String(views)
      // engagementRate is normalized to 0–1 by the API.
      var hasEng = isValidEngPost(p)
      var engPct = hasEng ? (p.engagementRate * 100).toFixed(1) : null
      var engCls = engPct == null ? '' : (parseFloat(engPct) >= 1.5 ? 'up' : 'down')
      var engHtml = engPct != null
        ? '<span class="e ' + engCls + '">' + (engCls === 'up' ? '▲' : '▼') + ' ' + engPct + '%</span>'
        : '<span class="e">—</span>'
      return '<div class="post-row">'
        + thumbHtml
        + '<div class="body">'
          + '<div class="t">' + escHtml(caption) + '</div>'
          + '<div class="m">'
            + '<span class="pf ' + pf + '"><span class="dot"></span>' + pfName + ' · ' + escHtml(fmtName) + '</span>'
            + '<span>' + ago + '</span>'
          + '</div>'
        + '</div>'
        + '<div class="nums">'
          + '<span class="n"><em>' + viewsFmt + '</em></span>'
          + engHtml
        + '</div>'
      + '</div>'
    }).join('')

    if (filterStrip) {
      filterStrip.insertAdjacentHTML('afterend', html)
    } else {
      aside.insertAdjacentHTML('beforeend', html)
    }
  }

  // ───── trend tile hover — crosshair + tooltip (same spirit as fc-chart) ─
  function _formatTrendHoverDate (ds) {
    if (!ds) return ''
    var iso = /^(\d{4}-\d{2}-\d{2})/.exec(String(ds))
    var d = iso ? new Date(iso[1] + 'T12:00:00') : new Date(ds)
    return isNaN(d.getTime()) ? String(ds) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  function wireTrendChartHover (canvas, series, pts, opts) {
    if (!canvas || !series || series.length < 2 || !pts || pts.length < 2) return
    var w = opts.w
    var h = opts.h
    var n = series.length
    var formatVal = opts.format || function (v) { return Math.round(v).toLocaleString() }
    var crossSvg = canvas.querySelector('.hq3-trend-cross')
    var crossLine = crossSvg && crossSvg.querySelector('.vline')
    var crossDot = crossSvg && crossSvg.querySelector('.dot')
    var tooltip = canvas.querySelector('.hq3-trend-tooltip')
    var ttVal = tooltip && tooltip.querySelector('.hq3-trend-tt-val')
    var ttDate = tooltip && tooltip.querySelector('.hq3-trend-tt-date')

    canvas.addEventListener('mousemove', function (e) {
      var rect = canvas.getBoundingClientRect()
      if (!(rect.width > 0)) return
      var mx = e.clientX - rect.left
      var my = e.clientY - rect.top
      var xFrac = Math.max(0, Math.min(1, mx / rect.width))
      var svgX = xFrac * w
      var idx = Math.round(xFrac * (n - 1))
      idx = Math.max(0, Math.min(n - 1, idx))
      var row = series[idx]
      var dotY = pts[idx] ? pts[idx][1] : h * 0.5

      if (crossLine) {
        crossLine.setAttribute('x1', svgX.toFixed(1))
        crossLine.setAttribute('x2', svgX.toFixed(1))
      }
      if (crossDot) {
        crossDot.setAttribute('cx', svgX.toFixed(1))
        crossDot.setAttribute('cy', dotY.toFixed(1))
      }
      if (tooltip) {
        tooltip.style.left = mx + 'px'
        tooltip.style.top = my + 'px'
      }
      if (ttVal && row) ttVal.textContent = formatVal(row.v)
      if (ttDate && row && row.d != null) ttDate.textContent = _formatTrendHoverDate(row.d)
    })
  }

  // ───── shared SVG line-chart helper for trend tiles ──────────────
  // Renders a compact line chart with a top summary (current value + delta
  // vs first value). Used by reach trend + engagement velocity. Returns
  // the HTML string so callers can wrap their own takes around it.
  function renderTrendChart (containerEl, series, opts) {
    if (!containerEl) return null
    opts = opts || {}
    if (!series || series.length < 2) {
      containerEl.innerHTML = '<div class="hq3-trend-empty">' + (opts.empty || 'Not enough data yet — keep posting and this fills in.') + '</div>'
      return null
    }
    var values = series.map(function (s) { return s.v })
    var minV = Math.min.apply(null, values)
    var maxV = Math.max.apply(null, values)
    var span = maxV - minV || 1
    var first = values[0], last = values[values.length - 1]
    var delta = last - first
    var deltaPct = first > 0 ? (delta / first) * 100 : 0
    var w = 500, h = 100, pad = 6
    var pts = values.map(function (v, i) {
      var x = pad + (i / (values.length - 1)) * (w - pad * 2)
      var y = pad + (1 - (v - minV) / span) * (h - pad * 2)
      return [x, y]
    })
    var line = pts.map(function (p, i) { return (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1) }).join(' ')
    var fill = line + ' L' + pts[pts.length - 1][0].toFixed(1) + ',' + h + ' L' + pts[0][0].toFixed(1) + ',' + h + ' Z'
    var lastPt = pts[pts.length - 1]
    var formatVal = opts.format || function (v) { return Math.round(v).toLocaleString() }
    var summaryClass = delta > 0 ? 'up' : delta < 0 ? 'down' : ''
    var arrow = delta > 0 ? '\u25B2 ' : delta < 0 ? '\u25BC ' : ''
    var deltaText = first > 0 && Math.abs(deltaPct) >= 0.5
      ? arrow + Math.abs(deltaPct).toFixed(0) + '% over ' + values.length + ' days'
      : 'steady over ' + values.length + ' days'
    var startCx = pts[0][0].toFixed(1)
    containerEl.innerHTML = ''
      + '<div class="hq3-trend-summary">'
        + '<div class="v"><em>' + escHtml(formatVal(last)) + '</em></div>'
        + '<div class="d ' + summaryClass + '">' + deltaText + '</div>'
      + '</div>'
      + '<div class="hq3-trend-canvas">'
        + '<svg class="hq3-trend-lines" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">'
          + '<path d="' + fill + '" fill="var(--accent)" opacity=".08"/>'
          + '<path d="' + line + '" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round"/>'
          + '<circle cx="' + lastPt[0].toFixed(1) + '" cy="' + lastPt[1].toFixed(1) + '" r="3" fill="var(--accent)"/>'
        + '</svg>'
        + '<svg class="hq3-trend-cross" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true">'
          + '<line class="vline" x1="' + startCx + '" y1="0" x2="' + startCx + '" y2="' + h + '"/>'
          + '<circle class="dot" cx="' + lastPt[0].toFixed(1) + '" cy="' + lastPt[1].toFixed(1) + '" r="3.5"/>'
        + '</svg>'
        + '<div class="hq3-trend-tooltip"><strong class="hq3-trend-tt-val"></strong><span class="hq3-trend-tt-date"></span></div>'
      + '</div>'
    wireTrendChartHover(containerEl.querySelector('.hq3-trend-canvas'), series, pts, {
      w: w, h: h, pad: pad, format: formatVal,
    })
    return { first: first, last: last, delta: delta, deltaPct: deltaPct, n: values.length }
  }

  // ───── render: reach trend ────────────────────────────────────────
  // 30-day reach trajectory from snapshot.reach7d, summed across accounts
  // by date. Reach = how many people the algorithm pushed to — distinct
  // from follower count (which is who already follows you).
  function renderReachTrend (root, ts) {
    var el = root.querySelector('#hq3-reach-trend')
    var takeEl = root.querySelector('#hq3-reach-take')
    if (!el) return
    var snaps = (ts && ts.snapshots) || []
    if (snaps.length < 2) {
      el.innerHTML = '<div class="hq3-trend-empty">Reach trend will appear once a few days of platform data are in.</div>'
      if (takeEl) takeEl.textContent = 'Watching this — once we have a week of data, I\u2019ll know if the algorithm is leaning in.'
      return
    }
    // Group by date, SUM reach7d across accounts (gives total combined reach)
    var byDate = {}
    snaps.forEach(function (s) {
      var d = (s.capturedAt || '').slice(0, 10)
      if (!d) return
      if (!byDate[d]) byDate[d] = 0
      byDate[d] += (s.reach7d || 0)
    })
    var dates = Object.keys(byDate).sort()
    var series = dates.slice(-30).map(function (d) { return { d: d, v: byDate[d] } })
    var stats = renderTrendChart(el, series, {
      empty: 'Reach trend needs a few more days of data.',
      format: function (v) { return v.toLocaleString() },
    })
    if (takeEl && stats) {
      var direction = stats.deltaPct > 5 ? 'climbing' : stats.deltaPct < -5 ? 'cooling off' : 'steady'
      var msg
      if (direction === 'climbing') {
        msg = 'Your reach is <em>' + direction + '</em> — the algorithm is pushing your posts to more people lately. Keep your cadence up; this is a window where consistent posting compounds.'
      } else if (direction === 'cooling off') {
        msg = 'Reach is <em>' + direction + '</em> over the last ' + stats.n + ' days. Likely a content-mix shift. The team will look at what changed — it\u2019s usually format or topic, not posting time.'
      } else {
        msg = 'Reach is <em>steady</em> at around <em>' + Math.round(stats.last).toLocaleString() + '</em>. Stable means the algorithm has you sized right; a hit or change in format is what moves this number.'
      }
      takeEl.innerHTML = msg
    }
  }

  // ───── render: engagement velocity ────────────────────────────────
  // 7-day rolling engagement rate trend from valid posts (excludes bad-
  // reach rows). Shows "is content quality improving?" — a per-post quality
  // signal independent of how many people see it.
  function renderEngagementVelocity (root, ts) {
    var el = root.querySelector('#hq3-eng-velocity')
    var takeEl = root.querySelector('#hq3-eng-take')
    if (!el) return
    var posts = (ts && ts.posts || []).filter(function (p) { return isValidEngPost(p) && p.publishedAt })
    if (posts.length < 4) {
      el.innerHTML = '<div class="hq3-trend-empty">Engagement velocity needs at least a few posts before the trend reads.</div>'
      if (takeEl) takeEl.textContent = 'I\u2019ll start tracking engagement quality once you have 4+ posts. Right now there\u2019s not enough to call a trend.'
      return
    }
    // Sort by publish date, compute 7-day rolling avg engagement rate
    posts.sort(function (a, b) { return new Date(a.publishedAt) - new Date(b.publishedAt) })
    var rolling = []
    for (var i = 0; i < posts.length; i++) {
      var window = []
      var anchorTs = new Date(posts[i].publishedAt).getTime()
      for (var j = 0; j <= i; j++) {
        if (anchorTs - new Date(posts[j].publishedAt).getTime() <= 7 * 86400000) {
          window.push(posts[j].engagementRate)
        }
      }
      if (window.length >= 1) {
        var avg = window.reduce(function (a, b) { return a + b }, 0) / window.length
        rolling.push({ d: posts[i].publishedAt.slice(0, 10), v: avg })
      }
    }
    if (rolling.length < 2) {
      el.innerHTML = '<div class="hq3-trend-empty">Posts are too spread out to form a 7-day window yet.</div>'
      if (takeEl) takeEl.textContent = 'Once your posts cluster within a week of each other, this trend will fill in.'
      return
    }
    var stats = renderTrendChart(el, rolling, {
      format: function (v) { return (v * 100).toFixed(1) + '%' },
    })
    if (takeEl && stats) {
      var deltaPts = (stats.last - stats.first) * 100
      var direction = deltaPts > 0.5 ? 'improving' : deltaPts < -0.5 ? 'slipping' : 'steady'
      var msg
      if (direction === 'improving') {
        msg = 'Your engagement is <em>improving</em> — recent posts are landing harder than older ones. <em>+' + deltaPts.toFixed(1) + ' points</em> across ' + stats.n + ' posts. Whatever you changed, keep going.'
      } else if (direction === 'slipping') {
        msg = 'Engagement is <em>slipping</em> — posts feel softer than they used to (<em>' + deltaPts.toFixed(1) + ' points</em> across ' + stats.n + ' posts). The team will look at format and hooks for the next batch.'
      } else {
        msg = 'Engagement is <em>steady</em> around <em>' + (stats.last * 100).toFixed(1) + '%</em>. A change of ±0.5 points either way would be the signal to dig in.'
      }
      takeEl.innerHTML = msg
    }
  }

  // ───── audience + content tiles below posts ───────────────────────
  // Three tiles in the right column, under the posts table:
  //   • Location  — top 5 countries from PlatformAudience.topCountries
  //   • Age       — buckets from PlatformAudience.ageBreakdown
  //   • Content mix — format breakdown from communityTags, ranked by
  //                   avg engagement (uses isValidEngPost filter)
  // All three reuse the existing .corr-row markup (already styled).
  function _emptyState (label) {
    return '<div style="font-family:Inter,sans-serif;font-size:11px;color:var(--t3);padding:8px 0">' + label + '</div>'
  }
  function _renderBars (rows) {
    if (rows.length === 0) return ''
    var maxAbs = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.value) }))
    if (maxAbs <= 0) maxAbs = 1
    return rows.map(function (r) {
      var width = (Math.abs(r.value) / maxAbs) * 50 // chart uses ~50% max
      var negCls = r.value < 0 ? 'neg' : ''
      return '<div class="corr-row">'
        + '<span class="name">' + escHtml(r.label) + '</span>'
        + '<span class="bar"><span class="axis"></span><span class="' + negCls + '" style="width:' + width.toFixed(1) + '%"></span></span>'
        + '<span class="v">' + escHtml(r.display) + '</span>'
        + '</div>'
    }).join('')
  }

  function _labelAudienceTile (tile, sourcePlatform) {
    if (!tile) return
    var meta = tile.querySelector('.tile-head .meta')
    if (!meta) return
    var current = meta.textContent || ''
    // If we already added the source prefix, skip — keeps re-renders idempotent
    if (current.toLowerCase().indexOf(sourcePlatform.toLowerCase()) === -1) {
      meta.textContent = sourcePlatform + ' \u00b7 ' + current
    }
  }

  function renderAudienceLocation (root, ts) {
    var el = root.querySelector('#hq3-audience-location')
    if (!el) return
    var aud = (ts.audiences || [])[0]
    var countries = aud && Array.isArray(aud.topCountries) ? aud.topCountries : []
    // Identify which platform this audience snapshot came from so the tile
    // header reads "Instagram · top 5 countries" instead of pretending the
    // data covers TikTok too. (TikTok's sandbox API returns no audience.)
    var apMap = ts.accountPlatforms || {}
    var sourcePlatform = aud ? (apMap[aud.accountId] || 'Source') : 'Source'
    var sourceLabel = platformLabel(sourcePlatform)
    var locationTile = el.closest('.tile')
    _labelAudienceTile(locationTile, sourceLabel)
    if (countries.length === 0) {
      el.innerHTML = _emptyState('No audience location data yet — Instagram returns this; TikTok sandbox does not.')
      return
    }
    // Strip the .corr class so this tile gets the donut layout, not the
    // bar-row layout. Idempotent on re-renders.
    el.classList.remove('corr')
    el.classList.add('hq3-loc-donut')
    var COUNTRY_NAME = {
      US: 'United States', BR: 'Brazil', GB: 'United Kingdom', CA: 'Canada',
      AU: 'Australia', MX: 'Mexico', IN: 'India', DE: 'Germany',
      FR: 'France', JP: 'Japan', NG: 'Nigeria', ID: 'Indonesia',
      PH: 'Philippines', TH: 'Thailand', VN: 'Vietnam', KR: 'South Korea',
      ES: 'Spain', IT: 'Italy', NL: 'Netherlands', SE: 'Sweden',
      PL: 'Poland', AR: 'Argentina', CL: 'Chile', CO: 'Colombia',
      EG: 'Egypt', ZA: 'South Africa', TR: 'Turkey', RU: 'Russia',
      SG: 'Singapore', MY: 'Malaysia', NZ: 'New Zealand', IE: 'Ireland',
    }
    var rows = countries.slice(0, 5).map(function (c) {
      return {
        label: COUNTRY_NAME[c.bucket] || c.bucket,
        value: c.share,
        display: (c.share * 100).toFixed(0) + '%',
      }
    })
    // Donut chart: 5 stacked arcs around a 100×100 SVG. Center caption
    // calls out the top country's share — one number creators latch onto.
    var palette = ['var(--accent)', 'var(--t1)', 'var(--t2)', 'var(--t3)', 'var(--hair)']
    var totalShare = rows.reduce(function (s, r) { return s + r.value }, 0)
    var R = 36, C = 50, STROKE = 14, CIRC = 2 * Math.PI * R
    var rotation = -90 // start at 12 o'clock
    var arcs = rows.map(function (r, i) {
      // Arcs sized by the post's share within shown rows (so they sum to a full ring even if "Other" is hidden)
      var portion = totalShare > 0 ? r.value / totalShare : 0
      var len = portion * CIRC
      var seg = '<circle cx="' + C + '" cy="' + C + '" r="' + R + '" fill="none"'
        + ' stroke="' + palette[i % palette.length] + '" stroke-width="' + STROKE + '"'
        + ' stroke-dasharray="' + len.toFixed(2) + ' ' + (CIRC - len).toFixed(2) + '"'
        + ' transform="rotate(' + rotation + ' ' + C + ' ' + C + ')"'
        + ' />'
      rotation += portion * 360
      return seg
    }).join('')
    var top = rows[0]
    var legend = rows.map(function (r, i) {
      return '<div class="hq3-loc-legend-row">'
        + '<span class="sw" style="background:' + palette[i % palette.length] + '"></span>'
        + '<span class="name">' + escHtml(r.label) + '</span>'
        + '<span class="v">' + r.display + '</span>'
        + '</div>'
    }).join('')
    el.innerHTML =
      '<div class="hq3-loc-chart">'
        + '<svg viewBox="0 0 100 100" class="hq3-loc-svg" aria-hidden="true">' + arcs + '</svg>'
        + '<div class="hq3-loc-center">'
          + '<div class="hq3-loc-pct">' + top.display + '</div>'
          + '<div class="hq3-loc-cap">' + escHtml(top.label) + '</div>'
        + '</div>'
      + '</div>'
      + '<div class="hq3-loc-legend">' + legend + '</div>'
  }

  function renderAudienceAge (root, ts) {
    var el = root.querySelector('#hq3-audience-age')
    if (!el) return
    var aud = (ts.audiences || [])[0]
    var ages = aud && Array.isArray(aud.ageBreakdown) ? aud.ageBreakdown : []
    var apMap = ts.accountPlatforms || {}
    var sourcePlatform = aud ? (apMap[aud.accountId] || 'Source') : 'Source'
    var sourceLabel = platformLabel(sourcePlatform)
    var ageTile = el.closest('.tile')
    _labelAudienceTile(ageTile, sourceLabel)
    if (ages.length === 0) {
      el.innerHTML = _emptyState('No audience age data yet — Instagram returns this; TikTok sandbox does not.')
      return
    }
    // Strip the .corr class so this tile gets the histogram layout
    el.classList.remove('corr')
    el.classList.add('hq3-age-hist')

    // Sort buckets in their natural order (13-17, 18-24, 25-34, ...)
    var ORDER = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+']
    var rows = ages.slice().sort(function (a, b) {
      return ORDER.indexOf(a.bucket) - ORDER.indexOf(b.bucket)
    }).map(function (a) {
      return { bucket: a.bucket, share: a.share }
    })
    // Vertical histogram — bars rise from a baseline. Width split evenly,
    // height proportional to share. The single highest bar gets accent color
    // so the dominant cohort pops; others stay neutral.
    var maxShare = Math.max.apply(null, rows.map(function (r) { return r.share }))
    var topBucket = rows.reduce(function (best, r) { return r.share > (best ? best.share : 0) ? r : best }, null)
    var bars = rows.map(function (r) {
      var heightPct = maxShare > 0 ? Math.max(2, (r.share / maxShare) * 100) : 0
      var pct = (r.share * 100).toFixed(0)
      var isTop = r === topBucket
      return '<div class="hq3-age-col' + (isTop ? ' top' : '') + '" title="' + r.bucket + ' \u00b7 ' + pct + '%">'
        + '<div class="hq3-age-pct">' + pct + '%</div>'
        + '<div class="hq3-age-bar" style="height:' + heightPct.toFixed(1) + '%"></div>'
        + '<div class="hq3-age-label">' + r.bucket + '</div>'
        + '</div>'
    }).join('')
    el.innerHTML = '<div class="hq3-age-track">' + bars + '</div>'
  }

  function renderContentMix (root, ts) {
    var el = root.querySelector('#hq3-content-mix')
    if (!el) return
    var posts = (ts.posts || []).filter(function (p) { return isValidEngPost(p) && p.communityTags && p.communityTags.format })
    if (posts.length < 3) {
      el.innerHTML = _emptyState('Need 3+ tagged posts before content-mix analysis.')
      return
    }
    var byFormat = {}
    posts.forEach(function (p) {
      var f = p.communityTags.format
      if (!byFormat[f]) byFormat[f] = []
      byFormat[f].push(p.engagementRate)
    })
    var rows = Object.keys(byFormat).map(function (f) {
      var arr = byFormat[f]
      var avg = arr.reduce(function (a, b) { return a + b }, 0) / arr.length
      return {
        label: f + ' \u00b7 ' + arr.length + ' post' + (arr.length === 1 ? '' : 's'),
        value: avg,
        display: (avg * 100).toFixed(1) + '%',
      }
    }).sort(function (a, b) { return b.value - a.value }).slice(0, 6)
    el.innerHTML = _renderBars(rows)
  }

  // ───── niche benchmarks ───────────────────────────────────────────
  // Hardcoded baselines keyed by (niche, platform). Pulled from public
  // industry data (Phlanx, Influencer Marketing Hub, RivalIQ 2024
  // benchmarks). Engagement rates as 0–1 fractions matching post.engagementRate
  // post-normalization. Used for niche-context overlays on KPI cards.
  // The baseline is a *median* — a reasonable creator should hit it, top
  // creators 2–3× it. Showing this turns "12.4% engagement" from "is that
  // good?" into "12.4% — 4.5× the lifestyle median."
  var NICHE_BENCHMARKS = {
    fitness:   { engRate: { instagram: 0.018, tiktok: 0.090 }, watchTimeSec: { instagram: 9.0, tiktok: 12.0 } },
    finance:   { engRate: { instagram: 0.024, tiktok: 0.070 }, watchTimeSec: { instagram: 8.0, tiktok: 11.0 } },
    food:      { engRate: { instagram: 0.020, tiktok: 0.085 }, watchTimeSec: { instagram: 8.5, tiktok: 11.5 } },
    coaching:  { engRate: { instagram: 0.022, tiktok: 0.080 }, watchTimeSec: { instagram: 8.0, tiktok: 11.0 } },
    lifestyle: { engRate: { instagram: 0.016, tiktok: 0.075 }, watchTimeSec: { instagram: 8.0, tiktok: 10.5 } },
    fashion:   { engRate: { instagram: 0.014, tiktok: 0.070 }, watchTimeSec: { instagram: 7.5, tiktok: 10.0 } },
    travel:    { engRate: { instagram: 0.022, tiktok: 0.080 }, watchTimeSec: { instagram: 8.5, tiktok: 11.0 } },
    business:  { engRate: { instagram: 0.020, tiktok: 0.060 }, watchTimeSec: { instagram: 7.5, tiktok: 10.0 } },
    // Generic fallback when niche is unknown
    _default:  { engRate: { instagram: 0.018, tiktok: 0.080 }, watchTimeSec: { instagram: 8.0, tiktok: 11.0 } },
  }

  function getBenchmark (niche, metric, platform) {
    var key = (niche || '').toLowerCase()
    var bm = NICHE_BENCHMARKS[key] || NICHE_BENCHMARKS._default
    var byPlatform = bm[metric] || {}
    if (currentPlatform !== 'all' && byPlatform[currentPlatform]) {
      return byPlatform[currentPlatform]
    }
    if (platform && byPlatform[platform]) return byPlatform[platform]
    // Fall back to weighted blend across IG + TikTok
    var ig = byPlatform.instagram, tt = byPlatform.tiktok
    if (ig != null && tt != null) return (ig + tt) / 2
    return ig != null ? ig : tt != null ? tt : null
  }

  function getCompanyNiche (state) {
    var company = state && state.me && state.me.companies && state.me.companies[0]
    return (company && (company.niche || company.subNiche)) || null
  }

  // ───── render: content calendar tile ──────────────────────────────
  // Wires to POSTS (not tasks) — publishing cadence is what creators
  // actually care about. Shows three things:
  //   1. Status headline — last-post age, weekly count, or quiet alert
  //   2. 14-day cadence bar — small horizontal strip, post counts per day
  //      with platform-color hints (IG = ig, TikTok = tt)
  //   3. Deep-link to team-tab calendar for the full month view
  //
  // Honest by design: a long stretch with no posts is shown plainly, not
  // dressed up. That's the kind of mirror creators tune into.
  function renderCalendarTile (root, d, ts) {
    var bodyEl = root.querySelector('#hq3-cal-body')
    if (!bodyEl) return

    var posts = (ts && ts.posts) || []
    if (posts.length === 0) {
      bodyEl.innerHTML = '<div class="empty">No published posts yet. Once your team ships, this fills in.</div>'
      return
    }

    // Group posts by yyyy-mm-dd, segmented by platform for the bar fill
    var apMap = (ts && ts.accountPlatforms) || {}
    var byDate = {}
    posts.forEach(function (p) {
      if (!p.publishedAt) return
      var dt = new Date(p.publishedAt)
      if (isNaN(dt)) return
      var key = dt.toISOString().slice(0, 10)
      if (!byDate[key]) byDate[key] = { total: 0 }
      var platform = apMap[p.accountId]
      var bucket = platformClass(platform) || 'ig'
      byDate[key][bucket] = (byDate[key][bucket] || 0) + 1
      byDate[key].total++
    })

    // Most recent post for the headline status
    var sortedPosts = posts.slice()
      .filter(function (p) { return p.publishedAt })
      .sort(function (a, b) { return new Date(b.publishedAt) - new Date(a.publishedAt) })
    var lastPost = sortedPosts[0]
    var lastAgeMs = lastPost ? Date.now() - new Date(lastPost.publishedAt).getTime() : null

    // Counts for the headline
    var todayMid = new Date(); todayMid.setHours(0, 0, 0, 0)
    var sevenDaysAgo = todayMid.getTime() - 7 * 86400000
    var prevSevenAgo = todayMid.getTime() - 14 * 86400000
    var thisWeekCount = 0, prevWeekCount = 0
    posts.forEach(function (p) {
      if (!p.publishedAt) return
      var t = new Date(p.publishedAt).getTime()
      if (t >= sevenDaysAgo) thisWeekCount++
      else if (t >= prevSevenAgo) prevWeekCount++
    })

    // Status headline — adaptive to real activity
    var headline = ''
    if (thisWeekCount > 0) {
      var weekDelta = prevWeekCount > 0
        ? ' (' + (thisWeekCount > prevWeekCount ? '▲ ' : thisWeekCount < prevWeekCount ? '▼ ' : '— ') + Math.abs(thisWeekCount - prevWeekCount) + ' vs last week)'
        : ''
      var lastAge = (function (ms) {
        var hrs = Math.floor(ms / 3600000)
        if (hrs < 1) return 'just now'
        if (hrs < 24) return hrs + 'h ago'
        return Math.floor(hrs / 24) + 'd ago'
      })(lastAgeMs)
      headline = '<div class="status"><strong>' + thisWeekCount + ' post' + (thisWeekCount === 1 ? '' : 's') + ' this week</strong>' + weekDelta + '. Last: <em>' + lastAge + '</em>.</div>'
    } else if (lastAgeMs != null && lastAgeMs < 30 * 86400000) {
      var d2 = Math.floor(lastAgeMs / 86400000)
      headline = '<div class="status">Quiet week. Last post <em>' + d2 + ' day' + (d2 === 1 ? '' : 's') + ' ago</em>.</div>'
    } else if (lastAgeMs != null) {
      var d3 = Math.floor(lastAgeMs / 86400000)
      headline = '<div class="status warn">Last post <em>' + d3 + ' days ago</em>. Brief the team to start producing again.</div>'
    } else {
      headline = '<div class="status">No published posts yet.</div>'
    }

    // 7-day cadence bar — most recent on the right. Segments per platform
    // are stacked, sorted by registry order so the visual is stable.
    var bars = []
    var dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
    var connectedThisWindow = (ts && ts.accounts) ? connectedPlatforms(ts.accounts) : []
    connectedThisWindow.sort(function (a, b) { return platformInfo(a).sort - platformInfo(b).sort })
    var maxCount = 1
    for (var i = 6; i >= 0; i--) {
      var dayDate = new Date(todayMid.getTime() - i * 86400000)
      var key = dayDate.toISOString().slice(0, 10)
      var entry = byDate[key] || { total: 0 }
      if (entry.total > maxCount) maxCount = entry.total
    }
    for (var j = 6; j >= 0; j--) {
      var dayDate2 = new Date(todayMid.getTime() - j * 86400000)
      var key2 = dayDate2.toISOString().slice(0, 10)
      var entry2 = byDate[key2] || { total: 0 }
      var heightPct = entry2.total === 0 ? 0 : Math.max(15, (entry2.total / maxCount) * 100)
      var isToday = j === 0
      var dow = dayDate2.getDay()
      // Build per-platform segments from connected platforms only — adding
      // a new platform integration just shows up here automatically.
      var segs = ''
      connectedThisWindow.forEach(function (pkey) {
        var bucket = platformClass(pkey)
        var count = entry2[bucket] || 0
        if (count <= 0) return
        var segH = (count / Math.max(entry2.total, 1)) * heightPct
        segs += '<div class="hq3-cad-seg ' + bucket + '" style="height:' + segH.toFixed(1) + '%"></div>'
      })
      bars.push('<div class="hq3-cad-day' + (isToday ? ' today' : '') + (entry2.total === 0 ? ' empty' : '') + '" title="' + key2 + ' · ' + entry2.total + ' post' + (entry2.total === 1 ? '' : 's') + '">'
        + '<div class="hq3-cad-stack">' + segs + '</div>'
        + '<div class="hq3-cad-day-label">' + dayLabels[dow] + '</div>'
        + '</div>')
    }

    // Legend — one entry per connected platform from the registry
    var legend = connectedThisWindow.map(function (pkey) {
      return '<span class="leg"><span class="sw ' + platformClass(pkey) + '"></span>' + escHtml(platformLabel(pkey)) + '</span>'
    }).join('')

    bodyEl.innerHTML = headline
      + '<div class="hq3-cadence">' + bars.join('') + '</div>'
      + '<div class="hq3-cad-legend">' + legend + '<span class="leg meta">past 7 days</span></div>'
  }

  // ───── render: anomaly callouts ───────────────────────────────────
  // Z-score each post's engagement vs the rolling baseline (mean + stdev
  // across the last 90 days of valid posts). Surface up to 3 anomalies:
  //   • >= +1.5σ → "popping" (positive lift, accent color)
  //   • <= -1.5σ → "underperforming" (down color)
  // Posts older than 30 days are not surfaced (stale).
  // This is Maya's actual job: pattern detection on fresh data.
  function renderAnomalies (root, ts) {
    var listEl = root.querySelector('#hq3-anomaly-list')
    if (!listEl) return
    var posts = (ts.posts || []).filter(function (p) {
      return isValidEngPost(p) && p.publishedAt
    })
    if (posts.length < 5) {
      listEl.innerHTML = '<div class="hq3-anomaly"><div class="empty">Once you have a few more posts, Maya will start flagging the ones that pop.</div></div>'
      return
    }
    // Compute typical engagement + spread (used to decide what counts as a
    // standout — internal math; never shown as "stdev" or "z-score").
    var rates = posts.map(function (p) { return p.engagementRate })
    var mean = rates.reduce(function (a, b) { return a + b }, 0) / rates.length
    var variance = rates.reduce(function (a, b) { return a + (b - mean) * (b - mean) }, 0) / rates.length
    var stdev = Math.sqrt(variance)
    if (stdev <= 0) {
      listEl.innerHTML = '<div class="hq3-anomaly"><div class="empty">Your engagement is steady across posts — nothing standing out yet.</div></div>'
      return
    }
    // Score each post; only surface posts published in the last 30 days
    var freshCutoff = Date.now() - 30 * 86400000
    var scored = posts.map(function (p) {
      return {
        post: p,
        z: (p.engagementRate - mean) / stdev,
        pubTs: Date.parse(p.publishedAt),
      }
    }).filter(function (s) { return s.pubTs >= freshCutoff && Math.abs(s.z) >= 1.5 })

    // Helpers for plain-English magnitude phrasing
    function magnitudePhrase (multiplier, isPositive) {
      if (isPositive) return multiplier.toFixed(1) + '× your usual engagement'
      return Math.round((1 - multiplier) * 100) + '% below your usual'
    }

    if (scored.length === 0) {
      // Fallback: even with nothing fresh, surface the all-time top so the
      // tile feels alive instead of dead.
      var sortedAll = posts.slice().sort(function (a, b) { return b.engagementRate - a.engagementRate })
      var topPost = sortedAll[0]
      var topMult = topPost.engagementRate / mean
      var ago = (function (t) {
        var d = Math.floor((Date.now() - Date.parse(t)) / 86400000)
        return d < 30 ? d + 'd ago' : Math.floor(d / 30) + 'mo ago'
      })(topPost.publishedAt)
      var caption = (topPost.caption || '(no caption)').slice(0, 80)
      listEl.innerHTML = '<div class="hq3-anomaly">'
        + '<div class="meta">YOUR BIGGEST HIT \u00b7 ' + ago.toUpperCase() + '</div>'
        + '<div class="magnitude">' + magnitudePhrase(topMult, true) + '</div>'
        + '<div class="body">' + escHtml(caption) + (caption.length === 80 ? '\u2026' : '') + '</div>'
        + '<div class="meta">' + (topPost.likeCount || 0) + ' likes \u00b7 ' + (topPost.viewCount || topPost.reachCount || 0).toLocaleString() + ' views</div>'
        + '</div>'
        + '<div class="hq3-anomaly"><div class="empty">Nothing\u2019s stood out from the last 30 days. Maya\u2019s watching.</div></div>'
      return
    }

    // Sort by absolute magnitude, take top 3
    scored.sort(function (a, b) { return Math.abs(b.z) - Math.abs(a.z) })
    listEl.innerHTML = scored.slice(0, 3).map(function (s) {
      var p = s.post
      var multiplier = p.engagementRate / mean
      var positive = s.z > 0
      var ago = (function (t) {
        var diff = Date.now() - Date.parse(t)
        var hrs = Math.floor(diff / 3600000)
        if (hrs < 24) return hrs + 'h ago'
        return Math.floor(hrs / 24) + 'd ago'
      })(p.publishedAt)
      var caption = (p.caption || '(no caption)').slice(0, 80)
      var formatLabel = (p.communityTags && p.communityTags.format) || (p.mediaType || 'post').toLowerCase()
      var pfMap = ts.accountPlatforms || {}
      var platform = pfMap[p.accountId] || 'instagram'
      var pfName = platformLabel(platform)
      var magClass = positive ? '' : ' dn'
      return '<div class="hq3-anomaly">'
        + '<div class="meta">' + pfName.toUpperCase() + ' \u00b7 ' + formatLabel.toUpperCase() + ' \u00b7 ' + ago.toUpperCase() + '</div>'
        + '<div class="magnitude' + magClass + '">' + magnitudePhrase(multiplier, positive) + '</div>'
        + '<div class="body">' + escHtml(caption) + (caption.length === 80 ? '\u2026' : '') + '</div>'
        + '<div class="meta">' + (p.likeCount || 0) + ' likes \u00b7 ' + (p.viewCount || p.reachCount || 0).toLocaleString() + ' views</div>'
        + '</div>'
    }).join('')
  }

  // ───── Maya's playbook bullets ────────────────────────────────────
  // The /api/platform/maya-playbook endpoint returns a single Bedrock-
  // generated narrative. We split it into sentences and render each as a
  // bullet to match the existing markup (.playbook ul > li).
  function renderPlaybook (root) {
    var playbookEl = root.querySelector('.playbook ul')
    if (!playbookEl) return
    var emptyState = '<li>Maya is reviewing your account. Her first daily playbook lands within 24 hours of your first sync.</li>'
    return get('/api/platform/maya-playbook').then(function (pb) {
      if (!pb || !pb.message) {
        playbookEl.innerHTML = emptyState
        return
      }
      var sentences = pb.message
        .split(/(?<=[.!?])\s+/)
        .map(function (s) { return s.trim() })
        .filter(function (s) { return s.length > 5 })
        .slice(0, 4)
      if (sentences.length === 0) {
        playbookEl.innerHTML = emptyState
        return
      }
      playbookEl.innerHTML = sentences.map(function (s) {
        return '<li>' + escHtml(s) + '</li>'
      }).join('')
    }).catch(function () {
      playbookEl.innerHTML = emptyState
    })
  }

  // ───── orchestrate ────────────────────────────────────────────────
  function render () {
    var root = hqRoot()
    if (!root) return
    var state = window.__vxDashState
    if (!state) return
    resetTsCache()
    var d = deriveHQData(state)
    try { renderEyebrowDate(root) } catch (e) { console.error('[hq-v3] eyebrow date', e) }
    try { renderCockpit(root, d) } catch (e) { console.error('[hq-v3] cockpit', e) }
    try { renderHeroGreeting(root, d) } catch (e) { console.error('[hq-v3] hero greeting', e) }
    try { renderForecastHead(root, d) } catch (e) { console.error('[hq-v3] forecast head', e) }
    try { renderMiniStats(root, d) } catch (e) { console.error('[hq-v3] mini stats', e) }
    try { renderForecastChart(root, d) } catch (e) { console.error('[hq-v3] forecast chart', e) }
    try { renderForecastLegend(root, d) } catch (e) { console.error('[hq-v3] forecast legend', e) }
    try { renderGoal(root) } catch (e) { console.error('[hq-v3] goal', e) }
    try { wireGoalForm(root) } catch (e) { console.error('[hq-v3] goal form', e) }
    try { renderPipelineNodes(root, d) } catch (e) { console.error('[hq-v3] pipeline nodes', e) }
    try { enhancePipelineNodes(root, state) } catch (e) { console.error('[hq-v3] pipeline enhancer', e) }
    try { wireForecastTabs(root, d) } catch (e) { console.error('[hq-v3] forecast tabs', e) }

    // Phase 2 — async, all share the coalesced /timeseries fetch.
    // Posts/snapshots are scoped to the active platform; audience tiles and
    // forecast legend stay tied to the raw response (already source-labeled).
    getTimeseries().then(function (ts) {
      try { setHqMetricsDataNotice(root, !ts) } catch (e) { console.error('[hq-v3] metrics notice', e) }
      if (!ts) return
      var tsScoped = scopeTimeseriesToPlatform(ts)
      try { renderReach7dFromSnapshots(root, tsScoped) } catch (e) { console.error('[hq-v3] reach7d', e) }
      try { renderAudienceSignals(root, tsScoped) } catch (e) { console.error('[hq-v3] audience signals', e) }
      try { renderHeatmap(root, tsScoped) } catch (e) { console.error('[hq-v3] heatmap', e) }
      try { renderCorrelation(root, tsScoped) } catch (e) { console.error('[hq-v3] correlation', e) }
      try { renderPostsTable(root, tsScoped) } catch (e) { console.error('[hq-v3] posts table', e) }
      try { renderAudienceLocation(root, ts) } catch (e) { console.error('[hq-v3] audience location', e) }
      try { renderAudienceAge(root, ts) } catch (e) { console.error('[hq-v3] audience age', e) }
      try { renderContentMix(root, tsScoped) } catch (e) { console.error('[hq-v3] content mix', e) }
      try { renderAnomalies(root, tsScoped) } catch (e) { console.error('[hq-v3] anomalies', e) }
      try { renderReachTrend(root, tsScoped) } catch (e) { console.error('[hq-v3] reach trend', e) }
      try { renderEngagementVelocity(root, tsScoped) } catch (e) { console.error('[hq-v3] eng velocity', e) }
      try { renderCalendarTile(root, d, tsScoped) } catch (e) { console.error('[hq-v3] calendar tile', e) }
      try { wirePlatformToggle(root) } catch (e) { console.error('[hq-v3] platform toggle', e) }
      try { wirePostsFilterChips(root) } catch (e) { console.error('[hq-v3] posts filter chips', e) }
    })
    try { renderPlaybook(root) } catch (e) { console.error('[hq-v3] playbook', e) }
  }

  // dashboard-v2.js fires `vx-dash-ready` twice — once with me/tasks, once
  // after the platform overview lands. Render on both so the forecast head
  // updates as soon as the heavier data arrives.
  window.addEventListener('vx-dash-ready', render)
  // Initial state may already be present if this script loads after the
  // first event has fired (cache, fast nav, etc.).
  if (window.__vxDashState) render()
  // Re-render when the user navigates back to the dashboard view.
  // ALSO mark "seen" when navigating AWAY — that's how lastSeen advances.
  // First arrival on db-dashboard reads the prior lastSeen; leaving updates
  // it; the next return computes net-new against the new timestamp.
  document.addEventListener('vx-view-change', function (e) {
    if (!e || !e.detail) return
    if (e.detail.id === 'db-dashboard') {
      render()
    } else if (e.detail.previousId === 'db-dashboard' || e.detail.from === 'db-dashboard') {
      // Some dispatchers carry previous; if not we still cover the case
      // below via beforeunload + visibilitychange.
      markHqSeen()
    }
  })

  // Catch-alls for cases where the view-change event doesn't include
  // previous-view detail: tab close, tab background, page hide.
  window.addEventListener('beforeunload', markHqSeen)
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      // Only mark seen if HQ was actually the active view when hidden
      var view = document.getElementById('view-db-dashboard')
      if (view && view.classList.contains('hq-v3') && getComputedStyle(view).display !== 'none') {
        markHqSeen()
      }
    }
  })
})()
