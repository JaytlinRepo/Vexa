/* Evening Recap — .app-card pattern */
window.renderEveningRecap = function (d) {
  var posts = d.todaysPosts || []
  var top = d.topPost || posts[0]
  var insights = d.insights || []
  var trend = d.trendOpportunity
  function esc(s) { return String(s || '').replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] }) }
  function fmt(n) { return (n || 0).toLocaleString() }

  var topHtml = top && top.caption ? '<div style="margin-top:10px;padding-top:8px;border-top:1px dashed var(--b1)">' +
    '<div style="font-family:Inter,sans-serif;font-weight:500;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--t3);margin-bottom:6px">BEST POST TODAY</div>' +
    '<div style="font-size:12px;color:var(--t2);line-height:1.5">' + esc((top.caption || '').slice(0, 80)) + '</div>' +
    '<div style="display:flex;gap:14px;margin-top:4px;font-family:\'JetBrains Mono\',monospace;font-size:10px;color:var(--t3)">' +
      '<span>' + fmt(top.metrics?.reach) + ' reach</span>' +
      '<span>' + fmt(top.metrics?.likes) + ' likes</span>' +
      '<span>' + fmt(top.metrics?.comments) + ' comments</span>' +
    '</div></div>' : ''

  var insightHtml = insights.length ? '<div style="margin-top:10px;padding-top:8px;border-top:1px dashed var(--b1)">' +
    '<div style="font-family:Inter,sans-serif;font-weight:500;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--t3);margin-bottom:6px">LEARNINGS</div>' +
    insights.map(function (i) { return '<div style="font-size:12px;color:var(--t2);line-height:1.5;margin-bottom:4px;padding-left:10px;border-left:2px solid var(--accent)">' + esc(i) + '</div>' }).join('') +
    '</div>' : ''

  var trendHtml = trend && trend.trend ? '<div style="margin-top:10px;padding-top:8px;border-top:1px dashed var(--b1)">' +
    '<div style="font-family:Inter,sans-serif;font-weight:500;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--t3);margin-bottom:6px">EMERGING TREND</div>' +
    '<div style="font-size:12px;color:var(--t1)">' + esc(trend.trend) + '</div>' +
    '</div>' : ''

  return '<div class="app-card" data-brief="evening">' +
    '<div class="hdr"><div class="av">M</div><div class="emp">Maya<div class="role">TREND &amp; INSIGHTS ANALYST</div></div><div class="meta">20:00</div></div>' +
    '<span class="tag">EVENING RECAP</span>' +
    '<div class="t">Day summary + tomorrow forecast</div>' +
    '<div class="p">' + posts.length + ' post' + (posts.length !== 1 ? 's' : '') + ' tracked today</div>' +
    topHtml + insightHtml + trendHtml +
    '<div class="acts">' +
      '<button class="btn" onclick="window.briefEvent(\'dismiss\',\'evening\')">DISMISS</button>' +
      '<button class="btn primary" onclick="window.navigateTo(\'evening-recap\')">FULL RECAP</button>' +
    '</div></div>'
}
