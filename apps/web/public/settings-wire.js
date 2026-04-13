/* Vexa — settings page: prefill inputs from /api/company/me, wire save
 * buttons to PATCH /api/company/:id (plus user-level email/name fields).
 */
;(function () {
  let state = { user: null, company: null }

  async function loadMe() {
    const [me, cr] = await Promise.all([
      fetch('/api/auth/me', { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/company/me', { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
    state.user = me?.user || null
    state.company = cr?.company || null
    prefill()
  }

  function prefill() {
    const u = state.user, c = state.company
    if (!u && !c) return

    // Profile panel (fields are positional — first two inputs in #settings-profile)
    const profInputs = document.querySelectorAll('#settings-profile .settings-input')
    if (profInputs[0]) profInputs[0].value = u?.fullName ?? ''
    if (profInputs[1]) profInputs[1].value = u?.email ?? ''

    // Brand panel: Tone / Avoid / Audience
    const brandInputs = document.querySelectorAll('#settings-brand .settings-input')
    const bv = c?.brandVoice || {}
    if (brandInputs[0]) brandInputs[0].value = Array.isArray(bv.tone) ? bv.tone.join(', ') : (bv.tone ?? '')
    if (brandInputs[1]) brandInputs[1].value = Array.isArray(bv.avoid) ? bv.avoid.join(', ') : (bv.avoid ?? '')
    const aud = c?.audience || {}
    if (brandInputs[2]) brandInputs[2].value = aud.description || ''

    // Niche panel
    const nicheInputs = document.querySelectorAll('#settings-niche .settings-input')
    if (nicheInputs[0]) nicheInputs[0].value = c?.niche ?? ''
    if (nicheInputs[1]) nicheInputs[1].value = c?.subNiche ?? ''
  }

  async function patchCompany(payload) {
    if (!state.company) return null
    const res = await fetch('/api/company/' + state.company.id, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) return null
    const json = await res.json()
    state.company = json.company
    return state.company
  }

  async function saveProfile(btn) {
    const inputs = document.querySelectorAll('#settings-profile .settings-input')
    const fullName = inputs[0]?.value || undefined
    const email = inputs[1]?.value || undefined
    flashButton(btn, 'Saving…')
    await patchCompany({ fullName, email })
    state.user = { ...(state.user || {}), fullName, email }
    flashButton(btn, 'Saved ✓', 1400, 'Save changes')
  }

  async function saveBrand(btn) {
    const inputs = document.querySelectorAll('#settings-brand .settings-input')
    const toneRaw = inputs[0]?.value || ''
    const avoidRaw = inputs[1]?.value || ''
    const audienceRaw = inputs[2]?.value || ''
    const payload = {
      brandVoice: {
        tone: toneRaw.split(',').map((s) => s.trim()).filter(Boolean),
        avoid: avoidRaw.split(',').map((s) => s.trim()).filter(Boolean),
      },
      audience: { description: audienceRaw },
    }
    flashButton(btn, 'Saving…')
    await patchCompany(payload)
    flashButton(btn, 'Saved ✓', 1400, 'Save changes')
  }

  async function saveNiche(btn) {
    const inputs = document.querySelectorAll('#settings-niche .settings-input')
    const payload = { niche: inputs[0]?.value || undefined, subNiche: inputs[1]?.value || null }
    flashButton(btn, 'Saving…')
    await patchCompany(payload)
    flashButton(btn, 'Saved ✓', 1400, 'Save changes')
  }

  function flashButton(btn, text, revertMs, revertText) {
    if (!btn) return
    btn.dataset.origText = btn.dataset.origText || btn.textContent
    btn.textContent = text
    btn.disabled = true
    if (revertMs) {
      setTimeout(() => {
        btn.textContent = revertText || btn.dataset.origText
        btn.disabled = false
      }, revertMs)
    }
  }

  function wireSaveButtons() {
    const profileBtn = document.querySelector('#settings-profile .settings-save')
    const brandBtn = document.querySelector('#settings-brand .settings-save')
    const nicheBtn = document.querySelector('#settings-niche .settings-save')
    if (profileBtn && !profileBtn.dataset.vxWired) {
      profileBtn.addEventListener('click', () => saveProfile(profileBtn))
      profileBtn.dataset.vxWired = '1'
    }
    if (brandBtn && !brandBtn.dataset.vxWired) {
      brandBtn.addEventListener('click', () => saveBrand(brandBtn))
      brandBtn.dataset.vxWired = '1'
    }
    if (nicheBtn && !nicheBtn.dataset.vxWired) {
      nicheBtn.addEventListener('click', () => saveNiche(nicheBtn))
      nicheBtn.dataset.vxWired = '1'
    }
  }

  function init() {
    wireSaveButtons()
    if (document.getElementById('view-db-settings')) loadMe()
  }

  const prevEnter = window.enterDashboard
  window.enterDashboard = async function () {
    if (typeof prevEnter === 'function') await prevEnter()
    setTimeout(init, 120)
  }

  document.addEventListener('DOMContentLoaded', () => setTimeout(init, 250))
  if (document.readyState !== 'loading') setTimeout(init, 350)
})()
