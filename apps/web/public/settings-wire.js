/* Sovexa — settings page: prefill inputs from /api/company/me, wire save
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

  // ── Billing ──────────────────────────────────────────────
  var PLANS = [
    { id:'starter', name:'Starter', price:'$14.99', features:['2 employees (Maya + Alex)','30 tasks/month','Basic brand voice','No meetings'] },
    { id:'pro', name:'Pro', price:'$49.99', features:['All 4 employees','Unlimited tasks','Meetings + brand memory','Weekly reports','Knowledge feed'], popular:true },
    { id:'agency', name:'Agency', price:'$89.99', features:['Up to 5 workspaces','Everything in Pro','Priority processing','Advanced analytics'] },
  ]

  async function loadBilling() {
    var statusEl = document.getElementById('vx-billing-status')
    var cardsEl = document.getElementById('vx-plan-cards')
    var manageBtn = document.getElementById('vx-billing-manage')
    if (!statusEl || !cardsEl) return

    try {
      var res = await fetch('/api/stripe/subscription', { credentials:'include' })
      var sub = res.ok ? await res.json() : null

      if (!sub) { statusEl.textContent = 'Unable to load subscription.'; return }

      var isTrial = sub.status === 'trial'
      var isActive = sub.status === 'active'
      var isCanceled = sub.status === 'canceled'
      var isPastDue = sub.status === 'past_due'

      if (isTrial && sub.trialDaysLeft != null) {
        statusEl.innerHTML = '<span style="color:var(--accent)">' + sub.plan.charAt(0).toUpperCase() + sub.plan.slice(1) + ' Trial</span> — ' + sub.trialDaysLeft + ' days left'
      } else if (isActive) {
        statusEl.innerHTML = '<span style="color:#34d27a">' + sub.plan.charAt(0).toUpperCase() + sub.plan.slice(1) + ' Plan</span> — Active'
      } else if (isCanceled) {
        statusEl.innerHTML = '<span style="color:#e87a7a">Canceled</span> — subscribe to continue using Sovexa'
      } else if (isPastDue) {
        statusEl.innerHTML = '<span style="color:#e87a7a">Payment failed</span> — update your payment method'
      }

      // Show manage button if they have a Stripe customer
      if (sub.hasStripeCustomer && manageBtn) {
        manageBtn.style.display = ''
        manageBtn.onclick = async function () {
          manageBtn.textContent = 'Opening...'
          var r = await fetch('/api/stripe/portal', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body:'{}' })
          if (r.ok) { var d = await r.json(); window.open(d.url, '_blank') }
          else { alert('Could not open billing portal.') }
          manageBtn.textContent = 'Manage billing'
        }
      }

      // Render plan cards
      cardsEl.innerHTML = PLANS.map(function (p) {
        var isCurrent = sub.plan === p.id && (isActive || isTrial)
        return '<div style="background:var(--s1);border:1px solid ' + (p.popular ? 'var(--accent)' : 'var(--b1)') + ';border-radius:12px;padding:20px;position:relative;' + (isCurrent ? 'box-shadow:0 0 0 1px var(--accent)' : '') + '">'
          + (p.popular ? '<div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);font-size:9px;letter-spacing:.12em;text-transform:uppercase;padding:3px 10px;border-radius:4px;background:var(--accent);color:var(--inv)">Most popular</div>' : '')
          + '<div style="font-size:16px;font-weight:600;color:var(--t1);margin-bottom:4px">' + p.name + '</div>'
          + '<div style="margin-bottom:12px"><span style="font-size:24px;font-weight:600;color:var(--t1)">' + p.price + '</span><span style="font-size:12px;color:var(--t3)">/mo</span></div>'
          + '<div style="font-size:11px;color:var(--t3);margin-bottom:14px">' + p.annual + '/mo billed annually</div>'
          + p.features.map(function (f) { return '<div style="font-size:12px;color:var(--t2);padding:3px 0;display:flex;align-items:center;gap:6px"><span style="color:#34d27a;font-size:10px">+</span>' + f + '</div>' }).join('')
          + '<button data-vx-checkout="' + p.id + '" style="margin-top:14px;width:100%;padding:10px;border-radius:8px;border:1px solid ' + (isCurrent ? 'var(--b2)' : 'var(--t1)') + ';background:' + (isCurrent ? 'transparent' : 'var(--t1)') + ';color:' + (isCurrent ? 'var(--t2)' : 'var(--inv)') + ';font-size:12px;font-weight:500;cursor:pointer;font-family:inherit">' + (isCurrent ? 'Current plan' : 'Choose ' + p.name) + '</button>'
          + '</div>'
      }).join('')

      // Wire checkout buttons
      cardsEl.querySelectorAll('[data-vx-checkout]').forEach(function (btn) {
        if (btn.textContent === 'Current plan') { btn.disabled = true; return }
        btn.addEventListener('click', async function () {
          btn.textContent = 'Redirecting...'
          btn.disabled = true
          var r = await fetch('/api/stripe/checkout', {
            method:'POST', credentials:'include',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ plan: btn.dataset.vxCheckout, billing: 'monthly' }),
          })
          if (r.ok) {
            var d = await r.json()
            window.location.href = d.url
          } else {
            var err = await r.json().catch(function(){return{}})
            alert('Checkout error: ' + (err.error || 'Unknown error'))
            btn.textContent = 'Choose ' + btn.dataset.vxCheckout.charAt(0).toUpperCase() + btn.dataset.vxCheckout.slice(1)
            btn.disabled = false
          }
        })
      })
    } catch (e) {
      statusEl.textContent = 'Error loading subscription.'
    }
  }

  function init() {
    wireSaveButtons()
    if (document.getElementById('view-db-settings')) { loadMe(); loadBilling() }
  }

  const prevEnter = window.enterDashboard
  window.enterDashboard = async function () {
    if (typeof prevEnter === 'function') await prevEnter()
    setTimeout(init, 120)
  }

  document.addEventListener('DOMContentLoaded', () => setTimeout(init, 250))
  if (document.readyState !== 'loading') setTimeout(init, 350)
})()
