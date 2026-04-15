/* Theme: root layout (theme-dark-default.js + VexaThemeBridge.tsx) owns
   data-theme and window.toggleTheme so hydration cannot clobber the toggle. */

/* ── CURSOR ─────────────────────────────────────────── */
const cd=document.getElementById('cd'),cr=document.getElementById('cr')
let mx=0,my=0,rx=0,ry=0
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

/* ── STATE ──────────────────────────────────────────── */
let currentView='home'
let isLoggedIn=false
let selectedNiche=''
let companyName=''

/* ── NAVIGATION ─────────────────────────────────────── */
const sectionNames={
  home:'Home',team:'The Team',how:'How It Works',outputs:'See Outputs',
  knowledge:'Knowledge Feed',pricing:'Pricing',faq:'FAQ',
  'db-dashboard':'Dashboard','db-team':'My Team','db-tasks':'Tasks',
  'db-outputs':'Outputs','db-knowledge':'Knowledge Feed','db-settings':'Settings'
}

function navigate(id){
  if(currentView===id)return
  const prev=document.getElementById('view-'+currentView)
  const next=document.getElementById('view-'+id)
  if(!next)return

  // Update nav active states
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.remove('active'))
  const navEl=document.getElementById('nav-'+id)
  if(navEl)navEl.classList.add('active')

  const pt=document.getElementById('page-trans')
  const topbar=document.getElementById('topbar-section')
  const doSwap=()=>{
    if(prev)prev.classList.remove('active')
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
  const btn=document.getElementById('ob-niche-btn')
  btn.disabled=false
  btn.style.opacity='1'
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

  // Switch nav
  document.getElementById('nav-marketing').style.display='none'
  document.getElementById('nav-app').style.display='block'
  document.getElementById('topbar-login').style.display='none'
  document.getElementById('topbar-cta').style.display='none'
  document.getElementById('notif-btn').style.display='flex'

  // Update user area
  document.getElementById('nav-username').textContent=companyName||'My Company'
  document.getElementById('nav-userplan').textContent='Pro Plan'
  document.getElementById('nav-avatar').textContent=
    (companyName||'M')[0].toUpperCase()

  // Update dashboard greeting
  const h=new Date().getHours()
  document.getElementById('db-greeting').textContent=
    (h<12?'Good morning':h<17?'Good afternoon':'Good evening')+', CEO.'
  document.getElementById('db-company').textContent=
    (companyName||'Your company')+' — your team is active and has work ready for your review.'

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
let annual=false
const pp={starter:[14.99,11],pro:[49.99,37],agency:[99.99,74]}
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
let calViewMode = 'month' // 'month' | 'week'
// Always open on the current month — the demo entries are dated to Jan 2025
// so they only render when the user navigates there, but the CEO should
// land on a calendar that reflects today.
let calDate = new Date()

// Data model — each entry has: date(YYYY-MM-DD), type, title, who, status
let calEntries = [
  // Jordan's week plan (pending)
  {id:'e1', date:'2025-01-13', type:'Reel',     title:'Weighted walking',    who:'jordan', status:'planned',   label:'Jordan'},
  {id:'e2', date:'2025-01-14', type:'Carousel', title:'Myth-busting splits', who:'jordan', status:'planned',   label:'Jordan'},
  {id:'e3', date:'2025-01-15', type:'Story',    title:'Behind the scenes',   who:'jordan', status:'planned',   label:'Jordan'},
  {id:'e4', date:'2025-01-16', type:'Reel',     title:'Cycle syncing',       who:'jordan', status:'planned',   label:'Jordan'},
  {id:'e5', date:'2025-01-17', type:'Caption',  title:'Motivation post',     who:'jordan', status:'planned',   label:'Jordan'},
  {id:'e7', date:'2025-01-19', type:'Reel',     title:'Weekly recap',        who:'jordan', status:'planned',   label:'Jordan'},
  // Maya's trend flag
  {id:'e8', date:'2025-01-13', type:'Trend',    title:'Weighted walking — act now', who:'maya', status:'scripted', label:'Maya'},
  // Previous week approved
  {id:'e9',  date:'2025-01-07', type:'Reel',    title:'5 Gym Mistakes',      who:'riley',  status:'approved',  label:'Riley'},
  {id:'e10', date:'2025-01-07', type:'Hooks',   title:'Hook set delivered',  who:'alex',   status:'approved',  label:'Alex'},
  {id:'e11', date:'2025-01-08', type:'Video',   title:'Reel rendered',       who:'riley',  status:'approved',  label:'Riley'},
  {id:'e12', date:'2025-01-09', type:'Reel',    title:'Morning Routine',     who:'alex',   status:'approved',  label:'Alex'},
]

const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December']
const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

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

    // Entries for this date
    const dayEntries = calEntries.filter(e => e.date === dateStr)
    dayEntries.forEach(entry => {
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
let toastTimer = null
let toastEntryId = null

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
    setTimeout(() => {
      showToast('M','Maya','Trend Analyst',
        '"Weighted walking is still rising — up 340% in 48 hours. I\'ve flagged Jan 13 in the calendar. You should post before competitors catch on."',
        'e8')
    }, 2000)
  }, 320)
}


/* ── INSIGHTS CHARTS ─────────────────────────────────── */

const insightsData = {
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

const dayLabels  = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
const saveLabels = ['Transform.','Education','Motivation','BTS']
let currentPeriod = '30d'

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
window.navigateVexaLogo = function () {
  if (typeof isLoggedIn !== 'undefined' && isLoggedIn) navigate('db-dashboard')
  else navigate('home')
}

// Expose calendar state so companion scripts (idea-wire.js) can read
// calDate (current visible month) and push into calEntries when the CEO
// adds an idea. Array reference is shared, so push() mutates the same
// underlying list prototype.js renders from. calDate uses a getter
// because calNav() reassigns the local binding.
window.calEntries = calEntries
Object.defineProperty(window, 'calDate', {
  get: () => calDate,
  configurable: true,
})
