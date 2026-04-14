/* Force dark theme as the default if the user has never toggled it.
 * The prototype's JS respects localStorage.vx-t; we only override when that
 * key is absent. Users who explicitly pick light via the topbar toggle still
 * get remembered.
 */
;(function () {
  try {
    if (!localStorage.getItem('vx-t')) {
      localStorage.setItem('vx-t', 'dark')
      document.documentElement.setAttribute('data-theme', 'dark')
    }
  } catch {}
})()
