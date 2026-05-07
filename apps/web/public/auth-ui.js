/* Sovexa — auth + extended onboarding + Instagram connect
 *
 * Injected alongside prototype.js. Replaces mock startOnboarding / showLogin /
 * obNext / enterDashboard so they hit the real API. Keeps body.html untouched.
 *
 * Validation mirrors apps/api (+ lib/badLanguage.ts + lib/emailMailbox.ts).
 */
;(function () {
  const API = ''  // same-origin (Next rewrites /api/* to the API server)

  const FIELD = {
    nameMax: 120,
    usernameMin: 3,
    usernameMax: 30,
    usernamePat: /^[a-zA-Z0-9_]+$/,
    passMin: 8,
    passMax: 200,
    /** RFC-like subset — server still validates */
    emailPat: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    companyMax: 120,
    nicheMax: 2000,
  }

  /** EMAIL_DOMAIN_SYNC → apps/api/src/lib/emailMailbox.ts */
  var EMAIL_DOMAIN_REJECT_MSG =
    'That email domain doesn’t look valid. Use a working address you check often.'
  var DISPOSABLE_MAIL_HOSTS = [
    'mailinator.com',
    'guerrillamail.com',
    'guerrillamailblock.com',
    'tempmail.com',
    'throwaway.email',
    '10minutemail.com',
    'yopmail.com',
    'trashmail.com',
    'temp-mail.org',
    'getnada.com',
    'maildrop.cc',
    'dispostable.com',
  ]
  var KNOWN_MULTI_MAIL_SUFFIX = {
    'co.uk': true,
    'com.au': true,
    'com.br': true,
    'co.nz': true,
    'net.au': true,
    'org.au': true,
    'org.uk': true,
  }

  function isDisposableMailHost(host) {
    var h = (host || '').toLowerCase()
    for (var i = 0; i < DISPOSABLE_MAIL_HOSTS.length; i++) {
      var d = DISPOSABLE_MAIL_HOSTS[i]
      if (h === d || h.endsWith('.' + d)) return true
    }
    return false
  }

  function twoLabelMailGibberishReject(sld) {
    if (/^xn--/i.test(sld)) return false
    var core = String(sld).replace(/-/g, '').toLowerCase()
    if (core.length < 5) return false
    if (!/^[a-z0-9]+$/i.test(core)) return false
    if (/^\d+$/.test(core)) return true
    if (!/[aeiouy]/i.test(core)) return true
    var run = 0
    for (var j = 0; j < core.length; j++) {
      if (/[aeiouy]/i.test(core[j])) run = 0
      else {
        run++
        if (run >= 8) return true
      }
    }
    return false
  }

  /** @param {string} email */
  function isRejectedMailboxEmail(email) {
    var raw = typeof email === 'string' ? email.trim().toLowerCase() : ''
    if (!raw || raw.indexOf('@') < 1) return false
    var host = raw.slice(raw.lastIndexOf('@') + 1).trim()
    var parts = host.split('.').filter(function (p) { return p.length > 0 })
    if (parts.length < 2) return false
    if (isDisposableMailHost(host)) return true
    if (parts.length === 2) return twoLabelMailGibberishReject(parts[0])
    if (parts.length === 3 && KNOWN_MULTI_MAIL_SUFFIX[parts[1].toLowerCase() + '.' + parts[2].toLowerCase()]) {
      return twoLabelMailGibberishReject(parts[0])
    }
    return false
  }

  /** @see apps/api/src/lib/badLanguage.ts TERMS — update both when extending the filter */
  var LANG_INVALID_MSG =
    'Remove inappropriate language before continuing.'
  var BAD_LANG_TERMS = [
    'arse',
    'arsehole',
    'asshole',
    'bastard',
    'bitch',
    'bullshit',
    'clit',
    'cock',
    'crap',
    'cunt',
    'dammit',
    'damn',
    'dick',
    'dickhead',
    'dumbass',
    'fuck',
    'fucked',
    'fucker',
    'fucking',
    'jackass',
    'motherfucker',
    'penis',
    'piss',
    'pissed',
    'prick',
    'pussy',
    'shit',
    'shithead',
    'shitty',
    'slut',
    'twat',
    'wank',
    'whore',
  ]

  /** @param {string} raw */
  function containsBlockedLanguage(raw) {
    var s = typeof raw === 'string' ? raw : ''
    if (!s.trim()) return false
    for (var i = 0; i < BAD_LANG_TERMS.length; i++) {
      var esc = BAD_LANG_TERMS[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      var re = new RegExp('(?:^|[^a-z0-9])' + esc + '(?:[^a-z0-9]|$)', 'i')
      if (re.test(s)) return true
    }
    return false
  }

  /** @param {HTMLElement} errEl */
  function resetAuthErrStyle(errEl) {
    if (!errEl) return
    errEl.style.color = ''
  }

  /** @returns {{ ok: boolean, msg?: string }} */
  function validateSignupPayload(name, email, username, password) {
    var nTrim = typeof name === 'string' ? name.trim() : ''
    var eTrim = typeof email === 'string' ? email.trim().toLowerCase() : ''
    var uTrim = typeof username === 'string' ? username.trim() : ''
    if (nTrim.length > FIELD.nameMax) return { ok: false, msg: `Name must be ${FIELD.nameMax} characters or less.` }
    if (!eTrim) return { ok: false, msg: 'Enter your email address.' }
    if (!FIELD.emailPat.test(eTrim)) return { ok: false, msg: 'That doesn’t look like a valid email address.' }
    if (isRejectedMailboxEmail(eTrim)) return { ok: false, msg: EMAIL_DOMAIN_REJECT_MSG }
    if (uTrim.length < FIELD.usernameMin) return { ok: false, msg: `Username must be at least ${FIELD.usernameMin} characters.` }
    if (uTrim.length > FIELD.usernameMax) return { ok: false, msg: `Username must be ${FIELD.usernameMax} characters or under.` }
    if (!FIELD.usernamePat.test(uTrim)) return { ok: false, msg: 'Username — letters, numbers, and underscores only.' }
    if (password.length < FIELD.passMin) return { ok: false, msg: `Password — at least ${FIELD.passMin} characters.` }
    if (password.length > FIELD.passMax) return { ok: false, msg: `Password must be ${FIELD.passMax} characters or less.` }
    if (!/[A-Z]/.test(password)) return { ok: false, msg: 'Password needs at least one uppercase letter.' }
    if (!/[0-9]/.test(password)) return { ok: false, msg: 'Password needs at least one number.' }
    if (nTrim.length > 0 && containsBlockedLanguage(nTrim)) return { ok: false, msg: LANG_INVALID_MSG }
    if (containsBlockedLanguage(uTrim)) return { ok: false, msg: LANG_INVALID_MSG }
    return { ok: true }
  }

  /** @returns {{ ok: boolean, msg?: string }} */
  function validateLoginPayload(identifier, password) {
    var id = typeof identifier === 'string' ? identifier.trim() : ''
    if (!id) return { ok: false, msg: 'Enter your email or username.' }
    if (!password) return { ok: false, msg: 'Enter your password.' }
    return { ok: true }
  }

  /** @returns {string} */
  function messageFromIssues(issues) {
    if (!issues || !issues.length) return ''
    for (var i = 0; i < issues.length; i++) {
      var iss = issues[i]
      if (iss && typeof iss.message === 'string') {
        var m = iss.message.trim()
        if (m.length > 0 && m.length <= 220) return m
      }
    }
    return ''
  }

  /** Read once — avoids opaque failures when proxies return HTML or empty bodies. */
  async function readResponseJson(res) {
    try {
      var t = await res.text()
      if (!t || !String(t).trim()) return {}
      return JSON.parse(t)
    } catch (_) {
      return {}
    }
  }

  /** @returns {string} */
  function signupOrLoginApiMessage(mode, json) {
    var err = json && json.error
    if (typeof err !== 'string') err = ''
    var first = messageFromIssues(json && json.issues)
    if (first) return first
    if (err === 'invalid_input') return 'Please check the highlighted fields and try again.'
    if (err === 'email_taken') return 'That email already has an account. Log in or use a different email.'
    if (err === 'username_taken') return 'That username is taken. Pick another handle.'
    if (err === 'no_pending_signup') return 'Session expired — please open sign up again and enter your email.'
    return ''
  }

  /** @param {'signup'|'login'} mode */
  function apiAuthFailureMessage(mode, json, httpStatus) {
    var fromKnown = signupOrLoginApiMessage(mode, json || {})
    if (fromKnown) return fromKnown
    var j = json || {}
    if (typeof j.message === 'string') {
      var ms = j.message.trim()
      if (ms.length > 0 && ms.length <= 280) return ms
    }
    if (typeof j.error === 'string' && j.error) return j.error
    if (
      httpStatus === 404
      || httpStatus === 502
      || httpStatus === 503
      || httpStatus === 504
    ) {
      return 'auth_service_unavailable'
    }
    if (httpStatus >= 400 && httpStatus < 500) return 'invalid_input'
    if (httpStatus >= 500) return 'internal_error'
    return mode === 'signup' ? 'signup_failed' : 'login_failed'
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STATE
  // ───────────────────────────────────────────────────────────────────────────
  const obState = {
    companyName: '',
    niche: '',
    subNiche: '',
    audience: { description: '', age: '', interests: '' },
    goals: [],
    agentTools: { maya: [], jordan: [], riley: [] },
    instagram: { handle: '' },
  }
  let authedUser = null
  let currentCompany = null

  // ───────────────────────────────────────────────────────────────────────────
  // STYLES
  // ───────────────────────────────────────────────────────────────────────────
  const style = document.createElement('style')
  style.textContent = `
    #vx-auth{
      position:fixed;inset:0;z-index:9000;
      background:color-mix(in srgb,var(--bg) 55%,rgba(0,0,0,.75));
      display:none;align-items:center;justify-content:center;
      backdrop-filter:blur(20px) saturate(1.15);
      -webkit-backdrop-filter:blur(20px) saturate(1.15);
      padding:20px;
    }
    #vx-auth.active{display:flex}
    #vx-auth .vx-card{
      position:relative;width:100%;max-width:440px;
      background:color-mix(in srgb,var(--s1) 92%,transparent);
      border:1px solid var(--b1);border-radius:14px;padding:32px 32px 28px;color:var(--t1);
      box-shadow:0 24px 64px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.03) inset;
    }
    [data-theme="light"] #vx-auth .vx-card{box-shadow:0 24px 56px rgba(0,0,0,.1),0 0 0 1px rgba(0,0,0,.04) inset}
    #vx-auth h3{
      font-family:'Cormorant Garamond',serif;font-size:clamp(24px,4.5vw,30px);font-weight:400;font-style:italic;
      letter-spacing:-.02em;line-height:1.15;margin:0 0 6px;color:var(--t1);
    }
    #vx-auth .vx-sub{color:var(--t2);font-size:13px;line-height:1.5;margin-bottom:20px;font-family:'Inter',system-ui,sans-serif;letter-spacing:-.006em}
    #vx-auth label{
      display:block;font-size:10px;color:var(--t3);letter-spacing:.22em;text-transform:uppercase;
      margin:14px 0 7px;font-family:'Inter',system-ui,sans-serif;font-weight:500;
    }
    #vx-auth input{
      width:100%;padding:13px 16px;background:var(--s2);border:1px solid var(--b1);border-radius:8px;color:var(--t1);
      font-size:14px;font-family:'DM Sans',sans-serif;outline:none;transition:border-color .2s,box-shadow .2s;
    }
    #vx-auth input:focus{border-color:var(--t2);box-shadow:0 0 0 2px var(--accent-soft)}
    #vx-auth .vx-hint{font-size:11px;color:var(--t3);margin:6px 0 0;line-height:1.45;font-family:'Inter',system-ui,sans-serif}
    #vx-auth .vx-err{color:#ff6b6b;font-size:12px;margin-top:10px;min-height:16px;font-family:'Inter',system-ui,sans-serif}
    #vx-auth .vx-actions{display:flex;justify-content:space-between;align-items:center;margin-top:22px;gap:14px;flex-wrap:wrap}
    #vx-auth .vx-btn{
      padding:13px 24px;background:var(--accent);color:var(--accent-text);border:none;border-radius:8px;
      font-size:13px;font-weight:600;letter-spacing:.04em;cursor:pointer;font-family:'DM Sans',sans-serif;
      box-shadow:0 6px 22px var(--accent-glow);transition:background .25s,transform .2s,box-shadow .25s;
    }
    #vx-auth .vx-btn:hover:not([disabled]){background:var(--accent-hov);transform:translateY(-1px);box-shadow:0 10px 32px var(--accent-glow)}
    #vx-auth .vx-btn[disabled]{opacity:.5;cursor:not-allowed;box-shadow:none;transform:none}
    #vx-auth .vx-switch{background:none;border:none;color:var(--t2);font-size:12px;cursor:pointer;text-decoration:underline;font-family:'Inter',system-ui,sans-serif;letter-spacing:-.01em}
    #vx-auth .vx-switch:hover{color:var(--t1)}
    #vx-auth .vx-close{
      position:absolute;top:14px;right:16px;background:transparent;border:1px solid var(--b2);color:var(--t2);
      width:34px;height:34px;border-radius:8px;font-size:18px;cursor:pointer;line-height:1;
      display:flex;align-items:center;justify-content:center;transition:color .15s,border-color .15s,background .15s;
      font-family:'Inter',system-ui,sans-serif;
    }
    #vx-auth .vx-close:hover{color:var(--t1);border-color:var(--b3);background:var(--s2)}
    #vx-auth .vx-back{
      display:block;margin:16px auto 0;background:none;border:none;color:var(--t3);font-size:11px;
      letter-spacing:.14em;text-transform:uppercase;cursor:pointer;font-family:'Inter',system-ui,sans-serif;font-weight:500;padding:8px 10px;
    }
    #vx-auth .vx-back:hover{color:var(--t1)}
    #vx-auth .vx-forgot-inline{
      background:none;border:none;color:var(--t3);font-size:12px;cursor:pointer;
      font-family:'Inter',system-ui,sans-serif;padding:10px 0 0;display:block;text-align:left;text-decoration:underline;text-underline-offset:3px;
    }
    #vx-auth .vx-forgot-inline:hover{color:var(--t2)}
    #vx-auth .vx-forgot-blurb{margin:12px 0 0;font-size:12px;color:var(--t3);line-height:1.55;font-family:'Inter',system-ui,sans-serif}
    #vx-auth .vx-field-err{min-height:18px;font-size:12px;color:#ff6b6b;margin:6px 0 0;line-height:1.4;font-family:'Inter',system-ui,sans-serif}
    #vx-auth input.vx-input-invalid{border-color:#e07070 !important;box-shadow:0 0 0 2px rgba(255,107,107,.18) !important}

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
      <p class="vx-sub" id="vx-auth-sub" hidden></p>
      <div id="vx-auth-signup">
        <label for="vx-signup-name">Full name</label><input id="vx-signup-name" name="fullName" maxlength="120" placeholder="Taylor Chen" autocomplete="name" autocapitalize="words" spellcheck="false" aria-describedby="vx-signup-name-err" />
        <p class="vx-field-err" id="vx-signup-name-err" role="alert" aria-live="polite"></p>
        <label for="vx-signup-email">Email</label><input id="vx-signup-email" name="email" type="email" inputmode="email" maxlength="254" placeholder="you@example.com" autocomplete="email" spellcheck="false" aria-describedby="vx-signup-email-err" />
        <p class="vx-field-err" id="vx-signup-email-err" role="alert" aria-live="polite"></p>
        <label for="vx-signup-username">Username</label><input id="vx-signup-username" name="username" maxlength="30" placeholder="creator_handle" autocapitalize="none" autocomplete="username" spellcheck="false" aria-describedby="vx-signup-username-err" />
        <p class="vx-field-err" id="vx-signup-username-err" role="alert" aria-live="polite"></p>
        <p class="vx-hint" id="vx-signup-user-hint">3–30 characters · letters, numbers, underscores.</p>
        <label for="vx-signup-password">Password</label><div style="position:relative"><input id="vx-signup-password" name="password" type="password" maxlength="200" autocomplete="new-password" style="padding-right:44px" spellcheck="false" /><button type="button" class="vx-eye" data-target="vx-signup-password" aria-label="Show password" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--t3);font-size:13px;padding:4px">Show</button></div>
        <p class="vx-hint">At least 8 characters · include one uppercase letter and one number.</p>
      </div>
      <div id="vx-auth-login" style="display:none">
        <label for="vx-login-id">Email or username</label><input id="vx-login-id" type="text" inputmode="email" maxlength="254" spellcheck="false" placeholder="you@example.com or your_handle" autocomplete="username" />
        <label for="vx-login-password">Password</label><div style="position:relative"><input id="vx-login-password" maxlength="200" type="password" autocomplete="current-password" style="padding-right:44px" spellcheck="false" /><button type="button" class="vx-eye" data-target="vx-login-password" aria-label="Show password" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--t3);font-size:13px;padding:4px">Show</button></div>
        <button type="button" class="vx-forgot-inline" onclick="window.showForgotPassword()">Forgot password?</button>
      </div>
      <div id="vx-auth-forgot" style="display:none">
        <label for="vx-forgot-email">Email address</label><input id="vx-forgot-email" type="email" inputmode="email" maxlength="254" placeholder="you@example.com" autocomplete="email" spellcheck="false" aria-describedby="vx-forgot-email-err" />
        <p class="vx-field-err" id="vx-forgot-email-err" role="alert" aria-live="polite"></p>
        <p class="vx-forgot-blurb">We'll send a reset link that expires in 15 minutes.</p>
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
      var sb = document.getElementById('vx-auth-submit')
      if (sb && sb.disabled) return
      e.preventDefault()
      window.submitAuth()
    }
  })

  let authMode = 'signup'  // 'signup' | 'login' | 'forgot'

  var EMAIL_INVALID_MSG = 'That doesn’t look like a valid email address.'

  function clearSignupEmailFieldUi() {
    var inp = document.getElementById('vx-signup-email')
    var err = document.getElementById('vx-signup-email-err')
    if (err) err.textContent = ''
    if (inp) {
      inp.classList.remove('vx-input-invalid')
      inp.removeAttribute('aria-invalid')
    }
  }

  function clearSignupLangFieldsUi() {
    ;[
      ['vx-signup-name', 'vx-signup-name-err'],
      ['vx-signup-username', 'vx-signup-username-err'],
    ].forEach(function (pair) {
      var inp = document.getElementById(pair[0])
      var err = document.getElementById(pair[1])
      if (err) err.textContent = ''
      if (inp) {
        inp.classList.remove('vx-input-invalid')
        inp.removeAttribute('aria-invalid')
      }
    })
  }

  function clearForgotEmailFieldUi() {
    var inp = document.getElementById('vx-forgot-email')
    var err = document.getElementById('vx-forgot-email-err')
    if (err) err.textContent = ''
    if (inp) {
      inp.classList.remove('vx-input-invalid')
      inp.removeAttribute('aria-invalid')
    }
  }

  /** Live: invalid email OR blocked language on name/username → errors + disabled submit. */
  function syncSignupLiveGuards() {
    var btn = document.getElementById('vx-auth-submit')
    if (!btn || authMode !== 'signup') return

    var emailInp = document.getElementById('vx-signup-email')
    var emailErr = document.getElementById('vx-signup-email-err')
    var nameInp = document.getElementById('vx-signup-name')
    var nameErr = document.getElementById('vx-signup-name-err')
    var userInp = document.getElementById('vx-signup-username')
    var userErr = document.getElementById('vx-signup-username-err')

    var emailBlocked = false
    if (emailInp && emailErr) {
      var t = typeof emailInp.value === 'string' ? emailInp.value.trim().toLowerCase() : ''
      if (t.length === 0) {
        emailErr.textContent = ''
        emailInp.classList.remove('vx-input-invalid')
        emailInp.removeAttribute('aria-invalid')
      } else if (!FIELD.emailPat.test(t)) {
        emailErr.textContent = EMAIL_INVALID_MSG
        emailInp.classList.add('vx-input-invalid')
        emailInp.setAttribute('aria-invalid', 'true')
        emailBlocked = true
      } else if (isRejectedMailboxEmail(t)) {
        emailErr.textContent = EMAIL_DOMAIN_REJECT_MSG
        emailInp.classList.add('vx-input-invalid')
        emailInp.setAttribute('aria-invalid', 'true')
        emailBlocked = true
      } else {
        emailErr.textContent = ''
        emailInp.classList.remove('vx-input-invalid')
        emailInp.removeAttribute('aria-invalid')
      }
    }

    var nameBlocked = false
    if (nameInp && nameErr) {
      var nTrim = typeof nameInp.value === 'string' ? nameInp.value.trim() : ''
      if (nTrim.length > 0 && containsBlockedLanguage(nameInp.value)) {
        nameErr.textContent = LANG_INVALID_MSG
        nameInp.classList.add('vx-input-invalid')
        nameInp.setAttribute('aria-invalid', 'true')
        nameBlocked = true
      } else {
        nameErr.textContent = ''
        nameInp.classList.remove('vx-input-invalid')
        nameInp.removeAttribute('aria-invalid')
      }
    }

    var userBlocked = false
    if (userInp && userErr) {
      var uTrim = typeof userInp.value === 'string' ? userInp.value.trim() : ''
      if (uTrim.length > 0 && containsBlockedLanguage(userInp.value)) {
        userErr.textContent = LANG_INVALID_MSG
        userInp.classList.add('vx-input-invalid')
        userInp.setAttribute('aria-invalid', 'true')
        userBlocked = true
      } else {
        userErr.textContent = ''
        userInp.classList.remove('vx-input-invalid')
        userInp.removeAttribute('aria-invalid')
      }
    }

    btn.disabled = emailBlocked || nameBlocked || userBlocked
  }

  function syncForgotEmailLive() {
    var inp = document.getElementById('vx-forgot-email')
    var fieldErr = document.getElementById('vx-forgot-email-err')
    var btn = document.getElementById('vx-auth-submit')
    if (!inp || !fieldErr || !btn || authMode !== 'forgot') return
    var t = typeof inp.value === 'string' ? inp.value.trim().toLowerCase() : ''
    if (t.length === 0) {
      fieldErr.textContent = ''
      inp.classList.remove('vx-input-invalid')
      inp.removeAttribute('aria-invalid')
      btn.disabled = false
      return
    }
    if (!FIELD.emailPat.test(t)) {
      fieldErr.textContent = EMAIL_INVALID_MSG
      inp.classList.add('vx-input-invalid')
      inp.setAttribute('aria-invalid', 'true')
      btn.disabled = true
      return
    }
    if (isRejectedMailboxEmail(t)) {
      fieldErr.textContent = EMAIL_DOMAIN_REJECT_MSG
      inp.classList.add('vx-input-invalid')
      inp.setAttribute('aria-invalid', 'true')
      btn.disabled = true
      return
    }
    fieldErr.textContent = ''
    inp.classList.remove('vx-input-invalid')
    inp.removeAttribute('aria-invalid')
    btn.disabled = false
  }

  function syncEmailLiveByMode() {
    if (authMode === 'signup') syncSignupLiveGuards()
    else if (authMode === 'forgot') syncForgotEmailLive()
    else {
      var b = document.getElementById('vx-auth-submit')
      if (b) b.disabled = false
      clearSignupEmailFieldUi()
      clearSignupLangFieldsUi()
      clearForgotEmailFieldUi()
    }
  }

  ;(function wireEmailLiveListeners() {
    var signupEl = document.getElementById('vx-signup-email')
    if (signupEl && !signupEl.dataset.vxLiveEmail) {
      signupEl.dataset.vxLiveEmail = '1'
      signupEl.addEventListener('input', function () {
        if (authMode === 'signup') syncSignupLiveGuards()
      })
    }
    ;['vx-signup-name', 'vx-signup-username'].forEach(function (id) {
      var el = document.getElementById(id)
      if (el && !el.dataset.vxLiveLang) {
        el.dataset.vxLiveLang = '1'
        el.addEventListener('input', function () {
          if (authMode === 'signup') syncSignupLiveGuards()
        })
      }
    })
    var forgotEl = document.getElementById('vx-forgot-email')
    if (forgotEl && !forgotEl.dataset.vxLiveEmail) {
      forgotEl.dataset.vxLiveEmail = '1'
      forgotEl.addEventListener('input', function () {
        if (authMode === 'forgot') syncForgotEmailLive()
      })
    }
  })()

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
    var el = document.getElementById('vx-auth-err')
    resetAuthErrStyle(el)
    if (el) el.textContent = ''
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
    var subEl = document.getElementById('vx-auth-sub')
    if (isSignup) {
      subEl.textContent = ''
      subEl.hidden = true
    } else {
      subEl.hidden = false
      subEl.textContent = isForgot
        ? 'Enter your email and we\'ll send you a reset link.'
        : 'Log in to continue where you left off.'
    }
    document.getElementById('vx-auth-signup').style.display = isSignup ? '' : 'none'
    document.getElementById('vx-auth-login').style.display = (!isSignup && !isForgot) ? '' : 'none'
    document.getElementById('vx-auth-forgot').style.display = isForgot ? '' : 'none'
    document.getElementById('vx-auth-submit').textContent = isSignup ? 'Create account' : isForgot ? 'Send reset link' : 'Log in'
    document.getElementById('vx-auth-switch').textContent = isSignup
      ? 'Already have an account? Log in'
      : isForgot ? '← Back to log in'
      : 'Need an account? Sign up'
    var errs = document.getElementById('vx-auth-err')
    resetAuthErrStyle(errs)
    if (errs) errs.textContent = ''
    document.querySelectorAll('#vx-auth .vx-eye').forEach(function (b) { b.textContent = 'Show' })
    syncEmailLiveByMode()
  }

  window.submitAuth = async function () {
    const errEl = document.getElementById('vx-auth-err')
    resetAuthErrStyle(errEl)
    errEl.textContent = ''
    const btn = document.getElementById('vx-auth-submit')
    syncEmailLiveByMode()
    if (btn.disabled) return
    btn.disabled = true
    try {
      if (authMode === 'forgot') {
        const email = document.getElementById('vx-forgot-email').value.trim().toLowerCase()
        if (!email) {
          errEl.textContent = 'Please enter your email address.'
          btn.disabled = false
          syncForgotEmailLive()
          return
        }
        if (!FIELD.emailPat.test(email)) {
          errEl.textContent = EMAIL_INVALID_MSG
          btn.disabled = false
          syncForgotEmailLive()
          return
        }
        if (isRejectedMailboxEmail(email)) {
          errEl.textContent = EMAIL_DOMAIN_REJECT_MSG
          btn.disabled = false
          syncForgotEmailLive()
          return
        }
        var fres = await fetch(API + '/api/auth/forgot-password', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        })
        if (!fres.ok) {
          resetAuthErrStyle(errEl)
          errEl.style.color = '#ff6b6b'
          try {
            var fj = await fres.json()
            errEl.textContent = signupOrLoginApiMessage('signup', fj)
              || 'Could not process that email. Try again.'
          } catch (_) {
            errEl.textContent = 'Could not process that email. Try again.'
          }
          btn.disabled = false
          syncForgotEmailLive()
          return
        }
        // Success — never leak whether the inbox exists server-side for valid emails
        errEl.style.color = 'var(--ok)'
        errEl.textContent = 'If an account exists for that email, a reset link is on its way.'
        btn.disabled = false
        syncForgotEmailLive()
        return
      }
      if (authMode === 'signup') {
        var nameVal = document.getElementById('vx-signup-name').value
        var emailVal = document.getElementById('vx-signup-email').value
        var userVal = document.getElementById('vx-signup-username').value
        var passVal = document.getElementById('vx-signup-password').value
        var check = validateSignupPayload(nameVal, emailVal, userVal, passVal)
        if (!check.ok) {
          errEl.textContent = check.msg || 'Check the form and try again.'
          btn.disabled = false
          return
        }
        var nameTrim = typeof nameVal === 'string' ? nameVal.trim() : ''
        const payload = {
          fullName: nameTrim.length > 0 ? nameTrim : undefined,
          email: typeof emailVal === 'string' ? emailVal.trim().toLowerCase() : '',
          username: typeof userVal === 'string' ? userVal.trim() : '',
          password: passVal,
        }
        var resSignup
        try {
          resSignup = await fetch(API + '/api/auth/signup', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        } catch (_) {
          throw new Error('network_error')
        }
        var jsSignup = await readResponseJson(resSignup)
        if (!resSignup.ok) {
          if (!Object.keys(jsSignup).length && resSignup.status) {
            console.warn('[auth] signup rejected with empty/non-JSON body; HTTP', resSignup.status)
          }
          throw new Error(apiAuthFailureMessage('signup', jsSignup, resSignup.status))
        }
        // User row is not created yet — deferred until onboarding completes.
        // authedUser will be set by createCompanyForOnboarding below.
        try {
          closeAuthAndStartOnboarding()
        } catch (err) {
          console.error('[auth] onboarding open threw; reloading', err)
          location.reload()
        }
      } else {
        var logId = document.getElementById('vx-login-id').value
        var logPw = document.getElementById('vx-login-password').value
        var logCheck = validateLoginPayload(logId, logPw)
        if (!logCheck.ok) {
          errEl.textContent = logCheck.msg || 'Enter your credentials.'
          btn.disabled = false
          return
        }
        const payload = {
          identifier: typeof logId === 'string' ? logId.trim() : '',
          password: logPw,
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
        json = await readResponseJson(res)
        if (!res.ok) {
          if (!Object.keys(json).length && res.status) {
            console.warn('[auth] login rejected with empty/non-JSON body; HTTP', res.status)
          }
          throw new Error(apiAuthFailureMessage('login', json, res.status))
        }
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
      resetAuthErrStyle(errEl)
      errEl.style.color = '#ff6b6b'
      errEl.textContent = friendlyError(e.message)
    } finally {
      btn.disabled = false
      syncEmailLiveByMode()
    }
  }

  function friendlyError(code) {
    switch (code) {
      case 'invalid_credentials': return 'Wrong email/username or password. Check your spelling and try again.'
      case 'email_or_username_in_use': return 'That email or username is already taken. Try a different one.'
      case 'invalid_input': return 'Please fill in all required fields correctly.'
      case 'rate_limited': return 'Too many attempts. Please wait a few minutes before trying again.'
      case 'network_error': return 'Can\'t connect right now. Check your internet connection and try again.'
      case 'login_failed': return 'Login failed. Please check your credentials and try again.'
      case 'signup_failed': return 'Sign up failed. Please try again.'
      case 'email_taken': return 'That email already has an account. Log in or use a different email.'
      case 'username_taken': return 'That username is taken. Pick another handle.'
      case 'no_pending_signup': return 'Session expired — please start sign up again.'
      case 'missing_fields': return 'Please fill in every required field.'
      case 'unauthorized': return 'Session expired. Please log in again.'
      case 'internal_error': return 'Something went wrong on our side. Please try again in a moment.'
      case 'auth_service_unavailable': return 'Couldn’t reach the account server. Check your connection and try again.'
      case 'invalid_or_expired_token': return 'This reset link has expired or already been used. Request a new one.'
      default:
        if (!code || typeof code !== 'string') return 'Something went wrong. Please try again.'
        if (code.length > 300) return 'Something went wrong. Please try again in a moment.'
        var trDefault = code.trim()
        // Plain snake_case token (API error slug), not readable prose → generic copy
        if (/^[a-z0-9_]+$/i.test(trDefault))
          return 'Something went wrong. Please try again in a moment.'
        return trDefault
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

  function obTiktokIntegrationEnabled() {
    return typeof window !== 'undefined' && window.__VX_TIKTOK_INTEGRATION_ENABLED === true
  }

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
    var done = false
    var finish = function () {
      if (done) return
      done = true
      try { window.removeEventListener('storage', onStorage) } catch (_) {}
      clearInterval(poll)
      try { window.focus() } catch (_) {}
      try { if (popup && !popup.closed) popup.close() } catch (_) {}
      // After OAuth completes, verify session then auto-advance to the dashboard.
      fetchMe().then(function (me) {
        if (me && me.user) {
          authedUser = me.user
          if (me.companies && me.companies.length > 0) currentCompany = me.companies[0]
          try { localStorage.setItem('vx-authed', '1') } catch (_) {}
        }
        // If we're in the onboarding platform-connect step, auto-complete to dashboard.
        if (typeof finishToReveal === 'function' && document.getElementById('ob-8')) {
          void finishToReveal()
        } else if (typeof window.__vxObRefreshPlatforms === 'function') {
          window.__vxObRefreshPlatforms()
        }
      })
    }
    // The popup signals completion via localStorage (resilient to COOP-severed
    // opener). Polling popup.closed is the secondary signal.
    var onStorage = function (e) { if (e.key === 'vx-oauth-complete') finish() }
    window.addEventListener('storage', onStorage)
    var poll = setInterval(function () {
      try { if (popup.closed) finish() } catch (_) { finish() }
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
    const ttProm = obTiktokIntegrationEnabled() ? obFetchTtConnection(companyId) : Promise.resolve(null)
    const [accounts, igConn, ttConn] = await Promise.all([
      obFetchAccounts(),
      obFetchIgConnection(companyId),
      ttProm,
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
          p.push(`updated ${obEscapeHtml(obTimeAgo(igConn.lastSyncedAt || igConn.connectedAt))}`)
          return p.join(' · ')
        }
        if (st.igAcct) {
          return '@' + obEscapeHtml(st.igAcct.handle) + ' · updated ' + obEscapeHtml(obTimeAgo(st.igAcct.lastSyncedAt))
        }
        return obEscapeHtml('Read-only access — follower & post analytics')
      }
      if (!ttOk) return obEscapeHtml('Read-only access — audience & performance data')
      const parts = [obEscapeHtml(ttConn.handle ? '@' + ttConn.handle : 'Active')]
      if (Number(ttConn.followerCount) > 0) parts.push(`${Number(ttConn.followerCount).toLocaleString()} followers`)
      parts.push('updated ' + obEscapeHtml(obTimeAgo(ttConn.lastSyncedAt || ttConn.connectedAt)))
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
    var ttOn = obTiktokIntegrationEnabled() ? st.tt : false
    var canOffIg = !igOn || ttOn
    var canOffTt = !ttOn || igOn

    var ttRow = ''
    if (obTiktokIntegrationEnabled()) {
      ttRow = `
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
      </div>`
    }

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
      ${ttRow}
    `
    body.innerHTML = `<div class="ob-connect-grid">${rows}</div>`

    body.querySelectorAll('[data-obplat]').forEach(function (toggleBtn) {
      toggleBtn.addEventListener('click', async function () {
        const pid = toggleBtn.getAttribute('data-obplat')
        const conn = toggleBtn.getAttribute('data-ob-connected') === '1'
        if (!conn) {
          // New pending users have no companyId yet — use '' as sentinel;
          // the OAuth callback creates user+company atomically.
          var effectiveCompanyId = companyId || ''
          try { sessionStorage.setItem('vx-ob-await-connect', '1') } catch (_) {}
          var oauthUrl = pid === OB_IG_ID
            ? API + `/api/instagram/auth/start?companyId=${encodeURIComponent(effectiveCompanyId)}`
            : API + `/api/tiktok/auth/start?companyId=${encodeURIComponent(effectiveCompanyId)}`
          obOpenOAuthPopup(oauthUrl)
          return
        }
        if (!companyId) return
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
      var needMsg = obTiktokIntegrationEnabled()
        ? 'Choose Instagram and/or TikTok. You must connect at least one to launch.'
        : 'Connect Instagram to pull real audience and performance data into your workspace.'
      hint.textContent = st.any
        ? 'At least one platform is connected — continue when you are ready.'
        : needMsg
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
        hintEl.textContent = obTiktokIntegrationEnabled()
          ? 'Connect at least one platform (Instagram or TikTok), then tap Continue.'
          : 'Connect Instagram, then tap Continue.'
        hintEl.style.color = 'var(--accent)'
      }
      return
    }
    try { sessionStorage.removeItem('vx-ob-await-connect') } catch (_) {}

    var step8 = document.getElementById('ob-8')
    var step4 = document.getElementById('ob-4')
    if (step8) step8.classList.remove('active')
    if (step4) step4.classList.add('active')
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
  // The platform-connect step (ob-8) is built dynamically because the copy +
  // platform rows depend on runtime feature flags (TikTok integration on/off).
  // ensurePlatStep() is idempotent and self-heals: if the script first ran
  // before body.html hydrated, calling it later — e.g. during the niche-step
  // transition — recovers cleanly instead of null-derefing on getElementById.
  // ───────────────────────────────────────────────────────────────────────────
  function ensurePlatStep() {
    if (document.getElementById('ob-8')) return true
    const obWrap = document.querySelector('#onboarding .ob-wrap')
    if (!obWrap) return false
    const reveal = document.getElementById('ob-4')
    if (!reveal) return false

    const platStep = document.createElement('div')
    platStep.className = 'ob-step'
    platStep.id = 'ob-8'
    platStep.innerHTML = `
      <span class="ob-eyebrow">Step 3 of 3</span>
      <h2 class="ob-title">Connect a platform.</h2>
      <p class="ob-sub">${
        obTiktokIntegrationEnabled()
          ? 'Link <strong style="font-weight:600;color:var(--t2)">Instagram</strong> or <strong style="font-weight:600;color:var(--t2)">TikTok</strong> (or both). We need at least one so your team can pull real audience and performance data. Same controls as <strong style="font-weight:600;color:var(--t2)">Settings → Integrations</strong> — read-only access, disconnect anytime.'
          : 'Link <strong style="font-weight:600;color:var(--t2)">Instagram</strong> so your team can pull real audience and performance data into the workspace. Same controls as <strong style="font-weight:600;color:var(--t2)">Settings → Integrations</strong> — read-only access.'
      }</p>
      <div id="ob-platform-rows"></div>
      <p class="ob-hint" id="ob-connect-hint" style="margin-top:12px;font-size:12px;color:var(--t3)"></p>
      <div class="ob-actions">
        <button type="button" class="btn-fill" id="ob-platform-continue" disabled style="padding:13px 32px;font-size:12px;opacity:0.45;cursor:not-allowed">Continue</button>
        <button type="button" class="ob-back" data-back>Back</button>
      </div>
    `
    obWrap.insertBefore(platStep, reveal)

    const contBtn = document.getElementById('ob-platform-continue')
    if (contBtn) contBtn.addEventListener('click', function () { void finishToReveal() })
    const backBtn = platStep.querySelector('[data-back]')
    if (backBtn) backBtn.addEventListener('click', function () { obPrevTo('ob-8') })
    return true
  }

  ensurePlatStep()
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensurePlatStep)
  }

  document.addEventListener('vx-oauth-return-onboarding', function () {
    var ob = document.getElementById('onboarding')
    if (ob) ob.classList.add('active')
    if (typeof window.__vxShowObStep === 'function') window.__vxShowObStep(8)
  })

  function agentName(a) { return { maya: 'Maya', jordan: 'Jordan', riley: 'Riley' }[a] }
  function agentRole(a) { return { maya: 'Trend & insights', jordan: 'Strategy', riley: 'Creative direction' }[a] }

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
      var ob1Hint = document.querySelector('#ob-1 .ob-hint')
      var nameRaw = document.getElementById('ob-name-input') && document.getElementById('ob-name-input').value
          ? String(document.getElementById('ob-name-input').value).trim() : ''
      if (nameRaw.length < 1) {
        if (ob1Hint) {
          ob1Hint.textContent = 'Enter a company or brand name (1–120 characters).'
          ob1Hint.style.color = 'var(--accent)'
        }
        try { document.getElementById('ob-name-input').focus() } catch (_) {}
        return
      }
      if (nameRaw.length > FIELD.companyMax) {
        if (ob1Hint) {
          ob1Hint.textContent = 'That name is too long — shorten to ' + FIELD.companyMax + ' characters or less.'
          ob1Hint.style.color = 'var(--accent)'
        }
        return
      }
      if (containsBlockedLanguage(nameRaw)) {
        if (ob1Hint) {
          ob1Hint.textContent = LANG_INVALID_MSG
          ob1Hint.style.color = 'var(--accent)'
        }
        try { document.getElementById('ob-name-input').focus() } catch (_) {}
        return
      }
      if (ob1Hint) {
        ob1Hint.textContent = 'You can change this anytime in Settings.'
        ob1Hint.style.color = ''
      }
      obState.companyName = nameRaw
      if (typeof window.obResetNicheTags === 'function') window.obResetNicheTags()
      document.getElementById('ob-1').classList.remove('active')
      document.getElementById('ob-2').classList.add('active')
      if (typeof obWireNicheTagInput === 'function') obWireNicheTagInput()
      setProgress(66)
    } else if (step === 2) {
      obState.niche = window.selectedNiche || ''
      if (!obState.niche) return
      if ((obState.niche || '').length > FIELD.nicheMax) {
        var obL = document.querySelector('#ob-2 .ob-hint')
        if (obL) {
          obL.textContent = 'Your tags exceed the limit — trim to ' + FIELD.nicheMax + ' characters total.'
          obL.style.color = 'var(--accent)'
        }
        return
      }
      if (
        containsBlockedLanguage(obState.companyName || '')
        || containsBlockedLanguage(obState.niche || '')
      ) {
        var obLh = document.querySelector('#ob-2 .ob-hint')
        if (obLh) {
          obLh.textContent = LANG_INVALID_MSG
          obLh.style.color = 'var(--accent)'
        }
        return
      }
      const btn = document.getElementById('ob-niche-btn')
      const ob2Hint = document.querySelector('#ob-2 .ob-hint')
      if (btn) { btn.disabled = true; btn.textContent = 'Setting up your team…' }
      try {
        if (authedUser) {
          // Existing session user — create company directly.
          const r = await fetch(API + '/api/onboarding/company', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: obState.companyName, niche: obState.niche }),
          })
          if (!r.ok) throw new Error('setup_failed')
          const j = await r.json()
          currentCompany = j.company
        } else {
          // New pending user — store in signed cookie; account created at OAuth.
          const r = await fetch(API + '/api/auth/pending-company', {
            method: 'PATCH', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ companyName: obState.companyName, niche: obState.niche }),
          })
          if (!r.ok) {
            if (r.status === 401) throw new Error('Session expired — please sign up again.')
            throw new Error('Something went wrong. Please try again.')
          }
        }
      } catch (err) {
        if (btn) { btn.disabled = false; btn.textContent = 'Continue' }
        var hint = 'Something went wrong. Please try again.'
        if (err && err.message && String(err.message).indexOf('Session expired') === 0) hint = err.message
        if (err && err.message === 'setup_failed') hint = 'We couldn\'t finish setup. Try again in a moment.'
        if (ob2Hint) { ob2Hint.textContent = hint; ob2Hint.style.color = 'var(--accent)' }
        return
      }
      if (ob2Hint) { ob2Hint.textContent = ''; ob2Hint.style.color = '' }
      if (btn) { btn.disabled = false; btn.textContent = 'Continue' }
      document.getElementById('ob-2').classList.remove('active')
      // Self-heal: if the platform step failed to mount earlier (race with
      // body.html hydration), build it now before activating.
      ensurePlatStep()
      const step8 = document.getElementById('ob-8')
      if (step8) step8.classList.add('active')
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
