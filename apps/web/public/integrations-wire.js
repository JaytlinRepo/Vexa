/* Sovexa — Platform integrations UI.
 *
 * Renders connection-status pills on the dashboard and an Integrations
 * panel in Settings. Instagram uses direct Meta OAuth, TikTok uses
 * Login Kit OAuth. Both read from /api/platform/accounts.
 */
;(function () {
  const IG_ID = 'instagram'
  const TT_ID = 'tiktok'

  const DASH_CURATED = [
    { id: IG_ID, name: 'Instagram' },
    { id: TT_ID, name: 'TikTok' },
  ]

  // ── Helpers ──────────────────────────────────────────────────────────

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  function timeAgo(iso) {
    if (!iso) return 'never'
    const diff = Math.max(0, Date.now() - new Date(iso).getTime())
    const m = Math.floor(diff / 60000)
    if (m < 1) return 'just now'
    if (m < 60) return m + ' min ago'
    const h = Math.floor(m / 60)
    if (h < 24) return h + ' hr ago'
    return Math.floor(h / 24) + 'd ago'
  }

  function initials(name) {
    return String(name || '?').replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || '?'
  }

  // ── Shared state ─────────────────────────────────────────────────────

  let cachedAccounts = null

  async function fetchAccounts() {
    try {
      const res = await fetch('/api/platform/accounts', { credentials: 'include' })
      if (!res.ok) return []
      const json = await res.json()
      cachedAccounts = json.accounts || []
      return cachedAccounts
    } catch {
      return cachedAccounts || []
    }
  }

  function getCompanyId() {
    return window.__vxCompany?.id || ''
  }

  // ── Dashboard connection pills ───────────────────────────────────────

  async function injectDashboardConnectButton() {
    try {
      const main = document.querySelector('#view-db-dashboard main')
      if (!main) return
      const overview = main.querySelector('section:nth-of-type(2)')
      if (!overview) return
      const companyId = getCompanyId()
      if (!companyId) return

      const accounts = await fetchAccounts()
      const byPlatform = new Map()
      for (const a of accounts) {
        if (!byPlatform.has(a.platform)) byPlatform.set(a.platform, a)
      }

      const pills = DASH_CURATED.map((p) => {
        const acct = byPlatform.get(p.id)
        const connected = !!acct
        const handle = acct?.handle ? '@' + acct.handle : null
        return `
          <div data-pid="${p.id}" style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--s2);border:1px solid var(--b1);border-radius:8px;cursor:pointer;transition:border-color .15s" title="${connected ? (handle || 'Connected') : 'Not connected — click to connect'}">
            <span style="width:9px;height:9px;border-radius:50%;background:${connected ? '#34d27a' : 'var(--t3)'};${connected ? 'box-shadow:0 0 0 3px rgba(52,210,122,.18)' : 'opacity:.55'};flex-shrink:0"></span>
            <span style="color:var(--t1);font-size:12px;font-weight:500">${escapeHtml(p.name)}</span>
            ${connected && handle ? `<span style="color:var(--t3);font-size:11px">${escapeHtml(handle)}</span>` : ''}
          </div>
        `
      }).join('')

      const html = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px">
          <div style="color:var(--t3);font-size:10px;letter-spacing:.14em;text-transform:uppercase;font-weight:600">Connections</div>
          <a href="#" id="vx-manage-conns" style="color:var(--t3);font-size:11px;text-decoration:none">Manage →</a>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">${pills}</div>
      `

      const existing = document.getElementById('vx-integrations-cta')
      if (existing) {
        existing.innerHTML = html
      } else {
        const cta = document.createElement('div')
        cta.id = 'vx-integrations-cta'
        cta.style.cssText = 'margin-bottom:22px'
        cta.innerHTML = html
        overview.insertAdjacentElement('afterend', cta)
      }

      const root = document.getElementById('vx-integrations-cta')
      if (!root) return

      root.querySelectorAll('[data-pid]').forEach((pill) => {
        pill.addEventListener('mouseenter', () => { pill.style.borderColor = 'var(--b2)' })
        pill.addEventListener('mouseleave', () => { pill.style.borderColor = 'var(--b1)' })
        pill.addEventListener('click', () => {
          const pid = pill.dataset.pid
          if (pid === IG_ID) {
            window.location.href = `/api/instagram/auth/start?companyId=${encodeURIComponent(companyId)}`
          } else if (pid === TT_ID) {
            window.location.href = `/api/tiktok/auth/start?companyId=${encodeURIComponent(companyId)}`
          }
        })
      })

      root.querySelector('#vx-manage-conns')?.addEventListener('click', (e) => {
        e.preventDefault()
        if (typeof window.navigate === 'function') window.navigate('db-settings')
        setTimeout(() => {
          document.getElementById('vx-settings-integrations-tab')?.click()
        }, 400)
      })
    } catch (err) {
      console.warn('[integrations] dashboard inject error', err?.message || err)
    }
  }

  // ── Settings Integrations panel ──────────────────────────────────────

  async function injectSettingsIntegrationsPanel() {
    const settingsView = document.getElementById('view-db-settings')
    if (!settingsView) return
    const nav = settingsView.querySelector('.settings-nav')
    if (!nav) return
    if (document.getElementById('vx-settings-integrations-tab')) return

    const tabBtn = document.createElement('button')
    tabBtn.id = 'vx-settings-integrations-tab'
    tabBtn.className = 'settings-nav-item'
    tabBtn.textContent = 'Integrations'
    tabBtn.setAttribute('onclick', "switchSettings(this,'integrations')")
    nav.appendChild(tabBtn)

    const container = settingsView.querySelector('.settings-panel')?.parentElement
    if (!container) return
    const panel = document.createElement('div')
    panel.className = 'settings-panel'
    panel.id = 'settings-integrations'
    panel.innerHTML = `
      <div class="settings-section">
        <h3>Integrations</h3>
        <p>Connect the platforms where your brand lives so your team works from real numbers. Read-only access, disconnect any time.</p>
        <div id="vx-integrations-body" style="margin-top:16px"></div>
      </div>
    `
    container.appendChild(panel)

    await renderIntegrationsState()
  }

  async function renderIntegrationsState() {
    const body = document.getElementById('vx-integrations-body')
    if (!body) return
    body.innerHTML = '<div style="padding:16px;color:var(--t3);font-size:12px">Loading connections…</div>'

    const [accounts, igConn, ttConn] = await Promise.all([
      fetchAccounts(),
      fetchIgConnection(),
      fetchTiktokConnection(),
    ])

    const byPlatform = new Map()
    for (const a of accounts) {
      if (!byPlatform.has(a.platform)) byPlatform.set(a.platform, a)
    }

    const rows = DASH_CURATED.map((p) => platformRow(p, byPlatform.get(p.id), igConn, ttConn))
    body.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px">${rows.join('')}</div>`

    // Toggle buttons (connect / disconnect)
    body.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const connected = btn.dataset.connected === '1'
        const platformId = btn.dataset.toggle
        const companyId = getCompanyId()
        if (!companyId) return

        if (platformId === TT_ID) {
          if (!connected) {
            window.location.href = `/api/tiktok/auth/start?companyId=${encodeURIComponent(companyId)}`
            return
          }
          if (!confirm('Disconnect TikTok?')) return
          btn.disabled = true
          await fetch(`/api/tiktok/connections/${companyId}`, { method: 'DELETE', credentials: 'include' })
          renderIntegrationsState()
          return
        }

        if (platformId === IG_ID) {
          if (!connected) {
            window.location.href = `/api/instagram/auth/start?companyId=${encodeURIComponent(companyId)}`
            return
          }
          if (!confirm('Disconnect Instagram?')) return
          btn.disabled = true
          await fetch('/api/instagram', { method: 'DELETE', credentials: 'include' })
          renderIntegrationsState()
          return
        }
      })
    })

    // Reconnect buttons
    body.querySelectorAll('[data-connect]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const companyId = getCompanyId()
        if (!companyId) return
        const platformId = btn.dataset.connect
        if (platformId === IG_ID) {
          window.location.href = `/api/instagram/auth/start?companyId=${encodeURIComponent(companyId)}`
        } else if (platformId === TT_ID) {
          window.location.href = `/api/tiktok/auth/start?companyId=${encodeURIComponent(companyId)}`
        }
      })
    })

    // Resync buttons
    body.querySelectorAll('[data-resync]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const companyId = getCompanyId()
        if (!companyId) return
        btn.disabled = true
        btn.textContent = 'Resyncing…'
        const platform = btn.dataset.resync
        if (platform === IG_ID) {
          await fetch('/api/instagram/sync', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ companyId }),
          })
        } else if (platform === TT_ID) {
          await fetch('/api/tiktok/sync', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ companyId }),
          })
        }
        cachedAccounts = null
        renderIntegrationsState()
      })
    })
  }

  async function fetchTiktokConnection() {
    try {
      const me = await fetch('/api/auth/me', { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))
      const companyId = me?.companies?.[0]?.id
      if (!companyId) return null
      const res = await fetch(`/api/tiktok/insights?companyId=${companyId}`, { credentials: 'include' })
      if (!res.ok) return null
      return (await res.json()).connection
    } catch {
      return null
    }
  }

  async function fetchIgConnection() {
    try {
      const me = await fetch('/api/auth/me', { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))
      const companyId = me?.companies?.[0]?.id
      if (!companyId) return null
      const res = await fetch(`/api/instagram/insights?companyId=${companyId}`, { credentials: 'include' })
      if (!res.ok) return null
      return (await res.json()).connection
    } catch {
      return null
    }
  }

  function platformRow(platform, acct, igConn, ttConn) {
    const isTiktok = platform.id === TT_ID
    const isIG = platform.id === IG_ID

    let isConnected = false
    if (isTiktok) isConnected = !!ttConn
    else if (isIG) isConnected = !!igConn || !!acct
    else isConnected = !!acct

    let detail = ''
    if (isConnected) {
      if (isTiktok) {
        const parts = [ttConn.handle || 'Active']
        if (Number(ttConn.followerCount) > 0) parts.push(`${Number(ttConn.followerCount).toLocaleString()} followers`)
        parts.push(`synced ${timeAgo(ttConn.lastSyncedAt || ttConn.connectedAt)}`)
        detail = parts.map(escapeHtml).join(' · ')
      } else if (isIG && igConn) {
        const parts = [`@${igConn.handle || acct?.handle || 'unknown'}`]
        if (Number(igConn.followerCount) > 0) parts.push(`${Number(igConn.followerCount).toLocaleString()} followers`)
        parts.push(`synced ${timeAgo(igConn.lastSyncedAt || igConn.connectedAt)}`)
        detail = parts.map(escapeHtml).join(' · ')
      } else if (acct) {
        detail = escapeHtml(`@${acct.handle} · synced ${timeAgo(acct.lastSyncedAt)}`)
      }
    } else {
      detail = 'Click the toggle to connect'
    }

    const knobSide = isConnected ? 'right:2px' : 'left:2px'
    const trackBg = isConnected ? 'background:#22c55e' : 'background:var(--s3);border:1px solid var(--b1)'
    const knobColor = isConnected ? 'background:#fff' : 'background:var(--t3)'
    const toggle = `
      <button
        data-toggle="${platform.id}"
        data-connected="${isConnected ? '1' : '0'}"
        role="switch"
        aria-checked="${isConnected ? 'true' : 'false'}"
        aria-label="${escapeHtml(platform.name)} — ${isConnected ? 'connected' : 'not connected'}"
        style="position:relative;width:44px;height:24px;border-radius:8px;${trackBg};border:none;cursor:pointer;transition:background .2s;padding:0;flex-shrink:0">
        <span style="position:absolute;top:2px;${knobSide};width:20px;height:20px;border-radius:50%;${knobColor};transition:all .2s;box-shadow:0 1px 3px rgba(0,0,0,.35)"></span>
      </button>
    `

    const resyncBtn = isConnected
      ? `<button data-resync="${platform.id}" style="background:transparent;border:1px solid var(--b2);color:var(--t2);padding:6px 12px;border-radius:6px;font-size:10px;font-family:inherit;cursor:pointer">Resync</button>`
      : ''
    const reconnectBtn = isConnected
      ? `<button data-connect="${platform.id}" style="background:transparent;color:var(--t2);border:1px solid var(--b2);padding:6px 12px;border-radius:6px;font-size:10px;font-family:inherit;cursor:pointer">Reconnect</button>`
      : ''

    const labelColor = isConnected ? 'color:#22c55e' : 'color:var(--t3)'
    const labelText = isConnected ? 'Connected' : 'Not connected'

    return `
      <div style="display:flex;align-items:center;gap:14px;padding:14px 16px;background:var(--s2);border:1px solid var(--b1);border-radius:10px">
        <div style="width:32px;height:32px;border-radius:8px;background:var(--s3);display:grid;place-items:center;font-size:11px;font-weight:700;color:var(--t1);font-family:'Syne',sans-serif;flex-shrink:0">${escapeHtml(initials(platform.name))}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:2px">
            <div style="color:var(--t1);font-size:13px;font-weight:600">${escapeHtml(platform.name)}</div>
            <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;${labelColor}">${labelText}</div>
          </div>
          <div style="color:var(--t2);font-size:11px">${detail}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">${resyncBtn}${reconnectBtn}${toggle}</div>
      </div>
    `
  }

  // Poll the DOM lightly so we inject once each view mounts.
  let pollCount = 0
  const poll = setInterval(() => {
    pollCount++
    injectDashboardConnectButton()
    injectSettingsIntegrationsPanel()
    if (pollCount > 120) clearInterval(poll)
  }, 600)
})()
