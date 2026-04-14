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
    return `<h2 style="color:var(--t2);font-size:10px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;margin:0 0 10px;font-family:'Syne',sans-serif">${esc(text)}</h2>`
  }

  function emptyCard(hasBaseline) {
    if (!hasBaseline) {
      return `
        <div style="background:var(--s1);border:1px solid var(--b1);border-radius:10px;padding:18px 20px;display:flex;align-items:center;justify-content:space-between;gap:14px">
          <div style="min-width:0">
            <div style="color:var(--t1);font-size:15px;font-weight:600;margin-bottom:4px">No goal yet.</div>
            <div style="color:var(--t3);font-size:12px;line-height:1.5">Connect your account so Jordan has real numbers to build your first goal against.</div>
          </div>
          <button data-v2-nav="db-settings" style="background:var(--t1);color:var(--bg);border:none;padding:9px 16px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:600;white-space:nowrap">Connect account</button>
        </div>
      `
    }
    return `
      <div style="background:var(--s1);border:1px solid var(--b1);border-radius:10px;padding:18px 20px;display:flex;align-items:center;justify-content:space-between;gap:14px">
        <div style="min-width:0">
          <div style="color:var(--t1);font-size:15px;font-weight:600;margin-bottom:4px">Jordan hasn't set your first goal yet.</div>
          <div style="color:var(--t3);font-size:12px;line-height:1.5">He'll propose something realistic based on where your account is today. Small, incremental — real wins, not wishful targets.</div>
        </div>
        <button id="vx-goal-gen" style="background:var(--t1);color:var(--bg);border:none;padding:9px 16px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:600;white-space:nowrap">Have Jordan pick one</button>
      </div>
    `
  }

  function filledCard(goal, pacing) {
    const badge = goal.source === 'jordan'
      ? `<span style="display:inline-flex;align-items:center;gap:4px;background:var(--s3);color:var(--t2);font-size:10px;letter-spacing:.08em;text-transform:uppercase;padding:3px 8px;border-radius:999px;margin-bottom:6px">Picked by Jordan</span>`
      : ''
    if (!pacing) {
      return `
        <div style="background:var(--s1);border:1px solid var(--b1);border-radius:10px;padding:18px 20px">
          ${badge}
          <div style="color:var(--t1);font-size:14px;font-weight:600;margin-bottom:4px">${esc(goal.metricLabel || goal.type)}: ${fmt(goal.target, goal.type)} by ${esc(goal.byDate)}</div>
          <div style="color:var(--t3);font-size:12px">Pacing will show once a fresh sync lands.</div>
        </div>
      `
    }
    const progressW = Math.min(100, Math.round(pacing.progressPct * 100))
    const timeW = Math.min(100, Math.round(pacing.timePct * 100))
    const tint = pacing.onTrack ? 'var(--t1)' : '#ff6b6b'
    const verdict = pacing.onTrack ? 'On pace' : 'Off pace'
    const projLine = `If the current pace holds, you'd land at ${fmt(pacing.projected, goal.type)} by ${esc(goal.byDate)}.`
    const metricLabel = goal.metricLabel || goal.type
    return `
      <div style="background:var(--s1);border:1px solid var(--b1);border-radius:10px;padding:18px 20px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px">
          <div style="min-width:0">
            ${badge}
            <div style="color:var(--t1);font-size:14px;font-weight:600">${esc(metricLabel)}: ${fmt(goal.target, goal.type)} by ${esc(goal.byDate)}</div>
            <div style="color:var(--t3);font-size:11px;margin-top:2px">Started at ${fmt(goal.baseline, goal.type)} · now ${fmt(pacing.current, goal.type)} · ${pacing.daysLeft}d left</div>
          </div>
          <div style="color:${tint};font-size:12px;font-weight:600;white-space:nowrap">${verdict}</div>
        </div>
        ${goal.rationale ? `<div style="color:var(--t2);font-size:12px;line-height:1.5;font-style:italic;border-left:2px solid var(--b2);padding:2px 12px;margin:0 0 14px">“${esc(goal.rationale)}” — Jordan</div>` : ''}
        <div style="position:relative;height:10px;background:var(--s3);border-radius:999px;overflow:hidden">
          <div style="position:absolute;inset:0;width:${progressW}%;background:${tint};border-radius:999px;transition:width .4s ease"></div>
          <div style="position:absolute;top:-2px;bottom:-2px;left:${timeW}%;width:2px;background:var(--t2);opacity:.55" title="Time elapsed"></div>
        </div>
        <div style="display:flex;justify-content:space-between;color:var(--t3);font-size:10px;margin-top:6px">
          <span>${progressW}% of goal</span><span>${timeW}% of time used</span>
        </div>
        <div style="color:var(--t2);font-size:12px;margin-top:12px;line-height:1.5">${esc(projLine)}</div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px">
          <button id="vx-goal-reset" style="background:transparent;border:1px solid var(--b2);color:var(--t3);padding:6px 12px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:10px;letter-spacing:.06em;text-transform:uppercase">Clear</button>
          <button id="vx-goal-another" style="background:transparent;border:1px solid var(--b2);color:var(--t2);padding:6px 12px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:10px;letter-spacing:.06em;text-transform:uppercase">Try another</button>
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
    section.style.marginBottom = '26px'
    section.innerHTML = `
      ${sectionLabel('Goal')}
      ${data?.goal ? filledCard(data.goal, data.pacing) : emptyCard(data?.hasBaseline)}
    `

    const anchor = sections[1]
    anchor.parentNode.insertBefore(section, anchor.nextSibling)

    section.querySelector('#vx-goal-gen')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget
      btn.disabled = true
      btn.textContent = 'Jordan is picking…'
      const r = await generateGoal(false)
      if (!r.ok) {
        btn.disabled = false
        btn.textContent = 'Have Jordan pick one'
        if (r.status === 400 && r.data?.error === 'no_baseline') {
          btn.textContent = 'Connect account first'
        }
        return
      }
      inject()
    })
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
