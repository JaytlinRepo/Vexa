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

  /** User-visible error text — avoid API snake_case and stack-ish blobs */
  function studioErr (err, fallback) {
    const fb = fallback || 'Something went wrong. Please try again.'
    const m = String(err && err.message != null ? err.message : '').trim()
    if (!m) return fb
    if (m.length > 140) return fb
    if (/^[a-z][a-z0-9_]*$/i.test(m) && m.indexOf('_') !== -1) return fb
    if (/ECONN|ENOTFOUND|ETIMEDOUT|fetch failed/i.test(m)) return 'Can\'t connect right now. Check your internet and try again.'
    return m
  }

  function processingErrDetail (raw) {
    const s = String(raw || '').trim()
    if (!s || /^unknown error$/i.test(s)) return 'Please try again, or try a shorter clip.'
    if (s.length > 200 || (/^[a-z][a-z0-9_]*$/i.test(s) && s.indexOf('_') !== -1)) return 'Please try again in a moment.'
    if (/(arn:aws|aws |iam:|s3:|accessdenied|access denied|x-amz|presigned|signature|status code \d{3}|\bforbidden\b|\bunauthorized\b)/i.test(s)) {
      return 'Please try again in a moment.'
    }
    return s
  }

  function processingErrToast (raw) {
    const s = String(raw || '').trim()
    if (!s || /^unknown error$/i.test(s) || s.length > 200) {
      return 'We couldn\'t finish editing your reel. Try again, or use a shorter clip.'
    }
    // snake_case codes ("storage_unavailable") never reach the user
    if (/^[a-z][a-z0-9_]*$/i.test(s) && s.indexOf('_') !== -1) {
      return 'We couldn\'t finish editing your reel. Please try again.'
    }
    // Defense in depth: never echo AWS/IAM/HTTP-stack chatter even if a new
    // backend code path forgets to sanitize.
    if (/(arn:aws|aws |iam:|s3:|accessdenied|access denied|x-amz|presigned|signature|status code \d{3}|\bforbidden\b|\bunauthorized\b)/i.test(s)) {
      return 'We couldn\'t finish editing your reel. Please try again.'
    }
    // Backend now sends a curated user-facing message — show it as-is.
    return s
  }

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
  /** Hard cap on per-file size (matches the API's 2GB multer limit). */
  const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024
  /**
   * fetch() can't stream an upload progress event, so we wrap an XHR with
   * an onprogress callback. The progress band is 5%-14% (the "upload" phase
   * window) so the bar visibly moves while bytes are on the wire instead
   * of sitting frozen at 5% for tens of seconds on big videos.
   */
  function xhrUpload(url, formData, onProgress) {
    return new Promise(function (resolve, reject) {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', url, true)
      xhr.withCredentials = true
      xhr.upload.addEventListener('progress', function (e) {
        if (!e.lengthComputable || !onProgress) return
        onProgress(e.loaded / e.total)
      })
      xhr.addEventListener('load', function () {
        let body = null
        try { body = JSON.parse(xhr.responseText || 'null') } catch {}
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({ ok: true, status: xhr.status, body })
        } else {
          resolve({ ok: false, status: xhr.status, body })
        }
      })
      xhr.addEventListener('error', function () { reject(new Error('Network error during upload')) })
      xhr.addEventListener('abort', function () { reject(new Error('Upload aborted')) })
      xhr.send(formData)
    })
  }

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

  // Smooth-progress state: the bar always animates toward `progressTarget`
  // at a steady cadence rather than snapping to whatever value setProgress
  // last passed. This gives the user the feeling that something is
  // continuously happening between stage events, not just at boundaries.
  let progressCurrent = 0
  let progressTarget = 0
  let progressTickHandle = null
  function startProgressTick() {
    if (progressTickHandle) return
    progressTickHandle = setInterval(() => {
      const bar = document.getElementById('processing-bar')
      const pctEl = document.getElementById('processing-progress')
      // Ease 18% of the gap each tick → arrives smoothly without lurching
      const gap = progressTarget - progressCurrent
      if (Math.abs(gap) < 0.05) {
        progressCurrent = progressTarget
      } else {
        progressCurrent += gap * 0.18
      }
      if (bar) bar.style.width = progressCurrent.toFixed(1) + '%'
      if (pctEl) pctEl.textContent = Math.round(progressCurrent) + '%'
    }, 120)
  }
  function stopProgressTick() {
    if (progressTickHandle) { clearInterval(progressTickHandle); progressTickHandle = null }
  }

  function setProgress(pct, statusText, detailText) {
    const statusEl = document.getElementById('processing-status')
    const detailEl = document.getElementById('processing-detail')
    if (typeof pct === 'number' && Number.isFinite(pct)) {
      const clamped = Math.max(0, Math.min(100, pct))
      // Monotonic: never let the target slide backwards. A late stage_start
      // event landing below the current drift target shouldn't yank the bar
      // backwards on the user. Reset is only allowed via showProcessing().
      if (clamped > progressTarget) progressTarget = clamped
      startProgressTick()
    }
    if (statusEl && statusText != null) statusEl.textContent = statusText
    if (detailEl && detailText != null) detailEl.textContent = detailText
  }

  // For long stages (Riley vision, motion analysis), drift the target
  // slowly upward toward the next stage's start so the bar keeps moving
  // even when no events are coming in. Caller passes the ceiling we
  // should NOT pass (i.e. the next stage's known boundary).
  let driftHandle = null
  function startProgressDrift(ceilPct, durationSec) {
    stopProgressDrift()
    if (typeof ceilPct !== 'number' || ceilPct <= progressTarget) return
    const start = progressTarget
    const startedAt = Date.now()
    driftHandle = setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000
      const ratio = Math.min(1, elapsed / durationSec)
      // Ease-out: most of the movement up front so the bar visibly
      // progresses, then slows as it approaches the ceiling.
      const eased = 1 - Math.pow(1 - ratio, 2)
      const next = start + (ceilPct - start) * eased
      if (next > progressTarget) progressTarget = next
      if (ratio >= 1) stopProgressDrift()
    }, 400)
  }
  function stopProgressDrift() {
    if (driftHandle) { clearInterval(driftHandle); driftHandle = null }
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
    // Reset bar state so a previous run doesn't bleed into this one.
    progressCurrent = 0
    progressTarget = 0
    setProgress(5, initialStatus, initialDetail)
    startElapsedTick()
  }
  function hideProcessing() {
    const el = document.getElementById('studio-processing')
    if (el) el.style.display = 'none'
    stopElapsedTick()
    stopProgressDrift()
    stopProgressTick()
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
  // ── Active-job persistence ────────────────────────────────────────
  // The processing card lives only as long as the user stays on the
  // Studio tab. When they navigate away and back — or refresh the
  // page — the in-flight job is still running on the backend, but the
  // UI would show nothing. saveActiveJob stashes the job descriptor
  // in sessionStorage; resumeActiveJob picks it back up on init and
  // re-attaches the SSE stream. clearActiveJob drops the record once
  // the job has completed or aged out.
  const ACTIVE_JOB_KEY = 'vxStudioActiveJob'
  const ACTIVE_JOB_MAX_AGE_MS = 30 * 60 * 1000 // 30 min ceiling
  function saveActiveJob(job) {
    try { sessionStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify(job)) } catch {}
  }
  function clearActiveJob() {
    try { sessionStorage.removeItem(ACTIVE_JOB_KEY) } catch {}
  }
  function loadActiveJob() {
    try {
      const raw = sessionStorage.getItem(ACTIVE_JOB_KEY)
      if (!raw) return null
      const job = JSON.parse(raw)
      if (!job?.startedAt || Date.now() - job.startedAt > ACTIVE_JOB_MAX_AGE_MS) {
        clearActiveJob()
        return null
      }
      return job
    } catch { return null }
  }
  async function resumeActiveJobIfPresent() {
    const job = loadActiveJob()
    if (!job) return
    // Verify the job still exists AND is still in flight before resurrecting
    // the processing card. The backend returns done=true for any job that
    // already finished — pending approval, approved, or rejected — so we
    // never zombie-ize a card for work that already wrapped while the tab
    // was disconnected.
    try {
      const id = job.compilationId || job.uploadId
      if (id) {
        const r = await fetch(`${API}/api/video/job/${encodeURIComponent(id)}`, { credentials: 'include' })
        if (r.status === 404) { clearActiveJob(); return }
        if (!r.ok) { clearActiveJob(); return }
        const body = await r.json().catch(() => null)
        if (body && body.done) { clearActiveJob(); return }
      }
    } catch {
      clearActiveJob(); return
    }
    // First, see if the job already finished while we were away — common
    // when an HMR reload or tab refresh fires after the backend has
    // already saved the clip. If a clip exists newer than the job's
    // start time, surface the completion banner directly.
    const startedAt = job.startedAt || 0
    let alreadyDone = false
    try {
      await refreshClips()
      const newest = pendingClips.reduce((latest, c) => {
        const t = new Date(c.createdAt || 0).getTime()
        return t > latest ? t : latest
      }, 0)
      if (newest > startedAt) alreadyDone = true
    } catch {}
    if (alreadyDone) {
      clearActiveJob()
      const titleText = job.isCompilation && job.fileCount > 1
        ? `Your reel from ${job.fileCount} videos is ready`
        : 'Your reel is ready'
      showCompletionBanner(titleText, 'Review and approve below')
      return
    }
    // Otherwise, the job is still in flight — show the processing card
    // and re-attach SSE + polling. We don't know which stage we're at,
    // so use a heuristic progress estimate based on elapsed time.
    showProcessing(
      job.isCompilation ? 'Still working on your reel…' : 'Still editing your video…',
      '',
    )
    setPhase('edit')
    const elapsed = (Date.now() - startedAt) / 1000
    const est = Math.min(90, 30 + Math.round(elapsed / 3))
    setProgress(est)
    if (job.compilationId) {
      connectProcessingStream(job.compilationId, { isCompilation: true, fileCount: job.fileCount || 1 })
      pollUntilClipReady(job.compilationId)
    } else if (job.uploadId) {
      connectProcessingStream(job.uploadId)
      pollUntilClipReady(job.uploadId)
    }
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
      showToast(studioErr(err, 'Couldn\'t save your approval. Please try again.'), 'error')
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
      showToast(studioErr(err, 'Couldn\'t send your feedback. Please try again.'), 'error')
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
      showToast(studioErr(err, 'Couldn\'t create a new cut. Please try again.'), 'error')
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
      showToast(studioErr(err, 'Couldn\'t save your caption choice. Please try again.'), 'error')
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
      showToast(studioErr(err, 'Couldn\'t send your feedback. Please try again.'), 'error')
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
      showToast(studioErr(err, 'Couldn\'t rewrite the captions. Please try again.'), 'error')
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
      showToast(studioErr(err, 'Couldn\'t remove that reel. Please try again.'), 'error')
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
      showToast(studioErr(err, 'Couldn\'t schedule that post. Please try again.'), 'error')
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
    if (!currentCompanyId) {
      const company = await fetchUserCompany()
      if (company) currentCompanyId = company.id
    }
    if (!currentCompanyId) { showToast('Please sign in to use Studio.', 'error'); return }

    const oversize = files.find((f) => f.size > MAX_FILE_BYTES)
    if (oversize) {
      showToast(`"${oversize.name}" is over 2GB — try a smaller file.`, 'error')
      return
    }

    showVideoPreviews(files)
    showProcessing(`Uploading your videos…`, '')

    const form = new FormData()
    for (const file of files) form.append('videos', file)
    form.append('companyId', currentCompanyId)
    form.append('strategy', 'montage')

    try {
      // Drive the bar from 5% → 14% based on actual bytes-on-the-wire so the
      // user sees motion during the slowest user-visible step (file transfer).
      const res = await xhrUpload(`${API}/api/video/upload-batch`, form, function (frac) {
        setProgress(5 + Math.round(frac * 9), null, `${Math.round(frac * 100)}%`)
      })
      if (!res.ok) {
        const errMsg = (res.body && res.body.error) || 'Upload didn\'t go through'
        throw new Error(errMsg)
      }
      const json = res.body
      // Upload phase done → combine phase begins
      setPhase('combine')
      setProgress(18, 'Putting your clips together…', '')
      showToast(`${files.length} clips received — Riley is starting now`, 'success')
      // Clear preview strip — files are uploaded, no longer relevant
      clearUploadPreviews()

      // Persist the in-flight job so a tab refresh / navigate-away can
      // resume showing progress instead of dropping the user back to a
      // blank Studio while the backend keeps processing.
      saveActiveJob({ compilationId: json.compilationId, isCompilation: true, fileCount: files.length, startedAt: Date.now() })

      // SSE drives progress; the polling fallback is started inside
      // connectProcessingStream() only if the SSE channel goes silent.
      connectProcessingStream(json.compilationId, { isCompilation: true, fileCount: files.length })
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
      setProgress(45, 'Reconnecting…', '')
      clearUploadPreviews()
      pollUntilClipReady('__recovery__', { fileCount: files.length, recovery: true })
    }
  }

  async function uploadVideo(file) {
    if (!currentCompanyId) {
      const company = await fetchUserCompany()
      if (company) currentCompanyId = company.id
    }
    if (!currentCompanyId) { showToast('Please sign in to use Studio.', 'error'); return }

    if (file.size > MAX_FILE_BYTES) {
      showToast(`"${file.name}" is over 2GB — try a smaller file.`, 'error')
      return
    }

    showVideoPreviews([file])
    showProcessing('Uploading your video…', '')

    const form = new FormData()
    form.append('video', file)
    form.append('companyId', currentCompanyId)

    try {
      const res = await xhrUpload(`${API}/api/video/upload`, form, function (frac) {
        setProgress(5 + Math.round(frac * 9), null, `${Math.round(frac * 100)}%`)
      })
      if (!res.ok) {
        const errMsg = (res.body && res.body.error) || 'Upload didn\'t go through'
        throw new Error(errMsg)
      }
      const json = res.body
      // Single upload skips the combine phase entirely
      setPhase('edit')
      setProgress(45, 'Editing your video…', '')
      showToast('Uploaded — Riley is editing now', 'success')
      clearUploadPreviews()

      saveActiveJob({ uploadId: json.uploadId, isCompilation: false, fileCount: 1, startedAt: Date.now() })
      // SSE drives progress; the polling fallback is started inside
      // connectProcessingStream() only if the SSE channel goes silent.
      connectProcessingStream(json.uploadId)
    } catch (err) {
      console.warn('[studio] upload fetch errored; entering recovery poll mode:', err)
      showToast('Connection dropped — checking if upload completed in background', 'info')
      setPhase('edit')
      setProgress(45, 'Reconnecting…', '')
      clearUploadPreviews()
      pollUntilClipReady('__recovery__', { fileCount: 1, recovery: true })
    }
  }

  // ── SSE Processing Stream ─────────────────────────────────────────

  // User-friendly stage labels — short, plain-language, no jargon.
  // Multiple back-end stages collapse into one user-visible headline so the
  // status doesn't flicker every few seconds with new technical names.
  const stageLabels = {
    'Download + probe': 'Reading your video…',
    'Get video duration': 'Reading your video…',
    'Transcribe (AWS)': 'Reading your video…',
    'Detect scenes (FFmpeg)': 'Reading your video…',
    'Extract keyframes': 'Reading your video…',
    'Analyze video': 'Reading your video…',
    'Analyze clip (Riley)': 'Picking the best moments…',
    'Build reel (FFmpeg)': 'Editing your reel…',
    'Write captions (Alex)': 'Writing your caption…',
  }
  // No detail subtext — keep the card to a single short headline + percent.
  const stageDetails = {}
  // Approximate duration in seconds for each Riley-pipeline stage. Used
  // by the smooth-progress drift so the bar keeps moving between stage
  // events on slow stages (vision call) instead of looking frozen.
  const stageDurations = {
    'Download + probe': 5,
    'Analyze video': 45,
    'Analyze clip (Riley)': 60,
    'Build reel (FFmpeg)': 15,
    'Write captions (Alex)': 8,
  }

  /** If the pipeline sends a raw stage name, strip vendor/tool tokens before showing it */
  function displayStageLabel (stage) {
    if (!stage) return 'Working on your video…'
    if (stageLabels[stage]) return stageLabels[stage]
    let s = String(stage)
      .replace(/\s*\(AWS\)/gi, '')
      .replace(/\s*\(FFmpeg\)/gi, '')
      .replace(/\bFFmpeg\b/gi, '')
      .replace(/\bAWS\b/gi, '')
      .trim()
    return s || 'Working on your video…'
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

    // Tracks the "no messages received recently" timer. Armed when the
    // channel errors out, cleared whenever a message arrives. If it
    // fires (i.e. 12s passed with no messages), we abandon SSE and
    // switch to polling. EventSource auto-reconnects with backoff
    // before this fires, so a transient drop heals itself silently.
    let reconnectFallbackTimer = null

    const evtSource = new EventSource(`${API}/api/video/stream`, { withCredentials: true })

    evtSource.onmessage = (e) => {
      // A message confirms the channel is healthy — clear any pending
      // reconnect fallback timer so we don't spuriously switch to polling.
      if (reconnectFallbackTimer) {
        clearTimeout(reconnectFallbackTimer)
        reconnectFallbackTimer = null
      }
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
          setPhase('combine')
          if (data.normalizing) {
            const pct = data.pctHint ?? 40
            setProgress(pct, 'Putting your clips together…', '')
          } else {
            const pct = 18 + Math.round((i / Math.max(1, n)) * 22) // 18-40% range
            setProgress(pct, 'Putting your clips together…', '')
          }
        }
        if (data.event === 'compilation_complete') {
          if (data.uploadId) resolvedUploadId = data.uploadId
          setPhase('edit')
          setProgress(48, 'Editing your reel…', '')
          // Drift toward the next known checkpoint (Analyze video starts ~57%)
          // so the bar keeps moving while Riley spins up.
          startProgressDrift(54, 6)
        }

        // ── RILEY EDIT PHASE EVENTS ────────────────────────────────
        if (data.event === 'stage_start') {
          stopProgressDrift()
          const label = displayStageLabel(data.stage)
          // Map Riley's pipeline progress into the edit-phase band (48-95%)
          const editPct = 48 + Math.round(((data.progress ?? 0) / 100) * 47)
          setPhase('edit')
          setProgress(editPct, label, '')
          // Drift toward the stage's expected end (next stage's start) so the
          // bar visibly moves during the long stages (vision, motion, etc.)
          // rather than sitting frozen for 30-60 seconds.
          const totalStages = data.totalStages || 7
          const nextStageStart = 48 + Math.round(((data.stageIndex + 1) / totalStages) * 47)
          // Stop ~1% short so stage_done has somewhere to land.
          const driftCeiling = Math.max(editPct + 1, nextStageStart - 1)
          const dur = stageDurations[data.stage] ?? 20
          startProgressDrift(driftCeiling, dur)
        }
        if (data.event === 'stage_done') {
          stopProgressDrift()
          const editPct = 48 + Math.round(((data.progress ?? 0) / 100) * 47)
          setProgress(editPct)
        }

        // ── DONE ────────────────────────────────────────────────────
        if (data.event === 'processing_complete') {
          setPhase('done')
          setProgress(100, 'Done!', '')
          evtSource.close()
          clearActiveJob()
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
          // Allow the bar to "fall back" to red-state visually only by stopping
        // forward motion — keep the monotonic guard intact, just update copy.
        setProgress(progressTarget, 'Something went wrong', processingErrDetail(data.error))
          showToast(processingErrToast(data.error), 'error')
          evtSource.close()
          clearActiveJob()
          setTimeout(() => hideProcessing(), 5000)
        }
      } catch {}
    }

    evtSource.onerror = () => {
      // EventSource has built-in auto-reconnect with backoff (~3s default).
      // Don't close the connection on the first error — the browser will
      // retry automatically. Show a "reconnecting" hint to the user.
      // Arm a polling fallback that fires only if we're STILL disconnected
      // after a generous window (12s). A successful reconnect cancels
      // the fallback because pollFallbackTimer is reset on every message.
      const detail = document.getElementById('processing-detail')
      if (detail) detail.textContent = 'Reconnecting — your reel is still being made'
      if (!reconnectFallbackTimer) {
        reconnectFallbackTimer = setTimeout(() => {
          // 12s without a single message — give up on SSE, switch to polling.
          evtSource.close()
          pollUntilClipReady(resolvedUploadId || matchId)
        }, 12000)
      }
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
      { at: 1,  pct: 22, phase: 'combine', label: 'Putting your clips together…', detail: '' },
      { at: 4,  pct: 50, phase: 'edit',    label: 'Picking the best moments…',    detail: '' },
      { at: 8,  pct: 70, phase: 'edit',    label: 'Editing your reel…',           detail: '' },
      { at: 15, pct: 82, phase: 'edit',    label: 'Still working on it…',         detail: '' },
      { at: 20, pct: 88, phase: 'edit',    label: 'Writing your caption…',        detail: '' },
      { at: 25, pct: 92, phase: 'edit',    label: 'Almost done…',                 detail: '' },
    ]

    const poll = async () => {
      attempts++
      await refreshClips()

      const hasNewClip = pendingClips.some(c => !startIds.has(c.id))
      if (hasNewClip) {
        // New clip appeared — done. Show persistent completion banner.
        clearActiveJob()
        setPhase('done')
        setProgress(100, 'Done!', '')
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
            ${adj.colorTemperature ? `<div class="studio-clip-toning">Color: ${adj.colorTemperature} · Saturation: ${adj.saturation || 0} · Warmth: ${adj.warmth || 0}</div>` : ''}
            <div class="studio-clip-score" style="background:${scoreBg}">
              <span style="color:${scoreColor}">Style match ${Math.round((style.styleReplication || 0) * 100)}%</span>
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
    return `${period === 'PM' ? hour - 12 || 12 : hour || 12} ${period} · typical peak`
  }

  function renderPostingStrategy(strategy) {
    const slotsEl = document.getElementById('studio-strategy-slots')
    const peakEl = document.getElementById('studio-peak-label')
    if (!slotsEl) return

    if (!strategy) {
      slotsEl.innerHTML = '<div style="color:var(--t3);font-size:12px;padding:20px 0;text-align:center;line-height:1.5">We need a bit more from your connected accounts to suggest posting times. Check back after your feeds sync.</div>'
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

    // Resume an in-flight job if one was running when the user navigated
    // away or refreshed. The backend keeps processing regardless of the
    // tab; we just re-attach the SSE stream + polling fallback.
    resumeActiveJobIfPresent()

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

      // Processing card dismiss — hides the card AND drops the resume token
      // so the next Studio visit doesn't resurrect it.
      const processingDismiss = document.getElementById('processing-dismiss')
      if (processingDismiss) {
        processingDismiss.addEventListener('click', () => {
          clearActiveJob()
          hideProcessing()
        })
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
