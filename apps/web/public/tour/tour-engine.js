// Sovexa onboarding tour — automatic cinematic spotlight
// Panels are appended directly to body (no wrapper overlay that blocks content)

;(function () {
  var STEPS = window.VEXA_TOUR_STEPS
  if (!STEPS) return

  var ACCENT = '#d4a574'
  var step = 0
  var els = []  // all tour elements we've added to body
  var autoTimer = null
  // Tour pacing — tightened 2026-05-11 from 5000/4000/6000 to feel
  // cinematic-but-brisk. Each numbered step gets 3s, welcome and finale
  // get a slightly longer beat so the title can land before transition.
  var STEP_MS = 3000
  var WELCOME_MS = 3000
  var FINAL_MS = 4000

  // Inject styles once
  if (!document.querySelector('#vx-tour-style')) {
    var s = document.createElement('style')
    s.id = 'vx-tour-style'
    s.textContent = [
      '@keyframes vx-tip-in { 0%{opacity:0;transform:translateY(14px) scale(.96);filter:blur(6px)} 100%{opacity:1;transform:translateY(0) scale(1);filter:blur(0)} }',
      '@keyframes vx-glow { 0%,100%{box-shadow:0 0 0 1.5px '+ACCENT+',0 0 24px '+ACCENT+'44} 50%{box-shadow:0 0 0 2px '+ACCENT+',0 0 48px '+ACCENT+'77} }',
      '@keyframes vx-progress { 0%{width:0} 100%{width:100%} }',
      '@keyframes vx-char { 0%{opacity:0;transform:translateY(10px);filter:blur(4px)} 100%{opacity:1;transform:translateY(0);filter:blur(0)} }',
      '@keyframes vx-fade { 0%{opacity:0;transform:translateY(6px)} 100%{opacity:1;transform:translateY(0)} }',
      '.vx-tp{position:fixed;background:rgba(0,0,0,.8);z-index:10000;transition:all .5s cubic-bezier(.83,0,.17,1)}',
    ].join('\n')
    document.head.appendChild(s)
  }

  function esc(s) { return String(s||'').replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]}) }

  // Remove all tour elements from DOM
  function cleanup() {
    els.forEach(function(e) { try { e.remove() } catch(x){} })
    els = []
  }

  // Tag the DOM elements each tour step wants to spotlight. Run after
  // navigate() because the target view needs to be `.active` (and visible)
  // before getBoundingClientRect can return useful geometry. Targets match
  // the IA we ship today (2026-05-11).
  function tagTargets() {
    // HQ — forecast chart (the hero section with the projection line).
    var hqForecast = document.querySelector('#view-db-dashboard .hq3-hero')
      || document.querySelector('#hq3-fc-chart')
    if (hqForecast) hqForecast.setAttribute('data-tour-target', 'hq-forecast')

    // HQ — Maya's playbook (left card in the pulse grid). Tight selector
    // anchored to the v3 dashboard so we don't pick up any sibling .playbook
    // in other surfaces (none today, but defensive).
    var hqPlaybook = document.querySelector('#view-db-dashboard.hq-v3 .playbook')
      || document.querySelector('#view-db-dashboard .playbook')
    if (hqPlaybook) hqPlaybook.setAttribute('data-tour-target', 'hq-playbook')

    // HQ — anomalies / "What's popping" card on the right side of the
    // pulse grid. Surfaces posts performing 2-5× above baseline.
    var hqAnomalies = document.querySelector('#hq3-anomalies')
      || document.querySelector('#view-db-dashboard .hq3-side-stack')
    if (hqAnomalies) hqAnomalies.setAttribute('data-tour-target', 'hq-anomalies')

    // HQ — agent pipeline (Maya → Jordan → Riley node chain).
    var hqPipeline = document.querySelector('#hq3-pipeline-sect')
      || document.querySelector('#view-db-dashboard .hq3-pipe')
    if (hqPipeline) hqPipeline.setAttribute('data-tour-target', 'hq-pipeline')

    // Posts — the filter chip row (Platform · Format · Sort). Anchors the
    // spotlight on the most distinctive piece of the Posts view.
    var postsFilters = document.querySelector('#view-db-posts .filters')
      || document.querySelector('#view-db-posts .posts-mast')
    if (postsFilters) postsFilters.setAttribute('data-tour-target', 'posts-filters')

    // Studio — the upload zone is the single primary action on this view.
    var studioUpload = document.querySelector('#studio-upload-zone')
      || document.querySelector('#view-db-studio .masthead')
    if (studioUpload) studioUpload.setAttribute('data-tour-target', 'studio-upload')
  }

  function render() {
    clearTimeout(autoTimer)
    cleanup()

    var st = STEPS[step]

    // Navigate to the page this step belongs to. Page IDs map to the
    // current IA — db-dashboard (HQ), db-posts, db-studio. The work/feed
    // entries are kept as harmless fallbacks for any older step shape.
    // Only HQ / Posts / Studio are linked from the dashboard nav today.
    // Audience / Outputs / Tasks / Feed views exist as orphan markup but
    // aren't reachable from the UI — don't navigate users there.
    var pageMap = {
      dashboard: 'db-dashboard',
      hq: 'db-dashboard',
      posts: 'db-posts',
      studio: 'db-studio',
    }
    var targetView = pageMap[st.page]
    if (targetView && window.navigate) {
      try { window.navigate(targetView) } catch (e) {}
    }

    setTimeout(function() {
      tagTargets()

      var target = st.target ? document.querySelector('[data-tour-target="'+st.target+'"]') : null

      // Bring the target into the viewport before measuring. Use `instant`
      // (not `smooth`) so getBoundingClientRect inside drawStep reads the
      // settled position — smooth scroll could still be animating after a
      // fixed delay, causing the spotlight ring to land misaligned. The
      // spotlight ring's vx-tip-in fade-in covers the visual jump.
      var scrollDelay = 0
      if (target) {
        try {
          var r0 = target.getBoundingClientRect()
          var vh0 = window.innerHeight
          var fullyOnScreen = r0.top >= 80 && r0.bottom <= vh0 - 40
          if (!fullyOnScreen) {
            target.scrollIntoView({ behavior: 'instant', block: 'center' })
            scrollDelay = 80   // one frame to let layout flush
          }
        } catch (e) {}
      }

      setTimeout(function () { drawStep(target, st) }, scrollDelay)
    }, 300)
  }

  function drawStep(target, st) {
      var rect = null
      if (target) {
        var r = target.getBoundingClientRect()
        rect = {x:r.left, y:r.top, w:r.width, h:r.height, cx:r.left+r.width/2, cy:r.top+r.height/2}
      }

      var pad = 14
      var vw = window.innerWidth, vh = window.innerHeight

      if (rect) {
        // 4 dark panels with a rectangular hole for the target
        var sx=rect.x-pad, sy=rect.y-pad, sw=rect.w+pad*2, sh=rect.h+pad*2
        addPanel(0, 0, vw, sy)                   // top
        addPanel(0, sy+sh, vw, vh-(sy+sh))       // bottom
        addPanel(0, sy, sx, sh)                   // left
        addPanel(sx+sw, sy, vw-(sx+sw), sh)       // right

        // Glow ring
        var ring = document.createElement('div')
        ring.style.cssText = 'position:fixed;z-index:10001;pointer-events:none;border:1.5px solid '+ACCENT+';border-radius:12px;animation:vx-glow 2s ease-in-out infinite'
        ring.style.left = sx+'px'; ring.style.top = sy+'px'
        ring.style.width = sw+'px'; ring.style.height = sh+'px'
        document.body.appendChild(ring); els.push(ring)
      } else {
        // Full dark overlay for center steps (welcome/finale)
        addPanel(0, 0, vw, vh)
      }

      // Tooltip
      var tipW = 380
      var tipX, tipY
      if (!rect) {
        tipX = vw/2 - tipW/2
        tipY = vh/2 - 140
      } else {
        var spR = vw - (rect.x+rect.w), spB = vh - (rect.y+rect.h)
        if (spR > tipW+40) {
          tipX = rect.x+rect.w+28; tipY = Math.max(20, Math.min(vh-320, rect.cy-120))
        } else if (spB > 300) {
          tipX = Math.max(20, Math.min(vw-tipW-20, rect.cx-tipW/2)); tipY = rect.y+rect.h+28
        } else {
          tipX = Math.max(20, rect.x-tipW-28); tipY = Math.max(20, Math.min(vh-320, rect.cy-120))
        }
      }

      var dur = step===0 ? WELCOME_MS : step===STEPS.length-1 ? FINAL_MS : STEP_MS

      // Animated title
      var titleHtml = st.title.split('').map(function(ch,i) {
        if (ch==='\n') return '<br/>'
        return '<span style="display:inline-block;animation:vx-char .45s cubic-bezier(.16,1,.3,1) both;animation-delay:'+(i*18)+'ms;'+(ch===' '?'white-space:pre':'')+'">' + esc(ch) + '</span>'
      }).join('')

      var tip = document.createElement('div')
      tip.style.cssText = 'position:fixed;z-index:10002;width:'+tipW+'px;animation:vx-tip-in .5s cubic-bezier(.16,1,.3,1)'
      tip.style.left = tipX+'px'; tip.style.top = tipY+'px'

      tip.innerHTML = '<div style="background:#111;border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:24px 24px 18px;box-shadow:0 30px 80px rgba(0,0,0,.6);position:relative;overflow:hidden">'
        // Accent bar
        +'<div style="position:absolute;left:0;top:0;bottom:0;width:3px;background:'+ACCENT+';box-shadow:0 0 12px '+ACCENT+'"></div>'
        // Glint
        +'<div style="position:absolute;right:-40px;top:-40px;width:100px;height:100px;border-radius:50%;background:radial-gradient(circle,'+ACCENT+'22,transparent 70%);pointer-events:none"></div>'
        // Eyebrow
        +'<div style="font-size:10px;text-transform:uppercase;letter-spacing:.18em;color:'+ACCENT+';margin-bottom:14px;font-weight:500;display:flex;align-items:center;gap:10px;animation:vx-fade .4s .1s both">'
        +'<span style="width:20px;height:1px;background:'+ACCENT+';box-shadow:0 0 6px '+ACCENT+'"></span>'
        +esc(st.eyebrow)+'</div>'
        // Title
        +'<div style="font-family:Cormorant Garamond,Georgia,serif;font-size:'+(rect?'30':'36')+'px;line-height:1.08;font-weight:300;font-style:italic;margin-bottom:14px;letter-spacing:-.02em;color:#edede9">'
        +titleHtml+'</div>'
        // Body
        +'<div style="font-size:13px;line-height:1.7;opacity:.6;margin-bottom:16px;max-width:320px;animation:vx-fade .4s .3s both">'+esc(st.body)+'</div>'
        // Progress bar + dots + skip
        +'<div style="animation:vx-fade .4s .4s both">'
        +'<div style="height:2px;background:rgba(255,255,255,.08);border-radius:1px;margin-bottom:10px;overflow:hidden">'
        +'<div style="height:100%;background:'+ACCENT+';border-radius:1px;animation:vx-progress '+dur+'ms linear"></div></div>'
        +'<div style="display:flex;align-items:center;gap:10px">'
        +'<div style="display:flex;gap:3px">'
        +STEPS.map(function(_,i){return '<div style="width:'+(i===step?18:4)+'px;height:2px;background:'+(i<=step?ACCENT:'rgba(255,255,255,.15)')+';border-radius:1px;transition:all .4s"></div>'}).join('')
        +'</div>'
        +'<span style="font-size:10px;color:rgba(255,255,255,.3);letter-spacing:.08em">'+(step+1)+'/'+STEPS.length+'</span>'
        +'<button id="vx-tour-skip" style="margin-left:auto;background:none;border:none;color:rgba(255,255,255,.35);font-size:10px;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;font-family:inherit;padding:4px 0">Skip</button>'
        +'</div></div></div>'

      document.body.appendChild(tip); els.push(tip)

      // Wire skip
      var skipBtn = document.getElementById('vx-tour-skip')
      if (skipBtn) skipBtn.addEventListener('click', close)

      // Click dark panels to advance
      els.forEach(function(e) {
        if (e.classList && e.classList.contains('vx-tp')) {
          e.style.cursor = 'pointer'
          e.style.pointerEvents = 'auto'
          e.addEventListener('click', next)
        }
      })

      // Auto-advance
      autoTimer = setTimeout(next, dur)
  }

  function addPanel(x, y, w, h) {
    if (w <= 0 || h <= 0) return
    var d = document.createElement('div')
    d.className = 'vx-tp'
    d.style.left = x+'px'; d.style.top = y+'px'
    d.style.width = w+'px'; d.style.height = h+'px'
    document.body.appendChild(d); els.push(d)
  }

  function next() {
    clearTimeout(autoTimer)
    if (step >= STEPS.length-1) { close(); return }
    step++
    render()
  }

  function close() {
    clearTimeout(autoTimer)
    // Fade out
    els.forEach(function(e) { e.style.opacity = '0'; e.style.transition = 'opacity .3s' })
    setTimeout(cleanup, 350)
    localStorage.setItem('vx-tour-done','1')
    if (window.navigate) try{window.navigate('db-dashboard')}catch(e){}
  }

  // Keyboard
  document.addEventListener('keydown', function(e) {
    if (!els.length) return
    if (e.key==='ArrowRight'||e.key===' '||e.key==='Enter') { e.preventDefault(); next() }
    if (e.key==='Escape') close()
  })

  // Public API
  window.launchSovexaTour = function() { step=0; render() }

  // ?tour=1 — force-launch escape hatch for testing. Bypasses the done /
  // auto-fired gates and clears them so the tour can be replayed cleanly.
  // Works on any environment. Drop the query string after triggering so a
  // browser refresh doesn't re-fire.
  function forceLaunchFromQuery() {
    try {
      var params = new URLSearchParams(window.location.search)
      if (params.get('tour') !== '1') return false
      localStorage.removeItem('vx-tour-done')
      try { sessionStorage.removeItem('vx-tour-auto-fired') } catch (e) {}
      // Strip ?tour=1 from URL so a refresh doesn't loop.
      params.delete('tour')
      var qs = params.toString()
      var newUrl = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash
      try { window.history.replaceState({}, '', newUrl) } catch (e) {}
      setTimeout(function () { window.launchSovexaTour() }, 800)
      return true
    } catch (e) { return false }
  }

  // Test accounts that always see the tour on login — mirrors the
  // UNLIMITED_USERNAMES list in apps/api/src/lib/unlimitedAccounts.ts so
  // testing accounts get the full demo every session regardless of whether
  // they previously dismissed the tour.
  var TEST_USERNAMES = ['jaytlin']

  function getCurrentUsername() {
    try {
      var state = window.__vxDashState
      return (state && state.me && state.me.user && state.me.user.username) || null
    } catch (e) { return null }
  }

  // In-closure guard. Prevents the tour from firing twice when dashboard-v2
  // dispatches `vx-dash-ready` multiple times in one page load (warm-cache
  // pass + fresh fetch). Resets naturally when the page reloads, so a
  // logout/login cycle in the same tab still gets a fresh tour for test
  // users — unlike a sessionStorage flag, which would persist across that
  // transition.
  var hasLaunchedThisLoad = false

  // Single source of truth for "should I fire the tour right now?" — called
  // both immediately at script load and on every `vx-dash-ready` event
  // (dashboard-v2.js dispatches it once /api/auth/me populates
  // __vxDashState).
  function maybeAutoLaunch() {
    if (hasLaunchedThisLoad) return
    if (localStorage.getItem('vx-authed') !== '1') return

    var username = getCurrentUsername()
    var isTestUser = username && TEST_USERNAMES.indexOf(username) !== -1

    if (isTestUser) {
      // Test accounts replay the tour on every page load (refresh, navigate,
      // logout+login). No sessionStorage guard — we want a fresh fire every
      // time the user lands on the app. Clear vx-tour-done so the tour
      // would also fire the *next* page load even without this code path.
      localStorage.removeItem('vx-tour-done')
    } else {
      // Real users: once per browser ever (localStorage), once per tab
      // session (sessionStorage) on top of that.
      if (localStorage.getItem('vx-tour-done') === '1') return
      try { if (sessionStorage.getItem('vx-tour-auto-fired') === '1') return } catch (e) {}
      try { sessionStorage.setItem('vx-tour-auto-fired', '1') } catch (e) {}
    }

    hasLaunchedThisLoad = true
    setTimeout(function () { window.launchSovexaTour() }, 2000)
  }

  function autoLaunch() {
    if (forceLaunchFromQuery()) return
    // Try now in case __vxDashState was already hydrated (warm refresh).
    maybeAutoLaunch()
    // Also catch the cold-load case where state populates after this script
    // ran. dashboard-v2.js dispatches vx-dash-ready once /api/auth/me lands.
    window.addEventListener('vx-dash-ready', maybeAutoLaunch)
  }
  if (document.readyState!=='loading') autoLaunch()
  else document.addEventListener('DOMContentLoaded', autoLaunch)
})()
