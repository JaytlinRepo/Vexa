/* Sovexa — auth + extended onboarding + Instagram connect
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
    #vx-auth .vx-card{position:relative;width:100%;max-width:440px;background:var(--s1);border:1px solid var(--b1);border-radius:14px;padding:32px 32px 28px;color:var(--t1)}
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
    #vx-auth .vx-close{position:absolute;top:14px;right:16px;background:transparent;border:1px solid var(--b2);color:var(--t2);width:32px;height:32px;border-radius:8px;font-size:18px;cursor:pointer;line-height:1;display:flex;align-items:center;justify-content:center;transition:all .15s}
    #vx-auth .vx-close:hover{color:var(--t1);border-color:var(--t2)}
    #vx-auth .vx-back{display:block;margin:14px auto 0;background:none;border:none;color:var(--t3);font-size:11px;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;font-family:inherit;padding:6px 10px}
    #vx-auth .vx-back:hover{color:var(--t1)}

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
      <button class="vx-close" onclick="window.closeAuth()" aria-label="Close">×</button>
      <h3 id="vx-auth-title">Create your account</h3>
      <p class="vx-sub" id="vx-auth-sub">Start your 7-day free trial. No credit card.</p>
      <div id="vx-auth-signup">
        <label>Full name</label><input id="vx-signup-name" placeholder="Your name" autocomplete="name" />
        <label>Email</label><input id="vx-signup-email" type="email" placeholder="you@example.com" autocomplete="email" />
        <label>Username</label><input id="vx-signup-username" placeholder="pickahandle" autocomplete="username" />
        <label>Password</label><div style="position:relative"><input id="vx-signup-password" type="password" placeholder="8+ characters" autocomplete="new-password" style="padding-right:44px" /><button type="button" class="vx-eye" data-target="vx-signup-password" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--t3);font-size:13px;padding:4px">Show</button></div>
      </div>
      <div id="vx-auth-login" style="display:none">
        <label>Email or username</label><input id="vx-login-id" placeholder="you@example.com" autocomplete="username" />
        <label>Password</label><div style="position:relative"><input id="vx-login-password" type="password" autocomplete="current-password" style="padding-right:44px" /><button type="button" class="vx-eye" data-target="vx-login-password" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--t3);font-size:13px;padding:4px">Show</button></div>
      </div>
      <div class="vx-err" id="vx-auth-err"></div>
      <div class="vx-actions">
        <button class="vx-switch" id="vx-auth-switch" onclick="window.toggleAuthMode()">Already have an account? Log in</button>
        <button class="vx-btn" id="vx-auth-submit" onclick="window.submitAuth()">Create account</button>
      </div>
      <button class="vx-back" onclick="window.closeAuth()">← Back to site</button>
    </div>`
  const authModal = document.createElement('div')
  authModal.id = 'vx-auth'
  authModal.innerHTML = authHtml
  document.body.appendChild(authModal)

  // Password visibility toggles
  authModal.querySelectorAll('.vx-eye').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var inp = document.getElementById(btn.dataset.target)
      if (!inp) return
      var showing = inp.type === 'text'
      inp.type = showing ? 'password' : 'text'
      btn.textContent = showing ? 'Show' : 'Hide'
    })
  })

  // Click the backdrop (outside the card) to close
  authModal.addEventListener('click', (e) => {
    if (e.target === authModal) window.closeAuth()
  })
  // Escape key closes the modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && authModal.classList.contains('active')) window.closeAuth()
    if (e.key === 'Enter' && authModal.classList.contains('active') && e.target.tagName === 'INPUT') {
      e.preventDefault()
      window.submitAuth()
    }
  })

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
        try { localStorage.setItem('vx-authed', '1') } catch {}
        location.reload()
      }
    } catch (e) {
      console.error('[auth] login error:', e.message, e)
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

  // Sidebar "Sovexa" title: dashboard when session exists, else marketing home.
  window.navigateSovexaLogo = async function () {
    const me = await fetchMe()
    if (me?.user?.id) {
      if (typeof window.navigate === 'function') window.navigate('db-dashboard')
    } else {
      if (typeof window.navigate === 'function') window.navigate('home')
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ONBOARDING — three steps total: name → niche → Instagram, then reveal.
  // The agents derive sub-niche / audience / goals / tool sources themselves
  // from the connected account + brand memory + niche knowledge base, so we
  // don't ask the CEO to fill any of that in upfront.
  // ───────────────────────────────────────────────────────────────────────────
  const obWrap = document.querySelector('#onboarding .ob-wrap')
  if (obWrap) {
    const reveal = document.getElementById('ob-4')

    // Inject Step 3 — Instagram connect (real OAuth via Phyllo Connect).
    // Required for now — no skip. Connection is what unlocks every
    // personalized agent reply, so we gate the reveal on it.
    const ig = document.createElement('div')
    ig.className = 'ob-step'
    ig.id = 'ob-8'
    ig.innerHTML = `
      <span class="ob-eyebrow">Step 3 of 3</span>
      <h2 class="ob-title">Connect Instagram.</h2>
      <p class="ob-sub">Required to launch — your team needs real account data to give you real insights. Audience, sub-niche, top posts — the team figures all of that out from the connection.</p>
      <div class="ob-ig-card">
        <div class="ob-ig-title">Instagram connection</div>
        <ul class="ob-ig-bullets">
          <li>Read-only access — we never post on your behalf.</li>
          <li>Follower counts, post performance, engagement rate.</li>
          <li>You can disconnect anytime from Settings.</li>
        </ul>
        <div class="ob-ig-result" id="ob-ig-result" style="margin-top:10px;color:var(--t3);font-size:12px;min-height:18px"></div>
      </div>
      <div class="ob-actions">
        <button class="btn-fill" id="ob-ig-connect" style="padding:13px 32px;font-size:12px">Connect Instagram</button>
        <button class="ob-back" data-back>Back</button>
      </div>
    `
    obWrap.insertBefore(ig, reveal)

    const INSTAGRAM_WORK_PLATFORM_ID = '9bb8913b-ddd9-430b-a66a-d74d846e6c66'

    document.getElementById('ob-ig-connect').addEventListener('click', async () => {
      const result = document.getElementById('ob-ig-result')
      const btn = document.getElementById('ob-ig-connect')
      if (!currentCompany?.id) {
        result.textContent = 'Company not ready yet — refresh and try again.'
        return
      }
      // Pre-flight: hit the SDK-token endpoint directly so we can
      // surface a server-side error (missing Phyllo creds, 5xx) BEFORE
      // opening the modal. The modal swallows server errors silently.
      result.textContent = 'Checking Instagram connection…'
      btn.disabled = true
      try {
        const r = await fetch(API + '/api/phyllo/sdk-token', { method: 'POST', credentials: 'include' })
        if (!r.ok) {
          const j = await r.json().catch(() => null)
          const msg = (j && (j.error || j.message)) || ('HTTP ' + r.status)
          result.innerHTML = `<div style="color:#ff6b6b">Server is not configured for Instagram yet — ${msg}.</div><div style="margin-top:6px;color:var(--t3);font-size:11px">Likely missing PHYLLO_CLIENT_ID / PHYLLO_CLIENT_SECRET on the API. Set them on Railway and retry.</div>`
          btn.disabled = false
          return
        }
      } catch (e) {
        result.innerHTML = `<div style="color:#ff6b6b">Could not reach the API — ${e.message}.</div>`
        btn.disabled = false
        return
      }
      if (typeof window.vxPhylloConnect !== 'function') {
        result.textContent = 'Connect SDK not loaded yet — wait a second and try again.'
        btn.disabled = false
        return
      }
      result.textContent = 'Opening Instagram authorization…'
      window.vxPhylloConnect({
        companyId: currentCompany.id,
        workPlatformId: INSTAGRAM_WORK_PLATFORM_ID,
        onConnected: async () => {
          result.textContent = 'Connected. Spinning up your team…'
          await finishToReveal()
        },
        onError: (msg) => {
          result.innerHTML = `<div style="color:#ff6b6b">Could not connect — ${msg || 'try again'}.</div>`
          btn.disabled = false
        },
        onClose: () => { btn.disabled = false },
      })
    })
    ig.querySelector('[data-back]').addEventListener('click', () => obPrevTo('ob-8'))
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
    // Three-step flow: name → niche → Instagram → reveal.
    const order = ['ob-1', 'ob-2', 'ob-8', 'ob-4']
    const idx = order.indexOf(fromId)
    if (idx <= 0) return
    const prev = order[idx - 1]
    document.getElementById(fromId).classList.remove('active')
    document.getElementById(prev).classList.add('active')
    const progressMap = { 'ob-1': 33, 'ob-2': 66 }
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

  // Override obNext: name → niche → Instagram → reveal. No sub-niche /
  // audience / goals / tools steps — agents derive those themselves.
  // Company is created at step 2 → step 3 transition so we have a real
  // companyId for the Phyllo Connect SDK on step 3.
  window.obNext = async function (step) {
    if (step === 1) {
      obState.companyName = document.getElementById('ob-name-input').value.trim() || 'My Company'
      document.getElementById('ob-1').classList.remove('active')
      document.getElementById('ob-2').classList.add('active')
      setProgress(66)
    } else if (step === 2) {
      obState.niche = window.selectedNiche || ''
      if (!obState.niche) return
      const btn = document.getElementById('ob-niche-btn')
      if (btn) { btn.disabled = true; btn.textContent = 'Setting up your team…' }
      const ok = await createCompanyForOnboarding()
      if (!ok) {
        if (btn) { btn.disabled = false; btn.textContent = 'Continue' }
        return
      }
      document.getElementById('ob-2').classList.remove('active')
      document.getElementById('ob-8').classList.add('active')
      setProgress(100)
    }
  }

  async function createCompanyForOnboarding() {
    try {
      const r = await fetch(API + '/api/onboarding/company', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: obState.companyName, niche: obState.niche }),
      })
      if (!r.ok) return false
      const j = await r.json()
      currentCompany = j.company
      return true
    } catch { return false }
  }

  async function finishToReveal() {
    document.getElementById('ob-8').classList.remove('active')
    document.getElementById('ob-4').classList.add('active')
    setProgress(100)
    // Hook for any post-onboarding init (refresh dashboard later, etc.)
    if (typeof window.startTeamReveal === 'function') {
      try { window.startTeamReveal() } catch {}
    }
  }

  // Capture selectNiche so we mirror the niche into our state
  const origSelectNiche = window.selectNiche
  window.selectNiche = function (el, niche) {
    window.selectedNiche = niche
    if (typeof origSelectNiche === 'function') origSelectNiche(el, niche)
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
