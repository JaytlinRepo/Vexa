/* Theme: root layout (theme-dark-default.js + SovexaThemeBridge.tsx) owns
   data-theme and window.toggleTheme so hydration cannot clobber the toggle. */

/* ── GUARD — the script can be re-evaluated by dev HMR or a <Script> remount.
   Classic-script `const`/`let` clash globally on a second run, so we use
   `var` at the top level (var tolerates redeclaration) and skip the
   side-effect wiring if we've already bootstrapped once. */
if (window.__vxPrototypeSideEffectsDone) {
  // Declarations below still re-run (harmless with var), but listeners
  // etc. don't double-bind.
}
var __vxPrototypeBoot = !window.__vxPrototypeSideEffectsDone
window.__vxPrototypeSideEffectsDone = true

/** When false (default): hide TikTok connect flows until app review is cleared. Toggle to true during local testing. */
if (typeof window.__VX_TIKTOK_INTEGRATION_ENABLED === 'undefined') {
  window.__VX_TIKTOK_INTEGRATION_ENABLED = false
}

/* ── CURSOR ─────────────────────────────────────────── */
var cd=document.getElementById('cd'),cr=document.getElementById('cr')
var mx=0,my=0,rx=0,ry=0
if(__vxPrototypeBoot){
  if(cd){
    document.addEventListener('mousemove',e=>{mx=e.clientX;my=e.clientY;cd.style.left=mx+'px';cd.style.top=my+'px'})
  }
  if(cd&&cr){
    ;(function loop(){rx+=(mx-rx)*.11;ry+=(my-ry)*.11;cr.style.left=rx+'px';cr.style.top=ry+'px';requestAnimationFrame(loop)})()
  }
  document.querySelectorAll('a,button,[onclick],.emp-row,.team-row,.how-cell,.pc,.ob-card,.feed-card,.output-item,.task-row,.settings-nav-item').forEach(el=>{
    el.addEventListener('mouseenter',()=>document.body.classList.add('ch'))
    el.addEventListener('mouseleave',()=>document.body.classList.remove('ch'))
  })
  document.addEventListener('mousedown',()=>document.body.classList.add('cp'))
  document.addEventListener('mouseup',()=>document.body.classList.remove('cp'))
}

/* ── STATE ──────────────────────────────────────────── */
// currentView MUST match what's visibly active in the DOM right now,
// otherwise navigate()'s `if(currentView===id)return` early-return silently
// no-ops and the user sees a stale view (e.g. on login, enterDashboard calls
// navigate('db-dashboard') — if currentView was already 'db-dashboard' from
// localStorage but view-home still has .active, the swap never happens).
//
// Source of truth (priority):
//   1. URL hash if it names a real view (refresh-restore + auth-gate target)
//   2. The .view.active element in the DOM (default = view-home)
var currentView='home'
try{
  var __vxHash=(location.hash||'').replace(/^#/,'')
  if(/^[a-z0-9-]+$/.test(__vxHash) && document.getElementById('view-'+__vxHash)){
    currentView=__vxHash
  } else {
    var __vxActive=document.querySelector('.view.active')
    if(__vxActive && __vxActive.id && __vxActive.id.indexOf('view-')===0){
      currentView=__vxActive.id.slice(5)
    }
  }
}catch(e){}
var isLoggedIn=false
var selectedNiche=''
/** @type {string[]} chips for onboarding step 2 → joined into `niche` for API */
var obContentTags=[]
var companyName=''

/* ── NAVIGATION ─────────────────────────────────────── */
var sectionNames={
  home:'Home',team:'The Team',how:'How It Works',outputs:'See Outputs',contact:'Contact',
  knowledge:'Knowledge Feed',pricing:'Pricing',faq:'FAQ',
  'db-dashboard':'HQ','db-pipeline':'Pipeline','db-posts':'Posts',
  'db-studio':'Studio','db-audience':'Audience','db-team':'Team','db-tasks':'Work',
  'db-outputs':'Outputs','db-knowledge':'Knowledge','db-settings':'Settings'
}

function navigate(id){
  // Remove the auth-gate style that uses !important to hide views —
  // once navigate() runs, the .active class handles visibility.
  var gate=document.getElementById('vx-auth-gate')
  var gateWasActive=!!gate
  if(gate)gate.remove()

  // If gate was active and we're navigating to dashboard, just set .active
  // without animation — the dashboard is already visible from the gate.
  if(gateWasActive&&id==='db-dashboard'){
    document.querySelectorAll('.view').forEach(function(v){v.classList.remove('active')})
    var d=document.getElementById('view-db-dashboard')
    if(d)d.classList.add('active')
    currentView='db-dashboard'
    // Update nav highlight
    document.querySelectorAll('.nav-item,.topnav-link').forEach(function(el){el.classList.remove('active')})
    var gateNav=document.getElementById('nav-db-dashboard')
    if(gateNav)gateNav.classList.add('active')
    syncHash('db-dashboard')
    return
  }

  // Only short-circuit if BOTH the JS state AND the DOM agree this view is
  // already showing. JS state can lag (something reset .active behind our
  // back, or a prior race set currentView without toggling .active) — in
  // those cases we MUST still run the swap, otherwise the user is stuck on
  // a stale view (the symptom: URL says #db-dashboard but view-home shows).
  if(currentView===id && document.getElementById('view-'+id)?.classList.contains('active'))return
  const prev=document.getElementById('view-'+currentView)
  const next=document.getElementById('view-'+id)
  if(!next)return

  // Update nav active states (legacy sidebar + new horizontal top nav)
  document.querySelectorAll('.nav-item,.topnav-link').forEach(el=>el.classList.remove('active'))
  const navEl=document.getElementById('nav-'+id)
  if(navEl)navEl.classList.add('active')

  const pt=document.getElementById('page-trans')
  const topbar=document.getElementById('topbar-section')
  const doSwap=()=>{
    // Hide ALL views first, then show the target
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'))
    next.classList.add('active')
    if(topbar)topbar.textContent=sectionNames[id]||id
    currentView=id
    syncHash(id)
    if(pt){
      pt.classList.remove('in')
      pt.classList.add('out')
      setTimeout(()=>pt.classList.remove('out'),500)
    }
  }

  if(!pt){
    doSwap()
    return
  }
  pt.style.transition='transform .45s cubic-bezier(.76,0,.24,1)'
  pt.classList.remove('out')
  pt.classList.add('in')
  setTimeout(doSwap,280)
}

// Update the URL hash so refresh + back/forward restore the view.
// Skipped when navigate() was triggered by hashchange itself (avoids loops).
function syncHash(id){
  if(window.__vxNavFromHash)return
  try{
    var want='#'+id
    if(location.hash!==want)history.pushState(null,'',want)
  }catch(e){}
}

window.addEventListener('hashchange',function(){
  var h=(location.hash||'').replace(/^#/,'')
  if(!h||h===currentView)return
  if(!/^[a-z0-9-]+$/.test(h))return
  if(!document.getElementById('view-'+h))return
  window.__vxNavFromHash=true
  try{navigate(h)}finally{window.__vxNavFromHash=false}
})

// First paint: URL hash and DOM often disagree — static HTML defaults to
// view-home.active while location may be #db-studio from a prior session.
// Also block deep-link app routes when logged out (avoid marketing page +
// wrong hash). The localStorage `vx-authed` flag is a fast hint, but it's
// per-origin — accessing the same Studio under both `localhost:3000` and
// `sovexa-dev-desktop:3000` would silently dump the user back to home even
// with a valid session cookie. So when the flag is missing, ask the API
// before redirecting away.
function vxSyncInitialHashRoute(){
  try{
    var h=(location.hash||'').replace(/^#/,'')
    if(!h||!/^[a-z0-9-]+$/.test(h))return
    if(!document.getElementById('view-'+h))return
    var appView=/^db-/.test(h)
    var authed=false
    try{authed=localStorage.getItem('vx-authed')==='1'}catch(e){}

    var doNavigate=function(){
      var next=document.getElementById('view-'+h)
      if(next && next.classList.contains('active') && currentView===h)return
      navigate(h)
    }

    if(appView && !authed){
      // Verify with the API before kicking to home — the flag may just be
      // missing from localStorage (e.g. different host, cleared cache).
      fetch('/api/auth/me',{credentials:'include'}).then(function(r){
        if(r.ok){
          try{localStorage.setItem('vx-authed','1')}catch(e){}
          doNavigate()
        }else{
          try{history.replaceState(null,'','#home')}catch(e){}
          navigate('home')
        }
      }).catch(function(){
        try{history.replaceState(null,'','#home')}catch(e){}
        navigate('home')
      })
      return
    }
    doNavigate()
  }catch(e){}
}
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',vxSyncInitialHashRoute)
}else{
  vxSyncInitialHashRoute()
}

/* ── NAV COLLAPSE ───────────────────────────────────── */
function toggleNav(){
  const nav=document.getElementById('sidenav')
  const btn=document.getElementById('collapseBtn')
  if(!nav||!btn)return
  nav.classList.toggle('collapsed')
  btn.textContent=nav.classList.contains('collapsed')?'›':'‹'
}

/* ── SHOW LOGIN ─────────────────────────────────────── */
function showLogin(){
  // Simulate quick login → go to dashboard
  enterDashboard()
}

/* ── ONBOARDING ─────────────────────────────────────── */
function startOnboarding(){
  document.getElementById('onboarding').classList.add('active')
  document.getElementById('ob-1').classList.add('active')
}

function obResetNicheTags(){
  obContentTags.length=0
  selectedNiche=''
  var wrap=document.getElementById('ob-niche-tags')
  if(wrap)wrap.innerHTML=''
  var inp=document.getElementById('ob-tag-input')
  if(inp)inp.value=''
  obSetNicheContinueEnabled(false)
}
window.obResetNicheTags=obResetNicheTags

function obSetNicheContinueEnabled(ok){
  var btn=document.getElementById('ob-niche-btn')
  if(!btn)return
  btn.disabled=!ok
  btn.style.opacity=ok?'1':'.4'
}

function obAddTagNormalized(raw){
  var t=String(raw||'').trim().replace(/\s+/g,' ')
  if(t.length<2)return false
  if(t.length>48)t=t.slice(0,48)
  var lk=t.toLowerCase()
  for(var i=0;i<obContentTags.length;i++){
    if(obContentTags[i].toLowerCase()===lk)return false
  }
  if(obContentTags.length>=16)return false
  obContentTags.push(t)
  return true
}

function obSyncNicheFromTags(){
  selectedNiche=obContentTags.join(', ')
  obRenderNicheTagPills()
  obSetNicheContinueEnabled(obContentTags.length>=1)
}

function obRenderNicheTagPills(){
  var wrap=document.getElementById('ob-niche-tags')
  if(!wrap)return
  wrap.innerHTML=obContentTags.map(function(tag,i){
    var safe=String(tag).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')
    return '<span class="ob-chip">' + safe + '<button type="button" class="ob-chip-x" aria-label="Remove tag" data-idx="' + i + '">&times;</button></span>'
  }).join('')
  wrap.querySelectorAll('.ob-chip-x').forEach(function(b){
    b.onclick=function(){
      obRemoveTag(parseInt(b.getAttribute('data-idx'),10))
    }
  })
}

window.obRemoveTag=function(idx){
  if(idx<0||idx>=obContentTags.length)return
  obContentTags.splice(idx,1)
  obSyncNicheFromTags()
}

function obCommitTagInputValue(){
  var inp=document.getElementById('ob-tag-input')
  if(!inp||!inp.value)return
  var parts=inp.value.split(/[,;]+/)
  var any=false
  for(var i=0;i<parts.length;i++){
    if(obAddTagNormalized(parts[i]))any=true
  }
  inp.value=''
  if(any)obSyncNicheFromTags()
}

window.obAddCurrentTag=function(){obCommitTagInputValue()}

function obWireNicheTagInput(){
  var inp=document.getElementById('ob-tag-input')
  if(!inp||inp.dataset.vxObTags)return
  inp.dataset.vxObTags='1'
  inp.addEventListener('keydown',function(e){
    if(e.key==='Enter'){e.preventDefault();obCommitTagInputValue()}
  })
}

document.addEventListener('DOMContentLoaded',obWireNicheTagInput)
if(document.readyState!=='loading')obWireNicheTagInput()

function obNext(step){
  if(step===1){
    companyName=document.getElementById('ob-name-input').value||'My Company'
    obResetNicheTags()
    document.getElementById('ob-1').classList.remove('active')
    document.getElementById('ob-2').classList.add('active')
    document.getElementById('ob-prog').style.width='66%'
  } else if(step===2){
    if(!selectedNiche)return
    document.getElementById('ob-2').classList.remove('active')
    document.getElementById('ob-4').classList.add('active')
    document.getElementById('ob-prog').style.width='100%'
    document.getElementById('ob-reveal-title').textContent=companyName+' is open for business.'
    startReveal()
  }
}

function obPrev(step){
  if(step===2){
    document.getElementById('ob-2').classList.remove('active')
    document.getElementById('ob-1').classList.add('active')
    document.getElementById('ob-prog').style.width='33%'
  }
}

function startReveal(){
  // Three-employee team (Maya, Jordan, Riley). Alex was retired —
  // ob-emp-2 is now Riley and there's no ob-emp-3 to reveal.
  const delays=[500,1100,1700]
  delays.forEach((d,i)=>{
    setTimeout(()=>{
      const el = document.getElementById('ob-emp-'+i)
      if (el) el.classList.add('revealed')
      if(i===delays.length-1){
        setTimeout(()=>{
          var prog = document.getElementById('ob-prog')
          var btn = document.getElementById('ob-enter-btn')
          if (prog) prog.style.width='100%'
          if (btn) btn.style.opacity='1'
        },400)
      }
    },d)
  })
}

function enterDashboard(){
  isLoggedIn=true
  document.getElementById('onboarding').classList.remove('active')

  // Hide landing page atmosphere
  var atmo=document.getElementById('landing-atmo')
  if(atmo){atmo.style.opacity='0';atmo.style.pointerEvents='none'}
  // Set auth attribute so CSS rules for logged-in state apply
  document.documentElement.dataset.vxAuthed='1'

  // Switch nav — nav-app is a .topnav-group (flex), so use 'flex' not 'block'.
  document.getElementById('nav-marketing').style.display='none'
  document.getElementById('nav-app').style.display='flex'
  document.getElementById('topbar-login').style.display='none'
  document.getElementById('topbar-cta').style.display='none'
  document.getElementById('notif-btn').style.display='flex'

  // Update user area
  document.getElementById('nav-username').textContent=companyName||'My Company'
  document.getElementById('nav-userplan').textContent='Max plan'
  document.getElementById('nav-avatar').textContent=
    (companyName||'M')[0].toUpperCase()

  // On refresh-restore, dashboard-wire sets this flag so we don't snap to HQ.
  // On login, the flag is unset and we navigate as usual.
  if (!window.__vxSuppressEnterNavigate) navigate('db-dashboard')
  setTimeout(initInsights, 420)
}

/* ── FAQ TOGGLE ─────────────────────────────────────── */
function toggleFaq(el){
  const item=el.parentElement,was=item.classList.contains('open')
  document.querySelectorAll('.faq-item').forEach(i=>i.classList.remove('open'))
  if(!was)item.classList.add('open')
}

/* ── OUTPUTS SWITCH ─────────────────────────────────── */
function switchOut(btn,id){
  document.querySelectorAll('.out-btn').forEach(b=>b.classList.remove('active'))
  btn.classList.add('active')
  ;['trend','hooks','cal'].forEach(k=>{
    const el=document.getElementById('out-'+k)
    if(el)el.style.display=k===id?'block':'none'
  })
}

/* ── FEED TABS ──────────────────────────────────────── */
function switchFeed(btn,type){
  document.querySelectorAll('#view-knowledge .feed-tab').forEach(t=>t.classList.remove('active'))
  btn.classList.add('active')
  filterFeed('#mkt-feed-grid','data-type',type)
}
function switchFeed2(btn,type){
  document.querySelectorAll('#view-db-knowledge .feed-tab').forEach(t=>t.classList.remove('active'))
  btn.classList.add('active')
  filterFeed('#db-feed-grid','data-type2',type)
}
function filterFeed(gridSel,attr,type){
  document.querySelectorAll(gridSel+' .feed-card').forEach(c=>{
    const show=type==='all'||c.getAttribute(attr)===type
    c.style.opacity='0'
    c.style.display=show?'flex':'none'
    if(show)setTimeout(()=>{c.style.transition='opacity .35s ease';c.style.opacity='1'},20)
  })
}

/* ── PRICING TOGGLE ─────────────────────────────────── */
var annual=false
var pp={pro:[29,23],max:[59,47],agency:[149,119]}
function togglePrice(){
  annual=!annual
  document.getElementById('priceToggle').classList.toggle('on',annual)
  const fmt=p=>`<sup>$</sup>${Number.isInteger(p)?p:p.toFixed(2)}<span class="mo">/mo</span>`
  var freeEl=document.getElementById('ps-free')
  if(freeEl)freeEl.innerHTML='<sup>$</sup>0<span class="mo">/mo</span>'
  var proEl=document.getElementById('ps-pro')
  if(proEl)proEl.innerHTML=fmt(annual?pp.pro[1]:pp.pro[0])
  var maxEl=document.getElementById('ps-max')
  if(maxEl)maxEl.innerHTML=fmt(annual?pp.max[1]:pp.max[0])
  var agencyEl=document.getElementById('ps-agency')
  if(agencyEl)agencyEl.innerHTML=fmt(annual?pp.agency[1]:pp.agency[0])
}

/* ── MEETING ROOM ───────────────────────────────────── */
function openMeeting(name,role,init){
  document.getElementById('mr-name').textContent=name
  document.getElementById('mr-role').textContent=role
  document.getElementById('mr-init').textContent=init
  document.getElementById('meeting-room').classList.add('active')
  document.getElementById('mr-input-field').focus()
}
function closeMeeting(){
  document.getElementById('meeting-room').classList.remove('active')
}
function mrSend(e){if(e.key==='Enter')mrSendBtn()}
function mrSendBtn(){
  const inp=document.getElementById('mr-input-field')
  const val=inp.value.trim()
  if(!val)return
  const msgs=document.getElementById('mr-msgs')
  const div=document.createElement('div')
  div.className='mr-msg user'
  div.innerHTML='<div class="mr-bubble">'+escAttr(val)+'</div>'
  msgs.appendChild(div)
  inp.value=''
  msgs.scrollTop=msgs.scrollHeight
  // Simulated response
  setTimeout(()=>{
    const r=document.createElement('div')
    r.className='mr-msg'
    r.innerHTML='<div class="mr-bubble">"Noted. Let me think about that angle and come back to you with three variations that hit that direction without going too far. Give me a few minutes."</div>'
    msgs.appendChild(r)
    msgs.scrollTop=msgs.scrollHeight
  },1200)
}

/* ── SETTINGS ───────────────────────────────────────── */
function switchSettings(btn,panel){
  document.querySelectorAll('.settings-nav-item').forEach(b=>b.classList.remove('active'))
  document.querySelectorAll('.settings-panel').forEach(p=>p.classList.remove('active'))
  btn.classList.add('active')
  const panelEl=document.getElementById('settings-'+panel)
  if(panelEl) panelEl.classList.add('active')
}

/* ── CALENDAR ENGINE ─────────────────────────────────── */

// Calendar state
var calViewMode = 'month' // 'month' | 'week'
// Always open on the current month — the demo entries are dated to Jan 2025
// so they only render when the user navigates there, but the CEO should
// land on a calendar that reflects today.
var calDate = new Date()

// Data model — each entry has: date(YYYY-MM-DD), type, title, who, status
// Starts empty — populated by calendar-wire.js from real task data.
var calEntries = []

var MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December']
var DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

function fmtDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth()+1).padStart(2,'0')
  const day = String(d.getDate()).padStart(2,'0')
  return `${y}-${m}-${day}`
}

function isToday(dateStr) {
  return dateStr === fmtDate(new Date())
}

function renderCalendar() {
  if (calViewMode === 'month') renderMonth()
  else renderWeek()
  document.getElementById('cal-month-label').textContent =
    MONTH_NAMES[calDate.getMonth()] + ' ' + calDate.getFullYear()
}

function renderMonth() {
  const grid = document.getElementById('cal-grid')
  grid.innerHTML = ''

  // Headers
  DAY_NAMES.forEach(d => {
    const h = document.createElement('div')
    h.className = 'cal-month-header'
    h.textContent = d
    grid.appendChild(h)
  })

  const year = calDate.getFullYear()
  const month = calDate.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month+1, 0).getDate()
  const daysInPrev  = new Date(year, month, 0).getDate()

  // Total cells: fill to complete weeks
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7

  for (let i = 0; i < totalCells; i++) {
    const cell = document.createElement('div')
    cell.className = 'cal-day'

    let dateObj, dateStr, isOther = false

    if (i < firstDay) {
      dateObj = new Date(year, month-1, daysInPrev - firstDay + i + 1)
      isOther = true
    } else if (i >= firstDay + daysInMonth) {
      dateObj = new Date(year, month+1, i - firstDay - daysInMonth + 1)
      isOther = true
    } else {
      dateObj = new Date(year, month, i - firstDay + 1)
    }

    dateStr = fmtDate(dateObj)
    if (isOther) cell.classList.add('other-month')
    if (isToday(dateStr)) cell.classList.add('today')

    // Day number
    const numDiv = document.createElement('div')
    numDiv.className = 'cal-day-num'
    numDiv.innerHTML = dateObj.getDate() +
      (isToday(dateStr) ? '<span class="today-dot"></span>' : '')
    cell.appendChild(numDiv)

    // Entries for this date — show max 3, overflow as "+N more"
    const dayEntries = calEntries.filter(e => e.date === dateStr)
    const MAX_VISIBLE = 3
    const visible = dayEntries.slice(0, MAX_VISIBLE)
    visible.forEach(entry => {
      const el = document.createElement('div')
      el.className = `cal-entry ${entry.who}`
      el.innerHTML = `
        <span class="cal-entry-type">${entry.type}</span>
        <span class="cal-entry-title">${entry.title}
          <span class="cal-entry-status ${`status-${entry.status}`}"></span>
        </span>
        <span class="cal-entry-who">${entry.label}</span>
        <div class="cal-entry-actions">
          ${entry.status==='planned'?`<button class="cal-entry-action-btn approve" onclick="approveEntry('${escAttr(entry.id)}',event)">Approve</button>`:''}
          <button class="cal-entry-action-btn" onclick="meetingFromEntry('${escAttr(entry.who)}',event)">Meeting</button>
          <button class="cal-entry-action-btn" onclick="reassignEntry('${escAttr(entry.id)}',event)">Reassign</button>
        </div>`
      cell.appendChild(el)
    })
    if (dayEntries.length > MAX_VISIBLE) {
      const more = document.createElement('div')
      more.className = 'cal-entry-overflow'
      more.textContent = '+' + (dayEntries.length - MAX_VISIBLE) + ' more'
      more.style.cssText = 'font-size:10px;color:var(--t2);padding:2px 6px;cursor:pointer;letter-spacing:.04em'
      cell.appendChild(more)
    }

    grid.appendChild(cell)
  }
}

function renderWeek() {
  const grid = document.getElementById('cal-week-grid')
  grid.innerHTML = ''

  // Find Monday of current week
  const d = new Date(calDate)
  const day = d.getDay()
  const monday = new Date(d)
  monday.setDate(d.getDate() - (day===0?6:day-1))

  const weekDays = []
  for (let i=0;i<7;i++) {
    const wd = new Date(monday)
    wd.setDate(monday.getDate()+i)
    weekDays.push(wd)
  }

  // Corner empty cell
  const corner = document.createElement('div')
  corner.className = 'cal-week-time-col'
  corner.style.cssText = 'background:var(--s2);border-right:1px solid var(--b1);border-bottom:1px solid var(--b1);padding:10px 8px'
  grid.appendChild(corner)

  // Day headers
  weekDays.forEach(wd => {
    const h = document.createElement('div')
    h.className = 'cal-week-day-header'
    const todayClass = isToday(fmtDate(wd)) ? ' today' : ''
    h.innerHTML = `<div class="cal-week-day-name">${DAY_NAMES[wd.getDay()]}</div>
                   <div class="cal-week-day-num${todayClass}">${wd.getDate()}</div>`
    grid.appendChild(h)
  })

  // Time slots: 8am – 8pm
  const hours = ['8 AM','9 AM','10 AM','11 AM','12 PM','1 PM','2 PM',
                  '3 PM','4 PM','5 PM','6 PM','7 PM','8 PM']

  hours.forEach((hr, hi) => {
    // Time label
    const timeLabel = document.createElement('div')
    timeLabel.className = 'cal-week-time-label'
    timeLabel.textContent = hr
    grid.appendChild(timeLabel)

    // Day slots
    weekDays.forEach(wd => {
      const slot = document.createElement('div')
      slot.className = 'cal-week-slot'
      const dateStr = fmtDate(wd)

      // Show entries in morning slots (8–12 for planning, 12–4 for production)
      const slotEntries = calEntries.filter(e => {
        if (e.date !== dateStr) return false
        if (e.who === 'jordan' && hi === 0) return true
        if (e.who === 'maya'   && hi === 1) return true
        if (e.who === 'riley'  && hi === 5) return true
        return false
      })

      slotEntries.forEach(entry => {
        const el = document.createElement('div')
        el.className = `cal-week-entry ${entry.who}`
        el.innerHTML = `<span style="font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--t3)">${entry.type}</span>
                        <span style="font-size:11px;color:var(--t1);display:block;margin-top:2px">${entry.title}</span>`
        slot.appendChild(el)
      })

      grid.appendChild(slot)
    })
  })
}

function calNav(dir) {
  if (calViewMode === 'month') {
    calDate = new Date(calDate.getFullYear(), calDate.getMonth()+dir, 1)
  } else {
    calDate.setDate(calDate.getDate() + dir*7)
  }
  renderCalendar()
}

function calGoToday() {
  calDate = new Date()
  renderCalendar()
}

function switchCalView(mode) {
  calViewMode = mode
  document.getElementById('cal-month-view').style.display = mode==='month'?'block':'none'
  document.getElementById('cal-week-view').style.display  = mode==='week'?'block':'none'
  document.getElementById('cal-month-btn').classList.toggle('active', mode==='month')
  document.getElementById('cal-week-btn').classList.toggle('active', mode==='week')
  renderCalendar()
}

function switchTasksView(mode) {
  document.getElementById('tasks-list-view').style.display = mode==='list'?'block':'none'
  document.getElementById('tasks-cal-view').style.display  = mode==='calendar'?'block':'none'
  document.getElementById('tasks-list-btn').classList.toggle('active', mode==='list')
  document.getElementById('tasks-cal-btn').classList.toggle('active', mode==='calendar')
  if (mode==='calendar') renderCalendar()
}

/* ── ENTRY ACTIONS ──────────────────────────────────── */
function approveEntry(id, e) {
  if(e){e.stopPropagation()}
  const entry = calEntries.find(x=>x.id===id)
  if (!entry) return
  entry.status = 'approved'
  renderCalendar()

  // Trigger Riley to add a production brief on the same date — Jordan's
  // plan now hands directly to Riley (Alex was retired from the team).
  if (entry.who === 'jordan' && entry.type === 'Reel') {
    setTimeout(() => {
      const rileyEntry = {
        id: 're'+Date.now(),
        date: entry.date,
        type: 'Brief',
        title: 'Production brief — '+entry.title,
        who: 'riley',
        status: 'planned',
        label: 'Riley'
      }
      calEntries.push(rileyEntry)
      renderCalendar()
      showToast('R','Riley','Creative Director',
        `"Plan approved — I'm shaping the production direction for the ${entry.title} Reel now. Shot list and pacing on the way."`,
        rileyEntry.id)
    }, 1800)
  }
}

function meetingFromEntry(who, e) {
  if(e){e.stopPropagation()}
  const names = {jordan:['Jordan','Content Strategist','J'],
                 maya:  ['Maya','Trend Analyst','M'],
                 riley: ['Riley','Creative Director','R']}
  const n = names[who]||['Jordan','Strategist','J']
  openMeeting(n[0], n[1], n[2])
}

function reassignEntry(id, e) {
  if(e){e.stopPropagation()}
  const entry = calEntries.find(x=>x.id===id)
  if(entry) {
    entry.status = 'planned'
    renderCalendar()
  }
}

/* ── PLAN APPROVAL (from list view) ─────────────────── */
function approveCalendarPlan() {
  // Update all Jordan planned entries to approved
  calEntries.forEach(e => {
    if(e.who==='jordan' && e.status==='planned') e.status='approved'
  })

  // Riley picks up directly from Jordan's approved plan and adds shoot
  // and brief entries (Alex was retired from the team).
  const brief1 = {id:'brief1', date:'2025-01-13', type:'Brief',  title:'Production brief — weighted walking', who:'riley', status:'planned', label:'Riley'}
  const brief2 = {id:'brief2', date:'2025-01-16', type:'Brief',  title:'Production brief — cycle syncing',     who:'riley', status:'planned', label:'Riley'}
  const prod1  = {id:'prod1',  date:'2025-01-13', type:'Shoot',  title:'Production day — Reel 01',             who:'riley', status:'planned', label:'Riley'}
  calEntries.push(brief1, brief2, prod1)

  // Switch to calendar to show the update
  switchTasksView('calendar')
  setTimeout(()=>{
    showToast('R','Riley','Creative Director',
      '"Jordan\'s plan is approved — I\'ve added briefs and a shoot day. Shot list for the weighted walking Reel coming next."',
      'brief1')
  }, 800)

  setTimeout(()=>{
    showToast('R','Riley','Creative Director',
      '"I\'ve marked Monday as a production day and I\'m preparing the shot list for the weighted walking Reel. Will have it ready before the shoot."',
      'prod1')
  }, 4500)
}

/* ── AGENT TOAST ────────────────────────────────────── */
var toastTimer = null
var toastEntryId = null

function showToast(init, name, role, msg, entryId) {
  toastEntryId = entryId
  document.getElementById('toast-init').textContent = init
  document.getElementById('toast-name').textContent = name + ' — ' + role
  document.getElementById('toast-msg').textContent  = msg

  const toast = document.getElementById('cal-toast')
  toast.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(hideToast, 9000)
}

function hideToast() {
  document.getElementById('cal-toast').classList.remove('show')
}

function toastApprove() {
  if (toastEntryId) approveEntry(toastEntryId, null)
  hideToast()
}

/* ── INIT CALENDAR ON TASKS VIEW ─────────────────────── */
function goToTasks() {
  navigate('db-tasks')
  setTimeout(() => {
    renderCalendar()
  }, 320)
}


/* ── INSIGHTS CHARTS ─────────────────────────────────── */

var insightsData = {
  '7d': {
    followers:'12.4K', followersDelta:'+210 this period',
    reach:'6,840', reachDelta:'+8% vs prior',
    eng:'5.1%', engDelta:'+1.2pp vs prior',
    saves:'580', savesDelta:'+22% vs prior',
    engagement:[2.8,3.1,5.4,2.2,4.8,1.4,2.6],
    saves_by_type:[180,240,90,70],
  },
  '30d': {
    followers:'12.4K', followersDelta:'+847 this period',
    reach:'8,320', reachDelta:'+12% vs prior',
    eng:'4.7%', engDelta:'+0.8pp vs prior',
    saves:'2,140', savesDelta:'+34% vs prior',
    engagement:[3.2,4.8,5.6,4.1,5.2,2.0,3.4],
    saves_by_type:[820,680,380,260],
  },
  '90d': {
    followers:'12.4K', followersDelta:'+2,310 this period',
    reach:'7,100', reachDelta:'+28% vs prior',
    eng:'4.2%', engDelta:'+1.6pp vs prior',
    saves:'5,890', savesDelta:'+61% vs prior',
    engagement:[2.9,4.2,5.0,3.8,4.6,2.4,3.1],
    saves_by_type:[2200,1840,1080,770],
  }
}

var dayLabels  = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
var saveLabels = ['Transform.','Education','Motivation','BTS']
var currentPeriod = '30d'

function switchPeriod(btn, period) {
  document.querySelectorAll('.ins-period-btn').forEach(b=>b.classList.remove('active'))
  btn.classList.add('active')
  currentPeriod = period
  updateKPIs(period)
  renderBarCharts(period)
}

function updateKPIs(period) {
  const d = insightsData[period]
  const safe = (id, val) => { const el=document.getElementById(id); if(el) el.textContent=val }
  safe('kpi-followers',   d.followers)
  safe('kpi-followers-d', d.followersDelta)
  safe('kpi-reach',       d.reach)
  safe('kpi-reach-d',     d.reachDelta)
  safe('kpi-eng',         d.eng)
  safe('kpi-eng-d',       d.engDelta)
  safe('kpi-saves',       d.saves)
  safe('kpi-saves-d',     d.savesDelta)
}

function renderBarChart(containerId, values, labels, maxVal) {
  const container = document.getElementById(containerId)
  if (!container) return
  container.innerHTML = ''
  const peak = Math.max(...values)
  values.forEach((val, i) => {
    const pct = maxVal > 0 ? val/maxVal : 0
    const heightPx = Math.max(4, Math.round(pct * 72))
    const isTop = val === peak
    const wrap = document.createElement('div')
    wrap.className = 'bar-wrap'
    const bar = document.createElement('div')
    bar.className = 'bar' + (isTop ? ' top' : pct > 0.7 ? ' highlight' : '')
    bar.style.cssText = `height:${heightPx}px;opacity:0;transform:scaleY(0);transform-origin:bottom;transition:opacity .4s ${i*60}ms ease,transform .5s ${i*60}ms cubic-bezier(.16,1,.3,1)`
    setTimeout(()=>{ bar.style.opacity='1'; bar.style.transform='scaleY(1)' }, 80)
    const lbl = document.createElement('div')
    lbl.className = 'bar-lbl'
    lbl.textContent = labels[i]
    wrap.appendChild(bar)
    wrap.appendChild(lbl)
    container.appendChild(wrap)
  })
}

function renderBarCharts(period) {
  const d = insightsData[period]
  renderBarChart('bar-engagement', d.engagement, dayLabels, Math.max(...d.engagement))
  renderBarChart('bar-saves', d.saves_by_type, saveLabels, Math.max(...d.saves_by_type))
}

function initInsights() {
  updateKPIs(currentPeriod)
  renderBarCharts(currentPeriod)
}

// Hook into enterDashboard to init charts
// (called at end of enterDashboard function below)

document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    closeMeeting()
    document.getElementById('onboarding')?.classList.remove('active')
  }
})

// Sidebar logo: welcome when logged out; auth-ui replaces with /api/auth/me.
window.navigateSovexaLogo = function () {
  if (typeof isLoggedIn !== 'undefined' && isLoggedIn) navigate('db-dashboard')
  else navigate('home')
}

// Expose calendar state so companion scripts (idea-wire.js) can read
// calDate (current visible month) and push into calEntries when the CEO
// adds an idea. `var` at the top level already publishes both bindings
// on window, and calNav()'s `calDate = new Date(...)` flows through —
// so no defineProperty needed. The earlier getter approach tripped the
// "Cannot redefine property" error on HMR re-eval because `var` pins the
// property as non-configurable.

/* ── Shared escape helper ──────────────────────────── */
function escAttr(s) { return String(s || '').replace(/[&<>"'\\]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '\\': '&#92;' })[c] || c }) }

/* ── BRIEF SYSTEM EVENT HANDLERS ────────────────────── */

window.briefState = {
  currentBrief: 'morning-briefs',
  tasks: {},
  loading: false,
}

window.briefEvent = async function (action, context) {
  console.log(`[brief] ${action} on ${context}`)
  var cid = window.__vxCompany?.id || ''
  var q = cid ? '?companyId=' + encodeURIComponent(cid) : ''
  try {
    switch (action) {
      case 'approve-plan':
        try {
          var planRes = await fetch('/api/weekly/plan/approve' + q, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
          })
          var planData = await planRes.json().catch(function () { return {} })
          // Only claim "X picked up the next step" when the backend's chain
          // actually fired; otherwise show whatever honest reason the API
          // returned. Hard-coded "Plan approved — preference saved" wasn't
          // checking and was repeating a happy-path lie.
          if (typeof window.showNotification === 'function') {
            if (planRes.ok && planData && planData.chain && planData.chain.ok && planData.chain.nextEmployeeName) {
              window.showNotification('Plan approved · ' + planData.chain.nextEmployeeName + ' picked up the next step', 'success')
            } else if (planRes.ok) {
              window.showNotification(planData && planData.message ? planData.message : 'Plan approved', 'success')
            } else {
              window.showNotification('Plan approved, but the next step couldn\'t start. Try again in a moment.', 'error')
            }
          }
        } catch (_) {
          if (typeof window.showNotification === 'function') window.showNotification('Couldn\'t approve the plan. Check your connection and try again.', 'error')
        }
        if (typeof window.refreshBriefs === 'function') window.refreshBriefs()
        break
      case 'reject-plan':
        await fetch('/api/weekly/plan/reject' + q, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'User requested rethink' }),
        })
        if (typeof window.showNotification === 'function') window.showNotification('Rejected — feedback saved, Jordan is rethinking', 'info')
        if (typeof window.refreshBriefs === 'function') window.refreshBriefs()
        break
      case 'approve-trend':
        await fetch('/api/briefs/approve-trend' + q, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trend: context }),
        })
        if (typeof window.showNotification === 'function') window.showNotification('Jordan briefed on trend', 'success')
        break
      case 'dismiss':
        window.dismissBrief(context)
        break
    }
  } catch (err) {
    console.error('[brief] event error:', err)
    if (typeof window.showNotification === 'function') window.showNotification('Something went wrong', 'error')
  }
}

window.navigateTo = function (brief) {
  if (brief === 'weekly-briefs') {
    if (typeof window.navigate === 'function') window.navigate('db-studio')
    return
  }

  var cid = window.__vxCompany?.id || ''
  if (!cid) return

  var endpointMap = {
    'weekly-plan': '/api/weekly/jordan-plan',
    'weekly-pulse': '/api/weekly/maya-pulse',
    // weekly-hooks (Alex) retired
    'trends': '/api/briefs/morning',
    'evening-recap': '/api/briefs/evening',
  }
  var titleMap = {
    'weekly-plan': "Jordan's Content Plan",
    'weekly-pulse': "Maya's Weekly Pulse",
    'trends': 'Morning Brief',
    'evening-recap': 'Evening Recap',
  }

  var url = endpointMap[brief]
  if (!url) return

  // Show loading modal
  var overlay = document.createElement('div')
  overlay.id = 'vx-brief-modal'
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)'
  overlay.innerHTML = '<div style="width:100%;max-width:560px;max-height:80vh;overflow-y:auto;background:var(--s1);border:1px solid var(--b1);border-radius:12px;padding:28px 28px 22px">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">' +
      '<h2 style="font-family:Syne,sans-serif;font-size:18px;font-weight:600;color:var(--t1);margin:0">' + (titleMap[brief] || brief) + '</h2>' +
      '<button id="vx-brief-close" style="background:transparent;border:1px solid var(--b2);color:var(--t2);width:28px;height:28px;border-radius:6px;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center">&times;</button>' +
    '</div>' +
    '<div id="vx-brief-body" style="color:var(--t2);font-size:13px;line-height:1.6">Loading...</div>' +
  '</div>'
  document.body.appendChild(overlay)

  overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove() })
  document.getElementById('vx-brief-close').addEventListener('click', function () { overlay.remove() })
  document.addEventListener('keydown', function onEsc(e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc) } })

  fetch(url + '?companyId=' + encodeURIComponent(cid), { credentials: 'include' })
    .then(function (r) { return r.ok ? r.json() : null })
    .then(function (data) {
      var bodyEl = document.getElementById('vx-brief-body')
      if (!bodyEl) return
      if (!data) { bodyEl.textContent = 'Nothing here yet — check back soon.'; return }

      var html = formatBriefOutput(data.output || data, brief)

      if (brief !== 'trends' && data.employee) {
        html = '<div style="font-family:\'DM Sans\',sans-serif;font-size:11px;color:' + C.t3 + ';margin-bottom:12px">From ' + esc(data.employee) + ' · ' + (data.createdAt ? new Date(data.createdAt).toLocaleDateString() : '') + '</div>' + html
      }

      bodyEl.innerHTML = html
    })
    .catch(function () {
      var bodyEl = document.getElementById('vx-brief-body')
      if (bodyEl) bodyEl.textContent = 'We couldn\'t load this brief. Try again in a moment.'
    })

  function esc(s) { return String(s || '').replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] }) }

  function formatBriefOutput(o, type) {
    if (type === 'trends') return formatMorningBrief(o)
    if (type === 'weekly-pulse') return formatMayaPulse(o)
    // Jordan's weekly content plan has a known JSON shape (weekOf, pillars,
    // posts, strategyNote, audienceFocus). The generic walker rendered it
    // as auto-uppercased "WEEK OF / PILLARS / STRATEGY NOTE / AUDIENCE
    // FOCUS" with the strategy note as one wall of text. The dedicated
    // formatter below reads cleaner and uses plain-language headings.
    if (type === 'weekly-plan' || (o && (o.audienceFocus || o.strategyNote || o.pillars))) {
      return formatJordanContentPlan(o)
    }
    return formatGenericBrief(o)
  }

  // Plain-language layout for Jordan's content plan. Splits the strategy
  // note into per-pillar bullets when Jordan still numbers them (legacy
  // outputs from before the simpler-language prompt update); otherwise
  // shows the note as a single short paragraph.
  function formatJordanContentPlan(o) {
    if (!o) return '<div style="color:var(--t3)">No plan to show yet.</div>'
    var parts = []

    // Header — week + audience + a single-sentence strategy summary.
    // Anything longer than one sentence is noise: the pillars and the
    // per-day calendar already say everything else. Truncate aggressively.
    var weekLabel = ''
    if (o.weekOf) {
      try {
        weekLabel = 'Week of ' + new Date(o.weekOf + 'T12:00:00')
          .toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      } catch (_) { weekLabel = 'Week of ' + o.weekOf }
    }
    var headline = oneSentence(o.strategyNote, 22) // primary "what we're doing" line
    if (weekLabel || o.audienceFocus || headline) {
      parts.push(
        '<div style="padding-bottom:14px;border-bottom:1px solid var(--b1);margin-bottom:18px">'
        + (weekLabel ? '<div style="font-family:\'Cormorant Garamond\',serif;font-size:22px;font-weight:400;color:var(--t1);margin-bottom:6px">' + esc(weekLabel) + '</div>' : '')
        + (headline ? '<div style="font-size:13px;color:var(--t1);line-height:1.5;margin-bottom:6px">' + esc(headline) + '</div>' : '')
        + (o.audienceFocus ? '<div style="font-size:12px;color:var(--t3);line-height:1.5">For ' + esc(o.audienceFocus) + '</div>' : '')
        + '</div>'
      )
    }

    // Three things we’re posting (was "Pillars" — same data, friendlier label)
    if (Array.isArray(o.pillars) && o.pillars.length) {
      var pillarRows = o.pillars.map(function (p) {
        return '<div style="padding:8px 0 8px 12px;border-left:2px solid var(--accent);margin-bottom:6px;font-size:13px;color:var(--t1)">'
          + esc(typeof p === 'string' ? p : (p.name || p.title || ''))
          + '</div>'
      }).join('')
      parts.push(sec3('What we’re posting about'))
      parts.push('<div style="margin-bottom:18px">' + pillarRows + '</div>')
    }

    // The 7-day calendar (if present) — small day rows
    if (Array.isArray(o.posts) && o.posts.length) {
      parts.push(sec3('This week’s posts'))
      var rows = o.posts.slice(0, 7).map(function (p) {
        var fmt = p.format ? '<span style="font-family:\'JetBrains Mono\',monospace;font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:var(--t3);border:1px solid var(--b1);padding:2px 6px;border-radius:3px;margin-right:8px">' + esc(p.format) + '</span>' : ''
        return '<div style="padding:8px 0;border-bottom:1px dashed var(--b1)">'
          + '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:2px">'
          + '<span style="font-size:12px;font-weight:500;color:var(--t1)">' + esc(p.day || '') + '</span>'
          + fmt
          + '</div>'
          + '<div style="font-size:12px;color:var(--t2);line-height:1.5">' + esc(p.topic || p.title || '') + '</div>'
          + (p.angle ? '<div style="font-size:11px;color:var(--t3);margin-top:2px;line-height:1.45">' + esc(p.angle) + '</div>' : '')
          + '</div>'
      }).join('')
      parts.push('<div style="margin-bottom:8px">' + rows + '</div>')
    }

    return parts.join('') || '<div style="color:var(--t3)">No plan details available.</div>'
  }
  // Section heading — small caps, accent-coloured, used by formatJordanContentPlan.
  function sec3(label) {
    return '<div style="font-family:\'DM Sans\',Inter,sans-serif;font-weight:600;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--t1);margin-bottom:10px">' + esc(label) + '</div>'
  }
  // Reduce a long strategy note to a single short sentence. Drops everything
  // after the first numbered list item (legacy Jordan output format) and any
  // trailing "By mixing up the formats..." closer. Hard cap on word count
  // because Jordan's first sentence is sometimes itself overlong.
  function oneSentence(raw, maxWords) {
    if (!raw) return ''
    var s = String(raw).trim()
    // Cut at the start of a numbered pillar block ("1. X -")
    var numberedAt = s.search(/[:\s]\s*1\.\s+[A-Z]/)
    if (numberedAt > 0) s = s.slice(0, numberedAt)
    // Drop trailing colons / dashes left over after the cut
    s = s.replace(/[:—\-\s]+$/, '').trim()
    // Take up to the first sentence terminator
    var firstStop = s.search(/[.!?](\s|$)/)
    if (firstStop > 0) s = s.slice(0, firstStop + 1)
    // Word-cap belt-and-braces
    var words = s.split(/\s+/)
    var max = maxWords || 22
    if (words.length > max) s = words.slice(0, max).join(' ').replace(/[,\s]+$/, '') + '…'
    return s
  }

  function formatMorningBrief(data) {
    var parts = []
    var at = data.accountTrends || {}

    // ── Metric trend cards ─────────────────────────────────────────────
    var metrics = at.metrics || []
    if (at.hasData && metrics.length > 0) {
      parts.push(
        '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px">'
          + '<div style="font-family:Inter,sans-serif;font-weight:500;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:' + C.t3 + '">' + esc(at.weekLabel || 'This week') + '</div>'
          + (at.engagementTrend && at.engagementTrend !== 'stable'
            ? '<div style="font-size:11px;color:' + (at.engagementTrend === 'improving' ? '#4caf50' : '#e06060') + ';font-family:\'JetBrains Mono\',monospace">'
                + (at.engagementTrend === 'improving' ? '↑ ' : '↓ ') + at.engagementTrend
              + '</div>'
            : '')
        + '</div>'
      )

      var grid = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">'
      metrics.forEach(function (m) {
        var up = m.direction === 'up'
        var dn = m.direction === 'down'
        var dirColor = up ? '#4caf50' : dn ? '#e06060' : C.t3
        var arrow = up ? '↑' : dn ? '↓' : '→'
        var valStr = m.format === 'percent' ? m.value + '%' : fmtNum(m.value)
        var deltaStr = m.deltaPct != null ? arrow + ' ' + Math.abs(m.deltaPct) + '% vs prior' : (m.prior == null ? 'no prior' : arrow)
        grid += '<div style="background:rgba(20,16,10,.04);border:1px solid rgba(20,16,10,.08);border-radius:8px;padding:12px">'
          + '<div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:' + C.t3 + ';margin-bottom:5px">' + esc(m.label) + '</div>'
          + '<div style="font-family:\'JetBrains Mono\',monospace;font-size:20px;font-weight:600;color:' + C.t1 + ';line-height:1">' + esc(valStr) + '</div>'
          + '<div style="font-size:11px;color:' + dirColor + ';margin-top:5px;font-family:\'JetBrains Mono\',monospace">' + deltaStr + '</div>'
          + '</div>'
      })
      grid += '</div>'
      parts.push(grid)

      if (at.bestFormat || at.bestDay) {
        var tips = []
        if (at.bestFormat) tips.push(at.bestFormat.toLowerCase() + 's perform best')
        if (at.bestDay) tips.push(at.bestDay + 's are your top day')
        parts.push(
          '<div style="background:rgba(192,138,62,.07);border-left:3px solid ' + C.accent + ';border-radius:0 6px 6px 0;padding:8px 12px;margin-bottom:16px;font-size:12px;color:' + C.t2 + '">'
            + tips.join(' · ')
          + '</div>'
        )
      }
    } else {
      parts.push(
        '<div style="padding:12px 0 16px;font-size:13px;color:' + C.t3 + ';font-style:italic">'
          + 'No trend data yet — post some content and sync your account to see performance trends here.'
        + '</div>'
      )
    }

    // ── Yesterday's posts ──────────────────────────────────────────────
    var yp = data.yesterdayPosts || []
    if (yp.length > 0) {
      parts.push(
        '<div style="font-family:Inter,sans-serif;font-weight:500;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:' + C.t3 + ';margin:4px 0 8px">'
          + 'Yesterday (' + yp.length + ' post' + (yp.length !== 1 ? 's' : '') + ')'
        + '</div>'
      )
      yp.forEach(function (p) {
        var eng = (p.metrics || {}).engagement || 0
        var er  = (p.metrics || {}).engagementRate || 0
        var reach = (p.metrics || {}).reach || 0
        parts.push(
          '<div style="padding:8px 0;border-bottom:1px solid rgba(20,16,10,.07);line-height:1.4">'
            + '<div style="font-size:13px;color:' + C.t1 + ';margin-bottom:4px">' + esc((p.caption || 'No caption').substring(0, 80)) + '</div>'
            + '<div style="display:flex;gap:12px;flex-wrap:wrap">'
              + '<span style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:' + C.t3 + '">' + fmtNum(reach) + ' reach</span>'
              + '<span style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:' + C.t3 + '">' + fmtNum(eng) + ' eng</span>'
              + (er ? '<span style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:' + C.t3 + '">' + (er * 100).toFixed(1) + '%</span>' : '')
            + '</div>'
          + '</div>'
        )
      })
      parts.push('<div style="margin-bottom:8px"></div>')
    }

    // ── Queue ──────────────────────────────────────────────────────────
    var q = data.queuedPosts || []
    if (q.length > 0) {
      parts.push(
        '<div style="font-family:Inter,sans-serif;font-weight:500;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:' + C.t3 + ';margin:4px 0 8px">'
          + 'In queue (' + q.length + ')'
        + '</div>'
      )
      q.forEach(function (p) {
        var ready = p.status === 'ready'
        parts.push(
          '<div style="padding:6px 0;border-bottom:1px solid rgba(20,16,10,.07);display:flex;justify-content:space-between;align-items:center">'
            + '<div style="font-size:13px;color:' + C.t2 + '">' + esc((p.caption || 'Untitled').substring(0, 60)) + '</div>'
            + '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:' + (ready ? '#4caf50' : C.accent) + '">' + (ready ? 'ready' : 'in production') + '</div>'
          + '</div>'
        )
      })
    }

    return parts.join('') || '<div style="color:' + C.t3 + ';font-style:italic">Nothing to report yet.</div>'
  }

  function formatMayaPulse(o) {
    var parts = []

    // ── Header stat row ────────────────────────────────────────────────────
    var dir = (o.trajectory || {}).direction || 'flat'
    var arrow = dir === 'up' ? '↑' : dir === 'down' ? '↓' : '→'
    var arrowColor = dir === 'up' ? '#4caf50' : dir === 'down' ? '#e06060' : C.t3
    var postsLabel = o.postsThisWeek === 1 ? '1 post' : (o.postsThisWeek || 0) + ' posts'
    var weekLabel = o.weekOf ? 'Week of ' + new Date(o.weekOf + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''

    parts.push(
      '<div style="display:flex;gap:16px;padding:12px 0 16px;border-bottom:1px solid rgba(20,16,10,.10);margin-bottom:4px">'
        + '<div style="flex:1;text-align:center">'
          + '<div style="font-family:\'JetBrains Mono\',monospace;font-size:22px;font-weight:600;color:' + arrowColor + '">' + arrow + '</div>'
          + '<div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:' + C.t3 + ';margin-top:2px">' + dir + '</div>'
        + '</div>'
        + '<div style="flex:1;text-align:center">'
          + '<div style="font-family:\'JetBrains Mono\',monospace;font-size:22px;font-weight:600;color:' + C.t1 + '">' + (o.postsThisWeek || 0) + '</div>'
          + '<div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:' + C.t3 + ';margin-top:2px">posts</div>'
        + '</div>'
        + (weekLabel ? '<div style="flex:2;display:flex;align-items:center;justify-content:flex-end"><div style="font-size:11px;color:' + C.t3 + ';font-style:italic">' + esc(weekLabel) + '</div></div>' : '')
      + '</div>'
    )

    // ── Trajectory summary ─────────────────────────────────────────────────
    if (o.trajectory && o.trajectory.summary) {
      parts.push(
        '<div style="padding:10px 0 14px;border-bottom:1px solid rgba(20,16,10,.07);margin-bottom:4px">'
          + '<div style="font-size:13px;color:' + C.t2 + ';line-height:1.55">' + esc(o.trajectory.summary) + '</div>'
        + '</div>'
      )
    }

    // ── Win of the week ───────────────────────────────────────────────────
    if (o.winOfTheWeek) {
      var w = o.winOfTheWeek
      parts.push(sec('Win of the week'))
      parts.push(
        '<div style="background:rgba(76,175,80,.06);border:1px solid rgba(76,175,80,.18);border-radius:8px;padding:12px 14px;margin-bottom:16px">'
          + (w.videoTitle ? '<div style="font-size:13px;font-weight:500;color:' + C.t1 + ';margin-bottom:6px">' + esc(w.videoTitle) + '</div>' : '')
          + '<div style="display:flex;gap:16px;margin-bottom:8px">'
            + (w.viewCount != null ? '<div style="font-family:\'JetBrains Mono\',monospace;font-size:12px;color:#4caf50">' + fmtNum(w.viewCount) + ' views</div>' : '')
            + (w.engagementScore != null ? '<div style="font-family:\'JetBrains Mono\',monospace;font-size:12px;color:' + C.t3 + '">' + fmtNum(w.engagementScore) + ' eng</div>' : '')
          + '</div>'
          + (w.whyItWorked ? '<div style="font-size:12px;color:' + C.t2 + ';line-height:1.5">' + esc(w.whyItWorked) + '</div>' : '')
          + (w.url ? '<a href="' + esc(w.url) + '" target="_blank" rel="noopener" style="display:inline-block;margin-top:8px;font-size:11px;color:' + C.accent + ';text-decoration:none">View post ↗</a>' : '')
        + '</div>'
      )
    }

    // ── Miss of the week ──────────────────────────────────────────────────
    if (o.missOfTheWeek) {
      var m = o.missOfTheWeek
      parts.push(sec('Miss of the week'))
      parts.push(
        '<div style="background:rgba(224,96,96,.05);border:1px solid rgba(224,96,96,.15);border-radius:8px;padding:12px 14px;margin-bottom:16px">'
          + (m.videoTitle ? '<div style="font-size:13px;font-weight:500;color:' + C.t1 + ';margin-bottom:6px">' + esc(m.videoTitle) + '</div>' : '')
          + '<div style="display:flex;gap:16px;margin-bottom:8px">'
            + (m.viewCount != null ? '<div style="font-family:\'JetBrains Mono\',monospace;font-size:12px;color:#e06060">' + fmtNum(m.viewCount) + ' views</div>' : '')
            + (m.engagementScore != null ? '<div style="font-family:\'JetBrains Mono\',monospace;font-size:12px;color:' + C.t3 + '">' + fmtNum(m.engagementScore) + ' eng</div>' : '')
          + '</div>'
          + (m.whatToTryNext ? '<div style="font-size:12px;color:' + C.t2 + ';line-height:1.5">' + esc(m.whatToTryNext) + '</div>' : '')
        + '</div>'
      )
    }

    // ── One thing to do ───────────────────────────────────────────────────
    if (o.oneThingToDo) {
      parts.push(sec('One thing to do this week'))
      parts.push(
        '<div style="background:rgba(192,138,62,.07);border-left:3px solid ' + C.accent + ';border-radius:0 6px 6px 0;padding:10px 14px;margin-bottom:16px;font-size:13px;color:' + C.t1 + ';line-height:1.55">'
          + esc(o.oneThingToDo)
        + '</div>'
      )
    }

    return parts.join('') || '<div style="color:' + C.t3 + ';font-style:italic">Pulse not available yet.</div>'
  }

  function fmtNum(n) {
    if (n == null) return ''
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K'
    return String(n)
  }

  // Hard-coded colors — the modal overlay sits outside the scoped CSS tokens,
  // so var(--t1) etc. don't resolve. Use explicit hex values instead.
  var C = { t1: '#1a1a1a', t2: '#5a5856', t3: '#8a8682', accent: '#c08a3e', hair: 'rgba(20,16,10,.10)' }
  function sec(label) {
    return '<div style="font-family:Inter,sans-serif;font-weight:500;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:' + C.t3 + ';margin:18px 0 8px">' + esc(label) + '</div>'
  }
  function body(text) {
    return '<div style="color:' + C.t2 + ';font-size:13px;line-height:1.6;margin-bottom:10px">' + esc(text) + '</div>'
  }
  function shotRow(s) {
    // Handles both field shapes:
    //   agentExecutor template: { n, at, shot, note }
    //   real Bedrock output:    { type, n, duration, audio, cameraDirection, sceneDescription }
    var num   = s.n != null ? String(s.n) : ''
    var time  = s.at || s.duration || ''
    var sType = s.type || ''
    var desc  = s.shot || s.sceneDescription || ''
    var dir   = s.cameraDirection || ''
    var audio = s.note || s.audio || ''

    return '<div style="border-left:2px solid ' + C.hair + ';padding:0 0 14px 14px;margin-bottom:0">'
      // meta line: shot number · type · duration
      + '<div style="font-family:\'JetBrains Mono\',monospace;font-size:9px;letter-spacing:.08em;color:' + C.accent + ';margin-bottom:6px">'
        + (num ? 'Shot ' + esc(num) : '')
        + (sType ? (num ? ' &middot; ' : '') + esc(sType) : '')
        + (time ? ' &middot; ' + esc(time) : '')
      + '</div>'
      // scene description — the hero line
      + (desc ? '<div style="font-size:13px;color:' + C.t1 + ';line-height:1.55;margin-bottom:4px;font-weight:500">' + esc(desc) + '</div>' : '')
      // camera direction
      + (dir ? '<div style="font-size:12px;color:' + C.t2 + ';line-height:1.45;margin-bottom:3px">' + esc(dir) + '</div>' : '')
      // audio / note
      + (audio ? '<div style="font-size:11px;color:' + C.t3 + ';font-style:italic;line-height:1.4">' + esc(audio) + '</div>' : '')
    + '</div>'
  }

  function formatGenericBrief(o) {
    var parts = []
    for (var key in o) {
      if (!o.hasOwnProperty(key)) continue
      var val = o[key]
      if (val === null || val === undefined) continue
      var label = key.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim().toUpperCase()
      if (typeof val === 'string') {
        parts.push('<div style="margin-bottom:14px"><div style="font-family:Inter,sans-serif;font-weight:500;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--t3);margin-bottom:4px">' + label + '</div><div style="color:var(--t1);font-size:13px;line-height:1.55">' + esc(val) + '</div></div>')
      } else if (typeof val === 'number') {
        parts.push('<div style="margin-bottom:14px"><div style="font-family:Inter,sans-serif;font-weight:500;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--t3);margin-bottom:4px">' + label + '</div><div style="font-family:\'JetBrains Mono\',monospace;font-size:16px;color:var(--t1)">' + val.toLocaleString() + '</div></div>')
      } else if (Array.isArray(val) && val.length > 0) {
        var items = val.map(function (item) {
          if (typeof item === 'string') return '<div style="padding:4px 0 4px 10px;border-left:2px solid var(--accent);margin-bottom:4px;font-size:12px;color:var(--t2)">' + esc(item) + '</div>'
          if (typeof item === 'object' && item !== null) return shotRow(item)
          return ''
        }).join('')
        parts.push('<div style="margin-bottom:14px"><div style="font-family:Inter,sans-serif;font-weight:500;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--t3);margin-bottom:6px">' + label + '</div>' + items + '</div>')
      }
    }
    return parts.join('') || '<div style="color:var(--t3)">No details available</div>'
  }
}

window.copyToClipboard = function (text) {
  navigator.clipboard.writeText(text).then(() => {
    window.showNotification('✓ Copied', 'success')
  }).catch(err => {
    console.error('[brief] copy failed:', err)
  })
}

window.useHook = function (day, rank) {
  window.showNotification(`✓ Hook #${rank} selected`, 'success')
}

window.postNow = async function (postId) {
  const confirmed = confirm('Post now?')
  if (!confirmed) return
  try {
    window.briefState.loading = true
    const response = await fetch(`/api/briefs/queue/${postId}/post-now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!response.ok) throw new Error('post_failed')
    window.showNotification('Posted!', 'success')
    await window.refreshQueue()
  } catch (err) {
    window.showNotification('Couldn\'t post — try again.', 'error')
  } finally {
    window.briefState.loading = false
  }
}

window.previewPost = function (postId) {
  window.showNotification('Preview coming soon', 'info')
}

window.editPost = function (postId) {
  window.showNotification('Edit coming soon', 'info')
}

window.reschedulePost = function (postId) {
  window.showNotification('Reschedule coming soon', 'info')
}

window.viewProductionBrief = function (postId) {
  window.navigateTo('weekly-briefs')
}

window.downloadWeeklyBriefs = function () {
  window.showNotification('Download coming soon', 'info')
}

window.dismissBrief = function (briefType) {
  const briefCard = document.querySelector(`[data-brief="${briefType}"]`)
  if (briefCard) {
    briefCard.style.opacity = '0.5'
    briefCard.style.pointerEvents = 'none'
  }
}

window.refreshQueue = async function () {
  try {
    const response = await fetch(`/api/briefs/queue`)
    const data = await response.json()
    console.log('[brief] queue refreshed:', data)
  } catch (err) {
    console.error('[brief] queue refresh error:', err)
  }
}

window.showNotification = function (message, type = 'info') {
  const toast = document.createElement('div')
  toast.className = `toast toast-${type}`
  toast.textContent = message
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: ${type === 'success' ? 'rgba(76,175,80,0.9)' : type === 'error' ? 'rgba(255,107,107,0.9)' : 'rgba(100,200,255,0.9)'};
    color: white;
    padding: 12px 16px;
    border-radius: 4px;
    font-size: 13px;
    font-weight: 500;
    z-index: 10000;
    animation: slideIn 0.3s ease-out;
  `
  document.body.appendChild(toast)
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-out'
    setTimeout(() => toast.remove(), 300)
  }, 3000)
}
