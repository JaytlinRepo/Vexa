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

    .ob-connect-grid{margin-top:16px;display:flex;flex-direction:column;gap:8px}
  `
  document.head.appendChild(style)

  // ───────────────────────────────────────────────────────────────────────────
  // AUTH MODAL
  // ───────────────────────────────────────────────────────────────────────────
  const authHtml = `
    <div class="vx-card" role="dialog" aria-modal="true">
      <button class="vx-close" onclick="window.closeAuth()" aria-label="Close">×</button>
      <h3 id="vx-auth-title">Create your account</h3>
      <p class="vx-sub" id="vx-auth-sub">Free forever. No credit card required.</p>
      <div id="vx-auth-signup">
        <label>Full name</label><input id="vx-signup-name" placeholder="Your name" autocomplete="name" />
        <label>Email</label><input id="vx-signup-email" type="email" placeholder="you@example.com" autocomplete="email" />
        <label>Username</label><input id="vx-signup-username" placeholder="pickahandle" autocomplete="username" />
        <label>Password</label><div style="position:relative"><input id="vx-signup-password" type="password" placeholder="8+ characters" autocomplete="new-password" style="padding-right:44px" /><button type="button" class="vx-eye" data-target="vx-signup-password" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--t3);font-size:13px;padding:4px">Show</button></div>
      </div>
      <div id="vx-auth-login" style="display:none">
        <label>Email or username</label><input id="vx-login-id" placeholder="you@example.com" autocomplete="username" />
        <label>Password</label><div style="position:relative"><input id="vx-login-password" type="password" autocomplete="current-password" style="padding-right:44px" /><button type="button" class="vx-eye" data-target="vx-login-password" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--t3);font-size:13px;padding:4px">Show</button></div>
        <button type="button" onclick="window.showForgotPassword()" style="background:none;border:none;color:var(--t3);font-size:11px;cursor:pointer;font-family:inherit;padding:8px 0 0;display:block">Forgot password?</button>
      </div>
      <div id="vx-auth-forgot" style="display:none">
        <label>Email address</label><input id="vx-forgot-email" type="email" placeholder="you@example.com" autocomplete="email" />
        <p style="margin:10px 0 0;font-size:12px;color:var(--t3);line-height:1.5">We'll send a reset link that expires in 15 minutes.</p>
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

  let authMode = 'signup'  // 'signup' | 'login' | 'forgot'

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
  window.showForgotPassword = function () {
    authMode = 'forgot'
    renderAuthMode()
  }
  window.closeAuth = function () {
    authModal.classList.remove('active')
    document.getElementById('vx-auth-err').textContent = ''
  }
  window.toggleAuthMode = function () {
    // Forgot → always go back to login, not signup
    authMode = authMode === 'forgot' ? 'login' : (authMode === 'signup' ? 'login' : 'signup')
    renderAuthMode()
  }

  function renderAuthMode() {
    const isSignup = authMode === 'signup'
    const isForgot = authMode === 'forgot'
    // Clear all inputs when switching modes to prevent stale credentials
    if (isSignup) {
      const n = document.getElementById('vx-signup-name'); if (n) n.value = ''
      const e = document.getElementById('vx-signup-email'); if (e) e.value = ''
      const u = document.getElementById('vx-signup-username'); if (u) u.value = ''
      const p = document.getElementById('vx-signup-password'); if (p) { p.value = ''; p.type = 'password' }
    } else if (!isForgot) {
      const i = document.getElementById('vx-login-id'); if (i) i.value = ''
      const p = document.getElementById('vx-login-password'); if (p) { p.value = ''; p.type = 'password' }
    } else {
      const f = document.getElementById('vx-forgot-email'); if (f) f.value = ''
    }
    document.getElementById('vx-auth-title').textContent = isSignup ? 'Create your account' : isForgot ? 'Reset your password' : 'Welcome back'
    document.getElementById('vx-auth-sub').textContent = isSignup
      ? 'Free forever. No credit card required.'
      : isForgot ? 'Enter your email and we\'ll send you a reset link.'
      : 'Log in to continue where you left off.'
    document.getElementById('vx-auth-signup').style.display = isSignup ? '' : 'none'
    document.getElementById('vx-auth-login').style.display = (!isSignup && !isForgot) ? '' : 'none'
    document.getElementById('vx-auth-forgot').style.display = isForgot ? '' : 'none'
    document.getElementById('vx-auth-submit').textContent = isSignup ? 'Create account' : isForgot ? 'Send reset link' : 'Log in'
    document.getElementById('vx-auth-switch').textContent = isSignup
      ? 'Already have an account? Log in'
      : isForgot ? '← Back to log in'
      : 'Need an account? Sign up'
    document.getElementById('vx-auth-err').textContent = ''
  }

  window.submitAuth = async function () {
    const errEl = document.getElementById('vx-auth-err')
    errEl.textContent = ''
    const btn = document.getElementById('vx-auth-submit')
    btn.disabled = true
    try {
      if (authMode === 'forgot') {
        const email = document.getElementById('vx-forgot-email').value.trim()
        if (!email) { errEl.textContent = 'Please enter your email address.'; btn.disabled = false; return }
        await fetch(API + '/api/auth/forgot-password', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        })
        // Always show success — never leak whether email exists
        errEl.style.color = '#34d27a'
        errEl.textContent = 'If an account exists for that email, a reset link is on its way.'
        btn.disabled = false
        return
      }
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
        // User row is not created yet — deferred until onboarding completes.
        // authedUser will be set by createCompanyForOnboarding below.
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
        var res, json
        try {
          res = await fetch(API + '/api/auth/login', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        } catch (netErr) {
          throw new Error('network_error')
        }
        try { json = await res.json() } catch { json = {} }
        if (!res.ok) throw new Error(json.error || json.message || 'login_failed')
        authedUser = json.user
        try { localStorage.setItem('vx-authed', '1') } catch {}
        // Close the auth modal and enter the dashboard directly instead
        // of reloading the page — avoids a flash of the home view when
        // the reload races script loading.
        if (typeof window.closeAuth === 'function') window.closeAuth()
        if (typeof window.enterDashboard === 'function') {
          window.enterDashboard()
        } else {
          location.reload()
        }
      }
    } catch (e) {
      console.error('[auth] error:', e.message, e)
      errEl.style.color = '#ff6b6b'
      errEl.textContent = friendlyError(e.message)
    } finally {
      btn.disabled = false
    }
  }

  function friendlyError(code) {
    switch (code) {
      case 'invalid_credentials': return 'Wrong email/username or password. Check your spelling and try again.'
      case 'email_or_username_in_use': return 'That email or username is already taken. Try a different one.'
      case 'invalid_input': return 'Please fill in all required fields correctly.'
      case 'rate_limited': return 'Too many attempts. Please wait a few minutes before trying again.'
      case 'network_error': return 'Can\'t reach the server. Check your internet connection and try again.'
      case 'login_failed': return 'Login failed. Please check your credentials and try again.'
      case 'signup_failed': return 'Sign up failed. Please try again.'
      case 'unauthorized': return 'Session expired. Please log in again.'
      case 'internal_error': return 'Server error. Please try again in a moment.'
      case 'invalid_or_expired_token': return 'This reset link has expired or already been used. Request a new one.'
      default:
        if (code && code.length < 100) return code.replace(/_/g, ' ')
        return 'Something went wrong. Please try again.'
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

  const OB_IG_ID = 'instagram'
  const OB_TT_ID = 'tiktok'

  function obEscapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  function obTimeAgo(iso) {
    if (!iso) return 'never'
    const diff = Math.max(0, Date.now() - new Date(iso).getTime())
    const m = Math.floor(diff / 60000)
    if (m < 1) return 'just now'
    if (m < 60) return m + ' min ago'
    const h = Math.floor(m / 60)
    if (h < 24) return h + ' hr ago'
    return Math.floor(h / 24) + 'd ago'
  }

  function obOpenOAuthPopup(url) {
    var w = 520, h = 640
    var left = Math.max(0, Math.round(window.screenX + (window.outerWidth - w) / 2))
    var top = Math.max(0, Math.round(window.screenY + (window.outerHeight - h) / 2))
    var popup = window.open(url, 'vx_oauth', 'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top + ',resizable=yes,scrollbars=yes')
    if (!popup) {
      window.open(url, '_blank')
      return null
    }
    var poll = setInterval(function () {
      try {
        if (!popup.closed) return
        clearInterval(poll)
        // After popup closes, check if user is now authenticated (new signup
        // path — account was created atomically with the OAuth connection).
        fetchMe().then(function (me) {
          if (me && me.user) {
            authedUser = me.user
            if (me.companies && me.companies.length > 0) currentCompany = me.companies[0]
            try { localStorage.setItem('vx-authed', '1') } catch (_) {}
          }
          if (typeof window.__vxObRefreshPlatforms === 'function') window.__vxObRefreshPlatforms()
        })
      } catch (_) { clearInterval(poll) }
    }, 500)
    return popup
  }

  async function obFetchIgConnection(companyId) {
    try {
      const res = await fetch(API + `/api/instagram/insights?companyId=${companyId}`, { credentials: 'include' })
      if (!res.ok) return null
      return (await res.json()).connection
    } catch {
      return null
    }
  }

  async function obFetchTtConnection(companyId) {
    try {
      const res = await fetch(API + `/api/tiktok/insights?companyId=${companyId}`, { credentials: 'include' })
      if (!res.ok) return null
      return (await res.json()).connection
    } catch {
      return null
    }
  }

  async function obFetchAccounts() {
    try {
      const res = await fetch(API + '/api/platform/accounts', { credentials: 'include' })
      if (!res.ok) return []
      return (await res.json()).accounts || []
    } catch {
      return []
    }
  }

  async function obPlatformConnectionFlags() {
    const me = await fetchMe()
    const companyId = me?.companies?.[0]?.id
    if (!companyId) return { ig: false, tt: false, any: false, companyId: null }
    currentCompany = me.companies[0]
    const [accounts, igConn, ttConn] = await Promise.all([
      obFetchAccounts(),
      obFetchIgConnection(companyId),
      obFetchTtConnection(companyId),
    ])
    let igAcct = null
    let ttAcct = null
    for (const a of accounts) {
      if (a.platform === OB_IG_ID && !igAcct) igAcct = a
      if (a.platform === OB_TT_ID && !ttAcct) ttAcct = a
    }
    const ig = !!(igConn || igAcct)
    const tt = !!ttConn
    return { ig, tt, any: !!(ig || tt), companyId, igConn, ttConn, igAcct, ttAcct }
  }

  function obContinueButtonState(enabled) {
    const btn = document.getElementById('ob-platform-continue')
    if (!btn) return
    btn.disabled = !enabled
    btn.style.opacity = enabled ? '1' : '0.45'
    btn.style.cursor = enabled ? 'pointer' : 'not-allowed'
  }

  async function refreshObPlatforms() {
    const body = document.getElementById('ob-platform-rows')
    const hint = document.getElementById('ob-connect-hint')
    if (!body) return

    body.innerHTML = '<div style="padding:14px;color:var(--t3);font-size:12px">Loading connections…</div>'
    obContinueButtonState(false)

    var st = await obPlatformConnectionFlags()
    var companyId = st.companyId
    var igConn = st.igConn
    var ttConn = st.ttConn

    function rowDetail(isIg, igOk, ttOk) {
      if (isIg) {
        if (igOk && igConn) {
          var p = [`@${obEscapeHtml(igConn.handle || st.igAcct?.handle || '')}`]
          if (Number(igConn.followerCount) > 0) p.push(`${Number(igConn.followerCount).toLocaleString()} followers`)
          p.push(`synced ${obEscapeHtml(obTimeAgo(igConn.lastSyncedAt || igConn.connectedAt))}`)
          return p.join(' · ')
        }
        if (st.igAcct) {
          return '@' + obEscapeHtml(st.igAcct.handle) + ' · synced ' + obEscapeHtml(obTimeAgo(st.igAcct.lastSyncedAt))
        }
        return obEscapeHtml('Read-only OAuth — follower & post analytics')
      }
      if (!ttOk) return obEscapeHtml('Read-only OAuth — audience & performance data')
      const parts = [obEscapeHtml(ttConn.handle ? '@' + ttConn.handle : 'Active')]
      if (Number(ttConn.followerCount) > 0) parts.push(`${Number(ttConn.followerCount).toLocaleString()} followers`)
      parts.push('synced ' + obEscapeHtml(obTimeAgo(ttConn.lastSyncedAt || ttConn.connectedAt)))
      return parts.join(' · ')
    }

    function toggleHtml(pid, connected, canToggleOff) {
      var knobSide = connected ? 'right:2px' : 'left:2px'
      var trackBg = connected ? 'background:#22c55e' : 'background:var(--s3);border:1px solid var(--b1)'
      var knobColor = connected ? 'background:#fff' : 'background:var(--t3)'
      var diss = connected && !canToggleOff ? 'opacity:.42;cursor:not-allowed;pointer-events:none' : ''
      return (
        `<button type="button"`
        + ` data-obplat="${pid}"`
        + ` data-ob-connected="${connected ? '1' : '0'}"`
        + ` aria-label="${pid === OB_IG_ID ? 'Instagram' : 'TikTok'} toggle"`
        + ` role="switch" aria-checked="${connected ? 'true' : 'false'}"`
        + ` style="position:relative;width:44px;height:24px;border-radius:8px;${trackBg};border:none;cursor:pointer;transition:background .2s;padding:0;flex-shrink:0;${diss}">`
        + `<span style="position:absolute;top:2px;${knobSide};width:20px;height:20px;border-radius:50%;${knobColor};transition:all .2s;box-shadow:0 1px 3px rgba(0,0,0,.35)"></span></button>`
      )
    }

    var igOn = st.ig
    var ttOn = st.tt
    var canOffIg = !igOn || ttOn
    var canOffTt = !ttOn || igOn

    const rows = `
      <div style="display:flex;align-items:center;gap:14px;padding:14px 16px;background:var(--s2);border:1px solid var(--b1);border-radius:10px">
        <div style="width:32px;height:32px;border-radius:8px;background:var(--s3);display:grid;place-items:center;font-size:10px;font-weight:700;color:var(--t1);flex-shrink:0">IG</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:2px;flex-wrap:wrap">
            <div style="color:var(--t1);font-size:13px;font-weight:600">Instagram</div>
            <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;${igOn ? 'color:#22c55e' : 'color:var(--t3)'}">${igOn ? 'Connected' : 'Not connected'}</div>
          </div>
          <div style="color:var(--t2);font-size:11px;line-height:1.45">${rowDetail(true, igOn)}</div>
        </div>
        ${toggleHtml(OB_IG_ID, igOn, canOffIg)}
      </div>
      <div style="display:flex;align-items:center;gap:14px;padding:14px 16px;background:var(--s2);border:1px solid var(--b1);border-radius:10px">
        <div style="width:32px;height:32px;border-radius:8px;background:var(--s3);display:grid;place-items:center;font-size:10px;font-weight:700;color:var(--t1);flex-shrink:0">TT</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:2px;flex-wrap:wrap">
            <div style="color:var(--t1);font-size:13px;font-weight:600">TikTok</div>
            <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;${ttOn ? 'color:#22c55e' : 'color:var(--t3)'}">${ttOn ? 'Connected' : 'Not connected'}</div>
          </div>
          <div style="color:var(--t2);font-size:11px;line-height:1.45">${rowDetail(false, igOn, ttOn)}</div>
        </div>
        ${toggleHtml(OB_TT_ID, ttOn, canOffTt)}
      </div>
    `
    body.innerHTML = `<div class="ob-connect-grid">${rows}</div>`

    body.querySelectorAll('[data-obplat]').forEach(function (toggleBtn) {
      toggleBtn.addEventListener('click', async function () {
        if (!companyId) return
        const pid = toggleBtn.getAttribute('data-obplat')
        const conn = toggleBtn.getAttribute('data-ob-connected') === '1'
        if (!conn) {
          obMarkOAuthLeavingForOnboarding()
          var oauthUrl = pid === OB_IG_ID
            ? API + `/api/instagram/auth/start?companyId=${encodeURIComponent(companyId)}`
            : API + `/api/tiktok/auth/start?companyId=${encodeURIComponent(companyId)}`
          obOpenOAuthPopup(oauthUrl)
          return
        }
        var st2 = await obPlatformConnectionFlags()
        var onlyIg = st2.ig && !st2.tt
        var onlyTt = st2.tt && !st2.ig
        var block = (pid === OB_IG_ID && onlyIg) || (pid === OB_TT_ID && onlyTt)
        if (block) return
        if (pid === OB_TT_ID) {
          if (!confirm('Disconnect TikTok?')) return
          toggleBtn.disabled = true
          await fetch(API + `/api/tiktok/connections/${companyId}`, { method: 'DELETE', credentials: 'include' }).catch(() => {})
          refreshObPlatforms()
          return
        }
        if (pid === OB_IG_ID) {
          if (!confirm('Disconnect Instagram?')) return
          toggleBtn.disabled = true
          await fetch(API + '/api/instagram', { method: 'DELETE', credentials: 'include' }).catch(() => {})
          refreshObPlatforms()
        }
      })
    })

    obContinueButtonState(st.any)

    if (hint) {
      hint.textContent = st.any
        ? 'At least one platform is connected — continue when you are ready.'
        : 'Choose Instagram and/or TikTok. You must connect at least one to launch.'
      hint.style.color = st.any ? 'var(--t2)' : 'var(--accent)'
    }
  }

  window.__vxObRefreshPlatforms = refreshObPlatforms
  window.__vxShowObStep = function (which) {
    document.querySelectorAll('#onboarding .ob-step').forEach((s) => s.classList.remove('active'))
    const suffix = typeof which === 'number' ? which : parseInt(which, 10)
    var el = document.getElementById('ob-' + suffix)
    if (el) el.classList.add('active')
    if (suffix === 8 && typeof refreshObPlatforms === 'function') void refreshObPlatforms()
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

  async function finishToReveal() {
    const st = await obPlatformConnectionFlags()
    var hintEl = document.getElementById('ob-connect-hint')
    if (!st.any) {
      if (hintEl) {
        hintEl.textContent = 'Connect at least one platform (Instagram or TikTok), then tap Continue.'
        hintEl.style.color = 'var(--accent)'
      }
      return
    }
    try { sessionStorage.removeItem('vx-ob-await-connect') } catch (_) {}

    document.getElementById('ob-8').classList.remove('active')
    document.getElementById('ob-4').classList.add('active')
    const pEl = document.getElementById('ob-prog')
    if (pEl) pEl.style.width = '100%'

    if (typeof window.startTeamReveal === 'function') {
      try { window.startTeamReveal() } catch (_) {}
    } else if (typeof window.startReveal === 'function') {
      try { window.startReveal() } catch (_) {}
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ONBOARDING — three steps total: name → niche → integrations, then reveal.
  // ───────────────────────────────────────────────────────────────────────────
  const obWrap = document.querySelector('#onboarding .ob-wrap')
  if (obWrap) {
    const reveal = document.getElementById('ob-4')

    const platStep = document.createElement('div')
    platStep.className = 'ob-step'
    platStep.id = 'ob-8'
    platStep.innerHTML = `
      <span class="ob-eyebrow">Step 3 of 3</span>
      <h2 class="ob-title">Connect a platform.</h2>
      <p class="ob-sub">Link <strong style="font-weight:600;color:var(--t2)">Instagram</strong> or <strong style="font-weight:600;color:var(--t2)">TikTok</strong> (or both). We need at least one so your team can pull real audience and performance data. Same controls as <strong style="font-weight:600;color:var(--t2)">Settings → Integrations</strong> — read-only OAuth, disconnect anytime.</p>
      <div id="ob-platform-rows"></div>
      <p class="ob-hint" id="ob-connect-hint" style="margin-top:12px;font-size:12px;color:var(--t3)"></p>
      <div class="ob-actions">
        <button type="button" class="btn-fill" id="ob-platform-continue" disabled style="padding:13px 32px;font-size:12px;opacity:0.45;cursor:not-allowed">Continue</button>
        <button type="button" class="ob-back" data-back>Back</button>
      </div>
    `
    obWrap.insertBefore(platStep, reveal)

    document.getElementById('ob-platform-continue').addEventListener('click', function () {
      void finishToReveal()
    })
    platStep.querySelector('[data-back]').addEventListener('click', function () {
      obPrevTo('ob-8')
    })
  }

  document.addEventListener('vx-oauth-return-onboarding', function () {
    var ob = document.getElementById('onboarding')
    if (ob) ob.classList.add('active')
    if (typeof window.__vxShowObStep === 'function') window.__vxShowObStep(8)
  })

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
      if (typeof window.obResetNicheTags === 'function') window.obResetNicheTags()
      document.getElementById('ob-1').classList.remove('active')
      document.getElementById('ob-2').classList.add('active')
      if (typeof obWireNicheTagInput === 'function') obWireNicheTagInput()
      setProgress(66)
    } else if (step === 2) {
      obState.niche = window.selectedNiche || ''
      if (!obState.niche) return
      const btn = document.getElementById('ob-niche-btn')
      if (btn) { btn.disabled = true; btn.textContent = 'Setting up your team…' }
      // Store company details in the pending cookie — account created only
      // when the first platform connects (OAuth callback, atomically).
      try {
        const r = await fetch(API + '/api/auth/pending-company', {
          method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyName: obState.companyName, niche: obState.niche }),
        })
        if (!r.ok) throw new Error('pending-company failed')
      } catch {
        if (btn) { btn.disabled = false; btn.textContent = 'Continue' }
        return
      }
      if (btn) { btn.disabled = false; btn.textContent = 'Continue' }
      document.getElementById('ob-2').classList.remove('active')
      document.getElementById('ob-8').classList.add('active')
      setProgress(100)
      if (typeof window.__vxObRefreshPlatforms === 'function') void window.__vxObRefreshPlatforms()
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
      // New signup path: user is created here, set authedUser from the response.
      if (j.user) authedUser = j.user
      return true
    } catch { return false }
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
