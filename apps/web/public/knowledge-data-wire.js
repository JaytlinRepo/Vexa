/* Knowledge page — reels grid + articles rail
 * Fetches /api/feed, splits into videos (grid) and articles (rail).
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

    get('/api/feed').then(function (data) {
      if (!data || !data.items || data.items.length === 0) return
      render(view, data.items, data.source === 'cached')

      // Auto-refresh every 5 minutes
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(function () { populate(true) }, 5 * 60 * 1000)
    })
  }

  function render(view, items, isCached) {
    populated = true

    // Split into 3 columns: images/carousels, videos/reels, articles
    var images = items.filter(function (it) {
      if (it.type !== 'instagram') return false
      var url = (it.imageUrl || it.thumbnail || '').toLowerCase()
      return url && url.indexOf('.mp4') < 0 && url.indexOf('video') < 0
    })
    var reels = items.filter(function (it) {
      if (it.type === 'youtube' || it.type === 'video') return true
      if (it.type === 'instagram') {
        var url = (it.imageUrl || it.thumbnail || '').toLowerCase()
        return url.indexOf('.mp4') >= 0 || url.indexOf('video') >= 0
      }
      return false
    })
    var articles = items.filter(function (it) { return it.type !== 'youtube' && it.type !== 'video' && it.type !== 'instagram' && it.type !== 'reddit' })
    // Reddit goes to articles
    var redditItems = items.filter(function (it) { return it.type === 'reddit' })
    articles = articles.concat(redditItems)

    // Update masthead stats
    var stats = view.querySelectorAll('.mini-stats .stat')
    if (stats.length >= 1) {
      var s0v = stats[0].querySelector('.v')
      if (s0v) s0v.innerHTML = '<em>' + items.length + '</em>'
      var s0d = stats[0].querySelector('.d')
      if (s0d) s0d.textContent = reels.length + ' reels, ' + articles.length + ' articles'
    }
    if (stats.length >= 2) {
      var sources = {}
      items.forEach(function (it) { sources[it.source || 'unknown'] = true })
      var s1v = stats[1].querySelector('.v')
      if (s1v) s1v.textContent = Object.keys(sources).length
      var s1d = stats[1].querySelector('.d')
      if (s1d) s1d.textContent = 'active sources'
    }
    if (stats.length >= 3) {
      var s2v = stats[2].querySelector('.v')
      if (s2v) s2v.textContent = reels.length + ' Reels'
      var s2d = stats[2].querySelector('.d')
      if (s2d) s2d.textContent = isCached ? 'cached' : 'live'
    }

    // Update feed header
    var feedSub = view.querySelector('.feed-head .sub')
    if (feedSub) {
      feedSub.textContent = items.length + ' items · ' + (isCached ? 'cached' : 'live') + ' · auto-refresh 5m'
    }

    // Render reels grid
    var reelsGrid = document.getElementById('knowledge-reels-grid')
    if (reelsGrid) {
      if (reels.length === 0) {
        reelsGrid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--t3);font-size:13px">No reels found. Check back soon.</div>'
      } else {
        reelsGrid.innerHTML = reels.map(function (item) {
          var url = item.url || ''
          var isIG = item.type === 'instagram'
          var thumb = item.thumbnail || item.imageUrl || ''

          var mediaHtml = ''
          if (isIG && thumb) {
            // Instagram — use direct media URL (image or video)
            var isIGVideo = thumb.indexOf('.mp4') >= 0 || thumb.indexOf('video') >= 0
            if (isIGVideo) {
              mediaHtml = '<video src="' + esc(thumb) + '" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;border-radius:10px 10px 0 0" playsinline muted loop preload="metadata" onmouseenter="this.play()" onmouseleave="this.pause()"></video>'
            } else {
              mediaHtml = '<img src="' + esc(thumb) + '" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;border-radius:10px 10px 0 0" referrerpolicy="no-referrer" crossorigin="anonymous" onerror="this.remove()" />'
            }
          } else if (isIG) {
            // No media URL — fallback to embed
            var igEmbedUrl = url.replace(/\/$/, '') + '/embed/'
            mediaHtml = '<iframe src="' + esc(igEmbedUrl) + '" style="width:100%;height:100%;position:absolute;inset:0;border:none;border-radius:10px 10px 0 0" loading="lazy" scrolling="no"></iframe>'
          } else {
            // YouTube embed
            var vidMatch = url.match(/[?&]v=([^&]+)/) || url.match(/shorts\/([^?&]+)/) || url.match(/youtu\.be\/([^?&]+)/)
            var videoId = vidMatch ? vidMatch[1] : ''
            if (videoId) {
              mediaHtml = '<iframe src="https://www.youtube.com/embed/' + videoId + '" style="width:100%;height:100%;position:absolute;inset:0;border:none;border-radius:10px 10px 0 0" allow="autoplay;encrypted-media" allowfullscreen loading="lazy"></iframe>'
            } else if (thumb) {
              mediaHtml = '<img src="' + esc(thumb) + '" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0" referrerpolicy="no-referrer" onerror="this.remove()" />'
            } else {
              mediaHtml = '<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:32px;color:var(--t3)">▶</div>'
            }
          }

          var platBadge = isIG
            ? '<span class="plat"><span class="d ig"></span>IG</span>'
            : '<span class="plat"><span class="d yt"></span>YT</span>'

          return '<div class="card" data-url="' + esc(url) + '" style="cursor:pointer">'
            + '<div class="th" style="aspect-ratio:' + (isIG ? '4/5' : '9/16') + ';position:relative;background:#000">'
            + mediaHtml
            + platBadge
            + '</div>'
            + '<div class="body" style="padding:10px 12px">'
            + '<div style="font-size:12px;font-weight:500;color:var(--t1);line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + esc(item.title || '') + '</div>'
            + '<div style="font-size:10px;color:var(--t3);margin-top:4px">' + esc(item.source || item.author || '') + '</div>'
            + '</div>'
            + '</div>'
        }).join('')
      }

      // Click to open in new tab
      reelsGrid.addEventListener('click', function (e) {
        var card = e.target.closest('.card[data-url]')
        if (card && card.dataset.url && !e.target.closest('iframe')) {
          window.open(card.dataset.url, '_blank', 'noopener')
        }
      })
    }

    // Render images & carousels column (left)
    var imagesCol = document.getElementById('knowledge-images-col')
    if (imagesCol) {
      if (images.length === 0) {
        imagesCol.innerHTML = '<div style="text-align:center;padding:30px 10px;color:var(--t3);font-size:12px">No images yet</div>'
      } else {
        imagesCol.innerHTML = images.map(function (item) {
          var thumb = item.imageUrl || item.thumbnail || ''
          return '<div data-url="' + esc(item.url || '') + '" style="cursor:pointer;margin-bottom:12px;border-radius:10px;overflow:hidden;border:1px solid var(--b1);background:var(--bg)">'
            + '<div style="position:relative">'
            + (thumb ? '<img src="' + esc(thumb) + '" style="width:100%;aspect-ratio:1/1;object-fit:cover;display:block" referrerpolicy="no-referrer" crossorigin="anonymous" onerror="this.parentElement.parentElement.remove()" />' : '')
            + '<span style="position:absolute;top:8px;left:8px;font-family:Inter,sans-serif;font-weight:500;font-size:9px;letter-spacing:.22em;text-transform:uppercase;padding:3px 8px;border-radius:3px;background:rgba(0,0,0,.55);color:#fff;backdrop-filter:blur(8px);display:inline-flex;align-items:center;gap:5px"><span style="width:5px;height:5px;border-radius:50%;background:var(--ig)"></span>IG</span>'
            + '</div>'
            + '<div style="padding:8px 10px">'
            + '<div style="font-size:11px;color:var(--t1);line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + esc((item.title || '').slice(0, 80)) + '</div>'
            + '<div style="font-size:10px;color:var(--t3);margin-top:3px">' + esc(item.source || '') + '</div>'
            + '</div>'
            + '</div>'
        }).join('')

        imagesCol.addEventListener('click', function (e) {
          var card = e.target.closest('[data-url]')
          if (card && card.dataset.url) window.open(card.dataset.url, '_blank', 'noopener')
        })
      }
    }

    // Render articles rail (right)
    var articlesRail = document.getElementById('knowledge-articles-rail')
    if (articlesRail) {
      if (articles.length === 0) {
        articlesRail.innerHTML = '<div style="text-align:center;padding:20px;color:var(--t3);font-size:12px">No articles found.</div>'
      } else {
        articlesRail.innerHTML = articles.map(function (item) {
          var thumb = item.thumbnail || item.imageUrl || ''
          var score = item.score || Math.round(50 + Math.random() * 30)
          var sourceType = (item.type || 'article').toLowerCase()
          var typeLabel = sourceType === 'reddit' ? 'REDDIT' : 'ARTICLE'
          var typeColor = sourceType === 'reddit' ? 'var(--tt)' : 'var(--accent)'

          return '<a href="' + esc(item.url || '#') + '" target="_blank" rel="noopener" style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--b1);text-decoration:none;color:inherit">'
            + (thumb
              ? '<img src="' + esc(thumb) + '" style="width:64px;height:48px;border-radius:6px;object-fit:cover;flex-shrink:0" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'" />'
              : '<div style="width:64px;height:48px;border-radius:6px;background:var(--s2);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-family:\'JetBrains Mono\',monospace;font-size:8px;color:var(--t3);letter-spacing:.08em">' + typeLabel + '</div>'
            )
            + '<div style="flex:1;min-width:0">'
            + '<div style="font-size:12px;font-weight:500;color:var(--t1);line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + esc(item.title || '') + '</div>'
            + '<div style="font-size:10px;color:var(--t3);margin-top:3px;display:flex;gap:6px;align-items:center">'
            + '<span style="color:' + typeColor + '">' + esc(item.source || '') + '</span>'
            + '<span>' + timeAgo(item.createdAt || item.publishedAt) + '</span>'
            + '</div>'
            + '</div>'
            + '</a>'
        }).join('')
      }
    }

    // Update sidebar nav counts
    var navItems = view.querySelectorAll('.nav-item .c')
    if (navItems.length >= 5) {
      navItems[0].textContent = items.length   // All signal
      navItems[1].textContent = reels.length   // Rising (reels)
      navItems[2].textContent = articles.filter(function (a) { return a.score && a.score < 60 }).length // Fading
      navItems[3].textContent = 0              // Competitor
      navItems[4].textContent = 0              // Saved
    }
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

  // Hook into navigation
  var origNav = window.navigate
  window.navigate = function (id) {
    var r = typeof origNav === 'function' ? origNav(id) : undefined
    if (id === 'db-knowledge') setTimeout(populate, 150)
    return r
  }
})()
