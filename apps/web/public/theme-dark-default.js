/* Runs in root layout (beforeInteractive) so theme + toggle exist before React. */
;(function () {
  var html = document.documentElement
  function sync() {
    try {
      var t = localStorage.getItem('vx-t')
      if (t === 'light' || t === 'dark') {
        html.setAttribute('data-theme', t)
      } else {
        localStorage.setItem('vx-t', 'dark')
        html.setAttribute('data-theme', 'dark')
      }
    } catch (_) {
      html.setAttribute('data-theme', 'dark')
    }
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
