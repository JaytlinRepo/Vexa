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
      return cardShell('Growth', null, emptyBody('First snapshot lands in 24h — Maya runs her sync at 9am UTC and builds your history from there.'))
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
      return cardShell('Consistency', null, emptyBody(`${(snapshots || []).length} of 3 snapshots. Come back in ${Math.max(1, 3 - (snapshots || []).length)} day${(snapshots || []).length === 2 ? '' : 's'} — consistency needs three data points to mean anything.`))
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
      return cardShell('Trend', null, emptyBody(`${(snapshots || []).length} of 3 snapshots. Trend projection unlocks once Maya has three daily syncs to regress against.`))
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
      return `<button data-range="${days}" style="background:${active ? 'var(--t1)' : 'transparent'};color:${active ? 'var(--bg)' : 'var(--t2)'};border:1px solid var(--b2);padding:4px 12px;border-radius:8px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;font-family:inherit">${label}</button>`
    }
    return `<div style="display:flex;gap:6px">${btn('7d', 7)}${btn('30d', 30)}${btn('All', 0)}</div>`
  }

  async function inject() {
    if (Date.now() - lastRender < 300) return
    lastRender = Date.now()

    const main = document.querySelector('#view-db-dashboard main')
    if (!main) return
    // Dashboard v2 handles trajectory in per-platform sections — skip standalone injection
    if (document.querySelector('[data-v2-soft-refresh]')) return
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
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px">
          <div data-expand="growth" style="cursor:zoom-in;transition:transform .15s ease,border-color .15s ease">${growthCard(filtered)}</div>
          <div data-expand="consistency" style="cursor:zoom-in;transition:transform .15s ease,border-color .15s ease">${consistencyCard(filtered)}</div>
          <div data-expand="trend" style="cursor:zoom-in;transition:transform .15s ease,border-color .15s ease">${trendCard(filtered)}</div>
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

    // Wire click-to-expand on each trajectory card
    if (data.account) {
      const filteredForExpand = filterByRange(data.snapshots, currentRange)
      section.querySelectorAll('[data-expand]').forEach((wrap) => {
        wrap.addEventListener('mouseenter', () => { wrap.style.transform = 'translateY(-2px)' })
        wrap.addEventListener('mouseleave', () => { wrap.style.transform = '' })
        wrap.addEventListener('click', () => {
          openExpandedModal(wrap.dataset.expand, filteredForExpand, data.account.handle)
        })
      })
    }
  }

  // ── EXPANDED MODAL ──────────────────────────────────────────────────────
  // Click any card to see a bigger, interactive version with hoverable
  // data points and a full data table. The CEO should be able to read the
  // exact number for any day without squinting at a thumb-sized chart.

  function expandedGrowthSvg(snapshots, hoverIdx) {
    if (snapshots.length < 2) return '<div style="color:var(--t3);font-size:12px">Not enough snapshots.</div>'
    const ys = snapshots.map((s) => s.followerCount)
    const min = Math.min(...ys), max = Math.max(...ys)
    const range = Math.max(1, max - min)
    const W = 820, H = 320, padL = 60, padR = 18, padT = 20, padB = 44
    const innerW = W - padL - padR
    const innerH = H - padT - padB
    const step = innerW / (snapshots.length - 1)
    const xFor = (i) => padL + i * step
    const yFor = (v) => padT + innerH - ((v - min) / range) * innerH
    const pts = snapshots.map((s, i) => `${xFor(i).toFixed(1)},${yFor(s.followerCount).toFixed(1)}`).join(' ')
    const ticks = 4
    const gridLines = Array.from({ length: ticks + 1 }).map((_, i) => {
      const v = min + (range * i) / ticks
      const y = yFor(v)
      return `
        <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--b1)" stroke-width="1" stroke-dasharray="2 3" />
        <text x="${padL - 8}" y="${y + 3}" text-anchor="end" fill="var(--t3)" font-size="10">${Math.round(v).toLocaleString()}</text>
      `
    }).join('')
    const dots = snapshots.map((s, i) => {
      const isHover = i === hoverIdx
      return `<circle data-idx="${i}" cx="${xFor(i)}" cy="${yFor(s.followerCount)}" r="${isHover ? 6 : 3}" fill="${isHover ? 'var(--t1)' : 'var(--s1)'}" stroke="var(--t1)" stroke-width="${isHover ? 2 : 1.5}" style="cursor:crosshair" />`
    }).join('')
    const labelEvery = Math.max(1, Math.round(snapshots.length / 7))
    const xLabels = snapshots.map((s, i) => {
      if (i % labelEvery !== 0 && i !== snapshots.length - 1) return ''
      return `<text x="${xFor(i)}" y="${H - 18}" text-anchor="middle" fill="var(--t3)" font-size="10">${escapeHtml(fmtDate(s.capturedAt))}</text>`
    }).join('')
    const hoverCallout = hoverIdx != null && snapshots[hoverIdx] ? (() => {
      const s = snapshots[hoverIdx]
      const cx = xFor(hoverIdx)
      const cy = yFor(s.followerCount)
      const boxW = 150, boxH = 42
      const bx = Math.min(W - padR - boxW, Math.max(padL, cx - boxW / 2))
      const by = Math.max(padT, cy - boxH - 12)
      return `
        <rect x="${bx}" y="${by}" width="${boxW}" height="${boxH}" rx="6" fill="var(--s3)" stroke="var(--t2)" />
        <text x="${bx + boxW / 2}" y="${by + 17}" text-anchor="middle" fill="var(--t1)" font-size="12" font-weight="600">${fmtInt(s.followerCount)} followers</text>
        <text x="${bx + boxW / 2}" y="${by + 33}" text-anchor="middle" fill="var(--t3)" font-size="10">${escapeHtml(fmtDate(s.capturedAt))}</text>
      `
    })() : ''
    return `
      <svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;height:auto">
        ${gridLines}
        <polygon points="${padL},${padT + innerH} ${pts} ${W - padR},${padT + innerH}" fill="var(--t1)" fill-opacity="0.08" />
        <polyline points="${pts}" fill="none" stroke="var(--t1)" stroke-width="2.5" stroke-linejoin="round" />
        ${dots}
        ${xLabels}
        ${hoverCallout}
      </svg>
    `
  }

  function expandedConsistencySvg(snapshots, hoverIdx) {
    if (snapshots.length < 3) return '<div style="color:var(--t3);font-size:12px">Need at least 3 snapshots.</div>'
    const deltas = []
    for (let i = 1; i < snapshots.length; i++) {
      const prev = snapshots[i - 1], curr = snapshots[i]
      const days = Math.max(0.1, (new Date(curr.capturedAt).getTime() - new Date(prev.capturedAt).getTime()) / 86400000)
      deltas.push({ at: curr.capturedAt, value: (curr.followerCount - prev.followerCount) / days })
    }
    const peakAbs = Math.max(...deltas.map((d) => Math.abs(d.value)), 0.001)
    const W = 820, H = 320, padL = 60, padR = 18, padT = 20, padB = 44
    const innerW = W - padL - padR
    const innerH = H - padT - padB
    const mid = padT + innerH / 2
    const barW = Math.max(6, Math.min(28, innerW / deltas.length - 3))
    const step = innerW / deltas.length
    const bars = deltas.map((d, i) => {
      const h = (Math.abs(d.value) / peakAbs) * (innerH / 2 - 6)
      const x = padL + i * step + (step - barW) / 2
      const up = d.value >= 0
      const y = up ? mid - h : mid
      const isHover = i === hoverIdx
      return `<rect data-bar-idx="${i}" x="${x}" y="${y}" width="${barW}" height="${h}" rx="2" fill="${up ? 'var(--t1)' : '#ff6b6b'}" opacity="${isHover ? 1 : 0.65}" style="cursor:crosshair" />`
    }).join('')
    const hoverCallout = hoverIdx != null && deltas[hoverIdx] ? (() => {
      const d = deltas[hoverIdx]
      const cx = padL + hoverIdx * step + step / 2
      const v = d.value
      const sign = v >= 0 ? '+' : ''
      return `
        <rect x="${Math.min(W - padR - 160, Math.max(padL, cx - 80))}" y="${padT + 4}" width="160" height="42" rx="6" fill="var(--s3)" stroke="var(--t2)" />
        <text x="${Math.min(W - padR - 80, Math.max(padL + 80, cx))}" y="${padT + 21}" text-anchor="middle" fill="var(--t1)" font-size="12" font-weight="600">${sign}${v.toFixed(1)} followers/day</text>
        <text x="${Math.min(W - padR - 80, Math.max(padL + 80, cx))}" y="${padT + 37}" text-anchor="middle" fill="var(--t3)" font-size="10">${escapeHtml(fmtDate(d.at))}</text>
      `
    })() : ''
    const labelEvery = Math.max(1, Math.round(deltas.length / 7))
    const xLabels = deltas.map((d, i) => {
      if (i % labelEvery !== 0 && i !== deltas.length - 1) return ''
      const cx = padL + i * step + step / 2
      return `<text x="${cx}" y="${H - 18}" text-anchor="middle" fill="var(--t3)" font-size="10">${escapeHtml(fmtDate(d.at))}</text>`
    }).join('')
    return `
      <svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;height:auto">
        <line x1="${padL}" y1="${mid}" x2="${W - padR}" y2="${mid}" stroke="var(--b1)" />
        ${bars}
        ${xLabels}
        ${hoverCallout}
      </svg>
    `
  }

  function expandedTrendSvg(snapshots, hoverIdx) {
    if (snapshots.length < 3) return '<div style="color:var(--t3);font-size:12px">Need at least 3 snapshots.</div>'
    const ys = snapshots.map((s) => s.followerCount)
    const xs = snapshots.map((s) => new Date(s.capturedAt).getTime() / 86400000)
    const n = xs.length
    const meanX = xs.reduce((a, b) => a + b, 0) / n
    const meanY = ys.reduce((a, b) => a + b, 0) / n
    let num = 0, den = 0
    for (let i = 0; i < n; i++) { num += (xs[i] - meanX) * (ys[i] - meanY); den += (xs[i] - meanX) * (xs[i] - meanX) }
    const m = den === 0 ? 0 : num / den
    const minY = Math.min(...ys), maxY = Math.max(...ys)
    const rangeY = Math.max(1, maxY - minY)
    const W = 820, H = 320, padL = 60, padR = 18, padT = 20, padB = 44
    const innerW = W - padL - padR
    const innerH = H - padT - padB
    const step = innerW / (n - 1)
    const xFor = (i) => padL + i * step
    const yFor = (v) => padT + innerH - ((v - minY) / rangeY) * innerH
    const pts = ys.map((y, i) => `${xFor(i).toFixed(1)},${yFor(y).toFixed(1)}`).join(' ')
    const yStart = meanY + m * (xs[0] - meanX)
    const yEnd = meanY + m * (xs[n - 1] - meanX)
    const dots = snapshots.map((s, i) => {
      const isHover = i === hoverIdx
      return `<circle data-idx="${i}" cx="${xFor(i)}" cy="${yFor(s.followerCount)}" r="${isHover ? 6 : 3}" fill="${isHover ? 'var(--t1)' : 'var(--s1)'}" stroke="var(--t1)" stroke-width="${isHover ? 2 : 1.5}" style="cursor:crosshair" />`
    }).join('')
    const ticks = 4
    const gridLines = Array.from({ length: ticks + 1 }).map((_, i) => {
      const v = minY + (rangeY * i) / ticks
      const y = yFor(v)
      return `
        <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--b1)" stroke-width="1" stroke-dasharray="2 3" />
        <text x="${padL - 8}" y="${y + 3}" text-anchor="end" fill="var(--t3)" font-size="10">${Math.round(v).toLocaleString()}</text>
      `
    }).join('')
    const labelEvery = Math.max(1, Math.round(n / 7))
    const xLabels = snapshots.map((s, i) => {
      if (i % labelEvery !== 0 && i !== n - 1) return ''
      return `<text x="${xFor(i)}" y="${H - 18}" text-anchor="middle" fill="var(--t3)" font-size="10">${escapeHtml(fmtDate(s.capturedAt))}</text>`
    }).join('')
    const hoverCallout = hoverIdx != null && snapshots[hoverIdx] ? (() => {
      const s = snapshots[hoverIdx]
      const cx = xFor(hoverIdx)
      const cy = yFor(s.followerCount)
      const boxW = 150, boxH = 42
      const bx = Math.min(W - padR - boxW, Math.max(padL, cx - boxW / 2))
      const by = Math.max(padT, cy - boxH - 12)
      return `
        <rect x="${bx}" y="${by}" width="${boxW}" height="${boxH}" rx="6" fill="var(--s3)" stroke="var(--t2)" />
        <text x="${bx + boxW / 2}" y="${by + 17}" text-anchor="middle" fill="var(--t1)" font-size="12" font-weight="600">${fmtInt(s.followerCount)} followers</text>
        <text x="${bx + boxW / 2}" y="${by + 33}" text-anchor="middle" fill="var(--t3)" font-size="10">${escapeHtml(fmtDate(s.capturedAt))}</text>
      `
    })() : ''
    return `
      <svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;height:auto">
        ${gridLines}
        <polyline points="${pts}" fill="none" stroke="var(--t2)" stroke-width="1.5" stroke-linejoin="round" />
        <line x1="${xFor(0)}" y1="${yFor(yStart)}" x2="${xFor(n - 1)}" y2="${yFor(yEnd)}" stroke="var(--t1)" stroke-width="2.5" stroke-dasharray="5 4" />
        ${dots}
        ${xLabels}
        ${hoverCallout}
      </svg>
    `
  }

  function dataTable(kind, snapshots) {
    if (!snapshots.length) return ''
    const rows = []
    if (kind === 'consistency') {
      for (let i = 1; i < snapshots.length; i++) {
        const prev = snapshots[i - 1], curr = snapshots[i]
        const days = Math.max(0.1, (new Date(curr.capturedAt).getTime() - new Date(prev.capturedAt).getTime()) / 86400000)
        const delta = (curr.followerCount - prev.followerCount) / days
        const sign = delta >= 0 ? '+' : ''
        rows.push(`<tr><td style="padding:6px 10px;color:var(--t2)">${escapeHtml(fmtDate(curr.capturedAt))}</td><td style="padding:6px 10px;text-align:right;color:var(--t1)">${fmtInt(curr.followerCount)}</td><td style="padding:6px 10px;text-align:right;color:${delta >= 0 ? 'var(--t1)' : '#ff6b6b'}">${sign}${delta.toFixed(1)}/day</td></tr>`)
      }
    } else {
      for (let i = 0; i < snapshots.length; i++) {
        const s = snapshots[i]
        const prev = i > 0 ? snapshots[i - 1] : null
        const diff = prev ? s.followerCount - prev.followerCount : 0
        const sign = diff >= 0 ? '+' : ''
        rows.push(`<tr><td style="padding:6px 10px;color:var(--t2)">${escapeHtml(fmtDate(s.capturedAt))}</td><td style="padding:6px 10px;text-align:right;color:var(--t1)">${fmtInt(s.followerCount)}</td><td style="padding:6px 10px;text-align:right;color:${diff >= 0 ? 'var(--t1)' : '#ff6b6b'}">${prev ? sign + diff.toLocaleString() : '—'}</td></tr>`)
      }
    }
    const thirdHeader = kind === 'consistency' ? 'Per day' : 'Δ from prev'
    return `
      <div style="max-height:240px;overflow:auto;margin-top:18px;border:1px solid var(--b1);border-radius:8px">
        <table style="width:100%;border-collapse:collapse;font-size:12px;font-family:'DM Sans',sans-serif">
          <thead style="position:sticky;top:0;background:var(--s2)">
            <tr>
              <th style="text-align:left;padding:8px 10px;color:var(--t3);font-weight:600;font-size:10px;letter-spacing:.08em;text-transform:uppercase">Date</th>
              <th style="text-align:right;padding:8px 10px;color:var(--t3);font-weight:600;font-size:10px;letter-spacing:.08em;text-transform:uppercase">Followers</th>
              <th style="text-align:right;padding:8px 10px;color:var(--t3);font-weight:600;font-size:10px;letter-spacing:.08em;text-transform:uppercase">${thirdHeader}</th>
            </tr>
          </thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>
    `
  }

  function openExpandedModal(kind, snapshots, handle) {
    document.getElementById('vx-traj-modal')?.remove()
    const titleMap = { growth: 'Growth', consistency: 'Consistency', trend: 'Trend' }
    const title = titleMap[kind] || 'Detail'
    const el = document.createElement('div')
    el.id = 'vx-traj-modal'
    el.style.cssText =
      'position:fixed;inset:0;z-index:9300;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);padding:20px'
    el.innerHTML = `
      <div style="width:100%;max-width:960px;max-height:92vh;overflow:auto;background:var(--s1);border:1px solid var(--b1);border-radius:14px;padding:24px 28px;color:var(--t1);font-family:'DM Sans',sans-serif">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
          <div>
            <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--t3);margin-bottom:2px">Trajectory</div>
            <h3 style="font-family:'Syne',sans-serif;font-size:22px;margin:0">${escapeHtml(title)} — @${escapeHtml(handle)}</h3>
          </div>
          <button id="vx-traj-close" style="background:transparent;border:1px solid var(--b2);color:var(--t2);padding:7px 14px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:11px">Close</button>
        </div>
        <div style="color:var(--t3);font-size:12px;margin-bottom:18px">Hover any point for the exact value. ${snapshots.length} snapshot${snapshots.length === 1 ? '' : 's'} in view.</div>
        <div id="vx-traj-chart"></div>
        ${dataTable(kind, snapshots)}
      </div>
    `
    document.body.appendChild(el)
    el.addEventListener('click', (e) => { if (e.target === el) el.remove() })
    el.querySelector('#vx-traj-close').addEventListener('click', () => el.remove())
    document.addEventListener('keydown', function onEsc(ev) {
      if (ev.key === 'Escape') { el.remove(); document.removeEventListener('keydown', onEsc) }
    })

    const host = el.querySelector('#vx-traj-chart')
    let hoverIdx = null
    const rerender = () => {
      const svg = kind === 'consistency'
        ? expandedConsistencySvg(snapshots, hoverIdx)
        : kind === 'trend'
          ? expandedTrendSvg(snapshots, hoverIdx)
          : expandedGrowthSvg(snapshots, hoverIdx)
      host.innerHTML = svg
      host.querySelectorAll('[data-idx], [data-bar-idx]').forEach((node) => {
        const idx = Number(node.dataset.idx ?? node.dataset.barIdx)
        node.addEventListener('mouseenter', () => { hoverIdx = idx; rerender() })
        node.addEventListener('mouseleave', () => { hoverIdx = null; rerender() })
      })
    }
    rerender()
  }

  function retryInject() {
    // Dashboard-v2 handles trajectory in per-platform sections — don't re-inject
    if (document.querySelector('[data-v2-soft-refresh]')) return
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
