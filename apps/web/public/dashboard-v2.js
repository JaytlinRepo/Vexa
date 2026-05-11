/* Sovexa — dashboard v2
 *
 * Replaces everything inside #view-db-dashboard with a single clean,
 * purposeful layout. All data comes from the same endpoints; the goal is
 * readability, not feature density. No emojis. Typography-driven.
 *
 * Sections (top to bottom) — growth-first: agents own tactics toward a bigger
 * platform; the CEO sees outcomes and weighs in when it matters.
 *   1. Header — greeting + plan chip + how the day should feel (one line)
 *   2. Next for you + team pulse + queue nav + overview tiles
 *   3. When you weigh in — only items that need a human decision
 *   4. Team — always-on workforce cards
 *   5. Performance + outcomes-style activity
 */
;(function () {
  // View visibility on auth is handled by the #vx-auth-gate style in layout.tsx
  // (runs before any JS loads). No DOM manipulation needed here.
  try {
    const oldLayout = document.querySelector('#view-db-dashboard .db-layout')
    if (oldLayout) oldLayout.style.opacity = '0'
  } catch {}

  const STATE = {
    me: null,
    tasks: [],
    usage: null,
    insights: null,        // Instagram insights (InstagramConnection)
    tiktok: null,          // TikTok connection (TiktokConnection)
    overview: null,        // combined platform overview (PlatformAccount + snapshots)
    feed: [],
    notifs: [],
    platformAccounts: [], // connected platform accounts
  }

  // Server-side caching handles fast responses — no localStorage needed

  // ─────────────── data ────────────────────────────────────────────
  const get = (u) => fetch(u, { credentials: 'include' }).then((r) => r.ok ? r.json() : null).catch(() => null)

  async function fetchAll() {
    // Critical path: auth + tasks + usage — enough to render the layout
    const [me, tasks, usage] = await Promise.all([
      get('/api/auth/me'),
      get('/api/tasks'),
      get('/api/usage'),
    ])
    STATE.me = me
    STATE.tasks = tasks?.tasks || []
    STATE.usage = usage
    // Persist auth state so next page load skips the home view flash
    // Only set the flag, never remove it here — removal happens on explicit logout.
    // Removing on failed /api/auth/me causes the home page to flash on refresh.
    try { if (me?.user) localStorage.setItem('vx-authed', '1') } catch {}
    // Expose state for agent drawer
    window.__vxDashState = STATE
    // Notify HQ early — masthead + pipeline can render with me/tasks before overview loads
    window.dispatchEvent(new CustomEvent('vx-dash-ready'))

    const companyId = me?.companies?.[0]?.id
    if (companyId) {
      // Platform data — needed for overview tiles. Notifications + feed
      // are supplementary and fetched in parallel but don't block render.
      const [insights, tiktok, overview, notifs] = await Promise.all([
        get(`/api/instagram/insights?companyId=${companyId}`),
        get(`/api/tiktok/insights?companyId=${companyId}`),
        get('/api/platform/overview'),
        get('/api/notifications'),
      ])
      STATE.insights = insights?.connection || null
      STATE.tiktok = tiktok?.connection || null
      STATE.overview = overview || null
      STATE.notifs = notifs?.items || []

      // Notify HQ to render with fresh data
      window.dispatchEvent(new CustomEvent('vx-dash-ready'))

      // Supplementary: feed + platform accounts are fetched after render.
      // Fetch after render so they don't delay the dashboard.
      // Re-render when feed arrives so the sidebar appears.
      void Promise.all([
        get('/api/feed').then((f) => {
          const items = f?.items || []
          if (items.length > 0 && STATE.feed.length === 0) {
            STATE.feed = items
            if (typeof render === 'function') render()
          } else {
            STATE.feed = items
          }
        }),
        get('/api/platform/accounts').then((p) => { STATE.platformAccounts = p?.accounts || [] }),
      ])
    }

    // HQ v3 skips v2 innerHTML but still needs the app shell (notif bell, nav labels).
    syncHqAppTopbarIfNeeded()
  }

  function syncHqAppTopbarIfNeeded() {
    var view = document.getElementById('view-db-dashboard')
    if (!view || !view.classList.contains('hq-v3')) return
    var me = STATE.me
    if (!me?.user) return
    var mktNav = document.getElementById('nav-marketing')
    var appNav = document.getElementById('nav-app')
    var loginBtn = document.getElementById('topbar-login')
    var ctaBtn = document.getElementById('topbar-cta')
    var notifBtn = document.getElementById('notif-btn')
    var profile = document.getElementById('vx-profile')
    if (mktNav) mktNav.style.display = 'none'
    if (appNav) appNav.style.display = 'flex'
    if (loginBtn) loginBtn.style.display = 'none'
    if (ctaBtn) ctaBtn.style.display = 'none'
    if (notifBtn) notifBtn.style.display = 'flex'
    if (profile) profile.style.display = ''
    try {
      document.documentElement.dataset.vxAuthed = '1'
    } catch (e) {
      /* noop */
    }
    var company = me.companies && me.companies[0]
    var nameEl = document.getElementById('nav-username')
    var planEl = document.getElementById('nav-userplan')
    var avatarEl = document.getElementById('nav-avatar')
    if (nameEl) nameEl.textContent = company?.name || 'My Company'
    if (planEl) {
      var _plLabels = { free: 'Free', pro: 'Pro', max: 'Max', agency: 'Agency' }
      planEl.textContent = (_plLabels[me.user.plan] || String(me.user.plan || 'free').replace(/^./, function (c) { return c.toUpperCase() })) + ' plan'
    }
    if (avatarEl) avatarEl.textContent = (company?.name || 'S')[0].toUpperCase()
    try {
      window.dispatchEvent(new CustomEvent('vx-app-topbar-synced'))
    } catch (e) {
      /* noop */
    }
  }

  async function render() {
    const view = document.getElementById('view-db-dashboard')
    if (!view) return
    // If the new Vexa-2 HQ layout OR the v3 warm-ivory redesign is present,
    // skip the old JS-generated dashboard. v3 is static HTML in body.html
    // styled by hq-v3.css; the .hq-v3 class on view-db-dashboard is the marker.
    if (view.classList.contains('hq-v3') || view.querySelector('.masthead') || view.querySelector('.pipe-wrap')) {
      // If we have cached state, populate HQ immediately while fresh API data loads
      if (window.__vxDashState && window.__vxDashState.me) {
        window.dispatchEvent(new CustomEvent('vx-dash-ready'))
      }
      // Fetch fresh data in background — vx-dash-ready fires again when done
      fetchAll().catch(() => {})
      return
    }
    // v3 is the only path now. Anything past the early-return above
    // would render the old JS-generated layout — which was purged in
    // commit 40d6a8a alongside its section helpers and toast block
    // (~2000 lines total). Leaving render() as a no-op tail keeps the
    // function callable from refresh() / enterDashboard / vx-task-changed
    // without re-introducing dead code.
  }

  async function refresh() {
    await render()
  }

  window.vxDashboardRefresh = refresh

  const prevEnter = window.enterDashboard
  window.enterDashboard = async function () {
    if (typeof prevEnter === 'function') await prevEnter()
    setTimeout(render, 100)
  }

  const origNavigate = window.navigate
  window.navigate = function (id) {
    const r = typeof origNavigate === 'function' ? origNavigate(id) : undefined
    if (id === 'db-dashboard') setTimeout(render, 150)
    return r
  }

  // Initial render — run as soon as possible, not after 800ms delay
  if (document.readyState !== 'loading') setTimeout(render, 50)
  document.addEventListener('DOMContentLoaded', () => setTimeout(render, 50))

  // Re-render when a task is created (brief delivered) so the team
  // strip flips from "Working" to "Output ready" without the CEO
  // having to reload.
  window.addEventListener('vx-task-changed', () => { setTimeout(render, 80) })

  // When the user returns from a platform OAuth callback (?tiktokConnected=1
  // or ?instagramConnected=1), verify the session is still valid, then jump
  // to the dashboard and refresh data. If the session expired during OAuth,
  // fall back to the home/login page instead of showing a broken dashboard.
  function maybeHandlePlatformReturn() {
    try {
      const params = new URLSearchParams(window.location.search)
      const isTiktok = params.get('tiktokConnected') === '1'
      const isInstagram = params.get('instagramConnected') === '1'
      if (!isTiktok && !isInstagram) return

      var awaitingOb = false
      try { awaitingOb = sessionStorage.getItem('vx-ob-await-connect') === '1' } catch (_) {}

      // Clear the query param so a refresh doesn't re-trigger.
      const clean = window.location.pathname + (window.location.hash || '')
      window.history.replaceState({}, '', clean)
      setTimeout(async () => {
        // Verify the user is still logged in before showing the dashboard
        const me = await fetch('/api/auth/me', { credentials: 'include' })
          .then(r => r.ok ? r.json() : null).catch(() => null)
        if (!me?.user) {
          if (typeof window.navigate === 'function') window.navigate('home')
          try { sessionStorage.removeItem('vx-ob-await-connect') } catch (_) {}
          return
        }

        if (awaitingOb) {
          try { sessionStorage.removeItem('vx-ob-await-connect') } catch (_) {}
          if (typeof window.enterDashboard === 'function') await window.enterDashboard()
          await refresh()
          window.dispatchEvent(new CustomEvent('vx-oauth-return-onboarding'))
          return
        }

        if (typeof window.enterDashboard === 'function') window.enterDashboard()
        await refresh()
        if (isTiktok) {
          setTimeout(() => {
            document.getElementById('tiktok')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }, 250)
        }
      }, 400)
    } catch { /* noop */ }
  }
  if (document.readyState !== 'loading') maybeHandlePlatformReturn()
  document.addEventListener('DOMContentLoaded', maybeHandlePlatformReturn)
})()
