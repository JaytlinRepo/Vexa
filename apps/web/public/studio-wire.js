/* Sovexa — Studio tab data wiring
 *
 * Handles the batch preview approval workflow:
 * - Load pending clips for approval (visual + copy)
 * - Approve/reject visual edits with feedback
 * - Approve/reject captions with feedback
 * - Regenerate visual or copy after rejection
 * - Discard clips
 * - Schedule approved clips with timing recommendations from Jordan
 */

;(function () {
  const API = ''

  // ── Init CSS ─────────────────────────────────────────────────────

  const style = document.createElement('style')
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(400px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(400px); opacity: 0; }
    }
  `
  document.head.appendChild(style)

  // ── State ────────────────────────────────────────────────────────

  let currentCompanyId = null
  let pendingClips = []
  let clipStateMap = {} // Track approval state per clip

  // ── API Calls ────────────────────────────────────────────────────

  async function fetchUserCompany() {
    try {
      const res = await fetch(`${API}/api/auth/me`, { credentials: 'include' })
      if (!res.ok) return null
      const json = await res.json()
      return json.companies?.[0]
    } catch (err) {
      console.error('[studio] failed to fetch user:', err)
      return null
    }
  }

  async function fetchPendingClips() {
    if (!currentCompanyId) return []
    try {
      const res = await fetch(`${API}/api/studio/pending?companyId=${currentCompanyId}`, {
        credentials: 'include',
      })
      if (!res.ok) return []
      const json = await res.json()
      return json.clips || []
    } catch (err) {
      console.error('[studio] failed to fetch pending clips:', err)
      return []
    }
  }

  async function fetchPostingStrategy(contentType) {
    if (!currentCompanyId) return null
    try {
      const res = await fetch(`${API}/api/studio/posting-strategy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          companyId: currentCompanyId,
          contentType: contentType || 'video',
        }),
      })
      if (!res.ok) return null
      return res.json()
    } catch (err) {
      console.error('[studio] failed to fetch posting strategy:', err)
      return null
    }
  }

  async function approveVisual(clipId) {
    try {
      const res = await fetch(`${API}/api/studio/approve-visual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          clipId,
          action: 'approve',
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.message || 'Failed to approve visual')
      }
      const result = await res.json()
      updateClipState(clipId, { visualApprovalStatus: 'approved' })
      showToast(`✓ Visual approved`, 'success')
      return result
    } catch (err) {
      console.error('[studio] approve-visual failed:', err)
      showToast(`✗ ${err.message}`, 'error')
      return null
    }
  }

  async function rejectVisual(clipId, feedback) {
    if (!feedback || feedback.trim().length < 5) {
      showToast('Please provide at least 5 characters of feedback', 'error')
      return
    }
    try {
      const res = await fetch(`${API}/api/studio/approve-visual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          clipId,
          action: 'reject',
          feedback: feedback.trim(),
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.message || 'Failed to reject visual')
      }
      const result = await res.json()
      updateClipState(clipId, { visualApprovalStatus: 'rejected' })

      // Trigger regeneration
      setTimeout(() => regenerateVisual(clipId), 500)
      showToast('✓ Visual rejected. Regenerating...', 'info')
      return result
    } catch (err) {
      console.error('[studio] reject-visual failed:', err)
      showToast(`✗ ${err.message}`, 'error')
      return null
    }
  }

  async function regenerateVisual(clipId) {
    try {
      const res = await fetch(`${API}/api/studio/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          clipId,
          type: 'visual',
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.message || 'Failed to regenerate visual')
      }
      const result = await res.json()
      updateClipState(clipId, { visualApprovalStatus: 'pending' })
      showToast('✓ New visual version ready for review', 'success')
      refreshClips()
      return result
    } catch (err) {
      console.error('[studio] regenerate-visual failed:', err)
      showToast(`✗ Failed to regenerate: ${err.message}`, 'error')
      return null
    }
  }

  async function approveCopy(clipId, captionId) {
    try {
      const res = await fetch(`${API}/api/studio/approve-copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          clipId,
          action: 'approve',
          captionId,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.message || 'Failed to approve copy')
      }
      const result = await res.json()
      updateClipState(clipId, { copyApprovalStatus: 'approved' })
      showToast('✓ Caption approved', 'success')
      return result
    } catch (err) {
      console.error('[studio] approve-copy failed:', err)
      showToast(`✗ ${err.message}`, 'error')
      return null
    }
  }

  async function rejectCopy(clipId, feedback) {
    if (!feedback || feedback.trim().length < 5) {
      showToast('Please provide feedback for rejection', 'error')
      return
    }
    try {
      const res = await fetch(`${API}/api/studio/approve-copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          clipId,
          action: 'reject',
          feedback: feedback.trim(),
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.message || 'Failed to reject copy')
      }
      const result = await res.json()
      updateClipState(clipId, { copyApprovalStatus: 'rejected' })

      // Trigger regeneration
      setTimeout(() => regenerateCopy(clipId), 500)
      showToast('✓ Captions rejected. Regenerating...', 'info')
      return result
    } catch (err) {
      console.error('[studio] reject-copy failed:', err)
      showToast(`✗ ${err.message}`, 'error')
      return null
    }
  }

  async function regenerateCopy(clipId) {
    try {
      const res = await fetch(`${API}/api/studio/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          clipId,
          type: 'copy',
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.message || 'Failed to regenerate copy')
      }
      const result = await res.json()
      updateClipState(clipId, { copyApprovalStatus: 'pending' })
      showToast('✓ New captions ready for review', 'success')
      refreshClips()
      return result
    } catch (err) {
      console.error('[studio] regenerate-copy failed:', err)
      showToast(`✗ Failed to regenerate: ${err.message}`, 'error')
      return null
    }
  }

  async function discardClip(clipId) {
    if (!confirm('Discard this clip? You can recreate it later from your uploads.')) return
    try {
      const res = await fetch(`${API}/api/studio/discard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ clipId }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.message || 'Failed to discard clip')
      }
      showToast('✓ Clip discarded', 'info')
      refreshClips()
    } catch (err) {
      console.error('[studio] discard failed:', err)
      showToast(`✗ ${err.message}`, 'error')
    }
  }

  async function scheduleClip(clipId, scheduledTime, platform = 'instagram') {
    try {
      const res = await fetch(`${API}/api/studio/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          clipId,
          scheduledTime,
          platform,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.message || 'Failed to schedule clip')
      }
      const result = await res.json()
      updateClipState(clipId, { status: 'scheduled' })
      showToast('✓ Clip scheduled for posting', 'success')
      refreshClips()
      return result
    } catch (err) {
      console.error('[studio] schedule failed:', err)
      showToast(`✗ ${err.message}`, 'error')
      return null
    }
  }

  // ── DOM Helpers ──────────────────────────────────────────────────

  function setText(id, value) {
    const el = document.getElementById(id)
    if (el && value != null) el.textContent = value
  }

  function showToast(message, type = 'info') {
    // Create a simple toast notification at top of page
    const toast = document.createElement('div')
    toast.style.cssText = `
      position: fixed; top: 20px; right: 20px; z-index: 9999;
      padding: 12px 16px; border-radius: 8px;
      background: ${type === 'success' ? 'var(--ok)' : type === 'error' ? 'var(--err)' : 'var(--accent)'};
      color: ${type === 'success' ? '#000' : '#fff'};
      font-size: 13px; font-weight: 500;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      animation: slideIn 0.3s ease;
    `
    toast.textContent = message
    document.body.appendChild(toast)
    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease forwards'
      setTimeout(() => toast.remove(), 300)
    }, 3000)
  }

  function updateClipState(clipId, updates) {
    if (!clipStateMap[clipId]) clipStateMap[clipId] = {}
    Object.assign(clipStateMap[clipId], updates)
  }

  // ── Wire Up Event Listeners ──────────────────────────────────────

  function wireStudioTab() {
    // Approve visual buttons
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-studio-action="approve-visual"]')
      if (btn) {
        const clipId = btn.dataset.clipId
        btn.disabled = true
        btn.textContent = '⏳ Approving...'
        await approveVisual(clipId)
        btn.disabled = false
        btn.textContent = '✓ Approve'
      }
    })

    // Reject visual + submit feedback
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-studio-action="reject-visual-submit"]')
      if (btn) {
        const clipId = btn.dataset.clipId
        const feedbackEl = document.getElementById(`visual-fb-${clipId}`)
        const feedback = feedbackEl?.value || ''
        btn.disabled = true
        btn.textContent = '⏳ Rejecting...'
        await rejectVisual(clipId, feedback)
        btn.disabled = false
        btn.textContent = 'Submit & regenerate'
      }
    })

    // Approve copy (per caption option)
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-studio-action="approve-copy"]')
      if (btn) {
        const clipId = btn.dataset.clipId
        const captionId = btn.dataset.captionId
        btn.disabled = true
        btn.textContent = '⏳ Using...'
        await approveCopy(clipId, captionId)
        btn.disabled = false
        btn.textContent = '✓ Use this'
      }
    })

    // Reject copy (per caption option)
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-studio-action="reject-copy"]')
      if (btn) {
        const clipId = btn.dataset.clipId
        // Show a simple prompt for feedback
        const feedback = prompt('Why are you rejecting this caption? (be specific)')
        if (!feedback) return
        btn.disabled = true
        await rejectCopy(clipId, feedback)
        btn.disabled = false
      }
    })

    // Reject all captions button
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-studio-action="reject-all-copy"]')
      if (btn) {
        const clipId = btn.dataset.clipId
        const feedback = prompt('What would you like different in these captions?')
        if (!feedback) return
        btn.disabled = true
        await rejectCopy(clipId, feedback)
        btn.disabled = false
      }
    })

    // Discard clip
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-studio-action="discard"]')
      if (btn) {
        const clipId = btn.dataset.clipId
        await discardClip(clipId)
      }
    })

    // Schedule buttons (primary, secondary, tertiary, custom)
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-studio-action="schedule"]')
      if (btn) {
        const clipId = btn.dataset.clipId
        const scheduledTime = btn.dataset.scheduledTime
        if (scheduledTime) {
          // Show confirmation modal
          document.getElementById('confirm-time').textContent = scheduledTime
          document.getElementById('schedule-confirm-modal').style.display = 'flex'

          // Wire up the confirm button
          const confirmBtn = document.getElementById('schedule-confirm-btn')
          if (confirmBtn) {
            confirmBtn.onclick = async () => {
              confirmBtn.disabled = true
              await scheduleClip(clipId, new Date(scheduledTime).toISOString())
              document.getElementById('schedule-confirm-modal').style.display = 'none'
              confirmBtn.disabled = false
            }
          }
        }
      }
    })

    // Custom time picker
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-studio-action="schedule-custom"]')
      if (btn) {
        const clipId = btn.dataset.clipId
        const dateInput = document.querySelector('[data-studio-input="date"]')
        const timeInput = document.querySelector('[data-studio-input="time"]')

        if (!dateInput?.value || !timeInput?.value) {
          showToast('Please select both date and time', 'error')
          return
        }

        const scheduledTime = new Date(`${dateInput.value}T${timeInput.value}:00Z`)
        if (scheduledTime <= new Date()) {
          showToast('Please select a future date/time', 'error')
          return
        }

        btn.disabled = true
        await scheduleClip(clipId, scheduledTime.toISOString())
        btn.disabled = false
      }
    })

    // Save as draft
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-studio-action="save-draft"]')
      if (btn) {
        showToast('✓ Saved as draft. Schedule anytime from your ready clips.', 'success')
      }
    })
  }

  // ── Upload ────────────────────────────────────────────────────────

  function showVideoPreviews(files) {
    const previewsEl = document.getElementById('studio-previews')
    const gridEl = document.getElementById('studio-preview-grid')
    const countEl = document.getElementById('studio-preview-count')
    if (!previewsEl || !gridEl) return

    previewsEl.style.display = 'block'
    gridEl.innerHTML = ''
    if (countEl) countEl.textContent = files.length + ' video' + (files.length > 1 ? 's' : '') + ' selected'

    for (const file of files) {
      const card = document.createElement('div')
      card.style.cssText = 'width:72px;flex-shrink:0;border-radius:6px;overflow:hidden;border:1px solid var(--b1);background:var(--s1)'

      const video = document.createElement('video')
      video.src = URL.createObjectURL(file)
      video.style.cssText = 'width:100%;aspect-ratio:9/16;object-fit:cover;display:block;background:#000'
      video.muted = true
      video.preload = 'metadata'
      video.addEventListener('loadeddata', function () { video.currentTime = 1 })

      const label = document.createElement('div')
      label.style.cssText = 'padding:3px 5px;font-family:JetBrains Mono,monospace;font-size:7px;color:var(--t3);letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
      label.textContent = file.name.replace(/\.[^.]+$/, '')

      card.appendChild(video)
      card.appendChild(label)
      gridEl.appendChild(card)
    }
  }

  async function uploadBatch(files) {
    if (!currentCompanyId) { showToast('Not signed in', 'error'); return }

    showVideoPreviews(files)

    const processingEl = document.getElementById('studio-processing')
    const bar = document.getElementById('processing-bar')
    const statusEl = document.getElementById('processing-status')
    const detailEl = document.getElementById('processing-detail')
    const progressEl = document.getElementById('processing-progress')

    if (processingEl) processingEl.style.display = 'block'
    if (statusEl) statusEl.textContent = 'Uploading ' + files.length + ' videos...'
    if (detailEl) detailEl.textContent = files.length + ' videos selected'
    if (bar) bar.style.width = '10%'
    if (progressEl) progressEl.textContent = '10%'

    const form = new FormData()
    for (const file of files) {
      form.append('videos', file)
    }
    form.append('companyId', currentCompanyId)
    form.append('strategy', 'montage')

    try {
      const res = await fetch(`${API}/api/video/upload-batch`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      })
      if (!res.ok) {
        let errMsg = 'Batch upload failed'
        try { const err = await res.json(); errMsg = err.error || errMsg } catch {}
        throw new Error(errMsg)
      }
      const json = await res.json()
      if (bar) bar.style.width = '15%'
      if (statusEl) statusEl.textContent = files.length + ' videos uploaded — Riley is analyzing all of them...'
      if (detailEl) detailEl.textContent = json.message || 'Processing compilation'
      if (progressEl) progressEl.textContent = '15%'
      showToast(files.length + ' videos uploaded — compilation started', 'success')

      // Poll until clip appears
      pollUntilClipReady(json.compilationId)
    } catch (err) {
      showToast('Upload failed: ' + err.message, 'error')
      if (processingEl) processingEl.style.display = 'none'
    }
  }

  async function uploadVideo(file) {
    if (!currentCompanyId) {
      showToast('Not signed in', 'error')
      return
    }

    showVideoPreviews([file])

    const processingEl = document.getElementById('studio-processing')
    const bar = document.getElementById('processing-bar')
    const statusEl = document.getElementById('processing-status')
    const detailEl = document.getElementById('processing-detail')
    const progressEl = document.getElementById('processing-progress')

    if (processingEl) processingEl.style.display = 'block'
    if (statusEl) statusEl.textContent = 'Uploading...'
    if (detailEl) detailEl.textContent = '1 video selected'
    if (bar) bar.style.width = '10%'
    if (progressEl) progressEl.textContent = '10%'

    const form = new FormData()
    form.append('video', file)
    form.append('companyId', currentCompanyId)

    try {
      const res = await fetch(`${API}/api/video/upload`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Upload failed')
      }
      const json = await res.json()
      if (bar) bar.style.width = '15%'
      if (statusEl) statusEl.textContent = 'Uploaded — processing starting...'
      if (detailEl) detailEl.textContent = 'Your video is being analyzed'
      if (progressEl) progressEl.textContent = '15%'
      showToast('Video uploaded — processing started', 'success')

      // Poll until clip appears (SSE is unreliable with auth cookies)
      pollUntilClipReady(json.uploadId)
    } catch (err) {
      console.error('[studio] upload failed:', err)
      showToast(`Upload failed: ${err.message}`, 'error')
      if (processingEl) processingEl.style.display = 'none'
    }
  }

  // ── SSE Processing Stream ─────────────────────────────────────────

  const stageLabels = {
    'Get video duration': 'Analyzing video...',
    'Transcribe (AWS)': 'Transcribing audio...',
    'Detect scenes (FFmpeg)': 'Scanning for visual activity...',
    'Extract keyframes': 'Pulling frames for visual analysis...',
    'Analyze clip (Riley)': 'Riley is watching your video and picking the best moments...',
    'Build reel (FFmpeg)': 'Building reel from best moments...',
    'Write captions (Alex)': 'Alex is writing captions...',
  }

  function connectProcessingStream(uploadId) {
    const evtSource = new EventSource(`${API}/api/video/stream`, { withCredentials: true })
    const processingEl = document.getElementById('studio-processing')
    const bar = document.getElementById('processing-bar')
    const statusEl = document.getElementById('processing-status')
    const detailEl = document.getElementById('processing-detail')
    const progressEl = document.getElementById('processing-progress')

    evtSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.uploadId && data.uploadId !== uploadId) return

        if (data.event === 'stage_start') {
          const label = stageLabels[data.stage] || data.stage
          if (statusEl) statusEl.textContent = label
          if (detailEl) detailEl.textContent = `Step ${data.stageIndex + 1} of ${data.totalStages}`
          if (bar) bar.style.width = `${Math.max(15, data.progress)}%`
          if (progressEl) progressEl.textContent = `${data.progress}%`
        }

        if (data.event === 'stage_done') {
          if (bar) bar.style.width = `${data.progress}%`
          if (progressEl) progressEl.textContent = `${data.progress}%`
        }

        if (data.event === 'processing_complete') {
          if (statusEl) statusEl.textContent = 'Done!'
          if (detailEl) detailEl.textContent = data.hook || 'Clip ready for review'
          if (bar) bar.style.width = '100%'
          if (progressEl) progressEl.textContent = '100%'
          showToast('Clip ready for review', 'success')
          evtSource.close()
          refreshClips()
          // Hide processing bar after a moment
          setTimeout(() => { if (processingEl) processingEl.style.display = 'none' }, 3000)
        }

        if (data.event === 'processing_error') {
          if (statusEl) statusEl.textContent = 'Processing failed'
          if (detailEl) detailEl.textContent = data.error || 'Unknown error'
          if (bar) bar.style.width = '0%'
          showToast(`Processing failed: ${data.error}`, 'error')
          evtSource.close()
          setTimeout(() => { if (processingEl) processingEl.style.display = 'none' }, 5000)
        }
      } catch {}
    }

    evtSource.onerror = () => {
      // SSE disconnected — fall back to polling
      evtSource.close()
      if (statusEl) statusEl.textContent = 'Still processing...'
      if (detailEl) detailEl.textContent = 'Connection lost — checking for results'
      pollUntilClipReady(uploadId)
    }
  }

  function pollUntilClipReady(uploadId) {
    const processingEl = document.getElementById('studio-processing')
    const statusEl = document.getElementById('processing-status')
    const detailEl = document.getElementById('processing-detail')
    const bar = document.getElementById('processing-bar')
    const progressEl = document.getElementById('processing-progress')
    let attempts = 0
    const startTime = new Date().toISOString()
    const startIds = new Set(pendingClips.map(c => c.id))

    const progressSteps = [
      { at: 1, pct: 20, label: 'Analyzing video...', detail: 'Getting duration and format' },
      { at: 3, pct: 35, label: 'Transcribing audio...', detail: 'AWS is listening to your video' },
      { at: 5, pct: 50, label: 'Riley is picking the best moments...', detail: 'Analyzing transcript for high-energy segments' },
      { at: 8, pct: 65, label: 'Building reel from best moments...', detail: 'Cutting and encoding segments' },
      { at: 15, pct: 80, label: 'Still encoding...', detail: 'Large files take a bit longer' },
      { at: 20, pct: 85, label: 'Alex is writing captions...', detail: 'Captions based on what was actually said' },
      { at: 25, pct: 90, label: 'Almost done...', detail: 'Uploading to S3' },
    ]

    const poll = async () => {
      attempts++
      await refreshClips()

      const hasNewClip = pendingClips.some(c => !startIds.has(c.id))
      if (hasNewClip) {
        // New clip appeared — done!
        if (statusEl) statusEl.textContent = 'Done!'
        if (detailEl) detailEl.textContent = 'Your reel is ready for review'
        if (bar) bar.style.width = '100%'
        if (progressEl) progressEl.textContent = '100%'
        showToast('Reel ready for review', 'success')
        setTimeout(() => { if (processingEl) processingEl.style.display = 'none' }, 3000)
        return
      }

      // Show estimated progress
      const step = [...progressSteps].reverse().find(s => attempts >= s.at)
      if (step) {
        if (statusEl) statusEl.textContent = step.label
        if (detailEl) detailEl.textContent = step.detail
        if (bar) bar.style.width = `${step.pct}%`
        if (progressEl) progressEl.textContent = `${step.pct}%`
      }

      if (attempts < 60) {
        // Poll every 5s for up to 5 minutes
        setTimeout(poll, 5000)
      } else {
        if (statusEl) statusEl.textContent = 'Processing is taking longer than expected'
        if (detailEl) detailEl.textContent = 'Your clip may still be processing — check back shortly'
        setTimeout(() => { if (processingEl) processingEl.style.display = 'none' }, 10000)
      }
    }
    setTimeout(poll, 5000)
  }

  // ── Render ───────────────────────────────────────────────────────

  function renderPendingClips() {
    const container = document.getElementById('studio-pending-container')
    console.log('[studio] renderPendingClips:', pendingClips.length, 'clips, container:', !!container)
    if (!container) return

    // Hide processing bar if clips exist
    if (pendingClips.length > 0) {
      const processingEl = document.getElementById('studio-processing')
      if (processingEl) processingEl.style.display = 'none'
    }

    if (pendingClips.length === 0) {
      container.innerHTML = `<div style="background:var(--s1);border:1px solid var(--b1);border-radius:10px;padding:40px;text-align:center;color:var(--t3);font-size:13px">
        No clips pending approval. Upload a video to get started.
      </div>`
      return
    }

    container.innerHTML = pendingClips.map(clip => {
      const adj = clip.adjustments || {}
      const style = clip.styleMetrics || {}
      const captions = clip.captionOptions || []
      const scoreColor = (style.styleReplication || 0) >= 0.85 ? 'var(--ok)' : 'var(--accent)'
      const scoreBg = (style.styleReplication || 0) >= 0.85 ? 'rgba(159,179,138,.1)' : 'rgba(212,165,116,.1)'
      const version = adj.version || 1

      return `<div style="background:var(--s1);border:1px solid var(--b1);border-radius:10px;overflow:hidden;margin-bottom:20px">
        <div style="display:grid;grid-template-columns:240px 1fr;gap:20px;padding:20px">
          <!-- Visual -->
          <div>
            ${(() => {
              const isDescriptLink = clip.clippedUrl && clip.clippedUrl.includes('web.descript.com')
              const videoSrc = (!isDescriptLink && clip.clippedUrl) ? clip.clippedUrl : clip.sourceVideoUrl
              if (videoSrc) {
                return `<video src="${videoSrc}" style="width:100%;aspect-ratio:9/16;border-radius:8px;object-fit:cover;background:#000;max-height:260px" controls></video>`
              }
              return `<div style="background:#000;aspect-ratio:9/16;border-radius:8px;margin-bottom:10px;display:flex;align-items:center;justify-content:center;font-size:40px;color:var(--t3);max-height:260px">🎬</div>`
            })()}
            <div style="font-size:11px;color:var(--t3);margin-top:10px">
              <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
                <span style="font-weight:500;color:var(--t2)">Riley's edit</span>
                <span style="background:${scoreColor};color:#000;padding:1px 7px;border-radius:4px;font-size:9px;font-weight:700">v${version}</span>
              </div>
              ${adj.colorTemperature ? `<div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.03em;line-height:1.6">Temp: ${adj.colorTemperature} · Sat: ${adj.saturation || 0} · Warmth: ${adj.warmth || 0}</div>` : ''}
              <div style="margin-top:8px;padding:6px 8px;background:${scoreBg};border-radius:6px">
                <div style="color:${scoreColor};font-weight:600">Style match: ${(style.styleReplication || 0).toFixed(2)}</div>
              </div>
            </div>
            <div style="display:flex;gap:8px;margin-top:10px">
              <button class="btn-fill" style="flex:1;padding:7px;font-size:11px" data-studio-action="approve-visual" data-clip-id="${clip.id}">Approve</button>
              <button class="btn" style="flex:1;padding:7px;font-size:11px" onclick="document.getElementById('visual-feedback-${clip.id}').style.display='block'">Reject</button>
            </div>
            <div id="visual-feedback-${clip.id}" style="display:none;margin-top:10px;padding:10px;background:rgba(196,138,138,.06);border-radius:6px;border:1px solid rgba(196,138,138,.2)">
              <textarea style="width:100%;border:1px solid var(--b1);border-radius:4px;padding:8px;font-size:11px;resize:none;background:var(--bg);color:var(--t2);font-family:inherit" id="visual-fb-${clip.id}" placeholder="E.g. 'Too warm', 'Not enough contrast'" rows="2"></textarea>
              <div style="display:flex;gap:8px;margin-top:8px">
                <button class="btn-fill" style="flex:1;padding:6px;font-size:11px;background:rgba(196,138,138,.6);border:none;cursor:pointer" data-studio-action="reject-visual-submit" data-clip-id="${clip.id}">Submit & regenerate</button>
                <button class="btn" style="flex:1;padding:6px;font-size:11px" onclick="document.getElementById('visual-feedback-${clip.id}').style.display='none'">Cancel</button>
              </div>
            </div>
          </div>

          <!-- Captions -->
          <div style="max-height:400px;overflow-y:auto">
            <div style="font-family:'Inter',sans-serif;font-weight:500;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--t3);margin-bottom:12px;position:sticky;top:0;background:var(--s1);padding:4px 0;z-index:1">Alex's captions — choose one</div>
            ${captions.length > 0 ? captions.map((cap, i) => `
              <div style="background:var(--bg);border:${i === 0 ? '2px solid var(--accent)' : '1px solid var(--b1)'};border-radius:8px;padding:12px;margin-bottom:10px">
                <div style="font-size:13px;font-weight:500;line-height:1.5;color:var(--t1);margin-bottom:4px">"${(cap.text || '').replace(/"/g, '&quot;')}"</div>
                <div style="font-size:11px;color:var(--t3);margin-bottom:10px;font-style:italic">${cap.rationale || cap.type || ''}</div>
                <div style="display:flex;gap:8px">
                  <button class="btn-fill" style="flex:1;padding:7px;font-size:11px" data-studio-action="approve-copy" data-clip-id="${clip.id}" data-caption-id="${cap.id}">Use this</button>
                  <button class="btn" style="flex:1;padding:7px;font-size:11px" data-studio-action="reject-copy" data-clip-id="${clip.id}">Not this one</button>
                </div>
              </div>
            `).join('') : `<div style="color:var(--t3);font-size:12px;padding:20px;text-align:center">Captions generating...</div>`}
            ${captions.length > 0 ? `<button class="btn" style="width:100%;padding:8px;font-size:11px;color:var(--t3)" data-studio-action="reject-all-copy" data-clip-id="${clip.id}">Reject all — get new captions</button>` : ''}
          </div>
        </div>
        <div style="padding:8px 20px;border-top:1px solid var(--b1);display:flex;justify-content:flex-end">
          <button class="btn" style="padding:5px 10px;font-size:10px;color:var(--t3)" data-studio-action="discard" data-clip-id="${clip.id}">Discard this clip</button>
        </div>
      </div>`
    }).join('')
  }

  // ── Load & Refresh ───────────────────────────────────────────────

  function updateClipCount() {
    const count = pendingClips.length
    const countEl = document.querySelector('[data-studio-pending-count]')
    if (countEl) countEl.textContent = count === 1 ? '1 item' : `${count} items`
  }

  async function refreshClips() {
    console.log('[studio] refreshClips called, companyId:', currentCompanyId)
    pendingClips = await fetchPendingClips()
    console.log('[studio] fetched', pendingClips.length, 'pending clips')
    updateClipCount()
    renderPendingClips()
  }

  // ── Init ─────────────────────────────────────────────────────────

  async function initStudioTab() {
    // Get current company from session
    if (!currentCompanyId) {
      const company = await fetchUserCompany()
      if (company) {
        currentCompanyId = company.id
      }
    }

    wireStudioTab()

    // Wire file upload
    const fileInput = document.getElementById('studio-file-input')
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('video/'))
        if (files.length === 0) return
        if (files.length === 1) {
          uploadVideo(files[0])
        } else {
          uploadBatch(files)
        }
        fileInput.value = '' // reset so same files can be re-selected
      })
    }

    // Wire drag & drop (supports multiple files)
    const dropZone = document.getElementById('studio-upload-zone')
    if (dropZone) {
      dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--accent)' })
      dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = 'var(--b2)' })
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault()
        dropZone.style.borderColor = 'var(--b2)'
        const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('video/'))
        if (files.length === 0) { showToast('Please drop video files', 'error'); return }
        if (files.length === 1) uploadVideo(files[0])
        else uploadBatch(files)
      })
    }

    await refreshClips()

    // Refresh clips when navigating to Studio tab
    const studioNav = document.getElementById('nav-db-studio')
    if (studioNav) {
      studioNav.addEventListener('click', () => {
        setTimeout(refreshClips, 300)
      })
    }
  }

  // ── Navigation wiring ──────────────────────────────────────────
  var origNavigate = window.navigate
  window.navigate = function (id) {
    var r = typeof origNavigate === 'function' ? origNavigate(id) : undefined
    if (id === 'db-studio') setTimeout(initStudioTab, 60)
    return r
  }

  var prevEnter = window.enterDashboard
  window.enterDashboard = async function () {
    if (typeof prevEnter === 'function') await prevEnter()
    // Studio initializes on navigate('db-studio'), not on enterDashboard
  }
})()
