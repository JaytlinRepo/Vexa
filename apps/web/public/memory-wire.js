/* Sovexa — brand memory settings panel
 *
 * Injects a new "Memory" tab into #view-db-settings with a CRUD UI against
 * /api/memory. Lets the CEO see and edit what the team has learned about
 * them — which facts are shaping agent responses.
 */
;(function () {
  const TYPE_LABEL = {
    preference: 'Preference',
    feedback: 'Correction',
    voice: 'Voice rule',
    performance: 'What worked',
  }

  const TYPE_COLOR = {
    preference: 'var(--t1)',
    feedback: '#e8c87a',
    voice: '#b482ff',
    performance: '#6ab4ff',
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    } catch { return '' }
  }

  async function fetchMemories() {
    try {
      const res = await fetch('/api/memory', { credentials: 'include' })
      if (!res.ok) return []
      const json = await res.json()
      return json.memories || []
    } catch { return [] }
  }

  async function deleteMemory(id) {
    await fetch('/api/memory/' + id, { method: 'DELETE', credentials: 'include' })
  }

  async function createMemory(payload) {
    const res = await fetch('/api/memory', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return res.ok
  }

  function ensureTab() {
    const nav = document.querySelector('#view-db-settings .settings-nav') ||
      document.querySelector('.settings-nav')
    if (!nav) return
    if (document.getElementById('vx-settings-memory-tab')) return
    const btn = document.createElement('button')
    btn.id = 'vx-settings-memory-tab'
    btn.className = 'settings-nav-item'
    btn.textContent = 'Memory'
    btn.setAttribute('onclick', "switchSettings(this,'memory')")
    nav.appendChild(btn)
  }

  function ensurePanel() {
    if (document.getElementById('settings-memory')) return
    const container = document.querySelector('#view-db-settings .settings-panel')?.parentElement
    if (!container) return
    const panel = document.createElement('div')
    panel.className = 'settings-panel'
    panel.id = 'settings-memory'
    panel.innerHTML = `
      <div class="settings-section">
        <h3>Brand Memory</h3>
        <p>What your team has learned about you from approvals, rejections, and meetings. Every item here shows up in every agent's system prompt — they actually use it.</p>
        <div id="vx-memory-add" style="display:grid;grid-template-columns:120px 1fr auto;gap:8px;margin:14px 0;align-items:center">
          <select id="vx-mem-type" style="padding:10px 12px;background:var(--s2);border:1px solid var(--b1);border-radius:8px;color:var(--t1);font-size:13px;font-family:inherit">
            <option value="preference">Preference</option>
            <option value="feedback">Correction</option>
            <option value="voice">Voice rule</option>
            <option value="performance">What worked</option>
          </select>
          <input id="vx-mem-text" placeholder="e.g. Never use the phrase 'game-changer'" style="padding:10px 14px;background:var(--s2);border:1px solid var(--b1);border-radius:8px;color:var(--t1);font-size:13px;font-family:inherit" />
          <button id="vx-mem-add-btn" style="background:var(--t1);color:var(--bg);border:none;padding:10px 18px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">Add</button>
        </div>
        <div id="vx-memory-list" style="margin-top:12px"></div>
      </div>
    `
    container.appendChild(panel)

    panel.querySelector('#vx-mem-add-btn').addEventListener('click', async () => {
      const type = panel.querySelector('#vx-mem-type').value
      const text = panel.querySelector('#vx-mem-text').value.trim()
      if (text.length < 3) return
      const ok = await createMemory({ type, summary: text })
      if (ok) {
        panel.querySelector('#vx-mem-text').value = ''
        renderList()
      }
    })
  }

  async function renderList() {
    const list = document.getElementById('vx-memory-list')
    if (!list) return
    const memories = await fetchMemories()
    if (memories.length === 0) {
      list.innerHTML = `
        <div style="padding:24px;text-align:center;color:var(--t3);font-size:13px;border:1px dashed var(--b1);border-radius:10px">
          No memories yet. As you approve and reject work, your team builds a picture here.
        </div>`
      return
    }
    list.innerHTML = memories.map((m) => {
      const type = m.memoryType
      const color = TYPE_COLOR[type] || 'var(--t2)'
      const label = TYPE_LABEL[type] || type
      const summary = m.content?.summary || '—'
      const source = m.content?.source || 'manual'
      return `
        <div style="display:flex;gap:12px;padding:12px 14px;border:1px solid var(--b1);border-radius:10px;margin-bottom:8px;background:var(--s2)">
          <span style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:4px 8px;border-radius:10px;background:${color}22;color:${color};flex-shrink:0;height:fit-content">${escapeHtml(label)}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;color:var(--t1);line-height:1.5">${escapeHtml(summary)}</div>
            <div style="font-size:11px;color:var(--t3);margin-top:4px">from ${escapeHtml(source)} · ${escapeHtml(fmtDate(m.createdAt))} · weight ${m.weight.toFixed(1)}</div>
          </div>
          <button data-del="${m.id}" style="background:transparent;border:1px solid var(--b2);color:var(--t3);width:28px;height:28px;border-radius:6px;font-size:14px;cursor:pointer;flex-shrink:0;font-family:inherit" title="Delete">×</button>
        </div>
      `
    }).join('')
    list.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true
        await deleteMemory(btn.dataset.del)
        renderList()
      })
    })
  }

  function init() {
    if (!document.getElementById('view-db-settings')) return
    ensureTab()
    ensurePanel()
    renderList()
  }

  const prevEnter = window.enterDashboard
  window.enterDashboard = async function () {
    if (typeof prevEnter === 'function') await prevEnter()
    setTimeout(init, 300)
  }

  const origNavigate = window.navigate
  window.navigate = function (id) {
    const r = typeof origNavigate === 'function' ? origNavigate(id) : undefined
    if (id === 'db-settings') setTimeout(() => { init(); renderList() }, 150)
    return r
  }

})()
