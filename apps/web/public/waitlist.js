/* Waitlist gate — the ONLY screen non-logged-in visitors can reach.
 * Renders immediately (behind the intro overlay) so there's no flash
 * when the demo dissolves. Full scrollable page with header, waitlist
 * form, team section, process section, and footer.
 */
;(function () {
  if (document.cookie.indexOf('vx_session') !== -1) return

  var overlay = document.createElement('div')
  overlay.id = 'vx-waitlist'
  // Visible from the start, sits behind the intro overlay (z-index 99999)
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9998;background:#faf9f7;overflow-y:auto;overflow-x:hidden'

  overlay.innerHTML = ''

    // ─── HEADER ──────────────────────────────────────────────────
    + '<header style="padding:20px 40px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(0,0,0,.06)">'
    + '<div style="font-family:Syne,sans-serif;font-weight:700;font-size:14px;letter-spacing:.12em;text-transform:uppercase;color:#1a1a1a">SOVEXA</div>'
    + '<div style="font-size:12px;color:#aaa">Coming soon</div>'
    + '</header>'

    // ─── HERO / WAITLIST FORM ────────────────────────────────────
    + '<section style="display:flex;align-items:center;justify-content:center;flex-direction:column;padding:80px 20px 60px;text-align:center">'
    + '<div style="max-width:520px;width:100%">'

    + '<h1 style="font-family:Cormorant Garamond,Georgia,serif;font-size:clamp(36px,6vw,56px);font-weight:300;font-style:italic;color:#1a1a1a;line-height:1.08;letter-spacing:-.03em;margin:0 0 16px">Your AI content team<br>is <span style="color:#d4a574">almost ready.</span></h1>'
    + '<p style="font-family:DM Sans,sans-serif;font-size:16px;line-height:1.7;color:#888;margin:0 0 40px">Join the early access list. Be first to get your team working for you.</p>'

    // Form
    + '<form id="vx-wl-form" style="display:flex;flex-direction:column;gap:12px;max-width:400px;margin:0 auto">'
    + '<input id="vx-wl-name" type="text" placeholder="Your name (optional)" style="padding:14px 18px;border-radius:8px;border:1px solid rgba(0,0,0,.1);background:#fff;font:15px DM Sans,sans-serif;color:#1a1a1a;outline:none;transition:border-color .2s" />'
    + '<input id="vx-wl-email" type="email" placeholder="Your email" required style="padding:14px 18px;border-radius:8px;border:1px solid rgba(0,0,0,.1);background:#fff;font:15px DM Sans,sans-serif;color:#1a1a1a;outline:none;transition:border-color .2s" />'
    + '<button type="submit" id="vx-wl-btn" style="padding:14px 28px;border-radius:8px;border:none;background:#d4a574;color:#0a0a0a;font:600 14px/1 DM Sans,sans-serif;letter-spacing:.04em;text-transform:uppercase;cursor:pointer;transition:all .3s;box-shadow:0 4px 20px rgba(212,165,116,.25)">Join the waitlist</button>'
    + '</form>'

    // Social proof
    + '<div id="vx-wl-count" style="margin-top:16px;font-size:12px;color:#aaa"></div>'

    // Success state (hidden)
    + '<div id="vx-wl-success" style="display:none;max-width:400px;margin:0 auto">'
    + '<div style="width:56px;height:56px;border-radius:50%;background:rgba(52,210,122,.1);display:flex;align-items:center;justify-content:center;margin:0 auto 20px"><svg width="24" height="24" fill="none" stroke="#34d27a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>'
    + '<h2 style="font-family:Cormorant Garamond,Georgia,serif;font-size:28px;font-weight:300;font-style:italic;color:#1a1a1a;margin:0 0 12px">Thank you for joining.</h2>'
    + '<p style="font-size:14px;color:#888;line-height:1.6;margin:0">We\'ll send you an email the moment your AI content team is ready.</p>'
    + '</div>'

    + '</div>'
    + '</section>'

    // ─── YOUR AI TEAM (matches home page team-row layout) ─────────
    + '<section style="padding:clamp(60px,8vw,100px) 20px">'
    + '<div style="max-width:960px;margin:0 auto">'
    + '<div style="margin-bottom:clamp(48px,6vw,80px);text-align:center">'
    + '<span style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#b0b0b0;display:block;margin-bottom:20px;font-weight:500">Your AI team</span>'
    + '<h2 style="font-family:Cormorant Garamond,Georgia,serif;font-size:clamp(38px,5vw,68px);font-weight:300;font-style:italic;color:#1a1a1a;margin:0 0 16px;letter-spacing:-.02em;line-height:1.08">Meet your staff.</h2>'
    + '<p style="font-size:15px;color:#888;line-height:1.7;max-width:540px;margin:0 auto">Four specialized AI employees — each with a distinct role, personality, and expertise. They know your niche, learn your brand, and deliver work without being asked.</p>'
    + '</div>'

    // Team rows
    + '<div style="display:flex;flex-direction:column;gap:1px;background:rgba(0,0,0,.06);border:1px solid rgba(0,0,0,.06);border-radius:16px;overflow:hidden">'

    // Maya
    + '<div style="display:grid;grid-template-columns:180px 1fr auto;background:#faf9f7;transition:background .25s">'
    + '<div style="padding:44px 40px;border-right:1px solid rgba(0,0,0,.06);display:flex;align-items:flex-start"><span style="font-family:Cormorant Garamond,Georgia,serif;font-size:56px;font-weight:300;color:rgba(0,0,0,.08);line-height:1;letter-spacing:-.02em">01</span></div>'
    + '<div style="padding:44px 48px">'
    + '<div style="font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#b0b0b0;margin-bottom:10px">Trend &amp; Insights Analyst</div>'
    + '<div style="font-family:Cormorant Garamond,Georgia,serif;font-size:34px;font-weight:300;font-style:italic;letter-spacing:-.01em;margin-bottom:14px;color:#1a1a1a">Maya</div>'
    + '<div style="font-size:14px;color:#888;line-height:1.75;max-width:500px;margin-bottom:18px">Monitors your niche daily across Reddit, news, research, and YouTube. Every Monday she delivers a trend report — what is rising, why it matters, what to make this week.</div>'
    + '<div style="display:flex;flex-wrap:wrap;gap:6px"><span style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#b0b0b0;padding:4px 12px;border:1px solid rgba(0,0,0,.06);border-radius:8px">Trend reports</span><span style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#b0b0b0;padding:4px 12px;border:1px solid rgba(0,0,0,.06);border-radius:8px">Viral hooks</span><span style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#b0b0b0;padding:4px 12px;border:1px solid rgba(0,0,0,.06);border-radius:8px">Knowledge feed</span></div>'
    + '</div>'
    + '<div style="padding:40px 36px;border-left:1px solid rgba(0,0,0,.06);display:flex;align-items:flex-start"><span style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#b0b0b0">Delivers Monday 9am</span></div>'
    + '</div>'

    // Jordan
    + '<div style="display:grid;grid-template-columns:180px 1fr auto;background:#faf9f7;transition:background .25s">'
    + '<div style="padding:44px 40px;border-right:1px solid rgba(0,0,0,.06);display:flex;align-items:flex-start"><span style="font-family:Cormorant Garamond,Georgia,serif;font-size:56px;font-weight:300;color:rgba(0,0,0,.08);line-height:1;letter-spacing:-.02em">02</span></div>'
    + '<div style="padding:44px 48px">'
    + '<div style="font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#b0b0b0;margin-bottom:10px">Content Strategist</div>'
    + '<div style="font-family:Cormorant Garamond,Georgia,serif;font-size:34px;font-weight:300;font-style:italic;letter-spacing:-.01em;margin-bottom:14px;color:#1a1a1a">Jordan</div>'
    + '<div style="font-size:14px;color:#888;line-height:1.75;max-width:500px;margin-bottom:18px">Builds your weekly content plan, defines your pillars, and keeps your brand growing consistently. Briefs Alex automatically once you approve.</div>'
    + '<div style="display:flex;flex-wrap:wrap;gap:6px"><span style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#b0b0b0;padding:4px 12px;border:1px solid rgba(0,0,0,.06);border-radius:8px">Content calendar</span><span style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#b0b0b0;padding:4px 12px;border:1px solid rgba(0,0,0,.06);border-radius:8px">Strategy</span><span style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#b0b0b0;padding:4px 12px;border:1px solid rgba(0,0,0,.06);border-radius:8px">Pipeline</span></div>'
    + '</div>'
    + '<div style="padding:40px 36px;border-left:1px solid rgba(0,0,0,.06);display:flex;align-items:flex-start"><span style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#b0b0b0">Delivers Sunday 7pm</span></div>'
    + '</div>'

    // Alex
    + '<div style="display:grid;grid-template-columns:180px 1fr auto;background:#faf9f7;transition:background .25s">'
    + '<div style="padding:44px 40px;border-right:1px solid rgba(0,0,0,.06);display:flex;align-items:flex-start"><span style="font-family:Cormorant Garamond,Georgia,serif;font-size:56px;font-weight:300;color:rgba(0,0,0,.08);line-height:1;letter-spacing:-.02em">03</span></div>'
    + '<div style="padding:44px 48px">'
    + '<div style="font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#b0b0b0;margin-bottom:10px">Copywriter &amp; Script Writer</div>'
    + '<div style="font-family:Cormorant Garamond,Georgia,serif;font-size:34px;font-weight:300;font-style:italic;letter-spacing:-.01em;margin-bottom:14px;color:#1a1a1a">Alex</div>'
    + '<div style="font-size:14px;color:#888;line-height:1.75;max-width:500px;margin-bottom:18px">Writes hooks, captions, Reel scripts, and carousels in your voice. Delivers multiple variations so you choose. Has strong opinions about which hook is the right one.</div>'
    + '<div style="display:flex;flex-wrap:wrap;gap:6px"><span style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#b0b0b0;padding:4px 12px;border:1px solid rgba(0,0,0,.06);border-radius:8px">Hooks</span><span style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#b0b0b0;padding:4px 12px;border:1px solid rgba(0,0,0,.06);border-radius:8px">Reel scripts</span><span style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#b0b0b0;padding:4px 12px;border:1px solid rgba(0,0,0,.06);border-radius:8px">Captions</span></div>'
    + '</div>'
    + '<div style="padding:40px 36px;border-left:1px solid rgba(0,0,0,.06);display:flex;align-items:flex-start"><span style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#b0b0b0">After Jordan approves</span></div>'
    + '</div>'

    // Riley
    + '<div style="display:grid;grid-template-columns:180px 1fr auto;background:#faf9f7;transition:background .25s">'
    + '<div style="padding:44px 40px;border-right:1px solid rgba(0,0,0,.06);display:flex;align-items:flex-start"><span style="font-family:Cormorant Garamond,Georgia,serif;font-size:56px;font-weight:300;color:rgba(0,0,0,.08);line-height:1;letter-spacing:-.02em">04</span></div>'
    + '<div style="padding:44px 48px">'
    + '<div style="font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#b0b0b0;margin-bottom:10px">Creative Director</div>'
    + '<div style="font-family:Cormorant Garamond,Georgia,serif;font-size:34px;font-weight:300;font-style:italic;letter-spacing:-.01em;margin-bottom:14px;color:#1a1a1a">Riley</div>'
    + '<div style="font-size:14px;color:#888;line-height:1.75;max-width:500px;margin-bottom:18px">Turns scripts into production-ready shot lists and visual direction. Tells you exactly what to film, how to pace it, where to put text overlays, and what audio to use.</div>'
    + '<div style="display:flex;flex-wrap:wrap;gap:6px"><span style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#b0b0b0;padding:4px 12px;border:1px solid rgba(0,0,0,.06);border-radius:8px">Shot lists</span><span style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#b0b0b0;padding:4px 12px;border:1px solid rgba(0,0,0,.06);border-radius:8px">Visual direction</span><span style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#b0b0b0;padding:4px 12px;border:1px solid rgba(0,0,0,.06);border-radius:8px">Video generation</span></div>'
    + '</div>'
    + '<div style="padding:40px 36px;border-left:1px solid rgba(0,0,0,.06);display:flex;align-items:flex-start"><span style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#b0b0b0">After Alex delivers</span></div>'
    + '</div>'

    + '</div>'
    + '</div>'
    + '</section>'

    // ─── PROCESS (matches home page how-grid layout) ─────────────
    + '<section style="padding:clamp(60px,8vw,100px) 20px;border-top:1px solid rgba(0,0,0,.06)">'
    + '<div style="max-width:960px;margin:0 auto">'
    + '<div style="margin-bottom:clamp(48px,6vw,80px);text-align:center">'
    + '<span style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#b0b0b0;display:block;margin-bottom:20px;font-weight:500">Process</span>'
    + '<h2 style="font-family:Cormorant Garamond,Georgia,serif;font-size:clamp(38px,5vw,68px);font-weight:300;font-style:italic;color:#1a1a1a;margin:0 0 16px;letter-spacing:-.02em;line-height:1.08">From sign-up to first output <em style="color:#b0b0b0;font-weight:300">in five minutes.</em></h2>'
    + '<p style="font-size:15px;color:#888;line-height:1.7;max-width:540px;margin:0 auto">No learning curve. No complex setup. Tell Sovexa what you create — your team is ready to work.</p>'
    + '</div>'

    // 4-column grid
    + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:rgba(0,0,0,.06);border:1px solid rgba(0,0,0,.06);border-radius:16px;overflow:hidden">'

    + '<div style="background:#faf9f7;padding:44px 36px">'
    + '<div style="font-family:Cormorant Garamond,Georgia,serif;font-size:72px;font-weight:300;color:rgba(0,0,0,.06);line-height:1;margin-bottom:20px">01</div>'
    + '<h3 style="font-family:Syne,sans-serif;font-size:14px;font-weight:700;letter-spacing:.02em;margin:0 0 10px;color:#1a1a1a">Set your niche</h3>'
    + '<p style="font-size:13px;color:#888;line-height:1.72;margin:0 0 14px">Choose your content category and optionally a sub-niche. Your team specializes instantly.</p>'
    + '<span style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#b0b0b0;border:1px solid rgba(0,0,0,.06);border-radius:8px;padding:3px 12px">2 minutes</span>'
    + '</div>'

    + '<div style="background:#faf9f7;padding:44px 36px">'
    + '<div style="font-family:Cormorant Garamond,Georgia,serif;font-size:72px;font-weight:300;color:rgba(0,0,0,.06);line-height:1;margin-bottom:20px">02</div>'
    + '<h3 style="font-family:Syne,sans-serif;font-size:14px;font-weight:700;letter-spacing:.02em;margin:0 0 10px;color:#1a1a1a">Define your brand</h3>'
    + '<p style="font-size:13px;color:#888;line-height:1.72;margin:0 0 14px">Select your tone, describe your audience, and share your goals. The more context, the better your team sounds.</p>'
    + '<span style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#b0b0b0;border:1px solid rgba(0,0,0,.06);border-radius:8px;padding:3px 12px">2 minutes</span>'
    + '</div>'

    + '<div style="background:#faf9f7;padding:44px 36px">'
    + '<div style="font-family:Cormorant Garamond,Georgia,serif;font-size:72px;font-weight:300;color:rgba(0,0,0,.06);line-height:1;margin-bottom:20px">03</div>'
    + '<h3 style="font-family:Syne,sans-serif;font-size:14px;font-weight:700;letter-spacing:.02em;margin:0 0 10px;color:#1a1a1a">Your team delivers</h3>'
    + '<p style="font-size:13px;color:#888;line-height:1.72;margin:0 0 14px">Maya pulls trends immediately. Jordan drafts your first plan. Real structured outputs — not a blank dashboard.</p>'
    + '<span style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#b0b0b0;border:1px solid rgba(0,0,0,.06);border-radius:8px;padding:3px 12px">1 minute</span>'
    + '</div>'

    + '<div style="background:#faf9f7;padding:44px 36px">'
    + '<div style="font-family:Cormorant Garamond,Georgia,serif;font-size:72px;font-weight:300;color:rgba(0,0,0,.06);line-height:1;margin-bottom:20px">04</div>'
    + '<h3 style="font-family:Syne,sans-serif;font-size:14px;font-weight:700;letter-spacing:.02em;margin:0 0 10px;color:#1a1a1a">Approve and repeat</h3>'
    + '<p style="font-size:13px;color:#888;line-height:1.72;margin:0 0 14px">Review outputs with action buttons. Approve triggers the next step automatically. Every decision trains your team.</p>'
    + '<span style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#b0b0b0;border:1px solid rgba(0,0,0,.06);border-radius:8px;padding:3px 12px">Daily habit</span>'
    + '</div>'

    + '</div>'
    + '</div>'
    + '</section>'

    // ─── FOOTER ──────────────────────────────────────────────────
    + '<footer style="padding:64px 40px 32px;border-top:1px solid rgba(0,0,0,.06);background:#0a0a0a;color:#edede9">'
    + '<div style="max-width:900px;margin:0 auto;display:grid;grid-template-columns:2fr 1fr;gap:48px;margin-bottom:40px">'

    // Brand column
    + '<div>'
    + '<div style="font-family:Cormorant Garamond,Georgia,serif;font-size:24px;font-weight:300;font-style:italic;margin-bottom:10px;color:#edede9">Sovexa</div>'
    + '<p style="font-size:13px;color:rgba(255,255,255,.4);line-height:1.6;margin:0 0 6px;font-style:italic">Your content. Run by a team.</p>'
    + '<p style="font-size:12px;color:rgba(255,255,255,.25);line-height:1.6;margin:0;max-width:340px">Four AI specialists — analyst, strategist, copywriter, creative director — that plan, write, and produce content for your brand.</p>'
    + '</div>'

    // Company column
    + '<div style="display:flex;flex-direction:column;gap:10px">'
    + '<div style="font-family:Syne,sans-serif;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.3);margin-bottom:4px">Company</div>'
    + '<a href="mailto:hello@sovexa.ai" style="font-size:13px;color:rgba(255,255,255,.45);text-decoration:none">Contact</a>'
    + '<a href="#" id="vx-wl-terms" style="font-size:13px;color:rgba(255,255,255,.45);text-decoration:none">Terms</a>'
    + '<a href="#" id="vx-wl-privacy" style="font-size:13px;color:rgba(255,255,255,.45);text-decoration:none">Privacy</a>'
    + '<a href="#" id="vx-wl-security" style="font-size:13px;color:rgba(255,255,255,.45);text-decoration:none">Security</a>'
    + '</div>'

    + '</div>'

    // Bottom bar
    + '<div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid rgba(255,255,255,.06);padding-top:20px;font-size:11px;color:rgba(255,255,255,.2)">'
    + '<span>&copy; ' + new Date().getFullYear() + ' Sovexa. Built for content businesses.</span>'
    + '<span style="font-style:italic">v1.0 &middot; made for creators</span>'
    + '</div>'
    + '</footer>'

  document.body.appendChild(overlay)

  // Fetch count immediately
  fetchCount()

  function fetchCount() {
    fetch('/api/waitlist/count').then(function (r) { return r.json() }).then(function (d) {
      if (d.count > 0) {
        document.getElementById('vx-wl-count').textContent = d.count + (d.count === 1 ? ' person' : ' people') + ' on the list'
      }
    }).catch(function () {})
  }

  // Handle form submit
  document.getElementById('vx-wl-form').addEventListener('submit', function (e) {
    e.preventDefault()
    var btn = document.getElementById('vx-wl-btn')
    var email = document.getElementById('vx-wl-email').value.trim()
    var name = document.getElementById('vx-wl-name').value.trim()
    if (!email) return

    btn.textContent = 'Joining...'
    btn.disabled = true

    fetch('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, name: name || undefined }),
    })
      .then(function (r) { return r.json() })
      .then(function (d) {
        if (d.ok) {
          document.getElementById('vx-wl-form').style.display = 'none'
          document.getElementById('vx-wl-success').style.display = 'block'
          document.getElementById('vx-wl-count').style.display = 'none'
        } else {
          btn.textContent = 'Join the waitlist'
          btn.disabled = false
        }
      })
      .catch(function () {
        btn.textContent = 'Join the waitlist'
        btn.disabled = false
      })
  })

  // Focus styling
  var inputs = overlay.querySelectorAll('input')
  inputs.forEach(function (inp) {
    inp.addEventListener('focus', function () { inp.style.borderColor = '#d4a574' })
    inp.addEventListener('blur', function () { inp.style.borderColor = 'rgba(0,0,0,.1)' })
  })

  // Legal modals
  var legalContent = {
    terms: { title: 'Terms of Service', body: 'Terms of Service — placeholder. The full document is in legal review and ships with public launch. Reach out at hello@sovexa.ai if you need it sooner.' },
    privacy: { title: 'Privacy Policy', body: 'Privacy Policy — placeholder. We collect the minimum needed to run your AI content team: account and brand workspace data. We never sell your data. Full document at public launch.' },
    security: { title: 'Security', body: 'Security — placeholder. All data is encrypted at rest (PostgreSQL) and in transit (TLS). Full document at public launch.' },
  }

  function openLegal(kind) {
    var existing = document.getElementById('vx-wl-legal')
    if (existing) existing.remove()
    var info = legalContent[kind]
    if (!info) return
    var modal = document.createElement('div')
    modal.id = 'vx-wl-legal'
    modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);padding:24px'
    modal.innerHTML = '<div style="width:100%;max-width:480px;background:#fff;border-radius:14px;padding:28px;color:#1a1a1a;font-family:DM Sans,sans-serif">'
      + '<h3 style="font-family:Cormorant Garamond,Georgia,serif;font-size:22px;font-weight:400;margin:0 0 12px">' + info.title + '</h3>'
      + '<p style="color:#888;font-size:13px;line-height:1.6;margin:0 0 20px">' + info.body + '</p>'
      + '<div style="text-align:right"><button id="vx-wl-legal-close" style="background:#1a1a1a;color:#fff;border:none;padding:9px 18px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:600">Close</button></div>'
      + '</div>'
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove() })
    document.body.appendChild(modal)
    document.getElementById('vx-wl-legal-close').addEventListener('click', function () { modal.remove() })
  }

  document.getElementById('vx-wl-terms').addEventListener('click', function (e) { e.preventDefault(); openLegal('terms') })
  document.getElementById('vx-wl-privacy').addEventListener('click', function (e) { e.preventDefault(); openLegal('privacy') })
  document.getElementById('vx-wl-security').addEventListener('click', function (e) { e.preventDefault(); openLegal('security') })
})()
