/* HQ Dashboard — wire real data into the static Vexa-2 layout.
 * Reads from window.__vxDashState (populated by dashboard-v2.js fetchAll)
 * and fetches /api/platform/timeseries for chart detail.
 */
;(function () {
  'use strict'

  var get = function (u) { return fetch(u, { credentials: 'include' }).then(function (r) { return r.ok ? r.json() : null }).catch(function () { return null }) }

  function esc(s) { return String(s || '').replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] }) }
  function fmt(n) { if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'; return String(n) }
  function pct(n) { return (n >= 0 ? '+' : '') + n.toFixed(1) + '%' }
  function delta(n) { return n >= 0 ? '▲ ' + fmt(Math.abs(n)) : '▼ ' + fmt(Math.abs(n)) }
  function deltaHtml(n) {
    if (n > 0) return '<span style="color:var(--ok)">▲ ' + fmt(n) + '</span>'
    if (n < 0) return '<span style="color:var(--down,#d68a8a)">▼ ' + fmt(Math.abs(n)) + '</span>'
    return '<span style="color:var(--t3)">— flat</span>'
  }

  function waitForState(cb) {
    var attempts = 0
    function check() {
      var S = window.__vxDashState
      // Wait until overview is loaded (it comes in the second batch after me/tasks)
      if (S && S.me && S.overview) { cb(S); return }
      // After 30 attempts (~7.5s), run with whatever we have
      if (S && S.me && ++attempts >= 30) { cb(S); return }
      if (++attempts < 60) setTimeout(check, 250)
    }
    check()
  }

  var hqPopulated = false
  function populateHQ(S) {
    if (hqPopulated) return
    hqPopulated = true
    var ov = S.overview
    var me = S.me
    var tasks = S.tasks || []
    var usage = S.usage
    var user = me && me.user
    var company = me && me.companies && me.companies[0]
    if (!user) return

    // ── MASTHEAD ──
    var masthead = document.querySelector('#view-db-dashboard .masthead')
    if (masthead) {
      var h1 = masthead.querySelector('h1')
      if (h1) {
        var hour = new Date().getHours()
        var greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
        var name = user.fullName || user.username || 'CEO'
        var delivered = tasks.filter(function (t) { return t.status === 'delivered' }).length
        h1.innerHTML = greeting + ', ' + esc(name) + '.'
      }
      // Update sub text
      var sub = masthead.querySelector('.sub')
      if (sub) {
        var companyName = (company && company.name) || ''
        sub.textContent = companyName ? companyName + ' · ' + (company.niche || '') : ''
      }
    }

    // ── PIPELINE NODES ──
    var roleMap = { analyst: 'maya', strategist: 'jordan', copywriter: 'alex', creative_director: 'riley' }
    var nodes = document.querySelectorAll('#view-db-dashboard #pipe .node')
    nodes.forEach(function(node) {
      var key = node.dataset.node
      var role = Object.keys(roleMap).find(function(r) { return roleMap[r] === key })
      if (!role) return
      var roleTasks = tasks.filter(function(t) { return t.employee && t.employee.role === role })
      var latest = roleTasks[0]
      var statusEl = node.querySelector('.node-status')
      var taskEl = node.querySelector('.node-task')
      var progEl = node.querySelector('.node-prog span')
      var etaEl = node.querySelector('.node-eta')

      if (!latest) {
        if (statusEl) statusEl.innerHTML = '<span class="dt"></span>IDLE'
        node.className = node.className.replace(/\b(done|working|queued)\b/g, '') + ' queued'
        return
      }

      var status = latest.status
      if (status === 'delivered') {
        node.className = node.className.replace(/\b(done|working|queued)\b/g, '') + ' done'
        if (statusEl) statusEl.innerHTML = '<span class="dt"></span>DELIVERED · ' + timeAgo(latest.completedAt || latest.createdAt)
        if (progEl) progEl.style.width = '100%'
      } else if (status === 'in_progress') {
        node.className = node.className.replace(/\b(done|working|queued)\b/g, '') + ' working'
        if (statusEl) statusEl.innerHTML = '<span class="dt"></span>WORKING · ' + timeAgo(latest.createdAt)
        if (progEl) progEl.style.width = '50%'
      } else {
        node.className = node.className.replace(/\b(done|working|queued)\b/g, '') + ' queued'
        if (statusEl) statusEl.innerHTML = '<span class="dt"></span>' + status.toUpperCase()
      }
      if (taskEl) taskEl.textContent = latest.title || ''
      if (etaEl && latest.completedAt) etaEl.innerHTML = '<span>' + timeAgo(latest.completedAt) + '</span>'
    })

    // ── PLATFORM TILES ──
    if (ov && ov.accounts) {
      // Get follower counts from sparkline last entry (accounts don't have followerCount)
      var lastSparkline = ov.sparkline && ov.sparkline.length > 0 ? ov.sparkline[ov.sparkline.length - 1] : null
      var byPlatform = lastSparkline && lastSparkline.byPlatform ? lastSparkline.byPlatform : {}

      var platRow = document.querySelector('#view-db-dashboard .plat-row')
      if (platRow) {
        var tiles = platRow.querySelectorAll('.plat')
        ov.accounts.forEach(function (acct, i) {
          if (i >= tiles.length) return
          var tile = tiles[i]
          var platform = (acct.platform || '').toLowerCase()
          var followers = acct.latestFollowers || acct.followerCount || byPlatform[platform] || 0
          var big = tile.querySelector('.big')
          var sub = tile.querySelector('.sub')
          var nm = tile.querySelector('.nm')
          var handle = tile.querySelector('.s') || tile.querySelector('.nm span')
          if (big) big.innerHTML = '<em>' + fmt(followers) + '</em>'
          if (sub) sub.textContent = 'followers'
          if (nm) {
            var pName = platform === 'instagram' ? 'Instagram' : platform === 'tiktok' ? 'TikTok' : platform === 'youtube' ? 'YouTube' : acct.platform
            nm.childNodes[0].textContent = pName
          }
          if (handle && acct.handle) handle.textContent = '@' + acct.handle

          // Update platform class for correct color
          tile.className = tile.className.replace(/\b(ig|tt|yt)\b/g, '')
          tile.classList.add(platform === 'instagram' ? 'ig' : platform === 'tiktok' ? 'tt' : 'yt')
          var tag = tile.querySelector('.tag')
          if (tag) tag.textContent = platform === 'instagram' ? 'IG' : platform === 'tiktok' ? 'TT' : 'YT'
        })
        // Hide extra placeholder tiles
        for (var t = ov.accounts.length; t < tiles.length; t++) {
          tiles[t].style.display = 'none'
        }
      }
    }

    // ── FOLLOWER KPI CARD (above chart) ──
    if (ov) {
      var kpiHead = document.querySelector('#view-db-dashboard .kpi-head')
      if (kpiHead) {
        var kpiV = kpiHead.querySelector('.l .v')
        var kpiD = kpiHead.querySelector('.l .d')
        if (kpiV && ov.combinedFollowers != null) {
          kpiV.innerHTML = '<em>' + Number(ov.combinedFollowers).toLocaleString() + '</em>'
        }
        if (kpiD) {
          var totalDelta = ov.combinedFollowersDelta || 0
          var totalFollowers = ov.combinedFollowers || 1
          var growthPct = ((totalDelta / (totalFollowers - totalDelta)) * 100).toFixed(1)
          kpiD.innerHTML = deltaHtml(totalDelta) + ' · ' + (totalDelta >= 0 ? '+' : '') + growthPct + '% · 7d'
        }
      }
    }

    // ── FOLLOWER CHART ──
    if (ov && ov.sparkline && ov.sparkline.length > 1) {
      var chartSvg = document.getElementById('chart')
      if (chartSvg) {
        populateFollowerChart(chartSvg, ov)
      }
      wireChartTabs(ov)
    }

    // ── POSTS TABLE ──
    if (ov && ov.topPost) {
      populatePostsTable(S)
    }

    // ── AUDIENCE SNAPSHOT ──
    if (ov && ov.audience) {
      populateAudience(ov.audience)
    }

    // ── APPROVALS SIDEBAR ──
    populateApprovals(tasks)

    // ── CHART LEGEND ──
    if (ov && ov.accounts && ov.sparkline && ov.sparkline.length > 0) {
      var lastSp = ov.sparkline[ov.sparkline.length - 1]
      var byPlat = lastSp.byPlatform || {}
      var legend = document.querySelector('#view-db-dashboard .chart-legend')
      if (legend) {
        var lis = legend.querySelectorAll('.li')
        ov.accounts.forEach(function (acct, i) {
          if (i >= lis.length) return
          var platform = (acct.platform || '').toLowerCase()
          var pName = platform === 'instagram' ? 'Instagram' : platform === 'tiktok' ? 'TikTok' : platform === 'youtube' ? 'YouTube' : acct.platform
          var count = byPlat[platform] || 0
          lis[i].innerHTML = '<span class="sw ' + (platform === 'instagram' ? 'ig' : platform === 'tiktok' ? 'tt' : 'yt') + '"></span>' + pName + ' · ' + fmt(count)
        })
        // Hide extra legend items
        for (var li = ov.accounts.length; li < lis.length; li++) {
          lis[li].style.display = 'none'
        }
      }
    }
  }

  function populateFollowerChart(svg, ov) {
    var sparkline = ov.sparkline
    if (!sparkline || sparkline.length < 2) return

    var w = 600, h = 180, pad = 10

    // Collect all platform keys
    var platforms = []
    var bp = sparkline[0].byPlatform || {}
    for (var k in bp) platforms.push(k)
    if (platforms.length === 0) platforms = ['total']

    // Find min/max PER platform so each line uses full chart height
    var platformRanges = {}
    platforms.forEach(function (p) {
      var vals = sparkline.map(function (d) {
        return p === 'total' ? (d.total || 0) : ((d.byPlatform || {})[p] || 0)
      })
      var mn = Math.min.apply(null, vals)
      var mx = Math.max.apply(null, vals)
      var rng = mx - mn || 1
      // Expand range by 20% so the line doesn't touch edges
      platformRanges[p] = { min: mn - rng * 0.1, range: rng * 1.2 }
    })

    var colors = { instagram: 'var(--ig)', tiktok: 'var(--tt)', youtube: 'var(--yt)', total: 'var(--accent)' }
    var gradIds = { instagram: 'gIG', tiktok: 'gTT', youtube: 'gYT' }

    // Clear existing paths/circles (keep defs + grid)
    var toRemove = svg.querySelectorAll('path, circle, line[stroke-dasharray]')
    toRemove.forEach(function (el) { el.remove() })

    // Draw per-platform lines
    platforms.forEach(function (plat, pi) {
      var series = sparkline.map(function (d) {
        return plat === 'total' ? (d.total || 0) : ((d.byPlatform || {})[plat] || 0)
      })

      var pr = platformRanges[plat]
      var pts = series.map(function (v, i) {
        var x = (i / (series.length - 1)) * w
        var y = h - ((v - pr.min) / pr.range) * (h - 2 * pad) - pad
        return { x: x, y: y }
      })

      var pathD = 'M' + pts.map(function (p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1) }).join(' L')
      var fillD = pathD + ' L' + w + ',' + h + ' L0,' + h + ' Z'
      var color = colors[plat] || 'var(--t2)'

      // Fill area (only for first platform for clarity)
      if (pi === 0 && gradIds[plat]) {
        var fill = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        fill.setAttribute('d', fillD)
        fill.setAttribute('fill', 'url(#' + gradIds[plat] + ')')
        svg.appendChild(fill)
      }

      // Line
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      line.setAttribute('d', pathD)
      line.setAttribute('fill', 'none')
      line.setAttribute('stroke', color)
      line.setAttribute('stroke-width', pi === 0 ? '1.8' : '1.5')
      svg.appendChild(line)

      // End dot
      var lastPt = pts[pts.length - 1]
      var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      dot.setAttribute('cx', lastPt.x.toFixed(1))
      dot.setAttribute('cy', lastPt.y.toFixed(1))
      dot.setAttribute('r', '3')
      dot.setAttribute('fill', color)
      svg.appendChild(dot)
    })
  }

  // ── CHART SCOPE BUTTONS ──
  var fullSparkline = null
  var fullSnapshots = null

  function wireChartTabs(ov) {
    var tabs = document.querySelector('#view-db-dashboard .section-head .tabs')
    if (!tabs) return

    fullSparkline = ov.sparkline || []

    // Also fetch timeseries for 90d snapshots
    get('/api/platform/timeseries').then(function (ts) {
      if (ts && ts.snapshots && ts.snapshots.length > 0) {
        // Build sparkline-like data from snapshots
        var byDate = {}
        ts.snapshots.forEach(function (s) {
          var d = (s.capturedAt || '').slice(0, 10)
          if (!byDate[d]) byDate[d] = { date: d, total: 0, byPlatform: {} }
          var platform = null
          // Map accountId to platform
          if (ov.accounts) {
            // Use sparkline's byPlatform keys to infer
            var lastSp = fullSparkline[fullSparkline.length - 1]
            if (lastSp && lastSp.byPlatform) {
              var platforms = Object.keys(lastSp.byPlatform)
              // If this snapshot's follower count matches a platform in the last sparkline entry
              // Simple approach: assign based on magnitude
              platform = s.followerCount > 5000 ? 'instagram' : 'tiktok'
            }
          }
          byDate[d].total += (s.followerCount || 0)
          if (platform) byDate[d].byPlatform[platform] = (byDate[d].byPlatform[platform] || 0) + (s.followerCount || 0)
        })
        fullSnapshots = Object.keys(byDate).sort().map(function (d) { return byDate[d] })
      }
    })

    tabs.addEventListener('click', function (e) {
      var btn = e.target.closest('button')
      if (!btn) return
      tabs.querySelectorAll('button').forEach(function (b) { b.classList.remove('on') })
      btn.classList.add('on')

      var label = btn.textContent.trim().toUpperCase()
      var days = 30
      if (label === '24H') days = 1
      else if (label === '7D') days = 7
      else if (label === '30D') days = 30
      else if (label === '90D') days = 90

      var source = days > 30 && fullSnapshots && fullSnapshots.length > 0 ? fullSnapshots : fullSparkline
      if (!source || source.length === 0) return

      // Filter to requested range
      var cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - days)
      var cutoffStr = cutoff.toISOString().slice(0, 10)
      var filtered = source.filter(function (d) { return d.date >= cutoffStr })
      if (filtered.length < 2) filtered = source.slice(-Math.min(days, source.length))

      // Update KPI card values
      var kpiHead = document.querySelector('#view-db-dashboard .kpi-head')
      if (kpiHead && filtered.length >= 2) {
        var kpiD = kpiHead.querySelector('.l .d')
        var first = filtered[0].total || 0
        var last = filtered[filtered.length - 1].total || 0
        var diff = last - first
        var pctChange = first > 0 ? (diff / first * 100).toFixed(1) : '0'
        if (kpiD) kpiD.innerHTML = deltaHtml(diff) + ' · ' + (diff >= 0 ? '+' : '') + pctChange + '% · last ' + filtered.length + 'd'
      }

      // Redraw chart
      var chartSvg = document.getElementById('chart')
      if (chartSvg) {
        var fakeOv = { sparkline: filtered }
        populateFollowerChart(chartSvg, fakeOv)
      }

      // Update legend with scoped values
      var legend = document.querySelector('#view-db-dashboard .chart-legend')
      if (legend && filtered.length >= 2) {
        var firstEntry = filtered[0]
        var lastEntry = filtered[filtered.length - 1]
        var lastBP = lastEntry.byPlatform || {}
        var firstBP = firstEntry.byPlatform || {}
        var lis = legend.querySelectorAll('.li')
        var platKeys = Object.keys(lastBP)
        platKeys.forEach(function (plat, i) {
          if (i >= lis.length) return
          var pName = plat === 'instagram' ? 'Instagram' : plat === 'tiktok' ? 'TikTok' : plat === 'youtube' ? 'YouTube' : plat
          var cls = plat === 'instagram' ? 'ig' : plat === 'tiktok' ? 'tt' : 'yt'
          var current = lastBP[plat] || 0
          var prev = firstBP[plat] || 0
          var d = current - prev
          var dStr = deltaHtml(d)
          lis[i].innerHTML = '<span class="sw ' + cls + '"></span>' + pName + ' · ' + fmt(current) + ' · ' + dStr
        })
      }
    })
  }

  function populatePostsTable(S) {
    // Fetch timeseries for real post data
    get('/api/platform/timeseries').then(function (ts) {
      if (!ts || !ts.posts || ts.posts.length === 0) return
      var tbody = document.querySelector('#view-db-dashboard .posts-tbl tbody')
      if (!tbody) return

      // Build accountId→platform map from timeseries account + overview
      var acctMap = {}
      if (ts.account && ts.account.id) acctMap[ts.account.id] = ts.account.platform
      // For posts from other accounts, infer platform from overview
      if (S.overview && S.overview.accounts) {
        var knownPlatforms = S.overview.accounts.map(function(a){ return a.platform })
        var knownId = ts.account ? ts.account.id : null
        var knownPlatform = ts.account ? ts.account.platform : null
        ts.posts.forEach(function(p) {
          if (!acctMap[p.accountId] && knownId && p.accountId !== knownId) {
            // This post belongs to the OTHER platform
            var other = knownPlatforms.find(function(pl){ return pl !== knownPlatform })
            if (other) acctMap[p.accountId] = other
          }
        })
      }

      // Sort by views desc for best posts first
      var sorted = ts.posts.slice().sort(function(a,b){ return (b.viewCount||b.reachCount||0) - (a.viewCount||a.reachCount||0) })
      var posts = sorted.slice(0, 5)

      tbody.innerHTML = posts.map(function (p) {
        var platform = acctMap[p.accountId] || 'instagram'
        var pf = platform === 'tiktok' ? 'tt' : platform === 'youtube' ? 'yt' : 'ig'
        var pfName = platform === 'tiktok' ? 'TIKTOK' : platform === 'youtube' ? 'YOUTUBE' : 'INSTAGRAM'
        var mediaType = (p.mediaType || 'POST').toUpperCase()
        var caption = (p.caption || '').slice(0, 60) || '(no caption)'
        var views = p.viewCount || p.reachCount || p.impressionCount || 0
        var engRate = p.engagementRate || 0
        var eng = engRate > 0 ? (engRate * 100).toFixed(1) + '%' : '—'
        var saves = p.saveCount || 0
        var ret = saves > 0 ? fmt(saves) : '—'
        var ago = timeAgo(p.publishedAt)
        var thumb = p.thumbnailUrl
        var typeIcon = mediaType === 'REEL' || mediaType === 'VIDEO' ? '▶' : mediaType === 'CAROUSEL_ALBUM' ? '◉' : '✦'
        var thumbHtml = thumb
          ? '<div class="thumb" style="background:url(' + esc(thumb) + ') center/cover;border-radius:6px;border:1px solid var(--b1)"></div>'
          : '<div class="thumb" style="background:var(--s2);color:var(--' + pf + ');font-size:16px;border:1px solid var(--b1);border-radius:6px;display:flex;align-items:center;justify-content:center">' + typeIcon + '</div>'

        // Delta: compare engagement to average
        var avgEng = sorted.reduce(function(s,x){ return s + (x.engagementRate||0) }, 0) / sorted.length
        var engDelta = avgEng > 0 ? ((engRate - avgEng) / avgEng * 100) : 0
        var deltaCol = engDelta > 5 ? '<span style="color:var(--ok)">▲ ' + Math.round(engDelta) + '%</span>'
          : engDelta < -5 ? '<span style="color:var(--down,#d68a8a)">▼ ' + Math.round(Math.abs(engDelta)) + '%</span>'
          : '<span style="color:var(--t3)">—</span>'

        // Mini trend sparkline from engagement
        var trendSvg = ''
        if (engRate > 0) {
          var barH = Math.min(20, Math.max(4, engRate * 100))
          trendSvg = '<svg viewBox="0 0 52 22" preserveAspectRatio="none"><rect x="20" y="' + (22-barH) + '" width="12" height="' + barH + '" rx="2" fill="' + (engDelta >= 0 ? 'var(--accent)' : 'var(--down,#d68a8a)') + '" opacity=".6"/></svg>'
        }

        return '<tr>'
          + '<td><div class="cell-first">' + thumbHtml
          + '<div><div class="ttl">' + esc(caption) + '</div>'
          + '<div class="meta"><span class="pf ' + pf + '"><span class="dot"></span>' + pfName + ' · ' + mediaType + '</span><span>' + ago + '</span></div></div></div></td>'
          + '<td class="num"><em>' + fmt(views) + '</em></td>'
          + '<td class="num">' + eng + '</td>'
          + '<td class="num">' + ret + '</td>'
          + '<td class="delta">' + deltaCol + '</td>'
          + '<td class="tl">' + trendSvg + '</td>'
          + '</tr>'
      }).join('')

      // Also populate the sidebar "Recent posts" section
      populateSidebarPosts(sorted, acctMap)
    })
  }

  var allPostsCache = null
  var acctMapCache = null

  function populateSidebarPosts(posts, acctMap) {
    allPostsCache = posts
    acctMapCache = acctMap
    var postsCard = document.querySelector('#view-db-dashboard .posts-card')
    if (!postsCard) return
    var ph = postsCard.querySelector('.ph h4')
    if (ph) ph.innerHTML = 'Recent <em>posts</em> · ' + posts.length

    // Wire tab clicks
    var tabs = postsCard.querySelectorAll('.ph .f span')
    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        tabs.forEach(function(t) { t.classList.remove('on') })
        tab.classList.add('on')
        renderPostsTable(tab.textContent.trim())
      })
    })
  }

  function renderPostsTable(filter) {
    if (!allPostsCache) return
    var tbody = document.querySelector('#view-db-dashboard .posts-tbl tbody')
    if (!tbody) return

    var posts = allPostsCache.slice()
    var acctMap = acctMapCache || {}

    // Filter by platform
    if (filter === 'IG') {
      posts = posts.filter(function(p) { return acctMap[p.accountId] === 'instagram' })
    } else if (filter === 'TT') {
      posts = posts.filter(function(p) { return acctMap[p.accountId] === 'tiktok' })
    } else if (filter === 'YT') {
      posts = posts.filter(function(p) { return acctMap[p.accountId] === 'youtube' })
    }

    // Sort
    if (filter === 'TOP ENG') {
      posts.sort(function(a, b) { return (b.engagementRate || 0) - (a.engagementRate || 0) })
    } else if (filter === 'TOP VIEWS') {
      posts.sort(function(a, b) { return (b.viewCount || b.reachCount || 0) - (a.viewCount || a.reachCount || 0) })
    } else {
      posts.sort(function(a, b) { return new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0) })
    }

    var display = posts.slice(0, 5)
    var avgEng = posts.length > 0 ? posts.reduce(function(s, x) { return s + (x.engagementRate || 0) }, 0) / posts.length : 0

    // Update header
    var ph = document.querySelector('#view-db-dashboard .posts-card .ph h4')
    if (ph) {
      var label = filter === 'TOP VIEWS' ? 'Top by views' : filter === 'TOP ENG' ? 'Top by engagement' : 'Recent'
      ph.innerHTML = label + ' <em>posts</em> · ' + posts.length
    }

    tbody.innerHTML = display.map(function(p) {
      var platform = acctMap[p.accountId] || 'instagram'
      var pf = platform === 'tiktok' ? 'tt' : platform === 'youtube' ? 'yt' : 'ig'
      var pfName = platform === 'tiktok' ? 'TIKTOK' : platform === 'youtube' ? 'YOUTUBE' : 'INSTAGRAM'
      var mediaType = (p.mediaType || 'POST').toUpperCase()
      var caption = (p.caption || '').slice(0, 60) || '(no caption)'
      var views = p.viewCount || p.reachCount || p.impressionCount || 0
      var engRate = Math.min(1, p.engagementRate || 0)
      var eng = engRate > 0 ? (engRate * 100).toFixed(1) + '%' : '—'
      var saves = p.saveCount || 0
      var ret = saves > 0 ? fmt(saves) : '—'
      var ago = timeAgo(p.publishedAt)
      var thumb = p.thumbnailUrl
      var typeIcon = mediaType === 'REEL' || mediaType === 'VIDEO' ? '▶' : mediaType === 'CAROUSEL_ALBUM' ? '◉' : '✦'
      var thumbHtml = thumb
        ? '<div class="thumb" style="background:url(' + esc(thumb) + ') center/cover;border-radius:6px;border:1px solid var(--b1)"></div>'
        : '<div class="thumb" style="background:var(--s2);color:var(--' + pf + ');font-size:16px;border:1px solid var(--b1);border-radius:6px;display:flex;align-items:center;justify-content:center">' + typeIcon + '</div>'
      var engDelta = avgEng > 0 ? ((engRate - avgEng) / avgEng * 100) : 0
      var deltaCol = engDelta > 5 ? '<span style="color:var(--ok)">▲ ' + Math.round(engDelta) + '%</span>'
        : engDelta < -5 ? '<span style="color:var(--down,#d68a8a)">▼ ' + Math.round(Math.abs(engDelta)) + '%</span>'
        : '<span style="color:var(--t3)">—</span>'
      var trendSvg = ''
      if (engRate > 0) {
        var barH = Math.min(20, Math.max(4, engRate * 100))
        trendSvg = '<svg viewBox="0 0 52 22" preserveAspectRatio="none"><rect x="20" y="' + (22 - barH) + '" width="12" height="' + barH + '" rx="2" fill="' + (engDelta >= 0 ? 'var(--accent)' : 'var(--down,#d68a8a)') + '" opacity=".6"/></svg>'
      }
      return '<tr>'
        + '<td><div class="cell-first">' + thumbHtml
        + '<div><div class="ttl">' + esc(caption) + '</div>'
        + '<div class="meta"><span class="pf ' + pf + '"><span class="dot"></span>' + pfName + ' · ' + mediaType + '</span><span>' + ago + '</span></div></div></div></td>'
        + '<td class="num"><em>' + fmt(views) + '</em></td>'
        + '<td class="num">' + eng + '</td>'
        + '<td class="num">' + ret + '</td>'
        + '<td class="delta">' + deltaCol + '</td>'
        + '<td class="tl">' + trendSvg + '</td>'
        + '</tr>'
    }).join('')
  }

  function populateAudience(audience) {
    var audCard = document.querySelector('#view-db-dashboard .aud-card')
    if (!audCard) return

    var buckets = audCard.querySelectorAll('.bucket')

    // Age breakdown
    if (buckets.length >= 1 && audience.ageBreakdown && audience.ageBreakdown.length > 0) {
      var ageBucket = buckets[0]
      var rows = ageBucket.querySelectorAll('.aud-row')
      audience.ageBreakdown.slice(0, rows.length).forEach(function (age, i) {
        if (!rows[i]) return
        var spans = rows[i].querySelectorAll('span')
        if (spans[0]) spans[0].textContent = age.bucket
        var bar = rows[i].querySelector('.tr span')
        if (bar) bar.style.width = Math.min(100, Math.round(age.share * 100 * 2)) + '%'
        var pctEl = rows[i].querySelector('.pct')
        if (pctEl) pctEl.textContent = Math.round(age.share * 100) + '%'
      })
    }

    // Geo breakdown
    if (buckets.length >= 2 && audience.topCountries && audience.topCountries.length > 0) {
      var geoBucket = buckets[1]
      var geoRows = geoBucket.querySelectorAll('.aud-row')
      audience.topCountries.slice(0, geoRows.length).forEach(function (geo, i) {
        if (!geoRows[i]) return
        var spans = geoRows[i].querySelectorAll('span')
        if (spans[0]) spans[0].textContent = geo.bucket
        var bar = geoRows[i].querySelector('.tr span')
        if (bar) bar.style.width = Math.min(100, Math.round(geo.share * 100 * 2)) + '%'
        var pctEl = geoRows[i].querySelector('.pct')
        if (pctEl) pctEl.textContent = Math.round(geo.share * 100) + '%'
      })
    }
  }

  function populateApprovals(tasks) {
    var mod = document.querySelector('#view-db-dashboard .dash-side .mod')
    if (!mod) return
    var delivered = tasks.filter(function (t) { return t.status === 'delivered' })
    if (delivered.length === 0) return

    // Update the count
    var modHead = mod.querySelector('.mod-head h4')
    if (modHead) modHead.textContent = 'Approvals · ' + delivered.length

    // Replace approval cards with real tasks
    var cards = mod.querySelectorAll('.app-card')
    delivered.slice(0, cards.length).forEach(function (t, i) {
      var card = cards[i]
      if (!card) return
      var emp = t.employee || {}
      var init = (emp.name || 'V').charAt(0).toUpperCase()
      var role = (emp.role || '').replace('_', ' ').toUpperCase()
      var title = t.title || 'New deliverable'

      var hdr = card.querySelector('.hdr')
      if (hdr) {
        var av = hdr.querySelector('.av')
        if (av) av.textContent = init
        var empEl = hdr.querySelector('.emp')
        if (empEl) empEl.innerHTML = esc(emp.name || 'Agent') + '<div class="role">' + esc(role) + '</div>'
      }
      var tEl = card.querySelector('.t')
      if (tEl) tEl.innerHTML = esc(title)
      var pEl = card.querySelector('.p')
      if (pEl) pEl.textContent = t.description || ''
    })
  }

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

  // Run when state is ready
  waitForState(populateHQ)

  // Re-run on navigation to dashboard
  var origNav = window.navigate
  if (typeof origNav === 'function') {
    // Don't re-wrap if already wrapped — just hook into vx-task-changed
  }
  window.addEventListener('vx-task-changed', function () {
    if (window.__vxDashState) populateHQ(window.__vxDashState)
  })
})()
