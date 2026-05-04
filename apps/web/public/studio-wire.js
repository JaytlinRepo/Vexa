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

  async function downloadClip(clipId) {
    try {
      const res = await fetch(`${API}/api/studio/clip/${encodeURIComponent(clipId)}/download`, {
        credentials: 'include',
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.message || 'Couldn\'t prepare your download')
      }
      const { url, filename } = await res.json()
      // Anchor + click is the most reliable cross-browser way to trigger a
      // save dialog without leaving the page. The presigned URL returns
      // Content-Disposition: attachment, so the browser saves rather than
      // navigating to the video.
      const a = document.createElement('a')
      a.href = url
      a.download = filename || 'reel.mp4'
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
      showToast('Downloading…', 'info')
    } catch (err) {
      console.error('[studio] download failed:', err)
      showToast(studioErr(err, 'Couldn\'t prepare your download. Please try again.'), 'error')
    }
  }

  async function markClipReady(clipId, platform = 'instagram') {
    try {
      const res = await fetch(`${API}/api/studio/mark-ready`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ clipId, platform }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.message || 'Failed to save clip')
      }
      const result = await res.json()
      updateClipState(clipId, { status: 'ready' })
      showToast('✓ Saved as ready', 'success')
      refreshClips()
      return result
    } catch (err) {
      console.error('[studio] mark-ready failed:', err)
      showToast(studioErr(err, 'Couldn\'t save that clip. Please try again.'), 'error')
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
    // Captions UI was retired (Alex was removed from the team), so the
    // Save as Ready button gates on visual approval only — the copy-
    // approval status is no longer reachable from the UI.
    const state = clipStateMap[clipId]
    if (state.visualApprovalStatus === 'approved') {
      activeClipId = clipId
      document.querySelectorAll('[data-studio-action="save-ready"]').forEach(btn => {
        btn.dataset.clipId = clipId
        btn.disabled = false
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

    // Open the re-cut modal (replaces the old inline strip).
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-studio-action="open-recut-studio"]')
      if (!btn) return
      e.preventDefault()
      openRecutStudio(btn.dataset.clipId)
    })

    // Close the re-cut modal (X button or Cancel)
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-studio-action="close-recut-studio"]')
      if (!btn) return
      e.preventDefault()
      closeRecutStudio()
    })

    // Virtual reel play/pause toggle. The transport button has THREE
    // possible meanings depending on state:
    //   1. Looping a segment → pressing "play" should EXIT the loop
    //      and resume full-reel play (not pause). The loop already
    //      makes the player look like it's playing, so the obvious
    //      intent of pressing "play" is "actually play the whole reel".
    //   2. Paused, not looping → standard play.
    //   3. Playing the full reel → pause.
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-studio-action="virt-toggle-play"]')
      if (!btn) return
      e.preventDefault()
      if (!virtualState) return
      const wasLooping = !!virtualState.loopReelRange
      clearVirtualLoop()
      if (wasLooping) {
        // Exiting loop mode — kick into full-reel play from wherever
        // the loop had us parked.
        virtualPlay()
      } else if (virtualState.playing) {
        virtualPause()
      } else {
        virtualPlay()
      }
    })

    // Virtual reel scrubber — clicking jumps reel time to that ratio
    // and exits any single-segment loop the user had going.
    document.addEventListener('click', (e) => {
      const scrubber = e.target.closest('[data-recut-virt-scrubber]')
      if (!scrubber) return
      e.preventDefault()
      if (!virtualState || virtualState.timeline.total <= 0) return
      clearVirtualLoop()
      const rect = scrubber.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      virtualSeekToReelTime(ratio * virtualState.timeline.total)
    })

    // Toggle a segment's "dropped" state — clicking a segment thumbnail
    // marks/unmarks it for the next re-cut.
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-studio-action="toggle-drop-seg"]')
      if (!btn) return
      e.preventDefault()
      const clipId = btn.dataset.clipId
      const idx = parseInt(btn.dataset.segIdx, 10)
      if (!Number.isInteger(idx)) return
      const state = getEditState(clipId)
      if (state.dropped.has(idx)) state.dropped.delete(idx)
      else state.dropped.add(idx)
      rerenderSegmentStrip(clipId)
    })

    // Reset all drops AND trims for a clip
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-studio-action="reset-drops"]')
      if (!btn) return
      e.preventDefault()
      segmentEditState.set(btn.dataset.clipId, { dropped: new Set(), trims: new Map(), order: null })
      rerenderSegmentStrip(btn.dataset.clipId)
    })

    // Drag-to-reorder. Each segment row has a [data-recut-grip] element
    // marked draggable=true. The row itself is NOT draggable, so trim-
    // handle pointerdowns don't accidentally start a native drag. State
    // for the active reorder lives in `reorderDragState` so dragover /
    // drop / dragend listeners stay coordinated even when the cursor
    // strays off rows mid-drag.
    let reorderDragState = null

    function clearAllRowDragIndicators() {
      const root = document.getElementById('vx-recut-modal')
      if (!root) return
      root.querySelectorAll('[data-seg-row]').forEach((r) => {
        r.style.boxShadow = ''
        r.removeAttribute('data-drop-position')
      })
    }

    document.addEventListener('dragstart', (e) => {
      const grip = e.target.closest('[data-recut-grip]')
      if (!grip) return
      const segIdx = parseInt(grip.dataset.segIdx, 10)
      if (!Number.isInteger(segIdx)) return
      reorderDragState = {
        clipId: grip.dataset.clipId,
        fromOrigIdx: segIdx,
      }
      try { e.dataTransfer.effectAllowed = 'move' } catch {}
      try { e.dataTransfer.setData('text/plain', String(segIdx)) } catch {}
      // Use the whole row as the drag preview so the user sees the
      // segment travelling — not a tiny grip icon.
      const row = grip.closest('[data-seg-row]')
      if (row) {
        try { e.dataTransfer.setDragImage(row, 40, 40) } catch {}
        row.style.opacity = '0.4'
        row.dataset.dragging = 'true'
      }
    })

    document.addEventListener('dragover', (e) => {
      if (!reorderDragState) return
      const row = e.target.closest('[data-seg-row]')
      if (!row || row.dataset.clipId !== reorderDragState.clipId) return
      e.preventDefault()
      try { e.dataTransfer.dropEffect = 'move' } catch {}
      // Skip self — no indicator on the row being dragged.
      if (row.dataset.dragging === 'true') return
      const rect = row.getBoundingClientRect()
      const isAbove = e.clientY < rect.top + rect.height / 2
      // Single accent line at the insertion edge. Clear all others
      // first so only the active drop target shows the indicator.
      clearAllRowDragIndicators()
      row.style.boxShadow = isAbove
        ? 'inset 0 4px 0 0 var(--accent)'
        : 'inset 0 -4px 0 0 var(--accent)'
      row.dataset.dropPosition = isAbove ? 'before' : 'after'
    })

    document.addEventListener('dragleave', (e) => {
      if (!reorderDragState) return
      const row = e.target.closest('[data-seg-row]')
      if (!row) return
      // Only clear the indicator if the cursor genuinely left this row
      // (not just moved to a child). relatedTarget being inside the row
      // means we're still hovering over it.
      if (row.contains(e.relatedTarget)) return
      row.style.boxShadow = ''
      row.removeAttribute('data-drop-position')
    })

    document.addEventListener('drop', (e) => {
      if (!reorderDragState) return
      const row = e.target.closest('[data-seg-row]')
      if (!row || row.dataset.clipId !== reorderDragState.clipId) return
      e.preventDefault()
      const targetOrigIdx = parseInt(row.dataset.segIdx, 10)
      if (!Number.isInteger(targetOrigIdx)) return
      const fromOrigIdx = reorderDragState.fromOrigIdx
      if (targetOrigIdx === fromOrigIdx) return
      const rect = row.getBoundingClientRect()
      const position = (row.dataset.dropPosition === 'after')
        || (e.clientY >= rect.top + rect.height / 2 && row.dataset.dropPosition !== 'before')
        ? 'after' : 'before'
      const clip = pendingClips.find((c) => c.id === reorderDragState.clipId)
      if (!clip) return
      const segments = getClipSegments(clip)
      const state = getEditState(reorderDragState.clipId)
      const order = getOrderedIndices(state, segments.length)
      const fromPos = order.indexOf(fromOrigIdx)
      if (fromPos < 0) return
      // Splice the source out, then re-find target (its index may have
      // shifted by 1 if it sat after the source). Insert before/after
      // based on the dragover-recorded position.
      order.splice(fromPos, 1)
      const newTargetPos = order.indexOf(targetOrigIdx)
      if (newTargetPos < 0) {
        // Target somehow vanished — undo the splice and bail.
        order.splice(fromPos, 0, fromOrigIdx)
        return
      }
      const insertAt = position === 'before' ? newTargetPos : newTargetPos + 1
      order.splice(insertAt, 0, fromOrigIdx)
      rerenderSegmentStrip(reorderDragState.clipId)
    })

    document.addEventListener('dragend', (e) => {
      // Always clear visuals — drag may end from drop, or from cancel.
      const grip = e.target.closest('[data-recut-grip]')
      if (grip) {
        const row = grip.closest('[data-seg-row]')
        if (row) {
          row.style.opacity = ''
          row.removeAttribute('data-dragging')
        }
      }
      // Sweep any lingering indicators from rows the cursor passed
      // over before drop.
      clearAllRowDragIndicators()
      reorderDragState = null
    })

    // Drag handles on segment trim bars — pointerdown initiates a drag.
    // Move + end listeners attach to the window so the drag survives
    // even if the cursor leaves the handle.
    document.addEventListener('pointerdown', (e) => {
      const handle = e.target.closest('[data-trim-handle]')
      if (!handle) return
      startTrimDrag(handle, e)
    })

    // Preview a segment in the modal video player. Clicking the
    // thumbnail (or anywhere on the bar) seeks the source video to
    // the segment's current start so the user can see what they're
    // editing. Modal player must be using the SOURCE video (not the
    // edited reel) for the timestamps to mean anything.
    document.addEventListener('click', (e) => {
      const tile = e.target.closest('[data-studio-action="preview-seg"]')
      if (!tile) return
      e.preventDefault()
      const clipId = tile.dataset.clipId
      const idx = parseInt(tile.dataset.segIdx, 10)
      if (!Number.isInteger(idx)) return
      previewSegmentInModal(clipId, idx)
    })

    // Clicking on the bar (between handles) also seeks the player to
    // that timestamp — gives the user a "scrub" feel without a real
    // scrubber.
    document.addEventListener('click', (e) => {
      // Don't trigger when the click landed on a handle (drag) or on
      // the kept band's children (drop / restore button etc).
      if (e.target.closest('[data-trim-handle]')) return
      const track = e.target.closest('[data-trim-track]')
      if (!track) return
      const rect = track.getBoundingClientRect()
      const ratio = (e.clientX - rect.left) / rect.width
      const extendStart = parseFloat(track.dataset.extendStart)
      const extendEnd = parseFloat(track.dataset.extendEnd)
      const t = extendStart + ratio * (extendEnd - extendStart)
      // Manual seek cancels any active preview-stop so we don't
      // surprise-pause on the user's next play.
      clearPreviewStop()
      seekModalPlayer(t)
    })

    // Re-cut button — POSTs the keep list, swaps the player + strip on success
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-studio-action="recut"]')
      if (!btn) return
      e.preventDefault()
      const clipId = btn.dataset.clipId
      recutClip(clipId)
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

    // Download the rendered reel as a local .mp4
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-studio-action="download"]')
      if (!btn) return
      const clipId = btn.dataset.clipId
      if (!clipId) return
      btn.disabled = true
      await downloadClip(clipId)
      btn.disabled = false
    })

    // Save as Ready — only enabled once both visual and caption are approved.
    // Auto-posting isn't built yet; saving the clip as Ready is the honest
    // end state here. Time pickers and "scheduled" toasts have been removed
    // until there's a real poster behind them.
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-studio-action="save-ready"]')
      if (!btn) return
      const clipId = btn.dataset.clipId
      if (!clipId || clipId === 'pending') {
        showToast('Approve a clip first', 'error')
        return
      }
      const state = clipStateMap[clipId] || {}
      // Visual approval is the only reachable gate now — captions UI was
      // retired with Alex.
      if (state.visualApprovalStatus !== 'approved') {
        showToast('Approve the visual first', 'error')
        return
      }
      btn.disabled = true
      await markClipReady(clipId)
      btn.disabled = false
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
    'Write captions (Alex)': 'Writing your caption…', // legacy stage name — Alex retired, captions now written by the studio service
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
          cancelPolling() // SSE wins; tear down the fallback poll
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
          cancelPolling() // SSE delivered a definitive error; stop the fallback
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

  // Active poll handle so we can cancel in-flight loops when (a) a new
  // upload starts, (b) the user dismisses the processing card, or (c)
  // SSE confirms completion mid-poll. Without this, every upload spawned
  // its own self-perpetuating setTimeout chain and they accumulated —
  // 5 uploads in a row → 5 concurrent refreshClips loops hammering the API.
  let pollHandle = null
  let pollCancelled = false

  function cancelPolling() {
    pollCancelled = true
    if (pollHandle) { clearTimeout(pollHandle); pollHandle = null }
  }

  function pollUntilClipReady(uploadId, options) {
    // Cancel any prior poll before we start a new chain. One pipeline at
    // a time on the client side; the server can run as many as it likes.
    cancelPolling()
    pollCancelled = false

    const isRecovery = options?.recovery === true
    const fileCount = options?.fileCount ?? 1
    let attempts = 0
    const startIds = new Set(pendingClips.map(c => c.id))

    const progressSteps = [
      { at: 1,  pct: 22, phase: 'combine', label: 'Putting your clips together…', detail: '' },
      { at: 4,  pct: 50, phase: 'edit',    label: 'Picking the best moments…',    detail: '' },
      { at: 8,  pct: 70, phase: 'edit',    label: 'Editing your reel…',           detail: '' },
      { at: 15, pct: 82, phase: 'edit',    label: 'Still working on it…',         detail: '' },
      { at: 20, pct: 88, phase: 'edit',    label: 'Writing your caption…',        detail: '' },
      { at: 25, pct: 92, phase: 'edit',    label: 'Almost done…',                 detail: '' },
    ]

    const poll = async () => {
      if (pollCancelled) return
      attempts++
      await refreshClips()
      if (pollCancelled) return

      const hasNewClip = pendingClips.some(c => !startIds.has(c.id))
      if (hasNewClip) {
        cancelPolling()
        clearActiveJob()
        setPhase('done')
        setProgress(100, 'Done!', '')
        const titleText = fileCount > 1
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
      // along the server was when the connection dropped. Regular polls
      // top out at 5 min — well past the typical Riley pipeline.
      const maxAttempts = isRecovery ? 96 : 60
      if (attempts < maxAttempts) {
        pollHandle = setTimeout(poll, 5000)
      } else {
        // Definitive failure copy — recovery polls used to silently fade
        // out after 8 minutes leaving users wondering if their upload was
        // still cooking or had died. Now we say the upload didn't finish
        // and offer a Retry button on the processing card.
        cancelPolling()
        clearActiveJob()
        setPhase('upload')
        setProgress(progressTarget, 'Upload didn\'t finish', isRecovery
          ? 'We lost contact with your upload and never got it back. Refresh and try again.'
          : 'Your reel didn\'t come back from Riley in time. Try uploading again or use a shorter clip.')
        showToast('Upload didn\'t finish — try again', 'error')
      }
    }
    pollHandle = setTimeout(poll, 5000)
  }

  // ── Render ───────────────────────────────────────────────────────

  // ── Segment trim UI (Tier 2) ─────────────────────────────────────
  // Per-clip in-memory state. For each clip we track:
  //   - dropped: Set<number>          — indices marked for removal
  //   - trims:   Map<index, {start,end}> — user's current trim bounds
  // Both are cleared after a successful recut. Trims default to the
  // segment's original bounds (no-op) until the user drags a handle.
  const segmentEditState = new Map()

  function getEditState(clipId) {
    if (!segmentEditState.has(clipId)) {
      segmentEditState.set(clipId, { dropped: new Set(), trims: new Map(), order: null })
    }
    return segmentEditState.get(clipId)
  }
  // Backwards-compat helper used by older code paths (the toggle-drop
  // delegated handler). Returns the same Set as state.dropped.
  function getDroppedSet(clipId) { return getEditState(clipId).dropped }

  // Lazy-init / refresh the segment ordering. `order` is an array of
  // ORIGINAL segment indices in the user's chosen reel order. When the
  // user hasn't reordered, this is just [0, 1, ..., N-1]. When they
  // have, the array reflects the new sequence. We refresh whenever the
  // segment count changes (e.g. after a successful re-cut returns a
  // new segment list, or on first render of a clip).
  function getOrderedIndices(state, segmentCount) {
    if (!Array.isArray(state.order) || state.order.length !== segmentCount
        || state.order.some((v) => !Number.isInteger(v) || v < 0 || v >= segmentCount)) {
      state.order = Array.from({ length: segmentCount }, (_, i) => i)
    }
    return state.order
  }

  // Move a segment one slot up or down in the reel. No-op at the edges.
  function moveSegInOrder(state, segmentCount, segIdx, direction) {
    const order = getOrderedIndices(state, segmentCount)
    const pos = order.indexOf(segIdx)
    if (pos < 0) return false
    const newPos = direction === 'up' ? pos - 1 : pos + 1
    if (newPos < 0 || newPos >= order.length) return false
    const tmp = order[pos]
    order[pos] = order[newPos]
    order[newPos] = tmp
    return true
  }

  function getClipSegments(clip) {
    const adj = clip.adjustments || {}
    if (Array.isArray(clip.userEditedSegments) && clip.userEditedSegments.length > 0) return clip.userEditedSegments
    return Array.isArray(adj.segments) ? adj.segments : []
  }

  // Returns the current (possibly trimmed) bounds for a segment given the
  // user's in-memory edits. Pure read — does not mutate state.
  function effectiveSegmentBounds(state, segIdx, originalSeg) {
    const t = state.trims.get(segIdx)
    if (!t) return { startTime: originalSeg.startTime, endTime: originalSeg.endTime }
    return { startTime: t.startTime, endTime: t.endTime }
  }

  // Did the user actually trim this segment relative to Riley's original?
  function isSegmentTrimmed(state, segIdx, originalSeg) {
    const t = state.trims.get(segIdx)
    if (!t) return false
    return Math.abs(t.startTime - originalSeg.startTime) > 0.05
      || Math.abs(t.endTime - originalSeg.endTime) > 0.05
  }

  // Hard floor for any kept segment after trim. Mirrors the backend
  // 2.0s floor so the UI never lets you build an invalid recut.
  // Hard floor for any kept segment after trim. 1.0s is the absolute
  // shortest a segment can be — anything below that is a glitch frame
  // not a beat. Mirrored on the backend (studio.ts:recut handler).
  const MIN_TRIMMED_LEN = 1.0

  // ── Re-cut Studio (modal) ────────────────────────────────────────
  // The full-screen editor that opens when the user clicks "Re-cut" on
  // an approval card. Keeps the drop/trim logic but in a much larger
  // surface: video player on the left, segment list on the right (each
  // with thumbnail + drag-handle trim bar). Save commits to /recut.
  let recutModalClipId = null
  // Singleton modal element appended to <body>. Shown / hidden via
  // display:flex / display:none rather than create-and-destroy so the
  // video element doesn't reload its source every time.
  function ensureRecutModalRoot() {
    let root = document.getElementById('vx-recut-modal')
    if (root) return root
    root = document.createElement('div')
    root.id = 'vx-recut-modal'
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-modal', 'true')
    root.setAttribute('aria-label', 'Re-cut studio')
    root.style.cssText = 'display:none;position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.78);backdrop-filter:blur(6px);'
    root.innerHTML = `
      <div data-recut-card style="position:absolute;inset:24px;background:var(--bg);border:1px solid var(--b1);border-radius:14px;display:flex;flex-direction:column;overflow:hidden;color:var(--t1)">
        <header style="display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid var(--b1);flex-shrink:0">
          <div style="display:flex;align-items:baseline;gap:14px">
            <strong style="font-size:14px;letter-spacing:.02em">Re-cut studio</strong>
            <span data-recut-subtitle style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--t3);letter-spacing:.04em"></span>
          </div>
          <button type="button" data-studio-action="close-recut-studio" style="background:none;border:1px solid var(--b1);color:var(--t2);padding:6px 12px;font-size:11px;border-radius:6px;cursor:pointer;font-family:inherit">Close</button>
        </header>
        <div style="flex:1;display:grid;grid-template-columns:minmax(280px, 380px) 1fr;gap:0;min-height:0">
          <div style="padding:20px;border-right:1px solid var(--b1);display:flex;flex-direction:column;gap:14px;overflow:auto">
            <div data-recut-video-wrap style="background:#000;border-radius:10px;overflow:hidden;aspect-ratio:9/16;display:flex;align-items:center;justify-content:center;position:relative">
              <video data-recut-video playsinline preload="auto" style="width:100%;height:100%;object-fit:contain;background:#000"></video>
              <!-- Virtual segment-marker overlay: tiny chip in the corner showing which segment the player is currently showing in the virtual reel timeline. -->
              <div data-recut-seg-chip style="position:absolute;top:12px;left:12px;background:rgba(0,0,0,.7);color:#fff;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;letter-spacing:.06em;padding:6px 10px;border-radius:6px;pointer-events:none;backdrop-filter:blur(6px);display:none;box-shadow:0 2px 8px rgba(0,0,0,.4)">SEG 1 · 0.0s / 0.0s</div>
            </div>
            <!-- Custom transport — drives the virtual reel, not the source video. -->
            <div data-recut-transport style="display:flex;align-items:center;gap:10px;padding:6px 0">
              <button type="button" data-studio-action="virt-toggle-play" style="background:var(--accent);color:var(--accent-text,#000);border:none;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0" aria-label="Play / pause virtual reel">
                <svg data-virt-icon-play viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                <svg data-virt-icon-pause viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="display:none"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>
              </button>
              <div data-recut-virt-scrubber data-state="idle" style="flex:1;position:relative;height:6px;background:var(--b1);border-radius:3px;cursor:pointer">
                <!-- Per-segment ticks let the user see where each cut lives in the reel timeline. Filled in on render. -->
                <div data-virt-segments style="position:absolute;inset:0;display:flex;gap:2px;border-radius:3px;overflow:hidden"></div>
                <div data-virt-progress style="position:absolute;left:0;top:0;bottom:0;width:0%;background:var(--accent);border-radius:3px;pointer-events:none;transition:width 80ms linear"></div>
              </div>
              <div data-recut-virt-time style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--t2);min-width:78px;text-align:right">0:00 / 0:00</div>
            </div>
            <div data-recut-summary style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--t2);line-height:1.6;letter-spacing:.04em"></div>
          </div>
          <div style="display:flex;flex-direction:column;min-height:0">
            <div style="padding:14px 20px;border-bottom:1px solid var(--b1);font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.04em;color:var(--t3);flex-shrink:0">
              Click a thumbnail to drop · drag the bar handles to trim
            </div>
            <div data-recut-segment-list style="flex:1;overflow:auto;padding:14px 20px;display:flex;flex-direction:column;gap:10px"></div>
          </div>
        </div>
        <footer style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-top:1px solid var(--b1);flex-shrink:0">
          <button type="button" class="btn" style="padding:8px 14px;font-size:11px;cursor:pointer" data-studio-action="reset-drops" data-clip-id="">Reset edits</button>
          <span style="flex:1"></span>
          <button type="button" class="btn" style="padding:8px 14px;font-size:11px;cursor:pointer" data-studio-action="close-recut-studio">Cancel</button>
          <button type="button" class="btn-fill" style="padding:8px 18px;font-size:11px;cursor:pointer" data-studio-action="recut" data-clip-id="">Save re-cut</button>
        </footer>
      </div>`
    document.body.appendChild(root)
    // ESC closes the modal (keyboard escape hatch — important for
    // accessibility and matches user expectation for any modal UI).
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && recutModalClipId) closeRecutStudio()
    })
    // Click on the dim backdrop (but not the card) closes too.
    root.addEventListener('click', (e) => {
      if (e.target === root) closeRecutStudio()
    })
    return root
  }

  async function openRecutStudio(clipId) {
    const clip = pendingClips.find((c) => c.id === clipId)
    if (!clip) return
    const segments = getClipSegments(clip)
    if (segments.length < 2) {
      showToast('This clip has only one segment — nothing to re-cut', 'info')
      return
    }
    recutModalClipId = clipId
    const root = ensureRecutModalRoot()
    // Backfill thumbnails on demand for older clips that were processed
    // before the per-segment thumbnail step shipped. Fire-and-forget;
    // when the response lands we patch the in-memory clip and re-render
    // so the camera-emoji placeholders swap to real frames.
    const hasThumbs = Array.isArray(clip.segmentThumbnailUrls) && clip.segmentThumbnailUrls.some(Boolean)
    if (!hasThumbs) {
      ;(async () => {
        try {
          const r = await fetch(`${API}/api/studio/clip/${clipId}/backfill-thumbs`, {
            method: 'POST',
            credentials: 'include',
          })
          if (!r.ok) return
          const json = await r.json()
          const urls = Array.isArray(json.segmentThumbnailUrls) ? json.segmentThumbnailUrls : []
          if (urls.length > 0) {
            const idx = pendingClips.findIndex((c) => c.id === clipId)
            if (idx >= 0) pendingClips[idx].segmentThumbnailUrls = urls
            // Only re-render if the modal is still open on this clip
            if (recutModalClipId === clipId) rerenderRecutModalBody()
          }
        } catch (err) {
          console.warn('[studio] thumb backfill failed:', err?.message)
        }
      })()
    }
    // Update the data-clip-id on the action buttons so delegated
    // handlers know which clip we're editing.
    root.querySelectorAll('[data-studio-action="recut"]').forEach((b) => b.setAttribute('data-clip-id', clipId))
    root.querySelectorAll('[data-studio-action="reset-drops"]').forEach((b) => b.setAttribute('data-clip-id', clipId))
    // Wire the video element to the SOURCE video (not the edited reel)
    // so segment timestamps map onto the player. The user is editing
    // against the original footage; showing the cut reel would mean
    // the "5s start" of segment 1 lands on whatever's at 5s of the
    // pre-cut output, which is meaningless.
    const v = root.querySelector('[data-recut-video]')
    if (v) {
      const src = clip.sourceVideoUrl || clip.clippedUrl || ''
      if (v.getAttribute('src') !== src) v.setAttribute('src', src)
      // Default seek to first segment's start so the user sees content
      // immediately, not the very-first frame of the source (which is
      // often dead lead-in).
      const firstSeg = segments[0]
      if (firstSeg && Number.isFinite(firstSeg.startTime)) {
        const seek = () => { try { v.currentTime = firstSeg.startTime } catch {} }
        if (v.readyState >= 1) seek()
        else v.addEventListener('loadedmetadata', seek, { once: true })
      }
    }
    // Subtitle: "12 segments · 24.0s total"
    const subtitle = root.querySelector('[data-recut-subtitle]')
    if (subtitle) {
      const totalLen = segments.reduce((sum, s) => sum + (s.endTime - s.startTime), 0)
      subtitle.textContent = `${segments.length} segments · ${totalLen.toFixed(1)}s`
    }
    rerenderRecutModalBody()
    // Body lock prevents the underlying page from scrolling while the
    // modal is up.
    document.body.style.overflow = 'hidden'
    root.style.display = 'block'
    // Focus the close button so keyboard users land somewhere useful.
    requestAnimationFrame(() => {
      const closeBtn = root.querySelector('[data-studio-action="close-recut-studio"]')
      closeBtn?.focus()
    })
  }

  // Seek the modal's video player to the given source timestamp.
  // Pauses first so the player's currentTime change doesn't fight
  // active playback. Caller decides whether to resume.
  function seekModalPlayer(timeSec) {
    const root = document.getElementById('vx-recut-modal')
    if (!root) return
    const v = root.querySelector('[data-recut-video]')
    if (!v) return
    if (!Number.isFinite(timeSec)) return
    try {
      // If the source isn't ready yet, queue the seek.
      if (v.readyState < 1) {
        v.addEventListener('loadedmetadata', () => { try { v.currentTime = timeSec } catch {} }, { once: true })
      } else {
        v.currentTime = timeSec
      }
    } catch {}
  }

  // ── Virtual reel player ──────────────────────────────────────────
  // Treats the modal's <video> element as a backing store for an
  // imaginary reel composed of just the user's kept segments. The
  // virtual player advances "reel time" instead of "source time", and
  // jumps the source's currentTime between segment boundaries so what
  // the user sees IS the edited reel — not the original.
  //
  // virtualState lifecycle:
  //   - rebuilt every time rerenderRecutModalBody() runs
  //   - playing flag flips on transport play/pause
  //   - segIdx + reelTime advance via the source's `timeupdate`
  //
  // Backwards-compat shim: clearPreviewStop() is still called from a
  // few places (close, drag, scrub click); now it just pauses the
  // virtual player.
  let virtualState = null
  let virtualTimeupdateHandler = null

  // Build an ordered list of {segIdx, sourceStart, sourceEnd, reelStart, reelEnd}
  // representing the virtual reel based on the user's current edits.
  // segIdx points back into the original `segments` array so callers
  // can map a "preview this segment" click to the right reel offset.
  function buildVirtualTimeline(clip, state) {
    const segments = getClipSegments(clip)
    const order = getOrderedIndices(state, segments.length)
    const items = []
    let reelCursor = 0
    for (const i of order) {
      if (state.dropped.has(i)) continue
      const b = effectiveSegmentBounds(state, i, segments[i])
      const len = Math.max(0, b.endTime - b.startTime)
      if (len <= 0) continue
      items.push({
        segIdx: i,
        sourceStart: b.startTime,
        sourceEnd: b.endTime,
        reelStart: reelCursor,
        reelEnd: reelCursor + len,
        len,
      })
      reelCursor += len
    }
    return { items, total: reelCursor }
  }

  // Convert a reel timestamp into the segment + source time it maps to.
  // Returns null if the reel is empty.
  function reelTimeToSource(timeline, reelTime) {
    if (!timeline.items.length) return null
    const t = Math.max(0, Math.min(timeline.total, reelTime))
    for (const item of timeline.items) {
      if (t >= item.reelStart && t <= item.reelEnd + 0.001) {
        const offset = t - item.reelStart
        return {
          segIdx: item.segIdx,
          sourceTime: item.sourceStart + offset,
          item,
        }
      }
    }
    // Past the end — clamp to the last segment's end frame.
    const last = timeline.items[timeline.items.length - 1]
    return { segIdx: last.segIdx, sourceTime: last.sourceEnd, item: last }
  }

  // Convert a source-video timestamp back into reel time. Used when
  // the source's currentTime drifts past a segment boundary so we
  // know we should jump to the next segment.
  function sourceTimeToReel(timeline, sourceTime) {
    for (const item of timeline.items) {
      if (sourceTime >= item.sourceStart - 0.05 && sourceTime <= item.sourceEnd + 0.05) {
        const offset = sourceTime - item.sourceStart
        return { item, reelTime: item.reelStart + Math.max(0, offset) }
      }
    }
    return null
  }

  function getVirtualPlayerEls() {
    const root = document.getElementById('vx-recut-modal')
    if (!root) return null
    return {
      root,
      video: root.querySelector('[data-recut-video]'),
      progress: root.querySelector('[data-virt-progress]'),
      timeLabel: root.querySelector('[data-recut-virt-time]'),
      iconPlay: root.querySelector('[data-virt-icon-play]'),
      iconPause: root.querySelector('[data-virt-icon-pause]'),
      segments: root.querySelector('[data-virt-segments]'),
      scrubber: root.querySelector('[data-recut-virt-scrubber]'),
      chip: root.querySelector('[data-recut-seg-chip]'),
    }
  }

  function fmtReelTime(s) {
    if (!Number.isFinite(s) || s < 0) s = 0
    const mins = Math.floor(s / 60)
    const secs = Math.floor(s % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // Render the per-segment chips that sit behind the scrubber. Each
  // chip's flex-basis is proportional to its segment length so the
  // scrubber visually maps onto the reel timeline.
  function renderVirtualSegmentTicks() {
    if (!virtualState) return
    const els = getVirtualPlayerEls()
    if (!els?.segments) return
    const total = virtualState.timeline.total
    if (total <= 0) { els.segments.innerHTML = ''; return }
    els.segments.innerHTML = virtualState.timeline.items.map((it, idx) => {
      const widthPct = (it.len / total) * 100
      const isLast = idx === virtualState.timeline.items.length - 1
      const border = isLast ? '' : 'border-right:1px solid rgba(0,0,0,.4)'
      return `<div style="flex:0 0 ${widthPct}%;background:rgba(255,255,255,.06);${border}"></div>`
    }).join('')
  }

  function updateVirtualUI() {
    if (!virtualState) return
    const els = getVirtualPlayerEls()
    if (!els) return
    const t = virtualState.reelTime
    const total = virtualState.timeline.total
    if (els.progress) els.progress.style.width = total > 0 ? `${(t / total) * 100}%` : '0%'
    if (els.timeLabel) els.timeLabel.textContent = `${fmtReelTime(t)} / ${fmtReelTime(total)}`
    if (els.iconPlay) els.iconPlay.style.display = virtualState.playing ? 'none' : 'block'
    if (els.iconPause) els.iconPause.style.display = virtualState.playing ? 'block' : 'none'
    const cur = reelTimeToSource(virtualState.timeline, t)
    if (els.chip) {
      if (cur) {
        els.chip.textContent = `SEG ${cur.segIdx + 1}/${getClipSegments(pendingClips.find((c) => c.id === recutModalClipId)).length} · ${fmtReelTime(t)} / ${fmtReelTime(total)}`
        els.chip.style.display = 'block'
      } else {
        els.chip.style.display = 'none'
      }
    }
    // Active-segment indicator: highlight the row whose segIdx matches
    // the current playhead. Cheap DOM-only update — no full re-render
    // needed, just toggle a data attribute on each row.
    //
    // Loop override: when a segment is being looped (preview play),
    // pin the highlight to the LOOPED segment regardless of where
    // currentTime currently resolves. During trim drags the source's
    // currentTime can briefly land in a neighbor's range (because
    // segments share source timestamps when trimmed), and we don't
    // want the highlight to flicker to that neighbor.
    const activeIdx = virtualState.loopReelRange
      ? virtualState.loopReelRange.segIdx
      : cur?.segIdx
    const rows = els.root.querySelectorAll('[data-seg-row]')
    let activatedRow = null
    rows.forEach((row) => {
      const idx = parseInt(row.getAttribute('data-seg-idx') || '-1', 10)
      const isActive = idx === activeIdx && virtualState.playing
      const wasActive = row.getAttribute('data-active') === 'true'
      if (isActive) {
        row.setAttribute('data-active', 'true')
        row.style.boxShadow = '0 0 0 2px var(--accent), 0 4px 16px rgba(212,165,116,.25)'
        if (!wasActive) activatedRow = row // newly activated this frame
      } else {
        row.removeAttribute('data-active')
        row.style.boxShadow = ''
      }
    })
    // Auto-scroll the newly-active row into view when the playhead
    // moves to a NEW segment. Doesn't re-scroll on every tick (the
    // row was already active last frame), so the user can scroll
    // freely while a segment plays without getting yanked back.
    if (activatedRow) {
      try { activatedRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) } catch {}
    }
  }

  function detachVirtualTimeupdate() {
    const els = getVirtualPlayerEls()
    if (els?.video && virtualTimeupdateHandler) {
      els.video.removeEventListener('timeupdate', virtualTimeupdateHandler)
    }
    virtualTimeupdateHandler = null
  }

  function attachVirtualTimeupdate() {
    detachVirtualTimeupdate()
    const els = getVirtualPlayerEls()
    if (!els?.video) return
    virtualTimeupdateHandler = () => {
      if (!virtualState) return
      const v = els.video
      // While the user is actively dragging a trim handle, we stay out
      // of currentTime entirely. The drag-move handler is the
      // authority on where the playhead lives during a drag — letting
      // the loop guard fire too would cause the source to jitter
      // back-and-forth between the drag's seek and the loop's snap.
      if (dragState) return
      // ── Loop guard FIRST ─────────────────────────────────────────
      // When the user has clicked a segment's play button, we loop
      // [loop.sourceStart, loop.sourceEnd] no matter what. This check
      // runs BEFORE the timeline lookup because timeupdate fires at
      // 4-66Hz — between ticks, currentTime can leap past the trim
      // boundary into Riley's pre-trim "fat" range, where
      // sourceTimeToReel would return null and the handler would exit
      // without ever snapping back. Using loop bounds directly (not
      // the timeline item) means a leak gets corrected immediately.
      const loop = virtualState.loopReelRange
      if (loop) {
        // Crossed the trimmed end? Snap back to trimmed start.
        if (v.currentTime >= loop.sourceEnd - 0.03) {
          try { v.currentTime = loop.sourceStart } catch {}
          virtualState.reelTime = loop.start
          updateVirtualUI()
          return
        }
        // Wandered before the trimmed start (shouldn't happen during
        // normal play, but covers edge cases like the user manually
        // seeking the source <video> via keyboard). Pull forward.
        if (v.currentTime < loop.sourceStart - 0.05) {
          try { v.currentTime = loop.sourceStart } catch {}
          virtualState.reelTime = loop.start
          updateVirtualUI()
          return
        }
      }
      let cur = sourceTimeToReel(virtualState.timeline, v.currentTime)
      // ── Leap recovery ────────────────────────────────────────────
      // If currentTime ended up between segments (in a Riley gap, or
      // past the last segment), it means a tick fired while the source
      // was streaming through trimmed-out / dropped footage. Find the
      // FIRST kept item whose sourceStart is at or past currentTime
      // and snap there. Without this, the source plays continuously
      // through original content the user didn't keep.
      if (!cur && virtualState.playing) {
        const items = virtualState.timeline.items
        if (items.length === 0) return
        const next = items.find((it) => it.sourceStart >= v.currentTime - 0.05)
        if (next) {
          virtualState.reelTime = next.reelStart
          try { v.currentTime = next.sourceStart } catch {}
          updateVirtualUI()
          return
        }
        // Past the very last segment — pause at reel total.
        const last = items[items.length - 1]
        virtualState.reelTime = virtualState.timeline.total
        virtualState.playing = false
        try { v.pause() } catch {}
        try { v.currentTime = last.sourceEnd } catch {}
        updateVirtualUI()
        return
      }
      if (!cur) return
      const item = cur.item
      // Single-segment preview mode: pause at the user-set reel
      // checkpoint (the segment's reelEnd) instead of auto-advancing.
      const stopAt = virtualState.stopAtReelTime
      if (stopAt != null && cur.reelTime >= stopAt - 0.03) {
        virtualState.reelTime = stopAt
        virtualState.playing = false
        virtualState.stopAtReelTime = null
        try { v.pause() } catch {}
        try { v.currentTime = item.sourceEnd } catch {}
        updateVirtualUI()
        return
      }
      // Past this segment's end → jump to the next one (or stop on last)
      if (v.currentTime >= item.sourceEnd - 0.03) {
        const items = virtualState.timeline.items
        const here = items.indexOf(item)
        const next = items[here + 1]
        if (next) {
          virtualState.reelTime = next.reelStart
          try { v.currentTime = next.sourceStart } catch {}
        } else {
          // End of reel — pause and snap to total
          virtualState.reelTime = virtualState.timeline.total
          virtualState.playing = false
          try { v.pause() } catch {}
          try { v.currentTime = item.sourceEnd } catch {}
        }
        updateVirtualUI()
        return
      }
      virtualState.reelTime = cur.reelTime
      updateVirtualUI()
    }
    els.video.addEventListener('timeupdate', virtualTimeupdateHandler)
  }

  // Rebuild virtualState from the current edit state. Called after every
  // drop / trim / extend so the virtual reel stays in sync.
  function rebuildVirtualPlayer() {
    if (!recutModalClipId) {
      virtualState = null
      detachVirtualTimeupdate()
      return
    }
    const clip = pendingClips.find((c) => c.id === recutModalClipId)
    if (!clip) return
    const state = getEditState(clip.id)
    const timeline = buildVirtualTimeline(clip, state)
    // Preserve playing state + active loop across rebuilds. The loop's
    // reel/source bounds need refreshing because the user just edited
    // the segment they're previewing — the timeline item now has new
    // sourceStart/sourceEnd values that the loop should follow.
    const wasPlaying = virtualState?.playing ?? false
    const prevReel = virtualState?.reelTime ?? 0
    let nextLoop = null
    if (virtualState?.loopReelRange) {
      const refreshed = timeline.items.find((it) => it.segIdx === virtualState.loopReelRange.segIdx)
      if (refreshed) {
        nextLoop = {
          start: refreshed.reelStart,
          end: refreshed.reelEnd,
          sourceStart: refreshed.sourceStart,
          sourceEnd: refreshed.sourceEnd,
          segIdx: refreshed.segIdx,
        }
      }
    }
    virtualState = {
      timeline,
      reelTime: Math.min(prevReel, timeline.total),
      playing: wasPlaying && timeline.total > 0,
      loopReelRange: nextLoop,
      stopAtReelTime: null,
    }
    renderVirtualSegmentTicks()
    attachVirtualTimeupdate()
    // Sync the source video's currentTime to whatever the new reelTime
    // maps to — without this, after dropping a segment the video would
    // still be parked at the old timestamp.
    const els = getVirtualPlayerEls()
    if (els?.video && timeline.items.length > 0) {
      const cur = reelTimeToSource(timeline, virtualState.reelTime)
      if (cur) {
        const v = els.video
        try {
          if (Math.abs(v.currentTime - cur.sourceTime) > 0.05) v.currentTime = cur.sourceTime
        } catch {}
      }
    }
    updateVirtualUI()
  }

  function virtualPlay() {
    if (!virtualState || virtualState.timeline.total === 0) return
    const els = getVirtualPlayerEls()
    if (!els?.video) return
    virtualState.playing = true
    // Compute the source time we want to be at, then seek THEN play.
    // Without an explicit seek-then-play sequence, the video may be
    // mid-stream (e.g. at currentTime=0 or wherever the user left it
    // last) and play() would resume from that source position —
    // outside any kept segment, which means the user sees original
    // footage until the next timeupdate's leap recovery kicks in.
    let targetSource
    if (virtualState.reelTime >= virtualState.timeline.total - 0.05) {
      virtualState.reelTime = 0
      targetSource = virtualState.timeline.items[0].sourceStart
    } else {
      const cur = reelTimeToSource(virtualState.timeline, virtualState.reelTime)
      targetSource = cur ? cur.sourceTime : virtualState.timeline.items[0].sourceStart
    }
    try { els.video.currentTime = targetSource } catch {}
    // If the source isn't ready to seek yet, defer the play call.
    if (els.video.readyState >= 1) {
      try { els.video.play() } catch {}
    } else {
      els.video.addEventListener('loadedmetadata', () => {
        try { els.video.currentTime = targetSource } catch {}
        try { els.video.play() } catch {}
      }, { once: true })
    }
    updateVirtualUI()
  }

  function virtualPause() {
    if (!virtualState) return
    const els = getVirtualPlayerEls()
    virtualState.playing = false
    try { els?.video?.pause() } catch {}
    updateVirtualUI()
  }

  function virtualSeekToReelTime(reelTime) {
    if (!virtualState || virtualState.timeline.total === 0) return
    const cur = reelTimeToSource(virtualState.timeline, reelTime)
    if (!cur) return
    virtualState.reelTime = reelTime
    const els = getVirtualPlayerEls()
    if (els?.video) try { els.video.currentTime = cur.sourceTime } catch {}
    updateVirtualUI()
  }

  // Backwards-compat shim. Older code paths still call this; in the
  // virtual-player world it just pauses without breaking anything.
  function clearPreviewStop() {
    // Clearing the single-segment loop here means dragging a handle,
    // scrubbing the bar, or hitting cancel/transport all exit loop
    // mode immediately. Then pause so the user isn't surprised by
    // background audio while they edit.
    clearVirtualLoop()
    virtualPause()
  }

  // Click-thumbnail-or-row handler: jump the virtual reel to the
  // start of THIS segment and play. The virtual player automatically
  // stops at the trimmed end of every segment because it advances by
  // reel time, not source time — when reel time hits this segment's
  // reelEnd, the timeupdate handler jumps to the NEXT segment. From
  // a "preview just this segment" perspective, that's the right
  // behavior: the user sees what their cut delivers in context.
  // Single-segment preview LOOP: clicking a segment's play button
  // loops [reelStart, reelEnd] forever until the user clicks elsewhere
  // (transport button, scrubber, another segment, or the bar).
  // The timeupdate handler watches `loopReelRange` and snaps
  // currentTime back to the loop's start every time it crosses the end.
  function previewSegmentInModal(clipId, segIdx) {
    if (recutModalClipId !== clipId) return
    if (!virtualState) return
    const item = virtualState.timeline.items.find((it) => it.segIdx === segIdx)
    if (!item) return
    virtualState.loopReelRange = { start: item.reelStart, end: item.reelEnd, sourceStart: item.sourceStart, sourceEnd: item.sourceEnd, segIdx }
    virtualState.stopAtReelTime = null
    virtualSeekToReelTime(item.reelStart)
    virtualPlay()
  }
  function clearVirtualLoop() {
    if (virtualState) virtualState.loopReelRange = null
  }

  function closeRecutStudio() {
    const root = document.getElementById('vx-recut-modal')
    if (!root) return
    root.style.display = 'none'
    document.body.style.overflow = ''
    recutModalClipId = null
    // Pause + tear down the virtual player so a future re-open starts
    // from a clean slate (and we don't leak the timeupdate listener).
    detachVirtualTimeupdate()
    virtualState = null
    const v = root.querySelector('[data-recut-video]')
    try { v?.pause?.() } catch {}
  }

  // For each segment, compute how far its handles can travel to extend.
  // The bar's underlying scale represents [extendStart, extendEnd] which
  // INCLUDES Riley's window plus any room left over before the previous
  // segment ends / after the next segment starts / before source EOF.
  function computeSegmentRange(clip, segIdx, state) {
    const segments = getClipSegments(clip)
    const seg = segments[segIdx]
    const sourceDur = typeof clip.sourceDuration === 'number' && clip.sourceDuration > 0
      ? clip.sourceDuration
      : null
    // Walk neighbors that aren't dropped (dropped segments are gone, so
    // an extension can swallow their original time slot).
    let prevEnd = 0
    for (let k = segIdx - 1; k >= 0; k--) {
      if (state.dropped.has(k)) continue
      const pb = effectiveSegmentBounds(state, k, segments[k])
      prevEnd = pb.endTime
      break
    }
    let nextStart = sourceDur ?? Number.POSITIVE_INFINITY
    for (let k = segIdx + 1; k < segments.length; k++) {
      if (state.dropped.has(k)) continue
      const nb = effectiveSegmentBounds(state, k, segments[k])
      nextStart = nb.startTime
      break
    }
    // Allow up to 4s of extension on each side beyond Riley's window
    // (capped by neighbors + source). Limits keep the bar usable —
    // unbounded extension would make the drag scale tiny.
    const MAX_EXTEND = 4.0
    const extendStart = Math.max(0, prevEnd, seg.startTime - MAX_EXTEND)
    const extendEnd = Math.min(
      sourceDur ?? (seg.endTime + MAX_EXTEND),
      nextStart,
      seg.endTime + MAX_EXTEND,
    )
    return { extendStart, extendEnd, seg }
  }

  // Build a single segment row: thumbnail on the left, trim bar +
  // metadata on the right. One row per segment. Used inside the modal.
  // displayPos = position in the reel order (0-indexed); totalCount =
  // total segments in the reel. Used to render position and arrow
  // enable/disable state.
  function renderRecutSegmentRow(clip, seg, i, state, displayPos, totalCount) {
    const isDropped = state.dropped.has(i)
    const bounds = effectiveSegmentBounds(state, i, seg)
    const origLen = seg.endTime - seg.startTime
    const curLen = bounds.endTime - bounds.startTime
    const isTrimmed = !isDropped && isSegmentTrimmed(state, i, seg)
    const isExtended = !isDropped && curLen > origLen + 0.05
    const isShortened = !isDropped && isTrimmed && !isExtended
    const thumbs = Array.isArray(clip.segmentThumbnailUrls) ? clip.segmentThumbnailUrls : []
    const thumbUrl = thumbs[i] || null
    const energy = String(seg.energy || 'medium')
    const energyDot = energy === 'hook' ? 'var(--accent)' : energy === 'high' ? 'var(--ok)' : 'var(--t3)'

    // Bar scale = wider [extendStart, extendEnd] so handles can pull
    // past Riley's window. Riley's pick is rendered as a brighter
    // band on the SAME image so the timeline reads as one continuous
    // strip instead of two abstract zones.
    const range = computeSegmentRange(clip, i, state)
    const span = range.extendEnd - range.extendStart
    const safeSpan = span > 0 ? span : 1
    const pctOf = (t) => ((t - range.extendStart) / safeSpan) * 100
    const startPct = pctOf(bounds.startTime)
    const endPct = pctOf(bounds.endTime)
    const rileyStartPct = pctOf(seg.startTime)
    const rileyEndPct = pctOf(seg.endTime)
    const keptW = Math.max(0, endPct - startPct)

    const stroke = isDropped
      ? 'rgba(196,138,138,.7)'
      : isExtended ? 'var(--ok)'
      : isShortened ? 'var(--accent)' : 'var(--b1)'
    const opacity = isDropped ? '0.45' : '1'

    // Length label states: extended / trimmed / unchanged
    const lenLabel = isExtended
      ? `<span style="color:var(--ok);font-weight:600">${curLen.toFixed(2)}s</span> <span style="color:var(--t3);margin-left:6px">+${(curLen - origLen).toFixed(2)}s</span>`
      : isShortened
        ? `<span style="color:var(--accent);font-weight:600">${curLen.toFixed(2)}s</span> <span style="color:var(--t3);text-decoration:line-through;margin-left:6px">${origLen.toFixed(2)}s</span>`
        : `<span style="color:var(--t1);font-weight:500">${curLen.toFixed(2)}s</span>`
    const labelText = String(seg.label || `Segment ${i + 1}`).slice(0, 80)

    // The filmstrip — actual segment thumbnail tiled across the bar
    // background. Three identical copies span the trim range so the
    // user sees frames behind both the "kept" amber band and the
    // "extend zones" outside it. Trim zones are darkened with an
    // overlay rather than hidden, so the user knows what's available.
    const filmstripBg = thumbUrl
      ? `background-image:url('${thumbUrl}'),url('${thumbUrl}'),url('${thumbUrl}');background-repeat:no-repeat;background-size:33.34% 100%, 33.34% 100%, 33.34% 100%;background-position:0% center, 50% center, 100% center;`
      : 'background:var(--b1);'

    // Render Riley-window markers as bracket lines on the bar so the
    // user can distinguish "Riley's pick" from "extension".
    const rileyMarker = `
      <div style="position:absolute;top:0;bottom:0;left:${rileyStartPct}%;width:0;border-left:2px dashed rgba(212,165,116,.55);pointer-events:none" title="Riley's start"></div>
      <div style="position:absolute;top:0;bottom:0;left:${rileyEndPct}%;width:0;border-left:2px dashed rgba(212,165,116,.55);pointer-events:none" title="Riley's end"></div>`

    const droppedBanner = isDropped
      ? `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(196,138,138,.5);color:#fff;font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;border-radius:6px;pointer-events:none">DROPPED</div>`
      : ''

    // Filmstrip + handles. Time labels under the bar mark the kept
    // bounds (start / end) so the user knows what timestamps the
    // segment occupies in the source.
    const trimBar = `
      <div style="position:relative">
        <div data-trim-track
          style="position:relative;height:64px;border-radius:6px;overflow:hidden;${filmstripBg};${isDropped ? 'filter:grayscale(.6) brightness(.4);' : ''}"
          data-clip-id="${clip.id}" data-seg-idx="${i}"
          data-orig-start="${seg.startTime}" data-orig-end="${seg.endTime}"
          data-extend-start="${range.extendStart}" data-extend-end="${range.extendEnd}">
          <div data-trim-shaded-left style="position:absolute;top:0;bottom:0;left:0;width:${startPct}%;background:rgba(0,0,0,.62);pointer-events:none"></div>
          <div data-trim-shaded-right style="position:absolute;top:0;bottom:0;right:0;width:${100 - endPct}%;background:rgba(0,0,0,.62);pointer-events:none"></div>
          <div data-trim-kept style="position:absolute;top:0;bottom:0;left:${startPct}%;width:${keptW}%;border-top:2px solid var(--accent);border-bottom:2px solid var(--accent);box-shadow:inset 0 0 0 1px rgba(212,165,116,.18);pointer-events:none"></div>
          ${isDropped ? '' : `<div data-trim-handle="move" style="position:absolute;top:0;bottom:0;left:${startPct}%;width:${keptW}%;cursor:grab;background:rgba(212,165,116,.05)" title="Drag to slide this kept window earlier or later in the source"></div>`}
          ${rileyMarker}
          ${droppedBanner}
          ${isDropped ? '' : `<div data-trim-handle="start" style="position:absolute;top:-3px;bottom:-3px;left:calc(${startPct}% - 7px);width:14px;background:var(--accent);border-radius:3px;cursor:ew-resize;box-shadow:0 0 0 2px var(--bg),0 2px 6px rgba(0,0,0,.5)" title="Drag to trim or extend the start"></div>`}
          ${isDropped ? '' : `<div data-trim-handle="end" style="position:absolute;top:-3px;bottom:-3px;left:calc(${endPct}% - 7px);width:14px;background:var(--accent);border-radius:3px;cursor:ew-resize;box-shadow:0 0 0 2px var(--bg),0 2px 6px rgba(0,0,0,.5)" title="Drag to trim or extend the end"></div>`}
        </div>
        ${isDropped ? '' : `
          <div style="display:flex;justify-content:space-between;font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--t3);letter-spacing:.04em;margin-top:4px">
            <span>${bounds.startTime.toFixed(2)}s</span>
            <span style="color:var(--t2)">▶ click bar to preview</span>
            <span>${bounds.endTime.toFixed(2)}s</span>
          </div>`}
      </div>`

    // Action button row — top right of the row. Drop is now an
    // explicit X button (not a thumbnail click) so clicking the
    // thumbnail can be used for "preview this segment in the player".
    const dropBtnLabel = isDropped ? 'Restore' : 'Drop'
    const dropBtnStyle = isDropped
      ? 'background:rgba(159,179,138,.18);color:var(--ok);border:1px solid var(--ok)'
      : 'background:transparent;color:var(--t2);border:1px solid var(--b1)'
    const dropBtn = `
      <button type="button" data-studio-action="toggle-drop-seg" data-clip-id="${clip.id}" data-seg-idx="${i}"
        style="${dropBtnStyle};padding:5px 12px;font-size:10px;font-family:'JetBrains Mono',monospace;letter-spacing:.06em;text-transform:uppercase;border-radius:4px;cursor:pointer">${dropBtnLabel}</button>`

    // Drag handle on the left edge of the row — drag to reorder. Only
    // the grip is draggable=true; the row itself is not, so trim
    // pointerdowns don't accidentally fire native drag. Six-dot grip
    // is a familiar reorder affordance and stays compact.
    const gripIcon = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><circle cx="6" cy="3" r="1.4"/><circle cx="10" cy="3" r="1.4"/><circle cx="6" cy="8" r="1.4"/><circle cx="10" cy="8" r="1.4"/><circle cx="6" cy="13" r="1.4"/><circle cx="10" cy="13" r="1.4"/></svg>'
    const gripCell = `<div data-recut-grip draggable="true" data-clip-id="${clip.id}" data-seg-idx="${i}" title="Drag to reorder" style="grid-row:1 / span 2;display:flex;align-items:center;justify-content:center;color:var(--t3);cursor:grab;user-select:none;opacity:.7;transition:opacity .18s ease,color .18s ease" onmouseover="this.style.opacity='1';this.style.color='var(--t1)'" onmouseout="this.style.opacity='.7';this.style.color='var(--t3)'">${gripIcon}</div>`
    void totalCount  // total no longer needed; row gates itself via reorder drop logic

    // Tile thumbnail (clickable to preview segment in main player)
    const tileThumb = thumbUrl
      ? `<img src="${thumbUrl}" alt="segment ${i + 1}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block;pointer-events:none" />`
      : `<div style="width:100%;height:100%;background:var(--b1);display:flex;align-items:center;justify-content:center;color:var(--t3);font-size:18px;pointer-events:none">&#9836;</div>`

    // Play overlay sits on top of every segment thumbnail so the
    // affordance is unmistakable. Disabled state uses a faded triangle
    // — clicking still works, but the visual reads "this is a play
    // button, not a static image." Title attribute clarifies the
    // action for keyboard / screen-reader users.
    const playOverlay = `
      <div aria-hidden="true" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:linear-gradient(to bottom, rgba(0,0,0,0) 40%, rgba(0,0,0,.5) 100%);pointer-events:none;transition:background .18s ease">
        <div style="width:36px;height:36px;border-radius:50%;background:rgba(0,0,0,.55);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.4)">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="#fff" style="margin-left:2px"><path d="M8 5v14l11-7z"/></svg>
        </div>
      </div>`

    return `
      <div data-seg-row data-clip-id="${clip.id}" data-seg-idx="${i}"
        style="display:grid;grid-template-columns:24px 64px 1fr auto;column-gap:14px;row-gap:8px;align-items:start;padding:14px;border:1px solid ${stroke};border-radius:10px;background:var(--bg);opacity:${opacity};transition:opacity .18s ease,border-color .18s ease,box-shadow .12s ease">
        ${gripCell}
        <div data-studio-action="preview-seg" data-clip-id="${clip.id}" data-seg-idx="${i}"
          title="Click to preview this cut"
          style="grid-row:1 / span 2;position:relative;aspect-ratio:9/16;border-radius:6px;overflow:hidden;cursor:pointer;background:var(--b1)">${tileThumb}${isDropped ? '' : playOverlay}</div>
        <div style="min-width:0">
          <div style="display:flex;align-items:center;gap:8px;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.04em;color:var(--t3);text-transform:uppercase;line-height:1.3">
            <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${energyDot}"></span>
            <span>#${displayPos + 1} · ${energy}</span>
            <span style="margin-left:auto;font-size:11px;letter-spacing:.02em;text-transform:none">${lenLabel}</span>
          </div>
          <div style="font-size:13px;color:var(--t1);margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${labelText}">${labelText}</div>
        </div>
        <div style="grid-row:1;display:flex;align-items:flex-start;justify-content:flex-end">${dropBtn}</div>
        <div style="grid-column:3 / span 2">${trimBar}</div>
      </div>`
  }

  // Re-render only the modal body (segment list + summary + save button
  // state) without touching the outer chrome. Called every time the user
  // toggles a drop or finishes a trim drag.
  function rerenderRecutModalBody() {
    if (!recutModalClipId) return
    const root = document.getElementById('vx-recut-modal')
    if (!root) return
    const clip = pendingClips.find((c) => c.id === recutModalClipId)
    if (!clip) return
    const segments = getClipSegments(clip)
    const state = getEditState(clip.id)
    // Rebuild the virtual reel from the latest edit state so the
    // player + transport reflect the current cuts. Called BEFORE the
    // segment list re-render so segments and player share consistent
    // state.
    rebuildVirtualPlayer()

    const totalLen = segments.reduce((sum, s) => sum + (s.endTime - s.startTime), 0)
    let keepLen = 0
    let trimmedCount = 0
    let extendedCount = 0
    for (let i = 0; i < segments.length; i++) {
      if (state.dropped.has(i)) continue
      const b = effectiveSegmentBounds(state, i, segments[i])
      keepLen += b.endTime - b.startTime
      if (isSegmentTrimmed(state, i, segments[i])) {
        const orig = segments[i]
        const newLen = b.endTime - b.startTime
        const origLen = orig.endTime - orig.startTime
        if (newLen > origLen + 0.05) extendedCount++
        else trimmedCount++
      }
    }
    const keepCount = segments.length - state.dropped.size
    const orderForCheck = getOrderedIndices(state, segments.length)
    const isReordered = orderForCheck.some((v, idx) => v !== idx)
    const editsPending = state.dropped.size > 0 || trimmedCount > 0 || extendedCount > 0 || isReordered

    // Summary in left column
    const summary = root.querySelector('[data-recut-summary]')
    if (summary) {
      const lines = []
      lines.push(`<div><strong>${keepCount}</strong> of ${segments.length} segments kept</div>`)
      lines.push(`<div><strong>${keepLen.toFixed(1)}s</strong> of ${totalLen.toFixed(1)}s total</div>`)
      if (state.dropped.size > 0) lines.push(`<div style="color:rgba(196,138,138,.95)">${state.dropped.size} dropped</div>`)
      if (trimmedCount > 0) lines.push(`<div style="color:var(--accent)">${trimmedCount} trimmed</div>`)
      if (extendedCount > 0) lines.push(`<div style="color:var(--ok)">${extendedCount} extended</div>`)
      if (isReordered) lines.push(`<div style="color:var(--t1)">reordered</div>`)
      if (!editsPending) lines.push(`<div style="color:var(--t3)">No edits yet — click a thumbnail to preview, drag a handle to trim, or grab the dots to reorder</div>`)
      summary.innerHTML = lines.join('')
    }

    // Segment list in right column. Render in user-chosen reel order
    // (state.order), passing each row its display position so the
    // up/down arrows can disable correctly at the edges.
    const list = root.querySelector('[data-recut-segment-list]')
    if (list) {
      const order = getOrderedIndices(state, segments.length)
      list.innerHTML = order
        .map((origIdx, displayPos) => renderRecutSegmentRow(clip, segments[origIdx], origIdx, state, displayPos, order.length))
        .join('')
    }

    // Save button enable/disable + label
    const saveBtn = root.querySelector('[data-studio-action="recut"]')
    if (saveBtn) {
      const disabled = !editsPending || keepCount < 2
      saveBtn.disabled = disabled
      saveBtn.style.opacity = disabled ? '0.5' : '1'
      saveBtn.style.cursor = disabled ? 'not-allowed' : 'pointer'
      const editParts = []
      if (state.dropped.size > 0) editParts.push(`${state.dropped.size} dropped`)
      if (trimmedCount > 0) editParts.push(`${trimmedCount} trimmed`)
      if (extendedCount > 0) editParts.push(`${extendedCount} extended`)
      if (isReordered) editParts.push('reordered')
      saveBtn.textContent = !editsPending ? 'Save re-cut' : `Save · ${editParts.join(' · ')}`
    }
    // Reset button only enabled when there's something to reset
    const resetBtn = root.querySelector('[data-studio-action="reset-drops"]')
    if (resetBtn) {
      resetBtn.disabled = !editsPending
      resetBtn.style.opacity = editsPending ? '1' : '0.45'
      resetBtn.style.cursor = editsPending ? 'pointer' : 'not-allowed'
    }
  }

  // Backwards-compat shim — older code paths still call this. In modal
  // mode it just re-renders the modal body if it's open.
  function rerenderSegmentStrip(clipId) {
    if (recutModalClipId === clipId) rerenderRecutModalBody()
  }

  // ── Drag-handle wiring (Tier 2) ──────────────────────────────────
  // Single delegated pointerdown listener handles every trim handle on
  // the page. We attach a one-shot pointermove + pointerup pair on the
  // window so the drag continues even if the cursor leaves the handle's
  // hit area. State is held in `dragState` for the duration of one drag.
  let dragState = null
  function startTrimDrag(handleEl, e) {
    e.preventDefault()
    const track = handleEl.parentElement
    if (!track) return
    const clipId = track.dataset.clipId
    const segIdx = parseInt(track.dataset.segIdx, 10)
    // Editing-while-looping: if the user is dragging a handle on the
    // SAME segment they're previewing, keep the loop alive so they
    // see their trim/extend land in real time (rebuildVirtualPlayer
    // refreshes loop bounds after the drag commits). If they grab a
    // handle on a DIFFERENT segment, exit loop mode — they're done
    // with the preview and now editing somewhere else.
    if (
      virtualState?.loopReelRange &&
      virtualState.loopReelRange.segIdx !== segIdx
    ) {
      clearPreviewStop()
    } else if (!virtualState?.loopReelRange) {
      // No loop active — fall back to the original behavior of
      // pausing playback so it doesn't fight the drag-seek.
      clearPreviewStop()
    }
    const origStart = parseFloat(track.dataset.origStart)
    const origEnd = parseFloat(track.dataset.origEnd)
    // Wider window the bar's geometry uses — start/end can move
    // outside [origStart, origEnd] up to these bounds, which encode
    // neighbor + source-duration limits computed at render time.
    const extendStart = parseFloat(track.dataset.extendStart)
    const extendEnd = parseFloat(track.dataset.extendEnd)
    const which = handleEl.dataset.trimHandle // "start" | "end" | "move"
    const clip = pendingClips.find((c) => c.id === clipId)
    if (!clip || Number.isNaN(segIdx)) return
    const segs = getClipSegments(clip)
    const seg = segs[segIdx]
    if (!seg) return
    const state = getEditState(clipId)
    const cur = state.trims.get(segIdx) ?? { startTime: origStart, endTime: origEnd }

    const trackRect = track.getBoundingClientRect()
    dragState = {
      clipId,
      segIdx,
      which,
      origStart,
      origEnd,
      // Bar's underlying scale is [extendStart, extendEnd], NOT the
      // original window. Drag math interpolates over this range.
      extendStart,
      extendEnd,
      startTime: cur.startTime,
      endTime: cur.endTime,
      // For "move" drags we need the anchor pointer X + the kept
      // window's position at drag start so we can apply a delta to
      // both bounds simultaneously.
      anchorClientX: e.clientX,
      anchorStart: cur.startTime,
      anchorEnd: cur.endTime,
      trackLeft: trackRect.left,
      trackWidth: trackRect.width,
      track,
      moved: false,
    }
    // Visual feedback while sliding the whole window.
    if (which === 'move') {
      handleEl.style.cursor = 'grabbing'
    }
    handleEl.setPointerCapture?.(e.pointerId)
    window.addEventListener('pointermove', onTrimDragMove)
    window.addEventListener('pointerup', onTrimDragEnd, { once: true })
  }

  function onTrimDragMove(e) {
    if (!dragState) return
    dragState.moved = true
    const span = dragState.extendEnd - dragState.extendStart
    let nextStart = dragState.startTime
    let nextEnd = dragState.endTime
    if (dragState.which === 'move') {
      // Slide the whole kept window. Convert the pointer's pixel
      // delta into a time delta, then translate both bounds together —
      // clamped so the window stays inside [extendStart, extendEnd]
      // (i.e. you can't slide past neighbors / source EOF).
      const dxPx = e.clientX - dragState.anchorClientX
      const dxSec = (dxPx / dragState.trackWidth) * span
      const len = dragState.anchorEnd - dragState.anchorStart
      let proposedStart = dragState.anchorStart + dxSec
      // Clamp so the window doesn't escape the bar
      if (proposedStart < dragState.extendStart) proposedStart = dragState.extendStart
      if (proposedStart + len > dragState.extendEnd) proposedStart = dragState.extendEnd - len
      nextStart = proposedStart
      nextEnd = proposedStart + len
    } else {
      // Resize from a single edge — interpolate the pointer's ratio
      // across the bar and snap the appropriate bound to that time.
      const ratio = Math.max(0, Math.min(1, (e.clientX - dragState.trackLeft) / dragState.trackWidth))
      const t = dragState.extendStart + ratio * span
      if (dragState.which === 'start') {
        nextStart = Math.min(t, dragState.endTime - MIN_TRIMMED_LEN)
        nextStart = Math.max(nextStart, dragState.extendStart)
      } else {
        nextEnd = Math.max(t, dragState.startTime + MIN_TRIMMED_LEN)
        nextEnd = Math.min(nextEnd, dragState.extendEnd)
      }
    }
    dragState.startTime = nextStart
    dragState.endTime = nextEnd

    // Live preview: while dragging, seek the modal player to the bound
    // the user is moving. Throttled to ~16fps so we don't drown the
    // video element in seeks during fast drags.
    if (recutModalClipId === dragState.clipId) {
      const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()
      if (!dragState._lastSeek || now - dragState._lastSeek > 60) {
        dragState._lastSeek = now
        // Seek target depends on which handle is being dragged:
        //   start handle → show the new in-point
        //   end handle   → show the new out-point
        //   move handle  → show the in-point (where playback would begin)
        const tNow = dragState.which === 'end' ? nextEnd : nextStart
        const root = document.getElementById('vx-recut-modal')
        const v = root?.querySelector('[data-recut-video]')
        if (v) {
          try { v.pause() } catch {}
          try { v.currentTime = tNow } catch {}
        }
      }
    }

    // Live-update visuals against the wider scale.
    const startPct = ((nextStart - dragState.extendStart) / span) * 100
    const endPct = ((nextEnd - dragState.extendStart) / span) * 100
    const keptW = Math.max(0, endPct - startPct)
    const track = dragState.track
    const handles = track.querySelectorAll('[data-trim-handle]')
    handles.forEach((h) => {
      const w = h.dataset.trimHandle
      if (w === 'move') {
        // The slide handle covers the kept band; resize + shift it
        // to follow the bounds.
        h.style.left = `${startPct}%`
        h.style.width = `${keptW}%`
        return
      }
      const pct = w === 'start' ? startPct : endPct
      h.style.left = `calc(${pct}% - 6px)`
    })
    const kept = track.querySelector('[data-trim-kept]')
    if (kept) {
      kept.style.left = `${startPct}%`
      kept.style.width = `${keptW}%`
    }
    const lShade = track.querySelector('[data-trim-shaded-left]')
    if (lShade) lShade.style.width = `${startPct}%`
    const rShade = track.querySelector('[data-trim-shaded-right]')
    if (rShade) rShade.style.width = `${100 - endPct}%`
  }

  function onTrimDragEnd() {
    window.removeEventListener('pointermove', onTrimDragMove)
    if (!dragState) return
    const { clipId, segIdx, startTime, endTime, origStart, origEnd, moved, track } = dragState
    // Reset the move-handle's grabbing cursor to the default grab.
    if (track) {
      const moveH = track.querySelector('[data-trim-handle="move"]')
      if (moveH) moveH.style.cursor = 'grab'
    }
    dragState = null
    if (!moved) return
    const state = getEditState(clipId)
    // Snap to Riley's original bounds when the user lands within 0.1s
    // of them — makes "back to default" easy to hit on either side.
    const SNAP = 0.1
    const finalStart = Math.abs(startTime - origStart) < SNAP ? origStart : startTime
    const finalEnd = Math.abs(endTime - origEnd) < SNAP ? origEnd : endTime
    if (Math.abs(finalStart - origStart) < 0.05 && Math.abs(finalEnd - origEnd) < 0.05) {
      // No edit — drop the trim entry entirely.
      state.trims.delete(segIdx)
    } else {
      state.trims.set(segIdx, { startTime: finalStart, endTime: finalEnd })
    }
    rerenderSegmentStrip(clipId)
  }

  async function recutClip(clipId) {
    const clip = pendingClips.find((c) => c.id === clipId)
    if (!clip) return
    const state = getEditState(clipId)
    const segments = getClipSegments(clip)
    const order = getOrderedIndices(state, segments.length)
    const isReordered = order.some((v, idx) => v !== idx)
    const editsPending = state.dropped.size > 0
      || isReordered
      || Array.from({ length: segments.length }, (_, i) => i).some((i) => isSegmentTrimmed(state, i, segments[i]))
    if (!editsPending) return

    // Build the keepSegments payload (Tier 2 shape). Iterate in the
    // user-chosen reel order so the backend builds the cut in that
    // sequence — keepSegments array order IS the resulting reel order.
    // Trimmed segments carry the user's bounds; the ORIGINAL segment
    // index is preserved in the `index` field for trim-learning.
    const keepSegments = []
    for (const i of order) {
      if (state.dropped.has(i)) continue
      const b = effectiveSegmentBounds(state, i, segments[i])
      keepSegments.push({ index: i, startTime: b.startTime, endTime: b.endTime })
    }
    if (keepSegments.length < 2) {
      showToast('Keep at least 2 segments — a 1-cut reel is not a reel', 'error')
      return
    }

    const btn = document.querySelector(`[data-studio-action="recut"][data-clip-id="${clipId}"]`)
    const origText = btn?.textContent
    if (btn) {
      btn.disabled = true
      btn.style.opacity = '0.6'
      btn.textContent = 'Re-cutting…'
    }
    try {
      const res = await fetch(`${API}/api/studio/clips/${clipId}/recut`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keepSegments }),
      })
      if (!res.ok) {
        let msg = 'Re-cut failed'
        try { const err = await res.json(); msg = err.error || err.message || msg } catch {}
        throw new Error(msg)
      }
      const json = await res.json()
      const idx = pendingClips.findIndex((c) => c.id === clipId)
      if (idx >= 0) {
        pendingClips[idx] = {
          ...pendingClips[idx],
          clippedUrl: json.clip.clippedUrl,
          duration: json.clip.duration,
          editVersion: json.clip.editVersion,
          userEditedSegments: json.clip.segments,
          segmentThumbnailUrls: json.clip.segmentThumbnailUrls,
        }
      }
      // Clean slate after a successful recut — the new segment list is
      // what the user wanted, so further edits start fresh. Order is
      // wiped too so the reordered reel becomes the new natural order.
      segmentEditState.set(clipId, { dropped: new Set(), trims: new Map(), order: null })
      // Close the modal if it's open. Pending list re-renders below
      // pick up the new clippedUrl + duration.
      if (recutModalClipId === clipId) closeRecutStudio()
      renderPendingClips()
      const droppedN = state.dropped.size
      const trimmedN = keepSegments.filter((k) => {
        const orig = segments[k.index]
        return Math.abs(k.startTime - orig.startTime) > 0.05 || Math.abs(k.endTime - orig.endTime) > 0.05
      }).length
      const detail = []
      if (droppedN > 0) detail.push(`${droppedN} dropped`)
      if (trimmedN > 0) detail.push(`${trimmedN} trimmed`)
      showToast(`Re-cut: ${json.clip.duration}s (${detail.join(', ') || 'no edits'})`, 'success')
    } catch (err) {
      console.error('[studio] recut failed:', err)
      showToast(`Re-cut failed: ${err.message}`, 'error')
      if (btn && origText) {
        btn.disabled = false
        btn.style.opacity = ''
        btn.textContent = origText
      }
    }
  }

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
                return `<video id="studio-clip-video-${clip.id}" src="${videoSrc}" controls></video>`
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
            <button type="button" class="btn" style="flex:1;padding:7px 10px;font-size:11px" data-studio-action="open-recut-studio" data-clip-id="${clip.id}">Re-cut</button>
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
        <div class="studio-clip-footer" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <button type="button" class="btn" style="padding:5px 10px;font-size:10px;color:var(--t3)" data-studio-action="discard" data-clip-id="${clip.id}">Discard</button>
          <button type="button" class="btn" style="padding:5px 12px;font-size:10px" data-studio-action="download" data-clip-id="${clip.id}">Download</button>
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

      // Slots are advisory only — Jordan's analysis still shows when to post
      // for max reach, but we don't expose a schedule button until real auto-
      // posting exists. Avoids promising a deliverable we can't honour.
      void isoTime
      return `<div style="background:var(--bg);border:${slot.border};border-radius:8px;padding:14px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
          <div>
            <div style="font-family:'Inter',sans-serif;font-weight:500;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:${slot.labelColor};margin-bottom:4px">${slot.label}</div>
            <div style="font-size:14px;font-weight:600;color:var(--t1)">${timeStr}</div>
          </div>
          <span style="font-size:11px;font-weight:600;color:${slot.confColor};padding:4px 8px;background:${slot.confBg};border-radius:4px">${pct}</span>
        </div>
        <div style="font-size:12px;line-height:1.5;color:var(--t2)">${rec.rationale || ''}</div>
        ${tags ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">${tags}</div>` : ''}
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

    // Keep the sidebar Save as Ready button targeting the first pending clip.
    // Also evaluate whether that clip is already visually-approved (e.g.
    // user reloaded after approving) and enable the button accordingly.
    // Without this, an already-approved clip leaves the button stuck
    // disabled until the user re-clicks Approve.
    activeClipId = pendingClips[0]?.id || null
    var activeState = (activeClipId && clipStateMap[activeClipId]) || {}
    var ready = activeState.visualApprovalStatus === 'approved'
    document.querySelectorAll('[data-studio-action="save-ready"]').forEach(btn => {
      if (activeClipId) btn.dataset.clipId = activeClipId
      btn.disabled = !ready
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
          cancelPolling()
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
