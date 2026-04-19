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

    // ─── YOUR AI TEAM ────────────────────────────────────────────
    + '<section style="padding:60px 20px;background:#fff;border-top:1px solid rgba(0,0,0,.06)">'
    + '<div style="max-width:900px;margin:0 auto;text-align:center">'
    + '<div style="font-family:Syne,sans-serif;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#b0b0b0;margin-bottom:12px">YOUR AI TEAM</div>'
    + '<h2 style="font-family:Cormorant Garamond,Georgia,serif;font-size:clamp(28px,4vw,40px);font-weight:300;font-style:italic;color:#1a1a1a;margin:0 0 40px">Four employees. Zero management.</h2>'

    + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:20px;text-align:left">'

    // Maya
    + '<div style="background:#faf9f7;border:1px solid rgba(0,0,0,.06);border-radius:12px;padding:24px">'
    + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">'
    + '<div style="width:36px;height:36px;border-radius:50%;background:#6ab4ff;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff">M</div>'
    + '<div><div style="font-size:15px;font-weight:500;color:#1a1a1a">Maya</div><div style="font-size:11px;color:#aaa">Trend Analyst</div></div>'
    + '</div>'
    + '<p style="font-size:13px;color:#888;line-height:1.6;margin:0">Spots trends before they peak. Delivers data-driven reports every Monday.</p>'
    + '</div>'

    // Jordan
    + '<div style="background:#faf9f7;border:1px solid rgba(0,0,0,.06);border-radius:12px;padding:24px">'
    + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">'
    + '<div style="width:36px;height:36px;border-radius:50%;background:#c8f060;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#0a0a0a">J</div>'
    + '<div><div style="font-size:15px;font-weight:500;color:#1a1a1a">Jordan</div><div style="font-size:11px;color:#aaa">Content Strategist</div></div>'
    + '</div>'
    + '<p style="font-size:13px;color:#888;line-height:1.6;margin:0">Builds your weekly plan. Audits what\'s working. Designs your growth strategy.</p>'
    + '</div>'

    // Alex
    + '<div style="background:#faf9f7;border:1px solid rgba(0,0,0,.06);border-radius:12px;padding:24px">'
    + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">'
    + '<div style="width:36px;height:36px;border-radius:50%;background:#e8c87a;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#0a0a0a">A</div>'
    + '<div><div style="font-size:15px;font-weight:500;color:#1a1a1a">Alex</div><div style="font-size:11px;color:#aaa">Copywriter</div></div>'
    + '</div>'
    + '<p style="font-size:13px;color:#888;line-height:1.6;margin:0">Writes hooks that stop the scroll. Punchy, opinionated, always on-brand.</p>'
    + '</div>'

    // Riley
    + '<div style="background:#faf9f7;border:1px solid rgba(0,0,0,.06);border-radius:12px;padding:24px">'
    + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">'
    + '<div style="width:36px;height:36px;border-radius:50%;background:#b482ff;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff">R</div>'
    + '<div><div style="font-size:15px;font-weight:500;color:#1a1a1a">Riley</div><div style="font-size:11px;color:#aaa">Creative Director</div></div>'
    + '</div>'
    + '<p style="font-size:13px;color:#888;line-height:1.6;margin:0">Audits your feed. Analyzes format performance. Keeps the brand cohesive.</p>'
    + '</div>'

    + '</div>'
    + '</div>'
    + '</section>'

    // ─── HOW IT WORKS ────────────────────────────────────────────
    + '<section style="padding:60px 20px;border-top:1px solid rgba(0,0,0,.06)">'
    + '<div style="max-width:700px;margin:0 auto;text-align:center">'
    + '<div style="font-family:Syne,sans-serif;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#b0b0b0;margin-bottom:12px">HOW IT WORKS</div>'
    + '<h2 style="font-family:Cormorant Garamond,Georgia,serif;font-size:clamp(28px,4vw,40px);font-weight:300;font-style:italic;color:#1a1a1a;margin:0 0 48px">They work. <span style="color:#d4a574">You approve.</span></h2>'

    + '<div style="display:flex;flex-direction:column;gap:0;text-align:left;position:relative;padding-left:48px">'

    // Vertical line
    + '<div style="position:absolute;left:22px;top:8px;bottom:8px;width:2px;background:rgba(0,0,0,.06)"></div>'

    // Step 1
    + '<div style="position:relative;padding:16px 0">'
    + '<div style="position:absolute;left:-48px;width:36px;height:36px;border-radius:50%;background:#6ab4ff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;z-index:1">M</div>'
    + '<div style="font-size:15px;font-weight:500;color:#1a1a1a;margin-bottom:4px">Maya spots a trend</div>'
    + '<div style="font-size:13px;color:#888;line-height:1.5">She scans your niche daily and surfaces what\'s spiking — before your competitors see it.</div>'
    + '</div>'

    // Step 2
    + '<div style="position:relative;padding:16px 0">'
    + '<div style="position:absolute;left:-48px;width:36px;height:36px;border-radius:50%;background:#c8f060;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#0a0a0a;z-index:1">J</div>'
    + '<div style="font-size:15px;font-weight:500;color:#1a1a1a;margin-bottom:4px">Jordan builds the plan</div>'
    + '<div style="font-size:13px;color:#888;line-height:1.5">A week of content, structured around the trend. Formats, timing, and angles — all mapped out.</div>'
    + '</div>'

    // Step 3
    + '<div style="position:relative;padding:16px 0">'
    + '<div style="position:absolute;left:-48px;width:36px;height:36px;border-radius:50%;background:#e8c87a;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#0a0a0a;z-index:1">A</div>'
    + '<div style="font-size:15px;font-weight:500;color:#1a1a1a;margin-bottom:4px">Alex writes the copy</div>'
    + '<div style="font-size:13px;color:#888;line-height:1.5">Hooks, captions, scripts — written in your voice. Multiple options so you always have choices.</div>'
    + '</div>'

    // Step 4
    + '<div style="position:relative;padding:16px 0">'
    + '<div style="position:absolute;left:-48px;width:36px;height:36px;border-radius:50%;background:#b482ff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;z-index:1">R</div>'
    + '<div style="font-size:15px;font-weight:500;color:#1a1a1a;margin-bottom:4px">Riley directs the visuals</div>'
    + '<div style="font-size:13px;color:#888;line-height:1.5">Shot lists, pacing, editing notes. She makes sure your content looks as good as it reads.</div>'
    + '</div>'

    // Step 5 — CEO
    + '<div style="position:relative;padding:16px 0">'
    + '<div style="position:absolute;left:-48px;width:36px;height:36px;border-radius:50%;background:#d4a574;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#0a0a0a;z-index:1">YOU</div>'
    + '<div style="font-size:15px;font-weight:500;color:#1a1a1a;margin-bottom:4px">You approve and post</div>'
    + '<div style="font-size:13px;color:#888;line-height:1.5">Review what your team delivers. Approve, reject, or ask for changes. One tap.</div>'
    + '</div>'

    + '</div>'
    + '</div>'
    + '</section>'

    // ─── FOOTER ──────────────────────────────────────────────────
    + '<footer style="padding:40px 20px;border-top:1px solid rgba(0,0,0,.06);text-align:center">'
    + '<div style="font-family:Syne,sans-serif;font-weight:700;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#ccc;margin-bottom:8px">SOVEXA</div>'
    + '<div style="font-size:12px;color:#ccc">Your AI content team.</div>'
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
})()
