/* Vexa — auth + extended onboarding + Instagram connect
 *
 * Injected alongside prototype.js. Replaces mock startOnboarding / showLogin /
 * obNext / enterDashboard so they hit the real API. Keeps body.html untouched.
 */
;(function () {
  const API = ''  // same-origin (Next rewrites /api/* to the API server)

  // ───────────────────────────────────────────────────────────────────────────
  // STATE
  // ───────────────────────────────────────────────────────────────────────────
  const obState = {
    companyName: '',
    niche: '',
    subNiche: '',
    audience: { description: '', age: '', interests: '' },
    goals: [],
    agentTools: { maya: [], jordan: [], alex: [], riley: [] },
    instagram: { handle: '' },
  }
  let authedUser = null
  let currentCompany = null

  // ───────────────────────────────────────────────────────────────────────────
  // STYLES
  // ───────────────────────────────────────────────────────────────────────────
  const style = document.createElement('style')
  style.textContent = `
    #vx-auth{position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.72);display:none;align-items:center;justify-content:center;backdrop-filter:blur(6px)}
    #vx-auth.active{display:flex}
    #vx-auth .vx-card{width:100%;max-width:440px;background:var(--s1);border:1px solid var(--b1);border-radius:14px;padding:32px;color:var(--t1)}
    #vx-auth h3{font-family:'Syne',sans-serif;font-size:26px;font-weight:600;margin:0 0 4px}
    #vx-auth .vx-sub{color:var(--t2);font-size:13px;margin-bottom:22px}
    #vx-auth label{display:block;font-size:11px;color:var(--t3);letter-spacing:.1em;text-transform:uppercase;margin:14px 0 6px}
    #vx-auth input{width:100%;padding:11px 14px;background:var(--s2);border:1px solid var(--b1);border-radius:8px;color:var(--t1);font-size:14px;font-family:inherit;outline:none;transition:border .2s}
    #vx-auth input:focus{border-color:var(--t2)}
    #vx-auth .vx-err{color:#ff6b6b;font-size:12px;margin-top:10px;min-height:16px}
    #vx-auth .vx-actions{display:flex;justify-content:space-between;align-items:center;margin-top:20px;gap:12px}
    #vx-auth .vx-btn{padding:11px 22px;background:var(--t1);color:var(--bg);border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit}
    #vx-auth .vx-btn[disabled]{opacity:.5;cursor:not-allowed}
    #vx-auth .vx-switch{background:none;border:none;color:var(--t2);font-size:12px;cursor:pointer;text-decoration:underline;font-family:inherit}
    #vx-auth .vx-close{position:absolute;top:18px;right:22px;background:none;border:none;color:var(--t2);font-size:20px;cursor:pointer}

    .ob-tags{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
    .ob-tag{padding:9px 14px;background:transparent;border:1px solid var(--b2);border-radius:18px;color:var(--t2);font-size:12px;cursor:pointer;font-family:inherit;transition:all .15s}
    .ob-tag.selected{background:var(--t1);color:var(--bg);border-color:var(--t1)}

    .ob-tool-group{margin-top:18px;padding:14px;background:var(--s2);border:1px solid var(--b1);border-radius:10px}
    .ob-tool-group-title{font-size:12px;color:var(--t2);margin-bottom:10px;display:flex;align-items:center;gap:8px}
    .ob-tool-group-title .chip{display:inline-block;padding:2px 8px;background:var(--s3);border-radius:10px;font-size:10px;color:var(--t1)}

    .ob-ig-card{margin-top:18px;padding:18px;background:linear-gradient(135deg,rgba(225,48,108,.08),rgba(131,58,180,.06));border:1px solid rgba(225,48,108,.3);border-radius:12px}
    .ob-ig-title{font-size:14px;font-weight:600;margin-bottom:6px;display:flex;align-items:center;gap:8px}
    .ob-ig-bullets{color:var(--t2);font-size:12px;line-height:1.7;margin:8px 0 14px;padding-left:16px}
    .ob-ig-bullets li{list-style:disc}
    .ob-ig-result{margin-top:14px;padding:12px;background:var(--s2);border-radius:8px;font-size:12px;color:var(--t1);display:none}
    .ob-ig-result.show{display:block}
    .ob-ig-result .row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed var(--b1)}
    .ob-ig-result .row:last-child{border:0}
  `
  document.head.appendChild(style)

  // ───────────────────────────────────────────────────────────────────────────
  // AUTH MODAL
  // ───────────────────────────────────────────────────────────────────────────
  const authHtml = `
    <div class="vx-card" role="dialog" aria-modal="true">
      <button class="vx-close" onclick="window.closeAuth()">×</button>
      <h3 id="vx-auth-title">Create your account</h3>
      <p class="vx-sub" id="vx-auth-sub">Start your 7-day free trial. No credit card.</p>
      <div id="vx-auth-signup">
        <label>Full name</label><input id="vx-signup-name" placeholder="Your name" autocomplete="name" />
        <label>Email</label><input id="vx-signup-email" type="email" placeholder="you@example.com" autocomplete="email" />
        <label>Username</label><input id="vx-signup-username" placeholder="pickahandle" autocomplete="username" />
        <label>Password</label><input id="vx-signup-password" type="password" placeholder="8+ characters" autocomplete="new-password" />
      </div>
      <div id="vx-auth-login" style="display:none">
        <label>Email or username</label><input id="vx-login-id" placeholder="you@example.com" autocomplete="username" />
        <label>Password</label><input id="vx-login-password" type="password" autocomplete="current-password" />
      </div>
      <div class="vx-err" id="vx-auth-err"></div>
      <div class="vx-actions">
        <button class="vx-switch" id="vx-auth-switch" onclick="window.toggleAuthMode()">Already have an account? Log in</button>
        <button class="vx-btn" id="vx-auth-submit" onclick="window.submitAuth()">Create account</button>
      </div>
    </div>`
  const authModal = document.createElement('div')
  authModal.id = 'vx-auth'
  authModal.innerHTML = authHtml
  document.body.appendChild(authModal)

  let authMode = 'signup'  // 'signup' | 'login'

  window.showLogin = function () {
    authMode = 'login'
    renderAuthMode()
    authModal.classList.add('active')
  }
  window.showSignup = function () {
    authMode = 'signup'
    renderAuthMode()
    authModal.classList.add('active')
  }
  window.closeAuth = function () {
    authModal.classList.remove('active')
    document.getElementById('vx-auth-err').textContent = ''
  }
  window.toggleAuthMode = function () {
    authMode = authMode === 'signup' ? 'login' : 'signup'
    renderAuthMode()
  }

  function renderAuthMode() {
    const isSignup = authMode === 'signup'
    document.getElementById('vx-auth-title').textContent = isSignup ? 'Create your account' : 'Welcome back'
    document.getElementById('vx-auth-sub').textContent = isSignup
      ? 'Start your 7-day free trial. No credit card.'
      : 'Log in to continue where you left off.'
    document.getElementById('vx-auth-signup').style.display = isSignup ? '' : 'none'
    document.getElementById('vx-auth-login').style.display = isSignup ? 'none' : ''
    document.getElementById('vx-auth-submit').textContent = isSignup ? 'Create account' : 'Log in'
    document.getElementById('vx-auth-switch').textContent = isSignup
      ? 'Already have an account? Log in'
      : 'Need an account? Sign up'
  }

  window.submitAuth = async function () {
    const errEl = document.getElementById('vx-auth-err')
    errEl.textContent = ''
    const btn = document.getElementById('vx-auth-submit')
    btn.disabled = true
    try {
      if (authMode === 'signup') {
        const payload = {
          fullName: document.getElementById('vx-signup-name').value || undefined,
          email: document.getElementById('vx-signup-email').value.trim(),
          username: document.getElementById('vx-signup-username').value.trim(),
          password: document.getElementById('vx-signup-password').value,
        }
        const res = await fetch(API + '/api/auth/signup', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'signup_failed')
        authedUser = json.user
        try {
          closeAuthAndStartOnboarding()
        } catch (err) {
          console.error('[auth] onboarding open threw; reloading', err)
          location.reload()
        }
      } else {
        const payload = {
          identifier: document.getElementById('vx-login-id').value.trim(),
          password: document.getElementById('vx-login-password').value,
        }
        const res = await fetch(API + '/api/auth/login', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'login_failed')
        authedUser = json.user
        // If already onboarded, go straight to dashboard. Any error downstream
        // in the long enterDashboard chain should still land the user on a
        // working page, so reload as a safety net.
        const me = await fetchMe()
        window.closeAuth()
        if (me?.companies && me.companies.length > 0) {
          currentCompany = me.companies[0]
          obState.companyName = currentCompany.name
          try {
            if (typeof window.enterDashboard === 'function') await window.enterDashboard()
          } catch (err) {
            console.error('[auth] enterDashboard chain threw; reloading', err)
            location.reload()
          }
        } else {
          closeAuthAndStartOnboarding()
        }
      }
    } catch (e) {
      errEl.textContent = friendlyError(e.message)
    } finally {
      btn.disabled = false
    }
  }

  function friendlyError(code) {
    switch (code) {
      case 'invalid_credentials': return 'That email/username or password is wrong.'
      case 'email_or_username_in_use': return 'That email or username is already in use.'
      case 'invalid_input': return 'Please check the fields and try again.'
      default: return 'Something went wrong. Try again.'
    }
  }

  function closeAuthAndStartOnboarding() {
    window.closeAuth()
    document.getElementById('onboarding').classList.add('active')
    showStep(1)
  }

  async function fetchMe() {
    const res = await fetch(API + '/api/auth/me', { credentials: 'include' })
    if (!res.ok) return { user: null, companies: [] }
    return res.json()
  }

  // ───────────────────────────────────────────────────────────────────────────
  // EXTENDED ONBOARDING — inject steps 4–7 (audience, goals, tools, IG) between
  // the prototype's step 3 (sub-niche) and step 4 (team reveal).
  // ───────────────────────────────────────────────────────────────────────────
  const obWrap = document.querySelector('#onboarding .ob-wrap')
  if (obWrap) {
    const reveal = document.getElementById('ob-4')

    function step(id, eyebrow, title, sub, body, continueHandler, opts) {
      const el = document.createElement('div')
      el.className = 'ob-step'
      el.id = id
      el.innerHTML = `
        <span class="ob-eyebrow">${eyebrow}</span>
        <h2 class="ob-title">${title}</h2>
        <p class="ob-sub">${sub}</p>
        ${body}
        <div class="ob-actions">
          <button class="btn-fill" style="padding:13px 32px;font-size:12px" data-next>${opts?.continueLabel || 'Continue'}</button>
          <button class="ob-back" data-back>Back</button>
          ${opts?.skip ? '<button class="ob-skip" data-skip>Skip</button>' : ''}
        </div>`
      el.querySelector('[data-next]').addEventListener('click', continueHandler)
      el.querySelector('[data-back]').addEventListener('click', () => obPrevTo(id))
      if (opts?.skip) el.querySelector('[data-skip]').addEventListener('click', continueHandler)
      obWrap.insertBefore(el, reveal)
      return el
    }

    // Step A — audience
    step(
      'ob-5',
      'Step 4 of 7',
      'Who are they for?',
      'Describe your audience. The team uses this to sharpen hooks, tone, and examples.',
      `
        <input class="ob-input" id="ob-aud-desc" placeholder="e.g. Women 35–50, busy moms losing their last 20 lb" autocomplete="off">
        <input class="ob-input" id="ob-aud-age" placeholder="Age range (e.g. 28–45)" autocomplete="off" style="margin-top:10px">
        <input class="ob-input" id="ob-aud-int" placeholder="Interests (comma-separated)" autocomplete="off" style="margin-top:10px">
      `,
      () => {
        obState.audience = {
          description: document.getElementById('ob-aud-desc').value.trim(),
          age: document.getElementById('ob-aud-age').value.trim(),
          interests: document.getElementById('ob-aud-int').value.trim(),
        }
        setProgress(55)
        showStep('6')
      },
    )

    // Step B — goals
    const goalOptions = [
      ['grow_following', 'Grow my following'],
      ['more_engagement', 'More engagement'],
      ['drive_sales', 'Drive sales'],
      ['build_authority', 'Build authority'],
      ['launch_product', 'Launch a product'],
      ['build_community', 'Build a community'],
    ]
    step(
      'ob-6',
      'Step 5 of 7',
      'What are you trying to do?',
      'Pick one or more. Jordan will tune your weekly plan around these outcomes.',
      `<div class="ob-tags" id="ob-goals">${goalOptions.map(([v, l]) => `<button class="ob-tag" data-goal="${v}" type="button">${l}</button>`).join('')}</div>`,
      () => {
        obState.goals = Array.from(document.querySelectorAll('#ob-goals .ob-tag.selected')).map((e) => e.dataset.goal)
        if (obState.goals.length === 0) return
        setProgress(70)
        showStep('7')
      },
      { continueLabel: 'Continue' },
    )
    document.getElementById('ob-6').querySelectorAll('#ob-goals .ob-tag').forEach((t) => {
      t.addEventListener('click', () => t.classList.toggle('selected'))
    })

    // Step C — agent tools
    const toolsByAgent = {
      maya:   ['Reddit', 'Google Trends', 'NewsAPI', 'RSS feeds', 'YouTube'],
      jordan: ['Your past outputs', 'Top competitors', 'Instagram insights'],
      alex:   ['Your previous captions', 'Top-performing hooks', 'Saved swipe file'],
      riley:  ['Pexels', 'Pixabay', 'Your brand color palette', 'Creatomate templates'],
    }
    step(
      'ob-7',
      'Step 6 of 7',
      'What should your team use?',
      'Pick the sources each employee should pull from. You can change this anytime.',
      `
        ${Object.entries(toolsByAgent).map(([agent, tools]) => `
          <div class="ob-tool-group">
            <div class="ob-tool-group-title">
              <span class="chip">${agentName(agent)}</span>
              <span>${agentRole(agent)}</span>
            </div>
            <div class="ob-tags" data-agent="${agent}">
              ${tools.map((t) => `<button class="ob-tag selected" data-tool="${t}" type="button">${t}</button>`).join('')}
            </div>
          </div>`).join('')}
      `,
      () => {
        const selected = {}
        Object.keys(toolsByAgent).forEach((agent) => {
          selected[agent] = Array.from(document.querySelectorAll(`[data-agent="${agent}"] .ob-tag.selected`)).map((e) => e.dataset.tool)
        })
        obState.agentTools = selected
        setProgress(85)
        showStep('8')
      },
    )
    document.getElementById('ob-7').querySelectorAll('.ob-tag').forEach((t) => {
      t.addEventListener('click', () => t.classList.toggle('selected'))
    })

    // Step D — Instagram connect
    step(
      'ob-8',
      'Step 7 of 7',
      'Connect Instagram.',
      'We pull follower counts and top-post signals so Maya knows what is actually working.',
      `
        <div class="ob-ig-card">
          <div class="ob-ig-title">📸 Instagram Graph API</div>
          <ul class="ob-ig-bullets">
            <li>Read-only access — we never post on your behalf.</li>
            <li>Follower counts, post performance, engagement rate.</li>
            <li>You can disconnect anytime from Settings.</li>
          </ul>
          <input class="ob-input" id="ob-ig-handle" placeholder="@your_handle" autocomplete="off">
          <div class="ob-ig-result" id="ob-ig-result"></div>
        </div>
      `,
      async () => {
        const handle = document.getElementById('ob-ig-handle').value.trim()
        obState.instagram.handle = handle
        await submitOnboardingAndConnectInstagram()
      },
      { skip: true, continueLabel: 'Connect & finish' },
    )

    // Override the step 3 → step 4 transition so it lands in our new flow.
  }

  function agentName(a) { return { maya: 'Maya', jordan: 'Jordan', alex: 'Alex', riley: 'Riley' }[a] }
  function agentRole(a) { return { maya: 'Trend & insights', jordan: 'Strategy', alex: 'Copy', riley: 'Creative direction' }[a] }

  function setProgress(pct) {
    const p = document.getElementById('ob-prog')
    if (p) p.style.width = pct + '%'
  }

  function showStep(which) {
    document.querySelectorAll('#onboarding .ob-step').forEach((s) => s.classList.remove('active'))
    const id = typeof which === 'number' ? ('ob-' + which) : ('ob-' + which)
    const el = document.getElementById(id)
    if (el) el.classList.add('active')
  }

  function obPrevTo(fromId) {
    const order = ['ob-1', 'ob-2', 'ob-3', 'ob-5', 'ob-6', 'ob-7', 'ob-8', 'ob-4']
    const idx = order.indexOf(fromId)
    if (idx <= 0) return
    const prev = order[idx - 1]
    document.getElementById(fromId).classList.remove('active')
    document.getElementById(prev).classList.add('active')
    const progressMap = { 'ob-1': 15, 'ob-2': 30, 'ob-3': 45, 'ob-5': 55, 'ob-6': 70, 'ob-7': 85 }
    if (progressMap[prev] !== undefined) setProgress(progressMap[prev])
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Override prototype functions that touch onboarding flow
  // ───────────────────────────────────────────────────────────────────────────
  const originalStartOnboarding = window.startOnboarding
  window.startOnboarding = async function () {
    const me = await fetchMe()
    if (!me.user) {
      window.showSignup()
      return
    }
    authedUser = me.user
    if (me.companies && me.companies.length > 0) {
      currentCompany = me.companies[0]
      obState.companyName = currentCompany.name
      if (typeof window.enterDashboard === 'function') window.enterDashboard()
      return
    }
    document.getElementById('onboarding').classList.add('active')
    showStep(1)
  }

  // Override obNext so step 3 (sub-niche) goes to our step 5 (audience) rather
  // than jumping straight to the team reveal.
  const originalObNext = window.obNext
  window.obNext = function (step) {
    if (step === 1) {
      obState.companyName = document.getElementById('ob-name-input').value.trim() || 'My Company'
      document.getElementById('ob-1').classList.remove('active')
      document.getElementById('ob-2').classList.add('active')
      setProgress(30)
    } else if (step === 2) {
      obState.niche = window.selectedNiche || ''
      if (!obState.niche) return
      document.getElementById('ob-2').classList.remove('active')
      document.getElementById('ob-3').classList.add('active')
      setProgress(45)
    } else if (step === 3) {
      obState.subNiche = document.getElementById('ob-subniche-input').value.trim()
      document.getElementById('ob-3').classList.remove('active')
      showStep('5')
      setProgress(55)
    } else if (typeof originalObNext === 'function') {
      originalObNext(step)
    }
  }

  // Capture selectNiche so we mirror the niche into our state
  const origSelectNiche = window.selectNiche
  window.selectNiche = function (el, niche) {
    window.selectedNiche = niche
    if (typeof origSelectNiche === 'function') origSelectNiche(el, niche)
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Submit onboarding → create company → optionally connect Instagram → reveal
  // ───────────────────────────────────────────────────────────────────────────
  async function submitOnboardingAndConnectInstagram() {
    try {
      const companyRes = await fetch(API + '/api/onboarding/company', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: obState.companyName,
          niche: obState.niche,
          subNiche: obState.subNiche || undefined,
          audience: obState.audience,
          goals: { selected: obState.goals },
          agentTools: obState.agentTools,
        }),
      })
      const companyJson = await companyRes.json()
      if (!companyRes.ok) throw new Error(companyJson.error || 'company_create_failed')
      currentCompany = companyJson.company

      if (obState.instagram.handle) {
        const igRes = await fetch(API + '/api/instagram/connect', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId: currentCompany.id, handle: obState.instagram.handle }),
        })
        if (igRes.ok) {
          const { connection } = await igRes.json()
          renderInstagramResult(connection)
          await new Promise((r) => setTimeout(r, 1500))
        }
      }

      // Advance to the reveal (original step 4)
      document.getElementById('ob-8').classList.remove('active')
      document.getElementById('ob-4').classList.add('active')
      document.getElementById('ob-reveal-title').textContent = obState.companyName + ' is open for business.'
      setProgress(95)
      if (typeof window.startReveal === 'function') window.startReveal()
    } catch (e) {
      alert('Something went wrong: ' + e.message)
    }
  }

  function renderInstagramResult(c) {
    const el = document.getElementById('ob-ig-result')
    if (!el) return
    el.innerHTML = `
      <div class="row"><span>Handle</span><strong>@${c.handle}</strong></div>
      <div class="row"><span>Followers</span><strong>${c.followerCount.toLocaleString()}</strong></div>
      <div class="row"><span>Posts</span><strong>${c.postCount}</strong></div>
      <div class="row"><span>Engagement rate</span><strong>${c.engagementRate}%</strong></div>
    `
    el.classList.add('show')
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Wire the topbar login/signup and session bootstrap
  // ───────────────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init)
  if (document.readyState !== 'loading') init()

  function init() {
    const loginBtn = document.getElementById('topbar-login')
    if (loginBtn && !loginBtn.dataset.vxWired) {
      loginBtn.onclick = () => window.showLogin()
      loginBtn.dataset.vxWired = '1'
    }
    // Attempt silent session restore (don't auto-navigate).
    fetchMe().then((me) => {
      if (me.user) authedUser = me.user
      if (me.companies && me.companies.length > 0) currentCompany = me.companies[0]
    })
  }
})()
