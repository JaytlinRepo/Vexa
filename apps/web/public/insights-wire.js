/* Sovexa — insights charts driven by real Instagram data.
 * Re-renders every chart card in the Performance Insights section off the
 * stub that /api/instagram/insights returns (same shape as the Graph API).
 */
;(function () {
  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  async function fetchInsights() {
    try {
      const me = await fetch('/api/auth/me', { credentials: 'include' }).then((r) => r.ok ? r.json() : null).catch(() => null)
      const companyId = me?.companies?.[0]?.id
      if (!companyId) return null
      const res = await fetch('/api/instagram/insights?companyId=' + companyId, { credentials: 'include' })
      if (!res.ok) return null
      const json = await res.json()
      return json.connection
    } catch {
      return null
    }
  }

  function findCardByTitle(title) {
    const titles = document.querySelectorAll('.chart-card .chart-card-title')
    for (const t of titles) {
      if (t.textContent.trim().toLowerCase() === title.toLowerCase()) return t.closest('.chart-card')
    }
    return null
  }

  function renderFollowerGrowth(conn) {
    const card = findCardByTitle('Follower growth')
    if (!card) return
    const svg = card.querySelector('svg.chart-svg')
    if (!svg) return
    const series = conn.followerSeries || []
    if (series.length < 2) return

    const ys = series.map((p) => p.followers)
    const min = Math.min(...ys), max = Math.max(...ys)
    const range = Math.max(1, max - min)
    const W = 340, H = 90, bottom = 75, top = 12
    const step = W / (series.length - 1)
    const pts = series.map((p, i) => {
      const x = i * step
      const y = bottom - ((p.followers - min) / range) * (bottom - top)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    const poly = svg.querySelector('polyline')
    const area = svg.querySelector('polygon')
    if (poly) {
      poly.setAttribute('points', pts.join(' '))
      poly.setAttribute('stroke', 'var(--t1)')
      poly.setAttribute('stroke-width', '2')
    }
    if (area) area.setAttribute('points', `0,${H - 15} ${pts.join(' ')} ${W},${H - 15}`.replace(/\s+/g, ' '))

    const delta = series[series.length - 1].followers - series[0].followers
    const deltaStr = (delta >= 0 ? '+' : '') + delta.toLocaleString()
    const val = card.querySelector('.chart-card-val')
    if (val) val.textContent = deltaStr

    const firstDate = new Date(series[0].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    const midDate = new Date(series[Math.floor(series.length / 2)].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    const lastDate = new Date(series[series.length - 1].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    const labels = svg.querySelectorAll('.chart-axis-label')
    if (labels[0]) labels[0].textContent = firstDate
    if (labels[1]) labels[1].textContent = midDate
    if (labels[2]) labels[2].textContent = lastDate
  }

  function renderFormatDonut(conn) {
    const card = findCardByTitle('Format breakdown')
    if (!card) return
    const media = conn.recentMedia || []
    if (media.length === 0) return
    const counts = {}
    for (const m of media) {
      const k = prettyType(m.media_type)
      counts[k] = (counts[k] || 0) + 1
    }
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
    const total = entries.reduce((a, [, c]) => a + c, 0)
    const palette = ['var(--t1)', 'var(--t2)', 'var(--b2)', 'var(--s3)']
    const svg = card.querySelector('svg.donut-svg')
    const legend = card.querySelector('.donut-legend')
    if (!svg || !legend) return
    const CIRC = 201.06
    const segments = []
    let offset = 0
    entries.forEach(([, c], i) => {
      const share = c / total
      const len = share * CIRC
      segments.push(`<circle cx="45" cy="45" r="32" fill="none" stroke="${palette[i] || 'var(--b2)'}" stroke-width="14" stroke-dasharray="${len.toFixed(2)} ${CIRC}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 45 45)"/>`)
      offset += len
    })
    svg.innerHTML = `<circle cx="45" cy="45" r="32" fill="none" stroke="var(--b1)" stroke-width="14"/>` + segments.join('')
    legend.innerHTML = entries.map(([label, c], i) => {
      const pct = Math.round((c / total) * 100)
      return `<div class="donut-legend-item"><div class="donut-swatch" style="background:${palette[i] || 'var(--b2)'}"></div>${escapeHtml(label)} — ${pct}%</div>`
    }).join('')
  }

  function prettyType(t) {
    switch (t) {
      case 'REEL': return 'Reels'
      case 'CAROUSEL_ALBUM': return 'Carousel'
      case 'IMAGE': return 'Static'
      case 'VIDEO': return 'Video'
      default: return String(t || 'Other')
    }
  }

  function renderEngagementByDay(conn) {
    const card = findCardByTitle('Engagement by day')
    if (!card) return
    const host = card.querySelector('#bar-engagement')
    if (!host) return
    const media = conn.recentMedia || []
    const sums = Array(7).fill(0)
    const counts = Array(7).fill(0)
    for (const m of media) {
      const dow = (new Date(m.timestamp).getUTCDay() + 6) % 7 // 0=Mon
      const reach = m.insights?.reach || 1
      const rate = ((m.insights?.engagement || 0) / reach) * 100
      sums[dow] += rate
      counts[dow] += 1
    }
    const avg = sums.map((s, i) => counts[i] ? +(s / counts[i]).toFixed(2) : 0)
    renderBarChart(host, avg, DAY_LABELS)

    const bestIdx = avg.indexOf(Math.max(...avg))
    const val = card.querySelector('.chart-card-val')
    if (val) val.textContent = DAY_LABELS[bestIdx] || '—'
  }

  function renderSavesByType(conn) {
    const card = findCardByTitle('Saves by content type')
    if (!card) return
    const host = card.querySelector('#bar-saves')
    if (!host) return
    const media = conn.recentMedia || []
    const byType = {}
    for (const m of media) {
      const k = prettyType(m.media_type)
      byType[k] = (byType[k] || 0) + (m.insights?.saved || 0)
    }
    const labels = ['Reels', 'Carousel', 'Static', 'Video']
    const values = labels.map((l) => byType[l] || 0)
    renderBarChart(host, values, labels)

    const total = values.reduce((a, b) => a + b, 0)
    const val = card.querySelector('.chart-card-val')
    if (val) val.textContent = total.toLocaleString()
  }

  function renderBarChart(host, values, labels) {
    host.innerHTML = ''
    const peak = Math.max(...values, 0.001)
    values.forEach((val, i) => {
      const pct = peak > 0 ? val / peak : 0
      const heightPx = Math.max(4, Math.round(pct * 72))
      const isTop = val === peak && val > 0
      const wrap = document.createElement('div')
      wrap.className = 'bar-wrap'
      const bar = document.createElement('div')
      bar.className = 'bar' + (isTop ? ' top' : pct > 0.7 ? ' highlight' : '')
      bar.style.cssText = `height:${heightPx}px;opacity:0;transform:scaleY(0);transform-origin:bottom;transition:opacity .4s ${i * 60}ms ease,transform .5s ${i * 60}ms cubic-bezier(.16,1,.3,1)`
      setTimeout(() => { bar.style.opacity = '1'; bar.style.transform = 'scaleY(1)' }, 80)
      const lbl = document.createElement('div')
      lbl.className = 'bar-lbl'
      lbl.textContent = labels[i]
      wrap.appendChild(bar)
      wrap.appendChild(lbl)
      host.appendChild(wrap)
    })
  }

  function renderTopPosts(conn) {
    const card = findCardByTitle('Top posts this period')
    if (!card) return
    const top = (conn.topPosts || []).slice(0, 4)
    if (top.length === 0) return
    const host = card.querySelector('div[style*="flex-direction:column"]')
    if (!host) return
    host.innerHTML = top.map((p, i) => {
      const reach = p.insights?.reach || 1
      const rate = ((p.insights?.engagement || 0) / reach) * 100
      const type = prettyType(p.media_type)
      const when = new Date(p.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      return `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--s2);border-radius:8px;border:1px solid var(--b1)">
          <span style="font-family:'Cormorant Garamond',serif;font-size:18px;color:var(--t3);flex-shrink:0">${String(i + 1).padStart(2, '0')}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;color:var(--t1);margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(p.caption || '—')}</div>
            <div style="font-size:10px;color:var(--t3);letter-spacing:.04em">${escapeHtml(type)} · ${escapeHtml(when)} · ${p.like_count?.toLocaleString?.() ?? 0} likes</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:13px;font-weight:500;color:var(--t1)">${rate.toFixed(1)}%</div>
            <div style="font-size:10px;color:var(--t3)">eng rate</div>
          </div>
        </div>`
    }).join('')
  }

  function renderWeeklyReach(conn) {
    const card = findCardByTitle('Weekly reach')
    if (!card) return
    const svg = card.querySelector('svg.chart-svg')
    if (!svg) return
    const series = conn.followerSeries || []
    if (series.length < 7) return

    // Aggregate into 4 weeks (last 28 days)
    const last28 = series.slice(-28)
    const weekly = []
    for (let w = 0; w < 4; w++) {
      const slice = last28.slice(w * 7, (w + 1) * 7)
      const avgReach = slice.reduce((a, p) => a + (p.reach || 0), 0) / Math.max(1, slice.length)
      weekly.push(avgReach)
    }
    const min = Math.min(...weekly), max = Math.max(...weekly)
    const range = Math.max(1, max - min)
    const W = 160, bottom = 80, top = 15
    const step = W / (weekly.length - 1)
    const pts = weekly.map((v, i) => `${(i * step).toFixed(1)},${(bottom - ((v - min) / range) * (bottom - top)).toFixed(1)}`)
    const poly = svg.querySelector('polyline')
    const area = svg.querySelector('polygon')
    if (poly) {
      poly.setAttribute('points', pts.join(' '))
      poly.setAttribute('stroke', 'var(--t1)')
      poly.setAttribute('stroke-width', '2')
    }
    if (area) area.setAttribute('points', `0,95 ${pts.join(' ')} ${W},95`.replace(/\s+/g, ' '))

    const val = card.querySelector('.chart-card-val')
    if (val) {
      const delta = weekly[0] > 0 ? Math.round(((weekly[3] - weekly[0]) / weekly[0]) * 100) : 0
      val.textContent = (delta >= 0 ? '+' : '') + delta + '%'
    }
  }

  function renderKPIs(conn) {
    const media = conn.recentMedia || []
    const totalReach = media.reduce((a, m) => a + (m.insights?.reach || 0), 0)
    const avgReach = media.length ? Math.round(totalReach / media.length) : (conn.avgReach || 0)
    const totalSaves = media.reduce((a, m) => a + (m.insights?.saved || 0), 0)
    const engRateAvg = media.length
      ? +(media.reduce((a, m) => {
          const r = m.insights?.reach || 1
          return a + ((m.insights?.engagement || 0) / r) * 100
        }, 0) / media.length).toFixed(1)
      : conn.engagementRate || 0

    const series = conn.followerSeries || []
    const delta = series.length >= 2 ? series[series.length - 1].followers - series[0].followers : 0

    setText('kpi-followers', formatShort(conn.followerCount))
    setText('kpi-followers-d', (delta >= 0 ? '+' : '') + delta.toLocaleString() + ' this period')
    setText('kpi-reach', avgReach.toLocaleString())
    setText('kpi-reach-d', 'avg per post')
    setText('kpi-eng', engRateAvg + '%')
    setText('kpi-eng-d', 'avg engagement rate')
    setText('kpi-saves', totalSaves.toLocaleString())
    setText('kpi-saves-d', 'across ' + media.length + ' posts')
  }

  function setText(id, val) {
    const el = document.getElementById(id)
    if (el) el.textContent = val
  }

  function formatShort(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
    if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
    return String(n)
  }

  async function render() {
    const conn = await fetchInsights()
    if (!conn) return
    renderKPIs(conn)
    renderFollowerGrowth(conn)
    renderFormatDonut(conn)
    renderEngagementByDay(conn)
    renderSavesByType(conn)
    renderTopPosts(conn)
    renderWeeklyReach(conn)
  }

  const prevEnter = window.enterDashboard
  window.enterDashboard = async function () {
    if (typeof prevEnter === 'function') await prevEnter()
    // initInsights runs at ~420ms from the original enterDashboard; wait past it.
    setTimeout(render, 700)
  }

  const origNavigate = window.navigate
  window.navigate = function (id) {
    const r = typeof origNavigate === 'function' ? origNavigate(id) : undefined
    if (id === 'db-dashboard') setTimeout(render, 550)
    return r
  }

})()
