/* Sovexa — First-connect bootstrap status banner
 *
 * On dashboard mount, polls /api/onboarding/bootstrap-status and shows a
 * single inline banner that addresses three risks:
 *
 *   1. Bedrock latency: Maya / Jordan can take 5-15s to populate their first
 *      cards. Without feedback the user lands on empty tiles and assumes
 *      the product is broken. We show "Maya is preparing your first
 *      playbook…" until status flips to ready, then remove the banner.
 *
 *   2. Silent failures: any sub-step (backfill, Maya, Jordan) that errors
 *      surfaces as a "Some data didn't load — refresh to retry" banner so
 *      the user doesn't sit on permanently-empty cards thinking the data
 *      will arrive eventually.
 *
 *   3. Brand-new accounts: when bootstrap finishes but the connected IG
 *      account has zero posts, we show a one-line note explaining the
 *      empty charts are expected — the metric history will fill in once
 *      they post.
 *
 * Self-attaches; no public API. Runs at most once per dashboard session
 * via the vx-bootstrap-shown sessionStorage flag so we don't badger
 * returning users.
 */
;(function () {
  var POLL_MS = 2500
  var TIMEOUT_MS = 60_000 // give up after a minute; the static banner stays
  var BANNER_ID = 'vx-bootstrap-banner'
  var SHOWN_KEY = 'vx-bootstrap-shown'

  function alreadyShown() {
    try { return sessionStorage.getItem(SHOWN_KEY) === '1' } catch (_) { return false }
  }
  function markShown() {
    try { sessionStorage.setItem(SHOWN_KEY, '1') } catch (_) {}
  }

  function ensureBanner() {
    var existing = document.getElementById(BANNER_ID)
    if (existing) return existing
    var b = document.createElement('div')
    b.id = BANNER_ID
    b.setAttribute('role', 'status')
    b.setAttribute('aria-live', 'polite')
    b.style.cssText = [
      'position:fixed', 'top:14px', 'left:50%', 'transform:translateX(-50%)',
      'z-index:9990', 'max-width:560px', 'width:calc(100% - 32px)',
      'padding:12px 16px', 'border-radius:10px',
      'background:var(--s1, #1a1814)', 'border:1px solid var(--b1, #2a2620)',
      'color:var(--t1, #e8e3da)',
      'font:500 13px/1.4 -apple-system, system-ui, sans-serif',
      'box-shadow:0 8px 24px rgba(0,0,0,.25)',
      'display:flex', 'align-items:center', 'gap:10px',
    ].join(';')
    document.body.appendChild(b)
    return b
  }

  function setBanner(text, kind) {
    var b = ensureBanner()
    var icon = kind === 'error' ? '⚠' : kind === 'info' ? 'ⓘ' : '◐'
    b.innerHTML =
      '<span style="opacity:.7">' + icon + '</span>' +
      '<span style="flex:1">' + text + '</span>' +
      (kind === 'error'
        ? '<button type="button" onclick="window.location.reload()" style="background:transparent;border:1px solid currentColor;color:inherit;padding:5px 10px;border-radius:6px;font:inherit;cursor:pointer">Refresh</button>'
        : '<button type="button" onclick="document.getElementById(\'' + BANNER_ID + '\').remove()" style="background:transparent;border:none;color:inherit;font-size:18px;line-height:1;cursor:pointer;opacity:.6">×</button>')
  }

  function clearBanner() {
    var existing = document.getElementById(BANNER_ID)
    if (existing) existing.remove()
  }

  function copyFor(state) {
    var pendingSteps = []
    if (state.steps) {
      if (state.steps.maya === 'pending') pendingSteps.push('Maya is preparing your first playbook')
      if (state.steps.goal === 'pending') pendingSteps.push('Jordan is setting your opening goal')
      if (state.steps.backfill === 'pending') pendingSteps.push('Pulling your recent metrics')
    }
    var pendingCopy = pendingSteps.length
      ? pendingSteps[0] + '…'
      : 'Setting up your dashboard…'

    if (state.status === 'pending') return { text: pendingCopy, kind: 'progress' }
    if (state.status === 'failed') return { text: state.error || "We couldn't finish setting up your dashboard. Refresh to try again.", kind: 'error' }
    if (state.status === 'partial') return { text: state.error || 'Some of your data didn\'t finish loading. Refresh to try again.', kind: 'error' }
    if (state.status === 'empty_account') return {
      text: 'Your connected account has no posts yet — your charts will fill in once you post a Reel.',
      kind: 'info',
    }
    return null // ready: clear
  }

  async function fetchStatus() {
    try {
      var res = await fetch('/api/onboarding/bootstrap-status', { credentials: 'include' })
      if (!res.ok) return null
      return await res.json()
    } catch (_) {
      return null
    }
  }

  var pollHandle = null
  var startedAt = 0
  var lastStatus = null

  async function tick() {
    var state = await fetchStatus()
    if (!state) return // transient network blip; keep polling

    var copy = copyFor(state)
    if (!copy) {
      // Ready — clear and stop polling.
      clearBanner()
      stopPolling()
      return
    }

    // Avoid re-rendering the same state repeatedly.
    if (lastStatus !== state.status + ':' + (state.steps && state.steps.maya) + (state.steps && state.steps.goal)) {
      setBanner(copy.text, copy.kind)
      lastStatus = state.status + ':' + (state.steps && state.steps.maya) + (state.steps && state.steps.goal)
    }

    // Terminal states — stop polling. Only 'pending' keeps the loop alive.
    if (state.status !== 'pending') {
      stopPolling()
      return
    }
    if (Date.now() - startedAt > TIMEOUT_MS) {
      // Bedrock or backfill is taking longer than expected. Switch to a
      // soft error so the user has an action — refresh — instead of an
      // indefinite spinner.
      setBanner("This is taking longer than expected. Refresh in a minute, or contact support if it persists.", 'error')
      stopPolling()
    }
  }

  function stopPolling() {
    if (pollHandle) { clearInterval(pollHandle); pollHandle = null }
  }

  function start() {
    if (alreadyShown()) return
    markShown()
    startedAt = Date.now()
    void tick()
    pollHandle = setInterval(tick, POLL_MS)
  }

  // Hook into the existing dashboard entry point. enterDashboard fires once
  // when the user lands on the dashboard for the first time post-OAuth,
  // which is exactly when first-connect bootstrap is in flight.
  var prev = window.enterDashboard
  window.enterDashboard = async function () {
    if (typeof prev === 'function') await prev()
    setTimeout(start, 250) // let the dashboard paint first
  }

  // Also handle the refresh-restore path: a logged-in user reloading the
  // dashboard tab. If their bootstrap is still pending (e.g. they
  // refreshed within the first 30s of OAuth) we want to surface the same
  // banner. Tied to the same sessionStorage flag so it never fires twice.
  if (document.readyState === 'complete') {
    setTimeout(start, 600)
  } else {
    window.addEventListener('load', function () { setTimeout(start, 600) })
  }
})()
