/* Posts page — wire real PlatformPost data into the static grid.
 * Fetches /api/platform/timeseries for post-level data.
 */
;(function () {
  'use strict'

  var get = function (u) { return fetch(u, { credentials: 'include' }).then(function (r) { return r.ok ? r.json() : null }).catch(function () { return null }) }

  function esc(s) { return String(s || '').replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] }) }
  function fmt(n) { if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'; return String(n) }

  function timeAgo(dateStr) {
    if (!dateStr) return ''
    var diff = Date.now() - new Date(dateStr).getTime()
    var mins = Math.floor(diff / 60000)
    if (mins < 60) return mins + 'm ago'
    var hrs = Math.floor(mins / 60)
    if (hrs < 24) return hrs + 'h ago'
    var days = Math.floor(hrs / 24)
    return days + 'd ago'
  }

  var fetched = false

  function populate() {
    var view = document.getElementById('view-db-posts')
    if (!view) return
    if (fetched) return
    fetched = true

    get('/api/platform/timeseries').then(function (ts) {
      if (!ts || !ts.posts || ts.posts.length === 0) return

      // Build accountId→platform map
      var acctMap = {}
      if (ts.account && ts.account.id) acctMap[ts.account.id] = ts.account.platform
      var ov = window.__vxDashState && window.__vxDashState.overview
      if (ov && ov.accounts) {
        var knownPlatforms = ov.accounts.map(function(a){ return a.platform })
        var knownId = ts.account ? ts.account.id : null
        var knownPlatform = ts.account ? ts.account.platform : null
        ts.posts.forEach(function(p) {
          if (!acctMap[p.accountId] && knownId && p.accountId !== knownId) {
            var other = knownPlatforms.find(function(pl){ return pl !== knownPlatform })
            if (other) acctMap[p.accountId] = other
          }
        })
      }

      var posts = ts.posts
      var grid = view.querySelector('.grid')
      if (!grid) return

      // Update masthead stats
      var stats = view.querySelectorAll('.mini-stats .stat')
      if (stats.length >= 3) {
        var s0v = stats[0].querySelector('.v')
        if (s0v) s0v.textContent = posts.length
        var s0d = stats[0].querySelector('.d')
        if (s0d) {
          var weekAgo = Date.now() - 7 * 86400000
          var thisWeek = posts.filter(function (p) { return new Date(p.publishedAt).getTime() > weekAgo }).length
          s0d.innerHTML = '<span style="color:var(--ok)">' + thisWeek + '</span> this wk'
        }

        var totalReach = posts.reduce(function (sum, p) { return sum + (p.reachCount || p.viewCount || 0) }, 0)
        var avgReach = posts.length > 0 ? Math.round(totalReach / posts.length) : 0
        var s1v = stats[1].querySelector('.v')
        if (s1v) s1v.innerHTML = '<em>' + fmt(avgReach) + '</em>'

        var totalEng = posts.reduce(function (sum, p) {
          var r = p.reachCount || p.viewCount || 1
          var l = (p.likeCount || 0) + (p.commentCount || 0)
          return sum + (l / r)
        }, 0)
        var avgEng = posts.length > 0 ? (totalEng / posts.length * 100).toFixed(1) : '0'
        var s2v = stats[2].querySelector('.v')
        if (s2v) s2v.textContent = avgEng + '%'
      }

      // Update grid with real post cards
      grid.innerHTML = posts.slice(0, 12).map(function (p, i) {
        var plat = acctMap[p.accountId] || 'instagram'
        var platform = plat === 'tiktok' ? 'tt' : plat === 'youtube' ? 'yt' : 'ig'

        var pfLabel = platform === 'tt' ? 'TT' : platform === 'yt' ? 'YT' : 'IG'
        var rawType = (p.mediaType || 'POST').toUpperCase()
        var mediaType = rawType === 'CAROUSEL_ALBUM' ? 'SLIDESHOW' : rawType
        var caption = (p.caption || '').slice(0, 80)
        var shortCaption = caption.split('.')[0] || caption.slice(0, 40)
        var reach = p.reachCount || p.viewCount || p.impressionCount || 0
        var saves = p.saveCount || 0
        var likes = p.likeCount || 0
        var comments = p.commentCount || 0
        var eng = reach > 0 ? ((likes + comments) / reach * 100).toFixed(1) : '0'
        var ago = timeAgo(p.publishedAt)
        var thumb = p.thumbnailUrl || ''
        var colorIdx = (i % 8) + 1

        return '<div class="card">'
          + '<div class="th a' + colorIdx + '"' + (thumb ? ' style="background:url(' + esc(thumb) + ') center/cover"' : '') + '>'
          + '<span class="plat"><span class="d ' + platform + '"></span>' + pfLabel + '</span>'
          + '<span class="fmt">' + mediaType + '</span>'
          + '<span class="play">' + (mediaType === 'SLIDESHOW' ? '◉' : mediaType === 'VIDEO' || mediaType === 'REEL' ? '▷' : '✦') + '</span>'
          + '<span class="qt">"' + esc(shortCaption.slice(0, 30)) + '"</span>'
          + '</div>'
          + '<div class="body">'
          + '<div class="tag-row"><span>' + ago + '</span></div>'
          + '<div class="ttl">' + esc(caption) + '</div>'
          + '<div class="m">'
          + '<div class="cell"><div class="l">Reach</div><div class="n"><em>' + fmt(reach) + '</em></div></div>'
          + '<div class="cell"><div class="l">Saves</div><div class="n">' + fmt(saves) + '</div></div>'
          + '<div class="cell"><div class="l">ER</div><div class="n">' + eng + '%</div></div>'
          + '</div>'
          + '</div>'
          + '</div>'
      }).join('')

      // Update count
      var countEl = view.querySelector('.list-head .c')
      if (countEl) countEl.textContent = 'Showing ' + Math.min(12, posts.length) + ' of ' + posts.length

      // Update insights rail with real data
      populateInsights(view, posts)
    })
  }

  function populateInsights(view, posts) {
    var rail = view.querySelector('.rail')
    if (!rail) return

    // Find top format
    var formatCounts = {}
    posts.forEach(function (p) {
      var fmt = p.mediaType || 'POST'
      formatCounts[fmt] = (formatCounts[fmt] || 0) + 1
    })
    var topFormat = Object.keys(formatCounts).sort(function (a, b) { return formatCounts[b] - formatCounts[a] })[0] || 'REEL'

    // Avg caption length
    var totalCaptionLen = posts.reduce(function (s, p) { return s + (p.caption || '').split(' ').length }, 0)
    var avgWords = posts.length > 0 ? Math.round(totalCaptionLen / posts.length) : 0

    var insights = rail.querySelectorAll('.insight')
    if (insights.length >= 1) {
      var t0 = insights[0].querySelector('.t')
      if (t0) t0.innerHTML = '<em>' + esc(topFormat) + '</em> is your top-performing format with ' + formatCounts[topFormat] + ' posts.'
    }
    if (insights.length >= 2) {
      var t1 = insights[1].querySelector('.t')
      if (t1) t1.innerHTML = 'Average caption length is <em>' + avgWords + ' words</em> across ' + posts.length + ' posts.'
    }
  }

  // Run on navigate to Posts
  var origNav = window.navigate
  window.navigate = function (id) {
    var r = typeof origNav === 'function' ? origNav(id) : undefined
    if (id === 'db-posts') setTimeout(populate, 150)
    return r
  }
})()
