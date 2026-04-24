/* Runs in root layout (beforeInteractive) so theme + toggle exist before React. */
;(function () {
  var html = document.documentElement
  function sync() {
    var saved = null
    try { saved = localStorage.getItem('vx-t') } catch (_) {}
    // Force light mode as default — clear any stale dark preference
    if (saved === 'dark') { try { localStorage.removeItem('vx-t') } catch (_) {}; saved = null }
    var theme = (saved === 'dark' || saved === 'light') ? saved : 'light'
    html.setAttribute('data-theme', theme)
    try { localStorage.setItem('vx-t', theme) } catch (_) {}
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
