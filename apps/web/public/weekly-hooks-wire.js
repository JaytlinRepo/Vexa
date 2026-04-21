/* Weekly Hooks — .app-card pattern */
window.renderWeeklyHooks = function (d) {
  var o = d.output || {}
  var hooks = o.weeklyHooks || o.weekly_hooks || o.hooks || (Array.isArray(o) ? o : [])
  function esc(s) { return String(s || '').replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] }) }

  var hooksHtml = hooks.slice(0, 5).map(function (day) {
    var dayHooks = (day.hooks || []).slice(0, 3)
    return '<div style="padding:6px 0;border-bottom:1px dashed var(--b1)">' +
      '<div style="font-size:12px;font-weight:500;color:var(--t1);margin-bottom:4px">' + esc(day.day || '') + '</div>' +
      dayHooks.map(function (h, i) {
        return '<div style="font-size:11px;color:var(--t2);line-height:1.45;margin-bottom:3px;padding-left:10px;border-left:2px solid ' + (i === 0 ? 'var(--accent)' : 'var(--b1)') + '">' +
          esc(typeof h === 'string' ? h : h.hook || h.text || '') +
          (h.type ? ' <span style="font-family:\'JetBrains Mono\',monospace;font-size:9px;color:var(--t3)">' + esc(h.type) + '</span>' : '') +
        '</div>'
      }).join('') +
    '</div>'
  }).join('')

  return '<div class="app-card" data-brief="weekly-hooks">' +
    '<div class="hdr"><div class="av">A</div><div class="emp">Alex<div class="role">COPYWRITER &amp; SCRIPT WRITER</div></div><div class="meta">Sunday</div></div>' +
    '<span class="tag">WEEKLY HOOKS</span>' +
    '<div class="t">Ranked hooks per day, ready to use</div>' +
    '<div class="p">Each hook is ranked by predicted engagement for your audience</div>' +
    (hooksHtml ? '<div style="margin-top:10px">' + hooksHtml + '</div>' : '') +
    '<div class="acts">' +
      '<button class="btn" onclick="window.briefEvent(\'dismiss\',\'weekly-hooks\')">DONE</button>' +
      '<button class="btn primary" onclick="window.navigateTo(\'weekly-briefs\')">SEE RILEY\'S BRIEFS</button>' +
    '</div></div>'
}
