/* Vexa — unified Work page (calendar + team + outputs stacked).
 *
 * Single scrollable surface inside #view-db-tasks. Calendar on top
 * (forced as the default tasks-view), Team cards below, Outputs library
 * at the bottom.
 *
 * Strategy: build empty host containers (.emp-cards for team,
 * [data-outputs-host] for outputs) inside the unified view, then trigger
 * team-wire.js and outputs-wire.js to populate them. Both wire scripts
 * have been broadened to write into every matching host on the page, so
 * the same render call fills both the standalone view (kept for fallback)
 * and our unified view.
 */
;(function () {
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  function sectionLabel(text) {
    return `<h2 style="color:var(--t2);font-size:10px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;margin:0 0 14px;font-family:'Syne',sans-serif">${esc(text)}</h2>`
  }

  function workHeader() {
    return `
      <div id="vx-work-header" style="margin-bottom:22px">
        <div style="color:var(--t3);font-size:10px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;margin-bottom:4px;font-family:'Syne',sans-serif">Work</div>
        <h1 style="font-family:'Cormorant Garamond',serif;font-size:clamp(28px,3.2vw,40px);font-weight:500;line-height:1.1;color:var(--t1);margin:0">Calendar &middot; Team &middot; Outputs</h1>
        <div style="color:var(--t2);font-size:13px;margin-top:6px">Everything your team is shipping, who is shipping it, and what is already approved &mdash; all on one page.</div>
      </div>
    `
  }

  function ensureCalendarDefault() {
    const calBtn = document.getElementById('tasks-cal-btn')
    const listBtn = document.getElementById('tasks-list-btn')
    const calView = document.getElementById('tasks-cal-view')
    const listView = document.getElementById('tasks-list-view')
    if (calBtn) calBtn.classList.add('active')
    if (listBtn) listBtn.classList.remove('active')
    if (calView) calView.style.display = 'block'
    if (listView) listView.style.display = 'none'
    if (typeof window.switchTasksView === 'function') {
      try { window.switchTasksView('calendar') } catch {}
    }
    if (typeof window.renderCalendar === 'function') {
      try { window.renderCalendar() } catch {}
    }
  }

  function hideStandaloneViews() {
    ['view-db-team', 'view-db-outputs'].forEach((id) => {
      const v = document.getElementById(id)
      if (v) v.classList.remove('active')
    })
  }

  function ensureTeamSection(inner) {
    let section = inner.querySelector('#vx-work-team')
    if (section) return section
    section = document.createElement('section')
    section.id = 'vx-work-team'
    section.style.cssText = 'margin-top:40px'
    section.innerHTML = `
      ${sectionLabel('Your team')}
      <div class="emp-cards"></div>
    `
    inner.appendChild(section)
    return section
  }

  function ensureOutputsSection(inner) {
    let section = inner.querySelector('#vx-work-outputs')
    if (section) return section
    section = document.createElement('section')
    section.id = 'vx-work-outputs'
    section.style.cssText = 'margin-top:48px'
    section.innerHTML = `
      ${sectionLabel('Outputs library')}
      <div data-outputs-host>
        <div class="outputs-filter" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px"></div>
      </div>
    `
    inner.appendChild(section)
    return section
  }

  function injectStack() {
    const tasksView = document.getElementById('view-db-tasks')
    if (!tasksView) return
    const inner = tasksView.querySelector('.view-inner')
    if (!inner) return

    // Remove the view's stock title + subtitle so we own the header.
    inner.querySelectorAll('.db-section-title, .db-section-sub').forEach((n) => n.remove())

    // Header (idempotent)
    if (!inner.querySelector('#vx-work-header')) {
      const headerWrap = document.createElement('div')
      headerWrap.innerHTML = workHeader()
      inner.insertBefore(headerWrap.firstElementChild, inner.firstChild)
    }

    ensureCalendarDefault()
    hideStandaloneViews()

    // Build host containers (idempotent — won't duplicate)
    ensureTeamSection(inner)
    ensureOutputsSection(inner)

    // Kick the wire scripts to populate our hosts. They render into every
    // matching host on the page, so the unified Work sections fill in.
    if (window.vxRenderTeam) {
      try { window.vxRenderTeam() } catch {}
    } else {
      // Fall back to the navigate event — team-wire wraps it and renders
      // when id is 'db-team'. We just call it directly.
      window.dispatchEvent(new CustomEvent('vx-team-render-request'))
    }
    if (window.vxRenderOutputs) {
      try { window.vxRenderOutputs() } catch {}
    } else {
      window.dispatchEvent(new CustomEvent('vx-outputs-render-request'))
    }
  }

  // Wrap navigate so any time the user lands on Tasks, the unified stack
  // is rebuilt. Also redirect old links to db-team / db-outputs.
  const origNavigate = window.navigate
  window.navigate = function (id) {
    if (id === 'db-team' || id === 'db-outputs') {
      const r = typeof origNavigate === 'function' ? origNavigate('db-tasks') : undefined
      setTimeout(injectStack, 60)
      setTimeout(injectStack, 320)
      return r
    }
    const r = typeof origNavigate === 'function' ? origNavigate(id) : undefined
    if (id === 'db-tasks') {
      setTimeout(injectStack, 60)
      setTimeout(injectStack, 320)
    }
    return r
  }

  const prevEnter = window.enterDashboard
  window.enterDashboard = async function () {
    if (typeof prevEnter === 'function') await prevEnter()
    setTimeout(injectStack, 100)
  }

  function retry() {
    const tasksView = document.getElementById('view-db-tasks')
    if (!tasksView) return
    if (!tasksView.querySelector('#vx-work-team') || !tasksView.querySelector('#vx-work-outputs')) {
      injectStack()
    }
  }

  if (document.readyState !== 'loading') setTimeout(injectStack, 700)
  document.addEventListener('DOMContentLoaded', () => setTimeout(injectStack, 800))
  setInterval(retry, 1500)
})()
