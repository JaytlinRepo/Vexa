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

  // ── PRETTY RENDERERS BY OUTPUT TYPE ──────────────────────────────
  // The Outputs Library is the place a CEO actually consumes work, so
  // raw JSON was never the right surface. Each renderer below produces
  // the readable view a content team would expect. Falls back to JSON
  // for unknown shapes.

  // ── TREND REPORT ─────────────────────────────────────────────────
  // Each trend gets:
  //   • Color-coded urgency stripe (act now / build / skip)
  //   • Sparkline of the last 7 days (visual at a glance)
  //   • Growth + window
  //   • Audience-fit line
  //   • Three Maya-voiced callouts: insight / action / solution
  // Falls back gracefully if a trend was seeded with the older shape
  // (just topic/growth/window/verdict).
  const URGENCY = {
    act_now: { label: 'Act now', tint: '#e8a04b', bg: 'rgba(232,160,75,.14)', border: 'rgba(232,160,75,.55)' },
    build:   { label: 'Build for the month', tint: '#7eb39a', bg: 'rgba(126,179,154,.14)', border: 'rgba(126,179,154,.55)' },
    skip:    { label: 'Skip', tint: '#9c9c9c', bg: 'rgba(156,156,156,.10)', border: 'rgba(156,156,156,.45)' },
  }

  function sparklineSvg(values, tint) {
    const arr = Array.isArray(values) && values.length ? values : []
    if (arr.length < 2) return ''
    const W = 220, H = 56, padT = 6, padB = 6
    const min = Math.min(...arr), max = Math.max(...arr)
    const range = Math.max(1, max - min)
    const step = W / (arr.length - 1)
    const pts = arr.map((v, i) => `${(i * step).toFixed(1)},${(padT + (H - padT - padB) - ((v - min) / range) * (H - padT - padB)).toFixed(1)}`).join(' ')
    const last = arr[arr.length - 1]
    const lastX = ((arr.length - 1) * step).toFixed(1)
    const lastY = (padT + (H - padT - padB) - ((last - min) / range) * (H - padT - padB)).toFixed(1)
    return `
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" style="display:block">
        <polygon points="0,${H} ${pts} ${W},${H}" fill="${tint}" fill-opacity="0.13" />
        <polyline points="${pts}" fill="none" stroke="${tint}" stroke-width="2" stroke-linejoin="round" />
        <circle cx="${lastX}" cy="${lastY}" r="3.5" fill="${tint}" />
      </svg>
    `
  }

  function callout(label, body, tint) {
    return `
      <div style="background:var(--s2);border:1px solid var(--b1);border-radius:8px;padding:11px 14px">
        <div style="font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:${tint};font-weight:700;margin-bottom:6px;font-family:'Syne',sans-serif">${escapeHtml(label)}</div>
        <div style="color:var(--t1);font-size:13px;line-height:1.55">${escapeHtml(body)}</div>
      </div>
    `
  }

  function rTrendReport(c) {
    const trends = Array.isArray(c.trends) ? c.trends : []
    if (!trends.length) return null
    const generatedLine = c.generatedAt
      ? `<div style="color:var(--t3);font-size:11px;letter-spacing:.06em;margin-bottom:18px">Pulled ${escapeHtml(fmtDate(c.generatedAt))} · ${trends.length} trend${trends.length === 1 ? '' : 's'} flagged · Maya</div>`
      : ''
    return generatedLine + `
      <div style="display:flex;flex-direction:column;gap:18px">
        ${trends.map((t, i) => {
          const u = URGENCY[t.urgency] || URGENCY.build
          return `
            <article style="background:var(--s1);border:1px solid var(--b1);border-radius:12px;overflow:hidden">
              <div style="background:${u.bg};border-bottom:1px solid ${u.border};padding:14px 18px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
                <div style="display:flex;align-items:center;gap:14px;min-width:0">
                  <span style="background:${u.tint};color:#fff;font-size:9px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;padding:4px 10px;border-radius:999px;font-family:'Syne',sans-serif">${escapeHtml(u.label)}</span>
                  <span style="color:var(--t3);font-size:11px;letter-spacing:.06em;text-transform:uppercase">Window: ${escapeHtml(t.window || '—')}</span>
                </div>
                <div style="display:flex;align-items:baseline;gap:6px">
                  <span style="color:${u.tint};font-size:22px;font-weight:600;font-family:'Syne',sans-serif">${escapeHtml(t.growth || '')}</span>
                  <span style="color:var(--t3);font-size:11px">7d</span>
                </div>
              </div>
              <div style="padding:18px 20px">
                <div style="display:grid;grid-template-columns:1fr 240px;gap:18px;align-items:center;margin-bottom:14px">
                  <div>
                    <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:4px">
                      <span style="color:var(--t3);font-size:11px;font-family:'Syne',sans-serif">0${i + 1}</span>
                      <h3 style="font-family:'Cormorant Garamond',serif;font-size:24px;color:var(--t1);font-weight:500;margin:0">${escapeHtml(t.topic || '')}</h3>
                    </div>
                    ${t.audienceFit ? `<div style="color:var(--t2);font-size:12px;line-height:1.5"><span style="color:var(--t3);font-size:10px;letter-spacing:.08em;text-transform:uppercase;margin-right:6px">Audience fit</span>${escapeHtml(t.audienceFit)}</div>` : ''}
                  </div>
                  <div style="background:var(--s2);border:1px solid var(--b1);border-radius:8px;padding:10px 12px">
                    ${sparklineSvg(t.sparkline, u.tint)}
                    <div style="display:flex;justify-content:space-between;color:var(--t3);font-size:9px;margin-top:4px;letter-spacing:.06em">
                      <span>7d ago</span><span>now</span>
                    </div>
                  </div>
                </div>

                ${t.insight || t.action || t.solution
                  ? `
                    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
                      ${t.insight ? callout('Maya\'s read', t.insight, u.tint) : ''}
                      ${t.action ? callout('What to do', t.action, u.tint) : ''}
                      ${t.solution ? callout('Ship this', t.solution, u.tint) : ''}
                    </div>
                  `
                  : (t.verdict ? `<div style="color:var(--t2);font-size:13px;line-height:1.55">${escapeHtml(t.verdict)}</div>` : '')
                }
              </div>
            </article>
          `
        }).join('')}
      </div>
    `
  }

  function rContentPlan(c) {
    const posts = Array.isArray(c.posts) ? c.posts : []
    const pillars = Array.isArray(c.pillars) ? c.pillars : []
    if (!posts.length && !pillars.length) return null
    const pillarBlock = pillars.length ? `
      <div style="margin-bottom:18px">
        <div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--t3);font-family:'Syne',sans-serif;margin-bottom:8px">Pillars</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${pillars.map((p) => `<span style="background:var(--s2);border:1px solid var(--b1);color:var(--t2);font-size:12px;padding:5px 12px;border-radius:999px">${escapeHtml(p)}</span>`).join('')}
        </div>
      </div>
    ` : ''
    const postsBlock = posts.length ? `
      <div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--t3);font-family:'Syne',sans-serif;margin-bottom:8px">Posts</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${posts.map((p) => `
          <div style="display:grid;grid-template-columns:60px 90px 1fr;gap:14px;align-items:baseline;background:var(--s2);border:1px solid var(--b1);border-radius:10px;padding:14px 16px">
            <div style="font-family:'Syne',sans-serif;color:var(--t1);font-size:12px;letter-spacing:.06em;text-transform:uppercase">${escapeHtml(p.day || '')}</div>
            <div style="color:var(--t3);font-size:11px;letter-spacing:.06em;text-transform:uppercase">${escapeHtml(p.format || '')}</div>
            <div>
              <div style="color:var(--t1);font-size:14px;margin-bottom:2px">${escapeHtml(p.topic || '')}</div>
              ${p.angle ? `<div style="color:var(--t3);font-size:12px;line-height:1.45">${escapeHtml(p.angle)}</div>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    ` : ''
    return pillarBlock + postsBlock
  }

  function rHooks(c) {
    const hooks = Array.isArray(c.hooks) ? c.hooks : []
    if (!hooks.length) return null
    return `
      <div style="display:flex;flex-direction:column;gap:8px">
        ${hooks.map((h) => `
          <div style="display:flex;gap:14px;align-items:flex-start;background:${h.flagged ? 'var(--s3)' : 'var(--s2)'};border:1px solid ${h.flagged ? 'var(--t1)' : 'var(--b1)'};border-radius:10px;padding:14px 16px">
            <div style="color:var(--t3);font-family:'Syne',sans-serif;font-size:12px;flex-shrink:0;width:24px">${String(h.n ?? '').padStart(2, '0')}</div>
            <div style="flex:1;min-width:0">
              <div style="color:var(--t1);font-size:15px;line-height:1.5;font-family:'Cormorant Garamond',serif">${escapeHtml(h.text || '')}</div>
              ${h.flagged ? `<div style="color:var(--t2);font-size:10px;letter-spacing:.1em;text-transform:uppercase;margin-top:6px">Recommended</div>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `
  }

  function rShotList(c) {
    const shots = Array.isArray(c.shots) ? c.shots : []
    const meta = `
      <div style="display:flex;gap:18px;color:var(--t3);font-size:12px;margin-bottom:18px">
        ${c.reelTitle ? `<span><span style="color:var(--t3)">Reel:</span> <span style="color:var(--t1)">${escapeHtml(c.reelTitle)}</span></span>` : ''}
        ${c.duration ? `<span><span style="color:var(--t3)">Duration:</span> <span style="color:var(--t1)">${escapeHtml(c.duration)}</span></span>` : ''}
      </div>
    `
    const shotsBlock = shots.length ? `
      <div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--t3);font-family:'Syne',sans-serif;margin-bottom:8px">Shot list</div>
      <ol style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px">
        ${shots.map((s) => `
          <li style="display:grid;grid-template-columns:42px 70px 1fr;gap:14px;align-items:baseline;background:var(--s2);border:1px solid var(--b1);border-radius:10px;padding:12px 14px">
            <div style="font-family:'Syne',sans-serif;color:var(--t3);font-size:12px">${String(s.n ?? '').padStart(2, '0')}</div>
            <div style="color:var(--t2);font-size:11px;font-variant-numeric:tabular-nums">${escapeHtml(s.at || '')}</div>
            <div>
              <div style="color:var(--t1);font-size:13px;margin-bottom:2px">${escapeHtml(s.shot || '')}</div>
              ${s.note ? `<div style="color:var(--t3);font-size:11px">${escapeHtml(s.note)}</div>` : ''}
            </div>
          </li>
        `).join('')}
      </ol>
    ` : ''
    const notes = []
    if (c.soundNote) notes.push({ label: 'Sound', text: c.soundNote })
    if (c.editorNote) notes.push({ label: 'Editor', text: c.editorNote })
    const notesBlock = notes.length ? `
      <div style="margin-top:18px;display:flex;flex-direction:column;gap:8px">
        ${notes.map((n) => `
          <div style="background:var(--s2);border-left:3px solid var(--t2);padding:10px 14px;border-radius:6px">
            <div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--t3);margin-bottom:2px">${escapeHtml(n.label)}</div>
            <div style="color:var(--t2);font-size:13px;line-height:1.5">${escapeHtml(n.text)}</div>
          </div>
        `).join('')}
      </div>
    ` : ''
    return meta + shotsBlock + notesBlock
  }

  function rCaption(c) {
    const text = typeof c === 'string' ? c : (c.text || c.caption || '')
    if (!text) return null
    return `<div style="background:var(--s2);border:1px solid var(--b1);border-radius:10px;padding:18px 20px;color:var(--t1);font-family:'Cormorant Garamond',serif;font-size:17px;line-height:1.6;white-space:pre-wrap">${escapeHtml(text)}</div>`
  }

  function rScript(c) {
    if (typeof c === 'string') return rCaption(c)
    if (typeof c.script === 'string') return rCaption({ text: c.script })
    if (Array.isArray(c.beats)) {
      return `
        <div style="display:flex;flex-direction:column;gap:8px">
          ${c.beats.map((b, i) => `
            <div style="background:var(--s2);border:1px solid var(--b1);border-radius:10px;padding:12px 14px">
              <div style="color:var(--t3);font-size:10px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px;font-family:'Syne',sans-serif">Beat ${i + 1}${b.at ? ' · ' + escapeHtml(b.at) : ''}</div>
              <div style="color:var(--t1);font-size:14px;line-height:1.55">${escapeHtml(b.text || b.line || '')}</div>
            </div>
          `).join('')}
        </div>
      `
    }
    return null
  }

  function renderContentByType(type, content) {
    if (!content || typeof content !== 'object') return null
    switch (type) {
      case 'trend_report': return rTrendReport(content)
      case 'content_plan': return rContentPlan(content)
      case 'hooks':        return rHooks(content)
      case 'shot_list':    return rShotList(content)
      case 'caption':      return rCaption(content)
      case 'script':       return rScript(content)
      default:             return null
    }
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
      'width:100%;max-width:720px;max-height:84vh;overflow:auto;background:var(--s1);border:1px solid var(--b1);border-radius:14px;padding:28px;color:var(--t1);font-family:"DM Sans",sans-serif'

    const pretty = renderContentByType(o.type, o.content)
    const fallback = `<pre style="background:var(--s2);border:1px solid var(--b1);border-radius:10px;padding:14px;overflow:auto;font-size:12px;line-height:1.6;color:var(--t2);white-space:pre-wrap">${escapeHtml(JSON.stringify(o.content, null, 2))}</pre>`
    const body = pretty || fallback

    panel.innerHTML = `
      <div style="display:flex;align-items:start;justify-content:space-between;gap:12px;margin-bottom:18px">
        <div>
          <div style="font-size:11px;color:var(--t3);letter-spacing:.12em;text-transform:uppercase;margin-bottom:4px">${escapeHtml(TYPE_LABEL[o.type] || o.type)}</div>
          <h2 style="font-family:'Cormorant Garamond',serif;font-weight:500;font-size:28px;margin:0">${escapeHtml(o.task?.title || 'Output')}</h2>
          <div style="font-size:12px;color:var(--t2);margin-top:4px">${escapeHtml(o.employee?.name || '')} · ${escapeHtml(fmtDate(o.createdAt))}</div>
        </div>
        <button style="background:none;border:none;color:var(--t2);font-size:22px;cursor:pointer;line-height:1" aria-label="Close">×</button>
      </div>
      <div id="vx-out-body">${body}</div>
      ${pretty ? `
        <details style="margin-top:18px">
          <summary style="cursor:pointer;color:var(--t3);font-size:11px;letter-spacing:.08em;text-transform:uppercase">Show raw JSON</summary>
          <pre style="margin-top:10px;background:var(--s2);border:1px solid var(--b1);border-radius:10px;padding:14px;overflow:auto;font-size:12px;line-height:1.6;color:var(--t2);white-space:pre-wrap">${escapeHtml(JSON.stringify(o.content, null, 2))}</pre>
        </details>
      ` : ''}
    `
    panel.querySelector('button[aria-label="Close"]').addEventListener('click', () => overlay.remove())
    overlay.appendChild(panel)
    document.body.appendChild(overlay)
    document.addEventListener('keydown', function onEsc(ev) {
      if (ev.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc) }
    })
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
