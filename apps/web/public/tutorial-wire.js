/* Vexa — first-run tips & contextual tips for review / in-progress work.
 *
 * 1) Main tutorial on `vx-dashboard-ready` (once, unless dismissed forever).
 * 2) After the tutorial closes — or immediately if the tutorial was already
 *    completed — a short extra wizard when tasks need review or are still
 *    running, with explicit Approve / Reject guidance and an Open queue action.
 */
;(function () {
  const STORAGE_DONE = 'vx_tutorial_v1_done'
  const SESSION_SHOWN = 'vx_tutorial_shown_session'
  const SESSION_CTX_SHOWN = 'vx_contextual_tip_shown_session'
  const STYLE_ID = 'vx-tutorial-styles'

  const STEPS = [
    {
      title: 'Welcome to your command center',
      body:
        'This dashboard is where you see what needs a decision, what your team is doing, and how you are tracking. You do not manage every step — you step in when it matters.',
    },
    {
      title: 'Start with the queue',
      body:
        'Open **Tasks** or **Work queue** when something is waiting for review. **Approve** when you are happy for the team to ship it and trigger the next step. **Reject** when you want a revision — add a short note so the teammate knows what to change (optional, but it trains memory faster).',
    },
    {
      title: 'Give the team a brief',
      body:
        'From **Your team**, use **Brief** on Maya, Jordan, Alex, or Riley to assign real work. Pick a preset that matches what you need this week.',
    },
    {
      title: 'Call a meeting when you want context',
      body:
        '**Meeting** opens a live conversation with that teammate. You can still **Approve**, **Reject**, or type a **suggestion** in the meeting flow when a deliverable is on the table.',
    },
    {
      title: 'Connect Instagram in Settings',
      body:
        'Under **Settings**, link your account so trends and plans use your real audience and performance — not generic advice.',
    },
  ]

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  function mdLight(s) {
    const safe = esc(s)
    return safe.replace(/\*\*([^*]+)\*\*/g, '<strong style="color:var(--t1);font-weight:600">$1</strong>')
  }

  function isDone() {
    try {
      return localStorage.getItem(STORAGE_DONE) === '1'
    } catch {
      return false
    }
  }

  function markDone() {
    try {
      localStorage.setItem(STORAGE_DONE, '1')
    } catch {}
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return
    const s = document.createElement('style')
    s.id = STYLE_ID
    s.textContent = `
      #vx-tutorial-overlay,#vx-context-overlay{position:fixed;inset:0;z-index:9450;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);padding:20px;font-family:'DM Sans',sans-serif}
      #vx-tutorial-card,#vx-context-card{width:100%;max-width:440px;background:var(--s1);border:1px solid var(--b1);border-radius:14px;padding:26px 26px 20px;color:var(--t1);box-shadow:0 20px 60px rgba(0,0,0,.25)}
      #vx-tutorial-card .vx-tt-eyebrow,#vx-context-card .vx-tt-eyebrow{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--t3);margin-bottom:6px}
      #vx-tutorial-card h3,#vx-context-card h3{font-family:'Syne',sans-serif;font-size:22px;margin:0 0 12px;font-weight:600;line-height:1.2}
      #vx-tutorial-card .vx-tt-body,#vx-context-card .vx-tt-body{font-size:14px;line-height:1.6;color:var(--t2);margin:0 0 18px}
      #vx-tutorial-card .vx-tt-dots,#vx-context-card .vx-tt-dots{display:flex;gap:6px;margin-bottom:16px}
      #vx-tutorial-card .vx-tt-dot,#vx-context-card .vx-tt-dot{width:7px;height:7px;border-radius:50%;background:var(--b2)}
      #vx-tutorial-card .vx-tt-dot.on,#vx-context-card .vx-tt-dot.on{background:var(--t1)}
      #vx-tutorial-card .vx-tt-actions,#vx-context-card .vx-tt-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between}
      #vx-tutorial-card .vx-tt-actions > div,#vx-context-card .vx-tt-actions > div{display:flex;gap:8px;flex-wrap:wrap}
      #vx-tutorial-card button.vx-tt-primary,#vx-context-card button.vx-tt-primary{background:var(--t1);color:var(--bg);border:none;padding:10px 18px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit}
      #vx-tutorial-card button.vx-tt-secondary,#vx-context-card button.vx-tt-secondary{background:transparent;border:1px solid var(--b2);color:var(--t2);padding:10px 14px;border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit}
      #vx-tutorial-card button.vx-tt-ghost,#vx-context-card button.vx-tt-ghost{background:none;border:none;color:var(--t3);font-size:11px;cursor:pointer;font-family:inherit;text-decoration:underline;padding:6px}
      #vx-context-card .vx-tt-task-list{margin:0 0 14px;padding:0;list-style:none;font-size:12px;color:var(--t2);line-height:1.5;border-top:1px solid var(--b1);border-bottom:1px solid var(--b1);padding:12px 0}
      #vx-context-card .vx-tt-task-list li{padding:4px 0;border-bottom:1px dashed var(--b1);display:flex;justify-content:space-between;gap:8px}
      #vx-context-card .vx-tt-task-list li:last-child{border-bottom:none}
      #vx-context-card .vx-tt-pill{font-size:9px;letter-spacing:.06em;text-transform:uppercase;padding:2px 8px;border-radius:999px;background:var(--s3);color:var(--t3);flex-shrink:0}
    `
    document.head.appendChild(s)
  }

  let open = false
  let contextOpen = false
  let escapeHandler = null
  let contextEscapeHandler = null

  function shownThisSession() {
    try {
      return sessionStorage.getItem(SESSION_SHOWN) === '1'
    } catch {
      return false
    }
  }

  function markShownThisSession() {
    try {
      sessionStorage.setItem(SESSION_SHOWN, '1')
    } catch {}
  }

  function contextualShownThisSession() {
    try {
      return sessionStorage.getItem(SESSION_CTX_SHOWN) === '1'
    } catch {
      return false
    }
  }

  function markContextualShownThisSession() {
    try {
      sessionStorage.setItem(SESSION_CTX_SHOWN, '1')
    } catch {}
  }

  function closeOverlay() {
    const wasTutorial = !!document.getElementById('vx-tutorial-overlay')
    document.getElementById('vx-tutorial-overlay')?.remove()
    open = false
    if (escapeHandler) {
      document.removeEventListener('keydown', escapeHandler)
      escapeHandler = null
    }
    if (wasTutorial) scheduleContextualTips(500)
  }

  function closeContextOverlay() {
    document.getElementById('vx-context-overlay')?.remove()
    contextOpen = false
    if (contextEscapeHandler) {
      document.removeEventListener('keydown', contextEscapeHandler)
      contextEscapeHandler = null
    }
  }

  function showStep(index) {
    const step = STEPS[index]
    if (!step) return
    const overlay = document.getElementById('vx-tutorial-overlay')
    if (!overlay) return
    const card = overlay.querySelector('#vx-tutorial-card')
    if (!card) return
    card.innerHTML = `
      <div class="vx-tt-eyebrow">Quick tips · ${index + 1} of ${STEPS.length}</div>
      <h3 id="vx-tutorial-title">${esc(step.title)}</h3>
      <p class="vx-tt-body">${mdLight(step.body)}</p>
      <div class="vx-tt-dots" role="presentation">
        ${STEPS.map((_, i) => `<span class="vx-tt-dot ${i === index ? 'on' : ''}"></span>`).join('')}
      </div>
      <div class="vx-tt-actions">
        <button type="button" class="vx-tt-ghost" data-vx-tt-never>Don't show again</button>
        <div>
          ${index > 0 ? '<button type="button" class="vx-tt-secondary" data-vx-tt-back>Back</button>' : ''}
          ${
            index < STEPS.length - 1
              ? '<button type="button" class="vx-tt-primary" data-vx-tt-next>Next</button>'
              : '<button type="button" class="vx-tt-primary" data-vx-tt-finish>Get started</button>'
          }
        </div>
      </div>
    `
    card.querySelector('[data-vx-tt-never]')?.addEventListener('click', () => {
      markDone()
      closeOverlay()
    })
    card.querySelector('[data-vx-tt-back]')?.addEventListener('click', () => showStep(index - 1))
    card.querySelector('[data-vx-tt-next]')?.addEventListener('click', () => showStep(index + 1))
    card.querySelector('[data-vx-tt-finish]')?.addEventListener('click', () => {
      markDone()
      closeOverlay()
    })
  }

  function openTutorial() {
    if (open) return
    if (isDone()) return
    if (shownThisSession()) return
    injectStyles()
    markShownThisSession()
    open = true
    const overlay = document.createElement('div')
    overlay.id = 'vx-tutorial-overlay'
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-modal', 'true')
    overlay.setAttribute('aria-labelledby', 'vx-tutorial-title')
    overlay.innerHTML = '<div id="vx-tutorial-card"></div>'
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeOverlay()
    })
    document.body.appendChild(overlay)
    showStep(0)
    escapeHandler = (e) => {
      if (e.key === 'Escape') closeOverlay()
    }
    document.addEventListener('keydown', escapeHandler)
  }

  // ── Contextual tips (review + in-flight work) ─────────────────────────────

  async function fetchTasks() {
    try {
      const res = await fetch('/api/tasks', { credentials: 'include' })
      if (!res.ok) return []
      const json = await res.json()
      return json.tasks || []
    } catch {
      return []
    }
  }

  function formatType(t) {
    return String(t || 'task').replace(/_/g, ' ')
  }

  function buildContextualSteps(tasks) {
    const delivered = tasks.filter((t) => t.status === 'delivered')
    const active = tasks.filter((t) => ['pending', 'in_progress', 'revision'].includes(t.status))
    const steps = []

    if (delivered.length > 0) {
      const lines = delivered.slice(0, 5).map((t) => {
        const emp = t.employee?.name || 'Teammate'
        const title = (t.title || 'Deliverable').slice(0, 56)
        return `<li><span>${esc(title)}</span><span class="vx-tt-pill">${esc(emp)} · ${esc(formatType(t.type))}</span></li>`
      })
      const more =
        delivered.length > 5 ? `<li style="border:none;color:var(--t3);font-size:11px">+ ${delivered.length - 5} more in the queue…</li>` : ''
      steps.push({
        title:
          delivered.length === 1 ? '1 item needs your review' : `${delivered.length} items need your review`,
        body:
          'These are **delivered** — the team is waiting on you. Use **Approve** to ship and auto-chain the next step where your plan allows. Use **Reject** to send work back for a revision.',
        listHtml: `<ul class="vx-tt-task-list">${lines.join('')}${more}</ul>`,
        showQueue: true,
        showRejectHint: true,
      })
    }

    if (active.length > 0) {
      const lines = active.slice(0, 5).map((t) => {
        const emp = t.employee?.name || 'Teammate'
        const title = (t.title || 'Brief').slice(0, 56)
        const st = t.status === 'revision' ? 'revising' : t.status === 'pending' ? 'queued' : 'in progress'
        return `<li><span>${esc(title)}</span><span class="vx-tt-pill">${esc(emp)} · ${esc(st)}</span></li>`
      })
      const more =
        active.length > 5 ? `<li style="border:none;color:var(--t3);font-size:11px">+ ${active.length - 5} more…</li>` : ''
      steps.push({
        title:
          active.length === 1 ? '1 brief still in motion' : `${active.length} briefs still in motion`,
        body:
          'Nothing to approve here yet — the team is executing. When something is **delivered**, it will show in **Awaiting review** and you will get a notification. You can always open **Tasks** to see the full list.',
        listHtml: `<ul class="vx-tt-task-list">${lines.join('')}${more}</ul>`,
        showQueue: false,
        showRejectHint: false,
      })
    }

    return steps
  }

  function showContextStep(steps, index) {
    const step = steps[index]
    if (!step) return
    const overlay = document.getElementById('vx-context-overlay')
    if (!overlay) return
    const card = overlay.querySelector('#vx-context-card')
    if (!card) return
    const queueBtn =
      step.showQueue && typeof window.navigate === 'function'
        ? '<button type="button" class="vx-tt-secondary" data-vx-ctx-queue>Open queue</button>'
        : ''
    card.innerHTML = `
      <div class="vx-tt-eyebrow">Your work · ${index + 1} of ${steps.length}</div>
      <h3 id="vx-context-title">${esc(step.title)}</h3>
      ${step.listHtml || ''}
      <p class="vx-tt-body">${mdLight(step.body)}</p>
      ${
        step.showRejectHint
          ? `<p class="vx-tt-body" style="font-size:12px;margin-top:-8px">${mdLight(
              'After **Reject**, you can add an optional note in the prompt — it is saved with the task so the revision matches what you want.'
            )}</p>`
          : ''
      }
      <div class="vx-tt-dots" role="presentation">
        ${steps.map((_, i) => `<span class="vx-tt-dot ${i === index ? 'on' : ''}"></span>`).join('')}
      </div>
      <div class="vx-tt-actions">
        <button type="button" class="vx-tt-ghost" data-vx-ctx-skip>Remind me later</button>
        <div>
          ${index > 0 ? '<button type="button" class="vx-tt-secondary" data-vx-ctx-back>Back</button>' : ''}
          ${
            index < steps.length - 1
              ? '<button type="button" class="vx-tt-primary" data-vx-ctx-next>Next</button>'
              : '<button type="button" class="vx-tt-primary" data-vx-ctx-done>Got it</button>'
          }
          ${queueBtn}
        </div>
      </div>
    `
    card.querySelector('[data-vx-ctx-skip]')?.addEventListener('click', () => {
      markContextualShownThisSession()
      closeContextOverlay()
    })
    card.querySelector('[data-vx-ctx-back]')?.addEventListener('click', () => showContextStep(steps, index - 1))
    card.querySelector('[data-vx-ctx-next]')?.addEventListener('click', () => showContextStep(steps, index + 1))
    card.querySelector('[data-vx-ctx-done]')?.addEventListener('click', () => {
      markContextualShownThisSession()
      closeContextOverlay()
    })
    card.querySelector('[data-vx-ctx-queue]')?.addEventListener('click', () => {
      markContextualShownThisSession()
      closeContextOverlay()
      window.navigate('db-tasks')
    })
  }

  function openContextualWizard(steps) {
    if (contextOpen) return
    if (steps.length === 0) return
    injectStyles()
    contextOpen = true
    const overlay = document.createElement('div')
    overlay.id = 'vx-context-overlay'
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-modal', 'true')
    overlay.setAttribute('aria-labelledby', 'vx-context-title')
    overlay.innerHTML = '<div id="vx-context-card"></div>'
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        markContextualShownThisSession()
        closeContextOverlay()
      }
    })
    document.body.appendChild(overlay)
    showContextStep(steps, 0)
    contextEscapeHandler = (e) => {
      if (e.key === 'Escape') {
        markContextualShownThisSession()
        closeContextOverlay()
      }
    }
    document.addEventListener('keydown', contextEscapeHandler)
  }

  let contextualTimer = null
  function scheduleContextualTips(delayMs) {
    if (contextualShownThisSession()) return
    clearTimeout(contextualTimer)
    contextualTimer = setTimeout(async () => {
      if (contextualShownThisSession()) return
      if (open || document.getElementById('vx-tutorial-overlay')) return
      const tasks = await fetchTasks()
      const steps = buildContextualSteps(tasks)
      if (steps.length === 0) return
      openContextualWizard(steps)
    }, delayMs)
  }

  window.addEventListener('vx-dashboard-ready', () => {
    setTimeout(() => {
      if (!isDone()) {
        openTutorial()
      } else {
        scheduleContextualTips(400)
      }
    }, 700)
  })

  let taskChangeDebounce
  window.addEventListener('vx-task-changed', () => {
    clearTimeout(taskChangeDebounce)
    taskChangeDebounce = setTimeout(() => {
      if (contextualShownThisSession()) return
      if (open || document.getElementById('vx-tutorial-overlay') || document.getElementById('vx-context-overlay')) return
      scheduleContextualTips(200)
    }, 400)
  })

  /** Let Settings or help link re-open the tour. */
  window.vxReplayTutorial = function () {
    try {
      localStorage.removeItem(STORAGE_DONE)
      sessionStorage.removeItem(SESSION_SHOWN)
      sessionStorage.removeItem(SESSION_CTX_SHOWN)
    } catch {}
    open = false
    openTutorial()
  }

  window.vxReplayContextualTips = function () {
    try {
      sessionStorage.removeItem(SESSION_CTX_SHOWN)
    } catch {}
    scheduleContextualTips(100)
  }
})()
