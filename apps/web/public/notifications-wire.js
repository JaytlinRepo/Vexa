/* Vexa — notifications bell: SSE + dropdown
 *
 * Opens EventSource('/api/notifications/stream') after the dashboard is entered,
 * maintains an in-memory list, updates the unread badge, and injects a dropdown
 * panel that opens on bell click.
 */
;(function () {
  const state = {
    items: [],
    unread: 0,
    source: null,
    panel: null,
    open: false,
    badge: null,
    wired: false,
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  function ensurePanel() {
    if (state.panel) return state.panel
    const panel = document.createElement('div')
    panel.id = 'vx-notif-panel'
    panel.style.cssText = `
      position:fixed;top:64px;right:32px;width:360px;max-height:520px;overflow:auto;
      background:var(--bg);border:1px solid var(--b1);border-radius:14px;
      box-shadow:0 20px 60px rgba(0,0,0,.5);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
      z-index:7000;display:none;padding:8px 0;font-family:'DM Sans',sans-serif
    `
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px 12px;border-bottom:1px solid var(--b1)">
        <strong style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--t2)">Notifications</strong>
        <button id="vx-notif-read-all" style="background:none;border:none;color:var(--t3);font-size:11px;cursor:pointer;font-family:inherit">Mark all read</button>
      </div>
      <div id="vx-notif-list" style="padding:4px 0"></div>
    `
    panel.addEventListener('click', (e) => e.stopPropagation())
    document.body.appendChild(panel)
    state.panel = panel
    panel.querySelector('#vx-notif-read-all').addEventListener('click', markAllRead)
    document.addEventListener('click', () => setOpen(false))
    return panel
  }

  function setOpen(open) {
    state.open = open
    if (state.panel) state.panel.style.display = open ? 'block' : 'none'
  }

  function badgeEl() {
    if (state.badge) return state.badge
    const dot = document.querySelector('#notif-btn .notif-dot')
    if (!dot) return null
    dot.style.cssText =
      'min-width:16px;height:16px;border-radius:10px;background:#ff5858;color:#fff;font-size:10px;font-weight:700;display:none;align-items:center;justify-content:center;padding:0 4px;position:absolute;top:-4px;right:-4px;font-family:inherit'
    // Bell button needs to be positioned for absolute badge
    const btn = document.getElementById('notif-btn')
    if (btn) btn.style.position = 'relative'
    state.badge = dot
    return dot
  }

  function refreshBadge() {
    const b = badgeEl()
    if (!b) return
    if (state.unread > 0) {
      b.style.display = 'inline-flex'
      b.textContent = state.unread > 99 ? '99+' : String(state.unread)
    } else {
      b.style.display = 'none'
    }
  }

  function renderList() {
    ensurePanel()
    const list = state.panel.querySelector('#vx-notif-list')
    if (!list) return
    list.innerHTML = ''
    if (state.items.length === 0) {
      const empty = document.createElement('div')
      empty.style.cssText = 'padding:24px 18px;color:var(--t2);font-size:13px;text-align:center;line-height:1.5'
      empty.innerHTML =
        '<p style="margin:0 0 12px">No alerts yet — open the queue to move work forward.</p>' +
        '<button type="button" id="vx-notif-empty-queue" style="background:var(--t1);color:var(--bg);border:none;padding:8px 16px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">Open work queue</button>'
      list.appendChild(empty)
      const b = empty.querySelector('#vx-notif-empty-queue')
      if (b) {
        b.addEventListener('click', (e) => {
          e.stopPropagation()
          if (typeof window.navigate === 'function') window.navigate('db-tasks')
          setOpen(false)
        })
      }
      return
    }
    for (const n of state.items.slice(0, 20)) {
      const row = document.createElement('div')
      row.style.cssText = `
        display:flex;flex-direction:column;gap:8px;padding:14px 18px;border-bottom:1px solid var(--b1);
        ${n.isRead ? 'opacity:.55' : ''}
      `
      const meta = n.metadata || {}
      const nextId = meta.nextTaskId || meta.next_task_id || meta.taskId
      const hasAction = Boolean(n.actionLabel && (nextId || n.actionUrl))
      row.innerHTML = `
        <div style="display:flex;gap:12px;cursor:default">
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:600;color:var(--t1);margin-bottom:2px">${escapeHtml(n.title)}</div>
            <div style="font-size:12px;color:var(--t2);line-height:1.45">${escapeHtml(n.body)}</div>
          </div>
          ${!n.isRead ? '<div style="width:8px;height:8px;border-radius:50%;background:#ff5858;margin-top:4px;flex-shrink:0"></div>' : ''}
        </div>
        ${
          hasAction
            ? `<button type="button" class="vx-notif-primary" style="align-self:flex-start;background:var(--t1);color:var(--bg);border:none;padding:6px 12px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">${escapeHtml(n.actionLabel)}</button>`
            : ''
        }
      `
      row.querySelector('.vx-notif-primary')?.addEventListener('click', (e) => {
        e.stopPropagation()
        markRead(n)
        if (nextId) {
          try {
            sessionStorage.setItem('vxFocusTaskId', String(nextId))
          } catch {}
          if (typeof window.navigate === 'function') window.navigate('db-tasks')
        } else if (n.actionUrl) {
          window.location.href = n.actionUrl
        }
        setOpen(false)
        renderList()
      })
      row.addEventListener('click', () => markRead(n))
      list.appendChild(row)
    }
  }

  async function loadInitial() {
    try {
      const res = await fetch('/api/notifications', { credentials: 'include' })
      if (!res.ok) return
      const json = await res.json()
      state.items = json.items || []
      state.unread = json.unread || 0
      refreshBadge()
      renderList()
    } catch {}
  }

  function connectStream() {
    if (state.source) return
    try {
      const es = new EventSource('/api/notifications/stream', { withCredentials: true })
      state.source = es
      es.onmessage = (e) => {
        try {
          const evt = JSON.parse(e.data)
          if (evt.type === 'connected') return
          // Real notification payload
          if (evt.id && evt.title) {
            state.items.unshift(evt)
            if (!evt.isRead) state.unread += 1
            refreshBadge()
            renderList()
          }
        } catch {}
      }
      es.onerror = () => {
        // Browser auto-retries. Nothing to do.
      }
    } catch {}
  }

  async function markRead(n) {
    if (!n.isRead) {
      try {
        await fetch('/api/notifications/' + n.id + '/read', {
          method: 'POST',
          credentials: 'include',
        })
      } catch {}
      n.isRead = true
      state.unread = Math.max(0, state.unread - 1)
      refreshBadge()
      renderList()
    }
  }

  async function markAllRead() {
    try {
      await fetch('/api/notifications/read-all', { method: 'POST', credentials: 'include' })
    } catch {}
    state.items.forEach((n) => (n.isRead = true))
    state.unread = 0
    refreshBadge()
    renderList()
  }

  function wireBellClick() {
    if (state.wired) return
    const btn = document.getElementById('notif-btn')
    if (!btn) return
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      ensurePanel()
      setOpen(!state.open)
      if (state.open) renderList()
    })
    state.wired = true
  }

  function init() {
    wireBellClick()
    // Only boot SSE/list if bell is visible (which happens on enterDashboard).
    if (document.getElementById('notif-btn')?.style.display === 'none') return
    loadInitial().then(connectStream)
  }

  // Kick off once after dashboard enter
  const prevEnter = window.enterDashboard
  window.enterDashboard = async function () {
    if (typeof prevEnter === 'function') await prevEnter()
    setTimeout(init, 100)
  }

  document.addEventListener('DOMContentLoaded', () => setTimeout(init, 200))
  if (document.readyState !== 'loading') setTimeout(init, 300)
})()
