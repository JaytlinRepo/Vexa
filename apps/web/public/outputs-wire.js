/* Vexa — outputs library (#view-db-outputs): render every Output record as a
 * card, with a type filter that re-queries the API.
 */
;(function () {
  let outputs = []
  let currentType = 'all'

  const TYPE_LABEL = {
    trend_report: 'Trend Report',
    content_plan: 'Content Plan',
    hooks: 'Hooks',
    caption: 'Caption',
    script: 'Script',
    shot_list: 'Shot List',
    video: 'Video',
  }

  const FILTER_TYPES = [
    { key: 'all', label: 'All' },
    { key: 'hooks', label: 'Hooks' },
    { key: 'script', label: 'Scripts' },
    { key: 'content_plan', label: 'Content plans' },
    { key: 'trend_report', label: 'Trend reports' },
    { key: 'shot_list', label: 'Shot lists' },
    { key: 'video', label: 'Videos' },
  ]

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    } catch {
      return ''
    }
  }

  async function fetchOutputs() {
    const url = currentType === 'all'
      ? '/api/outputs'
      : '/api/outputs?type=' + encodeURIComponent(currentType)
    try {
      const res = await fetch(url, { credentials: 'include' })
      if (!res.ok) return []
      const json = await res.json()
      return json.outputs || []
    } catch {
      return []
    }
  }

  function cardHTML(o) {
    const emp = o.employee?.name || 'Vexa'
    const title = o.task?.title || TYPE_LABEL[o.type] || 'Output'
    const badge = o.status || 'draft'
    return `
      <div class="output-item" data-output-id="${o.id}">
        <div class="output-item-top">
          <span class="output-item-type">${escapeHtml(TYPE_LABEL[o.type] || o.type)}</span>
          <span class="output-item-badge">${escapeHtml(badge[0].toUpperCase() + badge.slice(1))}</span>
        </div>
        <div class="output-item-title">${escapeHtml(title)}</div>
        <div class="output-item-meta">${escapeHtml(emp)} · ${escapeHtml(fmtDate(o.createdAt))}</div>
        <div class="output-item-actions">
          <button class="ab recon" style="font-size:10px;padding:6px 12px" data-view="${o.id}">View</button>
          <button class="ab recon" style="font-size:10px;padding:6px 12px" data-export="${o.id}">Export</button>
        </div>
      </div>
    `
  }

  function renderFilterBar(host) {
    const bar = host.querySelector('.outputs-filter')
    if (!bar) return
    bar.innerHTML = FILTER_TYPES.map(
      (f) => `<button class="filter-btn ${currentType === f.key ? 'active' : ''}" data-type="${f.key}">${escapeHtml(f.label)}</button>`,
    ).join('')
    bar.querySelectorAll('button[data-type]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        currentType = btn.dataset.type
        await render()
      })
    })
  }

  async function render() {
    // Outputs library can live in two places: the standalone view and the
    // unified Work page. Render into every host marked [data-outputs-host]
    // (Work page) plus the original #view-db-outputs (standalone).
    const hosts = Array.from(document.querySelectorAll('[data-outputs-host], #view-db-outputs'))
    if (hosts.length === 0) return

    outputs = await fetchOutputs()

    hosts.forEach((host) => {
      renderFilterBar(host)
      let grid = host.querySelector('.output-grid, .outputs-grid, [data-outputs-grid]')
      if (!grid) {
        grid = document.createElement('div')
        grid.dataset.outputsGrid = '1'
        grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;margin-top:18px'
        host.appendChild(grid)
      }
      if (outputs.length === 0) {
        grid.innerHTML = '<div style="padding:32px;text-align:center;color:var(--t3);font-size:13px;grid-column:1/-1;border:1px dashed var(--b1);border-radius:12px">No outputs yet. As your team delivers work it will land here.</div>'
        return
      }
      grid.innerHTML = outputs.map(cardHTML).join('')
      grid.querySelectorAll('[data-view]').forEach((btn) => {
        btn.addEventListener('click', () => openDetail(btn.dataset.view))
      })
      grid.querySelectorAll('[data-export]').forEach((btn) => {
        btn.addEventListener('click', () => exportOutput(btn.dataset.export))
      })
    })
  }

  function openDetail(id) {
    const o = outputs.find((x) => x.id === id)
    if (!o) return
    const overlay = document.createElement('div')
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:8000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);padding:24px'
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })
    const panel = document.createElement('div')
    panel.style.cssText =
      'width:100%;max-width:680px;max-height:80vh;overflow:auto;background:var(--s1);border:1px solid var(--b1);border-radius:14px;padding:28px;color:var(--t1);font-family:"DM Sans",sans-serif'
    const pretty = JSON.stringify(o.content, null, 2)
    panel.innerHTML = `
      <div style="display:flex;align-items:start;justify-content:space-between;gap:12px;margin-bottom:16px">
        <div>
          <div style="font-size:11px;color:var(--t3);letter-spacing:.12em;text-transform:uppercase;margin-bottom:4px">${escapeHtml(TYPE_LABEL[o.type] || o.type)}</div>
          <h2 style="font-family:'Cormorant Garamond',serif;font-weight:500;font-size:28px;margin:0">${escapeHtml(o.task?.title || 'Output')}</h2>
          <div style="font-size:12px;color:var(--t2);margin-top:4px">${escapeHtml(o.employee?.name || '')} · ${escapeHtml(fmtDate(o.createdAt))}</div>
        </div>
        <button style="background:none;border:none;color:var(--t2);font-size:22px;cursor:pointer" aria-label="Close">×</button>
      </div>
      <pre style="background:var(--s2);border:1px solid var(--b1);border-radius:10px;padding:14px;overflow:auto;font-size:12px;line-height:1.6;color:var(--t2);white-space:pre-wrap">${escapeHtml(pretty)}</pre>
    `
    panel.querySelector('button[aria-label="Close"]').addEventListener('click', () => overlay.remove())
    overlay.appendChild(panel)
    document.body.appendChild(overlay)
  }

  function exportOutput(id) {
    const o = outputs.find((x) => x.id === id)
    if (!o) return
    const blob = new Blob([JSON.stringify(o, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${o.type}-${o.id.slice(0, 8)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const origNavigate = window.navigate
  window.navigate = function (id) {
    const r = typeof origNavigate === 'function' ? origNavigate(id) : undefined
    if (id === 'db-outputs' || id === 'db-tasks') setTimeout(render, 80)
    return r
  }

  const prevEnter = window.enterDashboard
  window.enterDashboard = async function () {
    if (typeof prevEnter === 'function') await prevEnter()
    setTimeout(render, 350)
  }

  // Exposed so work-wire.js can repopulate the Outputs section of the
  // unified Work page right after it builds the host containers.
  window.vxRenderOutputs = render
})()
