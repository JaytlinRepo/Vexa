/* Sovexa — Content tab: upload media for Riley review + CEO approve/override.
 *
 * Shows:
 *  - Upload zone (drag-drop or click)
 *  - Upload history with Riley's review cards
 *  - CEO actions: approve / post anyway / accept notes / reject
 */
;(function () {
  // API base — upload files directly to API server to avoid Next.js proxy body size limits
  var API_BASE = window.__NEXT_DATA__?.runtimeConfig?.apiUrl || ''

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] })
  }

  function timeAgo(iso) {
    if (!iso) return ''
    var diff = Math.max(0, Date.now() - new Date(iso).getTime())
    var m = Math.floor(diff / 60000)
    if (m < 60) return m + 'm ago'
    var h = Math.floor(m / 60)
    if (h < 24) return h + 'h ago'
    return Math.floor(h / 24) + 'd ago'
  }

  // ── Company ID helper ─────────────────────────────────────────
  var cachedCompanyId = null

  async function getCompanyId() {
    if (cachedCompanyId) return cachedCompanyId
    // Try dashboard state first
    if (window.STATE?.me?.companies?.[0]?.id) {
      cachedCompanyId = window.STATE.me.companies[0].id
      return cachedCompanyId
    }
    // Fallback: fetch from /api/auth/me
    try {
      var res = await fetch('/api/auth/me', { credentials: 'include' })
      if (res.ok) {
        var json = await res.json()
        var cid = json.companies?.[0]?.id || null
        if (cid) cachedCompanyId = cid
        return cid
      }
    } catch {}
    return null
  }

  // ── Fetch uploads ─────────────────────────────────────────────
  async function fetchUploads() {
    var cid = await getCompanyId()
    if (!cid) return []
    try {
      var res = await fetch('/api/uploads?companyId=' + cid, { credentials: 'include' })
      if (!res.ok) return []
      var json = await res.json()
      return json.data || []
    } catch { return [] }
  }

  // ── Progress state ─────────────────────────────────────────────
  var uploadProgress = { percent: 0, label: '', fileIndex: 0, fileCount: 0 }

  function updateProgressUI() {
    var bar = document.getElementById('vx-progress-bar-fill')
    var pctEl = document.getElementById('vx-progress-pct')
    var labelEl = document.getElementById('vx-progress-label')
    if (bar) bar.style.width = uploadProgress.percent + '%'
    if (pctEl) pctEl.textContent = Math.round(uploadProgress.percent) + '%'
    if (labelEl) labelEl.textContent = uploadProgress.label
  }

  // ── Upload file to S3 via presigned URL with progress tracking ──
  function uploadToS3WithProgress(url, file, contentType) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest()
      xhr.open('PUT', url, true)
      xhr.setRequestHeader('Content-Type', contentType)

      xhr.upload.addEventListener('progress', function (e) {
        if (e.lengthComputable) {
          var filePct = (e.loaded / e.total) * 100
          // Scale to overall progress: each file gets an equal slice
          if (uploadProgress.fileCount > 0) {
            var sliceSize = 100 / uploadProgress.fileCount
            var basePct = (uploadProgress.fileIndex) * sliceSize
            uploadProgress.percent = basePct + (filePct * sliceSize / 100)
          } else {
            uploadProgress.percent = filePct
          }
          var loaded = (e.loaded / (1024 * 1024)).toFixed(1)
          var total = (e.total / (1024 * 1024)).toFixed(1)
          uploadProgress.label = 'Uploading ' + (uploadProgress.fileCount > 1 ? '(' + (uploadProgress.fileIndex + 1) + '/' + uploadProgress.fileCount + ') ' : '') + loaded + ' / ' + total + ' MB'
          updateProgressUI()
        }
      })

      xhr.addEventListener('load', function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(true)
        } else {
          console.error('[content] S3 upload failed:', xhr.status, xhr.responseText?.slice(0, 200))
          reject(new Error('S3 upload failed: ' + xhr.status))
        }
      })

      xhr.addEventListener('error', function () { reject(new Error('Network error during upload')) })
      xhr.addEventListener('abort', function () { reject(new Error('Upload cancelled')) })
      xhr.send(file)
    })
  }

  async function uploadFileToS3(file, fileIndex, fileCount) {
    var cid = await getCompanyId()
    if (!cid) return null

    var contentType = file.type || 'application/octet-stream'
    if (!contentType || contentType === 'application/octet-stream') {
      var ext = (file.name || '').split('.').pop()?.toLowerCase()
      var typeMap = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', avi: 'video/x-msvideo', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic' }
      contentType = typeMap[ext] || 'application/octet-stream'
    }

    // Get presigned upload URL
    var presignRes = await fetch('/api/uploads/presign?companyId=' + cid + '&filename=' + encodeURIComponent(file.name) + '&contentType=' + encodeURIComponent(contentType), { credentials: 'include' })
    if (!presignRes.ok) return null
    var presign = await presignRes.json()
    var key = presign.data.key
    var uploadUrl = presign.data.uploadUrl

    // Upload with progress tracking
    uploadProgress.fileIndex = fileIndex || 0
    uploadProgress.fileCount = fileCount || 1
    try {
      await uploadToS3WithProgress(uploadUrl, file, contentType)
      return key
    } catch (e) {
      console.error('[content] S3 upload error:', e.message)
      return null
    }
  }

  async function uploadFile(file, notes) {
    console.log('[content] uploadFile called', file?.name, file?.size)
    var cid = await getCompanyId()
    if (!cid) { alert('No company found. Please complete onboarding first.'); return null }

    var key = await uploadFileToS3(file, 0, 1)
    if (!key) { alert('Upload to S3 failed'); return null }

    // Tell API to create Riley review task
    try {
      var res = await fetch('/api/uploads', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: cid, uploadKey: key, uploadType: file.type.startsWith('video/') ? 'video' : 'image', notes: notes || null }),
      })
      if (!res.ok) {
        var err = await res.json().catch(function () { return {} })
        alert('Upload failed: ' + (err.error || res.statusText))
        return null
      }
      return await res.json()
    } catch (e) {
      alert('Upload error: ' + e.message)
      return null
    }
  }

  // ── Task action (approve / post_anyway / accept_notes / reject / save_unreleased) ─
  async function sendAction(taskId, actionType) {
    try {
      await fetch('/api/tasks/' + taskId + '/action', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: actionType, label: actionType.replace(/_/g, ' ') }),
      })
    } catch (e) {
      console.warn('[content] action failed', e)
    }
  }

  // ── Double confirmation modal ──────────────────────────────────
  // Nothing gets posted without two explicit CEO approvals.
  function showPostConfirm(taskId, actionType, refreshCallback) {
    var overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px)'

    var isOverride = actionType === 'post_anyway'
    var title = isOverride
      ? 'Override Riley\'s review?'
      : 'Confirm: publish this content?'
    var body = isOverride
      ? 'Riley flagged issues with this content. You\'re choosing to post anyway. This will be published to your connected accounts.'
      : 'This content will be sent to Jordan for publishing to your connected accounts.'

    overlay.innerHTML = '<div style="background:var(--bg);border:1px solid var(--b2);border-radius:12px;padding:28px;max-width:400px;width:90%">'
      + '<div style="font-size:15px;font-weight:600;color:var(--t1);margin-bottom:10px">' + title + '</div>'
      + '<p style="font-size:13px;color:var(--t2);line-height:1.6;margin:0 0 20px">' + body + '</p>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap">'
      + '<button id="vx-confirm-yes" style="padding:10px 20px;border-radius:8px;border:1px solid #34d27a;background:#34d27a;color:#0a0a0a;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">Yes, publish it</button>'
      + '<button id="vx-confirm-save" style="padding:10px 20px;border-radius:8px;border:1px solid var(--b2);background:var(--s2);color:var(--t2);font-size:13px;font-weight:500;cursor:pointer;font-family:inherit">Save — don\'t post yet</button>'
      + '<button id="vx-confirm-cancel" style="padding:10px 16px;border-radius:8px;border:none;background:none;color:var(--t3);font-size:13px;cursor:pointer;font-family:inherit">Cancel</button>'
      + '</div>'
      + '</div>'

    document.body.appendChild(overlay)

    document.getElementById('vx-confirm-yes').addEventListener('click', async function () {
      this.disabled = true
      this.textContent = 'Publishing...'
      await sendAction(taskId, actionType)
      overlay.remove()
      if (refreshCallback) refreshCallback()
    })

    document.getElementById('vx-confirm-save').addEventListener('click', async function () {
      this.disabled = true
      this.textContent = 'Saving...'
      await sendAction(taskId, 'save_unreleased')
      overlay.remove()
      if (refreshCallback) refreshCallback()
    })

    document.getElementById('vx-confirm-cancel').addEventListener('click', function () {
      overlay.remove()
    })

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove()
    })
  }

  // ── Review progress step helpers ───────────────────────────────
  function reviewStep(label, done) {
    var bg = done ? 'rgba(180,130,255,.15)' : 'var(--s3)'
    var col = done ? '#b482ff' : 'var(--t3)'
    var icon = done ? '✓ ' : ''
    return '<span style="font-size:10px;padding:3px 8px;border-radius:4px;background:' + bg + ';color:' + col + ';font-weight:500;white-space:nowrap">' + icon + label + '</span>'
  }
  function reviewStepDot() {
    return '<span style="font-size:8px;color:var(--t3)">›</span>'
  }

  // ── Score color ───────────────────────────────────────────────
  function scoreColor(score) {
    if (score >= 8) return '#34d27a'
    if (score >= 6) return '#e8c87a'
    return '#e87a7a'
  }

  function verdictBadge(verdict) {
    if (verdict === 'ready_to_post') {
      return '<span style="display:inline-block;padding:3px 10px;border-radius:8px;font-size:11px;font-weight:600;background:rgba(52,210,122,.15);color:#34d27a">Ready to post</span>'
    }
    return '<span style="display:inline-block;padding:3px 10px;border-radius:8px;font-size:11px;font-weight:600;background:rgba(232,122,122,.15);color:#e87a7a">Needs work</span>'
  }

  // ── Render score bar ──────────────────────────────────────────
  function scoreBar(label, score, note) {
    var pct = Math.min(100, Math.max(0, score * 10))
    var col = scoreColor(score)
    return '<div style="margin-bottom:10px">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">'
      + '<span style="font-size:12px;color:var(--t2);text-transform:capitalize">' + esc(label) + '</span>'
      + '<span style="font-size:12px;font-weight:600;color:' + col + '">' + score + '/10</span>'
      + '</div>'
      + '<div style="height:4px;background:var(--s2);border-radius:2px;overflow:hidden">'
      + '<div style="width:' + pct + '%;height:100%;background:' + col + ';border-radius:2px;transition:width .5s ease"></div>'
      + '</div>'
      + (note ? '<p style="font-size:11px;color:var(--t3);margin:4px 0 0;line-height:1.5">' + esc(note) + '</p>' : '')
      + '</div>'
  }

  // ── Build review card ─────────────────────────────────────────
  function reviewCard(item) {
    // Handle nested data wrapper from executeAndStore
    var rawReview = item.review || {}
    var review = rawReview.verdict ? rawReview : (rawReview.data || rawReview)
    var breakdown = review.breakdown || {}
    var isDelivered = item.status === 'delivered'
    var isApproved = item.status === 'approved'
    var isRejected = item.status === 'rejected'
    var isPending = item.status === 'in_progress' || item.status === 'pending'

    // Media preview
    var preview = ''
    if (item.uploadUrl) {
      if (item.uploadType === 'video') {
        preview = '<video src="' + esc(item.uploadUrl) + '" style="width:100%;max-height:240px;object-fit:cover;border-radius:8px" controls></video>'
      } else {
        preview = '<img src="' + esc(item.uploadUrl) + '" style="width:100%;max-height:240px;object-fit:cover;border-radius:8px" alt="Upload" />'
      }
    }

    // Status header
    var statusHtml = ''
    if (isPending) {
      // Check if it's a combine task still downloading
      var descMeta = {}
      try { descMeta = JSON.parse(item.description || '{}') } catch {}
      var isCombining = descMeta.status === 'combining'
      var stepLabel = isCombining ? 'Combining clips...' : 'Riley is reviewing...'

      statusHtml = '<div style="padding:12px 16px;background:var(--s2);border-radius:8px;margin-bottom:12px">'
        + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">'
        + '<div style="width:8px;height:8px;border-radius:50%;background:#b482ff;animation:pulse 1.5s infinite"></div>'
        + '<span style="font-size:13px;color:var(--t2)">' + stepLabel + '</span>'
        + '</div>'
        // Review progress steps
        + '<div style="display:flex;gap:4px;align-items:center">'
        + reviewStep('Upload', true)
        + reviewStepDot()
        + reviewStep(isCombining ? 'Combine' : 'Analyze', isCombining)
        + reviewStepDot()
        + reviewStep('Niche & brand check', false)
        + reviewStepDot()
        + reviewStep('Edit suggestions', false)
        + '</div>'
        + '</div>'
    } else if (isApproved) {
      statusHtml = '<div style="padding:8px 16px;background:rgba(52,210,122,.08);border-radius:8px;margin-bottom:12px;font-size:12px;color:#34d27a;font-weight:500">Approved</div>'
    } else if (isRejected) {
      statusHtml = '<div style="padding:8px 16px;background:rgba(232,122,122,.08);border-radius:8px;margin-bottom:12px;font-size:12px;color:#e87a7a;font-weight:500">Scrapped</div>'
    }

    // Review scores
    var scoresHtml = ''
    if (review.verdict && breakdown.hook) {
      scoresHtml = '<div style="margin-top:12px">'
        + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">'
        + verdictBadge(review.verdict)
        + '<span style="font-size:22px;font-weight:700;color:' + scoreColor(review.overallScore || 0) + '">' + (review.overallScore || '?') + '</span>'
        + '<span style="font-size:12px;color:var(--t3)">/10 overall</span>'
        + '</div>'
        + scoreBar('niche fit', (breakdown.nicheFit || breakdown.hook)?.score || 0, (breakdown.nicheFit || breakdown.hook)?.note)
        + scoreBar('brand consistency', (breakdown.brandConsistency || breakdown.pacing)?.score || 0, (breakdown.brandConsistency || breakdown.pacing)?.note)
        + scoreBar('hook', (breakdown.hook || breakdown.framing)?.score || 0, (breakdown.hook || breakdown.framing)?.note)
        + scoreBar('mood & tone', (breakdown.moodTone || breakdown.lighting)?.score || 0, (breakdown.moodTone || breakdown.lighting)?.note)
        + scoreBar('engagement', (breakdown.engagementPotential || breakdown.audio)?.score || 0, (breakdown.engagementPotential || breakdown.audio)?.note)
        + scoreBar('platform fit', (breakdown.platformFit || breakdown.editing)?.score || 0, (breakdown.platformFit || breakdown.editing)?.note)
        + '</div>'
    } else if (isDelivered && !isPending) {
      // Fallback: show whatever review info we have (caption, hook, etc.)
      var fallbackParts = []
      if (review.caption) fallbackParts.push('<p style="font-size:13px;color:var(--t1);margin:0 0 4px;line-height:1.5"><strong>Caption:</strong> ' + esc(review.caption) + '</p>')
      if (review.hook) fallbackParts.push('<p style="font-size:13px;color:var(--t1);margin:0 0 4px;line-height:1.5"><strong>Hook:</strong> ' + esc(review.hook) + '</p>')
      if (review.tags?.length) fallbackParts.push('<p style="font-size:12px;color:var(--t2);margin:0">' + review.tags.map(function(t) { return '#' + esc(t) }).join(' ') + '</p>')
      if (fallbackParts.length) {
        scoresHtml = '<div style="margin-top:12px;padding:12px 16px;background:var(--s2);border-radius:8px">'
          + '<div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--t3);margin-bottom:8px">Riley\'s Review</div>'
          + fallbackParts.join('')
          + '</div>'
      }
    }

    // Strengths + issues
    var feedbackHtml = ''
    if (review.strengths?.length || review.issues?.length) {
      feedbackHtml = '<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--b1)">'
      if (review.strengths?.length) {
        feedbackHtml += '<div style="margin-bottom:10px"><span style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--t3)">Strengths</span>'
        review.strengths.forEach(function (s) {
          feedbackHtml += '<p style="font-size:13px;color:#34d27a;margin:4px 0 0;line-height:1.5">+ ' + esc(s) + '</p>'
        })
        feedbackHtml += '</div>'
      }
      if (review.issues?.length) {
        feedbackHtml += '<div><span style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--t3)">Issues</span>'
        review.issues.forEach(function (s) {
          feedbackHtml += '<p style="font-size:13px;color:#e87a7a;margin:4px 0 0;line-height:1.5">- ' + esc(s) + '</p>'
        })
        feedbackHtml += '</div>'
      }
      feedbackHtml += '</div>'
    }

    // Riley's note
    var noteHtml = ''
    if (review.rileyNote) {
      noteHtml = '<div style="margin-top:14px;padding:12px 16px;background:var(--s2);border-radius:8px;border-left:3px solid #b482ff">'
        + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">'
        + '<span style="width:20px;height:20px;border-radius:50%;background:#b482ff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff">R</span>'
        + '<span style="font-size:11px;font-weight:500;color:#b482ff">Riley\'s Take</span>'
        + '</div>'
        + '<p style="font-size:13px;color:var(--t1);line-height:1.6;margin:0">' + esc(review.rileyNote) + '</p>'
        + '</div>'
    }

    // Suggested edits (video only)
    var editsHtml = ''
    var suggestedEdits = review.suggestedEdits || []
    if (suggestedEdits.length > 0 && item.uploadType === 'video') {
      editsHtml = '<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--b1)">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">'
        + '<span style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--t3)">AI Edit Suggestions</span>'
        + '<span style="font-size:10px;color:var(--t3)">' + suggestedEdits.length + ' edit' + (suggestedEdits.length > 1 ? 's' : '') + '</span>'
        + '</div>'

      suggestedEdits.forEach(function (edit, i) {
        var icon = { trim: '✂️', speed: '⏩', crop: '📐', text: '💬', audio_norm: '🔊', audio_strip: '🔇', mood: '🎨' }[edit.type] || '🔧'
        var typeName = { trim: 'Trim', speed: 'Speed', crop: 'Crop', text: 'Text Overlay', audio_norm: 'Audio Fix', audio_strip: 'Remove Audio', mood: 'Color Grade' }[edit.type] || edit.type
        editsHtml += '<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 12px;background:var(--s2);border-radius:8px;margin-bottom:6px">'
          + '<span style="font-size:14px;flex-shrink:0;margin-top:1px">' + icon + '</span>'
          + '<div style="flex:1;min-width:0">'
          + '<div style="font-size:12px;font-weight:500;color:var(--t1)">' + esc(edit.label || typeName) + '</div>'
          + '<div style="font-size:10px;color:var(--t3);margin-top:2px">' + esc(typeName)
          + (edit.type === 'trim' ? ' — ' + (edit.startSec || 0) + 's' + (edit.endSec ? ' to ' + edit.endSec + 's' : ' from start') : '')
          + (edit.type === 'speed' ? ' — ' + (edit.factor || 1) + 'x' : '')
          + (edit.type === 'crop' ? ' — ' + (edit.aspect || '9:16') : '')
          + (edit.type === 'text' ? ' — "' + esc((edit.content || '').slice(0, 30)) + '"' : '')
          + (edit.type === 'mood' ? ' — ' + (edit.mood || 'cinematic') : '')
          + '</div>'
          + '</div>'
          + '</div>'
      })

      // Apply all edits button
      if (isDelivered || review.verdict === 'needs_work') {
        editsHtml += '<button data-vx-apply-edits="1" data-task-id="' + esc(item.id) + '" style="margin-top:8px;width:100%;padding:10px;border-radius:8px;border:1px solid #b482ff;background:rgba(180,130,255,.1);color:#b482ff;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .2s">Apply all edits</button>'
      }

      editsHtml += '</div>'
    }

    // Edited version preview — before/after comparison
    var editedHtml = ''
    if (review.editedUrl) {
      editedHtml = '<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--b1)">'
        + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:12px">'
        + '<span style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--t3)">Before & After</span>'
        + '<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:rgba(52,210,122,.12);color:#34d27a;font-weight:500">Edits applied</span>'
        + '</div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'
        // Original
        + '<div>'
        + '<div style="font-size:10px;color:var(--t3);margin-bottom:4px;text-align:center">Original</div>'
        + (item.uploadUrl
          ? '<video src="' + esc(item.uploadUrl) + '" style="width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:8px;border:1px solid var(--b1)" controls></video>'
          : '<div style="aspect-ratio:9/16;background:var(--s2);border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--t3);font-size:11px">Original</div>')
        + '</div>'
        // Edited
        + '<div>'
        + '<div style="font-size:10px;color:#34d27a;margin-bottom:4px;text-align:center">Edited</div>'
        + '<video src="' + esc(review.editedUrl) + '" style="width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:8px;border:1px solid #34d27a33" controls></video>'
        + '</div>'
        + '</div>'
        + '</div>'
    }

    // Action buttons (only when delivered — awaiting CEO decision)
    var actionsHtml = ''
    if (isDelivered) {
      actionsHtml = '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">'
      if (review.verdict === 'ready_to_post') {
        actionsHtml += '<button data-vx-confirm-post="approve" data-task-id="' + esc(item.id) + '" style="padding:8px 16px;border-radius:8px;border:1px solid #34d27a;background:rgba(52,210,122,.1);color:#34d27a;font-size:12px;font-weight:500;cursor:pointer;font-family:inherit">Ready — send to Jordan</button>'
      } else {
        actionsHtml += '<button data-vx-confirm-post="post_anyway" data-task-id="' + esc(item.id) + '" style="padding:8px 16px;border-radius:8px;border:1px solid var(--b2);background:var(--s2);color:var(--t1);font-size:12px;font-weight:500;cursor:pointer;font-family:inherit">Post anyway</button>'
        actionsHtml += '<button data-vx-upload-action="accept_notes" data-task-id="' + esc(item.id) + '" style="padding:8px 16px;border-radius:8px;border:1px solid var(--b2);background:var(--s2);color:var(--t2);font-size:12px;font-weight:500;cursor:pointer;font-family:inherit">Accept notes — re-upload</button>'
      }
      actionsHtml += '<button data-vx-upload-action="save_unreleased" data-task-id="' + esc(item.id) + '" style="padding:8px 16px;border-radius:8px;border:1px solid var(--b2);background:none;color:var(--t2);font-size:12px;font-weight:500;cursor:pointer;font-family:inherit">Save — don\'t post</button>'
      actionsHtml += '<button data-vx-upload-action="reject" data-task-id="' + esc(item.id) + '" style="padding:8px 16px;border-radius:8px;border:1px solid var(--b1);background:none;color:var(--t3);font-size:12px;font-weight:500;cursor:pointer;font-family:inherit">Scrap it</button>'
      actionsHtml += '</div>'
    }

    // Unreleased badge
    var userAction = item.userAction || {}
    var isUnreleased = isApproved && userAction.type === 'save_unreleased'
    if (isUnreleased) {
      statusHtml = '<div style="padding:8px 16px;background:rgba(180,130,255,.08);border-radius:8px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between">'
        + '<span style="font-size:12px;color:#b482ff;font-weight:500">Saved — unreleased</span>'
        + '<button data-vx-confirm-post="approve" data-task-id="' + esc(item.id) + '" style="padding:4px 12px;border-radius:6px;border:1px solid #34d27a;background:rgba(52,210,122,.1);color:#34d27a;font-size:11px;font-weight:500;cursor:pointer;font-family:inherit">Release now</button>'
        + '</div>'
    }

    return '<div style="background:var(--s1);border:1px solid var(--b1);border-radius:12px;overflow:hidden;margin-bottom:16px">'
      + (preview ? '<div style="padding:12px 12px 0">' + preview + '</div>' : '')
      + '<div style="padding:16px">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
      + '<span style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--t3)">' + esc(item.uploadType) + ' upload</span>'
      + '<span style="font-size:11px;color:var(--t3)">' + timeAgo(item.createdAt) + '</span>'
      + '</div>'
      + statusHtml
      + scoresHtml
      + feedbackHtml
      + noteHtml
      + editsHtml
      + editedHtml
      + actionsHtml
      + (item.notes ? '<p style="font-size:12px;color:var(--t3);margin-top:10px;font-style:italic">Your notes: ' + esc(item.notes) + '</p>' : '')
      + '</div>'
      + '</div>'
  }

  // ── Upload zone ───────────────────────────────────────────────
  function uploadZone() {
    return '<div id="vx-upload-zone" style="border:2px dashed var(--b2);border-radius:12px;padding:40px 24px;text-align:center;cursor:pointer;transition:all .2s;margin-bottom:16px">'
      + '<input type="file" id="vx-upload-input" accept="image/*,video/*" multiple style="display:none" />'
      + '<div style="font-size:32px;margin-bottom:8px;opacity:.5">📤</div>'
      + '<p style="font-size:14px;color:var(--t1);margin:0 0 4px;font-weight:500">Upload content for Riley to review</p>'
      + '<p style="font-size:12px;color:var(--t3);margin:0">Drop files here, or click to browse. Select multiple videos to combine them.</p>'
      + '<p style="font-size:11px;color:var(--t3);margin:6px 0 0">MP4, MOV, WebM, JPEG, PNG, WebP — max 50MB per file</p>'
      + '</div>'
      // Clip list (shown when multiple videos selected)
      + '<div id="vx-clip-list" style="display:none;margin-bottom:16px">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">'
      + '<span style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--t3)">Clips to combine</span>'
      + '<span id="vx-clip-count" style="font-size:11px;color:var(--t2)"></span>'
      + '</div>'
      + '<div id="vx-clip-items" style="display:flex;flex-direction:column;gap:6px"></div>'
      + '<p style="font-size:11px;color:var(--t3);margin:8px 0 0">Drag to reorder. Clips will be combined top-to-bottom.</p>'
      + '</div>'
      // Notes + submit
      + '<div id="vx-upload-notes-wrap" style="display:none;margin-bottom:16px">'
      + '<textarea id="vx-upload-notes" placeholder="Optional notes for Riley (e.g. \'filmed this quick, worried about lighting\')" style="width:100%;padding:12px;background:var(--s1);border:1px solid var(--b1);border-radius:8px;color:var(--t1);font-size:13px;font-family:inherit;resize:vertical;min-height:60px;box-sizing:border-box"></textarea>'
      + '<div style="display:flex;gap:8px;margin-top:8px">'
      + '<button id="vx-upload-submit" style="padding:8px 20px;border-radius:8px;border:1px solid var(--t1);background:var(--t1);color:var(--inv);font-size:13px;font-weight:500;cursor:pointer;font-family:inherit">Send to Riley</button>'
      + '<button id="vx-upload-cancel" style="padding:8px 16px;border-radius:8px;border:1px solid var(--b1);background:none;color:var(--t2);font-size:13px;cursor:pointer;font-family:inherit">Cancel</button>'
      + '</div>'
      + '</div>'
      + '<div id="vx-upload-progress" style="display:none;margin-bottom:16px;padding:16px 20px;background:var(--s1);border:1px solid var(--b1);border-radius:8px">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
      + '<span id="vx-progress-label" style="font-size:12px;color:var(--t2)">Uploading...</span>'
      + '<span id="vx-progress-pct" style="font-size:13px;font-weight:600;color:var(--t1)">0%</span>'
      + '</div>'
      + '<div style="height:6px;background:var(--s2);border-radius:3px;overflow:hidden">'
      + '<div id="vx-progress-bar-fill" style="width:0%;height:100%;background:linear-gradient(90deg,#b482ff,#6ab4ff);border-radius:3px;transition:width .15s ease"></div>'
      + '</div>'
      + '</div>'
  }

  // ── Combine upload helper ─────────────────────────────────────
  // Uploads each clip to S3 directly, then calls API to combine the S3 keys
  async function uploadCombined(files, notes) {
    var cid = await getCompanyId()
    if (!cid) { alert('No company found.'); return null }

    // Upload each file to S3
    var keys = []
    for (var i = 0; i < files.length; i++) {
      console.log('[content] uploading clip', i + 1, '/', files.length, files[i].name)
      var key = await uploadFileToS3(files[i], i, files.length)
      if (!key) { alert('Failed to upload clip ' + (i + 1)); return null }
      keys.push(key)
    }

    // Call combine-existing with the S3 keys
    console.log('[content] all clips uploaded, combining:', keys.length)
    try {
      var res = await fetch('/api/uploads/combine-existing', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: cid, uploadKeys: keys, notes: notes || undefined }),
      })
      if (!res.ok) {
        var err = await res.json().catch(function () { return {} })
        alert('Combine failed: ' + (err.error || res.statusText))
        return null
      }
      return await res.json()
    } catch (e) {
      alert('Combine error: ' + e.message)
      return null
    }
  }

  // ── Render clip list for reordering ───────────────────────────
  function renderClipList(files, container) {
    container.innerHTML = ''
    for (var i = 0; i < files.length; i++) {
      var f = files[i]
      var isVideo = f.type.startsWith('video/')
      var sizeKb = (f.size / 1024).toFixed(0)
      var sizeMb = (f.size / (1024 * 1024)).toFixed(1)
      var sizeStr = f.size > 1024 * 1024 ? sizeMb + ' MB' : sizeKb + ' KB'
      var el = document.createElement('div')
      el.dataset.clipIdx = String(i)
      el.draggable = true
      el.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--s1);border:1px solid var(--b1);border-radius:8px;cursor:grab;transition:border-color .2s'
      el.innerHTML = '<span style="color:var(--t3);font-size:14px;cursor:grab">⠿</span>'
        + '<span style="font-size:14px">' + (isVideo ? '🎬' : '📷') + '</span>'
        + '<div style="flex:1;min-width:0">'
        + '<div style="font-size:12px;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(f.name) + '</div>'
        + '<div style="font-size:10px;color:var(--t3)">' + sizeStr + '</div>'
        + '</div>'
        + '<span style="font-size:11px;color:var(--t3);font-weight:500;min-width:16px;text-align:center">' + (i + 1) + '</span>'
        + '<button data-remove-clip="' + i + '" style="background:none;border:none;color:var(--t3);font-size:14px;cursor:pointer;padding:2px 4px">&times;</button>'
      container.appendChild(el)
    }
  }

  // ── Fetch published posts from platform ─────────────────────
  async function fetchPosts() {
    try {
      var res = await fetch('/api/platform/timeseries', { credentials: 'include' })
      if (!res.ok) return { posts: [], account: null }
      var json = await res.json()
      return { posts: json.posts || [], account: json.account || null }
    } catch { return { posts: [], account: null } }
  }

  // ── Fetch planned posts from content plans ────────────────
  async function fetchPlannedPosts() {
    try {
      var res = await fetch('/api/outputs?type=content_plan', { credentials: 'include' })
      if (!res.ok) return []
      var json = await res.json()
      var outputs = json.outputs || []
      var planned = []
      outputs.forEach(function (o) {
        if (o.status !== 'approved' && o.task?.status !== 'approved') return
        var content = o.content || {}
        var posts = content.posts || []
        posts.forEach(function (p) {
          planned.push({
            day: p.day || p.weekday,
            date: p.date,
            format: p.format || p.type || 'post',
            topic: p.topic || p.angle || '',
            angle: p.angle || '',
            goal: p.goal || '',
            notes: p.notes || '',
            source: 'content_plan',
            taskId: o.task?.id,
            employeeName: o.employee?.name || 'Jordan',
          })
        })
      })
      return planned
    } catch { return [] }
  }

  // ── Format numbers ────────────────────────────────────────
  function fmtNum(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
    return String(n || 0)
  }

  // ── Platform icon ─────────────────────────────────────────
  function platformBadge(account) {
    if (!account) return ''
    var platform = (account.platform || '').toLowerCase()
    if (platform === 'tiktok') return '<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,.06);color:var(--t3)">TikTok</span>'
    if (platform === 'instagram' || platform === 'instagram_direct') return '<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,.06);color:var(--t3)">Instagram</span>'
    return '<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,.06);color:var(--t3)">' + esc(platform) + '</span>'
  }

  // ── Media type badge ──────────────────────────────────────
  function formatBadge(fmt) {
    var label = String(fmt || 'post').toLowerCase()
    var colors = { reel: '#b482ff', video: '#b482ff', carousel_album: '#6ab4ff', carousel: '#6ab4ff', image: '#34d27a', static: '#34d27a', story: '#e8c87a' }
    var col = colors[label] || 'var(--t3)'
    var display = label === 'carousel_album' ? 'carousel' : label
    return '<span style="font-size:10px;padding:2px 8px;border-radius:4px;background:' + col + '18;color:' + col + ';font-weight:500;text-transform:capitalize">' + display + '</span>'
  }

  // ── TikTok embed URL builder ──────────────────────────────
  function tiktokEmbedUrl(postUrl) {
    // Extract video ID from TikTok URL
    var match = String(postUrl || '').match(/video\/(\d+)/)
    if (match) return 'https://www.tiktok.com/embed/v2/' + match[1]
    return null
  }

  // ── Build post card ───────────────────────────────────────
  function postCard(post, account) {
    var caption = (post.caption || '').slice(0, 120)
    var mediaType = (post.mediaType || post.media_type || '').toUpperCase()
    var isVideo = mediaType === 'VIDEO' || mediaType === 'REEL'
    var thumb = post.thumbnailUrl || post.thumbnail_url || ''
    var postUrl = post.url || ''
    var publishedAt = post.publishedAt || post.published_at || ''

    // Engagement stats
    var views = post.viewCount || post.view_count || 0
    var likes = post.likeCount || post.like_count || 0
    var comments = post.commentCount || post.comment_count || 0
    var shares = post.shareCount || post.share_count || 0

    // Thumbnail with play overlay for videos
    var mediaHtml = ''
    if (thumb) {
      mediaHtml = '<div class="vx-post-thumb" data-vx-post-url="' + esc(postUrl) + '" data-vx-video="' + (isVideo ? '1' : '0') + '" style="position:relative;cursor:pointer;border-radius:8px;overflow:hidden;aspect-ratio:9/16;background:var(--s2)">'
        + '<img src="' + esc(thumb) + '" style="width:100%;height:100%;object-fit:cover" alt="" loading="lazy" />'
        + (isVideo ? '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.25);transition:background .2s"><div style="width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.9);display:flex;align-items:center;justify-content:center"><svg width="16" height="16" viewBox="0 0 24 24" fill="#000"><path d="M8 5v14l11-7z"/></svg></div></div>' : '')
        + '</div>'
    } else {
      mediaHtml = '<div style="aspect-ratio:9/16;background:var(--s2);border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--t3);font-size:24px">' + (isVideo ? '🎬' : '📷') + '</div>'
    }

    // Stats row
    var statsHtml = '<div style="display:flex;gap:10px;margin-top:6px;font-size:11px;color:var(--t3)">'
    if (views) statsHtml += '<span>▶ ' + fmtNum(views) + '</span>'
    statsHtml += '<span>♥ ' + fmtNum(likes) + '</span>'
    if (comments) statsHtml += '<span>💬 ' + fmtNum(comments) + '</span>'
    if (shares) statsHtml += '<span>↗ ' + fmtNum(shares) + '</span>'
    statsHtml += '</div>'

    return '<div style="min-width:0">'
      + mediaHtml
      + '<div style="padding:8px 0 0">'
      + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">'
      + formatBadge(mediaType)
      + platformBadge(account)
      + '</div>'
      + (caption ? '<p style="font-size:12px;color:var(--t2);margin:0;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + esc(caption) + '</p>' : '')
      + statsHtml
      + '<div style="font-size:10px;color:var(--t3);margin-top:4px">' + timeAgo(publishedAt) + '</div>'
      + '</div>'
      + '</div>'
  }

  // ── Planned post card (from content plan) ─────────────────
  function plannedPostCard(p) {
    return '<div style="background:var(--s1);border:1px dashed var(--b2);border-radius:8px;padding:14px">'
      + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">'
      + formatBadge(p.format)
      + '<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:rgba(232,200,122,.12);color:#e8c87a;font-weight:500">Planned</span>'
      + (p.day ? '<span style="font-size:11px;color:var(--t3)">' + esc(p.day) + '</span>' : '')
      + '</div>'
      + '<p style="font-size:13px;color:var(--t1);margin:0 0 4px;font-weight:500;line-height:1.4">' + esc(p.topic) + '</p>'
      + (p.angle ? '<p style="font-size:12px;color:var(--t2);margin:0;line-height:1.4">' + esc(p.angle) + '</p>' : '')
      + '<div style="margin-top:8px;font-size:11px;color:var(--t3)">From ' + esc(p.employeeName) + '\'s plan</div>'
      + '</div>'
  }

  // ── Video player modal ────────────────────────────────────
  function openVideoPlayer(postUrl) {
    var embedUrl = tiktokEmbedUrl(postUrl)
    var isIg = /instagram\.com/.test(postUrl)

    var overlay = document.createElement('div')
    overlay.id = 'vx-video-player-overlay'
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px)'

    var inner = ''
    if (embedUrl) {
      // TikTok embed
      inner = '<iframe src="' + embedUrl + '" style="width:340px;height:600px;border:none;border-radius:12px" allowfullscreen allow="autoplay; encrypted-media"></iframe>'
    } else if (isIg) {
      // Instagram — open in new tab since embedding requires their script
      window.open(postUrl, '_blank')
      return
    } else {
      // Direct link fallback
      inner = '<div style="text-align:center;color:var(--t1)">'
        + '<p style="font-size:14px;margin:0 0 12px">Opening post...</p>'
        + '<a href="' + esc(postUrl) + '" target="_blank" style="color:var(--accent);text-decoration:underline">Open in new tab</a>'
        + '</div>'
      window.open(postUrl, '_blank')
      return
    }

    overlay.innerHTML = '<div style="position:relative">'
      + '<button id="vx-video-close" style="position:absolute;top:-40px;right:0;background:none;border:none;color:#fff;font-size:24px;cursor:pointer;padding:8px;z-index:1">&times;</button>'
      + inner
      + '</div>'

    document.body.appendChild(overlay)

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.id === 'vx-video-close') {
        overlay.remove()
      }
    })
    document.getElementById('vx-video-close')?.addEventListener('click', function () {
      overlay.remove()
    })
  }

  // ── Render posts section ──────────────────────────────────
  async function renderPostsSection(host) {
    var postsHost = host.querySelector('#vx-posts-section')
    if (!postsHost) {
      postsHost = document.createElement('div')
      postsHost.id = 'vx-posts-section'
      host.querySelector('#vx-uploads-list')?.after(postsHost)
    }

    postsHost.innerHTML = '<div style="margin-top:32px;padding-top:24px;border-top:1px solid var(--b1)">'
      + '<div style="text-align:center;padding:16px;color:var(--t3);font-size:13px">Loading posts...</div>'
      + '</div>'

    // Fetch in parallel
    var results = await Promise.all([fetchPosts(), fetchPlannedPosts()])
    var published = results[0].posts
    var account = results[0].account
    var planned = results[1]

    if (!published.length && !planned.length) {
      postsHost.innerHTML = '<div style="margin-top:32px;padding-top:24px;border-top:1px solid var(--b1)">'
        + '<div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--t3);margin-bottom:16px">Your Posts</div>'
        + '<div style="text-align:center;padding:32px 24px;color:var(--t3)">'
        + '<p style="font-size:14px;margin:0 0 4px">No posts yet</p>'
        + '<p style="font-size:12px;margin:0">Connect your TikTok or Instagram to see your content here</p>'
        + '</div></div>'
      return
    }

    // Build section HTML
    var html = '<div style="margin-top:32px;padding-top:24px;border-top:1px solid var(--b1)">'

    // Planned posts (upcoming)
    if (planned.length) {
      html += '<div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--t3);margin-bottom:14px">Planned Content</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-bottom:28px">'
      planned.slice(0, 8).forEach(function (p) { html += plannedPostCard(p) })
      html += '</div>'
    }

    // Published posts
    if (published.length) {
      html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">'
        + '<div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--t3)">Published Posts</div>'
        + (account ? '<div style="font-size:11px;color:var(--t3)">@' + esc(account.handle || account.username || '') + '</div>' : '')
        + '</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px">'
      published.slice(0, 12).forEach(function (p) { html += postCard(p, account) })
      html += '</div>'

      // Show more button
      if (published.length > 12) {
        html += '<div style="text-align:center;margin-top:16px">'
          + '<button id="vx-posts-show-more" style="padding:8px 20px;border-radius:8px;border:1px solid var(--b1);background:none;color:var(--t2);font-size:12px;cursor:pointer;font-family:inherit">Show all ' + published.length + ' posts</button>'
          + '</div>'
      }
    }

    html += '</div>'
    postsHost.innerHTML = html

    // Wire video click handlers
    postsHost.querySelectorAll('.vx-post-thumb').forEach(function (el) {
      el.addEventListener('click', function () {
        var url = el.dataset.vxPostUrl
        if (url) openVideoPlayer(url)
      })
    })

    // Wire show more
    var showMore = postsHost.querySelector('#vx-posts-show-more')
    if (showMore) {
      showMore.addEventListener('click', function () {
        var grid = postsHost.querySelectorAll('.vx-post-thumb')
        // Re-render with all posts
        var fullGrid = postsHost.querySelector('#vx-posts-section > div > div:last-of-type')
        if (!fullGrid) return
        // Replace grid with all posts
        var allHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px">'
        published.forEach(function (p) { allHtml += postCard(p, account) })
        allHtml += '</div>'
        // Find and replace the grid
        var grids = postsHost.querySelectorAll('div[style*="grid-template"]')
        var lastGrid = grids[grids.length - 1]
        if (lastGrid) {
          lastGrid.outerHTML = allHtml
          showMore.remove()
          // Re-wire click handlers
          postsHost.querySelectorAll('.vx-post-thumb').forEach(function (el2) {
            el2.addEventListener('click', function () {
              var url2 = el2.dataset.vxPostUrl
              if (url2) openVideoPlayer(url2)
            })
          })
        }
      })
    }
  }

  // ── Main render ───────────────────────────────────────────────
  var pendingFiles = []  // array of File objects

  window.vxRenderContent = async function (host) {
    host.innerHTML = '<div style="padding:4px 0">'
      + uploadZone()
      + '<div id="vx-uploads-list"><div style="text-align:center;padding:24px;color:var(--t3);font-size:13px">Loading...</div></div>'
      + '</div>'

    // Wire upload zone
    var zone = host.querySelector('#vx-upload-zone')
    var input = host.querySelector('#vx-upload-input')
    var clipListWrap = host.querySelector('#vx-clip-list')
    var clipItems = host.querySelector('#vx-clip-items')
    var clipCount = host.querySelector('#vx-clip-count')
    var notesWrap = host.querySelector('#vx-upload-notes-wrap')
    var notesField = host.querySelector('#vx-upload-notes')
    var submitBtn = host.querySelector('#vx-upload-submit')
    var cancelBtn = host.querySelector('#vx-upload-cancel')
    var progress = host.querySelector('#vx-upload-progress')
    var progressText = host.querySelector('#vx-upload-progress-text')

    function handleFiles(fileList) {
      var arr = Array.from(fileList)
      // Check if multiple videos — combine mode
      var videos = arr.filter(function (f) { return f.type.startsWith('video/') })
      if (videos.length >= 2) {
        // Multi-video combine mode
        pendingFiles = videos
        showClipList()
      } else if (arr.length === 1) {
        // Single file mode
        pendingFiles = [arr[0]]
        showNotesStep()
      } else if (arr.length > 1 && videos.length < 2) {
        // Multiple files but not enough videos — upload first one only
        pendingFiles = [arr[0]]
        showNotesStep()
      }
    }

    zone.addEventListener('click', function () { input.click() })
    zone.addEventListener('dragover', function (e) {
      e.preventDefault()
      zone.style.borderColor = 'var(--t1)'
      zone.style.background = 'var(--s1)'
    })
    zone.addEventListener('dragleave', function () {
      zone.style.borderColor = 'var(--b2)'
      zone.style.background = 'none'
    })
    zone.addEventListener('drop', function (e) {
      e.preventDefault()
      zone.style.borderColor = 'var(--b2)'
      zone.style.background = 'none'
      if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files)
    })
    input.addEventListener('change', function () {
      if (input.files.length) handleFiles(input.files)
    })

    function showClipList() {
      zone.style.display = 'none'
      clipListWrap.style.display = 'block'
      notesWrap.style.display = 'block'
      submitBtn.textContent = 'Combine & send to Riley'
      clipCount.textContent = pendingFiles.length + ' clips'
      renderClipList(pendingFiles, clipItems)
      wireClipActions()
    }

    function wireClipActions() {
      // Remove buttons
      clipItems.querySelectorAll('[data-remove-clip]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var idx = parseInt(btn.dataset.removeClip)
          pendingFiles.splice(idx, 1)
          if (pendingFiles.length < 2) {
            // Not enough for combine — switch to single or reset
            if (pendingFiles.length === 1) {
              clipListWrap.style.display = 'none'
              submitBtn.textContent = 'Send to Riley'
            } else {
              resetUpload()
              return
            }
          }
          clipCount.textContent = pendingFiles.length + ' clips'
          renderClipList(pendingFiles, clipItems)
          wireClipActions()
        })
      })

      // Drag reorder
      var dragSrc = null
      clipItems.querySelectorAll('[data-clip-idx]').forEach(function (el) {
        el.addEventListener('dragstart', function (e) {
          dragSrc = parseInt(el.dataset.clipIdx)
          el.style.opacity = '0.5'
        })
        el.addEventListener('dragover', function (e) {
          e.preventDefault()
          el.style.borderColor = 'var(--t1)'
        })
        el.addEventListener('dragleave', function () {
          el.style.borderColor = 'var(--b1)'
        })
        el.addEventListener('drop', function (e) {
          e.preventDefault()
          el.style.borderColor = 'var(--b1)'
          var dragDest = parseInt(el.dataset.clipIdx)
          if (dragSrc !== null && dragSrc !== dragDest) {
            var moved = pendingFiles.splice(dragSrc, 1)[0]
            pendingFiles.splice(dragDest, 0, moved)
            renderClipList(pendingFiles, clipItems)
            wireClipActions()
          }
        })
        el.addEventListener('dragend', function () {
          el.style.opacity = '1'
        })
      })
    }

    function showNotesStep() {
      zone.style.display = 'none'
      clipListWrap.style.display = 'none'
      notesWrap.style.display = 'block'
      submitBtn.textContent = pendingFiles.length > 1 ? 'Combine & send to Riley' : 'Send to Riley'
    }

    function resetUpload() {
      pendingFiles = []
      notesWrap.style.display = 'none'
      clipListWrap.style.display = 'none'
      zone.style.display = 'block'
      notesField.value = ''
      input.value = ''
      submitBtn.textContent = 'Send to Riley'
    }

    cancelBtn.addEventListener('click', resetUpload)

    submitBtn.addEventListener('click', async function () {
      console.log('[content] submit clicked, pendingFiles:', pendingFiles.length)
      if (!pendingFiles.length) { console.warn('[content] no pending files'); return }
      notesWrap.style.display = 'none'
      clipListWrap.style.display = 'none'
      progress.style.display = 'block'

      // Reset progress bar
      uploadProgress.percent = 0
      uploadProgress.label = 'Preparing...'
      updateProgressUI()

      var notes = notesField.value.trim()
      var result

      if (pendingFiles.length > 1) {
        uploadProgress.label = 'Uploading ' + pendingFiles.length + ' clips...'
        updateProgressUI()
        result = await uploadCombined(pendingFiles, notes)
      } else {
        uploadProgress.label = 'Uploading...'
        updateProgressUI()
        result = await uploadFile(pendingFiles[0], notes)
      }

      // Show 100% briefly
      uploadProgress.percent = 100
      uploadProgress.label = 'Sent to Riley for review'
      updateProgressUI()

      progress.style.display = 'none'
      resetUpload()

      if (result?.success) {
        await loadUploads(host)
      }
    })

    // Load uploads + posts
    await loadUploads(host)
    await renderPostsSection(host)
  }

  async function loadUploads(host) {
    var list = host.querySelector('#vx-uploads-list')
    var items = await fetchUploads()

    // Split into active (pending/delivered) and unreleased (saved but not posted)
    var active = []
    var unreleased = []
    var completed = []
    items.forEach(function (item) {
      var ua = item.userAction || {}
      if (ua.type === 'save_unreleased') {
        unreleased.push(item)
      } else if (item.status === 'approved' || item.status === 'rejected') {
        completed.push(item)
      } else {
        active.push(item)
      }
    })

    var html = ''

    // Active uploads (pending review / awaiting decision)
    if (active.length) {
      html += '<div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--t3);margin-bottom:12px">Awaiting Review</div>'
        + active.map(reviewCard).join('')
    }

    // Unreleased content (saved but not posted)
    if (unreleased.length) {
      // Alert banner when unreleased pile gets to 25+
      if (unreleased.length >= 25) {
        html += '<div style="margin:24px 0 16px;padding:14px 18px;background:rgba(232,200,122,.1);border:1px solid rgba(232,200,122,.25);border-radius:10px;display:flex;align-items:flex-start;gap:12px">'
          + '<span style="font-size:20px;flex-shrink:0">⚠️</span>'
          + '<div>'
          + '<div style="font-size:13px;font-weight:600;color:#e8c87a;margin-bottom:4px">You have ' + unreleased.length + ' unreleased items</div>'
          + '<p style="font-size:12px;color:var(--t2);margin:0;line-height:1.5">Take a few minutes to go through your saved content — release what\'s ready, scrap what\'s not. Keeping this list short means less backlog and fresher content.</p>'
          + '</div>'
          + '</div>'
      }
      html += '<div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--t3);margin:24px 0 12px">Unreleased Content <span style="color:var(--t2)">(' + unreleased.length + ')</span></div>'
        + unreleased.map(reviewCard).join('')
    }

    // Completed (posted or scrapped) — collapsed
    if (completed.length) {
      html += '<details style="margin-top:24px"><summary style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--t3);cursor:pointer;margin-bottom:12px">History (' + completed.length + ')</summary>'
        + completed.map(reviewCard).join('')
        + '</details>'
    }

    if (!html) {
      list.innerHTML = '<div style="text-align:center;padding:40px 24px;color:var(--t3)">'
        + '<p style="font-size:14px;margin:0 0 4px">No uploads yet</p>'
        + '<p style="font-size:12px;margin:0">Upload a video or image above and Riley will review it</p>'
        + '</div>'
      return
    }

    list.innerHTML = html

    // Wire double-confirm post buttons (approve / post_anyway / release)
    list.querySelectorAll('[data-vx-confirm-post]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var action = btn.dataset.vxConfirmPost
        var taskId = btn.dataset.taskId
        showPostConfirm(taskId, action, function () { loadUploads(host) })
      })
    })

    // Wire non-post action buttons (accept_notes, save_unreleased, reject)
    list.querySelectorAll('[data-vx-upload-action]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var action = btn.dataset.vxUploadAction
        var taskId = btn.dataset.taskId
        btn.disabled = true
        btn.textContent = 'Processing...'
        await sendAction(taskId, action)
        await loadUploads(host)
      })
    })

    // Wire "Apply all edits" buttons
    list.querySelectorAll('[data-vx-apply-edits]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var taskId = btn.dataset.taskId
        btn.disabled = true
        // Replace button with progress bar
        var parent = btn.parentElement
        var progressEl = document.createElement('div')
        progressEl.style.cssText = 'margin-top:8px;padding:10px 14px;background:var(--s2);border-radius:8px'
        progressEl.innerHTML = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">'
          + '<div style="width:8px;height:8px;border-radius:50%;background:#b482ff;animation:pulse 1.5s infinite"></div>'
          + '<span style="font-size:12px;color:var(--t2)">Applying edits — downloading, processing, uploading...</span>'
          + '</div>'
          + '<div style="height:4px;background:var(--s3);border-radius:2px;overflow:hidden">'
          + '<div style="width:30%;height:100%;background:linear-gradient(90deg,#b482ff,#6ab4ff);border-radius:2px;animation:editProgress 3s ease-in-out infinite"></div>'
          + '</div>'
        btn.style.display = 'none'
        if (parent) parent.appendChild(progressEl)

        try {
          var res = await fetch('/api/uploads/' + taskId + '/apply-edits', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          })
          if (!res.ok) {
            var err = await res.json().catch(function () { return {} })
            alert('Edit failed: ' + (err.error || res.statusText))
            progressEl.remove()
            btn.style.display = ''
            btn.disabled = false
            return
          }
          // Refresh to show the before/after
          await loadUploads(host)
        } catch (e) {
          alert('Edit error: ' + e.message)
          progressEl.remove()
          btn.style.display = ''
          btn.disabled = false
        }
      })
    })

    // Auto-refresh every 5s while any tasks are still in_progress/pending
    var hasPending = items.some(function (i) { return i.status === 'in_progress' || i.status === 'pending' })
    if (hasPending) {
      if (window._vxUploadPoll) clearTimeout(window._vxUploadPoll)
      window._vxUploadPoll = setTimeout(function () { loadUploads(host) }, 5000)
    }
  }

  // Pulse animation for loading states
  if (!document.querySelector('#vx-content-pulse-style')) {
    var style = document.createElement('style')
    style.id = 'vx-content-pulse-style'
    style.textContent = '@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:.4 } } @keyframes editProgress { 0% { width:10%;margin-left:0 } 50% { width:60%;margin-left:20% } 100% { width:10%;margin-left:90% } }'
    document.head.appendChild(style)
  }
})()
