/* Knowledge page — reels grid + articles rail
 * Fetches /api/feed, splits into videos (grid) and articles (rail).
 */
;(function () {
  'use strict'

  // get() returns the parsed JSON on 2xx, or an error sentinel { __err: status } on
  // non-2xx so callers can distinguish "no data" from "not authed" / server error.
  var get = function (u) {
    return fetch(u, { credentials: 'include' })
      .then(function (r) {
        if (r.ok) return r.json()
        return { __err: r.status }
      })
      .catch(function () { return { __err: 0 } })
  }
  function esc(s) { return String(s || '').replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] }) }

  var populated = false
  var refreshTimer = null
  var clickWired = false      // single-shot delegated click wiring
  var visWired = false        // single-shot visibility listener wiring
  var scrollObserver = null   // IntersectionObserver for infinite scroll
  var loadingMore = false     // guard: don't fire two parallel page-2 requests
  var totalAvailable = 0      // server-reported pool size; we stop paginating at this
  var endOfPool = false       // flips true when offset >= totalAvailable

  var PAGE_SIZE = 25

  function populate(force) {
    var view = document.getElementById('view-db-knowledge')
    if (!view) return
    if (populated && !force) return

    // Reset pagination state on every fresh populate.
    loadingMore = false
    endOfPool = false
    totalAvailable = 0

    // Show loading state
    var imagesCol = document.getElementById('knowledge-images-col')
    var reelsGrid = document.getElementById('knowledge-reels-grid')
    var articlesRail = document.getElementById('knowledge-articles-rail')
    if (imagesCol && !populated) imagesCol.innerHTML = '<div style="text-align:center;padding:30px"><div class="vx-spin" style="margin:0 auto"></div></div>'
    if (reelsGrid && !populated) reelsGrid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px"><div class="vx-spin" style="margin:0 auto"></div></div>'
    if (articlesRail && !populated) articlesRail.innerHTML = '<div style="padding:20px;text-align:center"><div class="vx-spin" style="margin:0 auto"></div></div>'

    get('/api/feed?limit=' + PAGE_SIZE + '&offset=0').then(function (data) {
      if (data && data.__err) {
        var msg = data.__err === 401 || data.__err === 403
          ? 'Sign-in required to load the feed.'
          : 'Could not load feed (error ' + data.__err + '). Try refreshing.'
        if (reelsGrid) reelsGrid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--t3);font-size:13px">' + msg + '</div>'
        return
      }
      if (!data || !data.items || data.items.length === 0) {
        if (reelsGrid) reelsGrid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--t3);font-size:13px">No content found. Try refreshing.</div>'
        return
      }
      totalAvailable = typeof data.total === 'number' ? data.total : data.items.length
      endOfPool = !data.hasMore
      render(view, data.items, data.source === 'cached')
      // After the first paint, attach the infinite-scroll sentinel to the
      // last tile so the next page loads as the user nears the bottom.
      setTimeout(armScrollObserver, 60)
      scheduleRefresh()
    })
  }

  // ── Pagination — append the next page from the cached server pool ─────
  function appendPage() {
    if (loadingMore || endOfPool) return
    var grid = document.getElementById('knowledge-explore-grid')
    if (!grid) return
    var currentLength = grid.querySelectorAll('.vx-tile').length
    if (totalAvailable && currentLength >= totalAvailable) {
      endOfPool = true
      renderEndOfPool()
      return
    }

    loadingMore = true
    get('/api/feed?limit=' + PAGE_SIZE + '&offset=' + currentLength).then(function (data) {
      loadingMore = false
      if (!data || data.__err || !data.items || data.items.length === 0) {
        endOfPool = true
        renderEndOfPool()
        return
      }
      // Server returns the latest pool stats with each call.
      if (typeof data.total === 'number') totalAvailable = data.total
      if (data.hasMore === false) endOfPool = true
      // Render the new tiles into the existing grid by re-running renderExplore
      // with the FULL accumulated set (ensures hero + dedup logic stays consistent).
      var combined = (lastItems || []).concat(data.items)
      var view = document.getElementById('view-db-knowledge')
      if (view) render(view, combined, lastIsCached)
      // Re-arm the observer against the new last tile.
      setTimeout(armScrollObserver, 60)
      if (endOfPool) renderEndOfPool()
    })
  }

  function armScrollObserver() {
    var grid = document.getElementById('knowledge-explore-grid')
    if (!grid) return
    if (scrollObserver) { scrollObserver.disconnect(); scrollObserver = null }
    if (endOfPool) return

    var tiles = grid.querySelectorAll('.vx-tile')
    if (tiles.length === 0) return
    // Watch the tile ~5 from the end, so we start fetching while the user
    // still has tiles to scroll past — feels seamless.
    var sentinel = tiles[Math.max(0, tiles.length - 5)]

    scrollObserver = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          appendPage()
          break
        }
      }
    }, { rootMargin: '600px 0px 600px 0px', threshold: 0 })
    scrollObserver.observe(sentinel)
  }

  function renderEndOfPool() {
    var grid = document.getElementById('knowledge-explore-grid')
    if (!grid) return
    if (grid.parentElement && grid.parentElement.querySelector('.vx-end-of-pool')) return
    var foot = document.createElement('div')
    foot.className = 'vx-end-of-pool'
    foot.innerHTML = "You're all caught up. <button type=\"button\" class=\"vx-cs-link\" data-cs-act=\"refresh-feed\" style=\"display:inline-block;margin-left:8px\">Refresh now</button>"
    grid.parentElement.appendChild(foot)
  }

  // Schedule the next 5-min refresh, but only when the tab is visible AND
  // the Knowledge view is the active view. Avoids runaway timers when the
  // user has navigated away or backgrounded the tab.
  function scheduleRefresh() {
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null }
    if (document.hidden) return
    var view = document.getElementById('view-db-knowledge')
    if (!view || view.style.display === 'none' || view.classList.contains('hidden')) return
    refreshTimer = setTimeout(function () {
      refreshTimer = null
      populate(true)
    }, 5 * 60 * 1000)
  }

  if (!visWired) {
    visWired = true
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null }
      } else {
        scheduleRefresh()
      }
    })
  }

  // Current filter applied by the chip row (All / Reels / Pictures / Articles)
  var currentFilter = 'all'
  // Cache last fetched items so chip clicks can re-render without a refetch
  var lastItems = null
  var lastIsCached = false

  function wireClicksOnce() {
    if (clickWired) return
    var featured = document.getElementById('knowledge-featured')
    var grid = document.getElementById('knowledge-explore-grid')

    // Two-step reveal: first click on a tile shows the caption + "View
     // original" button; clicking the button (or anywhere else outside the
     // tile) dismisses or follows through. The actual <a class="view-link">
     // handles its own navigation natively — we just need to dismiss other
     // tiles and not block the link.
    function tileClickHandler(e) {
      // Don't fire when the click is on an iframe (YouTube), a video, or the
      // report flag — those have their own handlers.
      if (e.target.closest('iframe, video, .vx-report-flag')) return

      // Not-interested pill — capture before normal tile-click logic
      var notInt = e.target.closest('[data-cs-act="not-interested"]')
      if (notInt) {
        e.preventDefault()
        e.stopPropagation()
        var ntile = notInt.closest('.vx-tile')
        if (ntile) {
          var creator = ntile.dataset.creator
          if (creator) sendSignal('not_interested', 'creator', creator, 1)
          // Fade out + remove
          ntile.style.transition = 'opacity .2s'
          ntile.style.opacity = '0'
          setTimeout(function () { try { ntile.remove() } catch (e) {} }, 220)
        }
        return
      }

      // The View-original anchor handles its own navigation; let it through.
      // Track it as an "open" signal — the strongest engagement signal we have.
      var openLink = e.target.closest('[data-cs-act="open-original"]')
      if (openLink) {
        var openTile = openLink.closest('.vx-tile')
        if (openTile) {
          var openCreator = openTile.dataset.creator
          if (openCreator) sendSignal('open', 'creator', openCreator, 2)
          var openPostId = openTile.dataset.postId
          if (openPostId) sendSignal('open', 'post', openPostId, 1)
        }
        document.querySelectorAll('#view-db-knowledge .vx-tile.is-revealed').forEach(function (t) {
          t.classList.remove('is-revealed')
        })
        return
      }

      var tile = e.target.closest('.vx-tile[data-url]')
      if (!tile) return
      e.preventDefault()
      var alreadyRevealed = tile.classList.contains('is-revealed')
      // Always collapse any other revealed tile first.
      document.querySelectorAll('#view-db-knowledge .vx-tile.is-revealed').forEach(function (t) {
        if (t !== tile) t.classList.remove('is-revealed')
      })
      if (alreadyRevealed) {
        // Second click on the same tile → open the URL. Track as 'open'.
        if (tile.dataset.url) window.open(tile.dataset.url, '_blank', 'noopener')
        if (tile.dataset.creator) sendSignal('open', 'creator', tile.dataset.creator, 2)
        if (tile.dataset.postId) sendSignal('open', 'post', tile.dataset.postId, 1)
        tile.classList.remove('is-revealed')
      } else {
        tile.classList.add('is-revealed')
        // First reveal — weak interest signal.
        if (tile.dataset.creator) sendSignal('reveal', 'creator', tile.dataset.creator, 1)
        if (tile.dataset.postId) sendSignal('reveal', 'post', tile.dataset.postId, 1)
      }
    }

    if (featured) featured.addEventListener('click', tileClickHandler)
    if (grid) grid.addEventListener('click', tileClickHandler)

    // Click outside any tile (or press Escape) → dismiss every reveal.
    document.addEventListener('click', function (e) {
      if (e.target.closest('#view-db-knowledge .vx-tile')) return
      document.querySelectorAll('#view-db-knowledge .vx-tile.is-revealed').forEach(function (t) {
        t.classList.remove('is-revealed')
      })
    })
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        document.querySelectorAll('#view-db-knowledge .vx-tile.is-revealed').forEach(function (t) {
          t.classList.remove('is-revealed')
        })
      }
    })

    // Filter chips
    var chipRow = document.getElementById('explore-filters')
    if (chipRow) {
      chipRow.addEventListener('click', function (e) {
        var btn = e.target.closest('.vx-explore-chip')
        if (!btn) return
        // Refresh chip uses data-cs-act, not data-filter — let the global
        // refresh-feed delegate handle it.
        if (btn.dataset.csAct === 'refresh-feed') return
        if (!btn.dataset.filter) return
        chipRow.querySelectorAll('.vx-explore-chip[data-filter]').forEach(function (b) { b.classList.remove('is-active') })
        btn.classList.add('is-active')
        currentFilter = btn.dataset.filter || 'all'
        if (lastItems) renderExplore(lastItems, lastIsCached)
      })
    }

    // Global refresh handler (covers both the masthead chip and the
    // "you're all caught up" end-of-pool button).
    document.addEventListener('click', function (e) {
      var t = e.target
      if (!(t && t.dataset && t.dataset.csAct === 'refresh-feed')) return
      e.preventDefault()
      forceRefresh(t)
    })

    clickWired = !!(featured && grid)
  }

  function forceRefresh(btn) {
    if (btn) { btn.disabled = true; btn.dataset.origText = btn.textContent; btn.textContent = 'Refreshing\u2026' }
    fetch('/api/feed/refresh', { method: 'POST', credentials: 'include' })
      .catch(function () {})
      .finally(function () {
        // Drop any "all caught up" footer + reset pagination state, then
        // force a full repopulate.
        var foot = document.querySelector('#view-db-knowledge .vx-end-of-pool')
        if (foot && foot.parentElement) foot.parentElement.removeChild(foot)
        populated = false
        endOfPool = false
        loadingMore = false
        totalAvailable = 0
        if (scrollObserver) { scrollObserver.disconnect(); scrollObserver = null }
        populate(true)
        if (btn) {
          setTimeout(function () {
            btn.disabled = false
            btn.textContent = btn.dataset.origText || 'Refresh'
          }, 600)
        }
      })
  }

  // ── Tile builder (reels + images render the same shape) ───────────────
  function buildTileHtml(item, opts) {
    opts = opts || {}
    var url = item.url || ''
    var isIG = item.type === 'instagram'
    var isYT = item.type === 'youtube' || item.type === 'video'
    var thumb = item.thumbnail || item.imageUrl || ''
    var videoSrc = item.videoUrl || (/\.mp4(\?|$)/i.test(thumb) ? thumb : '')
    var isReel = looksLikeVideo(item)

    // Always render the warm-ivory skeleton underneath. If real media loads,
    // it sits on top (`position:absolute;inset:0`); if every image errors out
    // and gets `display:none`'d, the skeleton remains visible — readable and
    // on-brand instead of a black void.
    var skeletonHtml = '<div class="vx-skeleton"></div>'
    var mediaHtml = ''
    if (isIG && videoSrc) {
      // Render an underlay <img> when we have a real still-frame URL, AND
      // render the <video> with preload="metadata" so the browser fetches
      // just enough to show a first frame even without a poster. On hover
      // we promote to full preload + play.
      // (Hashtag-API results don't expose thumbnail_url, so `thumb` is
      // typically empty for IG-trending; preload=metadata is what makes
      // the tile not-black before hover.)
      mediaHtml =
        (thumb ? '<img src="' + esc(thumb) + '" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'" />' : '')
        + '<video src="' + esc(videoSrc) + '"'
        + (thumb ? ' poster="' + esc(thumb) + '"' : '')
        + ' playsinline muted loop preload="metadata"'
        + ' onmouseenter="this.preload=\'auto\';this.play()"'
        + ' onmouseleave="this.pause();this.currentTime=0"'
        + '></video>'
    } else if (isYT) {
      var vidMatch = url.match(/[?&]v=([^&]+)/) || url.match(/shorts\/([^?&]+)/) || url.match(/youtu\.be\/([^?&]+)/)
      var videoId = vidMatch ? vidMatch[1] : ''
      if (videoId && opts.embedYouTube) {
        mediaHtml = '<iframe src="https://www.youtube.com/embed/' + videoId + '" allow="autoplay;encrypted-media" allowfullscreen loading="lazy"></iframe>'
      } else if (thumb) {
        mediaHtml = '<img src="' + esc(thumb) + '" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'" />'
      }
    } else if (thumb) {
      mediaHtml = '<img src="' + esc(thumb) + '" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'" />'
    }

    var aspect = opts.aspect ||
      (isReel ? '9-16' : (isIG ? '1-1' : '16-9'))

    var badge = isIG
      ? '<span class="badge"><span class="dot"></span>IG</span>'
      : isYT
        ? '<span class="badge"><span class="dot yt"></span>YT</span>'
        : ''

    var reportFlag = item.creator && item.communityPostId
      ? '<button type="button" class="vx-report-flag" data-report-post="' + esc(item.communityPostId) + '" title="Report this post">⚑</button>'
      : ''

    var playGlyph = isReel || isYT
      ? '<div class="play"><div class="glyph">▶</div></div>'
      : ''

    var viewLabel = isYT ? 'View on YouTube' : isIG ? 'View on Instagram' : 'View original'
    var viewBtn = url
      ? '<a class="view-link" href="' + esc(url) + '" target="_blank" rel="noopener" data-cs-act="open-original">' + viewLabel + ' \u2197</a>'
      : ''

    // Source string used as creator identifier for behavioral signals.
    // Community items use '@handle'; IG-trending uses 'Instagram'.
    var creatorId = item.source || (item.creator && ('@' + (item.creator.handle || ''))) || ''

    // "Show fewer like this" — captured as kind=not_interested, target=creator.
    // Only shown when we have a creator to dampen.
    var notInterestedBtn = creatorId
      ? '<button type="button" class="view-link view-link--ghost" data-cs-act="not-interested">Show fewer like this</button>'
      : ''

    return '<div class="vx-tile' + (opts.hero ? ' hero' : '') + '"'
      + ' data-url="' + esc(url) + '"'
      + ' data-aspect="' + aspect + '"'
      + ' data-creator="' + esc(creatorId) + '"'
      + ' data-post-id="' + esc(item.id || '') + '">'
      + skeletonHtml
      + mediaHtml
      + badge
      + playGlyph
      + reportFlag
      + '<div class="scrim"></div>'
      + '<div class="caption">'
      + '<span class="src">' + esc(creatorId) + '</span>'
      + '<div class="ttl">' + esc((item.title || '').slice(0, 280)) + '</div>'
      + '<div class="caption-actions">' + viewBtn + notInterestedBtn + '</div>'
      + '</div>'
      + '</div>'
  }

  // ── Helpers shared with the explore renderer ───────────────────────────
  function looksLikeVideo(it) {
    if (it.isVideo === true) return true
    if (typeof it.mediaType === 'string' && /video|reel/i.test(it.mediaType)) return true
    var url = (it.videoUrl || it.imageUrl || it.thumbnail || '').toLowerCase()
    if (/\.mp4(\?|$)/.test(url)) return true
    if (/\/(reel|reels|shorts)\//.test(url)) return true
    return false
  }

  function splitItems(items) {
    var images = items.filter(function (it) {
      if (it.type !== 'instagram') return false
      return !looksLikeVideo(it)
    })
    var reels = items.filter(function (it) {
      if (it.type === 'youtube' || it.type === 'video') return true
      if (it.type === 'instagram') return looksLikeVideo(it)
      return false
    })
    var articles = items.filter(function (it) { return it.type === 'article' || it.type === 'reddit' || it.type === 'research' || it.type === 'news' })
    return { images: images, reels: reels, articles: articles }
  }

  // ── Explore renderer (Apple/IG-style) ──────────────────────────────────
  function renderExplore(items, isCached) {
    populated = true
    wireClicksOnce()
    lastItems = items
    lastIsCached = isCached

    var split = splitItems(items)
    var media = []
    var includeReels = currentFilter === 'all' || currentFilter === 'reels'
    var includeImages = currentFilter === 'all' || currentFilter === 'images'

    if (includeReels) media = media.concat(split.reels)
    if (includeImages) media = media.concat(split.images)

    // Dedupe by url (and by thumbnail as a fallback) — the feed sometimes
    // returns multiple posts from the same creator with the same media,
    // which makes the explore grid look like a wall of identical thumbnails.
    var seenUrls = {}
    var seenThumbs = {}
    media = media.filter(function (it) {
      var u = (it.url || '').trim()
      var t = (it.thumbnail || it.imageUrl || '').trim()
      if (u && seenUrls[u]) return false
      if (t && seenThumbs[t]) return false
      if (u) seenUrls[u] = 1
      if (t) seenThumbs[t] = 1
      return true
    })

    // Update meta line
    var feedSub = document.getElementById('feed-sub')
    if (feedSub) {
      var communityCount = items.filter(function (i) { return i.creator }).length
      var communityPart = communityCount > 0 ? communityCount + ' community · ' + (media.length - communityCount) + ' external' : (isCached ? 'cached' : 'live')
      feedSub.textContent = media.length + ' items · ' + communityPart
    }

    // Featured row is now folded into the main grid (CSS hides #knowledge-featured)
    var featured = document.getElementById('knowledge-featured')
    if (featured) featured.innerHTML = ''

    // ── Single continuous IG-style explore grid ──
    // First item becomes the "hero" — spans 2 cols × 2 rows. Everything
    // after is laid out by media type with grid-auto-flow:dense.
    var grid = document.getElementById('knowledge-explore-grid')
    if (grid) {
      if (media.length === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 20px;color:var(--t3);font-family:\'JetBrains Mono\',monospace;font-size:11px;letter-spacing:.18em;text-transform:uppercase">No content for this filter</div>'
      } else {
        grid.innerHTML = media.map(function (it, idx) {
          var aspect = looksLikeVideo(it) ? '9-16' : '1-1'
          return buildTileHtml(it, { aspect: aspect, hero: idx === 0 })
        }).join('')
      }
    }

    // (Articles section removed — explore page is media-only now)

    // Sidebar nav counts (kept for backward compat — chrome may still reference them)
    var navItems = document.querySelectorAll('#view-db-knowledge .nav-item .c')
    if (navItems.length >= 5) {
      navItems[0].textContent = media.length
      navItems[1].textContent = split.reels.length
      navItems[2].textContent = split.images.length
      navItems[3].textContent = 0
      navItems[4].textContent = 0
    }
  }

  // Keep the old `render` name so populate() still calls into the new flow.
  function render(view, items, isCached) { renderExplore(items, isCached) }

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

  // ── Behavioral signal posting ──────────────────────────────────────────
  // Fire-and-forget: the user shouldn't wait on these. The server uses them
  // to bias the next /api/feed call (author affinity + dampening).
  function sendSignal(kind, targetType, targetId, weight) {
    if (!targetId) return
    try {
      fetch('/api/feed/signal', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({ kind: kind, targetType: targetType, targetId: String(targetId), weight: weight }),
      }).catch(function () {})
    } catch (e) { /* ignore */ }
  }

  // ── Community opt-in: consent modal + transparency panel ────────────────
  // The previous toggle flipped a Boolean on change. Now: opting in opens a
  // disclosure modal first, and the API call only fires after the user
  // accepts the agreement. Opt-out is direct (with an inline flash).
  var AGREEMENT_VERSION = 'v1'

  function showFlash(text) {
    var el = document.createElement('div')
    el.className = 'vx-cs-flash'
    el.textContent = text
    document.body.appendChild(el)
    setTimeout(function () { try { el.remove() } catch (e) {} }, 3200)
  }

  function showConsentModal(onAccept, onCancel) {
    var scrim = document.createElement('div')
    scrim.className = 'vx-cs-modal-scrim'
    scrim.innerHTML = ''
      + '<div class="vx-cs-modal" role="dialog" aria-labelledby="vx-cs-modal-title">'
      + '  <div class="vx-cs-eyebrow" style="margin-bottom:14px">Community · Opt-in</div>'
      + '  <h2 id="vx-cs-modal-title">Share your top videos to inspire <em>other CEOs</em>.</h2>'
      + '  <ul>'
      + '    <li>Your <strong>10 most popular videos</strong> may appear in the Knowledge feed of other CEOs in your niche, tagged with your @handle and a link back to your original post.</li>'
      + '    <li>You won\u2019t see your own content in your own Knowledge feed \u2014 this is for OTHER CEOs to discover you. You can see what you\u2019ve shared in Settings.</li>'
      + '    <li>You can turn sharing off any time in Settings \u2192 Profile. Your tagged videos disappear from every other CEO\u2019s feed within seconds.</li>'
      + '    <li>We never share private metrics, audience data, drafts, or paid promotions.</li>'
      + '  </ul>'
      + '  <div class="vx-cs-modal-foot">'
      + '    <button type="button" class="vx-cs-btn" data-act="cancel">Maybe later</button>'
      + '    <button type="button" class="vx-cs-btn vx-cs-btn--primary" data-act="agree">Allow \u2014 turn on sharing</button>'
      + '  </div>'
      + '</div>'
    document.body.appendChild(scrim)

    function close() { try { scrim.remove() } catch (e) {} }

    scrim.addEventListener('click', function (e) {
      var act = e.target && e.target.dataset && e.target.dataset.act
      if (act === 'agree') {
        close()
        onAccept && onAccept()
      } else if (act === 'cancel' || e.target === scrim) {
        close()
        onCancel && onCancel()
      }
    })
  }

  function showReportModal(postId, onSubmitted) {
    var scrim = document.createElement('div')
    scrim.className = 'vx-cs-modal-scrim'
    scrim.innerHTML = ''
      + '<div class="vx-cs-modal" role="dialog" aria-labelledby="vx-cs-report-title">'
      + '  <div class="vx-cs-eyebrow" style="margin-bottom:14px">Report · Community post</div>'
      + '  <h2 id="vx-cs-report-title">Why are you reporting this <em>post</em>?</h2>'
      + '  <p style="font-size:13px;color:var(--t2);margin:0 0 18px;line-height:1.55">The post will be hidden from every CEO\u2019s feed immediately while our team reviews.</p>'
      + '  <label style="display:block;font-family:\'JetBrains Mono\',monospace;font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:var(--t3);margin-bottom:8px">Reason</label>'
      + '  <select id="vx-report-reason" style="width:100%;padding:10px 12px;font-family:\'Inter\',sans-serif;font-size:13px;border:1px solid var(--hair-strong,rgba(20,16,10,.16));border-radius:8px;background:var(--bg);color:var(--t1);margin-bottom:16px">'
      + '    <option value="spam">Spam or repetitive</option>'
      + '    <option value="offensive">Offensive content</option>'
      + '    <option value="misleading">Misleading or false</option>'
      + '    <option value="copyright">Copyright violation</option>'
      + '    <option value="other">Something else</option>'
      + '  </select>'
      + '  <label style="display:block;font-family:\'JetBrains Mono\',monospace;font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:var(--t3);margin-bottom:8px">Notes (optional)</label>'
      + '  <textarea id="vx-report-notes" rows="3" style="width:100%;padding:10px 12px;font-family:\'Inter\',sans-serif;font-size:13px;border:1px solid var(--hair-strong,rgba(20,16,10,.16));border-radius:8px;background:var(--bg);color:var(--t1);resize:vertical"></textarea>'
      + '  <div class="vx-cs-modal-foot">'
      + '    <button type="button" class="vx-cs-btn" data-act="cancel">Cancel</button>'
      + '    <button type="button" class="vx-cs-btn vx-cs-btn--danger" data-act="submit">Submit report</button>'
      + '  </div>'
      + '</div>'
    document.body.appendChild(scrim)

    function close() { try { scrim.remove() } catch (e) {} }

    scrim.addEventListener('click', function (e) {
      var act = e.target && e.target.dataset && e.target.dataset.act
      if (act === 'submit') {
        var reason = document.getElementById('vx-report-reason').value
        var notes = document.getElementById('vx-report-notes').value || ''
        fetch('/api/community/report', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postId: postId, reason: reason, notes: notes }),
        }).then(function (r) { return r.ok ? r.json() : null })
          .then(function (data) {
            close()
            if (data && data.ok) {
              showFlash('Thanks \u00b7 the post has been hidden while we review.')
              onSubmitted && onSubmitted()
            } else {
              showFlash('Could not submit report \u2014 please try again.')
            }
          })
      } else if (act === 'cancel' || e.target === scrim) {
        close()
      }
    })
  }

  // ── Community-sharing helpers ──────────────────────────────────────────
  function loadCompanyState() {
    return get('/api/company/me').then(function (data) {
      if (data && !data.__err && data.company) return data.company
      return null
    })
  }

  function patchOptIn(optIn) {
    return fetch('/api/company/me/community-opt-in', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ optIn: optIn, agreementVersion: AGREEMENT_VERSION }),
    }).then(function (r) { return r.ok })
  }

  // First-visit auto-prompt: if the user has never been asked before AND is
  // not already opted in, show the consent modal automatically. The flag is
  // stored in localStorage so we never nag a user who declined — they can
  // change their mind in Settings → Profile → Community sharing.
  var PROMPT_FLAG = 'vx-community-prompt-seen'
  function maybePromptOnEntry() {
    try { if (localStorage.getItem(PROMPT_FLAG) === '1') return } catch (e) { return }
    loadCompanyState().then(function (company) {
      if (!company) return                       // not logged in / no company
      if (company.communityOptIn) {              // already opted in — no prompt
        try { localStorage.setItem(PROMPT_FLAG, '1') } catch (e) {}
        return
      }
      showConsentModal(
        function () {
          patchOptIn(true).then(function (ok) {
            if (ok) showFlash('Thanks \u2014 your content can now help other CEOs.')
            else showFlash('Could not turn on sharing \u2014 try again from Settings.')
          })
          try { localStorage.setItem(PROMPT_FLAG, '1') } catch (e) {}
        },
        function () {
          // Cancel = "Maybe later" — flag set, modal won't fire again.
          try { localStorage.setItem(PROMPT_FLAG, '1') } catch (e) {}
          showFlash('No problem \u2014 you can turn this on later in Settings.')
        }
      )
    })
  }

  function wireOptIn() {
    // Single document-level delegate for the in-feed report flag. The
    // bottom panel is gone, so this is the only delegated handler we need.
    if (!document.body.dataset.vxCsWired) {
      document.body.dataset.vxCsWired = '1'
      document.body.addEventListener('click', function (e) {
        var t = e.target
        if (t && t.classList && t.classList.contains('vx-report-flag')) {
          e.preventDefault()
          e.stopPropagation()
          var rid = t.dataset.reportPost
          if (rid) showReportModal(rid, function () {
            var card = t.closest('.vx-tile') || t.closest('.card')
            if (card && card.parentElement) card.parentElement.removeChild(card)
          })
        }
      })
    }
    maybePromptOnEntry()
  }

  // Hook into navigation — force refresh on re-visit so content stays fresh
  var origNav = window.navigate
  window.navigate = function (id) {
    var r = typeof origNav === 'function' ? origNav(id) : undefined
    if (id === 'db-knowledge') {
      setTimeout(function () { populate(true) }, 150)
      setTimeout(wireOptIn, 300)
    }
    return r
  }
})()
