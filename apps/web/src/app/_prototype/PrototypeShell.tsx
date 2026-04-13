'use client'

import Script from 'next/script'

export default function PrototypeShell({ html }: { html: string }) {
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: html }} />
      <Script src="/prototype.js" strategy="afterInteractive" />
    </>
  )
}
