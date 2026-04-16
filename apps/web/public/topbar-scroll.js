/* Vexa — top bar scroll: HG-style floating “island” morph. Uses scroll position
 * over a long range (not a hard threshold) + rAF smoothing so the transition
 * feels continuous. Dashboard views skip the morph. Scroll: `.view` or `main`.
 */
;(function () {
  var scrollEl = null
  var topbar = null
  var activeView = null
  var mainEl = null
  var ticking = false
  var currentP = 0
  var targetP = 0
  var rafLoop = 0
  var reduce =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  /** Scroll pixels before morph begins (after this, blend starts). */
  var ISLAND_START = 4
  /** Scroll distance over which island progress goes 0 → 1 (longer = gentler). */
  var ISLAND_RANGE = 260

  function isDashboardView(view) {
    return !!(view && view.id && view.id.indexOf('view-db') === 0)
  }

  function syncIslandMaxWidth() {
    if (!topbar || !mainEl) return
    var mw = mainEl.clientWidth
    if (mw < 1) return
    var inset = mw <= 820 ? 12 : 20
    var maxW = Math.min(1040, mw - inset * 2)
    topbar.style.setProperty('--vx-island-max', maxW + 'px')
  }

  function computeTargetP() {
    if (!scrollEl) return 0
    if (reduce || isDashboardView(activeView)) return 0
    var y = scrollEl.scrollTop
    return Math.max(0, Math.min(1, (y - ISLAND_START) / ISLAND_RANGE))
  }

  function applyProgress(p) {
    if (!topbar) return
    topbar.style.setProperty('--vx-island-p', String(p))
  }

  function tick() {
    rafLoop = 0
    if (!topbar) return
    var t = targetP
    var ease = reduce ? 1 : 0.14
    currentP += (t - currentP) * ease
    if (Math.abs(t - currentP) < 0.002) currentP = t
    applyProgress(currentP)
    if (Math.abs(t - currentP) > 0.003) {
      rafLoop = requestAnimationFrame(tick)
    }
  }

  function scheduleTick() {
    if (rafLoop) return
    rafLoop = requestAnimationFrame(tick)
  }

  function refreshTarget() {
    targetP = computeTargetP()
    scheduleTick()
  }

  function onScrollFrame() {
    ticking = false
    if (!scrollEl || !topbar) return
    refreshTarget()
  }

  function onScroll() {
    if (ticking) return
    ticking = true
    requestAnimationFrame(onScrollFrame)
  }

  function unbind() {
    if (rafLoop) {
      cancelAnimationFrame(rafLoop)
      rafLoop = 0
    }
    if (scrollEl) {
      scrollEl.removeEventListener('scroll', onScroll)
      scrollEl = null
    }
  }

  /** Marketing views scroll `.view`; dashboard v2 scrolls `main` inside the view. */
  function scrollTargetForView(view) {
    if (!view) return null
    var main = view.querySelector('main')
    if (main) {
      var cs = window.getComputedStyle(main)
      if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') return main
    }
    return view
  }

  function bindScroll() {
    unbind()
    topbar = document.getElementById('topbar')
    mainEl = document.getElementById('main')
    activeView = document.querySelector('.view.active')
    if (!topbar || !activeView) return
    scrollEl = scrollTargetForView(activeView)
    if (!scrollEl) return
    syncIslandMaxWidth()
    currentP = computeTargetP()
    targetP = currentP
    applyProgress(currentP)
    scrollEl.addEventListener('scroll', onScroll, { passive: true })
  }

  function boot() {
    bindScroll()
    window.addEventListener(
      'resize',
      function () {
        topbar = document.getElementById('topbar')
        mainEl = document.getElementById('main')
        syncIslandMaxWidth()
        refreshTarget()
      },
      { passive: true }
    )
    var nav = window.navigate
    if (typeof nav === 'function') {
      window.navigate = function (id) {
        var r = nav.apply(this, arguments)
        setTimeout(bindScroll, 400)
        return r
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
