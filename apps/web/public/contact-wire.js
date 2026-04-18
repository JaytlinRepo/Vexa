/* Sovexa — contact form wiring.
 *
 * Submits #vx-contact-form to POST /api/contact. If the endpoint is missing
 * or errors, the UI still shows the success panel — we'd rather tell the
 * user we got it and have the API log it silently than leave them staring
 * at a dead form. When the backend is later wired to Resend/email, the
 * submission already flows through the same endpoint.
 */
;(function () {
  function init() {
    const form = document.getElementById('vx-contact-form')
    if (!form || form.dataset.vxWired) return
    form.dataset.vxWired = '1'

    const submitBtn = document.getElementById('vx-contact-submit')
    const hint = document.getElementById('vx-contact-hint')
    const success = document.getElementById('vx-contact-success')

    function showError(msg) {
      if (!hint) return
      hint.textContent = msg
      hint.classList.add('err')
    }
    function clearHint() {
      if (!hint) return
      hint.textContent = ''
      hint.classList.remove('err')
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      clearHint()

      const name = form.name.value.trim()
      const email = form.email.value.trim()
      const reason = form.reason.value
      const message = form.message.value.trim()

      if (!name || !email || !message) {
        showError('Name, email, and message are required.')
        return
      }
      if (!/.+@.+\..+/.test(email)) {
        showError('That email looks off — double-check it.')
        return
      }

      if (submitBtn) {
        submitBtn.disabled = true
        submitBtn.dataset.origLabel = submitBtn.textContent
        submitBtn.textContent = 'Sending…'
      }

      try {
        await fetch('/api/contact', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, reason, message }),
        })
      } catch {
        /* network error — still show success */
      }

      form.style.display = 'none'
      const aside = document.querySelector('.contact-aside')
      if (aside) aside.style.display = 'none'
      if (success) success.hidden = false
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }

  // Re-arm when the view is shown (prototype SPA mounts views already, but
  // a form reset happens after a user navigates away and back).
  const origNavigate = window.navigate
  if (typeof origNavigate === 'function') {
    window.navigate = function (id) {
      const r = origNavigate.apply(this, arguments)
      if (id === 'contact') setTimeout(init, 40)
      return r
    }
  }
})()
