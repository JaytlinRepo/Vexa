/* Vexa — dashboard data wiring
 *
 * Runs after prototype.js + auth-ui.js. On load, tries to restore the session
 * and jump straight to the dashboard with real data. Also overrides
 * enterDashboard() so onboarding completion shows the user's real company +
 * Instagram stats instead of hardcoded copy.
 */
;(function () {
  const API = ''

  async function fetchMe() {
    try {
      const res = await fetch(API + '/api/auth/me', { credentials: 'include' })
      if (!res.ok) return null
      return res.json()
    } catch {
      return null
    }
  }

  async function fetchInsights(companyId) {
    try {
      const res = await fetch(API + '/api/instagram/insights?companyId=' + companyId, {
        credentials: 'include',
      })
      if (!res.ok) return null
      const json = await res.json()
      return json.connection
    } catch {
      return null
    }
  }

  function setText(id, value) {
    const el = document.getElementById(id)
    if (el && value != null) el.textContent = value
  }

  function greeting() {
    const h = new Date().getHours()
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  }

  function populateNav(user, company) {
    const displayName = company?.name || user.fullName || user.username || 'Your company'
    setText('nav-username', displayName)
    setText('nav-userplan', (user.plan || 'starter').replace(/^./, (c) => c.toUpperCase()) + ' plan')
    setText('nav-avatar', displayName.charAt(0).toUpperCase())
    setText('db-greeting', `${greeting()}, ${user.fullName || user.username || 'CEO'}.`)
    if (company) {
      setText('db-company', `${company.name} — your team is active and has work ready for your review.`)
    }
  }

  function ensureLogoutButton() {
    const area = document.getElementById('nav-user-area')
    if (!area || area.querySelector('.vx-logout')) return
    const btn = document.createElement('button')
    btn.className = 'vx-logout'
    btn.textContent = 'Log out'
    btn.title = 'Log out'
    btn.setAttribute('aria-label', 'Log out')
    btn.style.cssText =
      'margin-left:auto;background:transparent;border:1px solid var(--b2);color:var(--t2);font-size:10px;letter-spacing:.08em;text-transform:uppercase;padding:6px 10px;border-radius:6px;cursor:pointer;font-family:inherit'
    btn.addEventListener('click', async () => {
      await fetch(API + '/api/auth/logout', { method: 'POST', credentials: 'include' })
      location.reload()
    })
    area.appendChild(btn)
  }

  function renderInstagramWidget(conn) {
    const host = document.querySelector('#view-db-dashboard .db-main-col')
    if (!host) return
    // Remove any previously-rendered version
    document.getElementById('vx-ig-widget')?.remove()
    if (!conn) return
    const el = document.createElement('div')
    el.id = 'vx-ig-widget'
    el.style.cssText =
      'margin:20px 0 8px;padding:18px 20px;background:linear-gradient(135deg,rgba(225,48,108,.08),rgba(131,58,180,.06));border:1px solid rgba(225,48,108,.28);border-radius:12px'
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <span style="font-size:16px">📸</span>
        <strong style="font-size:13px;letter-spacing:.02em">Instagram @${conn.handle}</strong>
        <span style="margin-left:auto;font-size:10px;color:var(--t3);letter-spacing:.1em;text-transform:uppercase">${conn.source === 'stub' ? 'Demo data' : 'Live'}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;font-family:'DM Sans',sans-serif">
        ${cell('Followers', conn.followerCount.toLocaleString())}
        ${cell('Following', conn.followingCount.toLocaleString())}
        ${cell('Posts', String(conn.postCount))}
        ${cell('Engagement', conn.engagementRate.toFixed(2) + '%')}
      </div>
    `
    // Insert after the greeting/sub section, before .briefing-grid
    const briefGrid = host.querySelector('.briefing-grid')
    if (briefGrid) host.insertBefore(el, briefGrid)
    else host.appendChild(el)
  }

  function cell(label, value) {
    return `
      <div>
        <div style="font-size:10px;color:var(--t3);letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px">${label}</div>
        <div style="font-family:'Cormorant Garamond',serif;font-size:28px;font-weight:500;color:var(--t1)">${value}</div>
      </div>
    `
  }

  async function refreshDashboardFor(user, company) {
    populateNav(user, company)
    ensureLogoutButton()
    if (company) {
      const conn = await fetchInsights(company.id)
      renderInstagramWidget(conn)
    }
  }

  // ── Override enterDashboard so it uses real data ─────────────────────────
  const originalEnter = window.enterDashboard
  window.enterDashboard = async function () {
    const me = await fetchMe()
    // Call original to flip UI chrome (hide marketing nav, show app nav, etc.)
    if (typeof originalEnter === 'function') originalEnter()
    if (me?.user) {
      const company = me.companies?.[0]
      await refreshDashboardFor(me.user, company)
    }
  }

  // ── On page load, auto-enter dashboard if already onboarded ───────────────
  async function init() {
    const me = await fetchMe()
    if (!me?.user) return
    const company = me.companies?.[0]
    if (!company) return
    // Skip marketing — jump straight to the dashboard
    if (typeof originalEnter === 'function') originalEnter()
    await refreshDashboardFor(me.user, company)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    // auth-ui.js already wired things; kick off after a tick so its init runs first.
    setTimeout(init, 50)
  }
})()
