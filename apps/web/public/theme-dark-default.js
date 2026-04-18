/* Runs in root layout (beforeInteractive) so theme + toggle exist before React. */
;(function () {
  var html = document.documentElement
  function sync() {
    // Always dark — light theme is not production-ready yet
    html.setAttribute('data-theme', 'dark')
    try { localStorage.setItem('vx-t', 'dark') } catch (_) {}
  }
  sync()
  window.toggleTheme = function vexaToggleTheme() {
    var next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'
    html.setAttribute('data-theme', next)
    try {
      localStorage.setItem('vx-t', next)
    } catch (_) {}
  }
})()
