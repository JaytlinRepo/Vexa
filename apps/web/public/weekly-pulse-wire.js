/* Weekly Pulse — .app-card pattern */
window.renderWeeklyPulse = function (d) {
  var o = d.output || {}
  var learnings = o.keyLearnings || o.key_learnings || o.learnings || []
  var pattern = o.bestPerformingPattern || o.best_performing_pattern || o.winOfTheWeek || o.win_of_the_week || {}
  var recs = o.recommendations || o.oneThingToDo ? [o.oneThingToDo] : []
  var warns = o.warnings || []
  var trajectory = o.trajectory || {}
  function esc(s) { return String(s || '').replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] }) }

  var learnHtml = learnings.slice(0, 4).map(function (l) {
    return '<div style="font-size:12px;color:var(--t2);line-height:1.5;margin-bottom:4px;padding-left:10px;border-left:2px solid var(--accent)">' + esc(typeof l === 'string' ? l : l.insight || l.learning || '') + '</div>'
  }).join('')

  var patternHtml = pattern.format ? '<div style="margin-top:10px;padding-top:8px;border-top:1px dashed var(--b1)">' +
    '<div style="font-family:Inter,sans-serif;font-weight:500;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--t3);margin-bottom:6px">BEST PATTERN</div>' +
    '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:var(--t1)">' + esc(pattern.format) + (pattern.timing ? ' &middot; ' + esc(pattern.timing) : '') + '</div>' +
    '</div>' : ''

  var warnHtml = warns.length ? '<div style="margin-top:8px">' +
    warns.slice(0, 2).map(function (w) { return '<div style="font-size:11px;color:var(--t2);padding-left:10px;border-left:2px solid #c76a6a;margin-bottom:4px">' + esc(typeof w === 'string' ? w : w.message || '') + '</div>' }).join('') +
    '</div>' : ''

  return '<div class="app-card" data-brief="weekly-pulse">' +
    '<div class="hdr"><div class="av">M</div><div class="emp">Maya<div class="role">TREND &amp; INSIGHTS ANALYST</div></div><div class="meta">Sunday</div></div>' +
    '<span class="tag hot">REVIEW</span> <span class="tag">PULSE WK ' + getWeekNum() + '</span>' +
    '<div class="t">Weekly pulse \u2014 what this week taught us</div>' +
    '<div class="p">' + esc(o.summary || 'This week\'s insights and next week\'s focus') + '</div>' +
    (learnHtml ? '<div style="margin-top:10px">' + learnHtml + '</div>' : '') +
    patternHtml + warnHtml +
    '<div class="acts">' +
      '<button class="btn" onclick="window.briefEvent(\'dismiss\',\'weekly-pulse\')">ARCHIVE</button>' +
      '<button class="btn primary" onclick="window.navigateTo(\'weekly-plan\')">SEE JORDAN\'S PLAN</button>' +
    '</div></div>'

  function getWeekNum() { var d = new Date(); var s = new Date(d.getFullYear(), 0, 1); return Math.ceil(((d - s) / 86400000 + s.getDay() + 1) / 7) }
}
