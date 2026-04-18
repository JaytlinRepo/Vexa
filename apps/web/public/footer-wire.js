/* Vexa — marketing footer.
 *
 * Injects a consistent footer into every marketing view (home, team,
 * how, outputs, knowledge, pricing, faq). Each .view is its own
 * scrollable surface so the footer must be appended inside each one
 * rather than living in a single global slot.
 *
 * Re-injects on navigate so newly-rendered views always have it.
 * Skips app/dashboard views — those have their own chrome.
 */
;(function () {
  const MARKETING_VIEWS = [
    'view-home', 'view-team', 'view-how',
    'view-outputs', 'view-knowledge',
    'view-pricing', 'view-faq',
  ]

  const YEAR = new Date().getFullYear()

  function footerHtml() {
    return `
      <footer class="vx-footer">
        <div class="vx-footer-grid">
          <div class="vx-footer-brand">
            <div class="vx-footer-mark">Vexa</div>
            <p class="vx-footer-tag">Your content. Run by a team.</p>
            <p class="vx-footer-mini">Four AI specialists — analyst, strategist, copywriter, creative director — that plan, write, and produce content for your brand.</p>
          </div>

          <div class="vx-footer-col">
            <div class="vx-footer-label">Product</div>
            <a href="#" data-vx-nav="home">Home</a>
            <a href="#" data-vx-nav="team">The team</a>
            <a href="#" data-vx-nav="how">How it works</a>
            <a href="#" data-vx-nav="outputs">See outputs</a>
            <a href="#" data-vx-nav="knowledge">Knowledge feed</a>
          </div>

          <div class="vx-footer-col">
            <div class="vx-footer-label">Plans</div>
            <a href="#" data-vx-nav="pricing">Pricing</a>
            <a href="#" data-vx-nav="faq">FAQ</a>
            <a href="#" data-vx-action="login">Sign in</a>
            <a href="#" data-vx-action="signup">Start free trial</a>
          </div>

          <div class="vx-footer-col">
            <div class="vx-footer-label">Company</div>
            <a href="#" data-vx-nav="contact">Contact</a>
            <a href="#" data-vx-modal="terms">Terms</a>
            <a href="#" data-vx-modal="privacy">Privacy</a>
            <a href="#" data-vx-modal="security">Security</a>
          </div>
        </div>

        <div class="vx-footer-bottom">
          <div class="vx-footer-copy">© ${YEAR} Vexa. Built for content businesses.</div>
          <div class="vx-footer-meta">v1.0 · made for creators</div>
        </div>
      </footer>
    `
  }

  function injectInto(viewId) {
    const view = document.getElementById(viewId)
    if (!view) return
    if (view.querySelector('.vx-footer')) return
    const inner = view.querySelector('.view-inner') || view
    const footer = document.createElement('div')
    footer.innerHTML = footerHtml()
    inner.appendChild(footer.firstElementChild)
    wireFooterEvents(view)
  }

  function wireFooterEvents(scope) {
    scope.querySelectorAll('.vx-footer [data-vx-nav]').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault()
        const id = a.dataset.vxNav
        if (typeof window.navigate === 'function') window.navigate(id)
      })
    })
    scope.querySelectorAll('.vx-footer [data-vx-action]').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault()
        const action = a.dataset.vxAction
        if (action === 'login' && typeof window.showLogin === 'function') window.showLogin()
        else if (action === 'signup' && typeof window.startOnboarding === 'function') window.startOnboarding()
      })
    })
    scope.querySelectorAll('.vx-footer [data-vx-modal]').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault()
        openLegalModal(a.dataset.vxModal)
      })
    })
  }

  // Lightweight legal/policy modal — placeholder copy until the real
  // documents land. Honest about that.
  function openLegalModal(kind) {
    document.getElementById('vx-legal-modal')?.remove()
    const titles = { terms: 'Terms of Service', privacy: 'Privacy Policy', security: 'Security' }
    const bodies = {
      terms: 'Terms of Service · placeholder. The full document is in legal review and ships with public launch. Reach out at hello@sovexa.ai if you need it sooner — we can share the draft on request.',
      privacy: 'Privacy Policy · placeholder. We collect the minimum needed to run your AI content team: account, brand workspace data, social-platform data you connect via Phyllo. We never sell your data and never share it with other Vexa users. Full document at public launch.',
      security: 'Security · placeholder. All data is encrypted at rest (PostgreSQL) and in transit (TLS). Phyllo holds OAuth tokens — Vexa never sees your social passwords. Full doc at public launch.',
    }
    const el = document.createElement('div')
    el.id = 'vx-legal-modal'
    el.style.cssText =
      'position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);padding:24px'
    el.innerHTML = `
      <div style="width:100%;max-width:520px;background:var(--s1);border:1px solid var(--b1);border-radius:14px;padding:26px 28px;color:var(--t1);font-family:'DM Sans',sans-serif">
        <h3 style="font-family:'Cormorant Garamond',serif;font-size:24px;font-weight:500;margin:0 0 12px">${titles[kind] || 'Legal'}</h3>
        <p style="color:var(--t2);font-size:13px;line-height:1.6;margin:0 0 18px">${bodies[kind] || ''}</p>
        <div style="display:flex;justify-content:flex-end">
          <button id="vx-legal-close" style="background:var(--t1);color:var(--bg);border:none;padding:9px 18px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:600">Close</button>
        </div>
      </div>
    `
    el.addEventListener('click', (e) => { if (e.target === el) el.remove() })
    document.body.appendChild(el)
    el.querySelector('#vx-legal-close').addEventListener('click', () => el.remove())
  }

  function injectAll() {
    MARKETING_VIEWS.forEach(injectInto)
  }

  // Wrap navigate so newly-rendered views (some get re-injected by
  // companion scripts) always have a footer.
  const origNavigate = window.navigate
  window.navigate = function (id) {
    const r = typeof origNavigate === 'function' ? origNavigate(id) : undefined
    if (MARKETING_VIEWS.includes('view-' + id)) {
      setTimeout(() => injectInto('view-' + id), 80)
    }
    return r
  }

  if (document.readyState !== 'loading') setTimeout(injectAll, 200)
  document.addEventListener('DOMContentLoaded', () => setTimeout(injectAll, 250))
  // Light retry — some views (like home with home-merge) rebuild
  // themselves a few times during initial load.
  let attempts = 0
  const tick = setInterval(() => {
    injectAll()
    attempts++
    if (attempts > 20) clearInterval(tick)
  }, 800)
})()
