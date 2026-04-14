'use client'

import Script from 'next/script'

// Bump VERSION any time we change a companion script — the query string
// forces browsers to re-fetch instead of loading the old file from cache.
// In prod this'll be replaced with the build SHA.
const VERSION = '20260414-17'
const v = (path: string) => `${path}?v=${VERSION}`

export default function PrototypeShell({ html }: { html: string }) {
  return (
    <>
      <div
        style={{ display: 'contents' }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <Script src={v('/theme-dark-default.js')} strategy="beforeInteractive" />
      <Script src={v('/prototype.js')} strategy="afterInteractive" />
      <Script src={v('/home-merge.js')} strategy="afterInteractive" />
      <Script src={v('/auth-ui.js')} strategy="afterInteractive" />
      <Script src={v('/dashboard-wire.js')} strategy="afterInteractive" />
      <Script src={v('/meeting-wire.js')} strategy="afterInteractive" />
      <Script src={v('/tasks-wire.js')} strategy="afterInteractive" />
      <Script src={v('/notifications-wire.js')} strategy="afterInteractive" />
      <Script src={v('/feed-wire.js')} strategy="afterInteractive" />
      <Script src={v('/settings-wire.js')} strategy="afterInteractive" />
      <Script src={v('/team-wire.js')} strategy="afterInteractive" />
      <Script src={v('/tasks-view-wire.js')} strategy="afterInteractive" />
      <Script src={v('/outputs-wire.js')} strategy="afterInteractive" />
      <Script src={v('/billing-wire.js')} strategy="afterInteractive" />
      <Script src={v('/test-mode-banner.js')} strategy="afterInteractive" />
      <Script src={v('/memory-wire.js')} strategy="afterInteractive" />
      <Script src={v('/insights-wire.js')} strategy="afterInteractive" />
      <Script src={v('/dashboard-v2.js')} strategy="afterInteractive" />
      <Script src={v('/phyllo-wire.js')} strategy="afterInteractive" />
      <Script src={v('/trajectory-wire.js')} strategy="afterInteractive" />
      <Script src={v('/goal-wire.js')} strategy="afterInteractive" />
      <Script src={v('/scorecard-wire.js')} strategy="afterInteractive" />
      <Script src={v('/work-wire.js')} strategy="afterInteractive" />
      <Script src={v('/idea-wire.js')} strategy="afterInteractive" />
    </>
  )
}
