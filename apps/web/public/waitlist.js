/* Waitlist gate — full landing page experience with account creation.
 * Replicates the home page design: atmosphere blobs, reveal animations,
 * pipeline card with cycling agents, team cards, process steps.
 * Uses vexa-landing.css classes directly.
 */
;(function () {
  if (document.cookie.indexOf('vx_session') !== -1) return
  // Only show waitlist on production (sovexa.ai) — skip on dev/localhost
  var host = window.location.hostname
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.amplifyapp.com')) return

  // ── Build the waitlist page using the same CSS classes as the home page ──
  var overlay = document.createElement('div')
  overlay.id = 'vx-waitlist'
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9998;overflow-y:auto;overflow-x:hidden;background:var(--bg);display:block;visibility:visible'

  overlay.innerHTML = ''

    // ─── ATMOSPHERE (blobs + stars + grid) ───────────────────────
    + '<div class="atmo">'
    + '<div class="blob b1"></div>'
    + '<div class="blob b2"></div>'
    + '<div class="blob b3"></div>'
    + '<div class="grid"></div>'
    + '<div class="stars" id="wl-stars"></div>'
    + '</div>'

    // ─── TOPBAR ─────────────────────────────────────────────────
    + '<nav class="top" id="vx-wl-topbar">'
    + '<div class="logo"><span class="dot"></span><span class="wordmark">Sovexa</span></div>'
    + '<div class="links">'
    + '<a href="#vx-wl-team">The team</a>'
    + '<a href="#vx-wl-process">How it works</a>'
    + '<a href="#" id="vx-wl-contact-link">Contact</a>'
    + '</div>'
    + '</nav>'

    // ─── HERO ───────────────────────────────────────────────────
    + '<section class="hero" style="min-height:auto;padding-bottom:60px">'
    + '<div class="hero-left">'
    + '<div class="eyebrow-row"><span class="pill"><span class="g"></span>Early Access · <em>Limited spots</em></span></div>'
    + '<h1>'
    + '<span class="line"><span>Your AI content team</span></span>'
    + '<span class="line"><span>is <em>almost ready.</em></span></span>'
    + '</h1>'
    + '<p class="sub">Create your account to reserve your spot. Four AI employees that plan, write, edit, and ship your content.</p>'

    // Signup form (replaces CTA buttons)
    + '<form id="vx-wl-form" style="display:flex;flex-direction:column;gap:10px;max-width:360px;margin-top:32px">'
    + '<input id="vx-wl-name" type="text" placeholder="Full name" required style="padding:13px 16px;border-radius:8px;border:1px solid var(--b2);background:var(--s1);font:14px Inter,sans-serif;color:var(--t1);outline:none;transition:border-color .2s" />'
    + '<input id="vx-wl-email" type="email" placeholder="Email" required style="padding:13px 16px;border-radius:8px;border:1px solid var(--b2);background:var(--s1);font:14px Inter,sans-serif;color:var(--t1);outline:none;transition:border-color .2s" />'
    + '<input id="vx-wl-username" type="text" placeholder="Username" required style="padding:13px 16px;border-radius:8px;border:1px solid var(--b2);background:var(--s1);font:14px Inter,sans-serif;color:var(--t1);outline:none;transition:border-color .2s" />'
    + '<input id="vx-wl-password" type="password" placeholder="Password (8+ characters)" required minlength="8" style="padding:13px 16px;border-radius:8px;border:1px solid var(--b2);background:var(--s1);font:14px Inter,sans-serif;color:var(--t1);outline:none;transition:border-color .2s" />'
    + '<div id="vx-wl-error" style="font-size:12px;color:var(--down,#c48a8a);min-height:16px;font-family:Inter,sans-serif"></div>'
    + '<button type="submit" id="vx-wl-btn" class="btn-primary" style="margin-top:4px">Create account <span class="arr">\u2192</span></button>'
    + '</form>'

    // Social proof
    + '<div class="proof" style="margin-top:24px">'
    + '<div class="avs"><div class="av">M</div><div class="av">J</div><div class="av">A</div><div class="av">R</div></div>'
    + '<div class="t" id="vx-wl-count"></div>'
    + '</div>'

    // Success state (hidden)
    + '<div id="vx-wl-success" style="display:none;margin-top:32px">'
    + '<h2 style="font-family:Cormorant Garamond,Georgia,serif;font-size:32px;font-weight:400;font-style:italic;color:var(--t1);margin:0 0 12px">Welcome to Sovexa.</h2>'
    + '<p style="font-family:Inter,sans-serif;font-size:15px;color:var(--t2);line-height:1.7;margin:0 0 24px">Your account is created. We\'re building your AI content team right now.</p>'
    + '<div style="border:1px solid var(--b1);border-radius:10px;background:var(--s1);padding:20px">'
    + '<div style="font-family:JetBrains Mono,monospace;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--t3);margin-bottom:12px">What happens next</div>'
    + '<div style="font-family:Inter,sans-serif;font-size:13px;color:var(--t2);line-height:1.7">'
    + '<div style="display:flex;gap:10px;margin-bottom:8px"><span style="color:var(--accent);flex-shrink:0">1.</span> We\'re onboarding creators in small batches</div>'
    + '<div style="display:flex;gap:10px;margin-bottom:8px"><span style="color:var(--accent);flex-shrink:0">2.</span> You\'ll get an email when your team is activated</div>'
    + '<div style="display:flex;gap:10px"><span style="color:var(--accent);flex-shrink:0">3.</span> Log in and your AI employees start working immediately</div>'
    + '</div></div>'
    + '</div>'

    + '</div>'

    // Pipeline card (right side)
    + '<div class="hero-right">'
    + '<div class="orb-ring r2"><span class="dot"></span><span class="dot b"></span></div>'
    + '<div class="orb-ring"><span class="dot"></span><span class="dot b"></span></div>'
    + '<div class="orb"></div>'
    + '<div class="pipe-card">'
    + '<div class="pc-head"><div class="t">SOVEXA \u00B7 <em>LIVE PIPELINE</em></div><div class="live">Live</div></div>'
    + '<div class="agent-stack" id="wl-agents">'
    + agentRow('maya', 'M', 'Maya \u00B7 Trend & Insights Analyst', ['scanning 66 sources', 'found <em>12</em> signals \u00B7 3 hot', 'clustering around trends'])
    + '<div class="agent-connector"><div></div></div>'
    + agentRow('jordan', 'J', 'Jordan \u00B7 Content Strategist', ['drafting brief #213', 'mapping to <em>pillar 2</em>', 'angle: boundary \u00B7 not to-do'])
    + '<div class="agent-connector"><div></div></div>'
    + agentRow('alex', 'A', 'Alex \u00B7 Copywriter', ['writing Reel caption', 'voice match <em>96%</em>', 'draft 2 of 2'])
    + '<div class="agent-connector"><div></div></div>'
    + agentRow('riley', 'R', 'Riley \u00B7 Creative Director', ['editing reel \u00B7 jump cuts', 'style match <em>94%</em>', 'exporting 9:16 vertical'])
    + '</div>'
    + '<div class="out-ticker">'
    + '<div class="m"><div class="l">This week</div><div class="v" id="wl-tk-posts"><em>21</em> posts</div></div>'
    + '<div class="m center"><div class="l">Reach</div><div class="v" id="wl-tk-reach"><em>1.8</em>M</div></div>'
    + '<div class="m"><div class="l">CEO hours</div><div class="v" id="wl-tk-hrs"><em>28.4</em>h saved</div></div>'
    + '</div>'
    + '</div></div>'

    + '</section>'

    // ─── MARQUEE ────────────────────────────────────────────────
    + '<div class="marquee"><div class="track">'
    + '<span>your content team</span><span>always on brand</span><span>four employees</span><span>zero prompts</span><span>plan write edit ship</span><span>you\'re the CEO</span>'
    + '<span>your content team</span><span>always on brand</span><span>four employees</span><span>zero prompts</span><span>plan write edit ship</span><span>you\'re the CEO</span>'
    + '</div></div>'

    // ─── TEAM ───────────────────────────────────────────────────
    + '<section class="blk" id="vx-wl-team" style="scroll-margin-top:80px">'
    + '<div class="sec-head reveal">'
    + '<span class="eyebrow">\u00A7 01 \u00B7 meet the team</span>'
    + '<h2>Four agents. <em>One voice.</em> Yours.</h2>'
    + '<p class="lede">Four specialists, each with their own lane, personality, and permissions they earn. You manage them like a team.</p>'
    + '</div>'
    + '<div class="team-wrap">'
    + tCard('M', 'Maya', 'Trend & Insights Analyst', '"I read the internet so you don\'t <em>have to</em>."', ['66 sources', 'weekly pulse', 'competitor watch'], 'd1')
    + tCard('J', 'Jordan', 'Content Strategist', '"Signal is cheap. A <em>plan</em> is the job."', ['pillars', 'briefs', 'cadence'], 'd2')
    + tCard('A', 'Alex', 'Copywriter & Script Writer', '"Less <em>ought-to</em>, more <em>felt</em>."', ['voice-locked', 'captions', 'shot lists'], 'd3')
    + tCard('R', 'Riley', 'Creative Director', '"Right post. Right minute. Right <em>feed</em>."', ['IG \u00B7 TT \u00B7 YT', 'auto-edit', 'cross-post'], 'd4')
    + '</div>'
    + '</section>'

    // ─── PROCESS ────────────────────────────────────────────────
    + '<section class="blk" id="vx-wl-process" style="background:linear-gradient(180deg,var(--bg),var(--s1),var(--bg));scroll-margin-top:80px">'
    + '<div class="sec-head reveal">'
    + '<span class="eyebrow">\u00A7 02 \u00B7 the pipeline</span>'
    + '<h2>From <em>signal</em> to <em>shipped</em>, in one room.</h2>'
    + '<p class="lede">Tell Sovexa what you create. Your team is ready to work in five minutes.</p>'
    + '</div>'
    + '<div style="max-width:960px;margin:0 auto;display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--b1);border:1px solid var(--b1);border-radius:16px;overflow:hidden">'
    + pCard('01', 'Set your niche', 'Choose your content category. Your team specializes instantly.', '2 minutes')
    + pCard('02', 'Define your brand', 'Tone, audience, goals. The more context, the better.', '2 minutes')
    + pCard('03', 'Your team delivers', 'Maya pulls trends. Jordan drafts a plan. Real outputs.', '1 minute')
    + pCard('04', 'Approve and repeat', 'Action buttons. Approve triggers the next step. Every decision trains your team.', 'Daily habit')
    + '</div>'
    + '</section>'

    // ─── FOOTER ─────────────────────────────────────────────────
    + '<footer style="padding:64px 48px 32px;border-top:1px solid var(--b1)">'
    + '<table style="width:100%;border-collapse:collapse"><tr>'
    + '<td style="vertical-align:top;padding:0 0 40px 0">'
    + '<div style="font-family:Cormorant Garamond,Georgia,serif;font-size:24px;font-weight:400;font-style:italic;margin-bottom:10px;color:var(--t1)">Sovexa</div>'
    + '<p style="font-family:Inter,sans-serif;font-size:13px;color:var(--t3);line-height:1.6;margin:0 0 6px;font-style:italic">Your content. Run by a team.</p>'
    + '<p style="font-family:Inter,sans-serif;font-size:12px;color:var(--t3);line-height:1.6;margin:0">Four AI employees that plan, write, edit, and produce content for your brand.</p>'
    + '</td>'
    + '<td style="vertical-align:top;text-align:right;padding:0 0 40px 0;white-space:nowrap">'
    + '<div style="font-family:JetBrains Mono,monospace;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--t3);margin-bottom:10px">Company</div>'
    + '<a href="#" id="vx-wl-contact-footer" style="display:block;font-family:Inter,sans-serif;font-size:13px;color:var(--t2);text-decoration:none;margin-bottom:8px">Contact</a>'
    + '<a href="#" id="vx-wl-terms" style="display:block;font-family:Inter,sans-serif;font-size:13px;color:var(--t2);text-decoration:none;margin-bottom:8px">Terms</a>'
    + '<a href="#" id="vx-wl-privacy" style="display:block;font-family:Inter,sans-serif;font-size:13px;color:var(--t2);text-decoration:none;margin-bottom:8px">Privacy</a>'
    + '<a href="#" id="vx-wl-security" style="display:block;font-family:Inter,sans-serif;font-size:13px;color:var(--t2);text-decoration:none">Security</a>'
    + '</td></tr></table>'
    + '<table style="width:100%;border-collapse:collapse;border-top:1px solid var(--b1)"><tr>'
    + '<td style="padding:20px 0 0;font-family:JetBrains Mono,monospace;font-size:10px;color:var(--t3);letter-spacing:.04em">\u00A9 ' + new Date().getFullYear() + ' Sovexa</td>'
    + '<td style="padding:20px 0 0;font-family:JetBrains Mono,monospace;font-size:10px;color:var(--t3);letter-spacing:.04em;text-align:right">Built for creators</td>'
    + '</tr></table>'
    + '</footer>'

  // ── Helper functions for HTML generation ──

  function agentRow(key, init, name, tasks) {
    return '<div class="agent" data-k="' + key + '">'
      + '<div class="av">' + init + '</div>'
      + '<div class="mid"><div class="nm">' + name + '</div><div class="task" data-tasks=\'' + JSON.stringify(tasks) + '\'>' + tasks[0] + '</div></div>'
      + '<div class="rt"><span class="sdot"></span><span>IDLE</span></div>'
      + '<div class="bar"></div>'
      + '</div>'
  }

  function tCard(init, name, role, quote, skills, delay) {
    return '<div class="t-card reveal ' + delay + '">'
      + '<div class="av">' + init + '</div>'
      + '<div class="nm"><em>' + name + '</em></div>'
      + '<div class="rl">' + role + '</div>'
      + '<div class="bio">' + quote + '</div>'
      + '<div class="skills">' + skills.map(function(s) { return '<span>' + s + '</span>' }).join('') + '</div>'
      + '</div>'
  }

  function pCard(num, title, desc, time) {
    return '<div class="reveal" style="background:var(--bg);padding:44px 36px">'
      + '<div style="font-family:Cormorant Garamond,Georgia,serif;font-size:72px;font-weight:300;color:var(--b2);line-height:1;margin-bottom:20px">' + num + '</div>'
      + '<h3 style="font-family:Syne,sans-serif;font-size:14px;font-weight:700;letter-spacing:.02em;margin:0 0 10px;color:var(--t1)">' + title + '</h3>'
      + '<p style="font-family:Inter,sans-serif;font-size:13px;color:var(--t2);line-height:1.72;margin:0 0 14px">' + desc + '</p>'
      + '<span style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--t3);border:1px solid var(--b1);border-radius:8px;padding:3px 12px">' + time + '</span>'
      + '</div>'
  }

  document.body.appendChild(overlay)

  // ── Stars ──
  var starHost = document.getElementById('wl-stars')
  if (starHost) {
    for (var i = 0; i < 20; i++) {
      var s = document.createElement('span')
      s.style.left = Math.random() * 100 + '%'
      s.style.top = Math.random() * 100 + '%'
      s.style.animationDelay = (Math.random() * 4).toFixed(1) + 's'
      starHost.appendChild(s)
    }
  }

  // ── Pipeline animation (cascade like home page) ──
  var agents = overlay.querySelectorAll('.agent')
  var connectors = overlay.querySelectorAll('.agent-connector')
  agents.forEach(function(a, i) {
    setTimeout(function() {
      a.classList.add('active')
      var rt = a.querySelector('.rt span:last-child')
      if (rt) rt.textContent = 'WORKING'
      if (i > 0 && connectors[i - 1]) connectors[i - 1].classList.add('handoff')
    }, i * 1400)
  })
  agents.forEach(function(a, i) {
    var taskEl = a.querySelector('.task')
    if (!taskEl || !taskEl.dataset.tasks) return
    var tasks = JSON.parse(taskEl.dataset.tasks)
    var ti = 0
    setTimeout(function() {
      setInterval(function() {
        ti = (ti + 1) % tasks.length
        taskEl.style.opacity = 0
        setTimeout(function() { taskEl.innerHTML = tasks[ti]; taskEl.style.opacity = 1 }, 200)
      }, 2800 + i * 500)
    }, 1500 + i * 1400)
  })

  // ── Ticker micro-updates ──
  var tkP = document.getElementById('wl-tk-posts')
  var tkR = document.getElementById('wl-tk-reach')
  var tkH = document.getElementById('wl-tk-hrs')
  if (tkP && tkR && tkH) {
    var p = 21, r = 1.8, h = 28.4
    setInterval(function() {
      if (Math.random() > 0.6) { p++; tkP.innerHTML = '<em>' + p + '</em> posts' }
      if (Math.random() > 0.4) { r = +(r + Math.random() * 0.03).toFixed(2); tkR.innerHTML = '<em>' + r + '</em>M' }
      if (Math.random() > 0.5) { h = +(h + 0.1).toFixed(1); tkH.innerHTML = '<em>' + h + '</em>h saved' }
    }, 2200)
  }

  // ── Reveal animations on scroll ──
  var reveals = overlay.querySelectorAll('.reveal')
  if (reveals.length) {
    var io = new IntersectionObserver(function(entries) {
      entries.forEach(function(e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) }
      })
    }, { threshold: 0.1, rootMargin: '0px 0px -5% 0px', root: overlay })
    reveals.forEach(function(el) { io.observe(el) })
  }

  // ── Waitlist count ──
  fetch('/api/waitlist/count').then(function(r) { return r.json() }).then(function(d) {
    var el = document.getElementById('vx-wl-count')
    if (d.count > 0 && el) el.innerHTML = '<em>' + d.count + '</em> creators on the list'
  }).catch(function() {})

  // ── Form submit — create account + join waitlist ──
  document.getElementById('vx-wl-form').addEventListener('submit', function(e) {
    e.preventDefault()
    var btn = document.getElementById('vx-wl-btn')
    var errEl = document.getElementById('vx-wl-error')
    var email = document.getElementById('vx-wl-email').value.trim()
    var name = document.getElementById('vx-wl-name').value.trim()
    var username = document.getElementById('vx-wl-username').value.trim()
    var password = document.getElementById('vx-wl-password').value
    errEl.textContent = ''

    if (!email || !username || !password || !name) { errEl.textContent = 'All fields are required.'; return }
    if (name.length > 120) { errEl.textContent = 'Name is too long.'; return }
    if (username.length < 3) { errEl.textContent = 'Username must be at least 3 characters.'; return }
    if (username.length > 30) { errEl.textContent = 'Username must be under 30 characters.'; return }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) { errEl.textContent = 'Username can only contain letters, numbers, and underscores.'; return }
    if (password.length < 8) { errEl.textContent = 'Password must be at least 8 characters.'; return }
    if (!/[A-Z]/.test(password)) { errEl.textContent = 'Password must contain at least one uppercase letter.'; return }
    if (!/[0-9]/.test(password)) { errEl.textContent = 'Password must contain at least one number.'; return }

    btn.textContent = 'Creating account...'
    btn.disabled = true

    fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, username: username, password: password, fullName: name })
    })
    .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d } }) })
    .then(function(res) {
      if (!res.ok) {
        var msg = res.data.error || 'Account creation failed'
        if (msg === 'email_taken') msg = res.data.message || 'An account with this email already exists.'
        if (msg === 'username_taken') msg = res.data.message || 'This username is already taken.'
        if (msg === 'email_or_username_in_use') msg = 'An account with this email or username already exists.'
        if (msg === 'invalid_input') {
          var issues = res.data.issues
          msg = (issues && issues.length > 0) ? issues[0].message : 'Please check all fields and try again.'
        }
        errEl.textContent = msg
        btn.textContent = 'Create account \u2192'
        btn.disabled = false
        return
      }
      fetch('/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, name: name }) }).catch(function() {})
      document.getElementById('vx-wl-form').style.display = 'none'
      document.getElementById('vx-wl-success').style.display = 'block'
      var countEl = document.getElementById('vx-wl-count')
      if (countEl) countEl.style.display = 'none'
    })
    .catch(function() {
      errEl.textContent = 'Something went wrong. Please try again.'
      btn.textContent = 'Create account \u2192'
      btn.disabled = false
    })
  })

  // ── Focus styling ──
  overlay.querySelectorAll('input').forEach(function(inp) {
    inp.addEventListener('focus', function() { inp.style.borderColor = 'var(--accent)' })
    inp.addEventListener('blur', function() { inp.style.borderColor = 'var(--b2)' })
  })

  // ── Smooth scroll for nav links ──
  overlay.querySelectorAll('a[href^="#vx-wl-"]').forEach(function(a) {
    a.addEventListener('click', function(e) {
      e.preventDefault()
      var target = document.querySelector(a.getAttribute('href'))
      if (target) target.scrollIntoView({ behavior: 'smooth' })
    })
  })

  // ── Legal modals ──
  var legalContent = {
    terms: { title: 'Terms of Service', body: '<p><strong>Last updated:</strong> April 2026</p><p>By using Sovexa you agree to these terms. You must be 18+. You retain full ownership of all content you create. We do not sell your data. Paid plans are billed monthly \u2014 cancel anytime. AI outputs should be reviewed before publishing.</p><p>Questions? <a href="mailto:hello@sovexa.ai" style="color:var(--accent)">hello@sovexa.ai</a></p>' },
    privacy: { title: 'Privacy Policy', body: '<p><strong>Last updated:</strong> April 2026</p><p>We collect: account data, brand data, platform data (via OAuth), and usage data. We never sell data, share content, store social passwords, or train models on your content. One session cookie for auth \u2014 no tracking.</p><p><a href="mailto:hello@sovexa.ai" style="color:var(--accent)">hello@sovexa.ai</a></p>' },
    security: { title: 'Security', body: '<p><strong>Last updated:</strong> April 2026</p><p>AWS infrastructure (SOC 2, ISO 27001). RDS PostgreSQL encrypted at rest. TLS 1.2+ in transit. JWT + httpOnly cookies + bcrypt passwords. Rate limiting. OAuth for social accounts. Payments via Stripe (PCI DSS Level 1).</p><p>Report vulnerabilities: <a href="mailto:security@sovexa.ai" style="color:var(--accent)">security@sovexa.ai</a></p>' },
  }

  function openLegal(kind) {
    var existing = document.getElementById('vx-wl-legal')
    if (existing) existing.remove()
    var info = legalContent[kind]
    if (!info) return
    var m = document.createElement('div')
    m.id = 'vx-wl-legal'
    m.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);padding:24px'
    m.innerHTML = '<div style="width:100%;max-width:520px;max-height:80vh;overflow-y:auto;background:var(--s1);border:1px solid var(--b1);border-radius:14px;padding:32px;color:var(--t1);font-family:Inter,sans-serif">'
      + '<h3 style="font-family:Cormorant Garamond,Georgia,serif;font-size:24px;font-weight:400;margin:0 0 20px">' + info.title + '</h3>'
      + '<div style="color:var(--t2);font-size:13px;line-height:1.7;margin:0 0 24px">' + info.body + '</div>'
      + '<div style="text-align:right;border-top:1px solid var(--b1);padding-top:16px"><button id="vx-wl-legal-close" class="btn-primary" style="padding:10px 20px;font-size:12px">Close</button></div>'
      + '</div>'
    m.addEventListener('click', function(e) { if (e.target === m) m.remove() })
    document.body.appendChild(m)
    document.getElementById('vx-wl-legal-close').addEventListener('click', function() { m.remove() })
  }

  document.getElementById('vx-wl-terms').addEventListener('click', function(e) { e.preventDefault(); openLegal('terms') })
  document.getElementById('vx-wl-privacy').addEventListener('click', function(e) { e.preventDefault(); openLegal('privacy') })
  document.getElementById('vx-wl-security').addEventListener('click', function(e) { e.preventDefault(); openLegal('security') })

  // Contact modal
  function openContact() {
    var existing = document.getElementById('vx-wl-contact')
    if (existing) existing.remove()
    var m = document.createElement('div')
    m.id = 'vx-wl-contact'
    m.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);padding:24px'
    m.innerHTML = '<div style="width:100%;max-width:480px;background:var(--s1);border:1px solid var(--b1);border-radius:14px;padding:32px;color:var(--t1);font-family:Inter,sans-serif">'
      + '<h3 style="font-family:Cormorant Garamond,Georgia,serif;font-size:24px;font-weight:400;margin:0 0 6px">Get in touch.</h3>'
      + '<p style="font-size:13px;color:var(--t2);margin:0 0 24px">We reply within one business day.</p>'
      + '<form id="vx-wl-contact-form" style="display:flex;flex-direction:column;gap:12px">'
      + '<input name="name" type="text" placeholder="Your name" required style="padding:12px 16px;border-radius:8px;border:1px solid var(--b1);background:var(--s2);font:14px Inter,sans-serif;color:var(--t1);outline:none" />'
      + '<input name="email" type="email" placeholder="Your email" required style="padding:12px 16px;border-radius:8px;border:1px solid var(--b1);background:var(--s2);font:14px Inter,sans-serif;color:var(--t1);outline:none" />'
      + '<textarea name="message" rows="4" placeholder="Your message" required style="padding:12px 16px;border-radius:8px;border:1px solid var(--b1);background:var(--s2);font:14px Inter,sans-serif;color:var(--t1);outline:none;resize:vertical"></textarea>'
      + '<button type="submit" class="btn-primary" style="padding:12px 24px">Send message</button>'
      + '</form>'
      + '<div id="vx-wl-contact-done" style="display:none;text-align:center;padding:20px 0">'
      + '<h4 style="font-family:Cormorant Garamond,Georgia,serif;font-size:22px;font-weight:400;font-style:italic;margin:0 0 8px">Got it \u2014 talk soon.</h4>'
      + '<p style="font-size:13px;color:var(--t2);margin:0">We\'ll reply within one business day.</p>'
      + '</div></div>'
    m.addEventListener('click', function(e) { if (e.target === m) m.remove() })
    document.body.appendChild(m)
    document.getElementById('vx-wl-contact-form').addEventListener('submit', function(e) {
      e.preventDefault()
      var f = e.target
      fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.name.value, email: f.email.value, message: f.message.value }) }).catch(function() {})
      document.getElementById('vx-wl-contact-form').style.display = 'none'
      document.getElementById('vx-wl-contact-done').style.display = 'block'
    })
  }

  document.getElementById('vx-wl-contact-link').addEventListener('click', function(e) { e.preventDefault(); openContact() })
  document.getElementById('vx-wl-contact-footer').addEventListener('click', function(e) { e.preventDefault(); openContact() })
})()
