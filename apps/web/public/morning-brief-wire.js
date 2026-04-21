/* Morning Brief — .app-card pattern */
window.renderMorningBrief = function (d) {
  var trends = d.trendingTopics || []
  var yest = d.yesterdayPosts || []
  var queue = d.queuedPosts || []
  var best = yest[0]
  function esc(s) { return String(s || '').replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] }) }
  function fmt(n) { return (n || 0).toLocaleString() }

  var trendHtml = trends.slice(0, 3).map(function (t) {
    return '<div style="border-left:2px solid var(--accent);padding:2px 0 2px 10px;margin-bottom:6px">' +
      '<div style="font-size:13px;color:var(--t1);font-weight:500">' + esc(t.topic || '') + '</div>' +
      (t.angle ? '<div style="font-size:11px;color:var(--t2);margin-top:2px">' + esc(t.angle) + '</div>' : '') +
      '</div>'
  }).join('')

  var bestHtml = best ? '<div style="margin-top:10px;padding-top:8px;border-top:1px dashed var(--b1)">' +
    '<div style="font-family:Inter,sans-serif;font-weight:500;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--t3);margin-bottom:6px">YESTERDAY\'S BEST</div>' +
    '<div style="font-size:12px;color:var(--t2);line-height:1.5">' + esc((best.caption || '').slice(0, 80)) + '</div>' +
    '<div style="display:flex;gap:14px;margin-top:4px;font-family:\'JetBrains Mono\',monospace;font-size:10px;color:var(--t3)">' +
      '<span>' + fmt(best.metrics?.reach) + ' reach</span>' +
      '<span>' + (best.metrics?.engagementRate ? (best.metrics.engagementRate * 100).toFixed(1) + '%' : '') + ' eng</span>' +
    '</div></div>' : ''

  return '<div class="app-card" data-brief="morning">' +
    '<div class="hdr"><div class="av">M</div><div class="emp">Maya<div class="role">TREND &amp; INSIGHTS ANALYST</div></div><div class="meta">08:00</div></div>' +
    '<span class="tag hot">MORNING BRIEF</span>' +
    '<div class="t">Trends + today\'s queue</div>' +
    '<div class="p">' + (trends.length ? trends.length + ' trending topics overnight' : 'No new trends') + ' &middot; ' + queue.length + ' queued</div>' +
    (trendHtml ? '<div style="margin-top:10px">' + trendHtml + '</div>' : '') +
    bestHtml +
    '<div class="acts">' +
      '<button class="btn" onclick="window.briefEvent(\'dismiss\',\'morning\')">DISMISS</button>' +
      '<button class="btn primary" onclick="window.navigateTo(\'trends\')">FULL REPORT</button>' +
    '</div></div>'
}
