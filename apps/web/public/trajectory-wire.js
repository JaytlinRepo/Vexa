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
  // Posts per week for the last 12 weeks, plus a consistency score (= 1 /
  // (1 + coefficient of variation of gaps between posts)).
  function consistencyCard(posts) {
    if (!posts || posts.length === 0) {
      return cardShell('Consistency', null, emptyBody('Post analytics require a Creator or Business Instagram account. Switch account type in the IG app, then resync.'))
    }
    const withTs = posts.filter((p) => p.publishedAt).sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime())
    if (withTs.length < 2) {
      return cardShell('Consistency', null, emptyBody(`${withTs.length} post tracked. Two or more posts needed to measure cadence.`))
    }

    // Bucket into 12 weeks ending today
    const now = Date.now()
    const WEEKS = 12
    const buckets = Array(WEEKS).fill(0)
    for (const p of withTs) {
      const age = (now - new Date(p.publishedAt).getTime()) / (1000 * 60 * 60 * 24 * 7)
      const idx = WEEKS - 1 - Math.floor(age)
      if (idx >= 0 && idx < WEEKS) buckets[idx]++
    }
    const peak = Math.max(...buckets, 1)

    // Gap variance → consistency score
    const gaps = []
    for (let i = 1; i < withTs.length; i++) {
      gaps.push((new Date(withTs[i].publishedAt).getTime() - new Date(withTs[i - 1].publishedAt).getTime()) / (1000 * 60 * 60 * 24))
    }
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length
    const variance = gaps.reduce((a, g) => a + Math.pow(g - avgGap, 2), 0) / gaps.length
    const stddev = Math.sqrt(variance)
    const cv = avgGap > 0 ? stddev / avgGap : 0
    const score = Math.max(0, Math.min(100, Math.round((1 / (1 + cv)) * 100)))
    const label = score >= 75 ? 'Steady' : score >= 50 ? 'OK' : score >= 25 ? 'Uneven' : 'Erratic'

    const bars = buckets.map((n) => {
      const h = Math.max(4, Math.round((n / peak) * 70))
      return `<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;min-width:0">
        <div style="height:${h}px;background:var(--t1);opacity:${n === 0 ? 0.15 : n === peak ? 1 : 0.6};border-radius:2px"></div>
      </div>`
    }).join('')

    const body = `
      <div style="display:flex;gap:10px;align-items:baseline;margin-bottom:10px">
        <span style="color:var(--t1);font-size:14px;font-weight:600">${label}</span>
        <span style="color:var(--t3);font-size:11px">${withTs.length} posts · avg every ${avgGap.toFixed(1)}d</span>
      </div>
      <div style="display:flex;gap:4px;align-items:flex-end;height:78px;margin-bottom:8px">${bars}</div>
      <div style="display:flex;justify-content:space-between;color:var(--t3);font-size:9px">
        <span>${WEEKS} wks ago</span><span>now</span>
      </div>
    `
    return cardShell('Consistency', score + '/100', body)
  }

  // ── TREND CARD ──────────────────────────────────────────────────────────
  // Engagement rate per post over time; plus a slope showing direction.
  function trendCard(posts) {
    if (!posts || posts.length === 0) {
      return cardShell('Trend', null, emptyBody('Per-post engagement is unavailable for personal Instagram accounts. Switch to Creator to unlock.'))
    }
    const withStats = posts
      .filter((p) => p.publishedAt)
      .sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime())
      .map((p) => {
        const eng = (p.likeCount || 0) + (p.commentCount || 0) + (p.saveCount || 0) + (p.shareCount || 0)
        const reach = (p.reachCount || 0) || (p.viewCount || 0) || 1
        return { rate: (eng / reach) * 100, publishedAt: p.publishedAt }
      })
      .filter((p) => isFinite(p.rate))

    if (withStats.length < 3) {
      return cardShell('Trend', null, emptyBody(`${withStats.length} posts tracked. Three or more needed to show a trend line.`))
    }

    const rates = withStats.map((p) => p.rate)
    const m = slope(rates)
    const avg = rates.reduce((a, b) => a + b, 0) / rates.length
    const direction = m > 0.05 ? 'rising' : m < -0.05 ? 'falling' : 'flat'
    const arrow = direction === 'rising' ? '↑' : direction === 'falling' ? '↓' : '→'
    const tint = direction === 'rising' ? '#34d27a' : direction === 'falling' ? '#ff6b6b' : 'var(--t2)'

    const min = Math.min(...rates), max = Math.max(...rates)
    const range = Math.max(0.01, max - min)
    const W = 340, H = 110, top = 12, bottom = H - 22
    const step = W / (rates.length - 1)
    const pts = rates.map((r, i) => `${(i * step).toFixed(1)},${(bottom - ((r - min) / range) * (bottom - top)).toFixed(1)}`).join(' ')

    // Regression line
    const yStart = avg - m * ((rates.length - 1) / 2)
    const yEnd = avg + m * ((rates.length - 1) / 2)
    const rxStart = (bottom - ((yStart - min) / range) * (bottom - top)).toFixed(1)
    const rxEnd = (bottom - ((yEnd - min) / range) * (bottom - top)).toFixed(1)

    const body = `
      <div style="display:flex;gap:10px;align-items:baseline;margin-bottom:8px">
        <span style="color:${tint};font-size:14px;font-weight:600">${arrow} ${direction}</span>
        <span style="color:var(--t3);font-size:11px">avg ${avg.toFixed(1)}% · ${rates.length} posts</span>
      </div>
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" style="display:block">
        <polyline points="${pts}" fill="none" stroke="var(--t1)" stroke-width="1.5" stroke-linejoin="round" />
        <line x1="0" y1="${rxStart}" x2="${W}" y2="${rxEnd}" stroke="${tint}" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.85" />
      </svg>
    `
    return cardShell('Trend', (avg).toFixed(1) + '%', body)
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
      section.innerHTML = `
        ${sectionLabel(`Trajectory — @${escapeHtml(data.account.handle)}`)}
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
          ${growthCard(data.snapshots)}
          ${consistencyCard(data.posts)}
          ${trendCard(data.posts)}
        </div>
      `
    }

    // Insert before the Activity section (last section)
    const lastSection = sections[sections.length - 1]
    main.insertBefore(section, lastSection)
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
