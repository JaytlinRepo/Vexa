/* Vexa — global scroll-reveal animations
 *
 * Applies blur-fade-in to major page sections and cards across all views
 * (home, dashboard, settings, meeting room). Dashboard-v2.js has its own
 * reveal system for the dashboard; this handles everything else.
 */
;(function () {
  if (typeof IntersectionObserver === 'undefined') return

  function reveal() {
    // Skip if dashboard-v2 owns the view (it has its own observer)
    if (document.querySelector('[data-v2-soft-refresh]')) return

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return
        e.target.classList.add('vx-g-visible')
        // Stagger children
        var children = e.target.querySelectorAll('.vx-g-reveal')
        children.forEach(function (c, i) {
          c.style.transitionDelay = (i * 0.08) + 's'
          c.classList.add('vx-g-visible')
        })
        observer.unobserve(e.target)
      })
    }, { threshold: 0.05 })

    // Target: hero sections, content sections, card grids, feature blocks
    var selectors = [
      '.hero-content',
      '.home-merged-section',
      '.view-inner > section',
      '.view-inner > div',
      '.briefing-grid',
      '.emp-cards',
      '.brief-card',
      '.out-card',
      '.how-cell',
      '.faq-row',
      '.pricing-card',
      '.pc',
      '#onboarding .ob-step',
    ]

    selectors.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        if (el.classList.contains('vx-g-reveal')) return
        el.classList.add('vx-g-reveal')
        observer.observe(el)
      })
    })
  }

  // Run on load + on view navigation
  if (document.readyState !== 'loading') setTimeout(reveal, 100)
  document.addEventListener('DOMContentLoaded', function () { setTimeout(reveal, 100) })

  // Re-apply after prototype.js navigate() swaps views
  var origNav = window.navigate
  window.navigate = function (id) {
    var r = typeof origNav === 'function' ? origNav(id) : undefined
    setTimeout(reveal, 300)
    return r
  }
})()
