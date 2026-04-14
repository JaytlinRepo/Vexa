/* Vexa — billing & usage UI
 *
 * Adds a Plan + Usage card to the dashboard (renders under quick stats) and
 * surfaces trial countdown / auto-renew status. Reads GET /api/usage.
 * Also exposes window.vxAssignTask(companyId, employeeId, title, type, description)
 * which is used by the team page's Assign-task modal; surfaces a friendly
 * upgrade prompt on a 402.
 */
;(function () {
  async function fetchUsage() {
    try {
      const res = await fetch('/api/usage', { credentials: 'include' })
      if (!res.ok) return null
      return res.json()
    } catch {
      return null
    }
  }

  function daysUntil(iso) {
    if (!iso) return null
    const diff = new Date(iso).getTime() - Date.now()
    if (diff <= 0) return 0
    return Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)))
  }

  function planLabel(plan, status) {
    const base = String(plan || 'starter').replace(/^./, (c) => c.toUpperCase())
    if (status === 'trial') return `${base} · Trial`
    if (status === 'past_due') return `${base} · Past due`
    if (status === 'canceled') return `${base} · Canceled`
    return `${base} · Active`
  }

  function accent(status) {
    if (status === 'past_due' || status === 'canceled') return '#ff6b6b'
    if (status === 'trial') return '#e8c87a'
    return 'var(--t1)'
  }

  function renderPanel(usage) {
    const main = document.querySelector('#view-db-dashboard .db-main-col')
    if (!main || !usage) return
    const stats = document.getElementById('vx-quickstats')
    if (!stats) return
    document.getElementById('vx-plan-card')?.remove()

    const days = daysUntil(usage.trialEndsAt)
    const trialLine =
      usage.subscriptionStatus === 'trial' && days !== null
        ? `Trial ends in ${days} day${days === 1 ? '' : 's'} — auto-renews to paid`
        : usage.subscriptionStatus === 'active'
          ? 'Active — renews monthly'
          : usage.subscriptionStatus === 'past_due'
            ? 'Payment failed — update billing to keep your team active'
            : 'Subscription canceled'

    const used = usage.tasks.used
    const limit = usage.tasks.limit
    const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100))
    const barColor = pct >= 90 ? '#ff6b6b' : pct >= 70 ? '#e8c87a' : 'var(--t1)'

    const card = document.createElement('div')
    card.id = 'vx-plan-card'
    card.style.cssText =
      'margin:4px 0 20px;padding:16px 18px;background:var(--s2);border:1px solid var(--b1);border-radius:12px;font-family:"DM Sans",sans-serif'
    card.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px">
        <div>
          <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--t3);margin-bottom:2px">Plan</div>
          <div style="font-size:14px;font-weight:600;color:${accent(usage.subscriptionStatus)}">${planLabel(usage.plan, usage.subscriptionStatus)}</div>
          <div style="font-size:12px;color:var(--t2);margin-top:2px">${trialLine}</div>
        </div>
        <button id="vx-plan-manage" style="background:transparent;border:1px solid var(--b2);color:var(--t2);font-size:11px;padding:7px 14px;border-radius:6px;cursor:pointer;font-family:inherit">Manage</button>
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
          <span style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--t3)">Tasks this month</span>
          <span style="font-size:12px;color:var(--t2)"><strong style="color:var(--t1);font-weight:600">${used}</strong> / ${limit >= 9999 ? '∞' : limit}</span>
        </div>
        <div style="height:6px;border-radius:3px;background:var(--s3);overflow:hidden">
          <div style="width:${pct}%;height:100%;background:${barColor};transition:width .4s ease"></div>
        </div>
      </div>
    `
    stats.insertAdjacentElement('afterend', card)
    card.querySelector('#vx-plan-manage').addEventListener('click', () => {
      if (typeof window.navigate === 'function') window.navigate('db-settings')
      setTimeout(() => {
        const billingTab = document.querySelector('.settings-nav-item[onclick*="billing"]')
        if (billingTab) billingTab.click()
      }, 400)
    })
  }

  async function refresh() {
    const usage = await fetchUsage()
    if (usage) {
      window.__vxLastUsage = usage
      renderPanel(usage)
    }
  }

  // ── Upgrade modal (shown when /api/tasks returns 402) ───────────────────
  function showUpgradeModal(usage) {
    document.getElementById('vx-upgrade')?.remove()
    const el = document.createElement('div')
    el.id = 'vx-upgrade'
    el.style.cssText =
      'position:fixed;inset:0;z-index:9200;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);padding:24px'
    el.innerHTML = `
      <div style="width:100%;max-width:440px;background:var(--s1);border:1px solid var(--b1);border-radius:14px;padding:32px;color:var(--t1);font-family:'DM Sans',sans-serif">
        <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--t3);margin-bottom:6px">Plan limit reached</div>
        <h3 style="font-family:'Syne',sans-serif;font-size:22px;margin:0 0 8px">Your team is at the monthly limit</h3>
        <p style="font-size:13px;color:var(--t2);line-height:1.6;margin:0 0 18px">
          You have used all ${usage?.tasks?.limit ?? '—'} tasks on the ${usage?.plan ?? 'starter'} plan this month.
          Upgrade to Pro for unlimited tasks, video generation, and meeting access.
        </p>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button id="vx-up-cancel" style="background:none;border:1px solid var(--b2);color:var(--t2);padding:10px 16px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:12px">Close</button>
          <button id="vx-up-see" style="background:var(--t1);color:var(--bg);border:none;padding:10px 18px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:600">See plans</button>
        </div>
      </div>
    `
    el.addEventListener('click', (e) => { if (e.target === el) el.remove() })
    document.body.appendChild(el)
    el.querySelector('#vx-up-cancel').addEventListener('click', () => el.remove())
    el.querySelector('#vx-up-see').addEventListener('click', () => {
      el.remove()
      if (typeof window.navigate === 'function') window.navigate('pricing')
    })
  }

  // Expose so team-wire.js can call this when its Assign button runs.
  window.vxAssignTask = async function (payload) {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.status === 402) {
      const json = await res.json().catch(() => null)
      showUpgradeModal(json?.usage)
      return { ok: false, limitReached: true }
    }
    if (!res.ok) {
      const json = await res.json().catch(() => null)
      return { ok: false, error: json?.error || 'failed' }
    }
    const json = await res.json()
    // Refresh usage panel + broadcast so every wire that shows tasks
    // (team strip, review queue, outputs library, calendar) can re-fetch
    // and surface the brief that just landed delivered.
    refresh()
    window.dispatchEvent(new CustomEvent('vx-task-changed', { detail: { task: json.task } }))
    return { ok: true, task: json.task }
  }

  const prevEnter = window.enterDashboard
  window.enterDashboard = async function () {
    if (typeof prevEnter === 'function') await prevEnter()
    setTimeout(refresh, 500)
  }
  const origNavigate = window.navigate
  window.navigate = function (id) {
    const r = typeof origNavigate === 'function' ? origNavigate(id) : undefined
    if (id === 'db-dashboard') setTimeout(refresh, 200)
    return r
  }

  if (document.readyState !== 'loading') setTimeout(refresh, 700)
  document.addEventListener('DOMContentLoaded', () => setTimeout(refresh, 800))
})()
