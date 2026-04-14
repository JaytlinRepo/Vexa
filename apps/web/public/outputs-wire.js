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

  function signalsGrid(signals) {
    if (!Array.isArray(signals) || !signals.length) return ''
    return `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin:14px 0">
        ${signals.map((s) => `
          <div style="background:var(--s2);border:1px solid var(--b1);border-radius:8px;padding:10px 12px">
            <div style="font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--t3);margin-bottom:4px">${escapeHtml(s.label)}</div>
            <div style="font-family:'Syne',sans-serif;color:var(--t1);font-size:14px;font-weight:500;line-height:1.3">${escapeHtml(s.value)}</div>
          </div>
        `).join('')}
      </div>
    `
  }

  function paragraphCallout(label, body, tint) {
    return `
      <div style="background:var(--s2);border-left:3px solid ${tint};border-top:1px solid var(--b1);border-right:1px solid var(--b1);border-bottom:1px solid var(--b1);border-radius:6px;padding:14px 16px">
        <div style="font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:${tint};font-weight:700;margin-bottom:6px;font-family:'Syne',sans-serif">${escapeHtml(label)}</div>
        <div style="color:var(--t1);font-size:13px;line-height:1.65">${escapeHtml(body)}</div>
      </div>
    `
  }

  function predictedSplit(predicted, tint) {
    if (!predicted) return ''
    const cell = (label, body, tone) => `
      <div style="background:var(--s2);border:1px solid var(--b1);border-radius:8px;padding:14px 16px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="width:6px;height:6px;border-radius:50%;background:${tone}"></span>
          <span style="font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:${tone};font-weight:700;font-family:'Syne',sans-serif">${escapeHtml(label)}</span>
        </div>
        <div style="color:var(--t1);font-size:13px;line-height:1.6">${escapeHtml(body)}</div>
      </div>
    `
    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">
        ${predicted.ifAct ? cell('If you act', predicted.ifAct, tint) : ''}
        ${predicted.ifSkip ? cell('If you skip', predicted.ifSkip, '#9c9c9c') : ''}
      </div>
    `
  }

  function rTrendReport(c) {
    const trends = Array.isArray(c.trends) ? c.trends : []
    if (!trends.length) return null
    const generatedLine = c.generatedAt
      ? `<div style="color:var(--t3);font-size:11px;letter-spacing:.06em;margin-bottom:22px">Pulled ${escapeHtml(fmtDate(c.generatedAt))} · ${trends.length} trend${trends.length === 1 ? '' : 's'} flagged · Maya</div>`
      : ''
    return generatedLine + `
      <div style="display:flex;flex-direction:column;gap:24px">
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
              <div style="padding:20px 22px">
                <div style="display:grid;grid-template-columns:1fr 240px;gap:18px;align-items:center;margin-bottom:18px">
                  <div>
                    <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:6px">
                      <span style="color:var(--t3);font-size:11px;font-family:'Syne',sans-serif">0${i + 1}</span>
                      <h3 style="font-family:'Cormorant Garamond',serif;font-size:26px;color:var(--t1);font-weight:500;margin:0">${escapeHtml(t.topic || '')}</h3>
                    </div>
                    ${t.audienceFit ? `<div style="color:var(--t2);font-size:13px;line-height:1.6"><span style="color:var(--t3);font-size:10px;letter-spacing:.08em;text-transform:uppercase;margin-right:8px;font-family:'Syne',sans-serif">Audience fit</span>${escapeHtml(t.audienceFit)}</div>` : ''}
                  </div>
                  <div style="background:var(--s2);border:1px solid var(--b1);border-radius:8px;padding:10px 12px">
                    ${sparklineSvg(t.sparkline, u.tint)}
                    <div style="display:flex;justify-content:space-between;color:var(--t3);font-size:9px;margin-top:4px;letter-spacing:.06em">
                      <span>7d ago</span><span>now</span>
                    </div>
                  </div>
                </div>

                ${t.whyNow ? paragraphCallout('Why now', t.whyNow, u.tint) : ''}

                ${signalsGrid(t.signals)}

                ${t.competitorMoves ? `
                  <div style="background:var(--s2);border:1px solid var(--b1);border-radius:8px;padding:14px 16px;margin-bottom:14px">
                    <div style="font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--t3);font-weight:700;margin-bottom:6px;font-family:'Syne',sans-serif">Competitor activity</div>
                    <div style="color:var(--t2);font-size:13px;line-height:1.6">${escapeHtml(t.competitorMoves)}</div>
                  </div>
                ` : ''}

                ${predictedSplit(t.predictedOutcome, u.tint)}

                ${t.insight || t.action || t.solution ? `
                  <div style="margin-top:18px;display:flex;flex-direction:column;gap:10px">
                    ${t.insight ? paragraphCallout('Maya\'s read', t.insight, u.tint) : ''}
                    ${t.action ? paragraphCallout('The play', t.action, u.tint) : ''}
                    ${t.solution ? paragraphCallout('Maya is briefing the team', t.solution, u.tint) : ''}
                  </div>
                ` : (t.verdict ? `<div style="color:var(--t2);font-size:13px;line-height:1.6;margin-top:14px">${escapeHtml(t.verdict)}</div>` : '')
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

  // ── Shared building blocks for the briefKind-specific renderers ────────
  function reportHeader(headline, sub) {
    return `
      <div style="margin-bottom:18px">
        ${headline ? `<div style="font-family:'Cormorant Garamond',serif;font-size:24px;color:var(--t1);font-weight:500;line-height:1.2">${escapeHtml(headline)}</div>` : ''}
        ${sub ? `<div style="color:var(--t3);font-size:12px;margin-top:4px">${escapeHtml(sub)}</div>` : ''}
      </div>
    `
  }
  function reportNote(text) {
    if (!text) return ''
    return `<div style="background:var(--s2);border-left:3px solid var(--t2);border-radius:6px;padding:10px 14px;color:var(--t2);font-size:12px;line-height:1.55;margin-bottom:14px">${escapeHtml(text)}</div>`
  }
  function reportSectionLabel(text) {
    return `<div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--t3);font-family:'Syne',sans-serif;margin:18px 0 8px">${escapeHtml(text)}</div>`
  }
  function reportCard(title, body, accent) {
    return `
      <div style="background:var(--s2);border:1px solid var(--b1);border-${accent ? 'left:3px solid ' + accent + ';border-' : ''}radius:10px;padding:14px 16px;margin-bottom:10px">
        ${title ? `<div style="font-family:'Syne',sans-serif;color:var(--t1);font-size:13px;font-weight:600;letter-spacing:.04em;margin-bottom:6px">${escapeHtml(title)}</div>` : ''}
        <div style="color:var(--t2);font-size:13px;line-height:1.55">${body}</div>
      </div>
    `
  }
  function reportKVRow(label, value) {
    return `
      <div style="display:flex;gap:12px;padding:6px 0;border-bottom:1px solid var(--b1)">
        <div style="font-size:10px;color:var(--t3);letter-spacing:.08em;text-transform:uppercase;flex:0 0 140px">${escapeHtml(label)}</div>
        <div style="color:var(--t1);font-size:13px;line-height:1.5">${escapeHtml(String(value))}</div>
      </div>
    `
  }

  // ── Competitor scan ─────────────────────────────────────────────
  function rCompetitorScan(c) {
    const plays = Array.isArray(c.plays) ? c.plays : (Array.isArray(c.competitors) ? c.competitors : [])
    if (!plays.length) return null
    return reportHeader(c.headline || 'Competitor scan', c.forCreator) +
      reportNote(c.note) +
      plays.map((p) => `
        <div style="background:var(--s2);border:1px solid var(--b1);border-radius:12px;padding:16px 18px;margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;gap:10px;flex-wrap:wrap">
            <div style="font-family:'Syne',sans-serif;color:var(--t1);font-size:14px;font-weight:600">${escapeHtml(p.tier || p.name || '')}</div>
            ${p.archetype ? `<div style="color:var(--t3);font-size:11px">${escapeHtml(p.archetype)}</div>` : ''}
          </div>
          ${p.winningFormat || p.topFormat ? reportKVRow('Winning format', p.winningFormat || p.topFormat) : ''}
          ${p.winningHook || p.hookPattern ? reportKVRow('Winning hook', p.winningHook || p.hookPattern) : ''}
          ${p.winningCadence || p.posting ? reportKVRow('Cadence', p.winningCadence || p.posting) : ''}
          ${p.whatIsWorking ? `<div style="color:var(--t1);font-size:13px;line-height:1.55;margin-top:10px">${escapeHtml(p.whatIsWorking)}</div>` : ''}
          ${p.copyFromThem ? `<div style="background:rgba(126,179,154,.10);border-left:3px solid #7eb39a;padding:8px 12px;border-radius:4px;margin-top:10px;color:var(--t1);font-size:12px;line-height:1.5"><span style="color:#7eb39a;font-weight:600">Copy →</span> ${escapeHtml(p.copyFromThem)}</div>` : ''}
          ${p.dontCopy ? `<div style="background:rgba(232,160,75,.10);border-left:3px solid #e8a04b;padding:8px 12px;border-radius:4px;margin-top:6px;color:var(--t1);font-size:12px;line-height:1.5"><span style="color:#e8a04b;font-weight:600">Skip →</span> ${escapeHtml(p.dontCopy)}</div>` : ''}
        </div>
      `).join('') +
      (c.nextStep ? `<div style="background:var(--s3);border-radius:10px;padding:14px 16px;color:var(--t1);font-size:13px;line-height:1.55;margin-top:14px"><strong>Next step:</strong> ${escapeHtml(c.nextStep)}</div>` : '')
  }

  // ── Hashtag report ─────────────────────────────────────────────
  function rHashtagReport(c) {
    const buckets = Array.isArray(c.buckets) ? c.buckets : []
    if (!buckets.length) return null
    return reportHeader(c.headline || 'Hashtag report') +
      reportNote(c.note) +
      buckets.map((b) => `
        <div style="background:var(--s2);border:1px solid var(--b1);border-radius:10px;padding:14px 16px;margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
            <div style="font-family:'Syne',sans-serif;color:var(--t1);font-size:13px;font-weight:600">${escapeHtml(b.label)}</div>
          </div>
          ${b.purpose ? `<div style="color:var(--t3);font-size:11px;line-height:1.5;margin-bottom:8px">${escapeHtml(b.purpose)}</div>` : ''}
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">
            ${(b.tags || []).map((t) => `<span style="background:var(--s3);color:var(--t1);font-size:12px;padding:5px 10px;border-radius:999px">${escapeHtml(t)}</span>`).join('')}
          </div>
          ${b.note ? `<div style="color:var(--t2);font-size:11px;font-style:italic;line-height:1.5">${escapeHtml(b.note)}</div>` : ''}
        </div>
      `).join('') +
      (Array.isArray(c.avoid) && c.avoid.length ? `
        ${reportSectionLabel('Avoid')}
        <ul style="margin:0;padding-left:18px;color:var(--t2);font-size:12px;line-height:1.6">
          ${c.avoid.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}
        </ul>
      ` : '')
  }

  // ── Audience deep dive ─────────────────────────────────────────
  function rAudienceDeepDive(c) {
    return reportHeader(c.headline || 'Audience deep dive', c.dataSource ? `Data source: ${c.dataSource === 'phyllo' ? 'live Phyllo sync' : 'niche pattern (no live data yet)'}` : null) +
      (Array.isArray(c.demographics) && c.demographics.length ? `
        ${reportSectionLabel('Demographics')}
        ${c.demographics.map((d) => reportKVRow(d.label, d.value)).join('')}
      ` : '') +
      (c.peakWindows ? `
        ${reportSectionLabel('Peak engagement windows')}
        ${reportCard(c.peakWindows.label, escapeHtml(c.peakWindows.value) + (c.peakWindows.note ? `<div style="color:var(--t3);font-size:11px;margin-top:6px">${escapeHtml(c.peakWindows.note)}</div>` : ''))}
      ` : '') +
      (c.topPillars && Array.isArray(c.topPillars.items) ? `
        ${reportSectionLabel(c.topPillars.label || 'Top pillars')}
        ${c.topPillars.items.map((it) => reportKVRow(it.pillar, it.signal)).join('')}
      ` : '') +
      (c.oneThingToStop ? `
        ${reportSectionLabel('One thing to stop')}
        ${reportCard(null, escapeHtml(c.oneThingToStop), '#e8a04b')}
      ` : '') +
      (Array.isArray(c.whatWeStillDoNotKnow) && c.whatWeStillDoNotKnow.length ? `
        ${reportSectionLabel('What we still do not know')}
        <ul style="margin:0;padding-left:18px;color:var(--t3);font-size:12px;line-height:1.6">
          ${c.whatWeStillDoNotKnow.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}
        </ul>
      ` : '')
  }

  // ── Engagement diagnosis ───────────────────────────────────────
  function rEngagementDiagnosis(c) {
    const findings = Array.isArray(c.findings) ? c.findings : []
    return reportHeader(c.headline || 'Engagement diagnosis', c.dataSource ? `Data source: ${c.dataSource === 'phyllo' ? 'live Phyllo sync' : 'niche pattern (no live data yet)'}` : null) +
      (c.summary ? `<div style="color:var(--t1);font-size:14px;line-height:1.55;margin-bottom:14px">${escapeHtml(c.summary)}</div>` : '') +
      findings.map((f) => `
        <div style="background:var(--s2);border-left:3px solid #e8a04b;border-top:1px solid var(--b1);border-right:1px solid var(--b1);border-bottom:1px solid var(--b1);border-radius:6px;padding:14px 16px;margin-bottom:10px">
          <div style="font-family:'Syne',sans-serif;color:var(--t1);font-size:13px;font-weight:600;margin-bottom:6px">${escapeHtml(f.label)}</div>
          <div style="color:var(--t2);font-size:13px;line-height:1.55;margin-bottom:8px">${escapeHtml(f.detail)}</div>
          <div style="color:var(--t1);font-size:12px"><strong style="color:#7eb39a">Fix →</strong> ${escapeHtml(f.fix)}</div>
        </div>
      `).join('') +
      (c.oneFixThisWeek ? `
        ${reportSectionLabel('One fix this week')}
        ${reportCard(null, escapeHtml(c.oneFixThisWeek), '#7eb39a')}
      ` : '')
  }

  // ── Pillar rebuild ─────────────────────────────────────────────
  function rPillarRebuild(c) {
    const pillars = Array.isArray(c.pillars) ? c.pillars : []
    return reportHeader(c.headline || 'Pillar rebuild') +
      pillars.map((p) => `
        <div style="background:var(--s2);border:1px solid var(--b1);border-radius:10px;padding:14px 16px;margin-bottom:10px">
          <div style="font-family:'Cormorant Garamond',serif;color:var(--t1);font-size:18px;font-weight:500;margin-bottom:8px">${escapeHtml(p.name)}</div>
          ${p.whatItIs ? reportKVRow('What it is', p.whatItIs) : ''}
          ${p.whoItIsFor ? reportKVRow('Who it is for', p.whoItIsFor) : ''}
          ${p.examplePost ? reportKVRow('Example post', p.examplePost) : ''}
          ${p.cadence ? reportKVRow('Cadence', p.cadence) : ''}
        </div>
      `).join('') +
      (c.proposedCadence ? reportSectionLabel('Proposed cadence') + reportCard(null, escapeHtml(c.proposedCadence)) : '') +
      (c.killedWhat ? reportSectionLabel('Killed') + reportCard(null, escapeHtml(c.killedWhat), '#e8a04b') : '')
  }

  // ── Cadence plan ───────────────────────────────────────────────
  function rCadencePlan(c) {
    const sched = Array.isArray(c.schedule) ? c.schedule : []
    return reportHeader(c.headline || 'Cadence plan') +
      (c.summary ? `<div style="color:var(--t1);font-size:14px;line-height:1.55;margin-bottom:14px">${escapeHtml(c.summary)}</div>` : '') +
      (sched.length ? `
        ${reportSectionLabel('Schedule')}
        ${sched.map((s) => `
          <div style="display:grid;grid-template-columns:60px 90px 1fr;gap:14px;align-items:baseline;background:var(--s2);border:1px solid var(--b1);border-radius:10px;padding:12px 14px;margin-bottom:8px">
            <div style="font-family:'Syne',sans-serif;color:var(--t1);font-size:13px;font-weight:600">${escapeHtml(s.day)}</div>
            <div style="color:var(--t2);font-size:11px">${escapeHtml(s.slot || '')}</div>
            <div>
              <div style="color:var(--t1);font-size:13px">${escapeHtml(s.format || '')}</div>
              ${s.reason ? `<div style="color:var(--t3);font-size:11px;line-height:1.5;margin-top:2px">${escapeHtml(s.reason)}</div>` : ''}
            </div>
          </div>
        `).join('')}
      ` : '') +
      (c.storyCadence ? reportSectionLabel('Stories') + reportCard(null, escapeHtml(c.storyCadence)) : '') +
      (Array.isArray(c.avoid) && c.avoid.length ? `
        ${reportSectionLabel('Avoid')}
        <ul style="margin:0;padding-left:18px;color:var(--t2);font-size:12px;line-height:1.6">
          ${c.avoid.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}
        </ul>
      ` : '') +
      (c.capacityMath ? reportSectionLabel('Capacity math') + reportCard(null, escapeHtml(c.capacityMath)) : '')
  }

  // ── 90-day plan ────────────────────────────────────────────────
  function rNinetyDayPlan(c) {
    const months = Array.isArray(c.months) ? c.months : []
    const reels = Array.isArray(c.nextTwoReels) ? c.nextTwoReels : []
    return reportHeader(c.headline || '90-day plan') +
      months.map((m) => `
        <div style="background:var(--s2);border:1px solid var(--b1);border-radius:10px;padding:14px 16px;margin-bottom:10px">
          <div style="font-family:'Cormorant Garamond',serif;color:var(--t1);font-size:18px;font-weight:500;margin-bottom:8px">${escapeHtml(m.month)}</div>
          ${m.theme ? reportKVRow('Theme', m.theme) : ''}
          ${m.goal ? reportKVRow('Goal', m.goal) : ''}
          ${m.mustShip ? reportKVRow('Must ship', m.mustShip) : ''}
        </div>
      `).join('') +
      (reels.length ? reportSectionLabel('Next two Reels') + reels.map((r) => reportCard(r.title, `${r.format ? escapeHtml(r.format) + ' · ' : ''}${escapeHtml(r.angle || '')}`)).join('') : '')
  }

  // ── Slot audit ─────────────────────────────────────────────────
  function rSlotAudit(c) {
    const slots = Array.isArray(c.slots) ? c.slots : []
    return reportHeader(c.headline || 'Slot audit', c.dataSource === 'phyllo' ? 'Data source: live Phyllo sync' : 'Data source: niche pattern') +
      slots.map((s) => `
        <div style="background:var(--s2);border:1px solid var(--b1);border-radius:10px;padding:14px 16px;margin-bottom:10px">
          <div style="font-family:'Syne',sans-serif;color:var(--t1);font-size:13px;font-weight:600;margin-bottom:8px">${escapeHtml(s.label)}</div>
          ${s.problem ? `<div style="color:var(--t2);font-size:13px;line-height:1.55;margin-bottom:8px"><strong style="color:#e8a04b">Problem →</strong> ${escapeHtml(s.problem)}</div>` : ''}
          ${s.replacement ? `<div style="color:var(--t1);font-size:13px;line-height:1.55;margin-bottom:8px"><strong style="color:#7eb39a">Replace →</strong> ${escapeHtml(s.replacement)}</div>` : ''}
          ${s.expectedLift ? `<div style="color:var(--t3);font-size:11px;line-height:1.5"><em>Expected lift:</em> ${escapeHtml(s.expectedLift)}</div>` : ''}
        </div>
      `).join('') +
      (c.keep ? reportSectionLabel('Keep') + reportCard(null, escapeHtml(c.keep), '#7eb39a') : '')
  }

  // ── Helpers for section/items shape (used by Riley briefs) ─────
  function rSectionsBlock(sections) {
    if (!Array.isArray(sections) || !sections.length) return ''
    return sections.map((s) => `
      <div style="background:var(--s2);border:1px solid var(--b1);border-radius:10px;padding:14px 16px;margin-bottom:10px">
        ${s.heading ? `<div style="font-family:'Syne',sans-serif;color:var(--t1);font-size:13px;font-weight:600;margin-bottom:6px">${escapeHtml(s.heading)}</div>` : ''}
        ${s.body ? `<div style="color:var(--t2);font-size:13px;line-height:1.55">${escapeHtml(s.body)}</div>` : ''}
        ${Array.isArray(s.items) && s.items.length ? `
          <ul style="margin:6px 0 0 18px;padding:0;color:var(--t2);font-size:12px;line-height:1.6">
            ${s.items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}
          </ul>
        ` : ''}
      </div>
    `).join('')
  }

  // ── Pacing notes ───────────────────────────────────────────────
  function rPacingNotes(c) {
    return reportHeader(c.headline || 'Pacing notes') +
      rSectionsBlock(c.sections) +
      (c.oneFixThisWeek ? reportSectionLabel('One fix this week') + reportCard(null, escapeHtml(c.oneFixThisWeek), '#7eb39a') : '')
  }

  // ── Visual direction ───────────────────────────────────────────
  function rVisualDirection(c) {
    return reportHeader(c.headline || 'Visual direction') +
      rSectionsBlock(c.sections) +
      (c.testShot ? reportSectionLabel('Test shot') + reportCard(null, escapeHtml(c.testShot)) : '')
  }

  // ── Thumbnail brief ────────────────────────────────────────────
  function rThumbnailBrief(c) {
    const spec = c.spec || {}
    return reportHeader(c.headline || 'Thumbnail brief') +
      reportSectionLabel('Spec') +
      Object.entries(spec).map(([k, v]) => reportKVRow(k.replace(/([A-Z])/g, ' $1').replace(/^./, (m) => m.toUpperCase()), String(v))).join('') +
      (c.dontDo ? reportSectionLabel('Do not do') + reportCard(null, escapeHtml(c.dontDo), '#e8a04b') : '') +
      (c.testAgainst ? reportSectionLabel('Test against') + reportCard(null, escapeHtml(c.testAgainst)) : '')
  }

  // ── Fix weak Reel ──────────────────────────────────────────────
  function rFixWeakReel(c) {
    const fix = c.proposedFix || {}
    return reportHeader(c.headline || 'Fix the weak open') +
      (c.diagnosis ? reportSectionLabel(c.diagnosis.label || 'Diagnosis') + reportCard(null, escapeHtml(c.diagnosis.body || ''), '#e8a04b') : '') +
      (Array.isArray(fix.shots) && fix.shots.length ? `
        ${reportSectionLabel(fix.label || 'Proposed fix')}
        <ol style="list-style:none;padding:0;margin:0">
          ${fix.shots.map((s) => `
            <li style="display:grid;grid-template-columns:60px 90px 1fr;gap:14px;align-items:baseline;background:var(--s2);border:1px solid var(--b1);border-radius:10px;padding:12px 14px;margin-bottom:8px">
              <div style="font-family:'Syne',sans-serif;color:var(--t3);font-size:12px">${escapeHtml(s.at || '')}</div>
              <div style="color:var(--t2);font-size:11px">${escapeHtml(s.shot || '')}</div>
              <div style="color:var(--t1);font-size:12px;line-height:1.5">${escapeHtml(s.note || '')}</div>
            </li>
          `).join('')}
        </ol>
      ` : '') +
      (c.whyItWorks ? reportSectionLabel('Why it works') + reportCard(null, escapeHtml(c.whyItWorks), '#7eb39a') : '') +
      (c.reshoot ? reportSectionLabel('Reshoot') + reportCard(null, escapeHtml(c.reshoot)) : '')
  }

  // ── Bio rewrite ────────────────────────────────────────────────
  function rBioRewrite(c) {
    const options = Array.isArray(c.options) ? c.options : []
    return reportHeader(c.headline || 'Bio rewrite') +
      (c.current ? `<div style="color:var(--t3);font-size:12px;margin-bottom:6px">Current: ${escapeHtml(c.current)}</div>` : '') +
      (c.sizeContext ? `<div style="color:var(--t2);font-size:12px;line-height:1.5;margin-bottom:14px">${escapeHtml(c.sizeContext)}</div>` : '') +
      options.map((o) => `
        <div style="background:var(--s2);border:1px solid var(--b1);border-radius:10px;padding:14px 16px;margin-bottom:10px">
          <div style="font-family:'Syne',sans-serif;color:var(--t1);font-size:12px;font-weight:600;letter-spacing:.04em;margin-bottom:8px">${escapeHtml(o.label)}</div>
          <pre style="background:var(--s1);border:1px solid var(--b1);border-radius:8px;padding:12px;color:var(--t1);font-family:'Cormorant Garamond',serif;font-size:15px;line-height:1.55;white-space:pre-wrap;margin:0 0 8px">${escapeHtml(o.text)}</pre>
          <div style="color:var(--t3);font-size:11px;line-height:1.5">${escapeHtml(o.why)}</div>
        </div>
      `).join('') +
      (c.recommendation ? reportSectionLabel('Recommendation') + reportCard(null, escapeHtml(c.recommendation), '#7eb39a') : '') +
      (c.ctaRule ? reportSectionLabel('CTA rule') + reportCard(null, escapeHtml(c.ctaRule)) : '')
  }

  function renderContentByType(type, content) {
    if (!content || typeof content !== 'object') return null
    // Some OutputTypes carry multiple briefKind shapes (e.g. trend_report
    // is the storage for weekly_trends, competitor_scan, hashtag_report,
    // audience_deep_dive, engagement_diagnosis). Dispatch by content.kind
    // first so each shape gets its own visual treatment instead of
    // dropping to a JSON fallback.
    if (content && typeof content === 'object' && content.kind) {
      switch (content.kind) {
        case 'competitor_scan':       return rCompetitorScan(content)
        case 'hashtag_report':        return rHashtagReport(content)
        case 'audience_deep_dive':    return rAudienceDeepDive(content)
        case 'engagement_diagnosis':  return rEngagementDiagnosis(content)
        case 'pillar_rebuild':        return rPillarRebuild(content)
        case 'cadence_plan':          return rCadencePlan(content)
        case 'ninety_day_plan':       return rNinetyDayPlan(content)
        case 'slot_audit':            return rSlotAudit(content)
        case 'pacing_notes':          return rPacingNotes(content)
        case 'visual_direction':      return rVisualDirection(content)
        case 'thumbnail_brief':       return rThumbnailBrief(content)
        case 'fix_weak_reel':         return rFixWeakReel(content)
        case 'bio_rewrite':           return rBioRewrite(content)
        case 'carousel_opening_lines': return rHooks(content)
        // weekly_trends / top_trend_hooks / reel_shot_list / etc fall
        // through to the type-keyed handlers below.
      }
    }
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
    openDetailFromObject(o)
  }

  // Renders the same detail modal but from a passed-in output object —
  // used by the meeting room "View brief" button so it can present a
  // brief that just delivered and may not yet be in the local outputs[]
  // cache.
  function openDetailFromObject(o) {
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
    `
    panel.querySelector('button[aria-label="Close"]').addEventListener('click', () => overlay.remove())
    overlay.appendChild(panel)
    document.body.appendChild(overlay)
    document.addEventListener('keydown', function onEsc(ev) {
      if (ev.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc) }
    })
  }

  // Exposed so meeting-wire's "View brief" button can render a freshly
  // delivered output without it needing to be in the local cache.
  window.vxOpenOutputDetail = openDetailFromObject

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

  // Re-render when a brief just delivered so the new output appears in
  // the library without a page reload.
  window.addEventListener('vx-task-changed', () => setTimeout(render, 60))
})()
