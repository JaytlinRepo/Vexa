/* Dev-only tab title prefix.
 *
 * When the site is reached via one of the /etc/hosts aliases
 * (sovexa-dev-desktop, sovexa-dev-mobile, sovexa-dev-app,
 *  sovexa-prod-desktop, sovexa-prod-mobile), prefix document.title
 * with a clear role label so browser tabs are self-identifying:
 *   "[Sovexa Dev · Desktop] Sovexa — Your AI Content Team"
 *
 * Bypassed on production hostnames (sovexa.ai). Re-applies whenever
 * the page changes the title (Next.js navigations etc.).
 */
;(function () {
  var ROLES = {
    'sovexa-dev-desktop':  'Sovexa Dev · Desktop',
    'sovexa-dev-mobile':   'Sovexa Dev · Mobile',
    'sovexa-dev-app':      'Sovexa Dev · App',
    'sovexa-prod-desktop': 'Sovexa Prod · Desktop',
    'sovexa-prod-mobile':  'Sovexa Prod · Mobile',
  }
  var label = ROLES[location.hostname]
  if (!label) return  // localhost / 127.0.0.1 / sovexa.ai etc.

  var prefix = '[' + label + '] '
  var apply = function () {
    var t = document.title || ''
    if (t.indexOf(prefix) === 0) return
    // Strip any other [..] prefix the page may already have set.
    document.title = prefix + t.replace(/^\[[^\]]+\]\s*/, '')
  }
  apply()

  // Re-apply when downstream code (Next.js metadata, etc.) overwrites.
  try {
    var titleEl = document.querySelector('title')
    if (titleEl && window.MutationObserver) {
      new MutationObserver(apply).observe(titleEl, { childList: true })
    }
  } catch (_) {}
})()
