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

  // ── Inject a "Connect Instagram" button on the dashboard when no IG ──
  function injectDashboardConnectButton() {
    const main = document.querySelector('#view-db-dashboard main') || document.querySelector('#view-db-dashboard .db-layout')
    if (!main) return
    // Check if a Followers tile shows "—" (meaning no IG). If so, inject CTA.
    const conn = window.__vxCompany
    if (!conn) return
    const tiles = main.querySelectorAll('div[data-v2-nav], div')
    // Find an empty spot: append after the overview section.
    const overview = main.querySelector('section:nth-of-type(2)')
    if (!overview || document.getElementById('vx-phyllo-cta')) return
    const followers = overview.querySelector('div:nth-of-type(2)')
    const value = followers?.querySelector('div[style*="Cormorant Garamond"]')
    if (!value || value.textContent.trim() !== '—') return // already connected
    const cta = document.createElement('div')
    cta.id = 'vx-phyllo-cta'
    cta.style.cssText = 'background:var(--s1);border:1px solid var(--b1);border-radius:10px;padding:16px 18px;margin-bottom:22px;display:flex;align-items:center;gap:12px'
    cta.innerHTML = `
      <div style="flex:1">
        <div style="color:var(--t1);font-size:13px;font-weight:600;margin-bottom:2px">Connect your Instagram</div>
        <div style="color:var(--t2);font-size:11px">Phyllo pulls follower counts, post performance, and audience demographics.</div>
      </div>
      <button id="vx-phyllo-dash-btn" style="background:var(--t1);color:var(--bg);border:none;padding:9px 16px;border-radius:6px;font-size:11px;font-weight:600;font-family:'Syne',sans-serif;letter-spacing:.04em;cursor:pointer">Connect</button>
    `
    overview.insertAdjacentElement('afterend', cta)
    cta.querySelector('#vx-phyllo-dash-btn').addEventListener('click', () => {
      openConnect({
        companyId: window.__vxCompany?.id,
        onConnected: () => {
          cta.remove()
          location.reload()
        },
      })
    })
  }

  // Poll the DOM lightly so we inject once the onboarding / dashboard mount.
  const poll = setInterval(() => {
    injectOnboardingButton()
    injectDashboardConnectButton()
  }, 600)
  // Stop polling after 60s to avoid wasting cycles forever.
  setTimeout(() => clearInterval(poll), 60000)
})()
