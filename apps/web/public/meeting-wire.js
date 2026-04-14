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
  let streaming = false

  const originalOpen = window.openMeeting
  window.openMeeting = function (name, role, init) {
    currentRole = ROLE_BY_NAME[name] || 'copywriter'
    // Claude requires the first message in `messages` to have role='user',
    // so we show the greeting in the UI but do NOT push it into history.
    history = []
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
              bubble.textContent = assistantText
              msgs.scrollTop = msgs.scrollHeight
            } else if (evt.done) {
              history.push({ role: 'assistant', content: assistantText })
            } else if (evt.error) {
              bubble.textContent = '(Stream error: ' + evt.error + ')'
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
