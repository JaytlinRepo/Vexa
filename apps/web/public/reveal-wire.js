/* Vexa — Apple-style scroll reveals + ambient hero parallax.
 *
 * - IntersectionObserver auto-tags a curated list of selectors with
 *   `vx-reveal` and flips to `.is-in` when they scroll into view. One-shot
 *   (no out-animation). Siblings inside the same group get staggered delays.
 * - Hero background layers (`.hero-bg-grid`, `.hero-light`) drift with
 *   window scroll for subtle parallax, and the whole hero content fades
 *   + drifts up as it leaves the viewport.
 * - Respects `prefers-reduced-motion`: no transitions, no parallax.
 */
;(function () {
  var reduce =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // Selectors that should fade + rise on scroll-in. These are scoped to
  // marketing pages only (`.view.marketing`, `.mkt-view`) — dashboard
  // re-uses `.out-card` / `.emp-card`, and its scroll container is
  // `overflow:hidden`, so tagging them there hides content permanently.
  var SCOPES = ['.view.marketing', '.mkt-view']
  var LEAF_SELECTORS = [
    '.mkt-head',
    '.home-carousel',
    '.team-row',
    '.how-cell',
    '.pc',
    '.out-card',
    '.emp-card',
    '.feed-card',
    '.faq-item',
  ]
  var REVEAL_SELECTORS = []
  SCOPES.forEach(function (scope) {
    LEAF_SELECTORS.forEach(function (leaf) {
      REVEAL_SELECTORS.push(scope + ' ' + leaf)
    })
  })

  // Grouping: when these containers enter view, stagger their direct reveal
  // children so adjacent siblings don't all pop at once.
  var STAGGER_GROUPS = [
    { parent: '.team-grid', child: '.team-row' },
    { parent: '.pricing-grid,.price-grid', child: '.pc' },
    { parent: '.how-grid', child: '.how-cell' },
    { parent: '.out-grid,.outputs-grid', child: '.out-card' },
    { parent: '.feed-grid', child: '.feed-card' },
    { parent: '.faq-grid,.faq-list', child: '.faq-item' },
  ]

  var observer = null

  function tag() {
    REVEAL_SELECTORS.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        if (el.classList.contains('vx-reveal')) return
        el.classList.add('vx-reveal')
      })
    })
    // Apply stagger: child N gets (N * 55ms) delay, capped so long lists
    // don't drag forever. Inline transition-delay wins over the base rule.
    STAGGER_GROUPS.forEach(function (g) {
      document.querySelectorAll(g.parent).forEach(function (parent) {
        var kids = parent.querySelectorAll(g.child)
        kids.forEach(function (kid, ix) {
          if (kid.dataset.vxStagger) return
          kid.dataset.vxStagger = '1'
          var d = Math.min(ix * 55, 380)
          kid.style.transitionDelay = d + 'ms'
        })
      })
    })
  }

  function reveal(el) {
    el.classList.add('is-in')
    // Drop the transition-delay after the first reveal so subsequent
    // interactions (hover, etc.) don't inherit the cascade offset.
    setTimeout(function () {
      el.style.transitionDelay = ''
    }, 1100)
  }

  function initObserver() {
    if (observer) return
    if (!('IntersectionObserver' in window)) {
      document.querySelectorAll('.vx-reveal').forEach(reveal)
      return
    }
    observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            reveal(entry.target)
            observer.unobserve(entry.target)
          }
        })
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.12 }
    )
    document.querySelectorAll('.vx-reveal:not(.is-in)').forEach(function (el) {
      observer.observe(el)
    })
  }

  function run() {
    if (reduce) return
    tag()
    initObserver()
  }

  // Re-scan after client-side navigation between prototype views so content
  // mounted via innerHTML (team-wire, etc.) still gets wired.
  function rescan() {
    if (reduce) return
    tag()
    document.querySelectorAll('.vx-reveal:not(.is-in)').forEach(function (el) {
      if (observer) observer.observe(el)
    })
  }

  // ── Hero parallax ────────────────────────────────────────────────────────
  //
  // As the user scrolls past the hero, the grid and glow drift up slower
  // than the text and fade. This is the cheap version of Apple's scroll-
  // anchored hero — no scroll-linked library, just a rAF-throttled listener.
  function initHeroParallax() {
    if (reduce) return
    var grid = document.querySelector('.hero-bg-grid')
    var light = document.querySelector('.hero-light')
    var content = document.querySelector('#view-home .hero-content')
    if (!grid && !light && !content) return

    var ticking = false
    function update() {
      ticking = false
      var y = window.scrollY || window.pageYOffset || 0
      // Clamp so we don't keep transforming after hero is long gone.
      var dy = Math.min(y, 800)
      if (grid) grid.style.transform = 'translate3d(0,' + dy * 0.18 + 'px,0)'
      if (light) light.style.transform = 'translate3d(-50%,' + (-20 + dy * 0.08) + '%,0)'
      if (content) {
        var fade = Math.max(0, 1 - dy / 520)
        content.style.transform = 'translate3d(0,' + -dy * 0.14 + 'px,0)'
        content.style.opacity = String(fade)
      }
    }
    window.addEventListener(
      'scroll',
      function () {
        if (ticking) return
        ticking = true
        requestAnimationFrame(update)
      },
      { passive: true }
    )
    update()
  }

  function boot() {
    run()
    initHeroParallax()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }

  // Hook into the SPA navigate() to re-scan when a new view becomes active.
  var origNavigate = window.navigate
  if (typeof origNavigate === 'function') {
    window.navigate = function (id) {
      var r = origNavigate.apply(this, arguments)
      setTimeout(rescan, 40)
      return r
    }
  }

  // Expose for scripts that inject content (team-wire, outputs, etc.).
  window.vxRevealRescan = rescan
})()
