// Sovexa onboarding tour — automatic cinematic spotlight
// Panels are appended directly to body (no wrapper overlay that blocks content)

;(function () {
  var MAIN_STEPS = window.VEXA_TOUR_STEPS
  if (!MAIN_STEPS) return

  var ACCENT = '#d4a574'
  var step = 0
  var els = []  // all tour elements we've added to body
  var autoTimer = null

  // `currentSteps` swaps between the main tour and any mini tour. The
  // render loop and step counter read from this so the same machinery
  // runs both tiers. `currentTourId` is "main" or "mini:<name>" so close()
  // can write the right done-flag (vx-tour-done vs vx-mini-tour-<name>-done).
  var currentSteps = MAIN_STEPS
  var currentTourId = 'main'

  // Tour pacing — tightened 2026-05-11 from 5000/4000/6000 to feel
  // cinematic-but-brisk. Mini tours run a touch faster (2500ms) because
  // the user opted in by clicking the tab.
  var STEP_MS = 3000
  var WELCOME_MS = 3000
  var FINAL_MS = 4000
  var MINI_STEP_MS = 2800

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
    // Connect platforms — the integrations CTA card on HQ. Injected
    // async by integrations-wire.js after /api/platform/accounts resolves,
    // so it may not be present on the very first render. Fall back to the
    // HQ hero so the step still has something to anchor to.
    var connectCta = document.querySelector('#vx-integrations-cta')
      || document.querySelector('#view-db-dashboard .hq3-cockpit')
      || document.querySelector('#view-db-dashboard .hq3-hero')
    if (connectCta) connectCta.setAttribute('data-tour-target', 'connect-platforms')

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

    // Notifications bell in the topbar — where approvals queue up. Hidden
    // (display:none) until login, but shown once authed. Skip if still
    // hidden so the tour doesn't ring around an invisible target.
    var notifBtn = document.getElementById('notif-btn')
    if (notifBtn && notifBtn.offsetParent !== null) {
      notifBtn.setAttribute('data-tour-target', 'notifications-bell')
    }

    // Posts — the filter chip row (Platform · Format · Sort). Anchors the
    // spotlight on the most distinctive piece of the Posts view.
    var postsFilters = document.querySelector('#view-db-posts .filters')
      || document.querySelector('#view-db-posts .posts-mast')
    if (postsFilters) postsFilters.setAttribute('data-tour-target', 'posts-filters')

    // Studio — three landmarks: upload, pending edits, scheduling panel.
    var studioUpload = document.querySelector('#studio-upload-zone')
      || document.querySelector('#view-db-studio .masthead')
    if (studioUpload) studioUpload.setAttribute('data-tour-target', 'studio-upload')

    var studioEdits = document.querySelector('#studio-pending-container')
      || document.querySelector('#view-db-studio .dash-main')
    if (studioEdits) studioEdits.setAttribute('data-tour-target', 'studio-edits')

    var studioSchedule = document.querySelector('#view-db-studio .dash-side')
    if (studioSchedule) studioSchedule.setAttribute('data-tour-target', 'studio-schedule')

    // Whenever the tour points at any studio target, ensure the page has
    // demo content so the spotlight lands on something visible. First-time
    // users have empty pending + ready sections; the engine injects sample
    // clips here and clears them in close().
    if (studioEdits || studioSchedule || studioUpload) {
      try { injectStudioDemoIfEmpty() } catch (e) {}
    }

    // After demo injection, tag the first demo card so the buttons step
    // has a single ringable target. The body copy walks through every
    // button (Approve / Download / Re-cut / Reject / Discard) — spotlight
    // the whole card so all of them sit inside the ring.
    var firstCard = document.querySelector('#studio-pending-container [data-vx-tour-demo]')
    if (firstCard) firstCard.setAttribute('data-tour-target', 'studio-card')
  }

  // ─── Studio demo content ────────────────────────────────────────────
  // On first visit, Studio's pending-approval and ready-to-post sections
  // are empty (nothing has been uploaded yet). The tour spotlights these
  // surfaces, so we inject realistic-looking sample clips while the tour
  // is running and remove them in close(). Sample cards carry a "Sample"
  // pill so the user understands they're illustrative, not real.

  var STUDIO_DEMO_SENTINEL = 'data-vx-tour-demo'

  function injectStudioDemoIfEmpty() {
    var pending = document.getElementById('studio-pending-container')
    if (pending && !pending.querySelector('[' + STUDIO_DEMO_SENTINEL + ']')) {
      var inner = (pending.innerHTML || '').trim()
      var isEmpty = inner === '' || /No clips pending|will appear here/i.test(inner)
      if (isEmpty) pending.innerHTML = STUDIO_DEMO_PENDING_HTML
    }

    var ready = document.getElementById('studio-clips')
    if (ready && !ready.querySelector('[' + STUDIO_DEMO_SENTINEL + ']')) {
      var rinner = (ready.innerHTML || '').trim()
      var rEmpty = rinner === '' || /Clips will appear here|will appear here once/i.test(rinner)
      if (rEmpty) ready.innerHTML = STUDIO_DEMO_READY_HTML
    }

    // Update the count in the section header so it matches the demo content.
    var countEl = document.querySelector('[data-studio-pending-count]')
    if (countEl && !countEl.dataset.vxTourOrig) {
      countEl.dataset.vxTourOrig = countEl.textContent || ''
      countEl.textContent = '2 items · sample'
    }
  }

  function clearStudioDemo() {
    var pending = document.getElementById('studio-pending-container')
    if (pending && pending.querySelector('[' + STUDIO_DEMO_SENTINEL + ']')) {
      pending.innerHTML = '<div style="background:var(--s1);border:1px solid var(--b1);border-radius:10px;padding:40px;text-align:center;color:var(--t3);font-size:13px">No clips pending approval. Upload a video to get started.</div>'
    }
    var ready = document.getElementById('studio-clips')
    if (ready && ready.querySelector('[' + STUDIO_DEMO_SENTINEL + ']')) {
      ready.innerHTML = '<div style="background:var(--s1);border:1px solid var(--b1);border-radius:8px;padding:24px;text-align:center;color:var(--t3);font-size:12px">Clips will appear here once processed</div>'
    }
    var countEl = document.querySelector('[data-studio-pending-count]')
    if (countEl && countEl.dataset.vxTourOrig !== undefined) {
      countEl.textContent = countEl.dataset.vxTourOrig
      delete countEl.dataset.vxTourOrig
    }
  }

  // Demo HTML — matches the current .studio-clip-card design defined in
  // vexa-shared.css:2117+ (compact column-tile, video on top, metadata +
  // score below, icon-button action row, footer). Cards fit a single
  // grid cell (3-col at full width, 2-col below 1320px, 1-col below 720px).
  // Buttons are disabled — clicking would crash since they expect real
  // clip IDs wired through studio-wire.js.
  function buildPendingCard(opts) {
    var versionBg = opts.scoreColor === 'ok' ? 'var(--ok)' : 'var(--accent)'
    var scoreCss = opts.scoreColor === 'ok'
      ? 'background:rgba(159,179,138,.12);color:var(--ok)'
      : 'background:rgba(212,165,116,.14);color:var(--accent)'
    return [
      '<div class="studio-clip-card" ' + STUDIO_DEMO_SENTINEL + '="1" style="position:relative">',
        '<div style="position:absolute;top:8px;right:8px;z-index:2;background:rgba(20,16,10,.6);color:rgba(255,255,255,.85);font-family:\'JetBrains Mono\',monospace;font-size:9px;letter-spacing:.14em;padding:2px 7px;border-radius:999px;text-transform:uppercase;font-weight:600;backdrop-filter:blur(4px)">Sample</div>',
        '<div class="studio-clip-inner">',
          '<div class="studio-clip-visual">',
            '<div class="studio-clip-placeholder" style="background:linear-gradient(135deg,' + opts.grad[0] + ' 0%,' + opts.grad[1] + ' 100%);color:rgba(255,255,255,.45);font-size:32px">▶</div>',
          '</div>',
          '<div class="studio-clip-meta">',
            '<div class="studio-clip-meta-row">',
              '<span>Riley\'s edit</span>',
              '<span class="studio-clip-ver" style="background:' + versionBg + '">v' + opts.version + '</span>',
            '</div>',
            '<div class="studio-clip-toning">Temp: ' + opts.temp + ' · Sat: ' + opts.sat + ' · Warmth: ' + opts.warmth + '</div>',
            '<div class="studio-clip-score" style="' + scoreCss + '">Style match: ' + opts.score + '</div>',
          '</div>',
          '<div class="studio-clip-actions">',
            '<button class="btn-fill" style="flex:1;padding:8px;font-size:11px;opacity:.7" disabled>Approve</button>',
            '<button class="vx-icon-btn" disabled title="Download" style="opacity:.7">↓</button>',
            '<button class="vx-icon-btn" disabled title="Re-cut" style="opacity:.7">↻</button>',
            '<button class="vx-icon-btn vx-icon-btn-danger" disabled title="Reject" style="opacity:.7">✕</button>',
          '</div>',
        '</div>',
        '<div class="studio-clip-footer">',
          '<button class="btn" style="padding:4px 10px;font-size:10px;color:var(--t3);opacity:.7" disabled>Discard</button>',
        '</div>',
      '</div>',
    ].join('')
  }

  var STUDIO_DEMO_PENDING_HTML = [
    buildPendingCard({ grad: ['#1f1f23', '#34343a'], version: 1, temp: 4800, sat: -3, warmth: '+2', score: '0.94', scoreColor: 'ok' }),
    buildPendingCard({ grad: ['#2a2520', '#443a32'], version: 2, temp: 5200, sat: '+1', warmth: -1, score: '0.87', scoreColor: 'accent' }),
    buildPendingCard({ grad: ['#1f2520', '#324336'], version: 1, temp: 4600, sat: '+0', warmth: '+1', score: '0.91', scoreColor: 'ok' }),
  ].join('')

  var STUDIO_DEMO_READY_HTML = [
    [['#1f1f23', '#34343a'], 'Morning reset — the calm one', '28s · Reel'],
    [['#2a2520', '#443a32'], 'Sunday boundary, not to-do', '32s · Reel'],
    [['#1f2520', '#324336'], 'The week-after-the-week', '24s · Reel'],
    [['#221f2a', '#363242'], 'Quiet ambition, loud results', '36s · Reel'],
  ].map(function (c) {
    return '<div ' + STUDIO_DEMO_SENTINEL + '="1" style="background:var(--s1);border:1px solid var(--b1);border-radius:8px;overflow:hidden;position:relative">'
      + '<div style="position:absolute;top:10px;right:10px;z-index:2;background:rgba(0,0,0,.45);color:rgba(255,255,255,.8);font-family:\'JetBrains Mono\',monospace;font-size:9px;letter-spacing:.14em;padding:2px 6px;border-radius:3px;text-transform:uppercase;font-weight:600">Sample</div>'
      + '<div style="background:linear-gradient(135deg, ' + c[0][0] + ' 0%, ' + c[0][1] + ' 100%);aspect-ratio:9/16;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.4);font-size:32px">▶</div>'
      + '<div style="padding:12px">'
        + '<div style="font-size:13px;font-weight:500;color:var(--t1);margin-bottom:4px">' + c[1] + '</div>'
        + '<div style="font-size:11px;color:var(--t3)">' + c[2] + ' · Approved</div>'
      + '</div>'
    + '</div>'
  }).join('')

  function render() {
    clearTimeout(autoTimer)
    cleanup()

    var st = currentSteps[step]

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
      // fixed delay, causing the spotlight ring to land misaligned.
      //
      // Block-mode choice matters. Center-aligning a wide target (e.g.
      // the HQ pipeline section spanning full viewport width) leaves
      // ~half the viewport above/below — neither side has enough room
      // for the tooltip, so placement falls through to center-screen and
      // overlaps the target. For wide targets we anchor to viewport
      // start instead so the tooltip can land cleanly below.
      var scrollDelay = 0
      if (target) {
        try {
          var r0 = target.getBoundingClientRect()
          var vh0 = window.innerHeight
          var vw0 = window.innerWidth
          var fullyOnScreen = r0.top >= 80 && r0.bottom <= vh0 - 40
          if (!fullyOnScreen) {
            var blockMode = r0.width > vw0 * 0.6 ? 'start' : 'center'
            target.scrollIntoView({ behavior: 'instant', block: blockMode })
            scrollDelay = 80
          } else if (r0.width > vw0 * 0.6 && r0.top < 60) {
            // Wide target already near top — leave a small top gap so
            // the spotlight ring doesn't bump the topbar.
            window.scrollBy(0, r0.top - 80)
            scrollDelay = 80
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

      // Tooltip placement — try Right → Below → Above → Left → center-fallback.
      // Above was missing, so wide/bottom-anchored targets (e.g. the HQ
      // pipeline section, which spans full viewport width and sits near
      // the bottom) fell to Left and clamped to viewport-x=20, covering
      // the target's leftmost content (Maya's pipeline node).
      var tipW = 380
      var tipH = 320     // approximate; tooltip varies with copy
      var tipX, tipY
      if (!rect) {
        tipX = vw/2 - tipW/2
        tipY = vh/2 - 140
      } else {
        var spR = vw - (rect.x + rect.w)   // space right of target
        var spB = vh - (rect.y + rect.h)   // space below target
        var spA = rect.y                    // space above target
        var spL = rect.x                    // space left of target
        if (spR > tipW + 40) {
          tipX = rect.x + rect.w + 28
          tipY = Math.max(20, Math.min(vh - tipH, rect.cy - 120))
        } else if (spB > tipH) {
          tipX = Math.max(20, Math.min(vw - tipW - 20, rect.cx - tipW / 2))
          tipY = rect.y + rect.h + 28
        } else if (spA > tipH + 48) {
          // Above — center horizontally over the target so it reads as
          // "the thing this card is talking about is right below." Place
          // the tooltip 28px above the target's top edge (matching the
          // 28px gap used by the right/below placements). The previous
          // version had a sign bug that landed the card 20px INSIDE the
          // spotlight box, covering the leftmost content (Jordan's node
          // on the HQ pipeline step).
          tipX = Math.max(20, Math.min(vw - tipW - 20, rect.cx - tipW / 2))
          tipY = rect.y - tipH - 28
        } else if (spL > tipW + 40) {
          tipX = rect.x - tipW - 28
          tipY = Math.max(20, Math.min(vh - tipH, rect.cy - 120))
        } else {
          // Last resort: center-screen over the dimmer.
          tipX = vw / 2 - tipW / 2
          tipY = vh / 2 - 140
        }
      }

      // Mini tours use a steady cadence; main tour gives the welcome and
      // wrap-up a slightly longer beat than the middle steps.
      var dur = currentTourId === 'main'
        ? (step === 0 ? WELCOME_MS : step === currentSteps.length - 1 ? FINAL_MS : STEP_MS)
        : MINI_STEP_MS

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
        +currentSteps.map(function(_,i){return '<div style="width:'+(i===step?18:4)+'px;height:2px;background:'+(i<=step?ACCENT:'rgba(255,255,255,.15)')+';border-radius:1px;transition:all .4s"></div>'}).join('')
        +'</div>'
        +'<span style="font-size:10px;color:rgba(255,255,255,.3);letter-spacing:.08em">'+(step+1)+'/'+currentSteps.length+'</span>'
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
    if (step >= currentSteps.length-1) { close(); return }
    step++
    render()
  }

  function close() {
    clearTimeout(autoTimer)
    // Fade out
    els.forEach(function(e) { e.style.opacity = '0'; e.style.transition = 'opacity .3s' })
    setTimeout(cleanup, 350)

    // Clean up any demo content the tour injected (Studio sample clips).
    try { clearStudioDemo() } catch (e) {}

    // Persist the right done-flag for the tour that just finished. The
    // main tour writes `vx-tour-done`; mini tours write a per-surface
    // key so they fire exactly once per surface per user.
    if (currentTourId === 'main') {
      localStorage.setItem('vx-tour-done', '1')
      if (window.navigate) try { window.navigate('db-dashboard') } catch (e) {}
    } else if (currentTourId.indexOf('mini:') === 0) {
      var name = currentTourId.slice(5)
      localStorage.setItem('vx-mini-tour-' + name + '-done', '1')
    }

    // Reset to main-tour defaults so the next launch starts clean.
    currentSteps = MAIN_STEPS
    currentTourId = 'main'
  }

  // Keyboard
  document.addEventListener('keydown', function(e) {
    if (!els.length) return
    if (e.key==='ArrowRight'||e.key===' '||e.key==='Enter') { e.preventDefault(); next() }
    if (e.key==='Escape') close()
  })

  // Public API
  window.launchSovexaTour = function() {
    currentSteps = MAIN_STEPS
    currentTourId = 'main'
    step = 0
    render()
  }

  // Surface-specific mini tour. Caller passes the key from
  // window.VEXA_MINI_TOURS (e.g. 'studio'). Bails if no such tour or
  // the tour engine is already running another panel set.
  window.launchSovexaMiniTour = function (name) {
    var tours = window.VEXA_MINI_TOURS || {}
    var steps = tours[name]
    if (!steps || !steps.length) return
    if (els.length > 0) return  // another tour is on screen — don't interrupt
    currentSteps = steps
    currentTourId = 'mini:' + name
    step = 0
    render()
  }

  // Maybe-fire a mini tour on navigation. Wired below into the global
  // navigate() function so any tab click can trigger it. Gates:
  //   - Main tour must be done (don't pile mini on top of fresh signup).
  //   - This particular mini must not have fired before for this user.
  //   - Test usernames bypass the done-flag (replay every visit) but
  //     still respect the "main tour done" gate.
  function maybeFireMiniTour(viewId) {
    var miniMap = {
      'db-studio': 'studio',
      // 'db-posts': 'posts',         // future
      // 'db-dashboard': 'hq',        // future
    }
    var name = miniMap[viewId]
    if (!name) return
    var tours = window.VEXA_MINI_TOURS || {}
    if (!tours[name] || !tours[name].length) return
    if (els.length > 0) return                                  // tour already running
    if (localStorage.getItem('vx-tour-done') !== '1') return    // main not yet done
    var username = getCurrentUsername()
    var isTestUser = username && TEST_USERNAMES.indexOf(username) !== -1
    if (!isTestUser && localStorage.getItem('vx-mini-tour-' + name + '-done') === '1') return
    // Slight delay so the view's own data-load animations settle first.
    setTimeout(function () { window.launchSovexaMiniTour(name) }, 600)
  }

  // Wrap window.navigate so we observe every page change. We chain
  // through the original implementation untouched.
  var _origNavForMini = window.navigate
  window.navigate = function (id) {
    var r = typeof _origNavForMini === 'function' ? _origNavForMini(id) : undefined
    try { maybeFireMiniTour(id) } catch (e) {}
    return r
  }

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
