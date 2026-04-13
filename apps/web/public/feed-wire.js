/* Vexa — knowledge feed: render real items from /api/feed into the two feed
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

  function cardHTML(item) {
    return `
      <div class="feed-card tall" data-type="${escapeHtml(item.type)}" data-type2="${escapeHtml(item.type)}">
        <div class="feed-top">
          <span class="feed-src">${escapeHtml(item.source)}</span>
          <span class="feed-dt">${escapeHtml(timeAgo(item.createdAt))}</span>
        </div>
        <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener" class="feed-title">${escapeHtml(item.title)}</a>
        <p class="feed-sum">${escapeHtml(item.summary)}</p>
        <div class="feed-insight"><strong>Maya's take</strong>${escapeHtml(item.mayaTake)}</div>
        <div class="feed-score">
          <div class="feed-score-row">
            <span class="feed-score-lbl">Content potential</span>
            <span class="feed-score-val">${item.score}</span>
          </div>
          <div class="feed-bar-s"><div class="feed-bar-fill" style="width:${item.score}%"></div></div>
        </div>
        <div class="feed-actions">
          <button class="feed-act main" onclick="startOnboarding()">Turn into content</button>
          <a class="feed-act read" href="${escapeHtml(item.url)}" target="_blank" rel="noopener" style="text-decoration:none;display:inline-flex;align-items:center">Read</a>
        </div>
      </div>
    `
  }

  function renderInto(gridSelector) {
    const grid = document.querySelector(gridSelector)
    if (!grid) return
    grid.innerHTML = state.items.map(cardHTML).join('')
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

  // Initial best-effort: if the feed grids exist and the user is on the
  // marketing /knowledge view by default, populate those too.
  document.addEventListener('DOMContentLoaded', () => {
    if (document.querySelector('#mkt-feed-grid') || document.querySelector('#db-feed-grid')) {
      setTimeout(() => load(), 600)
    }
  })
})()
