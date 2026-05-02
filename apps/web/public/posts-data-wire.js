/* Posts page — full data pipeline: fetch, filter, sort, search, paginate, grid+table views.
 * Replaces the old posts-data-wire + posts-wire-v2 entirely.
 */
;(function () {
  'use strict'

  /* ── helpers ────────────────────────────────────────── */
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
    if (days < 30) return days + 'd ago'
    return Math.floor(days / 30) + 'mo ago'
  }
  function shortDate(dateStr) {
    if (!dateStr) return ''
    var d = new Date(dateStr)
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    var h = d.getHours(); var m = d.getMinutes()
    return months[d.getMonth()] + ' ' + d.getDate() + ' · ' + String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0')
  }

  /* ── state ─────────────────────────────────────────── */
  var allPosts = []
  var acctMap = {}       // accountId → platform string
  var state = {
    platform: 'all',     // all | instagram | tiktok | youtube
    format: 'all',       // all | REEL | CAROUSEL_ALBUM | VIDEO | IMAGE
    sort: 'recent',      // recent | reach | saves | engagement
    search: '',
    view: 'grid',        // grid | table
    top5: 'all',         // all | instagram | tiktok
    top5Sort: 'reach',   // reach | likes | views
    fetched: false,
    loadError: false,   // true when /platform/timeseries failed (network / auth)
  }

  /* ── normalise mediaType labels ───────────────────── */
  function normaliseType(raw) {
    var t = (raw || 'POST').toUpperCase()
    if (t === 'CAROUSEL_ALBUM') return 'CAROUSEL'
    if (t === 'IMAGE') return 'STATIC'
    return t  // REEL, VIDEO, SHORT, etc.
  }
  function formatLabel(raw) {
    var t = normaliseType(raw)
    if (t === 'CAROUSEL') return 'Carousel'
    if (t === 'STATIC') return 'Static'
    if (t === 'REEL') return 'Reel'
    if (t === 'VIDEO') return 'Video'
    if (t === 'SHORT') return 'Short'
    return t.charAt(0) + t.slice(1).toLowerCase()
  }

  /* ── platform helpers ─────────────────────────────── */
  function platOf(p) { return acctMap[p.accountId] || 'instagram' }
  function platKey(p) {
    var pl = platOf(p)
    if (pl === 'tiktok') return 'tt'
    if (pl === 'youtube') return 'yt'
    return 'ig'
  }
  function platLabel(p) { return platKey(p).toUpperCase() }

  /* ── metrics ──────────────────────────────────────── */
  function reach(p) { return p.reachCount || p.viewCount || p.impressionCount || 0 }
  function saves(p) { return p.saveCount || 0 }
  function likes(p) { return p.likeCount || 0 }
  function comments(p) { return p.commentCount || 0 }
  function shares(p) { return p.shareCount || 0 }
  function er(p) {
    var r = reach(p)
    return r > 0 ? ((likes(p) + comments(p) + saves(p)) / r * 100) : 0
  }

  function normCaption(caption) {
    var s = String(caption || '').toLowerCase()
    s = s.replace(/https?:\/\/\S+/g, ' ')
    s = s.replace(/#[^\s#]+/g, ' ')
    s = s.replace(/@[^\s@]+/g, ' ')
    s = s.replace(/[^\w\s]/g, ' ')
    s = s.replace(/\s+/g, ' ').trim()
    return s
  }

  function mediaFamily(p) {
    var t = normaliseType(p.mediaType)
    return (t === 'REEL' || t === 'VIDEO' || t === 'SHORT') ? 'video' : 'image'
  }

  function dedupeCrossPosted(list) {
    var groups = new Map()
    var WINDOW_MS = 12 * 60 * 60 * 1000 // 12-hour publish bucket

    list.forEach(function (p) {
      var norm = normCaption(p.caption)
      // If caption is too short/noisy, avoid risky collapsing.
      if (norm.length < 18) {
        groups.set('id:' + p.id, [p])
        return
      }
      var t = new Date(p.publishedAt || 0).getTime()
      var bucket = Math.floor(t / WINDOW_MS)
      var key = mediaFamily(p) + '|' + bucket + '|' + norm.slice(0, 80)
      var arr = groups.get(key) || []
      arr.push(p)
      groups.set(key, arr)
    })

    var merged = []
    groups.forEach(function (items) {
      if (!items || items.length === 0) return
      if (items.length === 1) {
        var single = Object.assign({}, items[0])
        single._platforms = [platKey(items[0]).toUpperCase()]
        single._mergedCount = 1
        merged.push(single)
        return
      }

      var base = items.slice().sort(function (a, b) { return reach(b) - reach(a) })[0]
      var bestMedia = items.find(function (x) { return !!x.mediaUrl }) || base
      var newest = items.slice().sort(function (a, b) { return new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0) })[0]
      var plats = Array.from(new Set(items.map(function (x) { return platKey(x).toUpperCase() })))

      var m = Object.assign({}, base)
      m.publishedAt = newest.publishedAt
      m.mediaUrl = bestMedia.mediaUrl || m.mediaUrl
      m.thumbnailUrl = bestMedia.thumbnailUrl || m.thumbnailUrl
      m.url = bestMedia.url || m.url
      m._platforms = plats
      m._mergedCount = items.length

      m.likeCount = items.reduce(function (s, x) { return s + (x.likeCount || 0) }, 0)
      m.commentCount = items.reduce(function (s, x) { return s + (x.commentCount || 0) }, 0)
      m.shareCount = items.reduce(function (s, x) { return s + (x.shareCount || 0) }, 0)
      m.saveCount = items.reduce(function (s, x) { return s + (x.saveCount || 0) }, 0)
      m.viewCount = items.reduce(function (s, x) { return s + (x.viewCount || 0) }, 0)
      m.reachCount = items.reduce(function (s, x) { return s + (x.reachCount || 0) }, 0)
      m.impressionCount = items.reduce(function (s, x) { return s + (x.impressionCount || 0) }, 0)

      merged.push(m)
    })

    return merged
  }

  /* ── filter + sort ────────────────────────────────── */
  function filtered() {
    var list = allPosts.slice()

    // Platform
    if (state.platform !== 'all') {
      list = list.filter(function (p) { return platOf(p) === state.platform })
    }

    // Format
    if (state.format !== 'all') {
      list = list.filter(function (p) {
        var n = normaliseType(p.mediaType)
        if (state.format === 'PICTURE') return n === 'STATIC' || n === 'IMAGE'
        if (state.format === 'REEL') return n === 'REEL' || n === 'VIDEO' || n === 'SHORT'
        return n === state.format
      })
    }

    // Search
    if (state.search) {
      var q = state.search.toLowerCase()
      list = list.filter(function (p) {
        return (p.caption || '').toLowerCase().indexOf(q) !== -1
      })
    }

    // Dedupe cross-posted items only in "All platforms" mode.
    if (state.platform === 'all') {
      list = dedupeCrossPosted(list)
    }

    // Sort
    if (state.sort === 'reach') {
      list.sort(function (a, b) { return reach(b) - reach(a) })
    } else if (state.sort === 'saves') {
      list.sort(function (a, b) { return saves(b) - saves(a) })
    } else if (state.sort === 'engagement') {
      list.sort(function (a, b) { return er(b) - er(a) })
    } else {
      list.sort(function (a, b) { return new Date(b.publishedAt) - new Date(a.publishedAt) })
    }

    return list
  }

  /* ── render: grid card ────────────────────────────── */
  function renderCard(p, i) {
    var pk = platKey(p)
    var pl = (p._platforms && p._platforms.length) ? p._platforms.join(' + ') : platLabel(p)
    var rawType = normaliseType(p.mediaType)
    var caption = (p.caption || '').slice(0, 100)
    var shortCaption = caption.split('.')[0] || caption.slice(0, 40)
    var r = reach(p), s = saves(p), e = er(p).toFixed(1)
    var ago = timeAgo(p.publishedAt)
    var thumb = p.thumbnailUrl || ''
    var colorIdx = (i % 8) + 1
    var isVideo = rawType === 'REEL' || rawType === 'VIDEO' || rawType === 'SHORT'
    var isCarousel = rawType === 'CAROUSEL'
    var mediaIcon = isCarousel ? '&#9638;' : isVideo ? '&#9654;' : '&#9633;'

    return '<div class="card" data-post-idx="' + i + '">'
      + '<div class="th a' + colorIdx + '"' + (thumb ? ' style="background:url(' + esc(thumb) + ') center/cover"' : '') + '>'
      + '<span class="plat"><span class="d ' + pk + '"></span>' + pl + '</span>'
      + '<span class="fmt">' + rawType + '</span>'
      + '<span class="media-ic" aria-hidden="true">' + mediaIcon + '</span>'
      + '<span class="qt">&ldquo;' + esc(shortCaption.slice(0, 36)) + '&rdquo;</span>'
      + '</div>'
      + '<div class="body">'
      + '<div class="tag-row"><span>' + ago + '</span></div>'
      + '<div class="ttl">' + esc(caption) + '</div>'
      + '<div class="m">'
      + '<div class="cell"><div class="l">Reach</div><div class="n"><em>' + fmt(r) + '</em></div></div>'
      + '<div class="cell"><div class="l">Saves</div><div class="n">' + fmt(s) + '</div></div>'
      + '<div class="cell"><div class="l">ER</div><div class="n">' + e + '%</div></div>'
      + '</div>'
      + '</div>'
      + '</div>'
  }

  /* ── render: table row ────────────────────────────── */
  function renderRow(p, i) {
    var pk = platKey(p)
    var rawType = normaliseType(p.mediaType)
    var caption = (p.caption || '').slice(0, 80)
    var r = reach(p), s = saves(p), l = likes(p), c = comments(p), sh = shares(p), e = er(p).toFixed(1)
    var thumb = p.thumbnailUrl || ''
    var thumbHtml = thumb
      ? '<div class="thumb" style="background:url(' + esc(thumb) + ') center/cover"></div>'
      : '<div class="thumb">' + (rawType === 'REEL' || rawType === 'VIDEO' ? '&#9655;' : '&#10022;') + '</div>'

    var platformLabel = (p._platforms && p._platforms.length) ? p._platforms.join('+') : platKey(p).toUpperCase()
    return '<tr>'
      + '<td><div class="cell-first">' + thumbHtml + '<div><div class="ttl">' + esc(caption) + '</div>'
      + '<div class="meta"><span class="pf ' + pk + '"><span class="dot"></span>' + platformLabel + '</span>'
      + '<span>' + formatLabel(p.mediaType) + '</span>'
      + '<span>' + shortDate(p.publishedAt) + '</span></div></div></div></td>'
      + '<td class="num">' + fmt(r) + '</td>'
      + '<td class="num">' + fmt(l) + '</td>'
      + '<td class="num">' + fmt(c) + '</td>'
      + '<td class="num">' + fmt(sh) + '</td>'
      + '<td class="num">' + fmt(s) + '</td>'
      + '<td class="num">' + e + '%</td>'
      + '</tr>'
  }

  function renderPostsLoadFailure (view) {
    var msg = '<div style="text-align:center;padding:56px 24px;color:var(--t2);font-size:14px;line-height:1.6;max-width:420px;margin:0 auto">We couldn\'t load your posts. Check your connection and open <strong>Posts</strong> again to retry.</div>'
    var gridEl = view.querySelector('.grid')
    var tableWrap = view.querySelector('.tbl-wrap')
    if (gridEl) {
      gridEl.style.display = ''
      gridEl.innerHTML = '<div style="grid-column:1/-1">' + msg + '</div>'
    }
    if (tableWrap) {
      tableWrap.style.display = ''
      tableWrap.innerHTML = msg
    }
    var countEl = view.querySelector('.list-head .c')
    if (countEl) countEl.textContent = '—'
  }

  /* ── render: full grid or table ───────────────────── */
  function render() {
    var view = document.getElementById('view-db-posts')
    if (!view) return

    if (state.loadError && allPosts.length === 0) {
      renderPostsLoadFailure(view)
      return
    }

    var list = filtered()
    var visible = list
    var total = list.length
    var gridEl = view.querySelector('.grid')
    var tableWrap = view.querySelector('.tbl-wrap')
    var paginationEl = view.querySelector('.pagination')

    if (state.view === 'table') {
      if (gridEl) gridEl.style.display = 'none'
      if (!tableWrap) {
        tableWrap = document.createElement('div')
        tableWrap.className = 'tbl-wrap'
        gridEl.parentNode.insertBefore(tableWrap, gridEl.nextSibling)
      }
      tableWrap.style.display = ''
      var html = '<table class="posts-tbl"><thead><tr>'
        + '<th>Post</th><th class="r">Reach</th><th class="r">Likes</th>'
        + '<th class="r">Comments</th><th class="r">Shares</th>'
        + '<th class="r">Saves</th><th class="r">ER</th></tr></thead><tbody>'
      visible.forEach(function (p, i) { html += renderRow(p, i) })
      html += '</tbody></table>'
      tableWrap.innerHTML = html
    } else {
      if (tableWrap) tableWrap.style.display = 'none'
      if (gridEl) {
        gridEl.style.display = ''
        if (visible.length === 0 && allPosts.length > 0) {
          gridEl.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:80px 0;color:var(--t3);font-size:14px">No posts match this filter.</div>'
        } else {
          gridEl.innerHTML = visible.map(function (p, i) { return renderCard(p, i) }).join('')
        }
      }
    }

    // Count
    var countEl = view.querySelector('.list-head .c')
    if (countEl) {
      var sortLabel = state.sort === 'reach' ? 'reach' : state.sort === 'saves' ? 'saves' : state.sort === 'engagement' ? 'engagement' : 'recent'
      var from = total > 0 ? 1 : 0
      var to = total
      countEl.textContent = from + '\u2013' + to + ' of ' + total + ' \u00b7 sorted by ' + sortLabel
    }

    // Continuous feed: no pagination controls.
    if (paginationEl) {
      paginationEl.style.display = 'none'
      paginationEl.innerHTML = ''
    }

    // Card click → open modal
    var cards = view.querySelectorAll('.card[data-post-idx]')
    cards.forEach(function (card) {
      card.addEventListener('click', function () {
        var idx = parseInt(card.getAttribute('data-post-idx'), 10)
        var list = filtered()
        if (list[idx]) openPostModal(list[idx])
      })
    })

    // Top 5 rail
    updateTop5(view, allPosts)
  }

  /* ── top 5 rail ───────────────────────────────────── */
  function updateTop5(view, posts) {
    var miniRail = view.querySelector('.mini-rail')
    if (!miniRail || posts.length === 0) return

    var pool = state.top5 === 'all' ? dedupeCrossPosted(posts) : posts.filter(function (p) { return platOf(p) === state.top5 })
    var sortFn = state.top5Sort === 'likes' ? function (a, b) { return likes(b) - likes(a) }
      : state.top5Sort === 'views' ? function (a, b) { return (b.viewCount || 0) - (a.viewCount || 0) }
      : function (a, b) { return reach(b) - reach(a) }
    var sorted = pool.slice().sort(sortFn)
    var top5 = sorted.slice(0, 10)
    var colors = ['h1','h2','h3','h4','h5']

    var rowsEl = miniRail.querySelectorAll('.top-row')
    // If static rows exist, replace them
    if (rowsEl.length > 0) {
      rowsEl.forEach(function (el) { el.remove() })
    }

    var html = ''
    top5.forEach(function (p, i) {
      var pk = platKey(p)
      var caption = (p.caption || '').slice(0, 40)
      var metricVal = state.top5Sort === 'likes' ? likes(p) : state.top5Sort === 'views' ? (p.viewCount || 0) : reach(p)
      var thumb = p.thumbnailUrl || ''
      var thumbStyle = thumb ? ' style="background:url(' + esc(thumb) + ') center/cover"' : ''

      html += '<div class="top-row"><span class="rk">' + String(i + 1).padStart(2, '0') + '</span>'
        + '<div class="tth ' + colors[i] + '"' + thumbStyle + '></div>'
        + '<div class="meta"><div class="t">' + esc(caption) + '</div>'
        + '<div class="d">' + pk.toUpperCase() + ' \u00b7 ' + shortDate(p.publishedAt) + ' \u00b7 ' + formatLabel(p.mediaType) + '</div></div>'
        + '<div class="n"><em>' + fmt(metricVal) + '</em></div></div>'
    })
    miniRail.insertAdjacentHTML('beforeend', html)

    // Update header
    var h = miniRail.querySelector('h3')
    if (h) h.innerHTML = 'Top <em>10</em>'
    var sub = miniRail.querySelector('.lanes-head span')
    if (sub) sub.textContent = 'by reach'
  }

  /* ── post detail modal ─────────────────────────────── */
  function openPostModal(post) {
    var existing = document.getElementById('post-modal-overlay')
    if (existing) existing.remove()

    var pk = platKey(post)
    var looksTikTok = pk === 'tt'
      || /tiktok/i.test(String(post.url || ''))
      || /tiktok|muscdn|bytecdn/i.test(String(post.mediaUrl || ''))
    var rawType = normaliseType(post.mediaType)
    var caption = post.caption || ''
    var r = reach(post), s = saves(post), l = likes(post), c = comments(post), sh = shares(post), e = er(post).toFixed(1)
    var mediaSrc = post.mediaUrl || post.thumbnailUrl || ''
    var isVideo = rawType === 'REEL' || rawType === 'VIDEO' || rawType === 'SHORT'
    var mediaClass = 'pm-native-media is-' + pk + (looksTikTok ? ' is-tt' : '') + (isVideo ? ' is-video' : ' is-image')
    var hasDirectVideo = !!(post.mediaUrl && String(post.mediaUrl).trim())

    var embedHtml = ''
    if (isVideo && hasDirectVideo && post.mediaUrl) {
      embedHtml = '<video class="' + mediaClass + '" src="' + esc(mediaSrc) + '" controls playsinline preload="metadata"' + (post.thumbnailUrl ? ' poster="' + esc(post.thumbnailUrl) + '"' : '') + '></video>'
    } else if (mediaSrc) {
      embedHtml = '<img class="' + mediaClass + '" src="' + esc(mediaSrc) + '" alt="Post media" loading="lazy" />'
    } else {
      embedHtml = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--s1);border-radius:8px;color:var(--t3);font-size:14px">No preview available</div>'
    }

    var overlay = document.createElement('div')
    overlay.id = 'post-modal-overlay'
    overlay.innerHTML =
      '<div class="pm-backdrop"></div>'
      + '<div class="pm-container">'
      + '<div class="pm-media">' + embedHtml + '</div>'
      + '<div class="pm-detail">'
      + '<div class="pm-head">'
      + '<span class="pm-plat"><span class="d ' + pk + '"></span>' + pk.toUpperCase() + ' · ' + rawType + '</span>'
      + '<button class="pm-close">&times;</button>'
      + '</div>'
      + '<div class="pm-caption">' + esc(caption) + '</div>'
      + (isVideo && !hasDirectVideo ? '<div class="pm-date">Video preview unavailable in-app. Use the link below to play on platform.</div>' : '')
      + '<div class="pm-date">' + shortDate(post.publishedAt) + '</div>'
      + '<div class="pm-metrics">'
      + '<div class="pm-m"><div class="pm-ml">Reach</div><div class="pm-mv">' + fmt(r) + '</div></div>'
      + '<div class="pm-m"><div class="pm-ml">Likes</div><div class="pm-mv">' + fmt(l) + '</div></div>'
      + '<div class="pm-m"><div class="pm-ml">Comments</div><div class="pm-mv">' + fmt(c) + '</div></div>'
      + '<div class="pm-m"><div class="pm-ml">Shares</div><div class="pm-mv">' + fmt(sh) + '</div></div>'
      + '<div class="pm-m"><div class="pm-ml">Saves</div><div class="pm-mv">' + fmt(s) + '</div></div>'
      + '<div class="pm-m"><div class="pm-ml">ER</div><div class="pm-mv">' + e + '%</div></div>'
      + '</div>'
      + (post.url ? '<a class="pm-link" href="' + esc(post.url) + '" target="_blank" rel="noopener">Open on ' + (pk === 'tt' ? 'TikTok' : pk === 'yt' ? 'YouTube' : 'Instagram') + ' &rarr;</a>' : '')
      + '</div>'
      + '</div>'

    document.body.appendChild(overlay)
    var prevBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Close handlers
    function closeModal() {
      if (!overlay || !overlay.parentNode) return
      overlay.remove()
      document.body.style.overflow = prevBodyOverflow
      document.removeEventListener('keydown', onEsc)
    }
    function onEsc(e) {
      if (e.key === 'Escape') closeModal()
    }
    overlay.querySelector('.pm-backdrop').addEventListener('click', closeModal)
    overlay.querySelector('.pm-close').addEventListener('click', closeModal)
    document.addEventListener('keydown', onEsc)
  }

  /* ── chip wiring ──────────────────────────────────── */
  var filtersWired = false
  function wireFilters() {
    if (filtersWired) return
    var view = document.getElementById('view-db-posts')
    if (!view) return

    var groups = view.querySelectorAll('.filters .fgroup')
    if (groups.length < 3) return
    filtersWired = true

    // Platform group (index 0)
    var platMap = { 'All': 'all', 'IG': 'instagram', 'TikTok': 'tiktok', 'YT': 'youtube' }
    groups[0].addEventListener('click', function (e) {
      var b = e.target.closest('.fchip')
      if (!b) return
      groups[0].querySelectorAll('.fchip').forEach(function (x) { x.classList.remove('on') })
      b.classList.add('on')
      var txt = b.textContent.trim()
      state.platform = platMap[txt] || 'all'
      render()
    })

    // Format group (index 1)
    var fmtMap = { 'All': 'all', 'Reel': 'REEL', 'Carousel': 'CAROUSEL', 'Picture': 'PICTURE' }
    groups[1].addEventListener('click', function (e) {
      var b = e.target.closest('.fchip')
      if (!b) return
      groups[1].querySelectorAll('.fchip').forEach(function (x) { x.classList.remove('on') })
      b.classList.add('on')
      var txt = b.textContent.trim()
      state.format = fmtMap[txt] || 'all'
      render()
    })

    // Sort group (index 2)
    var sortMap = { 'Recent': 'recent', 'Reach': 'reach', 'Saves': 'saves', 'Engagement': 'engagement' }
    groups[2].addEventListener('click', function (e) {
      var b = e.target.closest('.fchip')
      if (!b) return
      groups[2].querySelectorAll('.fchip').forEach(function (x) { x.classList.remove('on') })
      b.classList.add('on')
      var txt = b.textContent.trim()
      state.sort = sortMap[txt] || 'recent'
      render()
    })

    // Search
    var searchInput = view.querySelector('.search input')
    if (searchInput) {
      var debounce = null
      searchInput.addEventListener('input', function () {
        clearTimeout(debounce)
        debounce = setTimeout(function () {
          state.search = searchInput.value.trim()
          render()
        }, 200)
      })
    }

    // View toggle (Grid / Table)
    var viewBtns = view.querySelectorAll('.list-head .view button')
    viewBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        viewBtns.forEach(function (x) { x.classList.remove('on') })
        btn.classList.add('on')
        var label = btn.textContent.trim().toLowerCase()
        if (label === 'table') state.view = 'table'
        else state.view = 'grid'
        render()
      })
    })

    // Top 10 platform dropdown
    var top5Plat = view.querySelector('.top5-plat')
    if (top5Plat) {
      top5Plat.addEventListener('change', function () {
        state.top5 = top5Plat.value
        updateTop5(view, allPosts)
      })
    }

    // Top 5 sort dropdown
    var top5Sort = view.querySelector('.top5-sort')
    if (top5Sort) {
      top5Sort.addEventListener('change', function () {
        state.top5Sort = top5Sort.value
        updateTop5(view, allPosts)
      })
    }
  }

  /* Server-side caching handles fast responses — no localStorage needed */

  /* ── apply timeseries data to UI ─────────────────── */
  function applyTimeseries(ts, view) {
    state.loadError = false
    if (!ts || !ts.posts || ts.posts.length === 0) {
      var gridEl = view.querySelector('.grid')
      if (gridEl && allPosts.length === 0) gridEl.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:48px 0;color:var(--t3);font-size:14px">No posts synced yet. Connect a platform to see your content here.</div>'
      return
    }

    acctMap = {}
    var accts = ts.accounts || (ts.account ? [ts.account] : [])
    accts.forEach(function (a) { if (a && a.id) acctMap[a.id] = a.platform })

    // Populate platform filter buttons based on connected accounts
    var platGroup = document.getElementById('platform-filters')
    if (platGroup) {
      var connected = {}
      accts.forEach(function (a) { if (a && a.platform) connected[a.platform] = true })
      var platLabels = { instagram: 'IG', tiktok: 'TikTok', youtube: 'YT' }
      var platDots = { instagram: 'ig', tiktok: 'tt', youtube: 'yt' }
      var html = '<span class="lab">Platform</span><button class="fchip on">All</button>'
      Object.keys(connected).forEach(function (plat) {
        html += '<button class="fchip"><span class="dot ' + (platDots[plat] || '') + '"></span>' + (platLabels[plat] || plat) + '</button>'
      })
      platGroup.innerHTML = html
    }

    // Populate Top 10 platform dropdown
    var top5Plat = document.querySelector('.top5-plat')
    if (top5Plat) {
      var platHtml = '<option value="all">All</option>'
      var connected2 = {}
      accts.forEach(function (a) { if (a && a.platform) connected2[a.platform] = true })
      Object.keys(connected2).forEach(function (plat) {
        var label = plat === 'instagram' ? 'IG' : plat === 'tiktok' ? 'TikTok' : plat === 'youtube' ? 'YT' : plat
        platHtml += '<option value="' + plat + '">' + label + '</option>'
      })
      top5Plat.innerHTML = platHtml
    }

    allPosts = ts.posts
    render()
  }

  /* ── fetch + populate ─────────────────────────────── */
  var fetchInFlight = false
  function populate() {
    var view = document.getElementById('view-db-posts')
    if (!view) return
    wireFilters()

    if (state.fetched && !state.loadError) { render(); return }

    fetchFresh(view)
  }

  function fetchFresh(view) {
    if (fetchInFlight) return
    fetchInFlight = true

    get('/api/platform/timeseries').then(function (ts) {
      fetchInFlight = false
      if (!view) view = document.getElementById('view-db-posts')
      if (!ts) {
        state.loadError = true
        state.fetched = false
        if (view) {
          wireFilters()
          renderPostsLoadFailure(view)
        }
        return
      }
      state.loadError = false
      state.fetched = true
      if (view) applyTimeseries(ts, view)
    })
  }

  // Background refresh — called on re-navigate to keep data fresh
  function backgroundRefresh() {
    var view = document.getElementById('view-db-posts')
    if (!view || fetchInFlight) return
    fetchInFlight = true
    get('/api/platform/timeseries').then(function (ts) {
      fetchInFlight = false
      if (!ts) return
      state.loadError = false
      applyTimeseries(ts, view)
    })
  }

  /* ── navigation hook ──────────────────────────────── */
  var origNav = window.navigate
  window.navigate = function (id) {
    var r = typeof origNav === 'function' ? origNav(id) : undefined
    if (id === 'db-posts') {
      setTimeout(function () {
        populate()
        // If already loaded, trigger background refresh for fresh data
        if (state.fetched) backgroundRefresh()
      }, 150)
    }
    return r
  }
})()
