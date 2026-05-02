/* Mobile-browser nav drawer (hamburger toggle + slide-out menu).
 * Only meaningful when html[data-vx-device="mobile"]; the markup itself
 * is .vx-mobile-only so this script's listeners are no-ops on desktop
 * (the elements still exist in the DOM, but the user can't see/click them).
 */
;(function () {
  function ready(fn) {
    if (document.readyState !== 'loading') fn()
    else document.addEventListener('DOMContentLoaded', fn)
  }

  ready(function () {
    var burger = document.getElementById('vxm-burger')
    var drawer = document.getElementById('vxm-drawer')
    if (!burger || !drawer) return

    function open() {
      drawer.classList.add('on')
      burger.classList.add('on')
      burger.setAttribute('aria-expanded', 'true')
      drawer.setAttribute('aria-hidden', 'false')
      document.body.classList.add('vxm-drawer-open')
    }
    function close() {
      drawer.classList.remove('on')
      burger.classList.remove('on')
      burger.setAttribute('aria-expanded', 'false')
      drawer.setAttribute('aria-hidden', 'true')
      document.body.classList.remove('vxm-drawer-open')
    }
    function toggle() {
      drawer.classList.contains('on') ? close() : open()
    }

    burger.addEventListener('click', toggle)
    drawer.querySelectorAll('[data-vxm-close]').forEach(function (el) {
      el.addEventListener('click', close)
    })

    // Standard nav: close drawer, then fire navigate(viewId)
    drawer.querySelectorAll('[data-vxm-go]').forEach(function (el) {
      el.addEventListener('click', function () {
        var id = el.dataset.vxmGo
        close()
        if (typeof window.navigate === 'function') window.navigate(id)
      })
    })

    // Marketing scroll-targets ("How it works", "Pricing"): navigate home,
    // then scroll to the merged-section anchor once the swap settles.
    drawer.querySelectorAll('[data-vxm-scroll]').forEach(function (el) {
      el.addEventListener('click', function () {
        var anchor = el.dataset.vxmScroll
        close()
        if (typeof window.navigate === 'function') window.navigate('home')
        setTimeout(function () {
          var t = document.getElementById(anchor) || document.getElementById('home-' + anchor)
          if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }, 200)
      })
    })

    // Esc closes drawer (matches the rest of the app's modal pattern)
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && drawer.classList.contains('on')) close()
    })

    // Show marketing vs app link set based on data-vx-authed. The auth flow
    // toggles this attribute on the html element; mirror that here so the
    // drawer always reflects the current session.
    function syncLinkSet() {
      var marketing = document.getElementById('vxm-drawer-links-marketing')
      var app = document.getElementById('vxm-drawer-links-app')
      var authed = document.documentElement.dataset.vxAuthed === '1'
      if (marketing) marketing.style.display = authed ? 'none' : ''
      if (app) app.style.display = authed ? '' : 'none'
    }
    syncLinkSet()
    new MutationObserver(syncLinkSet).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-vx-authed'],
    })

    // Highlight current view in the drawer. Uses currentView (global from
    // prototype.js); fall back to scanning .view.active in case currentView
    // hasn't been initialized yet.
    function syncActive() {
      var view = (typeof window.currentView === 'string' && window.currentView) ||
        (function () {
          var a = document.querySelector('.view.active')
          return a && a.id ? a.id.replace(/^view-/, '') : 'home'
        })()
      drawer.querySelectorAll('.vxm-drawer-link').forEach(function (el) {
        el.classList.toggle('on', el.dataset.vxmGo === view)
      })
    }
    syncActive()
    // Re-check on hashchange (which fires after navigate() pushes a new hash)
    window.addEventListener('hashchange', syncActive)
  })
})()
