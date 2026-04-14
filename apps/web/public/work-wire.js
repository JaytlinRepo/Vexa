/* Vexa — unified Work page.
 *
 * Collapses the three former views (My Team, Tasks, Outputs) into a
 * single "Work" surface with a tab bar at the top. Calendar is the
 * default tab. The three underlying #view-db-* views stay intact so
 * their existing content + wire scripts keep working — this layer just
 * unifies the entry point and swaps the active view on tab click.
 *
 * Side nav no longer shows separate items for Team and Outputs; the
 * single "Work" item lands on Tasks/Calendar, and the tabs take the
 * user across the three sub-surfaces.
 */
;(function () {
  const TABS = [
    { id: 'calendar', label: 'Calendar', view: 'db-tasks' },
    { id: 'team',     label: 'Team',     view: 'db-team'  },
    { id: 'outputs',  label: 'Outputs',  view: 'db-outputs' },
  ]

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  function currentTabId(viewId) {
    const t = TABS.find((x) => x.view === viewId)
    return t ? t.id : null
  }

  function tabBarHtml(activeTabId) {
    const btns = TABS.map((t) => `
      <button data-work-tab="${t.id}" style="
        background:${t.id === activeTabId ? 'var(--t1)' : 'transparent'};
        color:${t.id === activeTabId ? 'var(--bg)' : 'var(--t2)'};
        border:1px solid ${t.id === activeTabId ? 'var(--t1)' : 'var(--b2)'};
        padding:8px 18px;border-radius:999px;
        font-size:12px;font-family:inherit;letter-spacing:.04em;
        cursor:pointer;transition:all .15s ease">${esc(t.label)}</button>
    `).join('')
    return `
      <div id="vx-work-header" style="margin-bottom:18px">
        <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:14px">
          <div>
            <div style="color:var(--t3);font-size:10px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;margin-bottom:4px;font-family:'Syne',sans-serif">Work</div>
            <h1 style="font-family:'Cormorant Garamond',serif;font-size:clamp(26px,3vw,38px);font-weight:500;line-height:1.1;color:var(--t1);margin:0">${esc(tabTitle(activeTabId))}</h1>
            <div style="color:var(--t2);font-size:12px;margin-top:4px">${esc(tabSubtitle(activeTabId))}</div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">${btns}</div>
        </div>
      </div>
    `
  }

  function tabTitle(tabId) {
    return tabId === 'calendar' ? 'Calendar'
      : tabId === 'team' ? 'Your team'
      : tabId === 'outputs' ? 'Outputs library'
      : 'Work'
  }

  function tabSubtitle(tabId) {
    return tabId === 'calendar'
      ? 'Everything your team is shipping, in time. Agents update this as you approve.'
      : tabId === 'team'
        ? 'Four specialists working on your brand. Open a meeting or brief one of them.'
        : tabId === 'outputs'
          ? 'Everything approved and ready to use — hooks, scripts, plans, videos.'
          : ''
  }

  // Inject the unified header into each of the three views. Swap out the
  // view's original section title/subtitle since the tab header replaces it.
  function injectHeader(viewId) {
    const view = document.getElementById('view-' + viewId)
    if (!view) return
    const inner = view.querySelector('.view-inner') || view
    const tabId = currentTabId(viewId)
    if (!tabId) return

    // Remove the view's stock title + subtitle so we don't double up.
    inner.querySelectorAll('.db-section-title, .db-section-sub').forEach((n) => n.remove())

    // Remove old header if present (re-render on each nav)
    const existing = inner.querySelector('#vx-work-header')
    if (existing) existing.remove()

    // Prepend the unified header.
    const wrap = document.createElement('div')
    wrap.innerHTML = tabBarHtml(tabId)
    const header = wrap.firstElementChild
    inner.insertBefore(header, inner.firstChild)

    header.querySelectorAll('[data-work-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tid = btn.dataset.workTab
        const t = TABS.find((x) => x.id === tid)
        if (!t) return
        if (t.id === 'calendar') {
          // Use goToTasks so the calendar refreshes + defaults to month view
          if (typeof window.goToTasks === 'function') window.goToTasks()
          else if (typeof window.navigate === 'function') window.navigate(t.view)
        } else if (typeof window.navigate === 'function') {
          window.navigate(t.view)
        }
      })
    })
  }

  function injectAll() {
    TABS.forEach((t) => injectHeader(t.view))
  }

  // Watch for navigation changes and re-inject the header so the active
  // tab pill updates when the user switches views via deep links / other
  // triggers.
  const origNavigate = window.navigate
  window.navigate = function (id) {
    const r = typeof origNavigate === 'function' ? origNavigate(id) : undefined
    if (id === 'db-tasks' || id === 'db-team' || id === 'db-outputs') {
      setTimeout(injectAll, 60)
      setTimeout(injectAll, 320) // after prototype's 280ms view-swap animation
    }
    return r
  }

  const prevEnter = window.enterDashboard
  window.enterDashboard = async function () {
    if (typeof prevEnter === 'function') await prevEnter()
    setTimeout(injectAll, 80)
  }

  function retry() {
    const views = document.querySelectorAll('#view-db-tasks .view-inner, #view-db-team .view-inner, #view-db-outputs .view-inner')
    let needInject = false
    views.forEach((v) => { if (!v.querySelector('#vx-work-header')) needInject = true })
    if (needInject) injectAll()
  }

  if (document.readyState !== 'loading') setTimeout(injectAll, 600)
  document.addEventListener('DOMContentLoaded', () => setTimeout(injectAll, 700))
  setInterval(retry, 1500)
})()
