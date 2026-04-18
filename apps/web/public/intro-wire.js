/* Vexa intro — plays the cinematic demo as a full-screen overlay on first visit,
 * then seamlessly dissolves into the real home page.
 *
 * Only shows for non-authed visitors who haven't seen it this session.
 * Loads demo.html content into an iframe overlay, then removes it on completion.
 */
;(function () {
  // Don't show for logged-in users
  if (localStorage.getItem('vx-authed') === '1') return
  // Don't show if already seen this session
  if (sessionStorage.getItem('vx-intro-done') === '1') return
  // Don't show if there's a session cookie (user is logged in but vx-authed wasn't set yet)
  if (document.cookie.indexOf('vx_session') !== -1) return

  // Create overlay
  var overlay = document.createElement('div')
  overlay.id = 'vx-intro-overlay'
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#0a0a0a;transition:opacity 1.2s ease'

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
  setTimeout(closeIntro, 70000) // 70s max

  function closeIntro() {
    if (!overlay.parentNode) return
    sessionStorage.setItem('vx-intro-done', '1')
    overlay.style.opacity = '0'
    setTimeout(function () {
      overlay.remove()
    }, 1200)
  }
})()
