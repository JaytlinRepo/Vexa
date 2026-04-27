/* Sovexa intro — plays the cinematic demo as a full-screen overlay on first visit,
 * then seamlessly dissolves into the real home page.
 *
 * Only shows for non-authed visitors who haven't seen it this session.
 * Loads demo.html content into an iframe overlay, then removes it on completion.
 */
;(function () {
  // Don't show for logged-in users
  if (document.cookie.indexOf('vx_session') !== -1) return
  // ?nointro=1 — skip the cinematic intro (used for screenshotting / preview)
  if (new URLSearchParams(location.search).get('nointro') === '1') return
  // Temporarily showing on localhost for preview
  // var host = window.location.hostname
  // if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.amplifyapp.com')) return
  // Clear any stale intro flag so it always plays for testing
  try { sessionStorage.removeItem('vx-intro-done') } catch (_) {}

  // Create overlay
  var overlay = document.createElement('div')
  overlay.id = 'vx-intro-overlay'
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:var(--bg,#0a0a0a);transition:opacity .6s ease'

  // Load the demo page in an iframe
  var iframe = document.createElement('iframe')
  iframe.src = '/demo.html#autoclose'
  iframe.style.cssText = 'width:100%;height:100%;border:none'
  overlay.appendChild(iframe)

  document.body.appendChild(overlay)

  // Listen for the demo to signal completion
  window.addEventListener('message', function handler(e) {
    if (e.data === 'vx-intro-done') {
      window.removeEventListener('message', handler)
      closeIntro()
    }
  })

  // Also close if user navigates away or after max time
  setTimeout(closeIntro, 55000) // 55s max

  function closeIntro() {
    if (!overlay.parentNode) return
    sessionStorage.setItem('vx-intro-done', '1')

    // Quick fade to black, then remove — no double-screen
    overlay.style.background = '#0a0a0a'
    overlay.style.pointerEvents = 'none'
    setTimeout(function () {
      overlay.style.opacity = '0'
      setTimeout(function () {
        overlay.remove()
      }, 700)
    }, 100)
  }
})()
