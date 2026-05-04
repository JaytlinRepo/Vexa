/* Sovexa — Team Status Bar
 *
 * Thin status strip at the top of HQ. Polls /api/team/status every 30s and
 * renders one row per employee (Maya / Jordan / Riley). Pauses polling
 * when the tab is hidden so we don't burn API quota for a screen no one
 * is looking at. Identity comes from name typography + zone + status dot
 * — no avatars, no illustrations.
 */
;(function () {
  var POLL_MS = 30_000
  var ENDPOINT = '/api/team/status'
  var CONTAINER_ID = 'vx-team-status-bar'
  var pollHandle = null
  var lastPayloadHash = ''

  function ensureContainer() {
    var existing = document.getElementById(CONTAINER_ID)
    if (existing) return existing

    // Anchor: top of the HQ dashboard view, immediately inside its scroll
    // wrapper so the bar sits above all tile content. Falls through gracefully
    // if HQ markup isn't on the page (logged-out / non-HQ routes).
    var hqView = document.getElementById('view-db-dashboard')
    if (!hqView) return null

    var bar = document.createElement('div')
    bar.id = CONTAINER_ID
    bar.className = 'vx-team-bar'
    // Insert as the very first child so it spans full width above existing zones.
    hqView.insertBefore(bar, hqView.firstChild)
    return bar
  }

  function rowMarkup(emp) {
    var dotClass = emp.status === 'working' ? 'is-working'
                 : emp.status === 'done'    ? 'is-done'
                 : 'is-idle'
    var rowClass = emp.status === 'waiting_on_you' ? ' is-waiting' : ''
    // The name + role pair is the identity carrier. Color is set on the
    // row via [data-employee] in CSS. No template fallbacks — message
    // comes straight from the backend.
    return '<div class="vx-team-bar__row' + rowClass + '" data-employee="' + emp.id + '" data-cta-href="' + (emp.cta && emp.cta.href || '') + '">'
      +    '<span class="vx-status-dot ' + dotClass + '"></span>'
      +    '<span class="vx-employee-name">' + emp.name + '</span>'
      +    '<span class="vx-tile__separator">·</span>'
      +    '<span class="vx-team-bar__status">' + escapeHtml(emp.message) + '</span>'
      +  '</div>'
  }

  // Map a CTA href into a real action. Three forms:
  //   1. "#hq:<key>"      → ensure HQ is the active view, then scroll the
  //                         matching tile/section into view + briefly flash
  //                         a highlight ring. This is the "take me to the
  //                         actual playbook / plan" path.
  //   2. "#<view-id>"     → window.navigate(view-id) — top-level routing.
  //   3. anything else    → window.location.assign(href).
  // Without explicit href + emp present, falls back to the employee drawer.
  var HQ_DEEP_LINKS = {
    playbook:    '.playbook',
    'weekly-plan':'.tile.weekly-plan, .tile [class*="weekly-plan"], .tile.plan, .tile [data-tile="plan"]',
  }
  function flashHighlight(el) {
    if (!el) return
    var prev = el.style.boxShadow
    var prevTransition = el.style.transition
    el.style.transition = 'box-shadow .25s ease'
    el.style.boxShadow = '0 0 0 2px var(--accent), 0 8px 24px var(--sh)'
    setTimeout(function () {
      el.style.boxShadow = prev || ''
      setTimeout(function () { el.style.transition = prevTransition || '' }, 260)
    }, 1600)
  }
  function findHqDeepLinkTarget(key) {
    var sel = HQ_DEEP_LINKS[key]
    if (!sel) return null
    var hq = document.getElementById('view-db-dashboard')
    if (!hq) return null
    // Try each comma-separated selector; first hit wins. Walks up to the
    // nearest .tile so we highlight the whole card, not the inner element.
    var parts = sel.split(',').map(function (s) { return s.trim() })
    for (var i = 0; i < parts.length; i++) {
      var hit = hq.querySelector(parts[i])
      if (hit) return hit.closest('.tile') || hit
    }
    return null
  }
  function followCtaHref(href, emp) {
    if (!href) {
      if (typeof window.openHQPipelineDrawer === 'function' && emp) {
        try { window.openHQPipelineDrawer(emp) } catch (_) {}
      }
      return
    }
    // HQ deep link
    if (href.indexOf('#hq:') === 0) {
      var key = href.slice(4)
      var goToHq = function () {
        var target = findHqDeepLinkTarget(key)
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' })
          flashHighlight(target)
        } else if (emp && typeof window.openHQPipelineDrawer === 'function') {
          // Fallback: target tile not in DOM yet (or never was). Open the
          // employee drawer instead so the click isn't a no-op.
          try { window.openHQPipelineDrawer(emp) } catch (_) {}
        }
      }
      // Make sure HQ is the active view first; navigate is a no-op if it
      // already is. Use a small delay so the view has time to mount.
      if (typeof window.navigate === 'function') window.navigate('db-dashboard')
      setTimeout(goToHq, 80)
      return
    }
    // Top-level navigate
    if (href.charAt(0) === '#' && typeof window.navigate === 'function') {
      window.navigate(href.slice(1))
      return
    }
    window.location.assign(href)
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    })
  }

  function render(data) {
    var bar = ensureContainer()
    if (!bar || !data || !Array.isArray(data.employees)) return
    var hash = JSON.stringify(data.employees)
    if (hash === lastPayloadHash) return // nothing changed; skip DOM thrash
    lastPayloadHash = hash
    bar.innerHTML = data.employees.map(rowMarkup).join('')

    // Wire row clicks: deep-link to whichever surface the agent owns.
    Array.prototype.forEach.call(bar.querySelectorAll('.vx-team-bar__row'), function (row) {
      row.addEventListener('click', function () {
        var href = row.getAttribute('data-cta-href')
        var emp = row.getAttribute('data-employee')
        followCtaHref(href, emp)
      })
    })
  }

  async function tick() {
    if (document.visibilityState === 'hidden') return // skip while tab is buried
    try {
      var res = await fetch(ENDPOINT, { credentials: 'include' })
      if (!res.ok) return // 401 on logged-out, etc — bar simply doesn't render
      var data = await res.json()
      render(data)
    } catch (_) { /* transient network blip; next tick will retry */ }
  }

  // ── Tile attribution (retrofit, non-destructive) ──────────────────
  // The HQ tiles were authored before the team identity layer existed.
  // Rather than edit every static block, we tag the tiles that belong to
  // each employee on dashboard mount: add the .vx-tile--signed class + a
  // data-employee attribute so the 2px left border + accent color apply
  // automatically. Body content is left alone.
  function decorateTiles() {
    var hq = document.getElementById('view-db-dashboard')
    if (!hq) return

    // Maya owns any tile that already shows her takeaway block. That's a
    // strong, content-driven signal — no fragile selector chains.
    Array.prototype.forEach.call(hq.querySelectorAll('.tile'), function (tile) {
      if (tile.dataset.vxSigned) return
      var hasMaya = tile.querySelector('.hq3-maya-take')
      if (!hasMaya) return
      tile.classList.add('vx-tile--signed')
      tile.setAttribute('data-employee', 'maya')
      tile.dataset.vxSigned = '1'
    })

    // Jordan tile heuristic: contains a content-plan / posting-plan label.
    // Looser than Maya's signal but acceptable — we only set it when we
    // find an exact match, otherwise we leave the tile alone.
    Array.prototype.forEach.call(hq.querySelectorAll('.tile'), function (tile) {
      if (tile.dataset.vxSigned) return
      var heading = tile.querySelector('.tile-head h3')
      if (!heading) return
      var t = (heading.textContent || '').toLowerCase()
      if (/plan|schedule|cadence|posting/.test(t)) {
        tile.classList.add('vx-tile--signed')
        tile.setAttribute('data-employee', 'jordan')
        tile.dataset.vxSigned = '1'
      }
    })
  }

  // ── Riley bridge strip ────────────────────────────────────────────
  // Sits at the bottom of HQ as a single-line link into Studio. Renders
  // only when there's actually something for the user to do — empty
  // case stays hidden so we don't manufacture noise.
  function renderRileyBridge(rileyEmp) {
    var hq = document.getElementById('view-db-dashboard')
    if (!hq) return
    var existing = document.getElementById('vx-riley-bridge')

    if (!rileyEmp || (rileyEmp.status !== 'waiting_on_you' && rileyEmp.status !== 'done')) {
      if (existing) existing.remove()
      return
    }

    if (!existing) {
      existing = document.createElement('div')
      existing.id = 'vx-riley-bridge'
      existing.className = 'vx-riley-bridge'
      existing.setAttribute('data-employee', 'riley')
      hq.appendChild(existing)
    }
    var label = rileyEmp.cta && rileyEmp.cta.label || 'open studio'
    existing.innerHTML =
        '<span class="vx-employee-name" style="color:var(--vx-riley)">RILEY</span>'
      + '<span class="vx-tile__separator">·</span>'
      + '<span class="vx-riley-bridge__msg">' + escapeHtml(rileyEmp.message) + '</span>'
      + '<span class="vx-employee-name" style="color:var(--vx-riley)">' + escapeHtml(label) + '</span>'
      + '<span class="vx-riley-bridge__arrow">→</span>'
    existing.onclick = function () {
      followCtaHref(rileyEmp.cta && rileyEmp.cta.href, 'riley')
    }
  }

  // Hook render() to also drive the Riley bridge. We re-wrap the existing
  // render so the polling loop only needs to call one entry point.
  var _baseRender = render
  render = function (data) {
    _baseRender(data)
    if (data && Array.isArray(data.employees)) {
      var riley = data.employees.find(function (e) { return e.id === 'riley' })
      renderRileyBridge(riley)
    }
  }

  function start() {
    if (pollHandle) return
    decorateTiles()
    void tick()
    pollHandle = setInterval(tick, POLL_MS)
  }
  function stop() {
    if (pollHandle) { clearInterval(pollHandle); pollHandle = null }
  }

  // Pause when the tab is hidden; resume + immediately refresh on return.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') { void tick() }
  })

  // Hook the existing dashboard mount points so the bar appears the moment
  // HQ is on screen. Both enterDashboard and the navigate('db-dashboard')
  // path are common entry points — wrap each.
  var prevEnter = window.enterDashboard
  window.enterDashboard = async function () {
    if (typeof prevEnter === 'function') await prevEnter()
    setTimeout(start, 200)
  }
  var prevNavigate = window.navigate
  if (typeof prevNavigate === 'function') {
    window.navigate = function (id) {
      var r = prevNavigate(id)
      if (id === 'db-dashboard') setTimeout(start, 100)
      return r
    }
  }

  // Cleanup on full-page unload (best-effort).
  window.addEventListener('beforeunload', stop)

  // ── Notification primitive ───────────────────────────────────────
  // Speak-as-employee toasts per the design brief. The existing codebase
  // referenced window.showNotification in a few places without defining
  // it (silent no-op). Provide a real implementation that uses the same
  // .vx-notif markup as the brief's spec, so all toasts go through the
  // identity layer and stay consistent.
  function ensureToastStack() {
    var stack = document.getElementById('vx-notif-stack')
    if (stack) return stack
    stack = document.createElement('div')
    stack.id = 'vx-notif-stack'
    stack.style.cssText = 'position:fixed;top:18px;right:18px;z-index:9990;display:flex;flex-direction:column;gap:10px;pointer-events:none;'
    document.body.appendChild(stack)
    return stack
  }

  function pushNotif(opts) {
    // opts: { employee?: 'maya'|'jordan'|'riley', body: string, kind?: 'info'|'action'|'error', durationMs?: number }
    var stack = ensureToastStack()
    var emp = opts && opts.employee
    var body = (opts && opts.body) || ''
    var kind = (opts && opts.kind) || 'info'
    var durationMs = (opts && opts.durationMs) || (kind === 'action' ? 8000 : 4000)

    var el = document.createElement('div')
    el.className = 'vx-notif'
    if (emp) el.setAttribute('data-employee', emp)
    el.style.pointerEvents = 'auto'
    el.style.transform = 'translateX(420px)'
    el.style.opacity = '0'
    el.style.transition = 'transform .3s ease, opacity .3s ease'

    var fromMarkup = ''
    if (emp) {
      var label = emp.toUpperCase()
      fromMarkup =
          '<span class="vx-notif__from">'
        +   '<span class="vx-status-dot is-working" style="color:var(--vx-' + emp + ')"></span>'
        +   '<span class="vx-employee-name" style="color:var(--vx-' + emp + ')">' + label + '</span>'
        + '</span>'
    }
    el.innerHTML = fromMarkup + '<p class="vx-notif__body">' + escapeHtml(body) + '</p>'

    stack.appendChild(el)
    requestAnimationFrame(function () {
      el.style.transform = 'translateX(0)'
      el.style.opacity = '1'
    })
    setTimeout(function () {
      el.style.transform = 'translateX(420px)'
      el.style.opacity = '0'
      setTimeout(function () { try { el.remove() } catch (_) {} }, 320)
    }, durationMs)
  }

  // Public — speak-as-employee. Use this for any new attribution-bearing toast.
  window.showEmployeeNotif = pushNotif

  // Legacy shim. The old window.showNotification(message, type) calls used
  // to be silent no-ops; route them through the new primitive so they at
  // least render as a generic system toast (no employee attribution).
  if (typeof window.showNotification !== 'function') {
    window.showNotification = function (message, type) {
      pushNotif({ body: String(message || ''), kind: type === 'error' ? 'error' : 'info' })
    }
  }
})()
