/* Vexa — metric goal + pacing card on the dashboard.
 *
 * Goals are picked by Jordan, not the CEO. The CEO's only actions are
 * "Have Jordan pick one," "Try another," and "Clear." This removes the
 * blank-page problem of goal-setting — the team does the work, the CEO
 * decides whether to accept and ships content.
 */
;(function () {
  let lastRender = 0

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  function fmt(n, type) {
    if (type === 'engagement') return Number(n || 0).toFixed(2) + '%'
    return Number(n || 0).toLocaleString()
  }

  async function fetchGoal() {
    try {
      const res = await fetch('/api/company/goal', { credentials: 'include' })
      if (!res.ok) return null
      return res.json()
    } catch {
      return null
    }
  }

  async function generateGoal(different) {
    try {
      const url = '/api/company/goal/generate' + (different ? '?different=1' : '')
      const res = await fetch(url, { method: 'POST', credentials: 'include' })
      return { ok: res.ok, data: await res.json().catch(() => null), status: res.status }
    } catch {
      return { ok: false, data: null, status: 0 }
    }
  }

  async function clearGoal() {
    try {
      await fetch('/api/company/goal', { method: 'DELETE', credentials: 'include' })
    } catch {}
  }

  function sectionLabel(text) {
    return `<h2 style="color:var(--t2);font-size:11px;letter-spacing:.16em;text-transform:uppercase;font-weight:600;margin:0 0 14px;font-family:'Syne',sans-serif">${esc(text)}</h2>`
  }

  function emptyCard(hasBaseline) {
    if (!hasBaseline) {
      return `
        <div style="background:var(--s1);border:1px solid var(--b1);border-radius:12px;padding:20px 22px;display:flex;align-items:center;justify-content:space-between;gap:14px">
          <div style="min-width:0">
            <div style="color:var(--t1);font-size:15px;font-weight:600;margin-bottom:4px">No goal yet.</div>
            <div style="color:var(--t3);font-size:12px;line-height:1.5">Connect your account so Jordan has real numbers to build your first goal against.</div>
          </div>
        </div>
      `
    }
    // Auto-generate: don't wait for user to click — Jordan picks immediately
    return `
      <div style="background:var(--s1);border:1px solid var(--b1);border-radius:12px;padding:20px 22px;display:flex;align-items:center;gap:14px">
        <div style="min-width:0;flex:1">
          <div style="color:var(--t2);font-size:13px;font-style:italic" id="vx-goal-autogen">Jordan is picking a goal based on your numbers…</div>
        </div>
      </div>
    `
  }

  function filledCard(goal, pacing) {
    const badge = goal.source === 'jordan'
      ? `<span style="display:inline-flex;align-items:center;gap:4px;background:var(--s3);color:var(--t2);font-size:10px;letter-spacing:.08em;text-transform:uppercase;padding:3px 8px;border-radius:8px;margin-bottom:6px">Picked by Jordan</span>`
      : ''
    const metricLabel = goal.metricLabel || goal.type
    if (!pacing) {
      return `
        <div style=”background:var(--s1);border:1px solid var(--b1);border-radius:12px;padding:16px 18px;display:flex;align-items:center;gap:12px”>
          <div style=”color:var(--t1);font-size:13px;font-weight:500;flex:1”>${esc(metricLabel)}: ${fmt(goal.target, goal.type)} by ${esc(goal.byDate)}</div>
          <div style=”color:var(--t3);font-size:11px”>Syncing…</div>
        </div>
      `
    }
    const progressW = Math.min(100, Math.round(pacing.progressPct * 100))
    const tint = pacing.onTrack ? 'var(--t1)' : '#ff6b6b'
    const verdict = pacing.onTrack ? 'On pace' : 'Off pace'
    return `
      <div style=”background:var(--s1);border:1px solid var(--b1);border-radius:12px;padding:16px 18px”>
        <div style=”display:flex;align-items:center;gap:12px;margin-bottom:8px”>
          <div style=”color:var(--t1);font-size:13px;font-weight:500;flex:1”>${esc(metricLabel)}: ${fmt(goal.target, goal.type)} by ${esc(goal.byDate)}</div>
          <div style=”color:${tint};font-size:11px;font-weight:600”>${verdict}</div>
        </div>
        <div style=”position:relative;height:6px;background:var(--s3);border-radius:8px;overflow:hidden”>
          <div style=”position:absolute;inset:0;width:${progressW}%;background:${tint};border-radius:8px;transition:width .4s ease”></div>
        </div>
        <div style=”display:flex;justify-content:space-between;color:var(--t3);font-size:10px;margin-top:4px”>
          <span>${fmt(pacing.current, goal.type)} now</span><span>${progressW}%</span><span>${pacing.daysLeft}d left</span>
        </div>
      </div>
    `
  }

  async function inject() {
    if (Date.now() - lastRender < 400) return
    lastRender = Date.now()
    const main = document.querySelector('#view-db-dashboard main')
    if (!main) return
    const sections = main.querySelectorAll('section')
    if (sections.length < 2) return
    document.getElementById('vx-goal')?.remove()

    const data = await fetchGoal()

    const section = document.createElement('section')
    section.id = 'vx-goal'
    section.style.marginBottom = '32px'
    section.innerHTML = `
      ${sectionLabel('Goal')}
      ${data?.goal ? filledCard(data.goal, data.pacing) : emptyCard(data?.hasBaseline)}
    `

    const anchor = sections[1]
    anchor.parentNode.insertBefore(section, anchor.nextSibling)

    // Auto-generate goal if baseline exists but no goal set
    if (!data?.goal && data?.hasBaseline) {
      generateGoal(false).then(function (r) {
        if (r.ok) inject()
        else {
          var el = document.getElementById('vx-goal-autogen')
          if (el) el.textContent = 'Jordan couldn\'t set a goal yet — try again after the next sync.'
        }
      })
    }
    section.querySelector('#vx-goal-another')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget
      btn.disabled = true
      btn.textContent = 'Picking…'
      const r = await generateGoal(true)
      if (!r.ok) {
        btn.disabled = false
        btn.textContent = 'Try another'
        return
      }
      inject()
    })
    section.querySelector('#vx-goal-reset')?.addEventListener('click', async () => {
      await clearGoal()
      inject()
    })
  }

  function retry() {
    if (!document.getElementById('vx-goal')) inject()
  }

  const origNav = window.navigate
  window.navigate = function (id) {
    const r = typeof origNav === 'function' ? origNav(id) : undefined
    if (id === 'db-dashboard') setTimeout(inject, 250)
    return r
  }
  const prevEnter = window.enterDashboard
  window.enterDashboard = async function () {
    if (typeof prevEnter === 'function') await prevEnter()
    setTimeout(inject, 260)
  }
  document.addEventListener('DOMContentLoaded', () => setTimeout(inject, 900))
  if (document.readyState !== 'loading') setTimeout(inject, 900)
  setInterval(retry, 1300)
})()
