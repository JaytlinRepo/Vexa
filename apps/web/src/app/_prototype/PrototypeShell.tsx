'use client'

import Script from 'next/script'

// Bump VERSION any time we change a companion script — the query string
// forces browsers to re-fetch instead of loading the old file from cache.
// In prod this'll be replaced with the build SHA.
const VERSION = '20260421-06'
const v = (path: string) => `${path}?v=${VERSION}`

export default function PrototypeShell({ html }: { html: string }) {
  // If the user has a session, strip .active from the home view so it
  // doesn't flash before dashboard-v2 takes over. The dashboard view
  // gets .active instead — blank until v2 renders content into it.
  let processed = html
  if (typeof window !== 'undefined') {
    try {
      if (localStorage.getItem('vx-authed') === '1') {
        processed = processed
          .replace(/id="view-home"([^>]*?)class="([^"]*)\bactive\b([^"]*)"/,
            'id="view-home"$1class="$2$3"')
          .replace(/id="view-db-dashboard"([^>]*?)class="([^"]*)"/,
            'id="view-db-dashboard"$1class="$2 active"')
      }
    } catch {}
  }

  return (
    <>
      <div
        style={{ display: 'contents' }}
        dangerouslySetInnerHTML={{ __html: processed }}
      />
      <Script src={v('/intro-wire.js')} strategy="beforeInteractive" />
      <Script src={v('/waitlist.js')} strategy="afterInteractive" />
      <Script src={v('/prototype.js')} strategy="afterInteractive" />
      <Script src={v('/home-merge.js')} strategy="afterInteractive" />
      <Script src={v('/auth-ui.js')} strategy="afterInteractive" />
      <Script src={v('/dashboard-wire.js')} strategy="afterInteractive" />
      <Script src={v('/tutorial-wire.js')} strategy="afterInteractive" />
      <Script src={v('/meeting-wire.js')} strategy="afterInteractive" />
      <Script src={v('/tasks-wire.js')} strategy="afterInteractive" />
      <Script src={v('/notifications-wire.js')} strategy="afterInteractive" />
      <Script src={v('/feed-wire.js')} strategy="afterInteractive" />
      <Script src={v('/settings-wire.js')} strategy="afterInteractive" />
      <Script src={v('/team-wire.js')} strategy="afterInteractive" />
      <Script src={v('/tasks-view-wire.js')} strategy="afterInteractive" />
      <Script src={v('/outputs-wire.js')} strategy="afterInteractive" />
      <Script src={v('/billing-wire.js')} strategy="afterInteractive" />
      <Script src={v('/memory-wire.js')} strategy="afterInteractive" />
      <Script src={v('/insights-wire.js')} strategy="afterInteractive" />
      <Script src={v('/agent-drawer.js')} strategy="afterInteractive" />
      <Script src={v('/dashboard-v2.js')} strategy="afterInteractive" />
      <Script src={v('/integrations-wire.js')} strategy="afterInteractive" />
      <Script src={v('/trajectory-wire.js')} strategy="afterInteractive" />
      <Script src={v('/goal-wire.js')} strategy="afterInteractive" />
      <Script src={v('/scorecard-wire.js')} strategy="afterInteractive" />
      <Script src={v('/work-wire.js')} strategy="afterInteractive" />
      <Script src={v('/idea-wire.js')} strategy="afterInteractive" />
      <Script src={v('/calendar-wire.js')} strategy="afterInteractive" />
      <Script src={v('/footer-wire.js')} strategy="afterInteractive" />
      <Script src={v('/reveal-wire.js')} strategy="afterInteractive" />
      <Script src={v('/topbar-scroll.js')} strategy="afterInteractive" />
      <Script src={v('/contact-wire.js')} strategy="afterInteractive" />
      <Script src={v('/landing-wire.js')} strategy="afterInteractive" />
      <Script src={v('/hq-wire.js')} strategy="afterInteractive" />
      <Script src={v('/posts-wire-v2.js')} strategy="afterInteractive" />
      <Script src={v('/audience-wire.js')} strategy="afterInteractive" />
      <Script src={v('/team-wire-v2.js')} strategy="afterInteractive" />
      <Script src={v('/hq-data-wire.js')} strategy="afterInteractive" />
      <Script src={v('/posts-data-wire.js')} strategy="afterInteractive" />
      <Script src={v('/knowledge-data-wire.js')} strategy="afterInteractive" />
      <Script src={v('/team-data-wire.js')} strategy="afterInteractive" />
      <Script src={v('/profile-wire.js')} strategy="afterInteractive" />
      <Script src={v('/vexa-shell.js')} strategy="afterInteractive" />
      <Script src={v('/tour/tour-steps.js')} strategy="afterInteractive" />
      <Script src={v('/tour/tour-engine.js')} strategy="afterInteractive" />
      <Script src={v('/briefs-loader.js')} strategy="afterInteractive" />
      <Script src={v('/morning-brief-wire.js')} strategy="afterInteractive" />
      <Script src={v('/evening-recap-wire.js')} strategy="afterInteractive" />
      <Script src={v('/queue-status-wire.js')} strategy="afterInteractive" />
      <Script src={v('/weekly-pulse-wire.js')} strategy="afterInteractive" />
      <Script src={v('/weekly-plan-wire.js')} strategy="afterInteractive" />
      <Script src={v('/weekly-hooks-wire.js')} strategy="afterInteractive" />
      <Script src={v('/weekly-briefs-wire.js')} strategy="afterInteractive" />
    </>
  )
}
