/* Sovexa — notifications bell: SSE + dropdown
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
    sseStarted: false,
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  function absUrl(url) {
    if (!url || typeof url !== 'string') return null
    if (url.startsWith('http')) return url
    try {
      var o = window.location.origin
      return url.startsWith('/') ? o + url : o + '/' + url
    } catch {
      return url
    }
  }

  function parseDashboardTasksPath(url) {
    var m = String(url || '').match(/\/dashboard\/tasks\/([^/?#]+)/)
    return m ? m[1] : null
  }

  function hqPipelineVisible() {
    var v = document.getElementById('view-db-dashboard')
    return !!(v && v.classList.contains('active'))
  }

  function goHqPipelineFocus(taskIdMaybe) {
    var switchView = !hqPipelineVisible()
    if (switchView && typeof window.navigate === 'function') window.navigate('db-dashboard')
    var delay = switchView ? 350 : 0
    setTimeout(function () {
      try {
        window.dispatchEvent(new CustomEvent('vx-hq3-focus-pipeline', { detail: { taskId: taskIdMaybe || undefined } }))
      } catch (_) { /* noop */ }
    }, delay)
  }

  function goStudio(clipIdMaybe) {
    if (clipIdMaybe) {
      try {
        sessionStorage.setItem('vxStudioClipFocus', String(clipIdMaybe))
      } catch (_) { /* noop */ }
    }
    if (typeof window.navigate === 'function') window.navigate('db-studio')
  }

  function goPosts() {
    if (typeof window.navigate === 'function') window.navigate('db-posts')
  }

  function goSettingsBilling() {
    if (typeof window.navigate === 'function') window.navigate('db-settings')
    setTimeout(function () {
      var tabs = document.querySelectorAll('.settings-nav .settings-nav-item')
      var billingBtn = null
      tabs.forEach(function (el) {
        if (/billing/i.test(String(el.textContent || ''))) billingBtn = el
      })
      if (billingBtn && typeof window.switchSettings === 'function') {
        window.switchSettings(billingBtn, 'billing')
      }
    }, 400)
  }

  /**
   * Map persistent notification payload → current SPA (HQ pipeline, Studio,
   * Posts). Legacy URLs like /dashboard/tasks/* and /work?tab=content are
   * rewritten here rather than chasing every emitter.
   */
  function runNotificationAction(n) {
    var meta = n.metadata || {}
    var rawUrl = n.actionUrl
    var url = typeof rawUrl === 'string' ? rawUrl : ''
    var taskFromUrl = parseDashboardTasksPath(url)
    var tid =
      meta.nextTaskId || meta.next_task_id || meta.taskId || meta.nextTaskID || taskFromUrl || null

    var openContentTab =
      meta.tab === 'content' ||
      (typeof n.actionLabel === 'string' && /open\s+content\s+tab/i.test(n.actionLabel))

    if (n.type === 'payment_failed' || /\/settings\/billing/.test(url)) {
      goSettingsBilling()
      return
    }

    if (/\/db-team/.test(url) || /\bthought=/.test(url)) {
      if (typeof window.navigate === 'function') window.navigate('db-team')
      return
    }

    if (/\/app\?/.test(url) && /meeting=/.test(url)) {
      if (typeof window.navigate === 'function') window.navigate('db-team')
      return
    }

    if (n.type === 'task_approved' && openContentTab) {
      goPosts()
      return
    }

    if (url.includes('/work') && /tab=content/i.test(url)) {
      var cid = meta.clipId || meta.clip_id
      goStudio(cid || undefined)
      return
    }

    if (n.type === 'video_ready') {
      goStudio(meta.clipId || meta.clip_id || undefined)
      return
    }

    if (url.includes('/dashboard/strategy') || url.includes('/dashboard/trends')) {
      goHqPipelineFocus(null)
      return
    }

    if (url.replace(/\/$/, '') === '/dashboard/tasks' || url.endsWith('/dashboard/tasks')) {
      goHqPipelineFocus(null)
      return
    }

    if (taskFromUrl) {
      goHqPipelineFocus(taskFromUrl)
      return
    }

    if (n.type === 'meeting_summary' || n.type === 'plan_ready' || n.type === 'trend_report_ready') {
      goHqPipelineFocus(null)
      return
    }

    if (tid && typeof tid === 'string') {
      goHqPipelineFocus(tid)
      return
    }

    if (rawUrl && (String(rawUrl).startsWith('http') || String(rawUrl).startsWith('/'))) {
      window.location.href = absUrl(rawUrl)
      return
    }

    goHqPipelineFocus(null)
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
        '<p style="margin:0 0 14px;font-size:12px;line-height:1.5;color:var(--t2)">No alerts yet. Open the live pipeline on HQ or review clips in Studio.</p>' +
        '<div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center">' +
        '<button type="button" id="vx-notif-empty-hq" style="flex:1;min-width:120px;background:var(--t1);color:var(--bg);border:none;padding:8px 14px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">HQ pipeline</button>' +
        '<button type="button" id="vx-notif-empty-studio" style="flex:1;min-width:120px;background:transparent;color:var(--t1);border:1px solid var(--b1);padding:8px 14px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">Studio</button>' +
        '</div>'
      list.appendChild(empty)
      empty.querySelector('#vx-notif-empty-hq')?.addEventListener('click', (e) => {
        e.stopPropagation()
        goHqPipelineFocus(null)
        setOpen(false)
      })
      empty.querySelector('#vx-notif-empty-studio')?.addEventListener('click', (e) => {
        e.stopPropagation()
        goStudio()
        setOpen(false)
      })
      return
    }
    for (const n of state.items.slice(0, 20)) {
      const row = document.createElement('div')
      row.style.cssText = `
        display:flex;flex-direction:column;gap:8px;padding:14px 18px;border-bottom:1px solid var(--b1);
        ${n.isRead ? 'opacity:.55' : ''}
      `
      const meta = n.metadata || {}
      const linkedId =
        meta.nextTaskId || meta.next_task_id || meta.taskId || meta.clipId || meta.clip_id
      const hasLegacyUrl = !!(n.actionUrl && typeof n.actionUrl === 'string')
      const hasAction = Boolean(
        n.actionLabel && (linkedId || hasLegacyUrl || n.type === 'meeting_summary' || n.type === 'plan_ready' || n.type === 'trend_report_ready'),
      )
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
        runNotificationAction(n)
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
            // Trigger pipeline + briefs refresh on task-related notifications
            try {
              window.dispatchEvent(new CustomEvent('vx-task-changed'))
              if (typeof window.refreshBriefs === 'function') window.refreshBriefs()
            } catch {}
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

  function bellIsVisible(btn) {
    if (!btn) return false
    if (btn.style.display === 'none') return false
    try {
      return window.getComputedStyle(btn).display !== 'none'
    } catch {
      return true
    }
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

  function bootStreamIfNeeded(btn) {
    if (state.sseStarted) return
    if (!bellIsVisible(btn)) return
    state.sseStarted = true
    loadInitial().then(connectStream)
  }

  function init() {
    const btn = document.getElementById('notif-btn')
    wireBellClick()
    bootStreamIfNeeded(btn)
  }

  // Kick off once after dashboard enter (login flow)
  const prevEnter = window.enterDashboard
  window.enterDashboard = async function () {
    if (typeof prevEnter === 'function') await prevEnter()
    setTimeout(init, 100)
  }

  // Session restore + HQ v3 skip enterDashboard chain — bell had no listener.
  // Debounce: vx-dash-ready fires twice from dashboard-v2; navigate + multiple
  // hooks can queue several microtasks — one init is enough.
  var kickTimer = null
  function kickFromAppShell () {
    clearTimeout(kickTimer)
    kickTimer = setTimeout(function () {
      kickTimer = null
      init()
    }, 50)
  }
  window.addEventListener('vx-dash-ready', kickFromAppShell)
  window.addEventListener('vx-dashboard-ready', kickFromAppShell)
  window.addEventListener('vx-app-topbar-synced', kickFromAppShell)
  ;(function hookNotifNavigate () {
    const pn = window.navigate
    if (typeof pn !== 'function') return
    window.navigate = function (id) {
      const ret = pn.apply(this, arguments)
      if (typeof id === 'string' && /^db-/.test(id)) kickFromAppShell()
      return ret
    }
  })()

})()
