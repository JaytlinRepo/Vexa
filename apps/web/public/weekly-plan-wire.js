/* Weekly Plan — .app-card pattern */
window.renderWeeklyPlan = function (d) {
  var o = d.output || {}
  var plan = o.contentPlan || o.content_plan || o.plan || []
  var goal = o.weeklyGoal || o.weekly_goal || o.goal || ''
  // Handle plan as array of items or as an object with days
  if (!Array.isArray(plan) && typeof plan === 'object') {
    plan = Object.entries(plan).map(function (e) { return typeof e[1] === 'object' ? Object.assign({ day: e[0] }, e[1]) : { day: e[0], contentBrief: String(e[1]) } })
  }
  var status = d.status || 'pending'
  function esc(s) { return String(s || '').replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] }) }

  var statusTag = status === 'approved' ? '<span class="tag">APPROVED</span>'
    : status === 'rejected' ? '<span class="tag">REJECTED</span>'
    : '<span class="tag hot">NEEDS APPROVAL</span>'

  var planHtml = (Array.isArray(plan) ? plan : []).slice(0, 7).map(function (item) {
    return '<div style="padding:6px 0;border-bottom:1px dashed var(--b1)">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">' +
        '<span style="font-size:12px;font-weight:500;color:var(--t1)">' + esc(item.day || '') + '</span>' +
        '<span style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:var(--t3)">' + esc(item.time || item.slot || '') + '</span>' +
      '</div>' +
      '<div style="font-size:11px;color:var(--t2);line-height:1.45">' +
        (item.format ? '<span style="font-family:\'JetBrains Mono\',monospace;font-size:9px;letter-spacing:.06em;color:var(--t3);border:1px solid var(--b1);padding:1px 5px;border-radius:3px;margin-right:6px">' + esc(item.format) + '</span>' : '') +
        esc(item.contentBrief || item.content_brief || item.topic || item.title || '') +
      '</div>' +
      (item.rationale ? '<div style="font-size:10px;color:var(--t3);margin-top:2px">' + esc(item.rationale) + '</div>' : '') +
    '</div>'
  }).join('')

  var buttons = status === 'approved'
    ? '<button class="btn" onclick="window.briefEvent(\'dismiss\',\'weekly-plan\')">DONE</button>'
    : '<button class="btn" onclick="window.briefEvent(\'reject-plan\',\'weekly\')">REJECT</button>' +
      '<button class="btn primary" onclick="window.briefEvent(\'approve-plan\',\'weekly\')">APPROVE</button>'

  return '<div class="app-card" data-brief="weekly-plan">' +
    '<div class="hdr"><div class="av">J</div><div class="emp">Jordan<div class="role">CONTENT STRATEGIST</div></div><div class="meta">Sunday</div></div>' +
    statusTag + ' <span class="tag">WEEKLY PLAN</span>' +
    '<div class="t">Content strategy \u2014 next 7 days</div>' +
    '<div class="p">' + esc(goal || 'Next week\'s content informed by this week\'s data') + '</div>' +
    (planHtml ? '<div style="margin-top:10px">' + planHtml + '</div>' : '') +
    (status !== 'approved' ? '<div class="p" style="margin-top:10px;font-size:11px;color:var(--t3)">Once approved, Alex and Riley will get their tasks</div>' : '') +
    '<div class="acts">' + buttons + '</div></div>'
}
