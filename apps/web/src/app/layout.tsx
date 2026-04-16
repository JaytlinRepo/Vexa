import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import VexaThemeBridge from './VexaThemeBridge'
import './globals.css'

export const metadata: Metadata = {
  title: 'Vexa',
  description: 'Your content. Run by a team.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400;1,500&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&family=Syne:wght@600;700;800&display=swap"
          rel="stylesheet"
        />
        {/* beforeInteractive must live in root layout — not in page-level PrototypeShell */}
        <Script src="/theme-dark-default.js" strategy="beforeInteractive" />
        <Script id="vx-session-gate" strategy="beforeInteractive">{`
          try{if(localStorage.getItem('vx-authed')==='1'){
            document.documentElement.dataset.vxAuthed='1';
            var s=document.createElement('style');
            s.id='vx-auth-gate';
            s.textContent='.view{display:none!important}#view-db-dashboard{display:block!important}';
            document.head.appendChild(s);
          }}catch(e){}
        `}</Script>
      </head>
      <body>
        <VexaThemeBridge />
        {children}
      </body>
    </html>
  )
}
