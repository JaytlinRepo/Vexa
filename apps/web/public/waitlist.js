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
    terms: {
      title: 'Terms of Service',
      body: '<p><strong>Last updated:</strong> April 19, 2026</p>'
        + '<p>By using Sovexa ("the Service"), you agree to these terms. Sovexa is operated by Sovexa Inc.</p>'
        + '<h4>1. Account</h4><p>You must provide accurate information when creating an account. You are responsible for all activity under your account. You must be 18 or older to use Sovexa.</p>'
        + '<h4>2. The Service</h4><p>Sovexa provides AI-powered content planning, writing, and strategy tools ("AI Employees"). Outputs are generated by artificial intelligence and should be reviewed before publishing. You retain full ownership of all content you create using the Service.</p>'
        + '<h4>3. Acceptable Use</h4><p>You may not use Sovexa to generate content that is illegal, harmful, misleading, or infringes on others\' rights. We reserve the right to suspend accounts that violate this policy.</p>'
        + '<h4>4. Subscriptions &amp; Billing</h4><p>Paid plans are billed monthly or annually. You may cancel anytime — access continues until the end of your billing period. Refunds are handled on a case-by-case basis within 7 days of purchase.</p>'
        + '<h4>5. Data &amp; Content</h4><p>You own your content. We do not claim rights to anything you create. We may use anonymized, aggregated data to improve the Service. We do not sell your personal data.</p>'
        + '<h4>6. Limitation of Liability</h4><p>Sovexa is provided "as is." We are not liable for content decisions made based on AI outputs, lost revenue, or service interruptions. Our liability is limited to the amount you paid in the last 12 months.</p>'
        + '<h4>7. Changes</h4><p>We may update these terms. Continued use after changes constitutes acceptance. Material changes will be communicated via email.</p>'
        + '<p>Questions? Contact us at <a href="mailto:hello@sovexa.ai" style="color:#d4a574">hello@sovexa.ai</a></p>'
    },
    privacy: {
      title: 'Privacy Policy',
      body: '<p><strong>Last updated:</strong> April 19, 2026</p>'
        + '<p>Your privacy matters. This policy explains what we collect, why, and how we protect it.</p>'
        + '<h4>What We Collect</h4>'
        + '<ul style="padding-left:20px;margin:8px 0">'
        + '<li><strong>Account data:</strong> Email, name, password (hashed, never stored in plain text)</li>'
        + '<li><strong>Brand data:</strong> Company name, niche, brand voice, audience, goals — used to personalize your AI team</li>'
        + '<li><strong>Platform data:</strong> Social media metrics you connect (followers, posts, engagement) — used for AI analysis only</li>'
        + '<li><strong>Usage data:</strong> How you interact with outputs (approvals, rejections) — used to train your AI team\'s memory</li>'
        + '</ul>'
        + '<h4>What We Never Do</h4>'
        + '<ul style="padding-left:20px;margin:8px 0">'
        + '<li>Sell your data to third parties</li>'
        + '<li>Share your content with other users</li>'
        + '<li>Store your social media passwords (OAuth tokens only)</li>'
        + '<li>Use your content to train models for other customers</li>'
        + '</ul>'
        + '<h4>Third-Party Services</h4><p>We use AWS (hosting, AI), Stripe (payments), and Resend (email). Each has their own privacy policy. We share only what\'s necessary for each service to function.</p>'
        + '<h4>Data Retention</h4><p>Your data is retained while your account is active. You may request deletion at any time by emailing <a href="mailto:hello@sovexa.ai" style="color:#d4a574">hello@sovexa.ai</a>. We will delete your data within 30 days.</p>'
        + '<h4>Cookies</h4><p>We use a single session cookie (vx_session) for authentication. No tracking cookies, no analytics cookies, no third-party ad cookies.</p>'
        + '<p>Questions? <a href="mailto:hello@sovexa.ai" style="color:#d4a574">hello@sovexa.ai</a></p>'
    },
    security: {
      title: 'Security',
      body: '<p><strong>Last updated:</strong> April 19, 2026</p>'
        + '<p>We take security seriously. Here\'s how we protect your data.</p>'
        + '<h4>Infrastructure</h4>'
        + '<ul style="padding-left:20px;margin:8px 0">'
        + '<li><strong>Hosting:</strong> AWS (us-east-1) — SOC 2, ISO 27001 certified infrastructure</li>'
        + '<li><strong>Database:</strong> AWS RDS PostgreSQL — encrypted at rest (AES-256), automated backups</li>'
        + '<li><strong>Storage:</strong> AWS S3 — server-side encryption, no public access</li>'
        + '</ul>'
        + '<h4>Application Security</h4>'
        + '<ul style="padding-left:20px;margin:8px 0">'
        + '<li><strong>Encryption:</strong> All data in transit uses TLS 1.2+</li>'
        + '<li><strong>Authentication:</strong> JWT sessions with httpOnly cookies, bcrypt-hashed passwords</li>'
        + '<li><strong>Rate limiting:</strong> Per-user rate limits on all API endpoints</li>'
        + '<li><strong>Input validation:</strong> Zod schema validation on all user inputs</li>'
        + '</ul>'
        + '<h4>Social Account Security</h4><p>When you connect Instagram or TikTok, we use OAuth — we never see or store your social media password. Tokens are stored encrypted and can be revoked by you at any time.</p>'
        + '<h4>Payment Security</h4><p>All payments are processed by Stripe. We never see or store your card number. Stripe is PCI DSS Level 1 certified.</p>'
        + '<h4>Reporting Vulnerabilities</h4><p>If you discover a security issue, please report it to <a href="mailto:security@sovexa.ai" style="color:#d4a574">security@sovexa.ai</a>. We take all reports seriously and will respond within 48 hours.</p>'
    },
  }

  function openLegal(kind) {
    var existing = document.getElementById('vx-wl-legal')
    if (existing) existing.remove()
    var info = legalContent[kind]
    if (!info) return
    var modal = document.createElement('div')
    modal.id = 'vx-wl-legal'
    modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);padding:24px'
    modal.innerHTML = '<div style="width:100%;max-width:560px;max-height:80vh;overflow-y:auto;background:#fff;border-radius:14px;padding:32px;color:#1a1a1a;font-family:DM Sans,sans-serif">'
      + '<h3 style="font-family:Cormorant Garamond,Georgia,serif;font-size:26px;font-weight:400;margin:0 0 20px">' + info.title + '</h3>'
      + '<div style="color:#555;font-size:13px;line-height:1.7;margin:0 0 24px">' + info.body + '</div>'
      + '<div style="text-align:right;border-top:1px solid rgba(0,0,0,.06);padding-top:16px"><button id="vx-wl-legal-close" style="background:#1a1a1a;color:#fff;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:600">Close</button></div>'
      + '</div>'
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove() })
    document.body.appendChild(modal)
    document.getElementById('vx-wl-legal-close').addEventListener('click', function () { modal.remove() })
  }

  document.getElementById('vx-wl-terms').addEventListener('click', function (e) { e.preventDefault(); openLegal('terms') })
  document.getElementById('vx-wl-privacy').addEventListener('click', function (e) { e.preventDefault(); openLegal('privacy') })
  document.getElementById('vx-wl-security').addEventListener('click', function (e) { e.preventDefault(); openLegal('security') })
})()
