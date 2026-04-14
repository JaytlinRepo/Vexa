/* Vexa — unified Work page (calendar + team + outputs stacked).
 *
 * Single scrollable surface inside #view-db-tasks:
 *   1. Calendar (the existing tasks/cal view, calendar default)
 *   2. Team (employee cards, moved from #view-db-team)
 *   3. Outputs library (moved from #view-db-outputs)
 *
 * The other two views (#view-db-team, #view-db-outputs) are hidden so
 * stale content doesn't paint, but their DOM stays in place so the
 * existing wire scripts (team-wire, outputs-wire) keep finding their
 * elements when they re-render.
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
        <div style="color:var(--t2);font-size:13px;margin-top:6px">Everything your team is shipping, who is shipping it, and what is already approved — all on one page.</div>
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

  // Hide the now-unused standalone Team and Outputs views so they never
  // appear behind the unified page after a stray navigate() call.
  function hideStandaloneViews() {
    ['view-db-team', 'view-db-outputs'].forEach((id) => {
      const v = document.getElementById(id)
      if (v) v.classList.remove('active')
    })
  }

  // Pull the inner content from the standalone Team view into a hosted
  // section underneath the calendar. We *move* the .emp-cards element
  // (rather than clone) so team-wire.js's render() keeps writing into the
  // same node and we don't get stale duplicate copies.
  function buildTeamSection() {
    const teamView = document.getElementById('view-db-team')
    if (!teamView) return null
    const cards = teamView.querySelector('.emp-cards')
    if (!cards) return null

    const wrap = document.createElement('section')
    wrap.id = 'vx-work-team'
    wrap.style.cssText = 'margin-top:40px'
    wrap.innerHTML = sectionLabel('Your team')
    wrap.appendChild(cards)
    return wrap
  }

  function buildOutputsSection() {
    const outView = document.getElementById('view-db-outputs')
    if (!outView) return null
    const inner = outView.querySelector('.view-inner')
    if (!inner) return null
    // Move the filter bar + grid into our section. Skip any leftover
    // section title/sub since the unified header replaces them.
    const wrap = document.createElement('section')
    wrap.id = 'vx-work-outputs'
    wrap.style.cssText = 'margin-top:48px'
    wrap.innerHTML = sectionLabel('Outputs library')
    Array.from(inner.children).forEach((child) => {
      if (child.classList.contains('db-section-title')) return
      if (child.classList.contains('db-section-sub')) return
      if (child.id === 'vx-work-header') return
      wrap.appendChild(child)
    })
    return wrap
  }

  function injectStack() {
    const tasksView = document.getElementById('view-db-tasks')
    if (!tasksView) return
    const inner = tasksView.querySelector('.view-inner')
    if (!inner) return

    // Remove the view's stock title + subtitle so we own the header.
    inner.querySelectorAll('.db-section-title, .db-section-sub').forEach((n) => n.remove())

    // Replace existing header (re-injects on each navigate)
    inner.querySelector('#vx-work-header')?.remove()
    const headerWrap = document.createElement('div')
    headerWrap.innerHTML = workHeader()
    inner.insertBefore(headerWrap.firstElementChild, inner.firstChild)

    ensureCalendarDefault()
    hideStandaloneViews()

    // Append Team section if not already present (or refresh it)
    inner.querySelector('#vx-work-team')?.remove()
    const teamSection = buildTeamSection()
    if (teamSection) inner.appendChild(teamSection)

    // Append Outputs section if not already present (or refresh it)
    inner.querySelector('#vx-work-outputs')?.remove()
    const outputsSection = buildOutputsSection()
    if (outputsSection) inner.appendChild(outputsSection)
  }

  // Wrap navigate so that any time the user lands on Tasks, the unified
  // stack is rebuilt + calendar is forced. Also intercept old links to
  // db-team / db-outputs and redirect to the unified Work page.
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
      setTimeout(injectStack, 320) // after prototype's 280ms view-swap
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
    if (!tasksView.querySelector('#vx-work-header')) injectStack()
  }

  if (document.readyState !== 'loading') setTimeout(injectStack, 700)
  document.addEventListener('DOMContentLoaded', () => setTimeout(injectStack, 800))
  setInterval(retry, 1500)
})()
