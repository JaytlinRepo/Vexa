/* Vexa — monthly scorecard card on the dashboard.
 *
 * Pulls /api/company/scorecard. Shows three things the CEO cares about at
 * renewal time: outputs shipped this month, approval rate on that work,
 * and engagement lift vs. 30 days ago. All three answer "is this team
 * earning their subscription?"
 */
;(function () {
  let lastRender = 0

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  async function fetchScorecard() {
    try {
      const res = await fetch('/api/company/scorecard', { credentials: 'include' })
      if (!res.ok) return null
      return res.json()
    } catch {
      return null
    }
  }

  function sectionLabel(text) {
    return `<h2 style="color:var(--t2);font-size:10px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;margin:0 0 10px;font-family:'Syne',sans-serif">${esc(text)}</h2>`
  }

  function statCard(label, big, sub, tint) {
    return `
      <div style="background:var(--s1);border:1px solid var(--b1);border-radius:10px;padding:18px 20px">
        <div style="color:var(--t3);font-size:10px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px">${esc(label)}</div>
        <div style="color:${tint || 'var(--t1)'};font-size:24px;font-family:'Cormorant Garamond',serif;font-weight:500;line-height:1.1;margin-bottom:4px">${big}</div>
        <div style="color:var(--t3);font-size:11px;line-height:1.4">${esc(sub)}</div>
      </div>
    `
  }

  function pctFmt(n, signed) {
    const v = Number(n || 0) * 100
    const s = v.toFixed(1) + '%'
    if (!signed) return s
    return (v >= 0 ? '+' : '') + s
  }

  async function inject() {
    if (Date.now() - lastRender < 400) return
    lastRender = Date.now()
    const main = document.querySelector('#view-db-dashboard main')
    if (!main) return
    const sections = main.querySelectorAll('section')
    if (sections.length < 3) return
    document.getElementById('vx-scorecard')?.remove()

    const data = await fetchScorecard()
    if (!data?.scorecard) return
    const sc = data.scorecard

    const outputsBig = `<span>${Number(sc.outputsShipped || 0).toLocaleString()}</span>`
    const outputsSub = `${sc.tasksDelivered || 0} tasks delivered by the team this month.`

    const approvalBig = sc.approvalRate == null
      ? '<span style="color:var(--t3)">—</span>'
      : `${Math.round(sc.approvalRate * 100)}%`
    const approvalSub = sc.approvalRate == null
      ? 'No reviewed work yet this month.'
      : `${sc.tasksApproved} approved of ${sc.tasksApproved + (sc.tasksDelivered - sc.tasksApproved)} you reviewed.`

    let liftBig, liftSub, liftTint
    if (!sc.engagementLift) {
      liftBig = '<span style="color:var(--t3)">—</span>'
      liftSub = 'Lift shows once you have 30 days of synced data.'
      liftTint = null
    } else {
      const delta = sc.engagementLift.deltaPct
      liftBig = pctFmt(delta, true)
      liftSub = `${sc.engagementLift.now.toFixed(2)}% today vs. ${sc.engagementLift.then.toFixed(2)}% 30d ago.`
      liftTint = delta >= 0 ? 'var(--t1)' : '#ff6b6b'
    }

    const section = document.createElement('section')
    section.id = 'vx-scorecard'
    section.style.marginBottom = '26px'
    section.innerHTML = `
      ${sectionLabel(`This month — ${esc(sc.monthLabel)}`)}
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
        ${statCard('Outputs shipped', outputsBig, outputsSub, null)}
        ${statCard('Approval rate', approvalBig, approvalSub, null)}
        ${statCard('Engagement lift (30d)', liftBig, liftSub, liftTint)}
      </div>
    `
    // Place near the end — before the Activity section (last) if present.
    const last = sections[sections.length - 1]
    main.insertBefore(section, last)
  }

  function retry() {
    if (!document.getElementById('vx-scorecard')) inject()
  }

  const origNav = window.navigate
  window.navigate = function (id) {
    const r = typeof origNav === 'function' ? origNav(id) : undefined
    if (id === 'db-dashboard') setTimeout(inject, 280)
    return r
  }
  const prevEnter = window.enterDashboard
  window.enterDashboard = async function () {
    if (typeof prevEnter === 'function') await prevEnter()
    setTimeout(inject, 300)
  }
  document.addEventListener('DOMContentLoaded', () => setTimeout(inject, 1000))
  if (document.readyState !== 'loading') setTimeout(inject, 1000)
  setInterval(retry, 1400)
})()
