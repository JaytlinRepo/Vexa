/**
 * Returns a minimal HTML page for OAuth callbacks.
 *
 * The opener relationship is often severed by Facebook/TikTok's
 * Cross-Origin-Opener-Policy headers during the redirect chain, so
 * `window.opener` may be null even when this page is loaded inside a
 * popup. We therefore:
 *   1. Broadcast completion via localStorage so the parent tab can
 *      detect it without needing an opener reference.
 *   2. Try window.close() unconditionally — popups opened via
 *      window.open() can close themselves regardless of opener state.
 *   3. Only navigate to fallbackUrl if close() actually failed (real
 *      full-page-nav case, e.g. mobile Safari with popup blocked).
 */
export function oauthSuccessPage(fallbackUrl: string | null): string {
  const redirect = fallbackUrl ? JSON.stringify(fallbackUrl) : 'null'
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:system-ui,sans-serif;background:#0a0a0a;color:#e5e5e5}</style>
</head><body>
<p style="font-size:15px;opacity:.6">Connected — closing…</p>
<script>
(function(){
  var fallback=${redirect};
  // Signal the parent tab via localStorage (works even when COOP severed opener).
  try{
    localStorage.setItem('vx-oauth-complete', String(Date.now()));
    localStorage.removeItem('vx-oauth-complete');
  }catch(_){ }
  // Try to refocus the opener if it's still reachable.
  try{ if(window.opener&&!window.opener.closed) window.opener.focus(); }catch(_){ }
  // Always attempt to close — popups opened via window.open() can self-close
  // regardless of opener state. Detect failure and only then navigate.
  window.close();
  setTimeout(function(){
    if(!window.closed && fallback){ window.location.replace(fallback); }
  }, 300);
})();
</script>
</body></html>`
}
