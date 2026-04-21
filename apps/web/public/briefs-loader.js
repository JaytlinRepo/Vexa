/**
 * Briefs Loader — injects brief content into pipeline nodes.
 *
 * Maya gets: morning brief + weekly pulse
 * Jordan gets: weekly plan
 * Alex gets: weekly hooks
 * Riley gets: weekly production briefs
 *
 * Each brief renders as a clickable summary below the node-task.
 * Clicking opens the full brief in a modal (via window.navigateTo).
 */
;(function () {
  function esc(s) { return String(s || '').replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] }) }

  async function waitForCompany() {
    for (var i = 0; i < 20; i++) {
      if (window.__vxCompany?.id) return window.__vxCompany.id
      await new Promise(function (r) { setTimeout(r, 500) })
    }
    return null
  }

  async function loadBriefs() {
    try {
      var companyId = await waitForCompany()
      if (!companyId) return

      var q = 'companyId=' + encodeURIComponent(companyId)
      var get = function (url) { return fetch(url + '?' + q, { credentials: 'include' }).then(function (r) { return r.ok ? r.json() : null }).catch(function () { return null }) }

      var results = await Promise.all([
        get('/api/briefs/morning'),
        get('/api/briefs/evening'),
        get('/api/weekly/maya-pulse'),
        get('/api/weekly/jordan-plan'),
        get('/api/weekly/alex-hooks'),
        get('/api/weekly/riley-briefs'),
      ])

      var morning = results[0]
      var evening = results[1]
      var pulse   = results[2]
      var plan    = results[3]
      var hooks   = results[4]
      var briefs  = results[5]

      // Maya node — morning brief + pulse
      var mayaNode = document.querySelector('[data-node="maya"]')
      if (mayaNode) {
        var mayaHtml = ''
        var mayaCtx = pulse?.informedBy
        if (pulse && pulse.output) {
          var po = pulse.output
          var summary = po.oneThingToDo || po.summary || po.trajectory?.summary || ''
          mayaHtml += briefChip('weekly-pulse', 'WEEKLY PULSE', summary, null, [
            btn('View', "window.navigateTo('weekly-pulse')"),
          ], mayaCtx)
        }
        var trends = morning?.trendingTopics || []
        if (trends.length > 0) {
          mayaHtml += briefChip('trends', 'TRENDS', trends.slice(0, 2).map(function (t) { return t.topic }).join(', '), null, [
            btn('View', "window.navigateTo('trends')"),
          ])
        }
        if (evening && evening.todaysPosts && evening.todaysPosts.length > 0) {
          mayaHtml += briefChip('evening-recap', 'EVENING RECAP', evening.todaysPosts.length + ' posts tracked today', null, [
            btn('View', "window.navigateTo('evening-recap')"),
          ])
        }
        if (mayaHtml) injectBriefs(mayaNode, mayaHtml)
      }

      // Jordan node — weekly plan
      var jordanNode = document.querySelector('[data-node="jordan"]')
      if (jordanNode && plan && plan.output) {
        var po = plan.output
        var goal = po.weeklyGoal || po.weekly_goal || po.goal || ''
        var planStatus = plan.status || ''
        var label = planStatus === 'approved' ? 'PLAN APPROVED' : planStatus === 'rejected' ? 'PLAN REJECTED' : 'WEEKLY PLAN'
        var tone = planStatus === 'rejected' ? 'warn' : planStatus === 'approved' ? 'ok' : 'hot'
        var actions = [btn('View', "window.navigateTo('weekly-plan')")]
        if (planStatus !== 'approved' && planStatus !== 'rejected') {
          actions.push(btn('Approve', "window.briefEvent('approve-plan','weekly')", true))
          actions.push(btn('Reject', "window.briefEvent('reject-plan','weekly')"))
        }
        injectBriefs(jordanNode, briefChip('weekly-plan', label, goal, tone, actions, plan.informedBy))
      }

      // Alex node — weekly hooks
      var alexNode = document.querySelector('[data-node="alex"]')
      if (alexNode && hooks && hooks.output) {
        var ho = hooks.output
        var hookList = ho.weeklyHooks || ho.weekly_hooks || ho.hooks || []
        var count = Array.isArray(hookList) ? hookList.length : 0
        injectBriefs(alexNode, briefChip('weekly-hooks', 'WEEKLY HOOKS', count + ' days of hooks ready', null, [
          btn('View', "window.navigateTo('weekly-hooks')"),
        ], hooks.informedBy))
      }

      // Riley node — production briefs
      var rileyNode = document.querySelector('[data-node="riley"]')
      if (rileyNode && briefs && briefs.output) {
        injectBriefs(rileyNode, briefChip('weekly-briefs', 'PRODUCTION', 'Weekly direction ready', null, [
          btn('View', "window.navigateTo('weekly-briefs')"),
        ], briefs.informedBy))
      }

      console.log('[briefs-loader] briefs injected into pipeline')
    } catch (err) {
      console.error('[briefs-loader] load error:', err)
    }
  }

  function btn(text, onclick, primary) {
    var base = 'padding:4px 10px;border-radius:5px;font-family:Inter,sans-serif;font-size:9px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;transition:all .15s;'
    if (primary) {
      return '<button style="' + base + 'background:var(--accent);color:var(--accent-text,#fff);border:1px solid var(--accent)" onclick="event.stopPropagation();' + onclick + '">' + text + '</button>'
    }
    return '<button style="' + base + 'background:transparent;color:var(--t2);border:1px solid var(--b2)" onclick="event.stopPropagation();' + onclick + '">' + text + '</button>'
  }

  function briefChip(type, label, detail, tone, actions, informedBy) {
    var dotColor = tone === 'warn' ? '#c76a6a' : tone === 'ok' ? 'var(--ok, #34d27a)' : 'var(--accent)'
    var actionsHtml = actions && actions.length ? '<div style="display:flex;gap:5px;margin-top:6px">' + actions.join('') + '</div>' : ''

    // Build "informed by" line
    var ctxHtml = ''
    if (informedBy) {
      var parts = []
      if (informedBy.previousAgent) parts.push(informedBy.previousAgent)
      var m = informedBy.metrics || {}
      if (m.followers) parts.push(m.followers + ' followers')
      if (m.engagement) parts.push(m.engagement + ' eng')
      if (m['posts this week']) parts.push(m['posts this week'] + ' posts/wk')
      if (m['preferences learned']) parts.push(m['preferences learned'] + ' preferences')
      if (parts.length) {
        ctxHtml = '<div style="font-family:\'JetBrains Mono\',monospace;font-size:9px;color:var(--t3);margin-top:4px;letter-spacing:.02em">Informed by: ' + esc(parts.join(' · ')) + '</div>'
      }
    }

    return '<div class="node-brief" data-brief-type="' + type + '" style="margin-top:8px;padding:8px 0;border-top:1px dashed var(--b1)">' +
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">' +
        '<span style="width:5px;height:5px;border-radius:50%;background:' + dotColor + ';flex-shrink:0"></span>' +
        '<span style="font-family:Inter,sans-serif;font-weight:500;font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:var(--t3)">' + esc(label) + '</span>' +
      '</div>' +
      (detail ? '<div style="font-size:11px;color:var(--t2);line-height:1.4">' + esc(String(detail).slice(0, 80)) + '</div>' : '') +
      ctxHtml +
      actionsHtml +
    '</div>'
  }

  function injectBriefs(node, html) {
    // Remove any previous briefs
    node.querySelectorAll('.node-brief').forEach(function (el) { el.remove() })
    // Insert after node-task
    var task = node.querySelector('.node-task')
    if (task) {
      task.insertAdjacentHTML('afterend', html)
    } else {
      node.insertAdjacentHTML('beforeend', html)
    }
  }

  // Load after dashboard data is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(loadBriefs, 2500) })
  } else {
    setTimeout(loadBriefs, 2500)
  }

  window.refreshBriefs = loadBriefs
})()
