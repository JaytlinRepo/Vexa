/* Sovexa — knowledge feed: render real items from /api/feed into the two feed
 * grids (#mkt-feed-grid and #db-feed-grid). Keeps the prototype's switchFeed
 * tab filter working by setting data-type / data-type2 attributes on each
 * rendered card.
 */
;(function () {
  const state = {
    items: [],
    loaded: false,
    loading: false,
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  function timeAgo(iso) {
    const d = new Date(iso).getTime()
    const diff = Math.max(0, Date.now() - d)
    const m = Math.floor(diff / 60000)
    if (m < 60) return m + 'm ago'
    const h = Math.floor(m / 60)
    if (h < 24) return h + 'h ago'
    return Math.floor(h / 24) + 'd ago'
  }

  function typeBadge(item) {
    if (item.type === 'trend') {
      var v = (item.summary || '').split(' — ')[0] || ''
      if (!v) return ''
      var color = v === 'Act now' ? '#34d27a' : v === 'Build content' ? '#e8c87a' : 'var(--t3)'
      return '<span style="display:inline-block;font-size:9px;letter-spacing:.1em;text-transform:uppercase;padding:3px 8px;border-radius:8px;border:1px solid ' + color + ';color:' + color + ';margin-left:8px">' + escapeHtml(v) + '</span>'
    }
    if (item.type === 'video') {
      return '<span style="display:inline-block;font-size:9px;letter-spacing:.1em;text-transform:uppercase;padding:3px 8px;border-radius:8px;border:1px solid #a78bfa;color:#a78bfa;margin-left:8px">Video</span>'
    }
    return ''
  }

  function videoCardHTML(item) {
    var ytId = (item.id || '').replace('yt_', '')
    var thumb = item.imageUrl || ''
    return '<div class="feed-card tall" data-type="video" data-type2="video" style="border-left:3px solid #a78bfa;padding:0;overflow:hidden">'
      + '<div data-vx-yt="' + escapeHtml(ytId) + '" style="position:relative;aspect-ratio:9/16;max-height:480px;background:#000;overflow:hidden;cursor:pointer">'
      + (thumb ? '<img src="' + escapeHtml(thumb) + '" alt="" style="width:100%;height:100%;object-fit:cover;display:block" loading="lazy" />' : '')
      + '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.25)">'
      + '<div style="width:52px;height:52px;border-radius:50%;background:rgba(255,255,255,.92);display:flex;align-items:center;justify-content:center"><div style="width:0;height:0;border-left:18px solid #111;border-top:11px solid transparent;border-bottom:11px solid transparent;margin-left:4px"></div></div>'
      + '</div></div>'
      + '<div style="padding:14px 16px">'
      + '<div class="feed-top" style="margin-bottom:6px"><span class="feed-src">' + escapeHtml(item.source) + typeBadge(item) + '</span><span class="feed-dt">' + escapeHtml(timeAgo(item.createdAt)) + '</span></div>'
      + '<div class="feed-title" style="font-size:14px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + escapeHtml(item.title) + '</div>'
      + '<p class="feed-sum" style="margin-top:6px;font-size:12px;-webkit-line-clamp:2">' + escapeHtml(item.summary) + '</p>'
      + '<div class="feed-insight" style="margin-top:8px"><strong>Maya\'s take</strong>' + escapeHtml(item.mayaTake) + '</div>'
      + '</div></div>'
  }

  function articleCardHTML(item) {
    var isTrend = item.type === 'trend'
    var borderAccent = isTrend ? 'border-left:3px solid #34d27a;' : ''
    var authorLine = item.author ? '<span style="color:var(--t3);font-size:11px;margin-left:8px">by ' + escapeHtml(item.author) + '</span>' : ''
    var isArticle = item.type === 'article' || item.type === 'reddit'
    var sumText = (item.summary || '').trim()
    var showSummary = sumText.length > 60 && sumText !== item.title
    return '<div class="feed-card" data-type="' + escapeHtml(item.type) + '" data-type2="' + escapeHtml(item.type) + '" style="' + borderAccent + '">'
      + '<div class="feed-top"><span class="feed-src">' + escapeHtml(item.source) + authorLine + typeBadge(item) + '</span><span class="feed-dt">' + escapeHtml(timeAgo(item.createdAt)) + '</span></div>'
      + '<div class="feed-title" style="cursor:pointer" data-vx-read-article="' + escapeHtml(item.id) + '">' + escapeHtml(item.title) + '</div>'
      + (showSummary ? '<p class="feed-sum">' + escapeHtml(sumText) + '</p>' : '')
      + '<div class="feed-insight"><strong>Maya\'s take</strong>' + escapeHtml(item.mayaTake) + '</div>'
      + '<div class="feed-actions"><button class="feed-act main" data-vx-read-article="' + escapeHtml(item.id) + '">Read</button><a class="feed-act read" href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener" style="text-decoration:none;display:inline-flex;align-items:center">Source</a></div>'
      + '</div>'
  }

  function openArticleReader(itemId) {
    var item = state.items.find(function (i) { return i.id === itemId })
    if (!item) return

    // If no full content, fetch it on demand
    if (!item.fullContent) {
      fetchArticleContent(item)
      return
    }
    document.getElementById('vx-article-reader')?.remove()
    var el = document.createElement('div')
    el.id = 'vx-article-reader'
    el.style.cssText = 'position:fixed;inset:0;z-index:9200;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(6px)'
    el.innerHTML = '<div style="width:100%;max-width:680px;max-height:90vh;background:var(--bg);border:1px solid var(--b1);border-radius:14px;overflow:hidden;display:flex;flex-direction:column">'
      + '<div style="padding:20px 24px;border-bottom:1px solid var(--b1);display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-shrink:0">'
      + '<div style="min-width:0"><div style="color:var(--t3);font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px">' + escapeHtml(item.source) + (item.author ? ' · ' + escapeHtml(item.author) : '') + '</div>'
      + '<div style="color:var(--t1);font-size:18px;font-weight:500;line-height:1.3;font-family:\'Cormorant Garamond\',serif;font-style:italic">' + escapeHtml(item.title) + '</div></div>'
      + '<div style="display:flex;gap:8px;flex-shrink:0">'
      + '<a href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener" style="color:var(--t2);font-size:11px;padding:6px 12px;border:1px solid var(--b2);border-radius:8px;text-decoration:none;white-space:nowrap">Open source</a>'
      + '<button id="vx-reader-close" style="color:var(--t3);font-size:18px;background:none;border:none;cursor:pointer;padding:4px 8px;line-height:1">&times;</button>'
      + '</div></div>'
      + '<div style="flex:1;overflow-y:auto;padding:24px 28px;color:var(--t2);font-size:15px;line-height:1.85;font-family:\'DM Sans\',sans-serif">'
      + '<div class="vx-reader-body">' + item.fullContent + '</div>'
      + '</div></div>'
    el.addEventListener('click', function (e) { if (e.target === el) el.remove() })
    document.body.appendChild(el)
    el.querySelector('#vx-reader-close').addEventListener('click', function () { el.remove() })

    // Style the article content
    var body = el.querySelector('.vx-reader-body')
    if (body) {
      var st = document.createElement('style')
      st.textContent = '.vx-reader-body p{margin:0 0 16px}.vx-reader-body h1,.vx-reader-body h2,.vx-reader-body h3,.vx-reader-body h4{color:var(--t1);font-family:"Cormorant Garamond",serif;font-style:italic;margin:24px 0 12px;font-weight:400}.vx-reader-body h1{font-size:24px}.vx-reader-body h2{font-size:20px}.vx-reader-body h3{font-size:17px}.vx-reader-body ul,.vx-reader-body ol{margin:0 0 16px;padding-left:24px}.vx-reader-body li{margin-bottom:6px}.vx-reader-body a{color:var(--t1);text-decoration:underline;text-decoration-color:var(--b2)}.vx-reader-body a:hover{text-decoration-color:var(--t1)}.vx-reader-body blockquote{border-left:2px solid var(--b2);padding-left:16px;margin:16px 0;color:var(--t3);font-style:italic}.vx-reader-body strong{color:var(--t1);font-weight:600}.vx-reader-body em{font-style:italic}'
      el.appendChild(st)
    }
  }

  function cardHTML(item) {
    if (item.type === 'video') return videoCardHTML(item)
    return articleCardHTML(item)
  }

  function wireVideoPlayers(container) {
    container.querySelectorAll('[data-vx-yt]').forEach(function (el) {
      if (el.dataset.vxWired) return
      el.dataset.vxWired = '1'
      el.addEventListener('click', function () {
        var id = el.dataset.vxYt
        if (!id) return
        var iframe = document.createElement('iframe')
        iframe.src = 'https://www.youtube.com/embed/' + id + '?autoplay=1&rel=0&modestbranding=1'
        iframe.style.cssText = 'width:100%;height:100%;border:none;position:absolute;inset:0'
        iframe.allow = 'autoplay;encrypted-media'
        iframe.allowFullscreen = true
        el.innerHTML = ''
        el.style.cursor = 'default'
        el.appendChild(iframe)
      })
    })
  }

  function fetchArticleContent(item) {
    // Show loading state
    document.getElementById('vx-article-reader')?.remove()
    var el = document.createElement('div')
    el.id = 'vx-article-reader'
    el.style.cssText = 'position:fixed;inset:0;z-index:9200;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(6px)'
    el.innerHTML = '<div style="background:var(--bg);border:1px solid var(--b1);border-radius:14px;padding:32px;text-align:center;color:var(--t2);font-size:13px">Loading article...</div>'
    el.addEventListener('click', function (e) { if (e.target === el) el.remove() })
    document.body.appendChild(el)

    fetch('/api/feed/article?url=' + encodeURIComponent(item.url), { credentials: 'include' })
      .then(function (r) { return r.json() })
      .then(function (data) {
        if (data.content) {
          item.fullContent = data.content
          el.remove()
          openArticleReader(item.id)
        } else {
          // Can't extract — open source directly
          el.remove()
          window.open(item.url, '_blank')
        }
      })
      .catch(function () {
        el.remove()
        window.open(item.url, '_blank')
      })
  }

  function wireArticleReaders(container) {
    container.querySelectorAll('[data-vx-read-article]').forEach(function (el) {
      if (el.dataset.vxWired) return
      el.dataset.vxWired = '1'
      el.addEventListener('click', function (e) {
        e.preventDefault()
        openArticleReader(el.dataset.vxReadArticle)
      })
    })
  }

  function renderInto(gridSelector) {
    const grid = document.querySelector(gridSelector)
    if (!grid) return
    grid.innerHTML = state.items.map(cardHTML).join('')
    wireVideoPlayers(grid)
    wireArticleReaders(grid)
  }

  async function load(force = false) {
    if (state.loading) return
    if (state.loaded && !force) return
    state.loading = true
    try {
      const res = await fetch('/api/feed', { credentials: 'include' })
      if (!res.ok) {
        state.loading = false
        return
      }
      const json = await res.json()
      state.items = json.items || []
      state.loaded = true
      renderInto('#mkt-feed-grid')
      renderInto('#db-feed-grid')
    } finally {
      state.loading = false
    }
  }

  // Trigger load whenever the user lands on a feed view.
  const origNavigate = window.navigate
  window.navigate = function (id) {
    const r = typeof origNavigate === 'function' ? origNavigate(id) : undefined
    if (id === 'knowledge' || id === 'db-knowledge') {
      // Delay so the view fade-in doesn't fight with the re-render
      setTimeout(() => load(), 80)
    }
    return r
  }

  // Also: if user ends on feed via session restore, load on dashboard enter.
  const prevEnter = window.enterDashboard
  window.enterDashboard = async function () {
    if (typeof prevEnter === 'function') await prevEnter()
    load()
  }

})()
