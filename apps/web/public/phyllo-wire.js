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
    const { companyId, onConnected } = opts || {}
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
      })
      console.log('[phyllo] initialized', phyllo)
      phyllo.on('accountConnected', async (accountId, workplatformId, userId) => {
        console.log('[phyllo] accountConnected', { accountId, workplatformId, userId })
        const ok = await syncAccount(accountId, companyId)
        console.log('[phyllo] sync result', ok)
        if (ok && typeof onConnected === 'function') onConnected(accountId)
      })
      phyllo.on('accountDisconnected', (a, w, u) => console.log('[phyllo] disconnected', a, w, u))
      phyllo.on('tokenExpired', () => console.warn('[phyllo] token expired'))
      phyllo.on('exit', (reason, userId) => console.log('[phyllo] exit', reason, userId))
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

  // ── Inject a full Instagram panel on Settings ──
  async function injectSettingsInstagramPanel() {
    const settingsView = document.getElementById('view-db-settings')
    if (!settingsView) return
    const nav = settingsView.querySelector('.settings-nav')
    if (!nav) return
    if (document.getElementById('vx-settings-instagram-tab')) return

    // Add the tab button (after any existing custom tabs)
    const tabBtn = document.createElement('button')
    tabBtn.id = 'vx-settings-instagram-tab'
    tabBtn.className = 'settings-nav-item'
    tabBtn.textContent = 'Instagram'
    tabBtn.setAttribute('onclick', "switchSettings(this,'instagram')")
    nav.appendChild(tabBtn)

    // Add the panel
    const container = settingsView.querySelector('.settings-panel')?.parentElement
    if (!container) return
    const panel = document.createElement('div')
    panel.className = 'settings-panel'
    panel.id = 'settings-instagram'
    panel.innerHTML = `
      <div class="settings-section">
        <h3>Instagram</h3>
        <p>Connect your Instagram Business or Creator account so your team works from real numbers. We use Phyllo, which handles OAuth on our behalf.</p>
        <div id="vx-ig-panel-body" style="margin-top:16px"></div>
      </div>
    `
    container.appendChild(panel)

    await renderSettingsPanelState()
  }

  async function renderSettingsPanelState() {
    const body = document.getElementById('vx-ig-panel-body')
    if (!body) return
    // Fetch current state
    let conn = null
    try {
      const me = await fetch('/api/auth/me', { credentials: 'include' }).then((r) => r.ok ? r.json() : null)
      const companyId = me?.companies?.[0]?.id
      if (companyId) {
        const res = await fetch(`/api/instagram/insights?companyId=${companyId}`, { credentials: 'include' })
        if (res.ok) conn = (await res.json()).connection
      }
      window.__vxCompany = me?.companies?.[0] || window.__vxCompany
    } catch {}

    const isPhyllo = conn?.source === 'phyllo'
    if (conn && isPhyllo) {
      body.innerHTML = `
        <div style="padding:14px 16px;background:var(--s2);border:1px solid var(--b1);border-radius:10px;display:flex;align-items:center;gap:12px">
          <div style="flex:1">
            <div style="font-size:12px;color:var(--t3);letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px">Connected via Phyllo</div>
            <div style="color:var(--t1);font-size:14px;font-weight:500;margin-bottom:2px">@${escapeHtml(conn.handle)}</div>
            <div style="color:var(--t2);font-size:12px">${Number(conn.followerCount).toLocaleString()} followers · last synced ${new Date(conn.lastSyncedAt || conn.connectedAt).toLocaleString()}</div>
          </div>
          <button id="vx-ig-resync" style="background:transparent;border:1px solid var(--b2);color:var(--t2);padding:8px 14px;border-radius:6px;font-size:11px;font-family:inherit;cursor:pointer">Resync</button>
          <button id="vx-ig-disconnect" style="background:transparent;border:1px solid var(--b2);color:var(--t3);padding:8px 14px;border-radius:6px;font-size:11px;font-family:inherit;cursor:pointer">Disconnect</button>
        </div>
      `
      body.querySelector('#vx-ig-resync').addEventListener('click', async () => {
        if (!conn?.phylloAccountId) return
        const btn = body.querySelector('#vx-ig-resync')
        btn.disabled = true
        btn.textContent = 'Resyncing…'
        const ok = await syncAccount(conn.phylloAccountId, conn.companyId)
        if (ok) renderSettingsPanelState()
        btn.disabled = false
      })
      body.querySelector('#vx-ig-disconnect').addEventListener('click', async () => {
        if (!confirm('Disconnect Instagram?')) return
        await fetch('/api/instagram', { method: 'DELETE', credentials: 'include' })
        renderSettingsPanelState()
      })
      return
    }

    const stubNote = conn && !isPhyllo
      ? `<div style="padding:10px 14px;background:var(--s3);border:1px solid var(--b1);border-radius:8px;color:var(--t2);font-size:12px;margin-bottom:14px">Currently showing demo data for <strong style="color:var(--t1)">@${escapeHtml(conn.handle)}</strong>. Connect real account below.</div>`
      : ''
    body.innerHTML = `
      ${stubNote}
      <button id="vx-ig-connect-btn" style="background:var(--t1);color:var(--bg);border:none;padding:11px 20px;border-radius:8px;font-size:12px;font-weight:600;font-family:'Syne',sans-serif;letter-spacing:.04em;cursor:pointer">Connect Instagram via Phyllo</button>
      <div style="margin-top:14px;color:var(--t3);font-size:11px;line-height:1.6">
        Read-only access. Requires a Business or Creator Instagram account.
        You can disconnect at any time.
      </div>
    `
    body.querySelector('#vx-ig-connect-btn').addEventListener('click', () => {
      openConnect({
        companyId: window.__vxCompany?.id,
        onConnected: () => {
          renderSettingsPanelState()
          location.reload()
        },
      })
    })
  }

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
    injectSettingsInstagramPanel()
    if (pollCount > 120) clearInterval(poll) // stop after ~72s
  }, 600)
})()
