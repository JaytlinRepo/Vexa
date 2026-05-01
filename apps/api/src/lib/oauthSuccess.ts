/**
 * Returns a minimal HTML page for OAuth callbacks.
 * If opened in a popup (window.opener exists): closes itself so the parent
 * can poll for completion. If opened as a full navigation (direct or new tab):
 * redirects to fallbackUrl, or shows a plain success message if no URL given.
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
  if(window.opener&&!window.opener.closed){
    window.close();
  } else if(fallback){
    window.location.replace(fallback);
  }
})();
</script>
</body></html>`
}
