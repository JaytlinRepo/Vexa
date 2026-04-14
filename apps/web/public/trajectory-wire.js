/* Vexa — Trajectory section on the dashboard.
 *
 * Reads from the new per-sync tables (platform_snapshots, platform_posts)
 * via /api/platform/timeseries. Injects a 3-card row after the Performance
 * section showing Growth, Consistency, and Trend for the connected platform.
 *
 * Each card has a graceful empty state for when data is still accumulating
 * (just connected) or unavailable (personal Instagram has no post metrics).
 */
;(function () {
  let lastRender = 0
  let currentRange = 30  // days; 7 | 30 | 0 (all)

  async function fetchTimeseries() {
    try {
      const res = await fetch('/api/platform/timeseries', { credentials: 'include' })
      if (!res.ok) return null
      return res.json()
    } catch {
      return null
    }
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  function fmtInt(n) {
    return Number(n || 0).toLocaleString()
  }

  function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) } catch { return '' }
  }

  // Linear regression slope — returns change per step. Used for trend direction.
  function slope(values) {
    if (values.length < 2) return 0
    const n = values.length
    const meanX = (n - 1) / 2
    const meanY = values.reduce((a, b) => a + b, 0) / n
    let num = 0, den = 0
    for (let i = 0; i < n; i++) {
      num += (i - meanX) * (values[i] - meanY)
      den += (i - meanX) * (i - meanX)
    }
    return den === 0 ? 0 : num / den
  }

  function sectionLabel(text) {
    return `<h2 style="color:var(--t2);font-size:10px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;margin:0 0 10px;font-family:'Syne',sans-serif">${escapeHtml(text)}</h2>`
  }

  function cardShell(title, right, body) {
    return `
      <div style="background:var(--s1);border:1px solid var(--b1);border-radius:10px;padding:16px 18px;min-height:210px;display:flex;flex-direction:column">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px">
          <div style="color:var(--t3);font-size:10px;letter-spacing:.12em;text-transform:uppercase;font-weight:600">${escapeHtml(title)}</div>
          ${right ? `<div style="color:var(--t1);font-size:13px;font-weight:600">${right}</div>` : ''}
        </div>
        ${body}
      </div>
    `
  }

  function emptyBody(message) {
    return `
      <div style="flex:1;display:grid;place-items:center;color:var(--t3);font-size:12px;text-align:center;line-height:1.6;padding:16px">
        ${escapeHtml(message)}
      </div>
    `
  }

  // ── GROWTH CARD ─────────────────────────────────────────────────────────
  function growthCard(snapshots) {
    if (!snapshots || snapshots.length === 0) {
      return cardShell('Growth', null, emptyBody('No snapshots yet. Next sync will start the history.'))
    }
    if (snapshots.length === 1) {
      const s = snapshots[0]
      return cardShell('Growth', fmtInt(s.followerCount), emptyBody(`${fmtInt(s.followerCount)} followers captured on ${fmtDate(s.capturedAt)}. Growth tracking starts on the next sync.`))
    }

    const ys = snapshots.map((s) => s.followerCount)
    const start = ys[0]
    const end = ys[ys.length - 1]
    const delta = end - start
    const pct = start > 0 ? ((delta / start) * 100).toFixed(1) : '0.0'
    const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
    const arrow = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→'
    const tint = direction === 'up' ? '#34d27a' : direction === 'down' ? '#ff6b6b' : 'var(--t2)'

    const min = Math.min(...ys), max = Math.max(...ys)
    const range = Math.max(1, max - min)
    const W = 340, H = 110, top = 12, bottom = H - 22
    const step = W / (snapshots.length - 1)
    const pts = snapshots.map((s, i) => `${(i * step).toFixed(1)},${(bottom - ((s.followerCount - min) / range) * (bottom - top)).toFixed(1)}`).join(' ')

    const body = `
      <div style="display:flex;gap:10px;align-items:baseline;margin-bottom:8px">
        <span style="color:${tint};font-size:14px;font-weight:600">${arrow} ${Math.abs(delta).toLocaleString()} (${Math.abs(pct)}%)</span>
        <span style="color:var(--t3);font-size:11px">${fmtDate(snapshots[0].capturedAt)} → today</span>
      </div>
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" style="display:block">
        <polygon points="0,${H} ${pts} ${W},${H}" fill="var(--t1)" fill-opacity="0.08" />
        <polyline points="${pts}" fill="none" stroke="var(--t1)" stroke-width="2" stroke-linejoin="round" />
        <text x="0" y="${H - 4}" fill="var(--t3)" font-size="9">${escapeHtml(fmtDate(snapshots[0].capturedAt))}</text>
        <text x="${W}" y="${H - 4}" fill="var(--t3)" font-size="9" text-anchor="end">${escapeHtml(fmtDate(snapshots[snapshots.length - 1].capturedAt))}</text>
      </svg>
    `
    return cardShell('Growth', fmtInt(end), body)
  }

  // ── CONSISTENCY CARD ────────────────────────────────────────────────────
  // Measures how steady follower growth is. Low variance in day-over-day
  // deltas → high score; large swings → low score. Works for every account
  // type (personal IG included) because it only needs the snapshots we
  // already persist on every sync.
  function consistencyCard(snapshots) {
    if (!snapshots || snapshots.length < 3) {
      return cardShell('Consistency', null, emptyBody(`${(snapshots || []).length} snapshots. Three or more needed to measure consistency.`))
    }
    // Compute normalized day-over-day deltas
    const deltas = []
    for (let i = 1; i < snapshots.length; i++) {
      const prev = snapshots[i - 1]
      const curr = snapshots[i]
      const days = Math.max(0.1, (new Date(curr.capturedAt).getTime() - new Date(prev.capturedAt).getTime()) / 86400000)
      const perDay = (curr.followerCount - prev.followerCount) / days
      deltas.push(perDay)
    }
    const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length
    const variance = deltas.reduce((a, d) => a + Math.pow(d - avg, 2), 0) / deltas.length
    const stddev = Math.sqrt(variance)
    const cv = Math.abs(avg) > 0.001 ? stddev / Math.abs(avg) : stddev
    const score = Math.max(0, Math.min(100, Math.round((1 / (1 + cv)) * 100)))
    const label = score >= 75 ? 'Steady' : score >= 50 ? 'Mostly steady' : score >= 25 ? 'Uneven' : 'Volatile'

    // Daily-delta bar chart (each bar = one interval)
    const peakAbs = Math.max(...deltas.map((d) => Math.abs(d)), 0.001)
    const H = 78, MID = H / 2
    const bars = deltas.map((d) => {
      const h = Math.max(2, Math.round((Math.abs(d) / peakAbs) * (H - 8) / 2))
      const up = d >= 0
      return `<div style="flex:1;display:flex;flex-direction:column;justify-content:${up ? 'flex-end' : 'flex-start'};align-items:stretch;height:${H}px;position:relative">
        <div style="height:${h}px;background:${up ? 'var(--t1)' : '#ff6b6b'};opacity:${Math.abs(d) / peakAbs > 0.7 ? 1 : 0.5};border-radius:2px;${up ? 'margin-top:auto' : 'margin-bottom:auto'}"></div>
      </div>`
    }).join('')

    const body = `
      <div style="display:flex;gap:10px;align-items:baseline;margin-bottom:10px">
        <span style="color:var(--t1);font-size:14px;font-weight:600">${label}</span>
        <span style="color:var(--t3);font-size:11px">avg ${avg >= 0 ? '+' : ''}${avg.toFixed(1)}/day · σ ${stddev.toFixed(1)}</span>
      </div>
      <div style="position:relative">
        <div style="display:flex;gap:2px;align-items:center;height:${H}px">${bars}</div>
        <div style="position:absolute;top:${MID}px;left:0;right:0;height:1px;background:var(--b1)"></div>
      </div>
      <div style="display:flex;justify-content:space-between;color:var(--t3);font-size:9px;margin-top:6px">
        <span>${escapeHtml(fmtDate(snapshots[0].capturedAt))}</span><span>today</span>
      </div>
    `
    return cardShell('Consistency', score + '/100', body)
  }

  // ── TREND CARD ──────────────────────────────────────────────────────────
  // Linear regression on follower count over time → direction + projection.
  function trendCard(snapshots) {
    if (!snapshots || snapshots.length < 3) {
      return cardShell('Trend', null, emptyBody(`${(snapshots || []).length} snapshots. Three or more needed to show a trend.`))
    }
    const ys = snapshots.map((s) => s.followerCount)
    const xs = snapshots.map((s) => new Date(s.capturedAt).getTime() / 86400000)  // in days
    const n = xs.length
    const meanX = xs.reduce((a, b) => a + b, 0) / n
    const meanY = ys.reduce((a, b) => a + b, 0) / n
    let num = 0, den = 0
    for (let i = 0; i < n; i++) {
      num += (xs[i] - meanX) * (ys[i] - meanY)
      den += (xs[i] - meanX) * (xs[i] - meanX)
    }
    const m = den === 0 ? 0 : num / den  // followers per day
    const projected30 = Math.round(ys[ys.length - 1] + m * 30)
    const threshold = Math.max(0.5, meanY * 0.0002)  // ~0.02% of baseline per day
    const direction = m > threshold ? 'rising' : m < -threshold ? 'falling' : 'flat'
    const arrow = direction === 'rising' ? '↑' : direction === 'falling' ? '↓' : '→'
    const tint = direction === 'rising' ? '#34d27a' : direction === 'falling' ? '#ff6b6b' : 'var(--t2)'

    // Plot: actual points (faint line) + regression line (bold dashed)
    const minY = Math.min(...ys), maxY = Math.max(...ys)
    const rangeY = Math.max(1, maxY - minY)
    const W = 340, H = 110, top = 12, bottom = H - 22
    const step = W / (n - 1)
    const pts = ys.map((y, i) => `${(i * step).toFixed(1)},${(bottom - ((y - minY) / rangeY) * (bottom - top)).toFixed(1)}`).join(' ')
    const yStart = meanY + m * (xs[0] - meanX)
    const yEnd = meanY + m * (xs[xs.length - 1] - meanX)
    const ryStart = (bottom - ((yStart - minY) / rangeY) * (bottom - top)).toFixed(1)
    const ryEnd = (bottom - ((yEnd - minY) / rangeY) * (bottom - top)).toFixed(1)

    const body = `
      <div style="display:flex;gap:10px;align-items:baseline;margin-bottom:8px">
        <span style="color:${tint};font-size:14px;font-weight:600">${arrow} ${direction}</span>
        <span style="color:var(--t3);font-size:11px">${m >= 0 ? '+' : ''}${m.toFixed(1)}/day · ~${Number(projected30).toLocaleString()} in 30d</span>
      </div>
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" style="display:block">
        <polyline points="${pts}" fill="none" stroke="var(--t2)" stroke-width="1" stroke-linejoin="round" />
        <line x1="0" y1="${ryStart}" x2="${W}" y2="${ryEnd}" stroke="${tint}" stroke-width="2" stroke-dasharray="4 3" />
      </svg>
    `
    const headline = m >= 0 ? '+' + Math.round(m * 7) + '/wk' : Math.round(m * 7) + '/wk'
    return cardShell('Trend', headline, body)
  }

  function filterByRange(rows, days) {
    if (!rows || !rows.length || !days) return rows || []
    const cutoff = Date.now() - days * 86400000
    return rows.filter((r) => new Date(r.capturedAt).getTime() >= cutoff)
  }

  function rangeSelector() {
    const btn = (label, days) => {
      const active = currentRange === days
      return `<button data-range="${days}" style="background:${active ? 'var(--t1)' : 'transparent'};color:${active ? 'var(--bg)' : 'var(--t2)'};border:1px solid var(--b2);padding:4px 12px;border-radius:999px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;font-family:inherit">${label}</button>`
    }
    return `<div style="display:flex;gap:6px">${btn('7d', 7)}${btn('30d', 30)}${btn('All', 0)}</div>`
  }

  async function inject() {
    if (Date.now() - lastRender < 300) return
    lastRender = Date.now()

    const main = document.querySelector('#view-db-dashboard main')
    if (!main) return
    // Place after the Performance section (second-to-last section before Activity)
    const sections = main.querySelectorAll('section')
    if (sections.length < 3) return
    if (document.getElementById('vx-trajectory')) return

    const data = await fetchTimeseries()
    if (!data) return

    const section = document.createElement('section')
    section.id = 'vx-trajectory'
    section.style.marginBottom = '26px'

    if (!data.account) {
      section.innerHTML = `
        ${sectionLabel('Trajectory')}
        <div style="padding:22px;text-align:center;color:var(--t3);font-size:12px;border:1px dashed var(--b1);border-radius:10px">
          Connect a platform to see growth, consistency, and trend over time.
        </div>
      `
    } else {
      const filtered = filterByRange(data.snapshots, currentRange)
      section.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin:0 0 10px">
          <h2 style="color:var(--t2);font-size:10px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;margin:0;font-family:'Syne',sans-serif">Trajectory — @${escapeHtml(data.account.handle)}</h2>
          ${rangeSelector()}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
          ${growthCard(filtered)}
          ${consistencyCard(filtered)}
          ${trendCard(filtered)}
        </div>
      `
    }

    // Insert before the Activity section (last section)
    const lastSection = sections[sections.length - 1]
    main.insertBefore(section, lastSection)

    // Wire range selector
    section.querySelectorAll('[data-range]').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentRange = Number(btn.dataset.range)
        section.remove()
        lastRender = 0
        inject()
      })
    })
  }

  function retryInject() {
    // Dashboard-v2 rewrites the view on nav; our injection is ephemeral.
    const has = document.getElementById('vx-trajectory')
    if (!has) inject()
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
    setTimeout(inject, 250)
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(inject, 900)
  })
  if (document.readyState !== 'loading') setTimeout(inject, 900)

  // Light polling to re-inject when dashboard-v2 rerenders
  setInterval(retryInject, 1200)
})()
