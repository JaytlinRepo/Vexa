'use client'
import { useEffect } from 'react'

export default function OAuthClose() {
  useEffect(() => {
    try {
      // Signal the opener via localStorage — same origin as parent window,
      // so the storage event fires reliably (cross-origin would silently fail).
      localStorage.setItem('vx-oauth-complete', String(Date.now()))
      localStorage.removeItem('vx-oauth-complete')
    } catch (_) {}

    // Try to refocus the opener tab before closing the popup.
    try {
      if (window.opener && !window.opener.closed) window.opener.focus()
    } catch (_) {}

    window.close()

    // window.close() is often blocked after cross-origin OAuth redirects.
    // Always navigate home after a short grace period so the popup tab
    // doesn't sit on this page.
    const t = setTimeout(() => {
      window.location.replace('/')
    }, 500)
    return () => clearTimeout(t)
  }, [])

  return (
    <div
      style={{
        margin: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        fontFamily: 'system-ui, sans-serif',
        background: '#0a0a0a',
        color: '#e5e5e5',
      }}
    >
      <p style={{ fontSize: 15, opacity: 0.6 }}>Connected — closing…</p>
    </div>
  )
}
