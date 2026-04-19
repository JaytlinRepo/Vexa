'use client'

import { useLayoutEffect } from 'react'

declare global {
  interface Window {
    toggleTheme: () => void
  }
}

/**
 * Ensures data-theme + window.toggleTheme survive React hydration and work on
 * every route (not only / where prototype.js loads).
 */
export default function SovexaThemeBridge() {
  useLayoutEffect(() => {
    const html = document.documentElement
    function applyFromStorage() {
      try {
        const t = localStorage.getItem('vx-t')
        if (t === 'light' || t === 'dark') {
          html.setAttribute('data-theme', t)
        } else {
          localStorage.setItem('vx-t', 'light')
          html.setAttribute('data-theme', 'light')
        }
      } catch {
        html.setAttribute('data-theme', 'light')
      }
    }
    applyFromStorage()

    window.toggleTheme = function vexaToggleTheme() {
      const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'
      html.setAttribute('data-theme', next)
      try {
        localStorage.setItem('vx-t', next)
      } catch {
        /* ignore */
      }
    }
  }, [])

  return null
}
