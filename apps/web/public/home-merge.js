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
  function initHomeCarousel() {
    try {
      var root = document.getElementById('home-carousel')
      if (!root || root.dataset.vxCarousel) return
      root.dataset.vxCarousel = '1'
      var viewport = document.getElementById('home-carousel-viewport')
      var track = document.getElementById('home-carousel-track')
      var dotsWrap = document.getElementById('home-carousel-dots')
      var prev = root.querySelector('[data-carousel-prev]')
      var next = root.querySelector('[data-carousel-next]')
      var slides = root.querySelectorAll('.home-carousel-slide')
      var n = slides.length
      if (!track || !viewport || n === 0) return

      var i = 0
      var timer = null
      var resizeTimer = null
      var lastW = 0
      var reduce =
        window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

      function measureSlides() {
        var w = viewport.offsetWidth
        if (!w) return
        slides.forEach(function (s) {
          s.style.flex = '0 0 ' + w + 'px'
          s.style.width = w + 'px'
          s.style.minWidth = w + 'px'
          s.style.maxWidth = w + 'px'
        })
      }

      function go(ix) {
        i = ((ix % n) + n) % n
        measureSlides()
        var w = viewport.offsetWidth
        lastW = w
        track.style.transform = 'translateX(' + -i * w + 'px)'
        if (dotsWrap) {
          var dots = dotsWrap.querySelectorAll('.home-carousel-dot')
          dots.forEach(function (d, j) {
            d.classList.toggle('on', j === i)
            d.setAttribute('aria-selected', j === i ? 'true' : 'false')
          })
        }
      }

      // ResizeObserver + go() caused a feedback loop (measure → layout → RO → …) and could freeze the tab.
      function onWinResize() {
        if (resizeTimer) clearTimeout(resizeTimer)
        resizeTimer = setTimeout(function () {
          var w = viewport.offsetWidth
          if (!w || w === lastW) return
          go(i)
        }, 120)
      }
      window.addEventListener('resize', onWinResize)

      if (dotsWrap && dotsWrap.children.length === 0) {
        for (var d = 0; d < n; d++) {
          ;(function (idx) {
            var b = document.createElement('button')
            b.type = 'button'
            b.className = 'home-carousel-dot' + (idx === 0 ? ' on' : '')
            b.setAttribute('role', 'tab')
            b.setAttribute('aria-selected', idx === 0 ? 'true' : 'false')
            b.setAttribute('aria-label', 'Slide ' + (idx + 1) + ' of ' + n)
            b.addEventListener('click', function () {
              go(idx)
              resetTimer()
            })
            dotsWrap.appendChild(b)
          })(d)
        }
      }

      function resetTimer() {
        if (timer) clearInterval(timer)
        timer = null
        if (reduce || n <= 1) return
        timer = setInterval(function () {
          go(i + 1)
        }, 8000)
      }

      root.addEventListener('mouseenter', function () {
        if (timer) clearInterval(timer)
        timer = null
      })
      root.addEventListener('mouseleave', function () {
        resetTimer()
      })

      if (prev) prev.addEventListener('click', function () { go(i - 1); resetTimer() })
      if (next) next.addEventListener('click', function () { go(i + 1); resetTimer() })

      root.tabIndex = 0
      root.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowLeft') {
          go(i - 1)
          resetTimer()
        } else if (e.key === 'ArrowRight') {
          go(i + 1)
          resetTimer()
        }
      })

      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          go(0)
          resetTimer()
        })
      })
    } catch (err) {
      if (typeof console !== 'undefined' && console.error) console.error('vx-carousel', err)
    }
  }

  function boot() {
    installNavigateOverride()
    run()
    initHomeCarousel()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    setTimeout(boot, 0)
  }
})()
