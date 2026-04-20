/* Sovexa — meeting room streaming client
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
  // Cache meeting topic responses — persisted to sessionStorage so refreshes don't regenerate
  var CACHE_VERSION = '3' // bump to invalidate all caches on deploy
  var meetingCache = {}
  try {
    var stored = sessionStorage.getItem('vx-meeting-cache')
    if (stored) {
      var parsed = JSON.parse(stored)
      if (parsed._v === CACHE_VERSION) {
        meetingCache = parsed
      } else {
        sessionStorage.removeItem('vx-meeting-cache')
      }
    }
  } catch {}
  meetingCache._v = CACHE_VERSION
  function saveMeetingCache() {
    try { sessionStorage.setItem('vx-meeting-cache', JSON.stringify(meetingCache)) } catch {}
  }
  let currentRole = 'copywriter'
  let currentName = 'Alex'
  let streaming = false

  const originalOpen = window.openMeeting
  window.openMeeting = function (name, role, init, taskRef, topic) {
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

    // Build greeting — contextual if opened from drawer with a topic
    let greeting
    if (topic) {
      greeting = topicGreeting(name, topic)
    } else {
      greeting = `"Hey — ${name} here. What are we working on?"`
    }

    const msgs = document.getElementById('mr-msgs')
    if (msgs) {
      msgs.innerHTML = ''
      // Agent enters the room — brief pause, then greeting appears
      setTimeout(() => {
        const msgDiv = document.createElement('div')
        msgDiv.className = 'mr-msg'
        msgDiv.style.cssText = 'opacity:0;transform:translateY(8px);transition:all .4s ease'
        msgDiv.innerHTML = '<div class="mr-bubble">' + greeting + '</div>'
        msgs.appendChild(msgDiv)
        requestAnimationFrame(() => {
          msgDiv.style.opacity = '1'
          msgDiv.style.transform = 'translateY(0)'
        })
      }, 600)
    }

    // If topic was provided, the agent presents findings directly —
    // no user message needed. Maya greets, then delivers her analysis.
    // But first: check if we already have a recent report (< 24h) for this topic.
    // If so, present that instead of making a new Bedrock call.
    if (topic) {
      setTimeout(async () => {
        var cacheKey = currentRole + ':' + topic
        var cached = meetingCache[cacheKey]
        var oneDayAgo = Date.now() - 24 * 60 * 60 * 1000

        // If we have an exact cached response from today, replay it
        if (cached && cached.timestamp > oneDayAgo) {
          const msgs = document.getElementById('mr-msgs')
          if (!msgs) return
          const replyDiv = document.createElement('div')
          replyDiv.className = 'mr-msg'
          replyDiv.style.cssText = 'opacity:0;transform:translateY(8px);transition:all .4s ease'
          const bubble = document.createElement('div')
          bubble.className = 'mr-bubble'
          bubble.innerHTML = renderAgentMarkdown(cached.text)
          replyDiv.appendChild(bubble)
          msgs.appendChild(replyDiv)
          requestAnimationFrame(() => {
            replyDiv.style.opacity = '1'
            replyDiv.style.transform = 'translateY(0)'
          })
          msgs.scrollTop = msgs.scrollHeight
          history.push({ role: 'user', content: 'Show me the ' + topic.toLowerCase() + ' findings.' })
          history.push({ role: 'assistant', content: cached.text })
          return
        }

        const topicMsg = 'I want to discuss ' + topic.toLowerCase() + '. Show me what you have — present your findings.'
        history.push({ role: 'user', content: topicMsg })

        const msgs = document.getElementById('mr-msgs')
        if (!msgs) return

        // Add agent reply bubble
        const replyDiv = document.createElement('div')
        replyDiv.className = 'mr-msg'
        replyDiv.style.cssText = 'opacity:0;transform:translateY(8px);transition:all .4s ease'
        const bubble = document.createElement('div')
        bubble.className = 'mr-bubble'
        bubble.textContent = ''
        replyDiv.appendChild(bubble)
        msgs.appendChild(replyDiv)
        requestAnimationFrame(() => {
          replyDiv.style.opacity = '1'
          replyDiv.style.transform = 'translateY(0)'
        })

        // Stream the agent's response
        streaming = true
        try {
          const res = await fetch('/api/meeting/reply', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              employeeRole: currentRole,
              message: topicMsg,
              history: [],
            }),
          })
          if (!res.ok || !res.body) {
            console.error('[meeting] topic auto-send failed:', res.status, res.statusText)
            try { console.error('[meeting] response:', await res.text()) } catch {}
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
                  bubble.innerHTML = renderAgentMarkdown(assistantText)
                  msgs.scrollTop = msgs.scrollHeight
                } else if (evt.done) {
                  history.push({ role: 'assistant', content: assistantText })
                  // Cache this response for same-day replays
                  meetingCache[cacheKey] = { text: assistantText, timestamp: Date.now() }
                  saveMeetingCache()
                } else if (typeof evt.knowledgeCount === 'number') {
                  renderKnowledgeBadge(evt.knowledgeCount, evt.niche, evt.memoryCount)
                }
              } catch {}
            }
          }
        } catch {
          bubble.textContent = '(Connection lost — try again.)'
        } finally {
          streaming = false
        }
      }, 2500)
    }

    if (typeof originalOpen === 'function') originalOpen(name, role, init)
  }

  function topicGreeting(name, topic) {
    const greetings = {
      'Weekly Analysis': `"${name} here. I've gone through your content from this week — let me walk you through what performed, what didn't, and where to focus next."`,
      'Trending Now': `"${name} here. I've been scanning what's moving across your content space — let me show you what's rising and what's worth acting on."`,
      'Audience Breakdown': `"${name} here. I've got your audience data pulled up — let's look at who's actually engaging and what they respond to."`,
      'Engagement Diagnosis': `"${name} here. I looked at your recent engagement patterns — let me show you what shifted and what to do about it."`,
      'Competitor Scan': `"${name} here. Let me show you what similar creators are doing and where you can get ahead of them."`,
      'Weekly Plan': `"${name} here. I've been looking at your content pipeline — let me walk you through what I think next week should look like."`,
      'Pillar Rebuild': `"${name} here. Let's rethink your content pillars from scratch. I'll show you what's working, what's dead weight, and what to build."`,
      'Posting Cadence': `"${name} here. I've analyzed your posting patterns against your audience's peak times. Let's optimize your schedule."`,
      '90-Day Plan': `"${name} here. Let's map out the next three months. I'll walk you through themes, goals, and what needs to ship each month."`,
      'Slot Audit': `"${name} here. I've identified your weakest content slots. Let me show you what to replace them with."`,
      'Trend Hooks': `"${name} here. I've got 5 hooks ready for what's trending right now. Let me show you which one I think wins and why."`,
      '30s Reel Script': `"${name} here. Let's write a script. I'll build it beat by beat — hook, tension, payoff — so it's ready to film."`,
      'Caption': `"${name} here. Let's write a caption that actually converts. I'll draft it and you tell me if it sounds like you."`,
      'Carousel Openers': `"${name} here. Slide 1 decides everything. Let me show you 3 opening lines and we'll pick the one that stops the scroll."`,
      'Bio Rewrite': `"${name} here. Your bio is the first thing people read. Let me give you 3 options and we'll pick the one that fits."`,
      'Shot List': `"${name} here. Let's plan exactly what you're filming. I'll give you every shot, angle, and timing note so it's effortless on set."`,
      'Pacing Notes': `"${name} here. Let's talk timing — I'll break down the frame-by-frame pacing so your video holds attention start to finish."`,
      'Visual Direction': `"${name} here. Let's nail the look. I'll walk you through composition, color, and energy for your next piece."`,
      'Thumbnail Brief': `"${name} here. Your first frame is your billboard. Let me show you what it should look like to get the click."`,
      'Fix a Weak Reel': `"${name} here. I looked at the Reel — I know exactly what's off. Let me walk you through the fixes."`,
    }
    return greetings[topic] || `"${name} here. You wanted to talk about ${topic.toLowerCase()} — I've pulled up everything I have. Let's get into it."`
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
      inp0.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.mrSendBtn() }
      })
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
  // Source card click → show scoped data panel inline
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.vx-source-btn')
    if (!btn) return
    e.preventDefault()

    // Toggle — if clicking the same source, close it
    var existing = document.querySelectorAll('.vx-source-panel')
    var wasOpen = false
    existing.forEach(function (p) {
      if (p.dataset.sourceKey === rawKey) wasOpen = true
      p.remove()
    })
    if (wasOpen) return

    var rawKey = btn.dataset.source
    // Parse scoped format: "tiktok/post/collecting moments" → {platform:"tiktok", metric:"post", detail:"collecting moments"}
    var parts = rawKey.split('/')
    var platform = parts[0] // tiktok, instagram, trends, competitors, audience
    var metric = parts[1] || 'overview' // post, followers, engagement, overview, audience
    var detail = parts.slice(2).join('/') // caption fragment for post lookup
    var key = platform // backward compat for trends/competitors
    var state = window.__vxDashState || {}
    var panel = document.createElement('div')
    panel.className = 'vx-source-panel'
    panel.dataset.sourceKey = rawKey
    panel.style.cssText = 'margin:10px 0;background:var(--s1);border:1px solid var(--b1);border-radius:10px;padding:16px;font-size:12px;color:var(--t2);line-height:1.6;animation:fadeSlideIn .3s ease'

    var content = ''

    // Show loading state first, then fetch timeseries
    panel.innerHTML = '<div style="color:var(--t3);font-size:11px">Loading data...</div>'
    var bubble = btn.closest('.mr-bubble')
    if (bubble) bubble.parentNode.insertBefore(panel, bubble.nextSibling)

    // Fetch actual timeseries data
    fetch('/api/platform/timeseries', { credentials: 'include' })
      .then(function (r) { return r.json() })
      .then(function (ts) {
        var allSnapshots = ts.snapshots || []
        // Filter to last 7 days to match what the agent sees
        var sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
        var snapshots = allSnapshots.filter(function (s) { return new Date(s.capturedAt).getTime() >= sevenDaysAgo })
        if (snapshots.length === 0) snapshots = allSnapshots.slice(-7) // fallback
        var posts = ts.posts || []
        var account = ts.account || {}

        var acctData = platform === 'instagram' ? state.insights : state.tiktok
        // Fallback: if dashboard state hasn't loaded, build from timeseries account data
        if (!acctData && account && account.handle) {
          acctData = {
            handle: account.handle,
            followerCount: snapshots.length > 0 ? snapshots[snapshots.length - 1].followerCount : 0,
            avgViews: snapshots.length > 0 ? snapshots[snapshots.length - 1].avgReach : 0,
            avgReach: snapshots.length > 0 ? snapshots[snapshots.length - 1].avgReach : 0,
            engagementRate: snapshots.length > 0 ? snapshots[snapshots.length - 1].engagementRate : 0,
            postCount: posts.length,
            videoCount: posts.length,
          }
        }

    if ((platform === 'tiktok' || platform === 'instagram') && acctData) {
          var handle = acctData.handle || ''
          var platLabel = platform === 'tiktok' ? 'TikTok' : 'Instagram'

          if (metric === 'post' && detail) {
            // ── SPECIFIC POST ── find the post by caption fragment
            console.log('[source card] looking for post with caption containing:', detail, 'in', posts.length, 'posts')
            var matchPost = posts.find(function (p) {
              return (p.caption || '').toLowerCase().indexOf(detail.toLowerCase()) !== -1
            })
            console.log('[source card] match:', matchPost ? matchPost.caption?.slice(0, 40) : 'NOT FOUND')
            if (matchPost) {
              var avgViews = posts.length > 0 ? Math.round(posts.reduce(function (s, p) { return s + (p.viewCount || 0) }, 0) / posts.length) : 0
              var vsAvg = avgViews > 0 ? ((matchPost.viewCount / avgViews) * 100 - 100).toFixed(0) : '0'
              var vsSign = Number(vsAvg) >= 0 ? '+' : ''
              content = '<div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--t3);margin-bottom:10px;font-weight:500">' + platLabel + ' Post</div>'
                + '<div style="font-size:13px;color:var(--t1);font-style:italic;margin-bottom:12px;line-height:1.5">"' + escapeHtml((matchPost.caption || '').slice(0, 100)) + '"</div>'
                + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">'
                + metricTile('Views', fmtNum(matchPost.viewCount || 0))
                + metricTile('Likes', fmtNum(matchPost.likeCount || 0))
                + metricTile('Comments', fmtNum(matchPost.commentCount || 0))
                + '</div>'
                + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
                + metricTileWithDelta('vs Your Avg', fmtNum(matchPost.viewCount || 0) + ' views', vsSign + vsAvg + '%')
                + metricTile('Your Avg', fmtNum(avgViews) + ' views')
                + '</div>'
                + (matchPost.publishedAt ? '<div style="font-size:10px;color:var(--t3);margin-top:10px">Posted ' + timeAgo(matchPost.publishedAt) + '</div>' : '')
            } else {
              content = '<div style="color:var(--t3);font-size:12px">Could not find that post in your recent data.</div>'
            }

          } else if (metric === 'followers') {
            // ── FOLLOWERS ── sparkline + delta
            var followerHistory = snapshots.map(function (s) { return s.followerCount || 0 })
            var oldest = snapshots.length >= 2 ? snapshots[0].followerCount : acctData.followerCount
            var latest = acctData.followerCount
            var fDelta = latest - oldest
            var fSign = fDelta >= 0 ? '+' : ''
            content = '<div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--t3);margin-bottom:10px;font-weight:500">' + platLabel + ' Followers · Last 7 days</div>'
              + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">'
              + metricTileWithDelta('Current', fmtNum(latest), fSign + fmtNum(fDelta) + ' this week')
              + metricTile('7 days ago', fmtNum(oldest))
              + '</div>'
              + sparklineRow(followerHistory, 'Daily follower count')

          } else if (metric === 'views' || metric === 'reach') {
            // ── VIEWS/REACH ── avg views + per-post breakdown
            var viewsList = posts.map(function (p) { return p.viewCount || 0 })
            var avgV = viewsList.length > 0 ? Math.round(viewsList.reduce(function (a, b) { return a + b }, 0) / viewsList.length) : 0
            var maxV = viewsList.length > 0 ? Math.max.apply(null, viewsList) : 0
            var minV = viewsList.length > 0 ? Math.min.apply(null, viewsList) : 0
            content = '<div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--t3);margin-bottom:10px;font-weight:500">' + platLabel + ' Views · Recent Posts</div>'
              + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">'
              + metricTile('Avg Views', fmtNum(avgV))
              + metricTile('Best', fmtNum(maxV))
              + metricTile('Lowest', fmtNum(minV))
              + '</div>'
              + sparklineRow(viewsList.slice().reverse(), 'Views per post (oldest → newest)')
              + recentPostsRow(posts.slice(0, 5))

          } else if (metric === 'engagement') {
            // ── ENGAGEMENT ── rate + history
            var engHistory = snapshots.map(function (s) { return (s.engagementRate || 0) * 100 })
            var engRate = platform === 'tiktok' ? ((acctData.engagementRate || 0) * 100).toFixed(1) : (acctData.engagementRate || 0).toFixed(1)
            content = '<div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--t3);margin-bottom:10px;font-weight:500">' + platLabel + ' Engagement</div>'
              + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">'
              + metricTile('Engagement Rate', engRate + '%')
              + metricTile('Data Points', snapshots.length + ' syncs')
              + '</div>'
              + sparklineRow(engHistory, 'Engagement rate over time')

          } else if (metric === 'audience') {
            // ── AUDIENCE ── scoped by detail (age, gender, country, or full)
            var audiences = ts.audiences || []
            var latestAud = audiences[0]
            if (latestAud && (latestAud.ageBreakdown || latestAud.genderBreakdown)) {
              content = audienceScopedCard(latestAud, detail, acctData.followerCount, platLabel)
            } else {
              content = '<div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--t3);margin-bottom:10px;font-weight:500">Your Audience</div>'
                + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">'
                + metricTile('Followers', fmtNum(acctData.followerCount))
                + metricTile('Platform', platLabel)
                + '</div>'
                + '<div style="font-size:11px;color:var(--t3)">Demographics sync on next update.</div>'
            }

          } else {
            // ── OVERVIEW ── full account card (fallback)
            var oFollowerHistory = snapshots.map(function (s) { return s.followerCount || 0 })
            var oPrev = snapshots.length >= 2 ? snapshots[0].followerCount : acctData.followerCount
            var oLatest = acctData.followerCount
            var oDelta = oLatest - oPrev
            var oSign = oDelta >= 0 ? '+' : ''
            content = '<div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--t3);margin-bottom:10px;font-weight:500">' + platLabel + ' @' + escapeHtml(handle) + '</div>'
              + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px">'
              + metricTileWithDelta('Followers', fmtNum(oLatest), oSign + fmtNum(oDelta))
              + metricTile('Avg Views', fmtNum(acctData.avgViews || acctData.avgReach || 0))
              + metricTile('Engagement', (platform === 'tiktok' ? ((acctData.engagementRate || 0) * 100).toFixed(1) : (acctData.engagementRate || 0).toFixed(1)) + '%')
              + '</div>'
              + sparklineRow(oFollowerHistory, 'Followers over time')
              + recentPostsRow(posts.slice(0, 5))
          }
        } else if (key === 'audience') {
          var audiences = ts.audiences || []
          var latestAud = audiences[0]
          var aud = state.tiktok || state.insights
          if (aud) {
            content = '<div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--t3);margin-bottom:10px;font-weight:500">Your Audience</div>'
              + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px">'
              + metricTile('Followers', fmtNum(aud.followerCount))
              + metricTile('Platform', account.platform || 'Connected')
              + metricTile('Data points', String(snapshots.length))
              + '</div>'
              + (latestAud && latestAud.ageGroups ? audienceBreakdown(latestAud) : '<div style="font-size:11px;color:var(--t3)">Detailed demographics sync on next update.</div>')
          } else {
            content = '<div style="color:var(--t3)">No audience data — connect a platform in Settings.</div>'
          }
        } else if (key === 'trends') {
          content = '<div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--t3);margin-bottom:10px;font-weight:500">Trend Data</div>'
            + '<div style="font-size:12px;color:var(--t2);line-height:1.6;margin-bottom:8px">Sourced from Google Trends, Reddit, YouTube, and RSS feeds. Updated daily.</div>'
            + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'
            + metricTile('Sources', 'Google Trends, Reddit, YouTube, RSS')
            + metricTile('Updated', 'Today')
            + '</div>'
        } else if (key === 'competitors') {
          content = '<div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--t3);margin-bottom:10px;font-weight:500">Competitor Analysis</div>'
            + '<div style="font-size:12px;color:var(--t2);line-height:1.6">Based on top creators in your content category. Tracks posting patterns, format performance, and engagement benchmarks.</div>'
        } else {
          content = '<div style="color:var(--t3)">No data available for this source.</div>'
        }

        panel.innerHTML = content
      })
      .catch(function (err) {
        console.error('[source card] fetch error:', err)
        panel.innerHTML = '<div style="color:var(--t3)">Could not load data.</div>'
      })
    return // panel already inserted above
  })

  function metricTileWithDelta(label, value, delta) {
    var color = delta.startsWith('+') ? '#34d27a' : delta.startsWith('-') ? '#e87a7a' : 'var(--t3)'
    return '<div style="background:var(--bg);border:1px solid var(--b1);border-radius:8px;padding:10px 12px">'
      + '<div style="font-size:9px;color:var(--t3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px">' + escapeHtml(label) + '</div>'
      + '<div style="font-size:16px;font-weight:500;color:var(--t1)">' + escapeHtml(String(value)) + '</div>'
      + '<div style="font-size:10px;color:' + color + ';margin-top:2px">' + escapeHtml(delta) + '</div>'
      + '</div>'
  }

  function sparklineRow(data, label) {
    if (!data || data.length < 2) return ''
    var max = Math.max.apply(null, data)
    var min = Math.min.apply(null, data)
    var range = max - min || 1
    var w = 100
    var h = 32
    var points = data.map(function (v, i) {
      return (i / (data.length - 1) * w).toFixed(1) + ',' + (h - ((v - min) / range * h)).toFixed(1)
    }).join(' ')
    return '<div style="margin:10px 0">'
      + '<div style="font-size:9px;color:var(--t3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px">' + escapeHtml(label) + '</div>'
      + '<svg width="100%" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" style="display:block">'
      + '<polyline points="' + points + '" fill="none" stroke="var(--t1)" stroke-width="1.5" stroke-linejoin="round"/>'
      + '</svg>'
      + '<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--t3);margin-top:2px"><span>' + fmtNum(data[0]) + '</span><span>' + fmtNum(data[data.length - 1]) + '</span></div>'
      + '</div>'
  }

  function recentPostsRow(posts) {
    if (!posts || posts.length === 0) return ''
    return '<div style="margin:10px 0">'
      + '<div style="font-size:9px;color:var(--t3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px">Recent posts</div>'
      + posts.map(function (p) {
          var caption = (p.caption || p.title || 'Untitled').slice(0, 50)
          var views = p.viewCount || p.likeCount || 0
          return '<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--b1);font-size:11px">'
            + '<div style="color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;margin-right:8px">' + escapeHtml(caption) + '</div>'
            + '<div style="color:var(--t3);flex-shrink:0">' + fmtNum(views) + (p.viewCount ? ' views' : ' likes') + '</div>'
            + '</div>'
        }).join('')
      + '</div>'
  }

  function audienceScopedCard(aud, scope, followerCount, platLabel) {
    var ages = Array.isArray(aud.ageBreakdown) ? aud.ageBreakdown : []
    var genders = Array.isArray(aud.genderBreakdown) ? aud.genderBreakdown : []
    var countries = Array.isArray(aud.topCountries) ? aud.topCountries : []
    var cities = Array.isArray(aud.topCities) ? aud.topCities : []

    if (scope === 'age' && ages.length > 0) {
      return '<div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--t3);margin-bottom:10px;font-weight:500">Age Breakdown</div>'
        + ages.map(function (g) {
            var pct = ((g.share || 0) * 100).toFixed(0)
            return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">'
              + '<div style="font-size:11px;color:var(--t2);width:50px">' + escapeHtml(g.bucket || '?') + '</div>'
              + '<div style="flex:1;height:6px;background:var(--b1);border-radius:3px;overflow:hidden"><div style="height:100%;background:var(--t1);border-radius:3px;width:' + pct + '%"></div></div>'
              + '<div style="font-size:10px;color:var(--t3);width:30px;text-align:right">' + pct + '%</div></div>'
          }).join('')
        + '<div style="font-size:10px;color:var(--t3);margin-top:10px">' + fmtNum(followerCount) + ' followers on ' + platLabel + '</div>'
    }

    if (scope === 'gender' && genders.length > 0) {
      return '<div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--t3);margin-bottom:10px;font-weight:500">Gender Split</div>'
        + genders.map(function (g) {
            var pct = ((g.share || 0) * 100).toFixed(0)
            return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">'
              + '<div style="font-size:12px;color:var(--t2);width:70px;font-weight:500">' + escapeHtml(g.bucket || '?') + '</div>'
              + '<div style="flex:1;height:8px;background:var(--b1);border-radius:4px;overflow:hidden"><div style="height:100%;background:var(--t1);border-radius:4px;width:' + pct + '%"></div></div>'
              + '<div style="font-size:11px;color:var(--t1);width:35px;text-align:right;font-weight:500">' + pct + '%</div></div>'
          }).join('')
        + '<div style="font-size:10px;color:var(--t3);margin-top:10px">' + fmtNum(followerCount) + ' followers</div>'
    }

    if ((scope === 'country' || scope === 'location') && countries.length > 0) {
      return '<div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--t3);margin-bottom:10px;font-weight:500">Top Locations</div>'
        + countries.slice(0, 5).map(function (c) {
            var pct = ((c.share || 0) * 100).toFixed(0)
            return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">'
              + '<div style="font-size:11px;color:var(--t2);width:50px">' + escapeHtml(c.bucket || '?') + '</div>'
              + '<div style="flex:1;height:6px;background:var(--b1);border-radius:3px;overflow:hidden"><div style="height:100%;background:var(--t1);border-radius:3px;width:' + pct + '%"></div></div>'
              + '<div style="font-size:10px;color:var(--t3);width:30px;text-align:right">' + pct + '%</div></div>'
          }).join('')
        + (cities.length > 0 ? '<div style="font-size:9px;color:var(--t3);margin-top:8px">Top cities: ' + cities.slice(0, 3).map(function (c) { return escapeHtml(c.bucket) }).join(', ') + '</div>' : '')
    }

    // Default: full breakdown
    return audienceBreakdown(aud)
      + '<div style="font-size:10px;color:var(--t3);margin-top:10px">' + fmtNum(followerCount) + ' followers on ' + platLabel + '</div>'
  }

  function audienceBreakdown(aud) {
    var ages = Array.isArray(aud.ageBreakdown) ? aud.ageBreakdown : []
    var genders = Array.isArray(aud.genderBreakdown) ? aud.genderBreakdown : []
    var countries = Array.isArray(aud.topCountries) ? aud.topCountries : []
    if (ages.length === 0 && genders.length === 0) return ''

    var html = ''
    if (ages.length > 0) {
      html += '<div style="font-size:9px;color:var(--t3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px">Age</div>'
      html += ages.slice(0, 5).map(function (g) {
          var pct = ((g.share || 0) * 100).toFixed(0)
          return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">'
            + '<div style="font-size:11px;color:var(--t2);width:50px">' + escapeHtml(g.bucket || '?') + '</div>'
            + '<div style="flex:1;height:6px;background:var(--b1);border-radius:3px;overflow:hidden"><div style="height:100%;background:var(--t1);border-radius:3px;width:' + pct + '%"></div></div>'
            + '<div style="font-size:10px;color:var(--t3);width:30px;text-align:right">' + pct + '%</div>'
            + '</div>'
        }).join('')
    }
    if (genders.length > 0) {
      html += '<div style="font-size:9px;color:var(--t3);letter-spacing:.06em;text-transform:uppercase;margin:10px 0 6px">Gender</div>'
      html += '<div style="display:flex;gap:12px">' + genders.map(function (g) {
          return '<div style="font-size:11px;color:var(--t2)">' + escapeHtml(g.bucket || '?') + ': <strong>' + ((g.share || 0) * 100).toFixed(0) + '%</strong></div>'
        }).join('') + '</div>'
    }
    if (countries.length > 0) {
      html += '<div style="font-size:9px;color:var(--t3);letter-spacing:.06em;text-transform:uppercase;margin:10px 0 6px">Top countries</div>'
      html += '<div style="display:flex;gap:12px">' + countries.slice(0, 4).map(function (c) {
          return '<div style="font-size:11px;color:var(--t2)">' + escapeHtml(c.bucket || '?') + ': <strong>' + ((c.share || 0) * 100).toFixed(0) + '%</strong></div>'
        }).join('') + '</div>'
    }
    return html
  }

  function metricTile(label, value) {
    return '<div style="background:var(--bg);border:1px solid var(--b1);border-radius:8px;padding:10px 12px">'
      + '<div style="font-size:9px;color:var(--t3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px">' + escapeHtml(label) + '</div>'
      + '<div style="font-size:16px;font-weight:500;color:var(--t1)">' + escapeHtml(String(value)) + '</div>'
      + '</div>'
  }

  function fmtNum(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
    return String(n)
  }

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
  var SOURCE_LABELS = {
    tiktok: 'TikTok Data',
    instagram: 'Instagram Data',
    audience: 'Audience Data',
    trends: 'Trend Data',
    competitors: 'Competitor Analysis',
  }
  var SOURCE_ICONS = {
    tiktok: '',
    instagram: '',
    audience: '',
    trends: '',
    competitors: '',
  }

  // Map drawer topic labels to task types for cache lookup
  var TOPIC_TO_TASK_TYPE = {
    'Weekly Analysis': ['performance_review', 'weekly_pulse'],
    'Trending Now': ['trend_analysis'],
    'Audience Breakdown': ['trend_analysis'],
    'Engagement Diagnosis': ['performance_review'],
    'Competitor Scan': ['trend_analysis'],
    'Weekly Plan': ['content_planning', 'content_plan'],
    'Pillar Rebuild': ['content_planning'],
    'Posting Cadence': ['content_planning'],
    '90-Day Plan': ['content_planning'],
    'Slot Audit': ['content_planning'],
    'Trend Hooks': ['hook_writing', 'trend_hooks'],
    '30s Reel Script': ['script_writing'],
    'Caption': ['caption_writing'],
    'Carousel Openers': ['hook_writing'],
    'Bio Rewrite': ['caption_writing'],
    'Shot List': ['shot_list'],
    'Pacing Notes': ['shot_list'],
    'Visual Direction': ['shot_list'],
    'Thumbnail Brief': ['shot_list'],
    'Fix a Weak Reel': ['shot_list'],
  }

  function findRecentOutput(role, topic) {
    var state = window.__vxDashState
    if (!state || !state.tasks) return null
    var taskTypes = TOPIC_TO_TASK_TYPE[topic] || []
    if (taskTypes.length === 0) return null

    var oneDayAgo = Date.now() - 24 * 60 * 60 * 1000
    var match = state.tasks.find(function (t) {
      if (!t.employee || t.employee.role !== role) return false
      if (taskTypes.indexOf(t.type) === -1) return false
      if (t.status !== 'delivered' && t.status !== 'approved') return false
      if (new Date(t.createdAt).getTime() < oneDayAgo) return false
      return true
    })

    if (!match || !match.outputs || match.outputs.length === 0) return null
    var output = match.outputs[0]
    var content = output.content || {}

    // Build a readable summary from the structured output
    var summary = ''

    if (content.trends && Array.isArray(content.trends)) {
      summary += content.trends.map(function (t, i) {
        return '- **' + (t.topic || 'Trend ' + (i + 1)) + '** — ' + (t.growth || t.growthPercent || '') + ' growth. ' + (t.insight || t.whyItMatters || '').slice(0, 120)
      }).join('\n')
    } else if (content.hooks && Array.isArray(content.hooks)) {
      summary += content.hooks.map(function (h, i) {
        return '- Hook ' + (i + 1) + ': "' + (h.text || '').slice(0, 80) + '"'
      }).join('\n')
    } else if (content.posts && Array.isArray(content.posts)) {
      summary += content.posts.map(function (p) {
        return '- **' + (p.day || '?') + '**: ' + (p.format || '') + ' — ' + (p.topic || '')
      }).join('\n')
    } else if (content.summary) {
      summary += content.summary
    } else if (content.winOfTheWeek) {
      summary += '- **Win**: ' + content.winOfTheWeek + '\n'
      summary += '- **Miss**: ' + (content.missOfTheWeek || 'None flagged') + '\n'
      summary += '- **Trajectory**: ' + (content.trajectory || 'Stable') + '\n'
      summary += '- **One thing to do**: ' + (content.oneThingToDo || '')
    } else {
      summary += JSON.stringify(content).slice(0, 300)
    }

    summary += '\n\n**What do you want to dig into?**'

    return { summary: summary, task: match }
  }

  function timeAgo(d) {
    if (!d) return ''
    var ms = Date.now() - new Date(d).getTime()
    var m = Math.floor(ms / 60000)
    if (m < 1) return 'just now'
    if (m < 60) return m + 'm ago'
    var h = Math.floor(m / 60)
    if (h < 24) return h + 'h ago'
    var days = Math.floor(h / 24)
    return days + 'd ago'
  }

  function scopedLabel(platform, metric) {
    var platName = platform === 'tiktok' ? 'TikTok' : platform === 'instagram' ? 'Instagram' : platform.charAt(0).toUpperCase() + platform.slice(1)
    var metricLabels = {
      post: platName + ' Post',
      followers: platName + ' Followers',
      views: platName + ' Views',
      reach: platName + ' Reach',
      engagement: platName + ' Engagement',
      audience: platName + ' Audience',
      overview: platName + ' Data',
    }
    return metricLabels[metric] || platName + ' ' + (metric || 'Data')
  }

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
    // Source cards — [source: tiktok/post/breakfast] becomes a scoped clickable card
    html = html.replace(/\[source:\s*([^\]]+)\]/g, function (_, src) {
      var key = src.trim().toLowerCase()
      var parts = key.split('/')
      var platform = parts[0]
      var metric = parts[1] || 'overview'
      var label = scopedLabel(platform, metric)
      return '<button class="vx-source-btn" data-source="' + escapeHtml(key) + '" style="display:inline-flex;align-items:center;gap:4px;font-size:9px;letter-spacing:.04em;color:var(--t3);background:var(--s2,rgba(0,0,0,.04));padding:3px 10px;border-radius:4px;margin-left:4px;vertical-align:middle;border:1px solid var(--b1);cursor:pointer;font-family:inherit;transition:border-color .2s">'
        + escapeHtml(label) + ' <span style="font-size:8px;opacity:.5">View</span></button>'
    })
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
