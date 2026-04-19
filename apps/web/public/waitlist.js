/* Waitlist overlay — shows after the intro demo for non-logged-in visitors.
 * Captures email + optional name, posts to /api/waitlist, shows confirmation.
 * Logged-in users skip this entirely.
 */
;(function () {
  if (document.cookie.indexOf('vx_session') !== -1) return

  var overlay = document.createElement('div')
  overlay.id = 'vx-waitlist'
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9998;background:#faf9f7;display:flex;align-items:center;justify-content:center;flex-direction:column;opacity:0;transition:opacity .6s ease;pointer-events:none'

  overlay.innerHTML = ''
    + '<div style="max-width:480px;width:90%;text-align:center;padding:40px 20px">'

    // Logo
    + '<div style="font-family:Syne,sans-serif;font-weight:700;font-size:14px;letter-spacing:.12em;text-transform:uppercase;color:#1a1a1a;margin-bottom:48px">SOVEXA</div>'

    // Headline
    + '<h1 style="font-family:Cormorant Garamond,Georgia,serif;font-size:clamp(32px,5vw,48px);font-weight:300;font-style:italic;color:#1a1a1a;line-height:1.1;letter-spacing:-.02em;margin:0 0 16px">Your AI content team<br>is <span style="color:#d4a574">almost ready.</span></h1>'

    // Subtext
    + '<p style="font-family:DM Sans,sans-serif;font-size:15px;line-height:1.7;color:#888;margin:0 0 36px">Join the early access list. Be first to get Maya, Jordan, Alex, and Riley working for you.</p>'

    // Form
    + '<form id="vx-wl-form" style="display:flex;flex-direction:column;gap:12px">'
    + '<input id="vx-wl-name" type="text" placeholder="Your name (optional)" style="padding:14px 18px;border-radius:8px;border:1px solid rgba(0,0,0,.1);background:#fff;font:15px DM Sans,sans-serif;color:#1a1a1a;outline:none;transition:border-color .2s" />'
    + '<input id="vx-wl-email" type="email" placeholder="Your email" required style="padding:14px 18px;border-radius:8px;border:1px solid rgba(0,0,0,.1);background:#fff;font:15px DM Sans,sans-serif;color:#1a1a1a;outline:none;transition:border-color .2s" />'
    + '<button type="submit" id="vx-wl-btn" style="padding:14px 28px;border-radius:8px;border:none;background:#d4a574;color:#0a0a0a;font:600 14px/1 DM Sans,sans-serif;letter-spacing:.04em;text-transform:uppercase;cursor:pointer;transition:all .3s;box-shadow:0 4px 20px rgba(212,165,116,.25)">Join the waitlist</button>'
    + '</form>'

    // Social proof
    + '<div id="vx-wl-count" style="margin-top:20px;font-size:12px;color:#aaa"></div>'

    // Success state (hidden)
    + '<div id="vx-wl-success" style="display:none">'
    + '<div style="width:56px;height:56px;border-radius:50%;background:rgba(52,210,122,.1);display:flex;align-items:center;justify-content:center;margin:0 auto 20px"><svg width="24" height="24" fill="none" stroke="#34d27a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>'
    + '<h2 style="font-family:Cormorant Garamond,Georgia,serif;font-size:28px;font-weight:300;font-style:italic;color:#1a1a1a;margin:0 0 12px">You\'re on the list.</h2>'
    + '<p style="font-size:14px;color:#888;line-height:1.6;margin:0">Check your inbox for a welcome email. We\'ll let you know the moment your team is ready.</p>'
    + '</div>'

    // Login link
    + '<div style="margin-top:32px;font-size:13px;color:#aaa">Already have access? <a href="/" id="vx-wl-login" style="color:#d4a574;text-decoration:none;font-weight:500">Log in</a></div>'

    + '</div>'

  document.body.appendChild(overlay)

  // Show after intro finishes (or immediately if no intro)
  function showWaitlist() {
    overlay.style.opacity = '1'
    overlay.style.pointerEvents = 'auto'
    fetchCount()
  }

  // Listen for intro completion
  window.addEventListener('message', function handler(e) {
    if (e.data === 'vx-intro-done') {
      window.removeEventListener('message', handler)
      setTimeout(showWaitlist, 800)
    }
  })

  // If no intro overlay exists after 2s, show waitlist directly
  setTimeout(function () {
    if (!document.getElementById('vx-intro-overlay')) {
      showWaitlist()
    }
  }, 2000)

  // Fetch waitlist count
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
          alert(d.error || 'Something went wrong')
        }
      })
      .catch(function () {
        btn.textContent = 'Join the waitlist'
        btn.disabled = false
      })
  })

  // Login link closes waitlist
  document.getElementById('vx-wl-login').addEventListener('click', function (e) {
    e.preventDefault()
    overlay.style.opacity = '0'
    overlay.style.pointerEvents = 'none'
    setTimeout(function () { overlay.remove() }, 600)
  })

  // Focus styling
  var inputs = overlay.querySelectorAll('input')
  inputs.forEach(function (inp) {
    inp.addEventListener('focus', function () { inp.style.borderColor = '#d4a574' })
    inp.addEventListener('blur', function () { inp.style.borderColor = 'rgba(0,0,0,.1)' })
  })
})()
