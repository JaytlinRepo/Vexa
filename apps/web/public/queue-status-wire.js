/* Queue Status — .app-card pattern */
window.renderQueueStatus = function (d) {
  var queue = d.queue || []
  var ready = queue.filter(function (p) { return p.status === 'delivered' })
  var pending = queue.filter(function (p) { return p.status !== 'delivered' })
  function esc(s) { return String(s || '').replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] }) }

  var readyHtml = ready.map(function (p) {
    return '<div style="padding:6px 0;border-bottom:1px dashed var(--b1);display:flex;justify-content:space-between;align-items:center">' +
      '<div><div style="font-size:12px;color:var(--t1)">' + esc(p.title || 'Untitled') + '</div>' +
        '<span style="font-family:\'JetBrains Mono\',monospace;font-size:9px;color:var(--t3)">' + esc(p.type || '') + '</span>' +
      '</div>' +
      '<div style="width:5px;height:5px;border-radius:50%;background:var(--ok);flex-shrink:0"></div>' +
    '</div>'
  }).join('')

  var pendingHtml = pending.map(function (p) {
    return '<div style="padding:6px 0;border-bottom:1px dashed var(--b1);display:flex;justify-content:space-between;align-items:center">' +
      '<div><div style="font-size:12px;color:var(--t2)">' + esc(p.title || 'Untitled') + '</div>' +
        '<span style="font-family:\'JetBrains Mono\',monospace;font-size:9px;color:var(--t3)">' + esc(p.type || '') + ' &middot; ' + esc(p.status || '') + '</span>' +
      '</div>' +
      '<div style="width:5px;height:5px;border-radius:50%;background:var(--accent);flex-shrink:0"></div>' +
    '</div>'
  }).join('')

  if (!queue.length) return ''

  return '<div class="app-card" data-brief="queue">' +
    '<div class="hdr"><div class="av">J</div><div class="emp">Jordan<div class="role">CONTENT STRATEGIST</div></div><div class="meta">' + queue.length + ' items</div></div>' +
    '<span class="tag">' + ready.length + ' READY</span>' +
    (pending.length ? ' <span class="tag">' + pending.length + ' IN PROGRESS</span>' : '') +
    '<div class="t">Content queue</div>' +
    (readyHtml ? '<div style="margin-top:10px">' + readyHtml + '</div>' : '') +
    (pendingHtml ? '<div style="margin-top:8px">' + pendingHtml + '</div>' : '') +
    '<div class="acts">' +
      '<button class="btn" onclick="window.refreshQueue()">REFRESH</button>' +
    '</div></div>'
}
