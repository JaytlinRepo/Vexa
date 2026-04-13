/* Vexa — test-mode banner.
 * Shows a yellow striped bar across the top whenever the API reports
 * VEXA_MODE=test, so testers always know no real external calls are firing.
 */
;(function () {
  async function check() {
    try {
      const res = await fetch('/api/mode', { cache: 'no-store', credentials: 'same-origin' })
      if (!res.ok) return 'live'
      const json = await res.json()
      return json?.mode || 'live'
    } catch {
      return 'live'
    }
  }

  function mount(mode) {
    if (mode !== 'test') return
    if (document.getElementById('vx-test-banner')) return
    const bar = document.createElement('div')
    bar.id = 'vx-test-banner'
    bar.style.cssText = `
      position:fixed;top:0;left:0;right:0;z-index:10000;
      background:repeating-linear-gradient(45deg,#e8c87a,#e8c87a 12px,#d9b85e 12px,#d9b85e 24px);
      color:#1a1400;padding:8px 16px;text-align:center;font-size:12px;font-weight:600;
      letter-spacing:.08em;text-transform:uppercase;font-family:'DM Sans',sans-serif;
      border-bottom:1px solid #9a8540
    `
    bar.textContent = 'Test mode — external services (Bedrock / Stripe / Meta) are stubbed. No real costs.'
    document.body.prepend(bar)
    document.body.style.paddingTop = '32px'
  }

  check().then(mount)
})()
