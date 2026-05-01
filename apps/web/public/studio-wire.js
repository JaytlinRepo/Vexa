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
  let activeClipId = null // The clip currently being reviewed — used by sidebar schedule buttons
  /** Shared across init — must not be recreated per Studio visit */
  let selectedFiles = []
  let studioDelegatedWired = false
  let studioUploadDomWired = false
  /** Hard cap on a single batch upload — anything more rejects the whole submit */
  const MAX_BATCH_FILES = 12

  // ── Processing UI helpers ─────────────────────────────────────────
  // Phases: 'upload' (0-15%) → 'combine' (15-45%) → 'edit' (45-95%) → 'done' (100%).
  // setPhase highlights the current pill; setProgress drives the bar + label.
  let processingStartedAt = 0
  let elapsedTickHandle = null

  function setPhase(active) {
    const phases = document.querySelectorAll('#processing-phases [data-phase]')
    if (!phases.length) return
    const order = ['upload', 'combine', 'edit', 'done']
    const activeIdx = order.indexOf(active)
    phases.forEach((el) => {
      const p = el.getAttribute('data-phase')
      const idx = order.indexOf(p)
      if (idx < activeIdx) {
        el.style.background = 'rgba(159,179,138,.12)'
        el.style.borderColor = 'var(--ok)'
        el.style.color = 'var(--t2)'
      } else if (idx === activeIdx) {
        el.style.background = 'var(--accent)'
        el.style.borderColor = 'var(--accent)'
        el.style.color = 'var(--accent-text, #000)'
      } else {
        el.style.background = 'transparent'
        el.style.borderColor = 'var(--b1)'
        el.style.color = 'var(--t3)'
      }
    })
  }

  function setProgress(pct, statusText, detailText) {
    const bar = document.getElementById('processing-bar')
    const progressEl = document.getElementById('processing-progress')
    const statusEl = document.getElementById('processing-status')
    const detailEl = document.getElementById('processing-detail')
    if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + '%'
    if (progressEl) progressEl.textContent = Math.round(pct) + '%'
    if (statusEl && statusText != null) statusEl.textContent = statusText
    if (detailEl && detailText != null) detailEl.textContent = detailText
  }

  function startElapsedTick() {
    processingStartedAt = Date.now()
    if (elapsedTickHandle) clearInterval(elapsedTickHandle)
    const update = () => {
      const el = document.getElementById('processing-elapsed')
      if (!el) return
      const sec = Math.floor((Date.now() - processingStartedAt) / 1000)
      el.textContent = sec < 60 ? sec + 's elapsed' : Math.floor(sec / 60) + 'm ' + (sec % 60) + 's'
    }
    update()
    elapsedTickHandle = setInterval(update, 1000)
  }
  function stopElapsedTick() {
    if (elapsedTickHandle) { clearInterval(elapsedTickHandle); elapsedTickHandle = null }
  }

  function showProcessing(initialStatus, initialDetail) {
    const el = document.getElementById('studio-processing')
    if (el) el.style.display = 'block'
    hideCompletionBanner()
    setPhase('upload')
    setProgress(5, initialStatus, initialDetail)
    startElapsedTick()
  }
  function hideProcessing() {
    const el = document.getElementById('studio-processing')
    if (el) el.style.display = 'none'
    stopElapsedTick()
  }

  function showCompletionBanner(titleText, detailText) {
    const banner = document.getElementById('studio-complete-banner')
    const titleEl = document.getElementById('complete-banner-title')
    const detailEl = document.getElementById('complete-banner-detail')
    if (titleEl && titleText) titleEl.textContent = titleText
    if (detailEl && detailText != null) detailEl.textContent = detailText
    if (banner) banner.style.display = 'block'
    if (banner) banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }
  function hideCompletionBanner() {
    const banner = document.getElementById('studio-complete-banner')
    if (banner) banner.style.display = 'none'
  }
  function clearUploadPreviews() {
    const previewsEl = document.getElementById('studio-previews')
    if (previewsEl) previewsEl.style.display = 'none'
    const grid = document.getElementById('studio-preview-grid')
    if (grid) grid.innerHTML = ''
    const countEl = document.getElementById('studio-preview-count')
    if (countEl) countEl.textContent = ''
  }

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
    // When both approvals are in, make this the active clip for the sidebar
    const state = clipStateMap[clipId]
    if (state.visualApprovalStatus === 'approved' && state.copyApprovalStatus === 'approved') {
      activeClipId = clipId
      document.querySelectorAll('[data-studio-action="schedule"], [data-studio-action="schedule-custom"], [data-studio-action="save-draft"]').forEach(btn => {
        btn.dataset.clipId = clipId
      })
    }
  }

  // ── Wire Up Event Listeners ──────────────────────────────────────

  function wireStudioTab() {
    if (studioDelegatedWired) return
    studioDelegatedWired = true
    // Show/hide visual feedback textarea (Reject / Cancel)
    document.addEventListener('click', (e) => {
      const show = e.target.closest('[data-studio-action="show-visual-feedback"]')
      if (show) {
        const el = document.getElementById(`visual-feedback-${show.dataset.clipId}`)
        if (el) el.style.display = 'block'
        return
      }
      const hide = e.target.closest('[data-studio-action="hide-visual-feedback"]')
      if (hide) {
        const el = document.getElementById(`visual-feedback-${hide.dataset.clipId}`)
        if (el) el.style.display = 'none'
      }
    })

    // Approve visual buttons
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-studio-action="approve-visual"]')
      if (btn) {
        const clipId = btn.dataset.clipId
        btn.disabled = true
        btn.textContent = '⏳ Approving...'
        try { await approveVisual(clipId) } finally {
          btn.disabled = false
          btn.textContent = '✓ Approve'
        }
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
        try { await rejectVisual(clipId, feedback) } finally {
          btn.disabled = false
          btn.textContent = 'Submit & regenerate'
        }
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
        try { await approveCopy(clipId, captionId) } finally {
          btn.disabled = false
          btn.textContent = '✓ Use this'
        }
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
        if (!clipId || clipId === 'pending') {
          showToast('Approve a clip first before scheduling', 'error')
          return
        }
        const state = clipStateMap[clipId] || {}
        if (state.visualApprovalStatus !== 'approved' || state.copyApprovalStatus !== 'approved') {
          showToast('Approve both visual and caption before scheduling', 'error')
          return
        }
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
        if (!clipId || clipId === 'pending') {
          showToast('Approve a clip first before scheduling', 'error')
          return
        }
        const state = clipStateMap[clipId] || {}
        if (state.visualApprovalStatus !== 'approved' || state.copyApprovalStatus !== 'approved') {
          showToast('Approve both visual and caption before scheduling', 'error')
          return
        }
        const dateInput = document.querySelector('[data-studio-input="date"]')
        const timeInput = document.querySelector('[data-studio-input="time"]')
        if (dateInput) dateInput.min = new Date().toISOString().slice(0, 10)

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
    showProcessing(`Uploading ${files.length} videos...`, `Sending ${files.length} files to S3`)

    const form = new FormData()
    for (const file of files) form.append('videos', file)
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
      // Upload phase done → combine phase begins
      setPhase('combine')
      setProgress(18, 'Combining your ' + files.length + ' videos…', 'Stitching clips into one source for Riley')
      showToast(files.length + ' videos uploaded — combining now', 'success')
      // Clear preview strip — files are uploaded, no longer relevant
      clearUploadPreviews()

      // Subscribe to SSE for live progress, plus poll as fallback safety net
      connectProcessingStream(json.compilationId, { isCompilation: true, fileCount: files.length })
      pollUntilClipReady(json.compilationId)
    } catch (err) {
      // Large multi-video uploads (hundreds of MB) sometimes hit the dev
      // proxy's keep-alive timeout: the api accepts the body and starts
      // processing, but the response is dropped on the wire. Don't tear
      // down the UI — start a recovery poll that watches for the new clip
      // appearing in the pending list. Worst case the poll times out and
      // we hide gracefully; best case the user sees the banner anyway.
      console.warn('[studio] upload-batch fetch errored; entering recovery poll mode:', err)
      showToast('Connection dropped — checking if upload completed in background', 'info')
      setPhase('edit')
      setProgress(45, 'Connection hiccup — verifying server state…', 'Your reel may still be on its way')
      clearUploadPreviews()
      pollUntilClipReady('__recovery__', { fileCount: files.length, recovery: true })
    }
  }

  async function uploadVideo(file) {
    if (!currentCompanyId) { showToast('Not signed in', 'error'); return }

    showVideoPreviews([file])
    showProcessing('Uploading…', 'Sending your video to S3')

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
      // Single upload skips the combine phase entirely
      setPhase('edit')
      setProgress(45, 'Riley is editing your video…', 'Picking the best moments and cutting the reel')
      showToast('Uploaded — Riley is editing now', 'success')
      clearUploadPreviews()

      connectProcessingStream(json.uploadId)
      pollUntilClipReady(json.uploadId)
    } catch (err) {
      console.warn('[studio] upload fetch errored; entering recovery poll mode:', err)
      showToast('Connection dropped — checking if upload completed in background', 'info')
      setPhase('edit')
      setProgress(45, 'Connection hiccup — verifying server state…', 'Your clip may still be on its way')
      clearUploadPreviews()
      pollUntilClipReady('__recovery__', { fileCount: 1, recovery: true })
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

  function connectProcessingStream(matchId, options) {
    // matchId is what we're listening for. Single uploads pass uploadId.
    // Batch (compilation) uploads pass compilationId; the backend emits
    // compilation_* events first, then resolves to a combined-video uploadId
    // and emits stage_* / processing_complete events for that. We track the
    // resolved uploadId on the fly so subsequent matching works.
    const isCompilation = options?.isCompilation === true
    const fileCount = options?.fileCount ?? 1
    let resolvedUploadId = isCompilation ? null : matchId

    const evtSource = new EventSource(`${API}/api/video/stream`, { withCredentials: true })

    evtSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        const idMatches =
          (data.compilationId && data.compilationId === matchId) ||
          (data.uploadId && (data.uploadId === resolvedUploadId || data.uploadId === matchId))
        if (!idMatches) return

        // ── COMBINE PHASE EVENTS ────────────────────────────────────
        if (data.event === 'compilation_progress') {
          const i = (data.completed ?? 0)
          const n = (data.total ?? fileCount)
          const pct = 18 + Math.round((i / Math.max(1, n)) * 22) // 18-40% range
          setPhase('combine')
          setProgress(pct, 'Combining your videos…', `${i} of ${n} downloaded`)
        }
        if (data.event === 'compilation_complete') {
          if (data.uploadId) resolvedUploadId = data.uploadId
          setPhase('edit')
          setProgress(48, 'Riley is editing your reel…', 'Analyzing motion, audio, and key moments')
        }

        // ── RILEY EDIT PHASE EVENTS ────────────────────────────────
        if (data.event === 'stage_start') {
          const label = stageLabels[data.stage] || data.stage
          // Map Riley's pipeline progress into the edit-phase band (48-95%)
          const editPct = 48 + Math.round(((data.progress ?? 0) / 100) * 47)
          setPhase('edit')
          setProgress(editPct, label, `Step ${data.stageIndex + 1} of ${data.totalStages}`)
        }
        if (data.event === 'stage_done') {
          const editPct = 48 + Math.round(((data.progress ?? 0) / 100) * 47)
          setProgress(editPct)
        }

        // ── DONE ────────────────────────────────────────────────────
        if (data.event === 'processing_complete') {
          setPhase('done')
          setProgress(100, 'Done!', data.hook || 'Reel ready for review')
          evtSource.close()
          refreshClips()
          const titleText = isCompilation
            ? `Your reel from ${fileCount} videos is ready`
            : 'Your reel is ready'
          const detailText = data.hook ? `Hook: "${data.hook}" — review and approve below` : 'Review and approve below'
          showCompletionBanner(titleText, detailText)
          // Brief 100% display, then collapse the processing card
          setTimeout(() => hideProcessing(), 1200)
        }

        // ── ERROR ───────────────────────────────────────────────────
        if (data.event === 'processing_error') {
          setProgress(0, 'Processing failed', data.error || 'Unknown error')
          showToast(`Processing failed: ${data.error}`, 'error')
          evtSource.close()
          setTimeout(() => hideProcessing(), 5000)
        }
      } catch {}
    }

    evtSource.onerror = () => {
      // SSE disconnected — fall back to polling. Don't tear down the
      // progress UI; pollUntilClipReady will keep it updated.
      evtSource.close()
      const detail = document.getElementById('processing-detail')
      if (detail) detail.textContent = 'Connection lost — checking for results'
      pollUntilClipReady(matchId)
    }
  }

  function pollUntilClipReady(uploadId, options) {
    const isRecovery = options?.recovery === true
    const fileCount = options?.fileCount ?? 1
    let attempts = 0
    // Snapshot of clip IDs at the moment processing started. Anything that
    // appears after this is "new" and means the pipeline finished.
    const startIds = new Set(pendingClips.map(c => c.id))

    // Estimated phase milestones — used as a fallback when SSE isn't
    // delivering events. Mirrors the SSE-driven phases (combine: 18-40,
    // edit: 48-95) so the UI stays consistent.
    const progressSteps = [
      { at: 1, pct: 22, phase: 'combine', label: 'Combining videos…', detail: 'Stitching source files' },
      { at: 4, pct: 50, phase: 'edit', label: 'Riley is picking the best moments…', detail: 'Analyzing motion and audio' },
      { at: 8, pct: 70, phase: 'edit', label: 'Riley is editing the reel…', detail: 'Cutting and encoding segments' },
      { at: 15, pct: 82, phase: 'edit', label: 'Still encoding…', detail: 'Large files take a bit longer' },
      { at: 20, pct: 88, phase: 'edit', label: 'Alex is writing captions…', detail: 'Generating hooks and copy' },
      { at: 25, pct: 92, phase: 'edit', label: 'Almost done…', detail: 'Uploading to S3' },
    ]

    const poll = async () => {
      attempts++
      await refreshClips()

      const hasNewClip = pendingClips.some(c => !startIds.has(c.id))
      if (hasNewClip) {
        // New clip appeared — done. Show persistent completion banner.
        setPhase('done')
        setProgress(100, 'Done!', 'Your reel is ready for review')
        const titleText = isRecovery && fileCount > 1
          ? `Your reel from ${fileCount} videos is ready`
          : fileCount > 1
            ? `Your reel from ${fileCount} videos is ready`
            : 'Your reel is ready'
        showCompletionBanner(titleText, 'Review and approve below')
        setTimeout(() => hideProcessing(), 1200)
        return
      }

      const step = [...progressSteps].reverse().find(s => attempts >= s.at)
      if (step) {
        setPhase(step.phase)
        setProgress(step.pct, step.label, step.detail)
      }

      // Recovery polls run longer (8 min) since we don't know how far
      // along the server was when the connection dropped.
      const maxAttempts = isRecovery ? 96 : 60
      if (attempts < maxAttempts) {
        setTimeout(poll, 5000)
      } else {
        setProgress(
          undefined,
          'Processing is taking longer than expected',
          'Your clip may still be processing — check back shortly',
        )
        setTimeout(() => hideProcessing(), 10000)
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
      container.innerHTML = `<div class="studio-pending-empty" role="status" style="text-align:center;color:var(--t3);font-size:13px;line-height:1.5;background:var(--s1);border:1px solid var(--b1);border-radius:10px;padding:28px 20px">
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

      return `<article id="studio-clip-card-${clip.id}" class="studio-clip-card">
        <div class="studio-clip-inner">
          <div class="studio-clip-visual">
            ${(() => {
              const isDescriptLink = clip.clippedUrl && clip.clippedUrl.includes('web.descript.com')
              const videoSrc = (!isDescriptLink && clip.clippedUrl) ? clip.clippedUrl : clip.sourceVideoUrl
              if (videoSrc) {
                return `<video src="${videoSrc}" controls></video>`
              }
              return `<div class="studio-clip-placeholder" aria-hidden="true">&#127909;</div>`
            })()}
          </div>
          <div class="studio-clip-meta">
            <div class="studio-clip-meta-row">
              <span>Riley's edit</span>
              <span class="studio-clip-ver" style="background:${scoreColor}">v${version}</span>
            </div>
            ${adj.colorTemperature ? `<div class="studio-clip-toning">Temp: ${adj.colorTemperature} · Sat: ${adj.saturation || 0} · Warmth: ${adj.warmth || 0}</div>` : ''}
            <div class="studio-clip-score" style="background:${scoreBg}">
              <span style="color:${scoreColor}">Match ${(style.styleReplication || 0).toFixed(2)}</span>
            </div>
          </div>
          <div class="studio-clip-actions">
            <button type="button" class="btn-fill" style="flex:1;padding:7px 10px;font-size:11px" data-studio-action="approve-visual" data-clip-id="${clip.id}">Approve</button>
            <button type="button" class="btn" style="flex:1;padding:7px 10px;font-size:11px" data-studio-action="show-visual-feedback" data-clip-id="${clip.id}">Reject</button>
          </div>
          <div id="visual-feedback-${clip.id}" class="studio-clip-feedback" style="display:none">
            <textarea id="visual-fb-${clip.id}" rows="2" placeholder="What to change (e.g. 'Too warm')" style="width:100%;border:1px solid var(--b1);border-radius:8px;padding:8px;font-size:11px;resize:none;background:var(--bg);color:var(--t2);font-family:inherit;box-sizing:border-box"></textarea>
            <div style="display:flex;gap:8px;margin-top:8px">
              <button type="button" class="btn-fill" style="flex:1;padding:6px;font-size:11px;background:rgba(196,138,138,.6);border:none;cursor:pointer" data-studio-action="reject-visual-submit" data-clip-id="${clip.id}">Regenerate</button>
              <button type="button" class="btn" style="flex:1;padding:6px;font-size:11px" data-studio-action="hide-visual-feedback" data-clip-id="${clip.id}">Cancel</button>
            </div>
          </div>
          <!-- captions UI retained for delegated handlers; hidden -->
          <div style="display:none" aria-hidden="true" data-studio-captions-shelf="${clip.id}">
            ${captions.length > 0 ? captions.map((cap, i) => {
              const capText = String(cap.text ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/"/g, '&quot;')
              const rat = String(cap.rationale || cap.type || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
              return `<div style="border:${i === 0 ? '2px solid var(--accent)' : '1px solid var(--b1)'};border-radius:8px;padding:12px;margin-bottom:10px">
                <div style="font-size:13px;font-weight:500;line-height:1.5;color:var(--t1);margin-bottom:4px">"${capText}"</div>
                <div style="font-size:11px;color:var(--t3);margin-bottom:10px;font-style:italic">${rat}</div>
                <div style="display:flex;gap:8px">
                  <button type="button" class="btn-fill" style="flex:1;padding:7px;font-size:11px" data-studio-action="approve-copy" data-clip-id="${clip.id}" data-caption-id="${cap.id}">Use this</button>
                  <button type="button" class="btn" style="flex:1;padding:7px;font-size:11px" data-studio-action="reject-copy" data-clip-id="${clip.id}">Not this one</button>
                </div>
              </div>`
            }).join('') : ''}
            ${captions.length > 0 ? `<button type="button" class="btn" style="width:100%;padding:8px;font-size:11px;color:var(--t3)" data-studio-action="reject-all-copy" data-clip-id="${clip.id}">Reject all captions</button>` : ''}
          </div>
        </div>
        <div class="studio-clip-footer">
          <button type="button" class="btn" style="padding:5px 10px;font-size:10px;color:var(--t3)" data-studio-action="discard" data-clip-id="${clip.id}">Discard</button>
        </div>
      </article>`
    }).join('')
  }

  // ── Posting Strategy ─────────────────────────────────────────────

  function fmtStrategyTime(isoOrDate) {
    const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate
    if (isNaN(d)) return '—'
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December']
    const h = d.getUTCHours()
    const period = h >= 12 ? 'PM' : 'AM'
    const display = (h % 12 || 12) + ':00 ' + period
    return `${days[d.getUTCDay()]}, ${months[d.getUTCMonth()]} ${d.getUTCDate()} · ${display}`
  }

  function fmtPeakHour(hour) {
    if (hour == null) return '—'
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
    const period = hour >= 12 ? 'PM' : 'AM'
    return `${period === 'PM' ? hour - 12 || 12 : hour || 12} ${period} UTC`
  }

  function renderPostingStrategy(strategy) {
    const slotsEl = document.getElementById('studio-strategy-slots')
    const peakEl = document.getElementById('studio-peak-label')
    if (!slotsEl) return

    if (!strategy) {
      slotsEl.innerHTML = '<div style="color:var(--t3);font-size:12px;padding:20px 0;text-align:center">Could not load strategy — Jordan needs more data.</div>'
      return
    }

    if (peakEl && strategy.context && strategy.context.audiencePeakHour != null) {
      const ctx = strategy.context
      const dayPart = ctx.bestDayOfWeek ? ctx.bestDayOfWeek.slice(0, 3) + ' ' : ''
      peakEl.textContent = dayPart + fmtPeakHour(ctx.audiencePeakHour)
    }

    const SLOTS = [
      { key: 'primary',   label: 'Primary',        labelColor: 'var(--accent)', border: '1px solid var(--accent)', confColor: 'var(--ok)', confBg: 'rgba(159,179,138,.15)' },
      { key: 'secondary', label: 'Alternative',     labelColor: 'var(--t3)',     border: '1px solid var(--b1)',     confColor: 'var(--accent)', confBg: 'var(--accent-soft)' },
      { key: 'tertiary',  label: 'Testing window',  labelColor: 'var(--t3)',     border: '1px solid var(--b1)',     confColor: 'var(--down)',   confBg: 'rgba(196,138,138,.15)' },
    ]

    slotsEl.innerHTML = SLOTS.map(slot => {
      const rec = strategy[slot.key]
      if (!rec) return ''
      const pct = Math.round((rec.confidence || 0) * 100) + '%'
      const timeStr = fmtStrategyTime(rec.recommendedTime)
      const isoTime = rec.recommendedTime
      const tags = [
        rec.audiencePeak ? '<span style="font-size:10px;padding:3px 8px;border-radius:4px;background:rgba(159,179,138,.15);color:var(--ok)">Audience peak</span>' : '',
        rec.formatPerformance ? `<span style="font-size:10px;padding:3px 8px;border-radius:4px;background:var(--b1);color:var(--t2)">${rec.formatPerformance}</span>` : '',
      ].filter(Boolean).join('')

      return `<div style="background:var(--bg);border:${slot.border};border-radius:8px;padding:14px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
          <div>
            <div style="font-family:'Inter',sans-serif;font-weight:500;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:${slot.labelColor};margin-bottom:4px">${slot.label}</div>
            <div style="font-size:14px;font-weight:600;color:var(--t1)">${timeStr}</div>
          </div>
          <span style="font-size:11px;font-weight:600;color:${slot.confColor};padding:4px 8px;background:${slot.confBg};border-radius:4px">${pct}</span>
        </div>
        <div style="font-size:12px;line-height:1.5;color:var(--t2);margin-bottom:${tags ? '10px' : '10px'}">${rec.rationale || ''}</div>
        ${tags ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">${tags}</div>` : ''}
        <button class="btn-fill" style="width:100%;padding:9px;font-size:11px" data-studio-action="schedule" data-clip-id="pending" data-scheduled-time="${isoTime}">Schedule for this time</button>
      </div>`
    }).join('')
  }

  async function loadPostingStrategy() {
    const strategy = await fetchPostingStrategy('video')
    renderPostingStrategy(strategy)
  }

  // ── Load & Refresh ───────────────────────────────────────────────

  function updateClipCount() {
    const count = pendingClips.length
    const countEl = document.querySelector('[data-studio-pending-count]')
    if (countEl) countEl.textContent = count === 1 ? '1 item' : `${count} items`

    // Keep sidebar schedule buttons in sync with the first pending clip
    activeClipId = pendingClips[0]?.id || null
    document.querySelectorAll('[data-studio-action="schedule"], [data-studio-action="schedule-custom"], [data-studio-action="save-draft"]').forEach(btn => {
      if (activeClipId) btn.dataset.clipId = activeClipId
    })
  }

  async function refreshClips() {
    console.log('[studio] refreshClips called, companyId:', currentCompanyId)
    pendingClips = await fetchPendingClips()
    console.log('[studio] fetched', pendingClips.length, 'pending clips')
    // Seed clipStateMap so approval guards work immediately (no action needed yet)
    pendingClips.forEach(clip => {
      if (!clipStateMap[clip.id]) {
        clipStateMap[clip.id] = {
          visualApprovalStatus: clip.visualApprovalStatus,
          copyApprovalStatus: clip.copyApprovalStatus,
        }
      }
    })
    updateClipCount()
    renderPendingClips()
    consumeStudioClipFocus()
  }

  function consumeStudioClipFocus () {
    try {
      const id = sessionStorage.getItem('vxStudioClipFocus')
      if (!id) return
      sessionStorage.removeItem('vxStudioClipFocus')
      requestAnimationFrame(function () {
        const el = document.getElementById('studio-clip-card-' + id)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      })
    } catch (_) { /* noop */ }
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

    // Load Jordan's posting strategy (fire-and-forget, renders into sidebar)
    loadPostingStrategy()

    if (!studioUploadDomWired) {
      studioUploadDomWired = true

      // Helper that enforces the MAX_BATCH_FILES cap on the merged list.
      // Per product decision: reject the WHOLE merged set if it exceeds the
      // cap, rather than silently truncating. The user has to explicitly
      // remove some before they can submit.
      function tryAddFiles(newFiles) {
        if (newFiles.length === 0) return
        const merged = [...selectedFiles, ...newFiles]
        if (merged.length > MAX_BATCH_FILES) {
          showToast(`Max ${MAX_BATCH_FILES} videos per upload — you tried to add ${merged.length}. Remove some first.`, 'error')
          return
        }
        selectedFiles = merged
        showVideoPreviews(selectedFiles)
      }

      const fileInput = document.getElementById('studio-file-input')
      if (fileInput) {
        fileInput.addEventListener('change', (e) => {
          const newFiles = Array.from(e.target.files || []).filter(f => f.type.startsWith('video/'))
          tryAddFiles(newFiles)
          fileInput.value = ''
        })
      }

      const dropZone = document.getElementById('studio-upload-zone')
      if (dropZone) {
        dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--accent)' })
        dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = 'var(--b2)' })
        dropZone.addEventListener('drop', (e) => {
          e.preventDefault()
          dropZone.style.borderColor = 'var(--b2)'
          const newFiles = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('video/'))
          if (newFiles.length === 0) { showToast('Please drop video files', 'error'); return }
          tryAddFiles(newFiles)
        })
      }

      const submitBtn = document.getElementById('studio-submit-btn')
      if (submitBtn) {
        submitBtn.addEventListener('click', () => {
          if (selectedFiles.length === 0) { showToast('No videos selected', 'error'); return }
          if (selectedFiles.length > MAX_BATCH_FILES) {
            // Defense-in-depth: should already be impossible from the
            // tryAddFiles cap, but guard the submit too.
            showToast(`Max ${MAX_BATCH_FILES} videos per upload — remove ${selectedFiles.length - MAX_BATCH_FILES} first.`, 'error')
            return
          }
          if (selectedFiles.length === 1) {
            uploadVideo(selectedFiles[0])
          } else {
            uploadBatch(selectedFiles)
          }
          selectedFiles = []
        })
      }

      const clearBtn = document.getElementById('studio-clear-btn')
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          selectedFiles = []
          clearUploadPreviews()
        })
      }

      // Completion banner dismiss
      const completeDismiss = document.getElementById('studio-complete-dismiss')
      if (completeDismiss) {
        completeDismiss.addEventListener('click', () => hideCompletionBanner())
      }

      const studioNav = document.getElementById('nav-db-studio')
      if (studioNav) {
        studioNav.addEventListener('click', () => {
          setTimeout(refreshClips, 300)
        })
      }
    }

    await refreshClips()
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
