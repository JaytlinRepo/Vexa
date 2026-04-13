// Merge team / how / outputs / knowledge views into the home view as stacked
// sections, rewrite the sidebar, and patch every inline navigate() call that
// used to target those (now-removed) views.
;(function () {
  var MERGED = ['team', 'how', 'outputs', 'knowledge']

  function scrollToMerged(id) {
    var active = document.querySelector('.view.active')
    var target = function () {
      var t = document.getElementById('home-' + id)
      if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    if (!active || active.id !== 'view-home') {
      // Kick the chain through the original navigate so page transition runs,
      // then scroll once the view animation settles.
      if (typeof window.__origNavigate === 'function') window.__origNavigate('home')
      setTimeout(target, 550)
    } else {
      target()
    }
  }

  function run() {
    var home = document.getElementById('view-home')
    if (!home) return
    var homeInner = home.querySelector('.view-inner')
    if (!homeInner) return

    // Move each merged view's inner content into a section inside home.
    MERGED.forEach(function (id) {
      var view = document.getElementById('view-' + id)
      if (!view) return
      var inner = view.querySelector('.mkt-view, .view-inner') || view
      var wrap = document.createElement('section')
      wrap.id = 'home-' + id
      wrap.className = 'home-merged-section'
      while (inner.firstChild) wrap.appendChild(inner.firstChild)
      homeInner.appendChild(wrap)
      view.remove()
    })

    home.style.overflowY = 'auto'

    // Remove sidebar nav items for the merged sections.
    MERGED.forEach(function (id) {
      var navEl = document.getElementById('nav-' + id)
      if (navEl && navEl.parentNode) navEl.parentNode.removeChild(navEl)
    })

    // Patch every static .feed-act.read button so it opens whatever URL its
    // card's title is pointing at. These were static dead-ends in the
    // prototype until feed-wire.js replaces them — on marketing (unauth) they
    // stay static, so wire a sensible default.
    document.querySelectorAll('.feed-act.read').forEach(function (btn) {
      if (btn.dataset.vxWired) return
      btn.dataset.vxWired = '1'
      btn.addEventListener('click', function () {
        var card = btn.closest('.feed-card')
        var link = card ? card.querySelector('.feed-title') : null
        var href = link && link.getAttribute('href')
        if (href && href !== '#') window.open(href, '_blank', 'noopener')
        else if (typeof window.startOnboarding === 'function') window.startOnboarding()
      })
    })
  }

  // Override navigate so any stray onclick="navigate('team'|'how'|'outputs'|
  // 'knowledge')" scrolls to the merged section instead of silently failing.
  function installNavigateOverride() {
    if (window.__vxNavPatched) return
    window.__vxNavPatched = true
    window.__origNavigate = window.navigate
    window.navigate = function (id) {
      if (MERGED.indexOf(id) >= 0) {
        scrollToMerged(id)
        return
      }
      if (typeof window.__origNavigate === 'function') return window.__origNavigate(id)
    }
  }

  // Must run AFTER prototype.js defines navigate globally, so defer by a tick.
  function boot() {
    installNavigateOverride()
    run()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    setTimeout(boot, 0)
  }
})()
