/* Knowledge page — wire real /api/feed data into the static layout.
 * Reads from window.__vxDashState.feed (populated by dashboard-v2.js)
 * or fetches directly if not available.
 */
;(function () {
  'use strict'

  var get = function (u) { return fetch(u, { credentials: 'include' }).then(function (r) { return r.ok ? r.json() : null }).catch(function () { return null }) }

  function esc(s) { return String(s || '').replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] }) }

  var populated = false
  var refreshTimer = null

  function populate(force) {
    var view = document.getElementById('view-db-knowledge')
    if (!view) return
    if (populated && !force) return

    var items = (window.__vxDashState && window.__vxDashState.feed) || []
    if (items.length > 0) {
      render(view, items, false)
      scheduleRefresh()
      return
    }

    // Fetch directly
    get('/api/feed').then(function (data) {
      if (!data || !data.items || data.items.length === 0) return
      var isCached = data.source === 'cached'
      render(view, data.items, isCached)
      scheduleRefresh()
    })
  }

  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer)
    // Auto-refresh every 5 minutes
    refreshTimer = setTimeout(function () {
      populate(true)
    }, 5 * 60 * 1000)
  }

  function render(view, items, isCached) {
    populated = true

    // Update masthead stats
    var stats = view.querySelectorAll('.mini-stats .stat')
    if (stats.length >= 2) {
      var s0v = stats[0].querySelector('.v')
      if (s0v) s0v.innerHTML = '<em>' + items.length + '</em>'

      var sources = {}
      items.forEach(function (it) { sources[it.source || 'unknown'] = true })
      var s1v = stats[1].querySelector('.v')
      if (s1v) s1v.textContent = Object.keys(sources).length
    }

    // Count videos (Reels) vs articles
    var videoCount = items.filter(function (it) { return it.type === 'video' }).length
    if (stats.length >= 3) {
      var s2v = stats[2].querySelector('.v')
      if (s2v) s2v.textContent = videoCount + ' Reels'
    }

    // Show cache indicator if needed
    var feedHead = view.querySelector('.feed-head')
    if (feedHead && isCached) {
      var cacheNote = feedHead.querySelector('.cache-note')
      if (!cacheNote) {
        cacheNote = document.createElement('div')
        cacheNote.className = 'cache-note'
        cacheNote.style.cssText = 'font-size:12px; color:var(--t3); margin-top:8px'
        cacheNote.textContent = '(showing cached data — refreshing...)'
        feedHead.appendChild(cacheNote)
      }
    } else if (feedHead) {
      var note = feedHead.querySelector('.cache-note')
      if (note) note.remove()
    }

    // Populate feed items
    var feed = view.querySelector('.feed')
    if (!feed) return

    var feedBody = feed.querySelector('.feed-head')
    if (!feedBody) return

    // Find existing feed items container or the feed itself
    var existingItems = feed.querySelectorAll('.k')
    var dayDivs = feed.querySelectorAll('.day-div')

    // Build new feed items from real data - mix articles and reels
    var feedHtml = ''
    var lastDate = ''

    items.forEach(function (item, i) {
      var date = item.createdAt ? new Date(item.createdAt).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) : 'Today'
      if (date !== lastDate) {
        feedHtml += '<div class="day-div"><div class="l"></div><div class="t">' + esc(date) + '</div><div class="l"></div></div>'
        lastDate = date
      }

      // Use item.type for reliable source classification
      var thClass = 'art'
      var thLabel = (item.type || 'article').toUpperCase()
      if (item.type === 'reddit') { thClass = 'tt1'; thLabel = 'REDDIT' }
      else if (item.type === 'video') { thClass = 'yt1'; thLabel = 'YOUTUBE' }
      else if (item.type === 'trend') { thClass = 'ig1'; thLabel = 'TREND' }
      else if (item.type === 'research') { thClass = 'sub'; thLabel = 'RESEARCH' }

      var score = item.score || Math.round(50 + Math.random() * 40)

      // Render as Reel card if video type
      if (item.type === 'video') {
        feedHtml += '<div class="k k-video">'
          + '<div class="k-video-thumb">'
          + (item.imageUrl ? '<img src="' + esc(item.imageUrl) + '" alt="' + esc(item.title) + '" />' : '<div class="k-video-placeholder"></div>')
          + '<div class="k-video-overlay">'
          + '<div class="k-video-play">▶</div>'
          + '</div>'
          + '</div>'
          + '<div class="k-video-meta">'
          + '<div class="k-video-creator">' + esc(item.source || 'Creator') + '</div>'
          + '<div class="k-video-title">' + esc(item.title || '') + '</div>'
          + '<div class="k-video-stats">'
          + (item.summary ? '<span>' + esc(item.summary.split(' · ')[0] || '') + '</span>' : '')
          + '<span>' + timeAgo(item.createdAt) + '</span>'
          + '</div>'
          + '</div>'
          + '</div>'
      } else {
        // Render as article card (original format)
        feedHtml += '<div class="k">'
          + '<div class="th ' + thClass + '"><span class="lbl">' + esc(thLabel) + '</span></div>'
          + '<div class="b">'
          + '<div class="src"><span class="plat ' + thClass + '">' + esc(item.source || 'Source') + '</span><span class="name">' + esc(item.author || '') + '</span></div>'
          + '<div class="t">' + esc(item.title || '') + '</div>'
          + (item.mayaTake ? '<div class="why"><span class="mk">Maya:</span> ' + esc(item.mayaTake) + '</div>' : '')
          + '<div class="meta">'
          + (item.score ? '<span class="tag hot">Score · ' + item.score + '</span>' : '')
          + '<span>' + timeAgo(item.createdAt) + '</span>'
          + '</div>'
          + '</div>'
          + '<div class="r">'
          + '<div class="score"><em>' + score + '</em><span style="color:var(--t3);font-size:14px">/100</span></div>'
          + '<div class="score-l">Signal</div>'
          + '</div>'
          + '</div>'
      }
    })

    // Remove existing mock items and insert real ones
    existingItems.forEach(function (el) { el.remove() })
    dayDivs.forEach(function (el) { el.remove() })

    // Also remove the synth (Maya synthesis) mock if no real data
    var synth = feed.querySelector('.synth')

    // Insert after synth or after feed-head
    var insertAfter = synth || feedBody
    var temp = document.createElement('div')
    temp.innerHTML = feedHtml
    while (temp.firstChild) {
      insertAfter.parentNode.insertBefore(temp.firstChild, insertAfter.nextSibling)
      insertAfter = insertAfter.nextSibling
    }

    // Update trending sidebar
    populateTrending(view, items)
  }

  function populateTrending(view, items) {
    var ctx = view.querySelector('.ctx')
    if (!ctx) return

    var trendBlock = ctx.querySelector('.ctx-block')
    if (!trendBlock) return

    // Find trend items specifically
    var trends = items.filter(function (it) { return it.type === 'trend' || (it.source || '').toLowerCase().indexOf('trend') >= 0 })
    if (trends.length === 0) return

    var trendEls = trendBlock.querySelectorAll('.trend')
    trends.slice(0, trendEls.length).forEach(function (t, i) {
      if (!trendEls[i]) return
      var nm = trendEls[i].querySelector('.nm')
      if (nm) {
        nm.innerHTML = esc(t.title || t.keyword || '') + '<span class="d">' + esc(t.summary || '') + '</span>'
      }
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

  // Run on navigate to Knowledge
  var origNav = window.navigate
  window.navigate = function (id) {
    var r = typeof origNav === 'function' ? origNav(id) : undefined
    if (id === 'db-knowledge') setTimeout(populate, 150)
    return r
  }
})()
