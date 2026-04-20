/* Sovexa — unified Work page: inbox-first with tabs.
 *
 * Tabs: Inbox | Calendar | Team
 * Inbox (default): deliverables needing decision at top, in-progress
 * below, completed history collapsed at bottom.
 * Calendar: existing calendar view.
 * Team: employee cards with status + assign/meeting actions.
 */
;(function () {
  let currentTab = 'inbox'
  let maxVisible = 5

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  function timeAgo(iso) {
    if (!iso) return ''
    var diff = Math.max(0, Date.now() - new Date(iso).getTime())
    var m = Math.floor(diff / 60000)
    if (m < 60) return m + 'm ago'
    var h = Math.floor(m / 60)
    if (h < 24) return h + 'h ago'
    return Math.floor(h / 24) + 'd ago'
  }

  function formatType(t) {
    var labels = {
      trend_report: 'Trend Report', content_plan: 'Posting Schedule', hooks: 'Captions',
      caption: 'Caption', script: 'Script', shot_list: 'Visual Brief', video: 'Video',
      performance_review: 'Performance Review', weekly_pulse: 'Weekly Pulse',
      upload_review: 'Upload Review', content_audit: 'Content Audit',
      growth_strategy: 'Growth Strategy', feed_audit: 'Feed Audit',
      format_analysis: 'Format Analysis', trend_hooks: 'Trend Captions',
      plan_adjustment: 'Schedule Adjustment', competitor_analysis: 'Competitor Analysis',
    }
    return labels[t] || String(t || 'task').replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase() })
  }

  var ROLE = {
    analyst: { name: 'Maya', init: 'M' },
    strategist: { name: 'Jordan', init: 'J' },
    copywriter: { name: 'Alex', init: 'A' },
    creative_director: { name: 'Riley', init: 'R' },
  }

  // ── Tab navigation ─────────────────────────────────────────────
  function tabBar() {
    return '<div id="vx-work-tabs" style="display:flex;gap:0;margin-bottom:28px;border-bottom:1px solid var(--b1)">'
      + tabBtn('inbox', 'Inbox')
      + tabBtn('calendar', 'Calendar')
      + tabBtn('team', 'Team')
      + '</div>'
  }

  function tabBtn(id, label) {
    var active = currentTab === id
    return '<button data-vx-tab="' + id + '" style="padding:10px 20px;border:none;background:none;color:' + (active ? 'var(--t1)' : 'var(--t2)') + ';font-size:13px;font-weight:' + (active ? '500' : '400') + ';font-family:inherit;cursor:pointer;position:relative;transition:color .2s">'
      + esc(label)
      + (active ? '<span style="position:absolute;bottom:-1px;left:20px;right:20px;height:1px;background:var(--t1)"></span>' : '')
      + '</button>'
  }

  // ── Inbox content ──────────────────────────────────────────────
  async function fetchTasks() {
    try {
      var res = await fetch('/api/tasks', { credentials: 'include' })
      if (!res.ok) return []
      var json = await res.json()
      return json.tasks || []
    } catch {
      return []
    }
  }

  function inboxCard(t) {
    var role = ROLE[t.employee?.role] || { name: 'Sovexa', init: 'V' }
    var output = t.outputs && t.outputs[0]
    var summary = buildCardSummary(t, output)

    return '<div class="vx-dcard" data-task-id="' + t.id + '" style="background:var(--s1);border:1px solid var(--b1);border-radius:12px;padding:18px 20px;margin-bottom:10px">'
      + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">'
      + '<div style="width:32px;height:32px;border-radius:8px;background:var(--s3);color:var(--t1);display:grid;place-items:center;font-weight:600;font-size:12px;font-family:Syne,sans-serif;flex-shrink:0">' + role.init + '</div>'
      + '<div style="flex:1;min-width:0">'
      + '<div style="color:var(--t1);font-size:13px;font-weight:500">' + esc(t.title) + '</div>'
      + '<div style="color:var(--t3);font-size:11px;margin-top:2px">' + esc(role.name) + ' · ' + esc(formatType(t.type)) + ' · ' + esc(timeAgo(t.createdAt)) + '</div>'
      + '</div>'
      + '</div>'
      + (summary ? '<div style="margin-bottom:12px;color:var(--t2);font-size:12px;line-height:1.6">' + summary + '</div>' : '')
      + '<div style="display:flex;gap:8px;align-items:center">'
      + (t.status === 'delivered'
        ? '<button data-vx-action="approve" data-task-id="' + t.id + '" style="background:var(--t1);color:var(--inv);border:none;padding:7px 16px;border-radius:8px;font-size:11px;font-weight:600;font-family:inherit;cursor:pointer">Approve</button>'
          + '<button data-vx-action="reject" data-task-id="' + t.id + '" style="background:transparent;border:1px solid var(--b2);color:var(--t2);padding:7px 16px;border-radius:8px;font-size:11px;font-family:inherit;cursor:pointer">Reject</button>'
        : '<span style="color:var(--t3);font-size:10px;letter-spacing:.1em;text-transform:uppercase">' + esc(statusLabel(t.status)) + '</span>')
      + '<button data-vx-open="' + t.id + '" style="background:transparent;border:1px solid var(--b2);color:var(--t2);padding:7px 16px;border-radius:8px;font-size:11px;font-family:inherit;cursor:pointer;margin-left:auto">Open</button>'
      + '</div>'
      + '</div>'
  }

  function buildCardSummary(t, output) {
    var c = output?.content || {}
    var type = t.type || ''

    // Trend report — show the top finding + why it matters
    if (type === 'trend_report' || type === 'performance_review' || type === 'weekly_pulse') {
      if (Array.isArray(c.trends) && c.trends.length) {
        var topOpp = c.topOpportunity ? '<div style="padding:8px 12px;background:var(--s2);border-radius:8px;margin-bottom:8px;font-style:italic;color:var(--t1)">' + esc(String(c.topOpportunity).slice(0, 120)) + '</div>' : ''
        return topOpp
          + c.trends.slice(0, 2).map(function (tr) {
            var pct = tr.growthPercent ? '+' + tr.growthPercent + '%' : (tr.growth || '')
            var urgencyColor = tr.urgency === 'high' ? '#34d27a' : tr.urgency === 'medium' ? '#e8c87a' : 'var(--t3)'
            return '<div style="padding:8px 0;border-bottom:1px solid var(--b1)">'
              + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">'
              + '<strong style="color:var(--t1)">' + esc(tr.topic || '') + '</strong>'
              + (pct ? '<span style="color:' + urgencyColor + ';font-size:10px;font-weight:600">' + esc(pct) + '</span>' : '')
              + (tr.urgency ? '<span style="color:' + urgencyColor + ';font-size:9px;letter-spacing:.08em;text-transform:uppercase">' + esc(tr.urgency) + '</span>' : '')
              + (tr.timeframe ? '<span style="color:var(--t3);font-size:10px">· ' + esc(tr.timeframe) + '</span>' : '')
              + '</div>'
              + (tr.whyItMatters ? '<div style="color:var(--t2);font-size:11px;line-height:1.5;margin-bottom:4px">' + esc(String(tr.whyItMatters).slice(0, 150)) + '</div>' : '')
              + (tr.suggestedHook ? '<div style="color:var(--t1);font-size:11px;font-style:italic;padding:6px 10px;background:var(--s2);border-radius:6px;margin-top:4px">"' + esc(String(tr.suggestedHook).slice(0, 100)) + '"</div>' : '')
              + (tr.category ? '<div style="color:var(--t3);font-size:9px;letter-spacing:.08em;text-transform:uppercase;margin-top:4px">Source: ' + esc(tr.category) + ' · ' + esc(tr.timeframe || 'recent') + '</div>' : '')
              + '</div>'
          }).join('')
      }
      if (c.summary) return '<div style="font-style:italic;color:var(--t1)">' + esc(String(c.summary).slice(0, 150)) + '</div>'
    }

    // Captions — show the top pick with context
    if (Array.isArray(c.hooks) && c.hooks.length) {
      var flagged = c.hooks.find(function (h) { return h.flagged })
      var best = flagged || c.hooks[0]
      return '<div style="margin-bottom:4px;color:var(--t1);font-weight:500">' + c.hooks.length + ' captions delivered</div>'
        + '<div style="padding:8px 12px;background:var(--s2);border-radius:8px;font-style:italic">"' + esc((best.text || '').slice(0, 100)) + '"</div>'
        + (flagged ? '<div style="color:var(--t3);font-size:10px;margin-top:4px">★ Agent\'s pick</div>' : '')
    }

    // Posting schedule — show the week overview
    if (Array.isArray(c.posts) && c.posts.length) {
      return '<div style="margin-bottom:4px;color:var(--t1);font-weight:500">' + c.posts.length + '-post schedule for the week</div>'
        + '<div style="display:flex;flex-wrap:wrap;gap:6px">'
        + c.posts.slice(0, 5).map(function (p) {
          return '<span style="background:var(--s2);padding:4px 8px;border-radius:6px;font-size:10px;color:var(--t2)">'
            + esc((p.day || '').slice(0, 3)) + ': ' + esc(p.format || '') + '</span>'
        }).join('')
        + '</div>'
    }

    // Visual brief
    if (Array.isArray(c.shots) && c.shots.length) {
      return '<div style="margin-bottom:4px;color:var(--t1);font-weight:500">' + c.shots.length + '-shot visual brief</div>'
        + '<div style="font-style:italic">Opens with: "' + esc((c.shots[0].description || c.shots[0].shot || '').slice(0, 80)) + '..."</div>'
    }

    // Script
    if (c.script) {
      return '<div style="margin-bottom:4px;color:var(--t1);font-weight:500">Script ready</div>'
        + '<div style="font-style:italic">"' + esc(String(c.script).slice(0, 100)) + '..."</div>'
    }

    // Caption
    if (c.caption) {
      return '<div style="margin-bottom:4px;color:var(--t1);font-weight:500">Caption ready</div>'
        + '<div style="font-style:italic">"' + esc(String(c.caption).slice(0, 100)) + '..."</div>'
    }

    // Content audit (Jordan)
    if (type === 'content_audit' && c.postsAnalyzed) {
      var auditHtml = '<div style="margin-bottom:6px;color:var(--t1);font-weight:500">' + c.postsAnalyzed + ' posts analyzed</div>'
      if (Array.isArray(c.formatBreakdown)) {
        auditHtml += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">'
        c.formatBreakdown.forEach(function (f) {
          var col = f.verdict === 'overused' ? '#e87a7a' : f.verdict === 'underused' ? '#e8c87a' : '#34d27a'
          auditHtml += '<span style="background:var(--s2);padding:4px 8px;border-radius:6px;font-size:10px;color:' + col + '">' + esc(f.format) + ': ' + f.count + ' (' + esc(f.verdict) + ')</span>'
        })
        auditHtml += '</div>'
      }
      if (Array.isArray(c.gaps) && c.gaps.length) {
        auditHtml += '<div style="font-size:11px;color:var(--t2);line-height:1.5">Gap: ' + esc(c.gaps[0]) + '</div>'
      }
      return auditHtml
    }

    // Growth strategy (Jordan)
    if (type === 'growth_strategy' && c.currentState) {
      var trajColor = c.currentState.trajectory === 'growing' ? '#34d27a' : c.currentState.trajectory === 'declining' ? '#e87a7a' : '#e8c87a'
      var stratHtml = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">'
        + '<span style="color:' + trajColor + ';font-weight:600;font-size:12px;text-transform:capitalize">' + esc(c.currentState.trajectory) + '</span>'
        + '<span style="color:var(--t3);font-size:11px">' + esc(c.currentState.summary?.slice(0, 80) || '') + '</span>'
        + '</div>'
      if (Array.isArray(c.strategy)) {
        stratHtml += c.strategy.slice(0, 2).map(function (s) {
          var impColor = s.expectedImpact === 'high' ? '#34d27a' : s.expectedImpact === 'medium' ? '#e8c87a' : 'var(--t3)'
          return '<div style="padding:6px 10px;background:var(--s2);border-radius:6px;margin-bottom:4px;font-size:11px">'
            + '<span style="color:' + impColor + ';font-weight:600">P' + s.priority + '</span> '
            + '<span style="color:var(--t1)">' + esc(s.action?.slice(0, 80) || '') + '</span>'
            + '</div>'
        }).join('')
      }
      return stratHtml
    }

    // Feed audit (Riley)
    if (type === 'feed_audit' && c.overallAesthetic) {
      var aesCol = c.overallAesthetic.consistency === 'cohesive' ? '#34d27a' : c.overallAesthetic.consistency === 'scattered' ? '#e87a7a' : '#e8c87a'
      var feedHtml = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">'
        + '<span style="font-size:20px;font-weight:700;color:' + aesCol + '">' + (c.overallAesthetic.score || '?') + '</span>'
        + '<span style="font-size:11px;color:var(--t3)">/10 aesthetic</span>'
        + '<span style="font-size:10px;padding:2px 8px;border-radius:4px;background:' + aesCol + '18;color:' + aesCol + '">' + esc(c.overallAesthetic.consistency) + '</span>'
        + '</div>'
        + '<div style="font-size:11px;color:var(--t2);line-height:1.5">' + esc(c.overallAesthetic.description?.slice(0, 120) || '') + '</div>'
      return feedHtml
    }

    // Format analysis (Riley)
    if (type === 'format_analysis' && c.bestFormat) {
      var fmtHtml = '<div style="margin-bottom:6px;color:var(--t1);font-weight:500">' + (c.postsAnalyzed || '?') + ' posts analyzed</div>'
      fmtHtml += '<div style="padding:8px 10px;background:var(--s2);border-radius:6px;margin-bottom:6px;font-size:11px">'
        + '<span style="color:#34d27a;font-weight:600">Best: </span>'
        + '<span style="color:var(--t1)">' + esc(c.bestFormat.format) + '</span>'
        + '<span style="color:var(--t3)"> — ' + esc(c.bestFormat.why?.slice(0, 80) || '') + '</span>'
        + '</div>'
      if (c.underusedFormat) {
        fmtHtml += '<div style="font-size:11px;color:#e8c87a">Underused: ' + esc(c.underusedFormat.format) + ' — ' + esc(c.underusedFormat.opportunity?.slice(0, 80) || '') + '</div>'
      }
      return fmtHtml
    }

    // Trend hooks (Alex)
    if (type === 'trend_hooks' && c.hooks?.length) {
      var best = c.hooks[c.recommendedHook || 0] || c.hooks[0]
      return '<div style="margin-bottom:6px;color:var(--t1);font-weight:500">' + c.hooks.length + ' hooks for: ' + esc((c.trendUsed || '').slice(0, 50)) + '</div>'
        + '<div style="padding:8px 12px;background:var(--s2);border-radius:8px;font-style:italic;font-size:12px;color:var(--t1)">"' + esc((best.text || '').slice(0, 100)) + '"</div>'
        + '<div style="font-size:10px;color:var(--t3);margin-top:4px">Alex\'s pick · ' + esc(best.style || '') + '</div>'
    }

    // Plan adjustment (Jordan)
    if (type === 'plan_adjustment' && c.adjustments) {
      var adjCount = Array.isArray(c.adjustments) ? c.adjustments.length : 0
      var keepCount = Array.isArray(c.keepAsIs) ? c.keepAsIs.length : 0
      return '<div style="margin-bottom:6px;color:var(--t1);font-weight:500">Mid-week plan update</div>'
        + '<div style="font-size:11px;color:var(--t2);margin-bottom:6px">' + esc(c.whatChanged || '') + '</div>'
        + '<div style="display:flex;gap:8px">'
        + (adjCount ? '<span style="font-size:10px;padding:3px 8px;border-radius:6px;background:rgba(232,200,122,.1);color:#e8c87a">' + adjCount + ' swapped</span>' : '')
        + (keepCount ? '<span style="font-size:10px;padding:3px 8px;border-radius:6px;background:rgba(52,210,122,.1);color:#34d27a">' + keepCount + ' on track</span>' : '')
        + '</div>'
    }

    // Competitor analysis (Riley)
    if (type === 'competitor_analysis' && c.patterns) {
      var patCount = Array.isArray(c.patterns) ? c.patterns.length : 0
      var gapCount = Array.isArray(c.gaps) ? c.gaps.length : 0
      var topGap = Array.isArray(c.gaps) && c.gaps[0] ? c.gaps[0] : null
      return '<div style="margin-bottom:6px;color:var(--t1);font-weight:500">Competitor landscape · ' + esc(c.nicheAnalyzed || '') + '</div>'
        + '<div style="display:flex;gap:8px;margin-bottom:6px">'
        + '<span style="font-size:10px;padding:3px 8px;border-radius:6px;background:var(--s2);color:var(--t2)">' + patCount + ' patterns</span>'
        + '<span style="font-size:10px;padding:3px 8px;border-radius:6px;background:rgba(52,210,122,.1);color:#34d27a">' + gapCount + ' gaps</span>'
        + '</div>'
        + (topGap ? '<div style="font-size:11px;color:var(--t2);line-height:1.5">Top gap: ' + esc(topGap.opportunity?.slice(0, 80) || '') + '</div>' : '')
    }

    // Upload review — show verdict + score
    if (type === 'upload_review') {
      var rev = c.verdict ? c : (c.data || c)
      if (rev.verdict) {
        var vCol = rev.verdict === 'ready_to_post' ? '#34d27a' : '#e87a7a'
        return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">'
          + '<span style="font-size:18px;font-weight:700;color:' + vCol + '">' + (rev.overallScore || '?') + '/10</span>'
          + '<span style="font-size:11px;padding:2px 8px;border-radius:4px;background:' + vCol + '18;color:' + vCol + '">' + (rev.verdict === 'ready_to_post' ? 'Ready to post' : 'Needs work') + '</span>'
          + '</div>'
          + (rev.rileyNote ? '<div style="font-size:11px;color:var(--t2);line-height:1.5">' + esc(String(rev.rileyNote).slice(0, 120)) + '</div>' : '')
      }
      return '<div style="color:var(--t2);font-size:11px">Riley is reviewing your upload</div>'
    }

    // Performance review / weekly pulse — show key insights
    if (type === 'performance_review' || type === 'weekly_pulse') {
      if (c.topRecommendation) return '<div style="font-style:italic;color:var(--t1)">' + esc(String(c.topRecommendation).slice(0, 150)) + '</div>'
      if (c.oneThingToDo) return '<div style="font-style:italic;color:var(--t1)">' + esc(String(c.oneThingToDo).slice(0, 150)) + '</div>'
    }

    // Generic summary fallback
    if (c.summary) {
      return '<div style="font-style:italic">' + esc(String(c.summary).slice(0, 150)) + '</div>'
    }

    // jordanNote / rileyNote fallback
    if (c.jordanNote) return '<div style="font-style:italic;color:var(--t1)">' + esc(String(c.jordanNote).slice(0, 150)) + '</div>'
    if (c.rileyNote) return '<div style="font-style:italic;color:var(--t1)">' + esc(String(c.rileyNote).slice(0, 150)) + '</div>'

    // Description fallback
    if (t.description) {
      return '<div style="color:var(--t3)">' + esc(String(t.description).slice(0, 120)) + '</div>'
    }

    return ''
  }

  function statusLabel(s) {
    var map = { delivered: 'Awaiting review', pending: 'In progress', in_progress: 'In progress', approved: 'Approved', rejected: 'Rejected', revision: 'Reworking' }
    return map[s] || s
  }

  function outputPreview(output) {
    if (!output) return ''
    var c = output.content || {}
    if (Array.isArray(c.hooks) && c.hooks.length) {
      return '<div style="color:var(--t2);font-size:12px;line-height:1.6">'
        + c.hooks.slice(0, 3).map(function (h, i) {
          return '<div style="padding:6px 0;' + (i > 0 ? 'border-top:1px solid var(--b1);' : '') + (h.flagged ? 'color:var(--t1);font-weight:500' : '') + '">' + (i + 1) + '. ' + esc(h.text || '') + '</div>'
        }).join('')
        + '</div>'
    }
    if (Array.isArray(c.trends) && c.trends.length) {
      return '<div style="color:var(--t2);font-size:12px;line-height:1.6">'
        + c.trends.slice(0, 3).map(function (t) {
          return '<div style="padding:4px 0"><strong style="color:var(--t1)">' + esc(t.topic || '') + '</strong> — ' + esc(t.growth || '') + '</div>'
        }).join('')
        + '</div>'
    }
    if (Array.isArray(c.posts) && c.posts.length) {
      return '<div style="color:var(--t2);font-size:12px;line-height:1.6">'
        + c.posts.slice(0, 4).map(function (p) {
          return '<div style="padding:4px 0"><strong style="color:var(--t1)">' + esc(p.day || '') + '</strong> · ' + esc(p.format || '') + ' — ' + esc(p.topic || '') + '</div>'
        }).join('')
        + '</div>'
    }
    return ''
  }

  async function renderInbox(container) {
    var tasks = await fetchTasks()

    // Deduplicate by title — keep only the most recent of each
    var seen = {}
    var unique = []
    tasks.forEach(function (t) {
      var key = (t.title || '').trim().toLowerCase()
      if (!key) { unique.push(t); return }
      if (!seen[key]) { seen[key] = true; unique.push(t) }
    })

    var delivered = unique.filter(function (t) { return t.status === 'delivered' })
    var completed = unique.filter(function (t) { return t.status === 'approved' || t.status === 'rejected' })

    var html = ''

    // Section: Needs your decision
    if (delivered.length > 0) {
      var showDelivered = delivered.slice(0, maxVisible)
      var moreDelivered = delivered.length - maxVisible
      html += '<div style="margin-bottom:28px">'
        + '<div style="color:var(--t2);font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:500;margin-bottom:12px">'
        + 'Needs your decision (' + delivered.length + ')</div>'
        + showDelivered.map(inboxCard).join('')
        + (moreDelivered > 0 ? '<button data-vx-show-all="delivered" style="color:var(--t3);font-size:11px;background:none;border:1px solid var(--b1);border-radius:8px;padding:8px 16px;cursor:pointer;font-family:inherit;width:100%;margin-top:6px">Show ' + moreDelivered + ' more</button>' : '')
        + '</div>'
    }

    // Section: Completed (collapsed)
    if (completed.length > 0) {
      html += '<div>'
        + '<button id="vx-completed-toggle" style="color:var(--t3);font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:500;background:none;border:none;cursor:pointer;font-family:inherit;padding:0;margin-bottom:12px">'
        + 'Completed (' + completed.length + ') ▸</button>'
        + '<div id="vx-completed-list" style="display:none">'
        + completed.slice(0, 10).map(inboxCard).join('')
        + '</div></div>'
    }

    // Empty state
    if (tasks.length === 0) {
      html = '<div style="padding:40px;text-align:center;color:var(--t2);font-size:13px;line-height:1.55;border:1px dashed var(--b1);border-radius:12px">'
        + 'No tasks yet. Brief an agent from the dashboard or wait for proactive deliveries.'
        + '</div>'
    }

    container.innerHTML = html

    // Wire "Show more" buttons
    container.querySelectorAll('[data-vx-show-all]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        maxVisible = 999
        renderInbox(container)
      })
    })

    wireInboxActions(container)
  }

  function wireInboxActions(container) {
    // Approve / Reject
    container.querySelectorAll('[data-vx-action]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var action = btn.dataset.vxAction
        var taskId = btn.dataset.taskId
        btn.disabled = true
        btn.textContent = '...'

        var feedback
        if (action === 'reject') {
          feedback = window.prompt('What should change?', '')
          if (feedback === null) { btn.disabled = false; btn.textContent = 'Reject'; return }
        }

        var body = { action: action }
        if (feedback) body.feedback = feedback
        try {
          var res = await fetch('/api/tasks/' + taskId + '/action', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          if (res.ok) {
            renderInbox(container)
            window.dispatchEvent(new CustomEvent('vx-task-changed'))
          }
        } catch {}
      })
    })

    // Open — trigger meeting with output
    container.querySelectorAll('[data-vx-open]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var taskId = btn.dataset.vxOpen
        var card = btn.closest('[data-task-id]')
        if (!card) return
        // Focus the task in the old task list view (for meeting/detail)
        sessionStorage.setItem('vxFocusTaskId', taskId)
        if (typeof window.switchTasksView === 'function') window.switchTasksView('list')
        // Scroll to the card
        setTimeout(function () {
          var el = document.querySelector('.out-card[data-task-id="' + taskId + '"]')
          if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }, 200)
      })
    })

    // Completed toggle
    var toggle = container.querySelector('#vx-completed-toggle')
    var list = container.querySelector('#vx-completed-list')
    if (toggle && list) {
      toggle.addEventListener('click', function () {
        var showing = list.style.display !== 'none'
        list.style.display = showing ? 'none' : 'block'
        toggle.textContent = toggle.textContent.replace(showing ? '▾' : '▸', showing ? '▸' : '▾')
      })
    }
  }

  // ── Main inject ────────────────────────────────────────────────
  function injectWork() {
    var tasksView = document.getElementById('view-db-tasks')
    if (!tasksView) return
    var inner = tasksView.querySelector('.view-inner')
    if (!inner) return

    // Remove stock title
    inner.querySelectorAll('.db-section-title, .db-section-sub').forEach(function (n) { n.remove() })

    // Header (idempotent)
    if (!inner.querySelector('#vx-work-header')) {
      var hdr = document.createElement('div')
      hdr.id = 'vx-work-header'
      hdr.style.marginBottom = '8px'
      hdr.innerHTML = '<h1 style="font-family:Cormorant Garamond,serif;font-size:clamp(28px,3.2vw,40px);font-weight:300;font-style:italic;line-height:1.1;color:var(--t1);margin:0">Work</h1>'
      inner.insertBefore(hdr, inner.firstChild)
    }

    // Tabs (rebuild on each inject to reflect current tab)
    var existingTabs = inner.querySelector('#vx-work-tabs')
    if (existingTabs) existingTabs.remove()
    var tabWrap = document.createElement('div')
    tabWrap.innerHTML = tabBar()
    var hdrEl = inner.querySelector('#vx-work-header')
    if (hdrEl) hdrEl.after(tabWrap.firstElementChild)

    // Wire tab clicks
    inner.querySelectorAll('[data-vx-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        currentTab = btn.dataset.vxTab
        injectWork()
      })
    })

    // Hide all content sections first
    var calView = inner.querySelector('#tasks-cal-view')
    var listView = inner.querySelector('#tasks-list-view')
    var viewToggle = inner.querySelector('.tasks-view-toggle')
    var outNav = inner.querySelector('.out-nav')
    if (calView) calView.style.display = 'none'
    if (listView) listView.style.display = 'none'
    if (viewToggle) viewToggle.style.display = 'none'
    if (outNav) outNav.style.display = 'none'

    // Hide team + outputs sections when not on their tab
    var teamSection = inner.querySelector('#vx-work-team')
    var outputsSection = inner.querySelector('#vx-work-outputs')
    if (teamSection) teamSection.style.display = 'none'
    if (outputsSection) outputsSection.style.display = 'none'

    // Show content for current tab
    if (currentTab === 'inbox') {
      var inboxHost = inner.querySelector('#vx-inbox-host')
      if (!inboxHost) {
        inboxHost = document.createElement('div')
        inboxHost.id = 'vx-inbox-host'
        // Insert after tabs
        var tabs = inner.querySelector('#vx-work-tabs')
        if (tabs) tabs.after(inboxHost)
      }
      inboxHost.style.display = 'block'
      renderInbox(inboxHost)
    } else {
      var inboxHost2 = inner.querySelector('#vx-inbox-host')
      if (inboxHost2) inboxHost2.style.display = 'none'
    }

    if (currentTab === 'calendar') {
      if (viewToggle) viewToggle.style.display = 'flex'
      if (calView) calView.style.display = 'block'
      if (typeof window.renderCalendar === 'function') window.renderCalendar()
    }

    if (currentTab === 'team') {
      if (!teamSection) {
        teamSection = document.createElement('section')
        teamSection.id = 'vx-work-team'
        var tabs2 = inner.querySelector('#vx-work-tabs')
        if (tabs2) tabs2.after(teamSection)
      }
      teamSection.style.display = 'block'
      teamSection.innerHTML = '<div class="emp-cards"></div>'
      if (window.vxRenderTeam) {
        try { window.vxRenderTeam() } catch {}
      }
    }

    // Hide standalone views
    ;['view-db-team', 'view-db-outputs'].forEach(function (id) {
      var v = document.getElementById(id)
      if (v) v.classList.remove('active')
    })
  }

  // ── Navigation wiring ──────────────────────────────────────────
  var origNavigate = window.navigate
  window.navigate = function (id) {
    if (id === 'db-team') {
      // New standalone Team page — don't redirect to Work anymore
      var r = typeof origNavigate === 'function' ? origNavigate(id) : undefined
      return r
    }
    if (id === 'db-outputs') {
      currentTab = 'inbox'
      var r2 = typeof origNavigate === 'function' ? origNavigate('db-tasks') : undefined
      setTimeout(injectWork, 60)
      return r2
    }
    var r3 = typeof origNavigate === 'function' ? origNavigate(id) : undefined
    if (id === 'db-tasks') {
      setTimeout(injectWork, 60)
    }
    return r3
  }

  var prevEnter = window.enterDashboard
  window.enterDashboard = async function () {
    if (typeof prevEnter === 'function') await prevEnter()
    setTimeout(injectWork, 100)
  }

  function retry() {
    var tasksView = document.getElementById('view-db-tasks')
    if (!tasksView) return
    if (!tasksView.querySelector('#vx-work-tabs')) injectWork()
  }

  // Check URL for tab param (e.g. ?tab=content)
  try {
    var urlTab = new URLSearchParams(window.location.search).get('tab')
    if (urlTab && ['inbox', 'calendar', 'team'].indexOf(urlTab) !== -1) {
      currentTab = urlTab
    }
  } catch {}

  if (document.readyState !== 'loading') setTimeout(injectWork, 700)
  document.addEventListener('DOMContentLoaded', function () { setTimeout(injectWork, 800) })
  setInterval(retry, 1500)
})()
