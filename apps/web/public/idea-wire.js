/* Vexa — user-added content ideas on the calendar.
 *
 * Click any day cell on the calendar (month or week view) to open a
 * prompt modal. Type the idea, pick a format, save → it lands on the
 * calendar with a distinct CEO color so user-added entries are
 * instantly distinguishable from agent-planned ones.
 *
 * Entries are stored on window.calEntries (the same array prototype.js
 * renders from) so they survive view switches without a backend round
 * trip. Future improvement: persist via /api/tasks so they show up on
 * other devices and feed the agents.
 */
;(function () {
  // ── COLOR FOR USER ENTRIES ──────────────────────────────────────────
  // Distinct from the 4 agent hues (sage/amber/coral/lavender). Steel
  // blue reads as "you" — neutral but clearly not one of the team.
  const STYLE_ID = 'vx-idea-style'
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return
    const s = document.createElement('style')
    s.id = STYLE_ID
    s.textContent = `
      :root {
        --c-you:   rgba(74,140,175,.20);
        --c-you-b: rgba(74,140,175,.85);
      }
      [data-theme="light"] {
        --c-you:   rgba(74,140,175,.18);
        --c-you-b: rgba(74,140,175,.92);
      }
      .cal-entry.you      { background:var(--c-you); border-left-color:var(--c-you-b); }
      .cal-week-entry.you { background:var(--c-you); border-left-color:var(--c-you-b); }
      .cal-day:hover .vx-add-hint {
        opacity:1; transform:translateY(0);
      }
      .vx-add-hint {
        position:absolute; right:6px; bottom:6px;
        font-size:9px; letter-spacing:.08em; text-transform:uppercase;
        color:var(--t3); opacity:0; transform:translateY(2px);
        transition:opacity .15s ease, transform .15s ease;
        pointer-events:none;
      }
      .cal-day { position:relative; }
    `
    document.head.appendChild(s)
  }

  function nextId() {
    return 'u' + Math.random().toString(36).slice(2, 9)
  }

  function fmtDateLabel(dateStr) {
    try {
      const d = new Date(dateStr + 'T00:00:00')
      return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
    } catch { return dateStr }
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  const FORMATS = ['Reel', 'Carousel', 'Story', 'Caption', 'Photo', 'Other']

  function openIdeaModal(dateStr) {
    document.getElementById('vx-idea-modal')?.remove()
    const el = document.createElement('div')
    el.id = 'vx-idea-modal'
    el.style.cssText =
      'position:fixed;inset:0;z-index:9400;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);padding:24px'
    const fmtChips = FORMATS.map((f, i) =>
      `<button type="button" data-fmt="${esc(f)}" style="background:${i === 0 ? 'var(--t1)' : 'transparent'};color:${i === 0 ? 'var(--bg)' : 'var(--t2)'};border:1px solid var(--b2);padding:6px 14px;border-radius:999px;font-size:11px;cursor:pointer;font-family:inherit">${esc(f)}</button>`
    ).join('')
    el.innerHTML = `
      <div style="width:100%;max-width:440px;background:var(--s1);border:1px solid var(--b1);border-radius:14px;padding:26px;color:var(--t1);font-family:'DM Sans',sans-serif">
        <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--t3);margin-bottom:4px">Add to calendar</div>
        <h3 style="font-family:'Syne',sans-serif;font-size:20px;margin:0 0 4px">What is the idea?</h3>
        <div style="color:var(--t3);font-size:12px;margin-bottom:16px">${esc(fmtDateLabel(dateStr))}</div>

        <input id="vx-idea-title" placeholder="e.g. Behind-the-scenes shoot for new campaign" autofocus style="width:100%;padding:11px 14px;background:var(--s2);border:1px solid var(--b1);border-radius:8px;color:var(--t1);font-size:14px;outline:none;font-family:inherit" />

        <label style="display:block;font-size:11px;color:var(--t3);letter-spacing:.08em;text-transform:uppercase;margin:14px 0 6px">Format</label>
        <div id="vx-idea-fmts" style="display:flex;flex-wrap:wrap;gap:6px">${fmtChips}</div>

        <div id="vx-idea-err" style="color:#ff6b6b;font-size:12px;margin-top:10px;min-height:16px"></div>
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:14px">
          <button id="vx-idea-cancel" style="background:none;border:1px solid var(--b2);color:var(--t2);padding:10px 16px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:12px">Cancel</button>
          <button id="vx-idea-save" style="background:var(--t1);color:var(--bg);border:none;padding:10px 18px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:600">Add to ${esc(dateStr)}</button>
        </div>
      </div>
    `
    document.body.appendChild(el)
    el.addEventListener('click', (e) => { if (e.target === el) el.remove() })
    document.addEventListener('keydown', function onEsc(ev) {
      if (ev.key === 'Escape') { el.remove(); document.removeEventListener('keydown', onEsc) }
    })

    let selectedFmt = FORMATS[0]
    el.querySelectorAll('[data-fmt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        el.querySelectorAll('[data-fmt]').forEach((b) => { b.style.background = 'transparent'; b.style.color = 'var(--t2)' })
        btn.style.background = 'var(--t1)'; btn.style.color = 'var(--bg)'
        selectedFmt = btn.dataset.fmt
      })
    })

    el.querySelector('#vx-idea-cancel').addEventListener('click', () => el.remove())
    const save = () => {
      const title = (document.getElementById('vx-idea-title').value || '').trim()
      const err = document.getElementById('vx-idea-err')
      if (title.length < 2) { err.textContent = 'Give it at least a short title.'; return }
      if (!Array.isArray(window.calEntries)) window.calEntries = []
      window.calEntries.push({
        id: nextId(),
        date: dateStr,
        type: selectedFmt,
        title,
        who: 'you',
        status: 'planned',
        label: 'You',
        userAdded: true,
      })
      el.remove()
      if (typeof window.renderCalendar === 'function') window.renderCalendar()
    }
    el.querySelector('#vx-idea-save').addEventListener('click', save)
    el.querySelector('#vx-idea-title').addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') save()
    })
  }

  // Pick a YYYY-MM-DD string out of a cal-day cell. The cell shows the
  // day number; we need to derive the full date. Easier approach:
  // re-derive from the cell's index within #cal-grid.
  function dateForMonthCell(cell) {
    const grid = document.getElementById('cal-grid')
    if (!grid || !window.calDate) return null
    const cells = Array.from(grid.children).filter((c) => c.classList.contains('cal-day'))
    const idx = cells.indexOf(cell)
    if (idx < 0) return null
    const year = window.calDate.getFullYear()
    const month = window.calDate.getMonth()
    const firstDay = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const daysInPrev = new Date(year, month, 0).getDate()
    let d
    if (idx < firstDay) d = new Date(year, month - 1, daysInPrev - firstDay + idx + 1)
    else if (idx >= firstDay + daysInMonth) d = new Date(year, month + 1, idx - firstDay - daysInMonth + 1)
    else d = new Date(year, month, idx - firstDay + 1)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${dd}`
  }

  // Week view slots: dates align with the column index. The week-grid
  // contains: corner + 7 day headers + (per hour: time-label + 7 slots).
  // For now we just attach click on .cal-week-slot and let the user add
  // an idea on the Monday of the visible week — week mode is rarely
  // where ideas land. (Future: derive the actual date from column index.)
  function dateForWeekSlot(slot) {
    const grid = document.getElementById('cal-week-grid')
    if (!grid) return null
    const all = Array.from(grid.children)
    const slots = all.filter((c) => c.classList.contains('cal-week-slot'))
    const idx = slots.indexOf(slot)
    if (idx < 0) return null
    const dayCol = idx % 7 // 0..6, Mon..Sun
    if (!window.calDate) return null
    const d = new Date(window.calDate)
    const dow = d.getDay()
    const monday = new Date(d)
    monday.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1))
    monday.setDate(monday.getDate() + dayCol)
    const y = monday.getFullYear()
    const m = String(monday.getMonth() + 1).padStart(2, '0')
    const dd = String(monday.getDate()).padStart(2, '0')
    return `${y}-${m}-${dd}`
  }

  function attachHandlers() {
    // Month cells
    const dayCells = document.querySelectorAll('#cal-grid .cal-day')
    dayCells.forEach((cell) => {
      if (cell.dataset.vxIdeaWired) return
      cell.dataset.vxIdeaWired = '1'
      cell.style.cursor = 'pointer'
      // Add a hover hint
      const hint = document.createElement('span')
      hint.className = 'vx-add-hint'
      hint.textContent = '+ idea'
      cell.appendChild(hint)
      cell.addEventListener('click', (ev) => {
        // Don't trigger when clicking an existing entry or its actions
        if (ev.target.closest('.cal-entry')) return
        if (ev.target.closest('.cal-entry-action-btn')) return
        const dateStr = dateForMonthCell(cell)
        if (dateStr) openIdeaModal(dateStr)
      })
    })
    // Week slots
    const weekSlots = document.querySelectorAll('#cal-week-grid .cal-week-slot')
    weekSlots.forEach((slot) => {
      if (slot.dataset.vxIdeaWired) return
      slot.dataset.vxIdeaWired = '1'
      slot.style.cursor = 'pointer'
      slot.addEventListener('click', (ev) => {
        if (ev.target.closest('.cal-week-entry')) return
        const dateStr = dateForWeekSlot(slot)
        if (dateStr) openIdeaModal(dateStr)
      })
    })
  }

  function injectLegendItem() {
    const legend = document.querySelector('.cal-legend')
    if (!legend || legend.querySelector('[data-vx-legend-you]')) return
    const item = document.createElement('div')
    item.className = 'cal-legend-item'
    item.dataset.vxLegendYou = '1'
    item.innerHTML = `
      <div class="cal-legend-swatch" style="background:var(--c-you-b)"></div>
      You
    `
    // Insert before the status legend (Planned/Scripted/Approved) which
    // sits last with margin-left:auto.
    const firstStatus = Array.from(legend.children).find((c) => c.style.marginLeft === 'auto')
    if (firstStatus) legend.insertBefore(item, firstStatus)
    else legend.appendChild(item)
  }

  // Wrap renderCalendar so click handlers + legend get re-applied after
  // every re-render (month nav, view switch, etc.).
  injectStyle()
  const origRender = window.renderCalendar
  window.renderCalendar = function () {
    const r = typeof origRender === 'function' ? origRender() : undefined
    setTimeout(() => {
      injectLegendItem()
      attachHandlers()
    }, 30)
    return r
  }

  // Also poll briefly in case the calendar renders before this script
  // gets a chance to wrap (e.g. early enterDashboard).
  let attempts = 0
  const interval = setInterval(() => {
    attempts++
    injectLegendItem()
    attachHandlers()
    if (attempts > 30) clearInterval(interval)
  }, 800)
})()
