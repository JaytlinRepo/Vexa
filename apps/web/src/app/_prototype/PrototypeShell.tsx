'use client'

import Script from 'next/script'

export default function PrototypeShell({ html }: { html: string }) {
  return (
    <>
      <div
        style={{ display: 'contents' }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <Script src="/prototype.js" strategy="afterInteractive" />
      <Script src="/home-merge.js" strategy="afterInteractive" />
      <Script src="/auth-ui.js" strategy="afterInteractive" />
      <Script src="/dashboard-wire.js" strategy="afterInteractive" />
      <Script src="/meeting-wire.js" strategy="afterInteractive" />
    </>
  )
}
