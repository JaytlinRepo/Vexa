/* Vexa — Phyllo Connect integration.
 *
 * Exposes window.vxPhylloConnect(companyId?) which:
 *   1. Fetches a short-lived SDK token from /api/phyllo/sdk-token
 *   2. Lazy-loads the Phyllo Connect SDK from their CDN
 *   3. Opens the connect modal
 *   4. On accountConnected → POST /api/phyllo/sync → refresh the dashboard
 *
 * Adds a visible "Connect real account via Phyllo" button to:
 *   - The onboarding Instagram step
 *   - Settings Instagram section (future)
 *   - The dashboard Instagram widget when no connection exists
 */
;(function () {
  let sdkLoaded = null

  function loadSdk() {
    if (sdkLoaded) return sdkLoaded
    sdkLoaded = new Promise((resolve, reject) => {
      if (window.PhylloConnect) return resolve(window.PhylloConnect)
      const s = document.createElement('script')
      s.src = 'https://cdn.getphyllo.com/connect/v2/phyllo-connect.js'
      s.async = true
      s.onload = () => resolve(window.PhylloConnect)
      s.onerror = () => reject(new Error('phyllo_sdk_load_failed'))
      document.head.appendChild(s)
    })
    return sdkLoaded
  }

  async function fetchToken() {
    const res = await fetch('/api/phyllo/sdk-token', { method: 'POST', credentials: 'include' })
    if (!res.ok) throw new Error('sdk_token_failed')
    return res.json()
  }

  async function syncAccount(accountId, companyId) {
    const res = await fetch('/api/phyllo/sync', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId, companyId }),
    })
    return res.ok
  }

  async function openConnect(opts) {
    const { companyId, onConnected, workPlatformId } = opts || {}
    console.log('[phyllo] openConnect start', { companyId })
    try {
      const [PhylloConnect, token] = await Promise.all([loadSdk(), fetchToken()])
      console.log('[phyllo] sdk + token ready', {
        hasSdk: !!PhylloConnect,
        hasInit: typeof PhylloConnect?.initialize,
        tokenLen: token?.sdkToken?.length,
        phylloUserId: token?.phylloUserId,
        env: token?.environment,
      })
      if (!PhylloConnect || typeof PhylloConnect.initialize !== 'function') {
        throw new Error('phyllo_sdk_missing_initialize')
      }
      const phyllo = PhylloConnect.initialize({
        clientDisplayName: 'Vexa',
        environment: token.environment || 'staging',
        userId: token.phylloUserId,
        token: token.sdkToken,
        ...(workPlatformId ? { workPlatformId } : {}),
      })
      console.log('[phyllo] initialized', phyllo)
      phyllo.on('accountConnected', async (accountId, workplatformId, userId) => {
        console.log('[phyllo] accountConnected', { accountId, workplatformId, userId })
        const ok = await syncAccount(accountId, companyId)
        console.log('[phyllo] sync result', ok)
        if (ok && typeof onConnected === 'function') onConnected(accountId)
      })
      phyllo.on('accountDisconnected', (accountId, workplatformId, userId) => {
        console.log('[phyllo] disconnected', { accountId, workplatformId, userId })
      })
      phyllo.on('tokenExpired', (userId) => {
        console.warn('[phyllo] token expired for', userId)
      })
      phyllo.on('exit', (reason, userId) => {
        console.log('[phyllo] exit', { reason, userId })
      })
      phyllo.on('connectionFailure', (reason, workplatformId, userId) => {
        console.warn('[phyllo] connectionFailure', { reason, workplatformId, userId })
      })
      phyllo.open()
      console.log('[phyllo] open() called')
    } catch (err) {
      console.error('[phyllo] open failed', err)
      alert('Phyllo connect failed: ' + (err?.message || err))
    }
  }

  // Public API used by other wire scripts.
  window.vxPhylloConnect = openConnect

  // ── Inject a "Connect real account" button into the onboarding IG step ──
  function injectOnboardingButton() {
    const step = document.getElementById('ob-8')
    if (!step || step.dataset.vxPhylloInjected) return
    const card = step.querySelector('.ob-ig-card')
    if (!card) return
    step.dataset.vxPhylloInjected = '1'
    const wrap = document.createElement('div')
    wrap.style.cssText = 'display:flex;gap:10px;align-items:center;margin-top:12px'
    wrap.innerHTML = `
      <button id="vx-phyllo-btn" style="background:var(--t1);color:var(--bg);border:none;padding:10px 18px;border-radius:8px;font-size:12px;font-weight:600;font-family:'Syne',sans-serif;letter-spacing:.04em;cursor:pointer">Connect real account via Phyllo</button>
      <span style="color:var(--t3);font-size:11px">or enter a handle above to use demo data</span>
    `
    card.appendChild(wrap)
    wrap.querySelector('#vx-phyllo-btn').addEventListener('click', () => {
      openConnect({
        onConnected: () => {
          const result = document.getElementById('ob-ig-result')
          if (result) {
            result.innerHTML = '<div style="padding:8px 0;color:var(--t1);font-size:12px">Connected. Your real numbers will load on the dashboard.</div>'
            result.classList.add('show')
          }
        },
      })
    })
  }

  // ── Inject a "Connect Instagram" CTA on the dashboard ──
  // Visible whenever the current connection is stub/missing. Hides itself
  // once we verify source === 'phyllo'.
  async function injectDashboardConnectButton() {
    const main = document.querySelector('#view-db-dashboard main')
    if (!main) return
    const overview = main.querySelector('section:nth-of-type(2)')
    if (!overview) return
    // If the panel is already there, leave it alone.
    if (document.getElementById('vx-phyllo-cta')) return

    const company = window.__vxCompany
    if (!company?.id) return

    let shouldShow = true
    try {
      const res = await fetch(`/api/instagram/insights?companyId=${company.id}`, { credentials: 'include' })
      if (res.ok) {
        const json = await res.json()
        if (json?.connection?.source === 'phyllo') shouldShow = false
      }
    } catch {}
    if (!shouldShow) return

    const cta = document.createElement('div')
    cta.id = 'vx-phyllo-cta'
    cta.style.cssText = 'background:var(--s1);border:1px solid var(--b1);border-radius:10px;padding:14px 16px;margin-bottom:22px;display:flex;align-items:center;gap:12px'
    cta.innerHTML = `
      <div style="flex:1">
        <div style="color:var(--t1);font-size:13px;font-weight:600;margin-bottom:2px">Connect your real Instagram</div>
        <div style="color:var(--t2);font-size:11px">Pull follower counts, post performance, and audience demographics via Phyllo. Takes ~30 seconds.</div>
      </div>
      <button id="vx-phyllo-dash-btn" style="background:var(--t1);color:var(--bg);border:none;padding:8px 16px;border-radius:6px;font-size:11px;font-weight:600;font-family:'Syne',sans-serif;letter-spacing:.04em;cursor:pointer">Connect</button>
    `
    overview.insertAdjacentElement('afterend', cta)
    cta.querySelector('#vx-phyllo-dash-btn').addEventListener('click', () => {
      openConnect({
        companyId: company.id,
        onConnected: () => {
          cta.remove()
          location.reload()
        },
      })
    })
  }

  // ── Inject a multi-platform Integrations panel on Settings ──
  // The curated list below is shown in order. Anything Phyllo returns that
  // isn't here gets appended under "Other connections."
  const CURATED = [
    { id: '9bb8913b-ddd9-430b-a66a-d74d846e6c66', name: 'Instagram' },
    { id: 'de55aeec-0dc8-4119-bf90-16b3d1f0c987', name: 'TikTok' },
    { id: '14d9ddf5-51c6-415e-bde6-f8ed36ad7054', name: 'YouTube' },
    { id: '7645460a-96e0-4192-a3ce-a1fc30641f72', name: 'X' },
    { id: 'ad2fec62-2987-40a0-89fb-23485972598c', name: 'Facebook' },
    { id: 'e4de6c01-5b78-4fc0-a651-24f44134457b', name: 'Twitch' },
    { id: 'fbf76083-710b-439a-8b8c-956f607ef2c1', name: 'Substack' },
    { id: 'ee3c8d7a-3207-4f56-945f-f942b34c96e1', name: 'Snapchat' },
  ]

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
        <p>Connect the platforms where your brand lives so your team works from real numbers. Managed through Phyllo — one login per platform, read-only access, disconnect any time.</p>
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

    // Pull: our user + company + IG connection state, plus Phyllo's list of
    // accounts (source of truth for multi-platform status).
    const [me, igConn, phylloRes] = await Promise.all([
      fetch('/api/auth/me', { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetchIgConnection(),
      fetch('/api/phyllo/accounts', { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
    const company = me?.companies?.[0]
    window.__vxCompany = company || window.__vxCompany
    const accounts = phylloRes?.accounts || []

    // Index Phyllo-connected accounts by work platform id.
    const byPlatform = new Map()
    for (const a of accounts) {
      const pid = a.work_platform?.id
      if (pid && !byPlatform.has(pid)) byPlatform.set(pid, a)
    }

    // Build row list: curated first, then anything non-curated Phyllo returned.
    const seen = new Set()
    const rows = []
    for (const p of CURATED) {
      rows.push(platformRow(p, byPlatform.get(p.id), igConn))
      seen.add(p.id)
    }
    const extras = accounts.filter((a) => a.work_platform?.id && !seen.has(a.work_platform.id))
    for (const a of extras) {
      rows.push(platformRow({ id: a.work_platform.id, name: a.work_platform.name || 'Connection' }, a, igConn))
    }

    body.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px">${rows.join('')}</div>
      <div style="margin-top:18px;padding:14px 16px;background:var(--s2);border:1px dashed var(--b1);border-radius:10px;display:flex;align-items:center;gap:12px">
        <div style="flex:1">
          <div style="color:var(--t1);font-size:13px;font-weight:600;margin-bottom:2px">Don't see your platform?</div>
          <div style="color:var(--t2);font-size:11px">Open the full picker — Phyllo supports 20+ platforms.</div>
        </div>
        <button id="vx-integ-browse" style="background:transparent;border:1px solid var(--b2);color:var(--t2);padding:8px 14px;border-radius:6px;font-size:11px;font-family:inherit;cursor:pointer">Browse all</button>
      </div>
    `

    body.querySelectorAll('[data-connect]').forEach((btn) => {
      btn.addEventListener('click', () => {
        openConnect({
          companyId: company?.id,
          workPlatformId: btn.dataset.connect,
          onConnected: () => renderIntegrationsState(),
        })
      })
    })
    body.querySelectorAll('[data-disconnect]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Disconnect this platform?')) return
        btn.disabled = true
        await fetch(`/api/phyllo/accounts/${btn.dataset.disconnect}/disconnect`, { method: 'POST', credentials: 'include' })
        renderIntegrationsState()
      })
    })
    body.querySelectorAll('[data-resync]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true
        btn.textContent = 'Resyncing…'
        await syncAccount(btn.dataset.resync, company?.id)
        renderIntegrationsState()
      })
    })
    const browse = body.querySelector('#vx-integ-browse')
    if (browse) {
      browse.addEventListener('click', () => {
        openConnect({
          companyId: company?.id,
          onConnected: () => renderIntegrationsState(),
        })
      })
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

  function platformRow(platform, account, igConn) {
    const isConnected = !!account && account.status !== 'NOT_CONNECTED'
    const statusDot = isConnected
      ? '<span style="width:7px;height:7px;border-radius:50%;background:var(--t1);display:inline-block"></span>'
      : '<span style="width:7px;height:7px;border-radius:50%;background:var(--t3);display:inline-block;opacity:.6"></span>'
    const label = isConnected ? 'Connected' : 'Not connected'

    let detail = ''
    if (isConnected) {
      const handle = account.platform_username ? `@${account.platform_username}` : 'Active'
      detail = `<span style="color:var(--t3);font-size:11px">· ${escapeHtml(handle)}</span>`
      // Add follower count + last sync if we have local data (Instagram only for now).
      if (platform.id === '9bb8913b-ddd9-430b-a66a-d74d846e6c66' && igConn?.source === 'phyllo') {
        detail += ` <span style="color:var(--t3);font-size:11px">· ${Number(igConn.followerCount).toLocaleString()} followers · last synced ${timeAgo(igConn.lastSyncedAt || igConn.connectedAt)}</span>`
      }
    }

    const actions = isConnected
      ? `${platform.id === '9bb8913b-ddd9-430b-a66a-d74d846e6c66' ? `<button data-resync="${account.id}" style="background:transparent;border:1px solid var(--b2);color:var(--t2);padding:6px 12px;border-radius:6px;font-size:10px;font-family:inherit;cursor:pointer">Resync</button>` : ''}
         <button data-disconnect="${account.id}" style="background:transparent;border:1px solid var(--b2);color:var(--t3);padding:6px 12px;border-radius:6px;font-size:10px;font-family:inherit;cursor:pointer">Disconnect</button>`
      : `<button data-connect="${platform.id}" style="background:var(--t1);color:var(--bg);border:none;padding:6px 14px;border-radius:6px;font-size:10px;font-weight:600;font-family:'Syne',sans-serif;letter-spacing:.04em;cursor:pointer">Connect</button>`

    return `
      <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--s2);border:1px solid var(--b1);border-radius:10px">
        <div style="width:32px;height:32px;border-radius:8px;background:var(--s3);display:grid;place-items:center;font-size:11px;font-weight:700;color:var(--t1);font-family:'Syne',sans-serif;flex-shrink:0">${esc(initials(platform.name))}</div>
        <div style="flex:1;min-width:0">
          <div style="color:var(--t1);font-size:13px;font-weight:600;margin-bottom:2px">${escapeHtml(platform.name)}</div>
          <div style="color:var(--t2);font-size:11px;display:flex;align-items:center;gap:8px">
            ${statusDot}<span>${escapeHtml(label)}</span>${detail}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">${actions}</div>
      </div>
    `
  }

  function initials(name) {
    return String(name || '?').replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || '?'
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

  function esc(s) { return escapeHtml(s) }
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  // Poll the DOM lightly so we inject once each view mounts. Drops to a
  // slower cadence after 20s since most rendering settles in the first few
  // seconds.
  let pollCount = 0
  const poll = setInterval(() => {
    pollCount++
    injectOnboardingButton()
    injectDashboardConnectButton()
    injectSettingsIntegrationsPanel()
    if (pollCount > 120) clearInterval(poll) // stop after ~72s
  }, 600)
})()
