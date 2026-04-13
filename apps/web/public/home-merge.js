// Merge team / how / outputs / knowledge views into the home view as stacked
// sections, then rewrite their sidebar nav items to scroll within home.
(function () {
  function run() {
    var mergeIds = ['team', 'how', 'outputs', 'knowledge']
    var home = document.getElementById('view-home')
    if (!home) return
    var homeInner = home.querySelector('.view-inner')
    if (!homeInner) return

    mergeIds.forEach(function (id) {
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

    // Make the merged home scrollable full-height.
    home.style.overflowY = 'auto'

    // Remove sidebar nav items for sections now merged into home.
    mergeIds.forEach(function (id) {
      var navEl = document.getElementById('nav-' + id)
      if (navEl && navEl.parentNode) navEl.parentNode.removeChild(navEl)
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run)
  } else {
    // prototype.js may have already run. Defer a tick so it finishes wiring first.
    setTimeout(run, 0)
  }
})()
