/* Morning Brief — .app-card pattern */
window.renderMorningBrief = function (d) {
  var at = d.accountTrends || {}
  var yest = d.yesterdayPosts || []
  var queue = d.queuedPosts || []
  var best = yest[0]

  function esc(s) { return String(s || '').replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] }) }
  function fmtN(n) { if (!n) return '0'; if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'; if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K'; return String(n) }

  // ── Metric preview chips (top 3 most interesting metrics) ──────────────────
  var metrics = (at.metrics || []).slice(0, 4)
  var metricsHtml = ''
  if (at.hasData && metrics.length > 0) {
    metricsHtml = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">'
    metrics.forEach(function (m) {
      var up = m.direction === 'up', dn = m.direction === 'down'
      var color = up ? '#4caf50' : dn ? '#e06060' : 'var(--t3)'
      var arrow = up ? '↑' : dn ? '↓' : '→'
      var delta = m.deltaPct != null ? arrow + Math.abs(m.deltaPct) + '%' : arrow
      var val = m.format === 'percent' ? m.value + '%' : fmtN(m.value)
      metricsHtml += '<div style="background:rgba(20,16,10,.05);border:1px solid rgba(20,16,10,.08);border-radius:6px;padding:5px 8px;display:flex;flex-direction:column;gap:2px">'
        + '<div style="font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--t3)">' + esc(m.label) + '</div>'
        + '<div style="display:flex;align-items:baseline;gap:5px">'
          + '<span style="font-family:\'JetBrains Mono\',monospace;font-size:13px;font-weight:600;color:var(--t1)">' + esc(val) + '</span>'
          + '<span style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:' + color + '">' + delta + '</span>'
        + '</div>'
      + '</div>'
    })
    metricsHtml += '</div>'
  }

  // ── Yesterday's best post ──────────────────────────────────────────────────
  var bestHtml = best
    ? '<div style="margin-top:10px;padding-top:8px;border-top:1px dashed var(--b1)">'
        + '<div style="font-family:Inter,sans-serif;font-weight:500;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--t3);margin-bottom:4px">YESTERDAY\'S BEST</div>'
        + '<div style="font-size:12px;color:var(--t2);line-height:1.5">' + esc((best.caption || '').slice(0, 80)) + '</div>'
        + '<div style="display:flex;gap:14px;margin-top:4px;font-family:\'JetBrains Mono\',monospace;font-size:10px;color:var(--t3)">'
          + '<span>' + fmtN(best.metrics && best.metrics.reach) + ' reach</span>'
          + (best.metrics && best.metrics.engagementRate ? '<span>' + (best.metrics.engagementRate * 100).toFixed(1) + '% eng</span>' : '')
        + '</div>'
      + '</div>'
    : ''

  // ── Subtitle line ──────────────────────────────────────────────────────────
  var trendSummary = at.hasData
    ? (at.engagementTrend === 'improving' ? '↑ Engagement improving' : at.engagementTrend === 'declining' ? '↓ Engagement declining' : 'Stable week') + (queue.length ? ' · ' + queue.length + ' queued' : '')
    : (queue.length ? queue.length + ' in queue' : 'No new activity')

  return '<div class="app-card" data-brief="morning">'
    + '<div class="hdr"><div class="av">M</div><div class="emp">Maya<div class="role">TREND &amp; INSIGHTS ANALYST</div></div><div class="meta">08:00</div></div>'
    + '<span class="tag hot">MORNING BRIEF</span>'
    + '<div class="t">Your trends this week</div>'
    + '<div class="p">' + esc(trendSummary) + '</div>'
    + metricsHtml
    + bestHtml
    + '<div class="acts">'
      + '<button class="btn" onclick="window.briefEvent(\'dismiss\',\'morning\')">DISMISS</button>'
      + '<button class="btn primary" onclick="window.navigateTo(\'trends\')">FULL REPORT</button>'
    + '</div>'
  + '</div>'
}
