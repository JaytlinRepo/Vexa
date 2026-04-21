/* Weekly Production Briefs — .app-card pattern */
window.renderWeeklyBriefs = function (d) {
  var o = d.output || {}
  var production = o.weeklyProduction || o.weekly_production || o.production || (Array.isArray(o) ? o : [])
  function esc(s) { return String(s || '').replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] }) }

  var prodHtml = production.slice(0, 5).map(function (day) {
    return '<div style="padding:6px 0;border-bottom:1px dashed var(--b1)">' +
      '<div style="font-size:12px;font-weight:500;color:var(--t1);margin-bottom:3px">' + esc(day.day || '') + '</div>' +
      (day.opening ? '<div style="font-size:11px;color:var(--t2);line-height:1.45;margin-bottom:2px">' + esc(day.opening) + '</div>' : '') +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:3px">' +
        (day.mood ? '<span style="font-family:\'JetBrains Mono\',monospace;font-size:9px;color:var(--t3);border:1px solid var(--b1);padding:1px 5px;border-radius:3px">' + esc(day.mood) + '</span>' : '') +
        (day.pacing ? '<span style="font-family:\'JetBrains Mono\',monospace;font-size:9px;color:var(--t3);border:1px solid var(--b1);padding:1px 5px;border-radius:3px">' + esc(day.pacing) + '</span>' : '') +
      '</div>' +
    '</div>'
  }).join('')

  return '<div class="app-card" data-brief="weekly-briefs">' +
    '<div class="hdr"><div class="av">R</div><div class="emp">Riley<div class="role">CREATIVE DIRECTOR</div></div><div class="meta">Sunday</div></div>' +
    '<span class="tag">PRODUCTION</span>' +
    '<div class="t">Weekly production briefs</div>' +
    '<div class="p">Direction optimized for what worked this week</div>' +
    (prodHtml ? '<div style="margin-top:10px">' + prodHtml + '</div>' : '') +
    '<div class="acts">' +
      '<button class="btn" onclick="window.briefEvent(\'dismiss\',\'weekly-briefs\')">DONE</button>' +
    '</div></div>'
}
