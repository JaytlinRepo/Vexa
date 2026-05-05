/* Sovexa — settings page: prefill inputs from /api/company/me, wire save
 * buttons to PATCH /api/company/:id (profile, niche; brand voice UI removed).
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

    // Niche tab — unhide when company exists, then prefill
    const nichePanel = document.getElementById('settings-niche')
    const nicheTab = document.getElementById('vx-settings-niche-tab')
    if (c && nichePanel) {
      nichePanel.hidden = false
      if (nicheTab) nicheTab.hidden = false
      const nicheInputs = document.querySelectorAll('#settings-niche .settings-input')
      if (nicheInputs[0]) nicheInputs[0].value = c?.niche ?? ''
      if (nicheInputs[1]) nicheInputs[1].value = c?.subNiche ?? ''
    }

    // Community sharing toggle (Profile section) — skip when UI is hidden
    const csWrap = document.getElementById('settings-community-section')
    const csCb = document.getElementById('settings-community-opt-in')
    const csStatus = document.getElementById('settings-community-status')
    if (csWrap && !csWrap.hidden && csCb) {
      csCb.checked = !!c?.communityOptIn
      if (csStatus) {
        csStatus.textContent = c?.communityOptIn
          ? `On · since ${c.communityOptInAt ? new Date(c.communityOptInAt).toLocaleDateString() : '—'}`
          : 'Off — your content stays private to your team.'
      }
    }
  }

  async function patchCommunityOptIn(optIn) {
    const res = await fetch('/api/company/me/community-opt-in', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ optIn, agreementVersion: 'v1' }),
    })
    return res.ok
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
    const nichePanelEl = document.getElementById('settings-niche')
    const nicheBtn =
      nichePanelEl && !nichePanelEl.hidden ? document.querySelector('#settings-niche .settings-save') : null
    if (profileBtn && !profileBtn.dataset.vxWired) {
      profileBtn.addEventListener('click', () => saveProfile(profileBtn))
      profileBtn.dataset.vxWired = '1'
    }
    if (nicheBtn && !nicheBtn.dataset.vxWired) {
      nicheBtn.addEventListener('click', () => saveNiche(nicheBtn))
      nicheBtn.dataset.vxWired = '1'
    }

    // Community sharing toggle — direct PATCH on change, with inline status
    const csWrap = document.getElementById('settings-community-section')
    const csCb = document.getElementById('settings-community-opt-in')
    if (csWrap && !csWrap.hidden && csCb && !csCb.dataset.vxWired) {
      csCb.dataset.vxWired = '1'
      csCb.addEventListener('change', async () => {
        const desired = csCb.checked
        const status = document.getElementById('settings-community-status')
        if (status) status.textContent = 'Saving…'
        const ok = await patchCommunityOptIn(desired)
        if (!ok) {
          csCb.checked = !desired
          if (status) status.textContent = 'Could not save — please try again.'
          return
        }
        if (state.company) {
          state.company.communityOptIn = desired
          state.company.communityOptInAt = desired ? new Date().toISOString() : null
        }
        if (status) {
          status.textContent = desired
            ? 'On · your content can appear in the Knowledge feed'
            : 'Off — your content stays private to your team.'
        }
      })
    }
  }

  // ── Billing — cards + Stripe checkout (GET /api/stripe/subscription) ─────
  var PLANS = [
    { id:'free', name:'Free', price:'$0', billingNote:'Free forever · no card required',
      features:['All three employees · quality parity','5 tasks/month','2 Studio edits/month','No meetings, brand memory, or heavy video','Great for proving fit'] },
    { id:'pro', name:'Pro', price:'$29', billingNote:'Billed monthly · annual at checkout',
      features:['75 tasks/month','5 videos/month','6 Studio edits/month','Brand voice · knowledge feed','No meetings or brand memory'] },
    { id:'max', name:'Max', price:'$59', billingNote:'Billed monthly · annual at checkout', popular:true,
      features:['200 tasks/month','Meetings · brand memory','15 videos/month','20 Studio edits/month','Weekly trend pulse · priority flow'] },
    { id:'agency', name:'Agency', price:'$149', billingNote:'Billed monthly · annual at checkout',
      features:['Up to five workspaces · 75 videos/mo','1,000 tasks/month','30 Studio edits/month','Everything in Max per workspace','Priority processing'] },
  ]

  function planDisplayName (id) {
    var row = PLANS.find(function (p) { return p.id === id })
    if (row) return row.name
    if (!id) return 'Unknown'
    return id.charAt(0).toUpperCase() + id.slice(1)
  }

  function subscriptionIsLive (sub) {
    if (!sub) return false
    return ['active', 'past_due'].indexOf(sub.status) !== -1
  }

  function formatResetDate (iso) {
    if (!iso) return ''
    try {
      return new Date(iso).toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric', year:'numeric' })
    } catch (__) { return '' }
  }

  /** Plan matches and subscription still authorizes paid features */
  function isOnPlan (sub, planId) {
    if (!sub || sub.plan !== planId) return false
    return ['active', 'past_due'].indexOf(sub.status) !== -1
  }

  async function loadBilling() {
    var statusEl = document.getElementById('vx-billing-status')
    var usageEl = document.getElementById('vx-billing-usage')
    var cardsEl = document.getElementById('vx-plan-cards')
    var manageBtn = document.getElementById('vx-billing-manage')
    if (!statusEl || !cardsEl) return

    var clearUsage = function () {
      if (usageEl) { usageEl.hidden = true; usageEl.textContent = '' }
    }

    try {
      var res = await fetch('/api/stripe/subscription', { credentials:'include' })
      var sub = await res.json().catch(function () { return null })
      if (!res.ok || !sub || sub.error) {
        statusEl.textContent = 'Could not load subscription. Refresh the page or sign in again.'
        cardsEl.innerHTML = ''
        clearUsage()
        if (manageBtn) manageBtn.style.display = 'none'
        return
      }

      var st = sub.status
      var isCanceled = st === 'canceled'
      var isPastDue = st === 'past_due'
      var isActive = st === 'active'
      var tierName = planDisplayName(sub.plan)

      if (isPastDue) {
        statusEl.innerHTML = '<strong style="font-weight:600;color:var(--t1)">' + tierName + '</strong>'
          + ' · <span style="color:#e87a7a;font-weight:500">payment issue</span> — '
          + 'We couldn\'t process your last payment. Update your card in <strong>Manage billing</strong> or pick a plan again.'
      } else if (isCanceled) {
        statusEl.innerHTML = '<span style="color:#e87a7a;font-weight:500">No active subscription</span> · '
          + 'Choose Pro, Max, or Agency below to reconnect billing.'
      } else if (isActive && sub.plan === 'free') {
        statusEl.innerHTML = '<strong style="font-weight:600;color:var(--t1)">Free</strong>'
          + ' · <span style="color:#34d27a;font-weight:500">Active</span> · '
          + 'Upgrade to Max or Agency to unlock meetings, full video volume, and brand memory.'
      } else if (isActive) {
        statusEl.innerHTML = '<strong style="font-weight:600;color:var(--t1)">' + tierName + '</strong>'
          + ' · <span style="color:#34d27a;font-weight:500">Active</span> · '
          + 'Renewals and receipts stay in your billing portal — use Manage billing anytime.'
      } else {
        statusEl.innerHTML = '<strong style="font-weight:600;color:var(--t1)">' + tierName + '</strong>'
          + ' · Subscription status unavailable — refresh or contact support.'
      }

      var tk = sub.usage && sub.usage.tasks
      if (usageEl && tk) {
        var taskPeriod = (sub.usage && sub.usage.resetWindow) === 'daily' ? 'today' : 'this month'
        var parts = ['Tasks · ' + tk.used + ' / ' + tk.limit + ' ' + taskPeriod]
        if (sub.usage.videos && sub.usage.videos.limit > 0) {
          parts.push('Videos · ' + sub.usage.videos.used + ' / ' + sub.usage.videos.limit)
        }
        if (sub.usage.studioEdits && sub.usage.studioEdits.limit > 0) {
          parts.push('Studio edits · ' + sub.usage.studioEdits.used + ' / ' + sub.usage.studioEdits.limit)
        }
        var rs = formatResetDate(tk.resetAt)
        if (rs) parts.push('Resets · ' + rs)
        usageEl.hidden = false
        usageEl.textContent = parts.join(' · ')
      } else clearUsage()

      if (sub.hasStripeCustomer && manageBtn) {
        manageBtn.style.display = ''
        manageBtn.onclick = async function () {
          manageBtn.textContent = 'Opening…'
          var r = await fetch('/api/stripe/portal', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/json' }, body:'{}' })
          if (r.ok) { var d = await r.json(); window.open(d.url, '_blank') }
          else { var errBody = await r.json().catch(function () { return {} }); alert(errBody.error && typeof errBody.error === 'string' && errBody.error.length < 140 ? errBody.error : 'We couldn\'t open billing management. Try again in a moment or contact support.') }
          manageBtn.textContent = 'Manage billing'
        }
      } else if (manageBtn) {
        manageBtn.style.display = 'none'
      }

      cardsEl.style.display = 'grid'
      cardsEl.style.gridTemplateColumns = 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))'
      cardsEl.style.gap = '12px'
      cardsEl.style.marginTop = '20px'
      cardsEl.innerHTML = PLANS.map(function (p) {
        var subscriptionLive = subscriptionIsLive(sub)
        var onThis = subscriptionLive && isOnPlan(sub, p.id)
        var borderCol = p.popular ? 'var(--accent)' : 'var(--b1)'
        var emphasis = onThis ? 'box-shadow:0 0 0 2px rgba(192,138,62,.55);' : ''

        var footBtn
        if (p.id === 'free') {
          footBtn = onThis
            ? '<button type="button" disabled style="margin-top:14px;width:100%;padding:10px;border-radius:8px;border:1px solid var(--b1);background:transparent;color:var(--t3);font-size:12px;font-weight:500;cursor:default;font-family:inherit">Current tier</button>'
            : '<button type="button" disabled style="margin-top:14px;width:100%;padding:10px;border-radius:8px;border:1px dashed var(--b1);background:transparent;color:var(--t3);font-size:11px;line-height:1.35;cursor:default;font-family:inherit">Included at signup · contact support to downgrade.</button>'
        } else if (onThis) {
          footBtn = '<button type="button" disabled style="margin-top:14px;width:100%;padding:10px;border-radius:8px;border:1px solid var(--b1);background:transparent;color:var(--t2);font-size:12px;font-weight:500;cursor:default;font-family:inherit">Current plan</button>'
        } else {
          footBtn = '<button type="button" data-vx-checkout="' + p.id + '" style="margin-top:14px;width:100%;padding:10px;border-radius:8px;border:1px solid var(--t1);background:var(--t1);color:var(--inv);font-size:12px;font-weight:500;cursor:pointer;font-family:inherit">Choose ' + p.name + '</button>'
        }

        return '<div style="background:var(--s1);border:1px solid ' + borderCol + ';border-radius:12px;padding:20px 20px 22px;position:relative;' + emphasis + '">'
          + (p.popular ? '<div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);font-size:9px;letter-spacing:.12em;text-transform:uppercase;padding:3px 10px;border-radius:4px;background:var(--accent);color:var(--inv);white-space:nowrap">Most popular</div>' : '')
          + '<div style="font-size:16px;font-weight:600;color:var(--t1);margin-bottom:4px">' + p.name + '</div>'
          + '<div style="margin-bottom:8px"><span style="font-size:24px;font-weight:600;color:var(--t1)">' + p.price + '</span><span style="font-size:12px;color:var(--t3)"> / mo</span></div>'
          + '<div style="font-size:11px;color:var(--t3);margin-bottom:14px;line-height:1.4">' + p.billingNote + '</div>'
          + p.features.map(function (f) {
            return '<div style="font-size:12px;color:var(--t2);padding:3px 0;display:flex;align-items:flex-start;gap:8px;line-height:1.45">'
              + '<span style="color:#34d27a;font-size:10px;flex-shrink:0;margin-top:2px">+</span><span>' + f + '</span></div>'
          }).join('')
          + footBtn
          + '</div>'
      }).join('')

      cardsEl.querySelectorAll('[data-vx-checkout]').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          var planCard = PLANS.filter(function (x) { return x.id === btn.dataset.vxCheckout })[0]
          var labelAfter = planCard ? planCard.name : (btn.dataset.vxCheckout || 'plan')
          btn.textContent = 'Redirecting…'
          btn.disabled = true
          var r = await fetch('/api/stripe/checkout', {
            method:'POST', credentials:'include',
            headers:{ 'Content-Type':'application/json' },
            body: JSON.stringify({ plan: btn.dataset.vxCheckout, billing: 'monthly' }),
          })
          if (r.ok) {
            var d = await r.json()
            if (d.url) window.location.href = d.url
            else {
              alert('Checkout isn\'t available right now. Please try again in a few minutes.')
              btn.textContent = 'Choose ' + labelAfter
              btn.disabled = false
            }
          } else {
            var err = await r.json().catch(function () { return {} })
            alert(err.error && typeof err.error === 'string' && err.error.length < 140 && err.error.indexOf('HTTP') !== 0
              ? err.error
              : 'We couldn\'t start checkout. Please try again in a few minutes.')
            btn.textContent = 'Choose ' + labelAfter
            btn.disabled = false
          }
        })
      })
    } catch (e) {
      statusEl.textContent = 'We couldn\'t load your plan details. Refresh the page or try again shortly.'
      cardsEl.innerHTML = ''
      clearUsage()
      if (manageBtn) manageBtn.style.display = 'none'
    }
  }

  function init () {
    wireSaveButtons()
    if (document.getElementById('view-db-settings')) { loadMe(); loadBilling() }
  }

  // dashboard-wire restores sessions via navigate() — it does not always call the
  // chained enterDashboard. Hydrate billing + profile whenever Settings opens or
  // the Billing sub-tab is selected (fixes empty Subscription panel).
  function kickSettingsHydration () {
    if (!document.getElementById('view-db-settings')) return
    try { wireSaveButtons() } catch (e) { /* noop */ }
    loadMe().catch(function () {})
    loadBilling().catch(function () {})
  }

  ;(function hookSettingsNavigation () {
    var pn = window.navigate
    if (typeof pn !== 'function') return
    window.navigate = function (id) {
      var ret = pn.apply(this, arguments)
      if (id === 'db-settings') setTimeout(kickSettingsHydration, 0)
      return ret
    }
  })()

  if (typeof window.switchSettings === 'function') {
    var ps = window.switchSettings
    window.switchSettings = function (btn, panel) {
      ps(btn, panel)
      if (panel === 'billing') setTimeout(function () {
        loadBilling().catch(function () {})
      }, 0)
    }
  }

  const prevEnter = window.enterDashboard
  window.enterDashboard = async function () {
    if (typeof prevEnter === 'function') await prevEnter()
    setTimeout(init, 120)
  }

})()
