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

    // ── ENGAGEMENT + RETENTION CARDS ──
    populateEngRetCards(S)

    // ── FORECAST CHARTS ──
    populateForecastCharts(S)

    // ── POSTS TABLE ──
    if (ov && ov.topPost) {
      populatePostsTable(S)
    }

    // ── AUDIENCE SNAPSHOT ──
    if (ov && ov.audience) {
      populateAudience(ov.audience)
    }

    // approvals sidebar removed — handled in pipeline + Work page

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

      // Engagement card doesn't scope yet — needs daily metric snapshots first
    })
  }

  var engDataCache = { posts: [] }
  function updateEngCardScope(days) {
    var posts = engDataCache.posts
    if (!posts.length) return

    var now = Date.now()
    var cutoff = now - days * 86400000
    var prevCutoff = now - days * 2 * 86400000
    var engCard = document.querySelector('#view-db-dashboard .two-up .mini-card:first-child')
    if (!engCard) return
    var lbl = engCard.querySelector('.lbl')
    var v = engCard.querySelector('.v')
    var d = engCard.querySelector('.d')
    if (lbl) lbl.textContent = 'Engagement'

    // Engagement = total interactions / total reach across all posts
    // Scopes will differentiate once we have daily metric snapshots (PostMetricSnapshot)
    // showing engagement GAINED per period. For now, show lifetime weighted rate.
    var valid = posts.filter(function(p) { return p.engagementRate > 0 && p.engagementRate <= 1 })
    if (valid.length === 0) {
      if (v) v.innerHTML = '<em>—</em>'
      if (d) d.innerHTML = 'No engagement data'
      return
    }

    var totalEng = valid.reduce(function(s,p) {
      return s + (p.likeCount || 0) + (p.commentCount || 0) + (p.saveCount || 0) + (p.shareCount || 0)
    }, 0)
    var totalReach = valid.reduce(function(s,p) { return s + (p.reachCount || p.viewCount || 0) }, 0)
    var engPct = totalReach > 0 ? (totalEng / totalReach * 100) : 0

    if (v) v.innerHTML = '<em>' + engPct.toFixed(1) + '</em>%'
    if (d) d.innerHTML = fmt(totalEng) + ' interactions · ' + fmt(totalReach) + ' reach · ' + valid.length + ' posts'
  }

  function populateEngRetCards(S) {
    get('/api/platform/timeseries').then(function (ts) {
      if (!ts || !ts.posts) return
      var posts = ts.posts
      var snaps = ts.snapshots || []
      engDataCache = { posts: posts }

      // ── Engagement card (no scoping yet — shows all-time weighted rate) ──
      updateEngCardScope(0)

      // Update bars with per-snapshot engagement
      var engCard = document.querySelector('#view-db-dashboard .two-up .mini-card:first-child')
      if (engCard) {
        var bars = engCard.querySelector('.bars')
        if (bars && snaps.length > 0) {
          var recent = snaps.filter(function(s) { return s.engagementRate > 0 }).slice(-12)
          var maxEng = 0
          recent.forEach(function(s) { var e = s.engagementRate > 1 ? s.engagementRate : s.engagementRate * 100; if (e > maxEng) maxEng = e })
          bars.innerHTML = recent.map(function(s) {
            var e = s.engagementRate > 1 ? s.engagementRate : s.engagementRate * 100
            var h = maxEng > 0 ? Math.round(e / maxEng * 100) : 0
            return '<div class="bar" style="height:' + h + '%"></div>'
          }).join('')
        }
      }

      // ── Retention card ──
      var retCard = document.querySelector('#view-db-dashboard .two-up .mini-card:nth-child(2)')
      if (retCard) {
        var reels = posts.filter(function(p) { return p.avgWatchTimeMs > 0 })
        var avgWatch = reels.length > 0 ? reels.reduce(function(s,p) { return s + p.avgWatchTimeMs }, 0) / reels.length / 1000 : 0

        var lbl = retCard.querySelector('.lbl')
        var v = retCard.querySelector('.v')
        var d = retCard.querySelector('.d')
        if (lbl) lbl.textContent = 'Avg. watch time · Reels'
        if (v) v.innerHTML = '<em>' + avgWatch.toFixed(1) + '</em>s'
        if (d) d.innerHTML = reels.length + ' Reels tracked'

        // Update ring chart — show avg watch as proportion of 15s (typical Reel)
        var ring = retCard.querySelector('.ring svg')
        if (ring) {
          var pct = Math.min(100, Math.round(avgWatch / 15 * 100))
          var circumference = 2 * Math.PI * 22
          var offset = circumference - (pct / 100 * circumference)
          var accentCircle = ring.querySelectorAll('circle')[1]
          if (accentCircle) {
            accentCircle.setAttribute('stroke-dasharray', circumference.toFixed(1))
            accentCircle.setAttribute('stroke-dashoffset', offset.toFixed(1))
          }
          var text = ring.querySelector('text')
          if (text) text.textContent = avgWatch.toFixed(1) + 's'
        }
        // Ring label — show best and worst performing Reel
        var ringLabel = document.getElementById('watch-ring-label')
        if (ringLabel && reels.length > 0) {
          var sorted = reels.slice().sort(function(a,b) { return b.avgWatchTimeMs - a.avgWatchTimeMs })
          var best = sorted[0]
          var worst = sorted[sorted.length - 1]
          var bestTime = (best.avgWatchTimeMs / 1000).toFixed(1)
          var worstTime = (worst.avgWatchTimeMs / 1000).toFixed(1)
          ringLabel.innerHTML = 'Best: ' + bestTime + 's<br/>Lowest: ' + worstTime + 's'
        }
      }
    })
  }

  function populateForecastCharts(S) {
    get('/api/platform/timeseries').then(function (ts) {
      if (!ts) return
      var snaps = ts.snapshots || []
      var posts = ts.posts || []

      // ═══ 1. FOLLOWER GROWTH FORECAST (Exponential Smoothing) ═══
      var forecastEl = document.getElementById('forecast-chart')
      var milestonesEl = document.getElementById('forecast-milestones')
      if (forecastEl && snaps.length >= 2) {
        // Group snapshots by date → total followers (sum all accounts per day)
        // IMPORTANT: only use days where ALL accounts reported, to avoid
        // mixing partial days (e.g. only TikTok at 819) with full days (7129)
        var byDateAccounts = {}
        snaps.forEach(function(s) {
          var d = s.capturedAt.slice(0, 10)
          if (!byDateAccounts[d]) byDateAccounts[d] = { total: 0, count: 0 }
          byDateAccounts[d].total += s.followerCount
          byDateAccounts[d].count++
        })
        // Find the most common account count per day (expected number of accounts)
        var countFreq = {}
        Object.values(byDateAccounts).forEach(function(v) { countFreq[v.count] = (countFreq[v.count] || 0) + 1 })
        var expectedCount = Object.entries(countFreq).sort(function(a,b) { return b[1] - a[1] })[0]
        expectedCount = expectedCount ? parseInt(expectedCount[0]) : 1

        // Only use days with the expected number of accounts
        var byDate = {}
        Object.keys(byDateAccounts).forEach(function(d) {
          if (byDateAccounts[d].count >= expectedCount) {
            byDate[d] = byDateAccounts[d].total
          }
        })
        var dates = Object.keys(byDate).sort()
        var values = dates.map(function(d) { return byDate[d] })

        if (values.length < 2) return // not enough clean data

        // Double exponential smoothing (Holt's method)
        var alpha = 0.3
        var beta = 0.2
        var level = values[0]
        var trend = values.length > 1 ? (values[1] - values[0]) : 0
        var smoothed = [level]
        for (var si = 1; si < values.length; si++) {
          var prevLevel = level
          level = alpha * values[si] + (1 - alpha) * (prevLevel + trend)
          trend = beta * (level - prevLevel) + (1 - beta) * trend
          smoothed.push(level)
        }

        var first = values[0]
        var last = values[values.length - 1]

        // Project 30 days using the smoothed trend
        var projected = []
        for (var i = 1; i <= 30; i++) {
          projected.push(Math.round(level + trend * i))
        }
        var rate = trend // daily rate from smoothed model

        // Draw SVG
        var allVals = values.concat(projected)
        var minV = Math.min.apply(null, allVals) * 0.98
        var maxV = Math.max.apply(null, allVals) * 1.02
        var w = 500, h = 160, pad = 30
        var totalPts = allVals.length
        var xScale = function(i) { return pad + (i / (totalPts - 1)) * (w - pad * 2) }
        var yScale = function(v) { return h - pad - ((v - minV) / (maxV - minV)) * (h - pad * 2) }

        // Actual line
        var actualPath = values.map(function(v, i) { return (i === 0 ? 'M' : 'L') + xScale(i).toFixed(1) + ',' + yScale(v).toFixed(1) }).join(' ')
        // Projected line (dotted)
        var projPath = 'M' + xScale(values.length - 1).toFixed(1) + ',' + yScale(last).toFixed(1)
        projected.forEach(function(v, i) { projPath += ' L' + xScale(values.length + i).toFixed(1) + ',' + yScale(v).toFixed(1) })

        // Grid lines
        var gridLines = ''
        for (var g = 0; g < 4; g++) {
          var gy = pad + g * (h - pad * 2) / 3
          var gv = maxV - g * (maxV - minV) / 3
          gridLines += '<line x1="' + pad + '" y1="' + gy + '" x2="' + (w - pad) + '" y2="' + gy + '" stroke="var(--b1)" stroke-dasharray="2 3"/>'
          gridLines += '<text x="' + (pad - 4) + '" y="' + (gy + 3) + '" text-anchor="end" fill="var(--t3)" font-family="JetBrains Mono" font-size="9">' + fmt(Math.round(gv)) + '</text>'
        }

        // Divider line between actual and projected
        var divX = xScale(values.length - 1)

        forecastEl.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" style="width:100%;height:100%">' +
          gridLines +
          '<line x1="' + divX + '" y1="' + pad + '" x2="' + divX + '" y2="' + (h - pad) + '" stroke="var(--b2)" stroke-dasharray="4 4"/>' +
          '<text x="' + (divX + 4) + '" y="' + (pad + 10) + '" fill="var(--t3)" font-family="Inter" font-size="9">FORECAST</text>' +
          '<path d="' + actualPath + '" fill="none" stroke="var(--t1)" stroke-width="2"/>' +
          '<path d="' + projPath + '" fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="4 3"/>' +
          '<circle cx="' + xScale(0) + '" cy="' + yScale(first) + '" r="3" fill="var(--t1)"/>' +
          '<circle cx="' + xScale(values.length - 1) + '" cy="' + yScale(last) + '" r="4" fill="var(--t1)"/>' +
          '<text x="' + xScale(values.length - 1) + '" y="' + (yScale(last) - 10) + '" text-anchor="middle" fill="var(--t1)" font-family="JetBrains Mono" font-size="10" font-weight="600">' + fmt(last) + ' now</text>' +
          '<circle cx="' + xScale(totalPts - 1) + '" cy="' + yScale(projected[projected.length - 1]) + '" r="4" fill="var(--accent)"/>' +
          '<text x="' + xScale(totalPts - 1) + '" y="' + (yScale(projected[projected.length - 1]) - 10) + '" text-anchor="middle" fill="var(--accent)" font-family="JetBrains Mono" font-size="10" font-weight="600">' + fmt(projected[projected.length - 1]) + '</text>' +
        '</svg>'

        // Summary + milestones in plain language
        if (milestonesEl) {
          var p30 = Math.round(last + rate * 30)
          var p60 = Math.round(last + rate * 60)
          var p90 = Math.round(last + rate * 90)
          var next1k = Math.ceil(last / 1000) * 1000
          var daysTo1k = rate > 0 ? Math.ceil((next1k - last) / rate) : 0
          var dailyRate = rate > 0 ? '+' + rate.toFixed(1) : rate.toFixed(1)
          var direction = rate > 1 ? 'growing steadily' : rate > 0 ? 'growing slowly' : rate === 0 ? 'flat' : 'declining'

          var summaryHtml = '<div style="font-family:Inter,sans-serif;font-size:12px;color:var(--t1);line-height:1.55;margin-bottom:10px">' +
            'You have <strong>' + fmt(last) + ' followers</strong> and you\'re ' + direction + ' at about <strong>' + dailyRate + ' per day</strong>. ' +
            'At this pace, you\'ll reach <strong>' + fmt(p30) + '</strong> in 30 days and <strong>' + fmt(p90) + '</strong> in 90 days.' +
            (daysTo1k > 0 && daysTo1k < 365 ? ' You\'ll hit <strong>' + fmt(next1k) + '</strong> in about <strong>' + daysTo1k + ' days</strong>.' : '') +
          '</div>'

          var milestonesHtml = '<div style="display:flex;gap:16px;font-family:\'JetBrains Mono\',monospace;font-size:10px;color:var(--t3)">' +
            '<span>+30d: <span style="color:var(--t1)">' + fmt(p30) + '</span></span>' +
            '<span>+60d: <span style="color:var(--t1)">' + fmt(p60) + '</span></span>' +
            '<span>+90d: <span style="color:var(--t1)">' + fmt(p90) + '</span></span>' +
          '</div>'

          milestonesEl.innerHTML = summaryHtml + milestonesHtml

          // Fetch Bedrock narrative forecast
          get('/api/platform/forecast').then(function(f) {
            if (f && f.forecast) {
              milestonesEl.innerHTML += '<div style="margin-top:10px;padding:10px 12px;background:var(--s2);border-radius:8px;border-left:2px solid var(--accent);font-family:Inter,sans-serif;font-size:11px;color:var(--t2);line-height:1.5"><span style="font-weight:600;color:var(--t1)">Maya\'s take:</span> ' + esc(f.forecast) + '</div>'
            }
          })
        }
      }

      // ═══ 2. BEST TIME TO POST HEATMAP ═══
      var heatmapEl = document.getElementById('heatmap-chart')
      if (heatmapEl && posts.length > 0) {
        var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        var hours = [6, 8, 10, 12, 14, 16, 18, 20, 22] // relevant posting hours
        var grid = {} // 'dow-hour' → [engRates]
        posts.forEach(function(p) {
          if (!p.publishedAt || !p.engagementRate || p.engagementRate >= 1) return // >= 1 filters out 100% bad data
          var dt = new Date(p.publishedAt)
          var dow = dt.getUTCDay()
          var hr = dt.getUTCHours()
          // Bucket to nearest even hour
          var bucket = hours.reduce(function(prev, curr) { return Math.abs(curr - hr) < Math.abs(prev - hr) ? curr : prev })
          var key = dow + '-' + bucket
          if (!grid[key]) grid[key] = []
          grid[key].push(p.engagementRate)
        })

        // Find max for color scaling
        var maxEng = 0
        Object.values(grid).forEach(function(arr) {
          var avg = arr.reduce(function(s,v){return s+v},0) / arr.length
          if (avg > maxEng) maxEng = avg
        })

        var cellW = 36, cellH = 24, padL = 32, padT = 20
        var svgW = padL + hours.length * cellW + 10
        var svgH = padT + 7 * cellH + 10
        var bestSlot = null, bestAvg = 0

        var cells = ''
        for (var dow = 0; dow < 7; dow++) {
          cells += '<text x="' + (padL - 4) + '" y="' + (padT + dow * cellH + cellH / 2 + 3) + '" text-anchor="end" fill="var(--t3)" font-family="JetBrains Mono" font-size="9">' + dayNames[dow] + '</text>'
          for (var hi = 0; hi < hours.length; hi++) {
            var key = dow + '-' + hours[hi]
            var arr = grid[key] || []
            var avg = arr.length > 0 ? arr.reduce(function(s,v){return s+v},0) / arr.length : 0
            var opacity = maxEng > 0 ? Math.max(0.05, avg / maxEng) : 0.05
            // Only consider slots with 2+ posts as "best" to avoid flukes
            if (avg > bestAvg && arr.length >= 2) { bestAvg = avg; bestSlot = dayNames[dow] + ' ' + hours[hi] + ':00' }
            cells += '<rect x="' + (padL + hi * cellW) + '" y="' + (padT + dow * cellH) + '" width="' + (cellW - 2) + '" height="' + (cellH - 2) + '" rx="3" fill="var(--accent)" opacity="' + opacity.toFixed(2) + '"/>'
            if (arr.length > 0) {
              cells += '<text x="' + (padL + hi * cellW + cellW / 2 - 1) + '" y="' + (padT + dow * cellH + cellH / 2 + 3) + '" text-anchor="middle" fill="var(--t1)" font-family="JetBrains Mono" font-size="8" opacity="' + (opacity > 0.3 ? 1 : 0.5) + '">' + arr.length + '</text>'
            }
          }
        }
        // Hour labels
        for (var hi = 0; hi < hours.length; hi++) {
          var hr12 = hours[hi] > 12 ? (hours[hi] - 12) + 'p' : hours[hi] + 'a'
          cells += '<text x="' + (padL + hi * cellW + cellW / 2 - 1) + '" y="' + (padT - 6) + '" text-anchor="middle" fill="var(--t3)" font-family="JetBrains Mono" font-size="8">' + hr12 + '</text>'
        }

        // Count total posts tracked
        var totalTracked = 0
        Object.values(grid).forEach(function(arr) { totalTracked += arr.length })

        heatmapEl.innerHTML = '<div style="font-family:Inter,sans-serif;font-size:11px;color:var(--t2);line-height:1.5;margin-bottom:8px">' +
          'Darker squares = higher engagement. Numbers show how many posts you\'ve published in that slot.' +
          (bestSlot ? ' Your best performing slot is <strong style="color:var(--accent)">' + bestSlot + '</strong>.' : '') +
        '</div>' +
        '<svg viewBox="0 0 ' + svgW + ' ' + svgH + '" style="width:100%;height:100%">' + cells + '</svg>'
      }

      // ═══ 3. CORRELATION ANALYSIS ═══
      var corrEl = document.getElementById('correlation-chart')
      var corrInsight = document.getElementById('correlation-insight')
      if (corrEl && posts.length >= 5) {
        // Pearson correlation helper
        function pearson(x, y) {
          var n = x.length
          if (n < 3) return 0
          var mx = x.reduce(function(s,v){return s+v},0) / n
          var my = y.reduce(function(s,v){return s+v},0) / n
          var sx = Math.sqrt(x.reduce(function(s,v){return s+(v-mx)*(v-mx)},0) / n)
          var sy = Math.sqrt(y.reduce(function(s,v){return s+(v-my)*(v-my)},0) / n)
          if (sx === 0 || sy === 0) return 0
          return x.reduce(function(s,v,i){return s+(v-mx)*(y[i]-my)},0) / (n * sx * sy)
        }

        var validPosts = posts.filter(function(p) { return p.publishedAt && p.likeCount > 0 })
        var likes = validPosts.map(function(p) { return p.likeCount })
        var views = validPosts.map(function(p) { return p.viewCount || p.reachCount || 0 })

        // Compute correlations
        var factors = [
          {
            label: 'Views / Reach',
            tip: 'More people seeing your post = more likes',
            r: pearson(validPosts.map(function(p){return p.viewCount||p.reachCount||0}), likes)
          },
          {
            label: 'Comments',
            tip: 'Posts that spark conversation also get more likes',
            r: pearson(validPosts.map(function(p){return p.commentCount||0}), likes)
          },
          {
            label: 'Caption length',
            tip: 'Longer captions with storytelling tend to drive more engagement',
            r: pearson(validPosts.map(function(p){return (p.caption||'').length}), likes)
          },
          {
            label: 'Shares',
            tip: 'Content people share also gets liked more — shareability drives everything',
            r: pearson(validPosts.map(function(p){return p.shareCount||0}), likes)
          },
          {
            label: 'Saves',
            tip: 'Save-worthy content (tips, lists) correlates with likes',
            r: pearson(validPosts.map(function(p){return p.saveCount||0}), likes)
          },
          {
            label: 'Watch time',
            tip: 'How long people watch your Reels before scrolling',
            r: pearson(validPosts.map(function(p){return p.avgWatchTimeMs||0}), likes)
          },
          {
            label: 'Time of day',
            tip: 'What hour you post — does timing matter for your audience?',
            r: pearson(validPosts.map(function(p){return new Date(p.publishedAt).getUTCHours()}), likes)
          },
        ].sort(function(a,b) { return Math.abs(b.r) - Math.abs(a.r) })

        // Format breakdown
        var formatMap = {}
        validPosts.forEach(function(p) {
          var f = p.mediaType || '?'
          if (!formatMap[f]) formatMap[f] = { total: 0, count: 0 }
          formatMap[f].total += p.likeCount
          formatMap[f].count++
        })
        var formatRanking = Object.keys(formatMap).map(function(f) {
          return { format: f, avg: Math.round(formatMap[f].total / formatMap[f].count), count: formatMap[f].count }
        }).sort(function(a,b) { return b.avg - a.avg })

        // Draw horizontal bar chart
        var maxR = Math.max.apply(null, factors.map(function(f) { return Math.abs(f.r) }))
        var barH = 28, gap = 6, padL = 110, padR = 60
        var w = 500, h = factors.length * (barH + gap) + 20
        var bars = factors.map(function(f, i) {
          var y = i * (barH + gap) + 10
          var barW = maxR > 0 ? (Math.abs(f.r) / maxR) * (w - padL - padR) : 0
          var isPositive = f.r >= 0
          var color = isPositive ? 'var(--accent)' : 'var(--down, #c76a6a)'
          var strength = Math.abs(f.r) > 0.5 ? 'Strong' : Math.abs(f.r) > 0.2 ? 'Moderate' : 'Weak'
          var opacity = Math.max(0.3, Math.abs(f.r))

          return '<text x="' + (padL - 8) + '" y="' + (y + barH/2 + 4) + '" text-anchor="end" fill="var(--t1)" font-family="Inter" font-size="11">' + f.label + '</text>' +
            '<rect x="' + padL + '" y="' + y + '" width="' + barW + '" height="' + barH + '" rx="4" fill="' + color + '" opacity="' + opacity.toFixed(2) + '"/>' +
            '<text x="' + (padL + barW + 6) + '" y="' + (y + barH/2 + 4) + '" fill="var(--t3)" font-family="JetBrains Mono" font-size="9">' + strength + '</text>'
        }).join('')

        corrEl.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" style="width:100%;height:100%">' + bars + '</svg>'

        // Insight
        if (corrInsight) {
          var top = factors[0]
          var topFormat = formatRanking[0]
          corrInsight.innerHTML = '<div style="font-family:Inter,sans-serif;font-size:12px;color:var(--t1);line-height:1.55;margin-bottom:8px">' +
            'Your biggest driver of likes is <strong>' + top.label.toLowerCase() + '</strong> — ' + top.tip.charAt(0).toLowerCase() + top.tip.slice(1) + ' ' +
            (topFormat ? '<strong>' + topFormat.format + '</strong> posts perform best, averaging <strong>' + fmt(topFormat.avg) + ' likes</strong> per post.' : '') +
          '</div>' +
          '<div style="display:flex;gap:12px;flex-wrap:wrap">' +
            formatRanking.map(function(f) {
              return '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:var(--t3);border:1px solid var(--b1);padding:4px 8px;border-radius:4px">' +
                f.format + ' <span style="color:var(--t1)">' + fmt(f.avg) + '</span> avg · ' + f.count + ' posts</div>'
            }).join('') +
          '</div>'
        }
      }

      // ═══ 4. MAYA'S PLAYBOOK ═══
      var playbookEl = document.getElementById('maya-playbook')
      if (playbookEl && posts.length >= 5) {
        var validPB = posts.filter(function(p) { return p.publishedAt && p.engagementRate > 0 && p.engagementRate < 1 })

        // Best format
        var fmtMap = {}
        validPB.forEach(function(p) {
          var f = p.mediaType || '?'
          if (!fmtMap[f]) fmtMap[f] = { total: 0, count: 0 }
          fmtMap[f].total += p.likeCount || 0
          fmtMap[f].count++
        })
        var bestFmt = Object.entries(fmtMap).sort(function(a,b) { return (b[1].total/b[1].count) - (a[1].total/a[1].count) })[0]
        var bestFmtName = bestFmt ? bestFmt[0].replace('CAROUSEL_ALBUM','Carousels').replace('REEL','Reels').replace('VIDEO','Videos').replace('IMAGE','Photos') : 'content'
        var bestFmtAvg = bestFmt ? Math.round(bestFmt[1].total / bestFmt[1].count) : 0

        // Best time (2+ posts minimum)
        var dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
        var timeGrid = {}
        validPB.forEach(function(p) {
          var dt = new Date(p.publishedAt)
          var dow = dt.getUTCDay()
          var hr = dt.getUTCHours()
          var bucket = [6,8,10,12,14,16,18,20,22].reduce(function(prev,curr) { return Math.abs(curr-hr) < Math.abs(prev-hr) ? curr : prev })
          var key = dow + '-' + bucket
          if (!timeGrid[key]) timeGrid[key] = { rates: [], dow: dow, hr: bucket }
          timeGrid[key].rates.push(p.engagementRate)
        })
        var bestTime = null
        var bestTimeAvg = 0
        Object.values(timeGrid).forEach(function(slot) {
          if (slot.rates.length < 2) return
          var avg = slot.rates.reduce(function(s,v){return s+v},0) / slot.rates.length
          if (avg > bestTimeAvg) { bestTimeAvg = avg; bestTime = slot }
        })
        var bestTimeStr = bestTime ? dayNames[bestTime.dow] + 's around ' + (bestTime.hr > 12 ? (bestTime.hr - 12) + 'pm' : bestTime.hr + 'am') : null

        // Top driver (correlation)
        function pbPearson(x, y) {
          var n = x.length; if (n < 3) return 0
          var mx = x.reduce(function(s,v){return s+v},0)/n, my = y.reduce(function(s,v){return s+v},0)/n
          var sx = Math.sqrt(x.reduce(function(s,v){return s+(v-mx)*(v-mx)},0)/n)
          var sy = Math.sqrt(y.reduce(function(s,v){return s+(v-my)*(v-my)},0)/n)
          if (sx===0||sy===0) return 0
          return x.reduce(function(s,v,i){return s+(v-mx)*(y[i]-my)},0)/(n*sx*sy)
        }
        var pbLikes = validPB.map(function(p){return p.likeCount})
        var drivers = [
          { name: 'views and reach', r: Math.abs(pbPearson(validPB.map(function(p){return p.viewCount||p.reachCount||0}), pbLikes)) },
          { name: 'comments and conversation', r: Math.abs(pbPearson(validPB.map(function(p){return p.commentCount||0}), pbLikes)) },
          { name: 'longer captions with storytelling', r: Math.abs(pbPearson(validPB.map(function(p){return (p.caption||'').length}), pbLikes)) },
          { name: 'shares', r: Math.abs(pbPearson(validPB.map(function(p){return p.shareCount||0}), pbLikes)) },
        ].sort(function(a,b){return b.r - a.r})
        var topDriver = drivers[0]

        // Follower growth rate
        var growthRate = 0
        if (snaps.length >= 2) {
          var snapByDate = {}
          snaps.forEach(function(s) {
            var d = s.capturedAt.slice(0,10)
            snapByDate[d] = (snapByDate[d]||0) + s.followerCount
          })
          var snapDates = Object.keys(snapByDate).sort()
          var snapVals = snapDates.map(function(d){return snapByDate[d]})
          // Only use complete days (all accounts)
          var counts = {}
          snaps.forEach(function(s) { var d = s.capturedAt.slice(0,10); counts[d] = (counts[d]||0)+1 })
          var expectedN = Object.values(counts).sort(function(a,b){return b-a})[0] || 1
          var cleanDates = snapDates.filter(function(d){return counts[d] >= expectedN})
          if (cleanDates.length >= 2) {
            var first = snapByDate[cleanDates[0]]
            var last = snapByDate[cleanDates[cleanDates.length - 1]]
            growthRate = (last - first) / (cleanDates.length - 1)
          }
        }

        // Average caption length of top 5 posts
        var topPosts = validPB.slice().sort(function(a,b){return (b.likeCount||0)-(a.likeCount||0)}).slice(0,5)
        var avgTopCaption = Math.round(topPosts.reduce(function(s,p){return s+(p.caption||'').length},0) / topPosts.length)
        var avgAllCaption = Math.round(validPB.reduce(function(s,p){return s+(p.caption||'').length},0) / validPB.length)
        var captionTip = avgTopCaption > avgAllCaption * 1.3 ? 'Your best posts have longer captions — don\'t be afraid to tell a story.' : avgTopCaption < avgAllCaption * 0.7 ? 'Your best posts keep captions short and punchy.' : ''

        // Build the message — Maya speaks as an employee, not a coach
        var lines = []
        lines.push('I\'ve been looking at your numbers. <strong>' + bestFmtName + '</strong>' + (bestTimeStr ? ' posted on <strong>' + bestTimeStr + '</strong>' : '') + ' are your strongest combo — averaging <strong>' + fmt(bestFmtAvg) + ' likes</strong> per post. I\'m telling Jordan to prioritize that format in your next content plan.')
        if (topDriver) lines.push('The data shows <strong>' + topDriver.name + '</strong> is what drives your likes the most. I\'ve flagged this for Alex so the hooks and captions are optimized around it.')
        if (captionTip) {
          var ct = avgTopCaption > avgAllCaption * 1.3
            ? 'Your top posts have longer captions. I\'ve noted this as a preference — Alex will write with more depth going forward.'
            : 'Your best performers keep captions short. I\'ve let Alex know to keep copy tight and punchy.'
          lines.push(ct)
        }
        if (growthRate > 0) lines.push('You\'re gaining about <strong>' + growthRate.toFixed(0) + ' followers per day</strong>. I\'m tracking this and will flag if the trend changes. Jordan is building the next plan around maintaining this momentum.')
        else if (growthRate === 0) lines.push('Growth has been flat recently. I\'m looking into what changed and will brief Jordan on adjustments. We may need to increase posting frequency or test a new format.')

        // Try Bedrock-generated playbook first, fall back to templated version
        get('/api/platform/maya-playbook').then(function(pb) {
          if (pb && pb.message) {
            // Use the AI-generated message
            playbookEl.innerHTML = '<p style="margin:0;padding-left:10px;border-left:2px solid var(--accent)">' + esc(pb.message) + '</p>' +
              '<div style="font-family:\'JetBrains Mono\',monospace;font-size:9px;color:var(--t3);margin-top:8px">Updated ' + (pb.generatedAt ? new Date(pb.generatedAt).toLocaleDateString() : 'today') + '</div>'
          } else {
            // Fall back to templated version
            playbookEl.innerHTML = lines.map(function(l) {
              return '<p style="margin:0 0 10px;padding-left:10px;border-left:2px solid var(--accent)">' + l + '</p>'
            }).join('')
          }
        })
      }

      // ═══ 5. LIKES FORECAST ═══
      var likesEl = document.getElementById('likes-forecast-chart')
      var likesInsight = document.getElementById('likes-forecast-insight')
      if (likesEl && posts.length > 0) {
        // Build cumulative likes timeline from posts sorted by publish date
        var sorted = posts.filter(function(p) { return p.publishedAt && p.likeCount >= 0 })
          .sort(function(a,b) { return new Date(a.publishedAt) - new Date(b.publishedAt) })
        if (sorted.length < 2) return

        // Group by month for a cleaner chart
        var byMonth = {}
        var runningTotal = 0
        sorted.forEach(function(p) {
          var month = p.publishedAt.slice(0, 7) // YYYY-MM
          runningTotal += (p.likeCount || 0)
          byMonth[month] = runningTotal
        })
        var months = Object.keys(byMonth).sort()
        var cumValues = months.map(function(m) { return byMonth[m] })
        if (cumValues.length < 2) return // need at least 2 months for a chart

        // Also build per-post likes for rate calculation
        var likesPerPost = sorted.map(function(p) { return p.likeCount || 0 })

        // Holt's double exponential smoothing on cumulative likes
        var alpha = 0.4, beta = 0.2
        var level = cumValues[0]
        var trend = cumValues.length > 1 ? (cumValues[1] - cumValues[0]) : 0
        for (var si = 1; si < cumValues.length; si++) {
          var prevLevel = level
          level = alpha * cumValues[si] + (1 - alpha) * (prevLevel + trend)
          trend = beta * (level - prevLevel) + (1 - beta) * trend
        }

        // Project 3 months forward
        var projMonths = 3
        var projected = []
        for (var i = 1; i <= projMonths; i++) {
          projected.push(Math.round(level + trend * i))
        }

        var totalLikes = cumValues[cumValues.length - 1]
        var avgPerPost = Math.round(totalLikes / sorted.length)

        // Draw SVG
        var allVals = cumValues.concat(projected)
        var minV = 0
        var maxV = Math.max.apply(null, allVals) * 1.05
        var w = 500, h = 200, pad = 40
        var totalPts = allVals.length
        var xScale = function(i) { return pad + (i / (totalPts - 1)) * (w - pad * 2) }
        var yScale = function(v) { return h - pad - ((v - minV) / (maxV - minV)) * (h - pad * 2) }

        // Grid lines
        var gridLines = ''
        for (var g = 0; g <= 4; g++) {
          var gy = pad + g * (h - pad * 2) / 4
          var gv = maxV - g * (maxV - minV) / 4
          gridLines += '<line x1="' + pad + '" y1="' + gy + '" x2="' + (w - pad) + '" y2="' + gy + '" stroke="var(--b1)" stroke-dasharray="2 3"/>'
          gridLines += '<text x="' + (pad - 4) + '" y="' + (gy + 3) + '" text-anchor="end" fill="var(--t3)" font-family="JetBrains Mono" font-size="9">' + fmt(Math.round(gv)) + '</text>'
        }

        // Actual line + fill
        var actualPath = cumValues.map(function(v, i) { return (i === 0 ? 'M' : 'L') + xScale(i).toFixed(1) + ',' + yScale(v).toFixed(1) }).join(' ')
        var fillPath = actualPath + ' L' + xScale(cumValues.length - 1).toFixed(1) + ',' + (h - pad) + ' L' + xScale(0).toFixed(1) + ',' + (h - pad) + ' Z'

        // Projected line (dotted)
        var projPath = 'M' + xScale(cumValues.length - 1).toFixed(1) + ',' + yScale(totalLikes).toFixed(1)
        projected.forEach(function(v, i) { projPath += ' L' + xScale(cumValues.length + i).toFixed(1) + ',' + yScale(v).toFixed(1) })

        // Divider
        var divX = xScale(cumValues.length - 1)

        // Month labels
        var monthLabels = ''
        months.forEach(function(m, i) {
          var shortMonth = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m.slice(5)) - 1] || m.slice(5)
          if (i % Math.max(1, Math.floor(months.length / 6)) === 0 || i === months.length - 1) {
            monthLabels += '<text x="' + xScale(i) + '" y="' + (h - pad + 16) + '" text-anchor="middle" fill="var(--t3)" font-family="JetBrains Mono" font-size="8">' + shortMonth + '</text>'
          }
        })

        likesEl.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" style="width:100%;height:100%">' +
          gridLines + monthLabels +
          '<path d="' + fillPath + '" fill="var(--accent)" opacity=".08"/>' +
          '<line x1="' + divX + '" y1="' + pad + '" x2="' + divX + '" y2="' + (h - pad) + '" stroke="var(--b2)" stroke-dasharray="4 4"/>' +
          '<text x="' + (divX + 4) + '" y="' + (pad + 10) + '" fill="var(--t3)" font-family="Inter" font-size="9">FORECAST</text>' +
          '<path d="' + actualPath + '" fill="none" stroke="var(--accent)" stroke-width="2"/>' +
          '<path d="' + projPath + '" fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="4 3" opacity=".6"/>' +
          '<circle cx="' + xScale(cumValues.length - 1) + '" cy="' + yScale(totalLikes) + '" r="4" fill="var(--accent)"/>' +
          '<text x="' + xScale(cumValues.length - 1) + '" y="' + (yScale(totalLikes) - 10) + '" text-anchor="middle" fill="var(--t1)" font-family="JetBrains Mono" font-size="10" font-weight="600">' + fmt(totalLikes) + ' now</text>' +
          '<circle cx="' + xScale(totalPts - 1) + '" cy="' + yScale(projected[projected.length - 1]) + '" r="4" fill="var(--accent)" opacity=".6"/>' +
          '<text x="' + xScale(totalPts - 1) + '" y="' + (yScale(projected[projected.length - 1]) - 10) + '" text-anchor="middle" fill="var(--accent)" font-family="JetBrains Mono" font-size="10">' + fmt(projected[projected.length - 1]) + '</text>' +
        '</svg>'

        // Insight
        if (likesInsight) {
          var monthlyRate = trend > 0 ? Math.round(trend) : 0
          var proj3m = projected[projected.length - 1]
          var direction = trend > 50 ? 'accelerating' : trend > 0 ? 'growing steadily' : 'slowing down'

          likesInsight.innerHTML = '<div style="font-family:Inter,sans-serif;font-size:12px;color:var(--t1);line-height:1.55;margin-bottom:6px">' +
            'You have <strong>' + fmt(totalLikes) + ' total likes</strong> across ' + sorted.length + ' posts, averaging <strong>' + fmt(avgPerPost) + ' likes per post</strong>. ' +
            'Your likes are ' + direction + ' — at this pace you\'ll reach <strong>' + fmt(proj3m) + ' total likes</strong> in 3 months.' +
          '</div>' +
          '<div style="display:flex;gap:16px;font-family:\'JetBrains Mono\',monospace;font-size:10px;color:var(--t3)">' +
            '<span>Now: <span style="color:var(--t1)">' + fmt(totalLikes) + '</span></span>' +
            '<span>+1m: <span style="color:var(--t1)">' + fmt(Math.round(level + trend)) + '</span></span>' +
            '<span>+3m: <span style="color:var(--t1)">' + fmt(proj3m) + '</span></span>' +
            '<span>Avg/post: <span style="color:var(--accent)">' + fmt(avgPerPost) + '</span></span>' +
          '</div>'
        }
      }
    })
  }

  function populatePostsTable(S) {
    // Fetch timeseries for real post data
    console.log('[hq-data] populatePostsTable called')
    get('/api/platform/timeseries').then(function (ts) {
      console.log('[hq-data] timeseries response:', ts ? ts.posts?.length + ' posts' : 'null')
      if (!ts || !ts.posts || ts.posts.length === 0) return

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

      // Sort by date for initial display, store for tab filtering
      var sorted = ts.posts.slice().sort(function(a,b){ return new Date(b.publishedAt||0) - new Date(a.publishedAt||0) })

      // Populate the posts table via the tab-aware renderer
      populateSidebarPosts(sorted, acctMap)
    })
  }

  var allPostsCache = null
  var acctMapCache = null
  var currentSort = null // { key: 'views'|'likes'|'eng'|'ret', asc: false }

  function populateSidebarPosts(posts, acctMap) {
    console.log('[hq-data] populateSidebarPosts:', posts.length, 'posts')
    allPostsCache = posts
    acctMapCache = acctMap
    var postsCard = document.querySelector('#view-db-dashboard .dash-side .posts-card') || document.querySelector('#view-db-dashboard .posts-card')
    console.log('[hq-data] postsCard found:', !!postsCard)
    if (!postsCard) return
    var ph = postsCard.querySelector('.ph h4')
    if (ph) ph.innerHTML = 'Recent <em>posts</em>'

    // Wire tab clicks — swap active tab label with header
    var tabs = postsCard.querySelectorAll('.ph .f span')
    var originalLabels = Array.from(tabs).map(function(t) { return t.textContent.trim() })
    tabs.forEach(function(tab, idx) {
      tab.addEventListener('click', function() {
        // Reset all labels to original
        tabs.forEach(function(t, i) { t.textContent = originalLabels[i] })
        // Swap: clicked tab becomes active, first tab becomes "Recent Posts" if not already
        tabs.forEach(function(t) { t.classList.remove('on') })
        var clickedLabel = tab.textContent.trim()
        tab.classList.add('on')
        currentSort = null
        var sortHeaders = postsCard.querySelectorAll('.posts-tbl th.sort')
        sortHeaders.forEach(function(h) { h.classList.remove('active', 'asc') })
        renderPostsTable(clickedLabel)
      })
    })

    // Wire column sort clicks
    var sortHeaders = postsCard.querySelectorAll('.posts-tbl th.sort')
    sortHeaders.forEach(function(th) {
      th.addEventListener('click', function() {
        var key = th.dataset.sort
        var wasActive = th.classList.contains('active')
        var wasAsc = th.classList.contains('asc')
        sortHeaders.forEach(function(h) { h.classList.remove('active', 'asc') })
        th.classList.add('active')
        // Toggle direction if clicking same column
        var ascending = wasActive && !wasAsc
        if (ascending) th.classList.add('asc')
        currentSort = { key: key, asc: ascending }
        // Re-render with current tab filter + new sort
        var activeTab = postsCard.querySelector('.ph .f span.on')
        renderPostsTable(activeTab ? activeTab.textContent.trim() : 'Recent Posts')
      })
    })

    // Initial render
    renderPostsTable('Recent Posts')
  }

  function renderPostsTable(filter) {
    console.log('[hq-data] renderPostsTable START:', filter, 'cache:', allPostsCache?.length)
    if (!allPostsCache) { console.log('[hq-data] EXIT: no cache'); return }
    var tbody = document.querySelector('.dash-side .posts-tbl tbody') || document.querySelector('.posts-tbl tbody')
    if (!tbody) { console.log('[hq-data] EXIT: no tbody'); return }

    try {
    var posts = allPostsCache.slice()
    var acctMap = acctMapCache || {}
    var filterKey = (filter || 'all posts').toLowerCase()
    console.log('[hq-data] filterKey:', filterKey, 'posts before filter:', posts.length)
    if (filterKey === 'instagram' || filterKey === 'ig') {
      posts = posts.filter(function(p) { return acctMap[p.accountId] === 'instagram' })
    } else if (filterKey === 'tiktok' || filterKey === 'tt') {
      posts = posts.filter(function(p) { return acctMap[p.accountId] === 'tiktok' })
    }

    // Sort — column header click overrides tab sort
    if (currentSort) {
      var sortKey = currentSort.key
      var dir = currentSort.asc ? 1 : -1
      posts.sort(function(a, b) {
        var av, bv
        if (sortKey === 'views') { av = a.viewCount || a.reachCount || 0; bv = b.viewCount || b.reachCount || 0 }
        else if (sortKey === 'likes') { av = a.likeCount || 0; bv = b.likeCount || 0 }
        else if (sortKey === 'eng') { av = a.engagementRate || 0; bv = b.engagementRate || 0 }
        else if (sortKey === 'ret') { av = a.avgWatchTimeMs || 0; bv = b.avgWatchTimeMs || 0 }
        else { av = 0; bv = 0 }
        return (bv - av) * dir
      })
    } else if (filterKey === 'top engagement' || filterKey === 'top eng') {
      posts.sort(function(a, b) { return (b.engagementRate || 0) - (a.engagementRate || 0) })
    } else if (filterKey === 'top views') {
      posts.sort(function(a, b) { return (b.viewCount || b.reachCount || 0) - (a.viewCount || a.reachCount || 0) })
    } else {
      posts.sort(function(a, b) { return new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0) })
    }

    var display = posts.slice(0, 20)
    var avgEng = posts.length > 0 ? posts.reduce(function(s, x) { return s + (x.engagementRate || 0) }, 0) / posts.length : 0
    console.log('[hq-data] rendering', display.length, 'rows into tbody')

    // Update header
    var ph = document.querySelector('#view-db-dashboard .posts-card .ph h4')
    if (ph) {
      var labelMap = {
        'recent posts': 'Recent',
        'all posts': 'Recent',
        'instagram': 'Instagram',
        'tiktok': 'TikTok',
        'top views': 'Top by views',
        'top engagement': 'Top engagement',
      }
      var label = labelMap[filterKey] || 'Recent'
      ph.innerHTML = label + ' <em>posts</em>'
    }

    tbody.innerHTML = display.map(function(p) {
      var platform = acctMap[p.accountId] || 'instagram'
      var pf = platform === 'tiktok' ? 'tt' : platform === 'youtube' ? 'yt' : 'ig'
      var pfName = platform === 'tiktok' ? 'TIKTOK' : platform === 'youtube' ? 'YOUTUBE' : 'INSTAGRAM'
      var mediaType = (p.mediaType || 'POST').toUpperCase()
      var caption = (p.caption || '').slice(0, 60) || '(no caption)'
      var views = p.viewCount || p.reachCount || p.impressionCount || 0
      var engRate = p.engagementRate || 0
      if (engRate > 1) engRate = engRate / 100
      var eng = (engRate > 0 && engRate < 1) ? (engRate * 100).toFixed(1) + '%' : engRate >= 1 ? engRate.toFixed(1) + '%' : '—'
      var ago = timeAgo(p.publishedAt)
      var thumb = p.thumbnailUrl
      var typeIcon = mediaType === 'REEL' || mediaType === 'VIDEO' ? '▶' : mediaType === 'CAROUSEL_ALBUM' ? '◉' : '✦'
      var thumbHtml = thumb
        ? '<div class="thumb" style="background:url(' + esc(thumb) + ') center/cover;border-radius:6px;border:1px solid var(--b1)"></div>'
        : '<div class="thumb" style="background:var(--s2);color:var(--' + pf + ');font-size:16px;border:1px solid var(--b1);border-radius:6px;display:flex;align-items:center;justify-content:center">' + typeIcon + '</div>'
      return '<tr>'
        + '<td><div class="cell-first">' + thumbHtml
        + '<div><div class="ttl">' + esc(caption) + '</div>'
        + '<div class="meta"><span class="pf ' + pf + '"><span class="dot"></span>' + pfName + ' · ' + mediaType + '</span><span>' + ago + '</span></div></div></div></td>'
        + '<td class="num"><em>' + (views > 0 ? fmt(views) : '—') + '</em></td>'
        + '<td class="num">' + fmt(p.likeCount || 0) + '</td>'
        + '<td class="num">' + eng + '</td>'
        + '</tr>'
    }).join('')
    } catch (err) {
      console.error('[hq-data] renderPostsTable CRASHED:', err.message, err.stack)
    }
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
