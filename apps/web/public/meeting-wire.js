/* Vexa — meeting room streaming client
 *
 * Replaces the prototype's mrSendBtn canned-response with a real streaming call
 * to /api/meeting/reply. Streams tokens into the latest message bubble in real
 * time. Maps the employee name to a role so the backend picks the right
 * persona + system prompt.
 */
;(function () {
  const ROLE_BY_NAME = {
    Maya: 'analyst',
    Jordan: 'strategist',
    Alex: 'copywriter',
    Riley: 'creative_director',
  }

  let history = []
  let currentRole = 'copywriter'
  let currentName = 'Alex'
  let streaming = false

  const originalOpen = window.openMeeting
  window.openMeeting = function (name, role, init) {
    currentRole = ROLE_BY_NAME[name] || 'copywriter'
    currentName = name
    // Claude requires the first message in `messages` to have role='user',
    // so we show the greeting in the UI but do NOT push it into history.
    history = []
    // Reset transient UI state so the previous meeting's stats / chips
    // don't bleed in.
    document.getElementById('vx-mtg-knowledge')?.remove()
    document.getElementById('vx-mtg-quickreplies')?.remove()
    document.getElementById('vx-mtg-viewbrief')?.remove()
    document.getElementById('vx-mtg-review-actions')?.remove()
    const msgs = document.getElementById('mr-msgs')
    if (msgs) {
      msgs.innerHTML = `
        <div class="mr-msg">
          <div class="mr-bubble">"Hey — ${name} here. What are we working on?"</div>
        </div>
      `
    }
    if (typeof originalOpen === 'function') originalOpen(name, role, init)
  }

  // Open the meeting room with a brief already on the table — the agent
  // greets the CEO with a presentation message, quick-reply chips show
  // suggested follow-ups, and a "View brief" button opens the structured
  // output detail. Used by team-wire when a brief is freshly delivered.
  window.openMeetingWithPresentation = function (opts) {
    const { name, role, init, presentation, output, task } = opts
    if (typeof window.openMeeting !== 'function') return
    window.openMeeting(name, role, init)
    // openMeeting reset the messages — give it a tick, then replace the
    // generic greeting with the agent's presentation.
    setTimeout(() => {
      const msgs = document.getElementById('mr-msgs')
      if (!msgs || !presentation) return
      msgs.innerHTML = `
        <div class="mr-msg">
          <div class="mr-bubble" id="vx-mtg-opener"></div>
        </div>
      `
      const bubble = document.getElementById('vx-mtg-opener')
      if (bubble) bubble.innerHTML = renderAgentMarkdown(presentation.opening)
      // Seed the conversation history with the agent's opener so when the
      // CEO replies, the agent has context for what they just said.
      history = [
        { role: 'user', content: '[Brief delivered — please present it.]' },
        { role: 'assistant', content: presentation.opening },
      ]
      renderQuickReplies(presentation.suggestedReplies || [])
      renderViewBriefButton(presentation.viewLabel || 'Open the brief', output)
      if (task) renderMeetingReviewBar(task)
    }, 60)
  }

  function buildSyntheticOpening(name, task, output) {
    const pres = output?.content?.presentation
    if (pres?.opening) return pres.opening

    const c = output?.content || {}
    const type = output?.type || task?.type || ''

    // ── Trend report ────────────────────────────────────────────────
    if (type === 'trend_report' && c.trends?.length) {
      const top = c.trends[0]
      const count = c.trends.length
      const topOpp = c.topOpportunity || ''
      let msg = `Hey — ${name} here. I pulled **${count} trends** relevant to your niche right now.\n\n`
      msg += `The one I'd move on first: **${top.topic}** — ${top.whyItMatters || ''}\n\n`
      if (top.suggestedHook) msg += `Ready-to-use hook: *"${top.suggestedHook}"*\n\n`
      if (topOpp) msg += `**My top recommendation:** ${topOpp}\n\n`
      msg += `The full breakdown is below. **Approve** to pass these to Jordan for planning, **revise** if you want a different angle, or type a question.`
      return msg
    }

    // ── Performance review ──────────────────────────────────────────
    if (type === 'performance_review' && c.accountHealth) {
      const h = c.accountHealth
      const wins = c.whatsWorking || []
      const losses = c.whatsNotWorking || []
      const traj = c.trajectory || 'stable'
      let msg = `Hey — ${name} here. I went through your TikTok account **@${c.accountHandle || ''}** end to end.\n\n`
      msg += `**Account snapshot:** ${fmtK(h.followerCount)} followers, ${(h.engagementRate || 0).toFixed(1)}% engagement, ${fmtK(h.avgViews)} avg views.\n\n`
      if (wins.length > 0) {
        msg += `**What's working:** Your top video *"${truncate(wins[0].videoTitle, 60)}"* hit ${fmtK(wins[0].viewCount)} views. ${wins[0].whyItWorked}\n\n`
      }
      if (losses.length > 0) {
        msg += `**What's not:** *"${truncate(losses[0].videoTitle, 60)}"* underperformed — ${losses[0].whyItUnderperformed}\n\n`
      }
      msg += `**Trajectory:** ${traj}. `
      if (c.topRecommendation) msg += c.topRecommendation
      msg += `\n\nFull analysis is below. **Approve** to brief the team on this, or tell me what to dig deeper on.`
      return msg
    }

    // ── Weekly pulse ────────────────────────────────────────────────
    if (type === 'weekly_pulse') {
      const win = c.winOfTheWeek
      const miss = c.missOfTheWeek
      const traj = c.trajectory || {}
      let msg = `Morning — ${name} here with your Monday pulse for **@${c.accountHandle || ''}**.\n\n`
      if (win) msg += `**Win of the week:** *"${truncate(win.videoTitle, 50)}"* — ${win.whyItWorked}\n\n`
      if (miss) msg += `**Miss of the week:** *"${truncate(miss.videoTitle, 50)}"* — ${miss.whatToTryNext}\n\n`
      if (traj.summary) msg += `**Trajectory:** ${traj.summary}\n\n`
      if (c.oneThingToDo) msg += `**One thing to do this week:** ${c.oneThingToDo}\n\n`
      msg += `That's the quick version. **Approve** to move on, or ask me to run a **full analysis** if something needs a deeper look.`
      return msg
    }

    // ── Content plan ────────────────────────────────────────────────
    if (type === 'content_plan' && c.days?.length) {
      const dayCount = c.days.length
      const firstDay = c.days[0]
      let msg = `Hey — ${name} here. I built a **${dayCount}-day content plan** for this week.\n\n`
      if (firstDay) msg += `Kicking off with: **${firstDay.topic || firstDay.title || 'Day 1'}** — ${firstDay.format || ''}\n\n`
      if (c.strategyNote) msg += `${c.strategyNote}\n\n`
      msg += `Full calendar is below. **Approve** to hand it to Alex for copy, or tell me what to adjust.`
      return msg
    }

    // ── Hooks ───────────────────────────────────────────────────────
    if (type === 'hooks' && c.hooks?.length) {
      const count = c.hooks.length
      const best = c.hooks[0]
      let msg = `Hey — ${name} here. I wrote **${count} hooks**.\n\n`
      if (best?.text || best?.hook) msg += `My pick: *"${truncate(best.text || best.hook, 80)}"*\n\n`
      if (c.alexNote) msg += `${c.alexNote}\n\n`
      msg += `All ${count} are below. **Approve** your favorite to send to Riley for production, or tell me to go bolder.`
      return msg
    }

    // ── Fallback ────────────────────────────────────────────────────
    const title = task?.title || 'this deliverable'
    return `Hey — ${name} here. I just finished **${title}**. The full output is below — **approve** it, ask for a **revision**, or type a question.`
  }

  function fmtK(n) {
    if (!n && n !== 0) return '—'
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K'
    return String(n)
  }
  function truncate(s, len) {
    if (!s) return ''
    return s.length > len ? s.slice(0, len) + '…' : s
  }

  function appendMeetingBubble(markdownText, isUser) {
    const msgs = document.getElementById('mr-msgs')
    if (!msgs) return
    const div = document.createElement('div')
    div.className = 'mr-msg' + (isUser ? ' user' : '')
    const inner = document.createElement('div')
    inner.className = 'mr-bubble'
    inner.innerHTML = isUser ? escapeHtml(markdownText) : renderAgentMarkdown(markdownText)
    div.appendChild(inner)
    msgs.appendChild(div)
    msgs.scrollTop = msgs.scrollHeight
  }

  async function meetingTaskApprove(taskId) {
    const res = await fetch(`/api/tasks/${taskId}/action`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    })
    if (!res.ok) {
      appendMeetingBubble('Could not record approval — try again from the queue.', false)
      return
    }
    const data = await res.json().catch(() => ({}))
    document.getElementById('vx-mtg-review-actions')?.remove()
    appendMeetingBubble('**Recorded — approved.** Moving this forward.', false)
    const chain = data.chain
    if (chain && chain.ok === true) {
      appendMeetingBubble(
        `**${chain.nextEmployeeName}** picked up **"${chain.title}"** — it is in your queue when you are ready.`,
        false
      )
    } else if (chain && chain.reason === 'end_of_pipeline') {
      appendMeetingBubble('That was the last step in this pipeline for this run.', false)
    } else if (chain && chain.reason === 'quota_exceeded') {
      appendMeetingBubble('Plan task limit blocked the next role — check usage or wait for reset.', false)
    }
    try {
      window.dispatchEvent(new CustomEvent('vx-task-changed', { detail: { task: data.task } }))
    } catch {}
    history.push({ role: 'user', content: '[Approved in meeting.]' })
    history.push({ role: 'assistant', content: 'Approval recorded in the system.' })
  }

  async function meetingTaskReject(taskId) {
    const fb = window.prompt('What should change? (optional — helps the revision)')
    if (fb === null) return
    const res = await fetch(`/api/tasks/${taskId}/action`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject', feedback: fb || undefined }),
    })
    if (!res.ok) {
      appendMeetingBubble('Could not record rejection — try again from the queue.', false)
      return
    }
    document.getElementById('vx-mtg-review-actions')?.remove()
    appendMeetingBubble('**Understood — revision requested.** I will rework from your note.', false)
    try {
      window.dispatchEvent(new CustomEvent('vx-task-changed', {}))
    } catch {}
    history.push({ role: 'user', content: fb ? `Reject: ${fb}` : '[Rejected in meeting.]' })
    history.push({ role: 'assistant', content: 'Revision request recorded.' })
  }

  function meetingTaskSuggest() {
    const inp = document.getElementById('mr-input-field')
    if (!inp) return
    inp.placeholder = 'Type your suggestion, then Send…'
    inp.value = ''
    inp.focus()
    appendMeetingBubble('Use the field below — **type your suggestion** and press Send. I will fold it into the next pass.', false)
  }

  function renderMeetingReviewBar(task) {
    document.getElementById('vx-mtg-review-actions')?.remove()
    const wrapInput = document.querySelector('#meeting-room .mr-input-wrap')
    if (!wrapInput || !task?.id) return
    if (task.status !== 'delivered') return
    const host = wrapInput.parentElement
    const bar = document.createElement('div')
    bar.id = 'vx-mtg-review-actions'
    bar.style.cssText =
      'margin-bottom:14px;padding:14px 0 0;border-top:1px solid var(--b1);max-width:800px;width:100%;margin-left:auto;margin-right:auto'
    bar.innerHTML = `
      <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--t3);margin-bottom:8px;font-family:DM Sans,sans-serif">Your decision</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
        <button type="button" class="vx-mtg-ap" style="background:var(--t1);color:var(--bg);border:none;padding:8px 18px;border-radius:8px;font-size:11px;font-weight:600;font-family:DM Sans,sans-serif;cursor:pointer">Approve</button>
        <button type="button" class="vx-mtg-rj" style="background:transparent;border:1px solid var(--b2);color:var(--t2);padding:8px 18px;border-radius:8px;font-size:11px;font-family:DM Sans,sans-serif;cursor:pointer">Reject</button>
        <button type="button" class="vx-mtg-sg" style="background:transparent;border:1px solid var(--b2);color:var(--t3);padding:8px 18px;border-radius:8px;font-size:11px;font-family:DM Sans,sans-serif;cursor:pointer">Suggestion</button>
        <button type="button" class="vx-mtg-copy" style="background:transparent;border:1px solid var(--b2);color:var(--t3);padding:8px 18px;border-radius:8px;font-size:11px;font-family:DM Sans,sans-serif;cursor:pointer">Copy output</button>
      </div>
    `
    host.insertBefore(bar, wrapInput)
    const tid = task.id
    bar.querySelector('.vx-mtg-ap')?.addEventListener('click', () => meetingTaskApprove(tid))
    bar.querySelector('.vx-mtg-rj')?.addEventListener('click', () => meetingTaskReject(tid))
    bar.querySelector('.vx-mtg-sg')?.addEventListener('click', () => meetingTaskSuggest())
    bar.querySelector('.vx-mtg-copy')?.addEventListener('click', () => {
      const content = output?.content
      if (!content) return
      // Extract the most copy-worthy text from the output
      let text = ''
      if (content.hooks?.length) {
        text = content.hooks.map((h, i) => `${i + 1}. ${h.text || h.hook || h}`).join('\n')
      } else if (content.caption) {
        text = content.caption
      } else if (content.script?.scenes) {
        text = content.script.scenes.map((s) => s.dialogue || s.action || '').join('\n\n')
      } else if (content.keyInsights) {
        text = content.keyInsights.join('\n')
      } else if (content.topRecommendation) {
        text = content.topRecommendation
      } else {
        text = JSON.stringify(content, null, 2)
      }
      navigator.clipboard.writeText(text).then(() => {
        const btn = bar.querySelector('.vx-mtg-copy')
        if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy output' }, 2000) }
      }).catch(() => {})
    })
  }

  /**
   * From a team card or review row: open the room with the agent’s greeting,
   * the structured output on the table (View full output), and approve / reject / suggestion.
   */
  window.openMeetingWithTaskOutput = function (opts) {
    const { name, role, init, task, output } = opts
    currentRole = ROLE_BY_NAME[name] || 'copywriter'
    currentName = name
    history = []
    document.getElementById('vx-mtg-knowledge')?.remove()
    document.getElementById('vx-mtg-quickreplies')?.remove()
    document.getElementById('vx-mtg-viewbrief')?.remove()
    document.getElementById('vx-mtg-review-actions')?.remove()

    if (typeof originalOpen === 'function') originalOpen(name, role, init)

    const inp0 = document.getElementById('mr-input-field')
    if (inp0) {
      inp0.placeholder = `Reply to ${name}…`
    }

    const presentation = output?.content?.presentation
    const opening = presentation?.opening || buildSyntheticOpening(name, task, output)
    const msgs = document.getElementById('mr-msgs')
    if (msgs) {
      msgs.innerHTML = `
        <div class="mr-msg">
          <div class="mr-bubble" id="vx-mtg-opener"></div>
        </div>
      `
      const bubble = document.getElementById('vx-mtg-opener')
      if (bubble) bubble.innerHTML = renderAgentMarkdown(opening)
    }
    history = [
      { role: 'user', content: '[Review this deliverable.]' },
      { role: 'assistant', content: opening.replace(/\*\*([^*]+)\*\*/g, '$1') },
    ]
    renderQuickReplies(presentation?.suggestedReplies || [])
    renderViewBriefButton(presentation?.viewLabel || 'View full output', output)
    renderMeetingReviewBar(task)
  }

  function renderQuickReplies(replies) {
    document.getElementById('vx-mtg-quickreplies')?.remove()
    if (!replies || replies.length === 0) return
    const inputArea = document.querySelector('#meeting-room .mr-input') || document.querySelector('#mr-input-field')?.parentElement
    if (!inputArea) return
    const wrap = document.createElement('div')
    wrap.id = 'vx-mtg-quickreplies'
    wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;padding:8px 14px 0;font-family:DM Sans,sans-serif'
    wrap.innerHTML = replies.map((r, i) =>
      `<button data-vx-reply="${i}" style="background:var(--s2);border:1px solid var(--b1);color:var(--t2);font-size:11px;padding:6px 12px;border-radius:8px;cursor:pointer;font-family:inherit;transition:background .15s,color .15s">${escapeHtml(r)}</button>`
    ).join('')
    inputArea.parentElement?.insertBefore(wrap, inputArea)
    wrap.querySelectorAll('[data-vx-reply]').forEach((btn) => {
      btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--s3)'; btn.style.color = 'var(--t1)' })
      btn.addEventListener('mouseleave', () => { btn.style.background = 'var(--s2)'; btn.style.color = 'var(--t2)' })
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.vxReply)
        const replyText = replies[idx]
        if (!replyText) return
        const inp = document.getElementById('mr-input-field')
        if (inp) inp.value = replyText
        if (typeof window.mrSendBtn === 'function') window.mrSendBtn()
        wrap.remove()
      })
    })
  }

  function renderViewBriefButton(label, output) {
    document.getElementById('vx-mtg-viewbrief')?.remove()
    if (!output) return
    const room = document.getElementById('meeting-room')
    if (!room) return
    const btn = document.createElement('button')
    btn.id = 'vx-mtg-viewbrief'
    btn.style.cssText =
      'position:absolute;top:54px;right:60px;background:var(--t1);color:var(--bg);border:none;font-size:11px;letter-spacing:.04em;padding:7px 14px;border-radius:8px;font-family:DM Sans,sans-serif;font-weight:600;cursor:pointer;z-index:10'
    btn.textContent = label
    btn.addEventListener('click', () => {
      // Hand off to outputs-wire's detail modal, which knows how to
      // render every output type with the proper visuals.
      if (typeof window.vxOpenOutputDetail === 'function') {
        window.vxOpenOutputDetail(output)
      }
    })
    room.appendChild(btn)
  }

  // Show a discreet "Knowledge: N · niche" badge inside the meeting room
  // so the CEO can see the agent is reasoning from a real knowledge base,
  // not generic LLM defaults.
  function renderKnowledgeBadge(knowledgeCount, niche, memoryCount) {
    const room = document.getElementById('meeting-room')
    if (!room) return
    document.getElementById('vx-mtg-knowledge')?.remove()
    const nicheLabel = niche ? String(niche).trim() : 'your niche'
    const parts = []
    if (knowledgeCount > 0) parts.push(`${knowledgeCount} ${escapeHtml(nicheLabel)} knowledge entr${knowledgeCount === 1 ? 'y' : 'ies'}`)
    if (memoryCount > 0) parts.push(`${memoryCount} brand memor${memoryCount === 1 ? 'y' : 'ies'}`)
    if (!parts.length) return
    const badge = document.createElement('div')
    badge.id = 'vx-mtg-knowledge'
    badge.style.cssText =
      'position:absolute;top:14px;right:60px;display:flex;align-items:center;gap:6px;background:var(--s2);border:1px solid var(--b1);color:var(--t2);font-size:10px;letter-spacing:.06em;padding:5px 10px;border-radius:8px;font-family:DM Sans,sans-serif;z-index:10'
    badge.innerHTML = `
      <span style="width:5px;height:5px;border-radius:50%;background:var(--t1)"></span>
      <span>Drawing from ${parts.join(' + ')}</span>
    `
    room.appendChild(badge)
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  // Tiny safe markdown renderer for agent replies. The system prompt
  // tells the agents to format with **bold**, "- " bullets, and blank
  // lines between blocks. We escape first, then convert markers — XSS-
  // safe because no raw HTML is ever injected from the model.
  function renderAgentMarkdown(raw) {
    const safe = escapeHtml(raw || '')
    const lines = safe.split('\n')
    const out = []
    let inList = false
    for (const line of lines) {
      const isBullet = /^\s*-\s+/.test(line)
      if (isBullet) {
        if (!inList) { out.push('<ul style="margin:6px 0 6px 18px;padding:0">'); inList = true }
        out.push('<li style="margin:3px 0;line-height:1.55">' + line.replace(/^\s*-\s+/, '') + '</li>')
      } else {
        if (inList) { out.push('</ul>'); inList = false }
        if (line.trim() === '') {
          out.push('<div style="height:6px"></div>')
        } else {
          out.push('<div style="margin:3px 0;line-height:1.55">' + line + '</div>')
        }
      }
    }
    if (inList) out.push('</ul>')
    let html = out.join('')
    // Bold (run after structural pass so we don't break bullet detection)
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong style="color:var(--t1);font-weight:600">$1</strong>')
    return html
  }

  // Override closeMeeting() so "End Meeting" posts the transcript to
  // /api/meeting/end, gets a summary + auto-created tasks back, and shows
  // them in a little recap modal before the meeting actually closes. If
  // the meeting was empty, we close silently without pinging the API.
  function roleTitle(role) {
    return role === 'analyst' ? 'Trend Analyst'
      : role === 'strategist' ? 'Content Strategist'
      : role === 'copywriter' ? 'Copywriter'
      : role === 'creative_director' ? 'Creative Director'
      : 'Teammate'
  }

  function showSummaryModal(name, data, onDone) {
    document.getElementById('vx-mtg-summary')?.remove()
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
    const tasks = data.tasksCreated || []
    const decisions = data.decisions || []
    const el = document.createElement('div')
    el.id = 'vx-mtg-summary'
    el.style.cssText =
      'position:fixed;inset:0;z-index:9200;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);padding:24px'
    el.innerHTML = `
      <div style="width:100%;max-width:520px;background:var(--bg);border:1px solid var(--b1);border-radius:16px;padding:30px;color:var(--t1);font-family:'DM Sans',sans-serif;max-height:92vh;overflow:auto;backdrop-filter:blur(20px)">
        <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--t3);margin-bottom:4px">Meeting summary</div>
        <h3 style="font-family:'Syne',sans-serif;font-size:22px;margin:0 0 14px">Recap with ${esc(name)}</h3>
        <p style="color:var(--t2);font-size:13px;line-height:1.55;margin:0 0 18px">${esc(data.summary || 'Meeting ended.')}</p>
        ${decisions.length ? `
          <div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--t3);margin-bottom:6px">Decisions</div>
          <ul style="margin:0 0 18px;padding-left:18px;color:var(--t1);font-size:13px;line-height:1.55">
            ${decisions.map((d) => `<li>${esc(d.decision)}</li>`).join('')}
          </ul>
        ` : ''}
        ${tasks.length ? `
          <div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--t3);margin-bottom:6px">Tasks created (${tasks.length})</div>
          <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px">
            ${tasks.map((t) => `
              <div style="background:var(--s2);border:1px solid var(--b1);border-radius:8px;padding:10px 12px">
                <div style="font-size:13px;color:var(--t1);margin-bottom:2px">${esc(t.title)}</div>
                <div style="font-size:11px;color:var(--t3)">Assigned to ${esc(roleTitle(t.employeeRole))}</div>
              </div>
            `).join('')}
          </div>
        ` : `
          <div style="color:var(--t3);font-size:12px;margin-bottom:18px;font-style:italic">No new tasks created from this meeting.</div>
        `}
        <div style="display:flex;justify-content:flex-end;gap:10px">
          ${tasks.length ? `<button id="vx-mtg-go-tasks" style="background:transparent;border:1px solid var(--b2);color:var(--t2);padding:10px 16px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:12px">View tasks</button>` : ''}
          <button id="vx-mtg-close" style="background:var(--t1);color:var(--bg);border:none;padding:10px 18px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:600">Close</button>
        </div>
      </div>
    `
    el.addEventListener('click', (e) => { if (e.target === el) { el.remove(); onDone?.() } })
    document.body.appendChild(el)
    el.querySelector('#vx-mtg-close').addEventListener('click', () => { el.remove(); onDone?.() })
    el.querySelector('#vx-mtg-go-tasks')?.addEventListener('click', () => {
      el.remove()
      onDone?.()
      if (typeof window.navigate === 'function') window.navigate('db-tasks')
    })
  }

  const originalClose = window.closeMeeting
  window.closeMeeting = async function () {
    // Nothing to summarize — just close.
    if (!history.length) {
      if (typeof originalClose === 'function') originalClose()
      return
    }
    const snapshot = history.slice()
    const name = currentName
    // Close the meeting room visually first so the summary modal doesn't
    // stack on top of the chat view.
    if (typeof originalClose === 'function') originalClose()
    try {
      const res = await fetch('/api/meeting/end', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeRole: currentRole, history: snapshot }),
      })
      if (!res.ok) return
      const data = await res.json()
      if (typeof window.vxCalendarAddMeetingRecap === 'function') {
        window.vxCalendarAddMeetingRecap({ name, employeeRole: currentRole, summary: data.summary })
      }
      if (typeof window.vxSyncCalendarFromTasks === 'function') {
        setTimeout(() => window.vxSyncCalendarFromTasks(), 400)
      }
      showSummaryModal(name, data)
    } catch (e) {
      // Silent — meeting is already closed, no need to surface an error.
    } finally {
      history = []
    }
  }

  window.mrSendBtn = async function () {
    if (streaming) return
    const inp = document.getElementById('mr-input-field')
    if (!inp) return
    const val = inp.value.trim()
    if (!val) return
    const msgs = document.getElementById('mr-msgs')
    if (!msgs) return

    // Append user bubble
    const userDiv = document.createElement('div')
    userDiv.className = 'mr-msg user'
    userDiv.innerHTML = '<div class="mr-bubble"></div>'
    userDiv.querySelector('.mr-bubble').textContent = val
    msgs.appendChild(userDiv)
    inp.value = ''
    msgs.scrollTop = msgs.scrollHeight
    history.push({ role: 'user', content: val })

    // Append empty assistant bubble, stream into it
    const replyDiv = document.createElement('div')
    replyDiv.className = 'mr-msg'
    const bubble = document.createElement('div')
    bubble.className = 'mr-bubble'
    bubble.textContent = ''
    replyDiv.appendChild(bubble)
    msgs.appendChild(replyDiv)

    streaming = true
    try {
      const res = await fetch('/api/meeting/reply', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeRole: currentRole,
          message: val,
          history: history.slice(0, -1), // exclude the message we just pushed
        }),
      })
      if (!res.ok || !res.body) {
        bubble.textContent = '(Could not reach the team right now — try again.)'
        streaming = false
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let buffer = ''
      let assistantText = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let idx
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, idx).trim()
          buffer = buffer.slice(idx + 2)
          if (!frame.startsWith('data:')) continue
          const json = frame.slice(5).trim()
          try {
            const evt = JSON.parse(json)
            if (evt.chunk) {
              assistantText += evt.chunk
              // Re-render the full message as markdown each chunk so
              // bullets / bold / line-breaks appear as the agent types.
              // Cheap for short messages and worth it for legibility.
              bubble.innerHTML = renderAgentMarkdown(assistantText)
              msgs.scrollTop = msgs.scrollHeight
            } else if (evt.done) {
              history.push({ role: 'assistant', content: assistantText })
            } else if (evt.error) {
              bubble.textContent = '(Stream error: ' + evt.error + ')'
            } else if (typeof evt.knowledgeCount === 'number') {
              renderKnowledgeBadge(evt.knowledgeCount, evt.niche, evt.memoryCount)
            }
          } catch {
            // ignore parse errors on heartbeats / empty frames
          }
        }
      }
    } catch (e) {
      bubble.textContent = '(Network error — try again.)'
    } finally {
      streaming = false
    }
  }
})()
