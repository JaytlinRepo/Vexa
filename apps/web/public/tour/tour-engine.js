// Sovexa onboarding tour — automatic cinematic spotlight
// Panels are appended directly to body (no wrapper overlay that blocks content)

;(function () {
  var STEPS = window.VEXA_TOUR_STEPS
  if (!STEPS) return

  var ACCENT = '#d4a574'
  var step = 0
  var els = []  // all tour elements we've added to body
  var autoTimer = null
  var STEP_MS = 5000
  var WELCOME_MS = 4000
  var FINAL_MS = 6000

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

  // Tag real dashboard elements
  function tagTargets() {
    // Team cards
    var grid = document.querySelector('.emp-cards')
    if (grid) grid.setAttribute('data-tour-target','team-cards')
    if (!grid) {
      var secs = document.querySelectorAll('#view-db-dashboard section')
      for (var i=0;i<secs.length;i++) {
        if (secs[i].textContent.indexOf('Maya')!==-1 && secs[i].textContent.indexOf('Jordan')!==-1) {
          secs[i].setAttribute('data-tour-target','team-cards'); break
        }
      }
    }
    // Inbox
    var inbox = document.querySelector('#vx-inbox-host, #view-db-tasks .view-inner')
    if (inbox) inbox.setAttribute('data-tour-target','inbox-section')
    var tabs = document.querySelector('#vx-work-tabs')
    if (tabs && !inbox) tabs.setAttribute('data-tour-target','inbox-section')
    // Meeting
    var meet = document.querySelector('.emp-card-action, [data-action="meeting"]')
    if (meet) meet.setAttribute('data-tour-target','meeting-btn')
    // Feed
    var feed = document.querySelector('#view-db-feed .view-inner, #view-db-feed')
    if (feed) feed.setAttribute('data-tour-target','feed-section')
  }

  function render() {
    clearTimeout(autoTimer)
    cleanup()

    var st = STEPS[step]

    // Navigate
    if (st.page==='work' && window.navigate) try{window.navigate('db-tasks')}catch(e){}
    if (st.page==='feed' && window.navigate) try{window.navigate('db-feed')}catch(e){}
    if (st.page==='dashboard' && window.navigate) try{window.navigate('db-dashboard')}catch(e){}

    setTimeout(function() {
      tagTargets()

      var target = st.target ? document.querySelector('[data-tour-target="'+st.target+'"]') : null
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
    }, 300)
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

  // Auto-launch for new users
  function autoLaunch() {
    if (localStorage.getItem('vx-tour-done')==='1') return
    if (localStorage.getItem('vx-authed')!=='1') return
    setTimeout(window.launchSovexaTour, 2500)
  }
  if (document.readyState!=='loading') autoLaunch()
  else document.addEventListener('DOMContentLoaded', autoLaunch)
})()
