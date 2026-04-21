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
var currentView='home'
var isLoggedIn=false
var selectedNiche=''
var companyName=''

/* ── NAVIGATION ─────────────────────────────────────── */
var sectionNames={
  home:'Home',team:'The Team',how:'How It Works',outputs:'See Outputs',contact:'Contact',
  knowledge:'Knowledge Feed',pricing:'Pricing',faq:'FAQ',
  'db-dashboard':'HQ','db-pipeline':'Pipeline','db-posts':'Posts',
  'db-audience':'Audience','db-team':'Team','db-tasks':'Work',
  'db-outputs':'Outputs','db-knowledge':'Knowledge','db-settings':'Settings'
}

function navigate(id){
  // Remove the auth-gate style that uses !important to hide views —
  // once navigate() runs, the .active class handles visibility.
  var gate=document.getElementById('vx-auth-gate')
  if(gate)gate.remove()

  if(currentView===id)return
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

function obNext(step){
  if(step===1){
    companyName=document.getElementById('ob-name-input').value||'My Company'
    document.getElementById('ob-1').classList.remove('active')
    document.getElementById('ob-2').classList.add('active')
    document.getElementById('ob-prog').style.width='40%'
  } else if(step===2){
    if(!selectedNiche)return
    document.getElementById('ob-2').classList.remove('active')
    document.getElementById('ob-4').classList.add('active')
    document.getElementById('ob-prog').style.width='80%'
    document.getElementById('ob-reveal-title').textContent=companyName+' is open for business.'
    startReveal()
  }
}

function obPrev(step){
  if(step===2){
    document.getElementById('ob-2').classList.remove('active')
    document.getElementById('ob-1').classList.add('active')
    document.getElementById('ob-prog').style.width='20%'
  } else if(step===3){
    document.getElementById('ob-4').classList.remove('active')
    document.getElementById('ob-2').classList.add('active')
    document.getElementById('ob-prog').style.width='40%'
  }
}

function selectNiche(el,niche){
  document.querySelectorAll('.ob-card').forEach(c=>c.classList.remove('selected'))
  el.classList.add('selected')
  selectedNiche=niche
  // Hide custom input if a preset was picked
  var customWrap = document.getElementById('ob-custom-niche')
  if (customWrap && niche !== '__custom__') customWrap.style.display = 'none'
  var btn=document.getElementById('ob-niche-btn')
  btn.disabled=false
  btn.style.opacity='1'
}

function toggleCustomNiche(){
  document.querySelectorAll('.ob-card').forEach(c=>c.classList.remove('selected'))
  document.getElementById('ob-niche-other').classList.add('selected')
  var customWrap = document.getElementById('ob-custom-niche')
  customWrap.style.display = 'block'
  var input = document.getElementById('ob-custom-niche-input')
  input.focus()
  selectedNiche = '__custom__'
  var btn = document.getElementById('ob-niche-btn')
  // Enable button only when they type something
  btn.disabled = true
  btn.style.opacity = '.4'
  input.oninput = function() {
    var val = input.value.trim()
    if (val.length >= 2) {
      selectedNiche = val.toLowerCase().replace(/[^a-z0-9_ ]/g, '').replace(/\s+/g, '_')
      btn.disabled = false
      btn.style.opacity = '1'
    } else {
      btn.disabled = true
      btn.style.opacity = '.4'
    }
  }
}

function startReveal(){
  const delays=[500,1100,1700,2300]
  delays.forEach((d,i)=>{
    setTimeout(()=>{
      document.getElementById('ob-emp-'+i).classList.add('revealed')
      if(i===3){
        setTimeout(()=>{
          document.getElementById('ob-prog').style.width='100%'
          document.getElementById('ob-enter-btn').style.opacity='1'
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
  document.getElementById('nav-userplan').textContent='Pro Plan'
  document.getElementById('nav-avatar').textContent=
    (companyName||'M')[0].toUpperCase()

  navigate('db-dashboard')
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
var pp={starter:[14.99,11],pro:[49.99,37],agency:[99.99,74]}
function togglePrice(){
  annual=!annual
  document.getElementById('priceToggle').classList.toggle('on',annual)
  const fmt=p=>`<sup>$</sup>${Number.isInteger(p)?p:p.toFixed(2)}<span class="mo">/mo</span>`
  document.getElementById('ps-starter').innerHTML=fmt(annual?pp.starter[1]:pp.starter[0])
  document.getElementById('ps-pro').innerHTML=fmt(annual?pp.pro[1]:pp.pro[0])
  document.getElementById('ps-agency').innerHTML=fmt(annual?pp.agency[1]:pp.agency[0])
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
  div.innerHTML='<div class="mr-bubble">'+val+'</div>'
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
  document.getElementById('settings-'+panel).classList.add('active')
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
          ${entry.status==='planned'?`<button class="cal-entry-action-btn approve" onclick="approveEntry('${entry.id}',event)">Approve</button>`:''}
          <button class="cal-entry-action-btn" onclick="meetingFromEntry('${entry.who}',event)">Meeting</button>
          <button class="cal-entry-action-btn" onclick="reassignEntry('${entry.id}',event)">Reassign</button>
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
        if (e.who === 'alex'   && hi === 3) return true
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

  // Trigger Alex to add hooks entry on same date
  if (entry.who === 'jordan' && entry.type === 'Reel') {
    setTimeout(() => {
      const alexEntry = {
        id: 'ae'+Date.now(),
        date: entry.date,
        type: 'Hooks',
        title: 'Hook set — '+entry.title,
        who: 'alex',
        status: 'planned',
        label: 'Alex'
      }
      calEntries.push(alexEntry)
      renderCalendar()
      showToast('A','Alex','Copywriter',
        `"Plan approved — I'm writing hooks for the ${entry.title} Reel now. I'll have 5 variations ready shortly."`,
        alexEntry.id)
    }, 1800)
  }
}

function meetingFromEntry(who, e) {
  if(e){e.stopPropagation()}
  const names = {jordan:['Jordan','Content Strategist','J'],
                 maya:  ['Maya','Trend Analyst','M'],
                 alex:  ['Alex','Copywriter','A'],
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

  // Alex adds script entries
  const reel1 = {id:'script1', date:'2025-01-13', type:'Script', title:'Weighted walking script',    who:'alex', status:'planned', label:'Alex'}
  const reel2 = {id:'script2', date:'2025-01-16', type:'Script', title:'Cycle syncing script',        who:'alex', status:'planned', label:'Alex'}
  calEntries.push(reel1, reel2)

  // Riley adds production entries  
  const prod1 = {id:'prod1', date:'2025-01-13', type:'Shoot', title:'Production day — Reel 01', who:'riley', status:'planned', label:'Riley'}
  calEntries.push(prod1)

  // Switch to calendar to show the update
  switchTasksView('calendar')
  setTimeout(()=>{
    showToast('A','Alex','Copywriter',
      '"Jordan\'s plan is approved — I\'ve added script slots to Monday and Thursday. Hooks for the weighted walking Reel are in progress now."',
      'script1')
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
        await fetch('/api/weekly/plan/approve' + q, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        })
        if (typeof window.showNotification === 'function') window.showNotification('Plan approved', 'success')
        if (typeof window.refreshBriefs === 'function') window.refreshBriefs()
        break
      case 'reject-plan':
        await fetch('/api/weekly/plan/reject' + q, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'User requested rethink' }),
        })
        if (typeof window.showNotification === 'function') window.showNotification('Plan rejected — Jordan is rethinking', 'info')
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
  var cid = window.__vxCompany?.id || ''
  if (!cid) return

  var endpointMap = {
    'weekly-plan': '/api/weekly/jordan-plan',
    'weekly-pulse': '/api/weekly/maya-pulse',
    'weekly-hooks': '/api/weekly/alex-hooks',
    'weekly-briefs': '/api/weekly/riley-briefs',
    'trends': '/api/briefs/morning',
    'evening-recap': '/api/briefs/evening',
  }
  var titleMap = {
    'weekly-plan': "Jordan's Content Plan",
    'weekly-pulse': "Maya's Weekly Pulse",
    'weekly-hooks': "Alex's Hooks",
    'weekly-briefs': "Riley's Production Briefs",
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
      var body = document.getElementById('vx-brief-body')
      if (!body) return
      if (!data) { body.textContent = 'No data available yet.'; return }

      var o = data.output || data
      var html = ''

      // Format the output as readable content
      if (typeof o === 'string') {
        html = '<div style="white-space:pre-wrap">' + esc(o) + '</div>'
      } else if (typeof o === 'object') {
        html = formatBriefOutput(o, brief)
      }

      if (data.employee) {
        html = '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:var(--t3);margin-bottom:12px">From ' + esc(data.employee) + ' &middot; ' + (data.createdAt ? new Date(data.createdAt).toLocaleDateString() : '') + '</div>' + html
      }

      body.innerHTML = html
    })
    .catch(function () {
      var body = document.getElementById('vx-brief-body')
      if (body) body.textContent = 'Failed to load.'
    })

  function esc(s) { return String(s || '').replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] }) }

  function formatBriefOutput(o, type) {
    var parts = []
    // Iterate keys and render them as labeled sections
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
          if (typeof item === 'object') {
            var line = Object.values(item).filter(function (v) { return typeof v === 'string' || typeof v === 'number' }).map(function (v) { return esc(String(v)) }).join(' &middot; ')
            return '<div style="padding:4px 0 4px 10px;border-left:2px solid var(--b2);margin-bottom:4px;font-size:12px;color:var(--t2)">' + line + '</div>'
          }
          return ''
        }).join('')
        parts.push('<div style="margin-bottom:14px"><div style="font-family:Inter,sans-serif;font-weight:500;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--t3);margin-bottom:6px">' + label + '</div>' + items + '</div>')
      } else if (typeof val === 'object' && !Array.isArray(val)) {
        var subParts = []
        for (var sk in val) {
          if (val[sk] === null || val[sk] === undefined) continue
          var sv = typeof val[sk] === 'object' ? JSON.stringify(val[sk]) : String(val[sk])
          subParts.push('<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px dashed var(--b1)"><span style="font-size:11px;color:var(--t3)">' + esc(sk.replace(/_/g, ' ')) + '</span><span style="font-size:11px;color:var(--t1)">' + esc(sv.slice(0, 100)) + '</span></div>')
        }
        if (subParts.length) parts.push('<div style="margin-bottom:14px"><div style="font-family:Inter,sans-serif;font-weight:500;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--t3);margin-bottom:6px">' + label + '</div>' + subParts.join('') + '</div>')
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
    if (!response.ok) throw new Error('Failed')
    window.showNotification('🚀 Posted!', 'success')
    await window.refreshQueue()
  } catch (err) {
    window.showNotification('Failed', 'error')
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
