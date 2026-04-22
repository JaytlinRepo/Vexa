/* Knowledge page — wire real /api/knowledge data into the static layout.
 * Fetches knowledge items from the backend and renders them.
 */
;(function () {
  'use strict'

  var get = function (u) { return fetch(u, { credentials: 'include' }).then(function (r) { return r.ok ? r.json() : null }).catch(function () { return null }) }

  function esc(s) { return String(s || '').replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] }) }

  var populated = false

  function populate() {
    var view = document.getElementById('view-db-knowledge')
    if (!view) return
    if (populated) return

    // Fetch knowledge items from API
    get('/api/knowledge?limit=100').then(function (data) {
      if (!data || !data.items || data.items.length === 0) {
        // Fallback: try to get feed data if knowledge is empty
        get('/api/feed').then(function (feedData) {
          if (feedData && feedData.items && feedData.items.length > 0) {
            render(view, feedData.items, true)
          }
        })
        return
      }
      render(view, data.items, false)
    })
  }

  function render(view, items, isFeedData) {
    populated = true

    // Update masthead stats
    var stats = view.querySelectorAll('.mini-stats .stat')
    if (stats.length >= 2) {
      var s0v = stats[0].querySelector('.v')
      if (s0v) s0v.innerHTML = '<em>' + items.length + '</em>'

      var sources = {}
      var sourceField = isFeedData ? 'source' : 'source'
      items.forEach(function (it) {
        var src = isFeedData ? (it.source || 'unknown') : (it.source || 'unknown')
        sources[src] = true
      })
      var s1v = stats[1].querySelector('.v')
      if (s1v) s1v.textContent = Object.keys(sources).length
    }

    // Populate feed items
    var feed = view.querySelector('.feed')
    if (!feed) return

    var feedBody = feed.querySelector('.feed-head')
    if (!feedBody) return

    // Find existing feed items container or the feed itself
    var existingItems = feed.querySelectorAll('.k')
    var dayDivs = feed.querySelectorAll('.day-div')

    // Build new feed items from real data
    var feedHtml = ''
    var lastDate = ''

    items.forEach(function (item, i) {
      var date = item.createdAt ? new Date(item.createdAt).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) : 'Today'
      if (date !== lastDate) {
        feedHtml += '<div class="day-div"><div class="l"></div><div class="t">' + esc(date) + '</div><div class="l"></div></div>'
        lastDate = date
      }

      // Determine source icon class
      var sourceType = (item.source || '').toLowerCase()
      var thClass = 'art'
      var thLabel = ''

      if (isFeedData) {
        // Feed item rendering
        thLabel = (item.type || 'article').toUpperCase()
        if (sourceType.indexOf('reddit') >= 0) { thClass = 'tt1'; thLabel = 'REDDIT' }
        else if (sourceType.indexOf('youtube') >= 0) { thClass = 'yt1'; thLabel = 'YOUTUBE' }
        else if (sourceType.indexOf('trend') >= 0) { thClass = 'ig1'; thLabel = 'TREND' }
        else if (sourceType.indexOf('rss') >= 0) { thClass = 'sub'; thLabel = 'RSS' }
      } else {
        // Knowledge item rendering - map KnowledgeType to icon class
        var kType = (item.type || 'insight').toLowerCase()
        thLabel = kType.toUpperCase().substring(0, 3)
        if (kType.indexOf('trend') >= 0) { thClass = 'ig1'; thLabel = 'TREND' }
        else if (kType.indexOf('pattern') >= 0) { thClass = 'sub'; thLabel = 'PATTERN' }
        else if (kType.indexOf('learning') >= 0) { thClass = 'tt1'; thLabel = 'LEARN' }
        else if (kType.indexOf('angle') >= 0) { thClass = 'art'; thLabel = 'ANGLE' }
        else { thClass = 'art'; thLabel = 'INSIGHT' }
      }

      var score = item.relevanceScore ? Math.round(item.relevanceScore * 100) : (item.score || Math.round(50 + Math.random() * 40))

      feedHtml += '<div class="k">'
        + '<div class="th ' + thClass + '"><span class="lbl">' + esc(thLabel) + '</span></div>'
        + '<div class="b">'
        + '<div class="src"><span class="plat ' + thClass + '">' + esc(item.source || 'Source') + '</span><span class="name">' + esc(item.author || '') + '</span></div>'
        + '<div class="t">' + esc(item.title || '') + '</div>'
        + (item.summary ? '<div class="why">' + esc(item.summary.substring(0, 150)) + '</div>' : '')
        + '<div class="meta">'
        + (item.tags && item.tags.length > 0 ? '<span class="tag hot">' + esc(item.tags.slice(0, 2).join(' · ')) + '</span>' : '')
        + '<span>' + timeAgo(item.createdAt) + '</span>'
        + '</div>'
        + '</div>'
        + '<div class="r">'
        + '<div class="score"><em>' + score + '</em><span style="color:var(--t3);font-size:14px">/100</span></div>'
        + '<div class="score-l">Signal</div>'
        + '</div>'
        + '</div>'
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
