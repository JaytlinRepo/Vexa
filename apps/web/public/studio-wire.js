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

  // ── Load & Refresh ───────────────────────────────────────────────

  function updateClipCount() {
    const count = pendingClips.length
    const countEl = document.querySelector('[data-studio-pending-count]')
    if (countEl) countEl.textContent = count === 1 ? '1 item' : `${count} items`
  }

  async function refreshClips() {
    pendingClips = await fetchPendingClips()
    updateClipCount()
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
    await refreshClips()

    // Refresh clips when navigating to Studio tab
    const studioNav = document.getElementById('nav-db-studio')
    if (studioNav) {
      studioNav.addEventListener('click', () => {
        setTimeout(refreshClips, 300)
      })
    }
  }

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStudioTab)
  } else {
    initStudioTab()
  }
})()
