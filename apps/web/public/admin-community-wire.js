/* Admin · Community moderation queue.
 * Lists pending CommunityReport rows from /api/admin/community/reports and
 * lets an admin restore / confirm-hide / dismiss each one. The view is only
 * rendered when /api/auth/me returns user.isAdmin === true.
 */
;(function () {
  'use strict'

  function get(u) {
    return fetch(u, { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : { __err: r.status } })
      .catch(function () { return { __err: 0 } })
  }
  function esc(s) {
    return String(s || '').replace(/[<>&"]/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]
    })
  }
  function friendlyReportReason (reason) {
    var s = String(reason || '').trim()
    if (!s) return 'Report'
    return s.replace(/_/g, ' ').replace(/\b\w/g, function (ch) { return ch.toUpperCase() })
  }

  function timeAgo(d) {
    if (!d) return ''
    var diff = Date.now() - new Date(d).getTime()
    var m = Math.floor(diff / 60000)
    if (m < 60) return m + 'm ago'
    var h = Math.floor(m / 60)
    if (h < 24) return h + 'h ago'
    return Math.floor(h / 24) + 'd ago'
  }

  var loaded = false

  function render(reports) {
    var list = document.getElementById('admin-community-reports-list')
    var counter = document.getElementById('admin-pending-count')
    if (!list) return
    if (counter) counter.textContent = reports.length
    if (reports.length === 0) {
      list.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--t3);font-size:13px;line-height:1.5;font-family:\'DM Sans\',sans-serif">Nothing waiting for review.</div>'
      return
    }
    list.innerHTML = reports.map(function (r) {
      var thumb = r.post && r.post.thumbnailUrl ? r.post.thumbnailUrl : ''
      var caption = (r.post && r.post.caption) || '(no caption)'
      var handle = r.post && r.post.account && r.post.account.handle ? '@' + r.post.account.handle : ''
      var reporter = r.reporter && r.reporter.email ? r.reporter.email : 'Anonymous reporter'
      return '<div class="admin-report-tile" data-report-id="' + esc(r.id) + '">'
        + (thumb ? '<img class="thumb" src="' + esc(thumb) + '" referrerpolicy="no-referrer" />' : '<div class="thumb"></div>')
        + '<div>'
        + '<div class="eyebrow">Awaiting review · ' + esc(friendlyReportReason(r.reason)) + '</div>'
        + '<h3>' + esc(caption.slice(0, 140)) + '</h3>'
        + '<div class="meta">By ' + esc(handle) + ' · Reported by ' + esc(reporter) + ' · ' + esc(timeAgo(r.createdAt)) + (r.notes ? ' · "' + esc(r.notes.slice(0, 80)) + '"' : '') + '</div>'
        + '</div>'
        + '<div class="admin-report-actions">'
        + '<button data-action="restore">Restore</button>'
        + '<button data-action="confirm_hide">Confirm hide</button>'
        + '<button data-action="dismiss">Dismiss</button>'
        + '</div>'
        + '</div>'
    }).join('')
  }

  function load() {
    return get('/api/admin/community/reports?status=pending').then(function (d) {
      if (!d || d.__err) {
        var list = document.getElementById('admin-community-reports-list')
        if (list) {
          list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--t3);font-size:13px;line-height:1.5">'
            + (d && (d.__err === 401 || d.__err === 403)
              ? 'You need admin access to view this queue.'
              : 'We couldn\'t load the queue. Refresh the page or try again shortly.')
            + '</div>'
        }
        return
      }
      render((d && d.reports) || [])
    })
  }

  function resolve(reportId, action) {
    return fetch('/api/admin/community/reports/' + encodeURIComponent(reportId) + '/resolve', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action }),
    }).then(function (r) { return r.ok })
  }

  // Add the Admin · Moderation nav link if the current user is admin
  function maybeAddAdminNav() {
    get('/api/auth/me').then(function (data) {
      if (!data || data.__err) return
      var isAdmin = data && data.user && data.user.isAdmin === true
      if (!isAdmin) return
      var view = document.getElementById('view-admin-community')
      if (view) view.dataset.adminAvail = '1'
      // Reveal a link in the existing footer/sidebar — keep this lightweight:
      // we look for any existing nav with [data-vx-nav] and add a 'community'
      // entry beside it. If the chrome doesn't expose a hook, the admin can
      // navigate via window.navigate('admin-community').
      window.vxAdminCommunityAvailable = true
    })
  }

  function wire() {
    if (loaded) return
    loaded = true
    maybeAddAdminNav()
    var list = document.getElementById('admin-community-reports-list')
    if (list && !list.dataset.wired) {
      list.dataset.wired = '1'
      list.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest && e.target.closest('button[data-action]')
        if (!btn) return
        var tile = btn.closest('.admin-report-tile')
        if (!tile) return
        var rid = tile.dataset.reportId
        var action = btn.dataset.action
        if (!rid || !action) return
        btn.disabled = true
        resolve(rid, action).then(function (ok) {
          if (ok) load()
          else {
            btn.disabled = false
            var prev = btn.textContent
            btn.textContent = 'Couldn\'t update — try again'
            setTimeout(function () { btn.textContent = prev }, 2600)
          }
        })
      })
    }
    load()
  }

  // Hook into navigation so the admin queue refreshes on entry.
  var origNav = window.navigate
  window.navigate = function (id) {
    var r = typeof origNav === 'function' ? origNav(id) : undefined
    if (id === 'admin-community') {
      setTimeout(wire, 100)
    }
    return r
  }

  // Also wire up early so the admin-availability flag is set on first load.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeAddAdminNav)
  } else {
    maybeAddAdminNav()
  }
})()
