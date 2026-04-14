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
    document.getElementById('vx-ig-widget')?.remove()
    if (!conn) return

    const series = Array.isArray(conn.followerSeries) ? conn.followerSeries : []
    const topPost = Array.isArray(conn.topPosts) && conn.topPosts[0] ? conn.topPosts[0] : null
    const audienceAge = Array.isArray(conn.audienceAge) ? conn.audienceAge : []
    const topAgeBucket = audienceAge.slice().sort((a, b) => b.share - a.share)[0]

    const el = document.createElement('div')
    el.id = 'vx-ig-widget'
    el.style.cssText =
      'margin:20px 0 8px;padding:18px 20px;background:linear-gradient(135deg,rgba(225,48,108,.08),rgba(131,58,180,.06));border:1px solid rgba(225,48,108,.28);border-radius:12px'
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
        <strong style="font-size:13px;letter-spacing:.02em">Instagram · @${conn.handle}</strong>
        <span style="font-size:10px;color:var(--t3);padding:2px 8px;border-radius:10px;background:var(--s3);letter-spacing:.08em;text-transform:uppercase">${conn.accountType || 'Creator'}</span>
        <span style="margin-left:auto;font-size:10px;color:var(--t3);letter-spacing:.1em;text-transform:uppercase">${conn.source === 'stub' ? 'Demo data' : 'Live'}</span>
        <button id="vx-ig-simulate" style="background:transparent;border:1px solid var(--b2);color:var(--t3);font-size:10px;padding:4px 10px;border-radius:6px;cursor:pointer;font-family:inherit;letter-spacing:.06em;text-transform:uppercase">Simulate day</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:14px;font-family:'DM Sans',sans-serif;margin-bottom:16px">
        ${cell('Followers', conn.followerCount.toLocaleString())}
        ${cell('Posts', String(conn.postCount))}
        ${cell('Engagement', conn.engagementRate.toFixed(2) + '%')}
        ${cell('Avg reach', conn.avgReach ? conn.avgReach.toLocaleString() : '—')}
        ${cell('Top audience', topAgeBucket ? topAgeBucket.bucket : '—')}
      </div>
      ${series.length ? `<div style="margin-bottom:16px">
        <div style="font-size:10px;color:var(--t3);letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px">Followers — last 30 days</div>
        ${sparkline(series)}
      </div>` : ''}
      ${topPost ? `<div style="padding:12px 14px;background:var(--s2);border:1px solid var(--b1);border-radius:10px">
        <div style="font-size:10px;color:var(--t3);letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px">Top-performing post</div>
        <div style="font-size:13px;color:var(--t1);line-height:1.45;margin-bottom:6px">${escape(topPost.caption || '')}</div>
        <div style="font-size:11px;color:var(--t3);display:flex;gap:16px">
          <span>${(topPost.like_count?.toLocaleString?.() ?? topPost.likes ?? 0)} likes</span>
          <span>${(topPost.comments_count?.toLocaleString?.() ?? topPost.comments ?? 0)} comments</span>
          ${topPost.insights?.reach ? `<span>${topPost.insights.reach.toLocaleString()} reach</span>` : ''}
          ${topPost.insights?.saved ? `<span>${topPost.insights.saved.toLocaleString()} saves</span>` : ''}
        </div>
      </div>` : ''}
    `
    const briefGrid = host.querySelector('.briefing-grid')
    if (briefGrid) host.insertBefore(el, briefGrid)
    else host.appendChild(el)

    el.querySelector('#vx-ig-simulate')?.addEventListener('click', async () => {
      const btn = el.querySelector('#vx-ig-simulate')
      if (btn) { btn.disabled = true; btn.textContent = '…' }
      try {
        const res = await fetch('/api/instagram/simulate', { method: 'POST', credentials: 'include' })
        if (res.ok) {
          const company = window.__vxCompany || null
          const conn2 = company ? await fetchInsights(company.id) : null
          if (conn2) renderInstagramWidget(conn2)
        }
      } finally {
        if (btn) btn.disabled = false
      }
    })
  }

  function escape(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  function sparkline(series) {
    const w = 600, h = 48, pad = 2
    const ys = series.map((p) => p.followers)
    const min = Math.min(...ys)
    const max = Math.max(...ys)
    const range = Math.max(1, max - min)
    const step = (w - pad * 2) / (series.length - 1)
    const path = series
      .map((p, i) => {
        const x = pad + i * step
        const y = h - pad - ((p.followers - min) / range) * (h - pad * 2)
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
    const lastX = w - pad
    const lastY = h - pad - ((ys[ys.length - 1] - min) / range) * (h - pad * 2)
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" style="display:block">
      <path d="${path}" fill="none" stroke="#c8f060" stroke-width="1.5" />
      <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="3" fill="#c8f060" />
    </svg>`
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
    window.__vxCompany = company || null
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
