import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import SovexaThemeBridge from './SovexaThemeBridge'
import './globals.css'

export const metadata: Metadata = {
  title: 'Sovexa — Your AI Content Team',
  description: 'AI employees. Zero management overhead. Your content team starts working the moment you sign up.',
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
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400;1,500&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@300;400&family=Syne:wght@600;700;800&display=swap"
          rel="stylesheet"
        />
        {/* Hide everything until JS determines what to show — prevents any flash */}
        <style dangerouslySetInnerHTML={{ __html: `
          html:not([data-vx-ready]) .view { visibility: hidden !important; }
          html:not([data-vx-ready]) #topbar { visibility: hidden !important; }
          html:not([data-vx-ready]) #onboarding { visibility: hidden !important; }
        `}} />
        {/* beforeInteractive must live in root layout — not in page-level PrototypeShell */}
        <Script src="/theme-dark-default.js" strategy="beforeInteractive" />
        <Script id="vx-session-gate" strategy="beforeInteractive">{`
          try{if(localStorage.getItem('vx-authed')==='1'){
            document.documentElement.dataset.vxAuthed='1';
            var s=document.createElement('style');
            s.id='vx-auth-gate';
            s.textContent='.view{visibility:hidden!important;pointer-events:none!important}#view-db-dashboard{visibility:visible!important;pointer-events:auto!important;z-index:1!important}#nav-marketing{display:none!important}#topbar-login{display:none!important}#topbar-cta{display:none!important}#nav-app{display:flex!important}';
            document.head.appendChild(s);
          }}catch(e){}
          document.documentElement.setAttribute('data-vx-ready','1');
        `}</Script>
      </head>
      <body>
        <SovexaThemeBridge />
        {children}
      </body>
    </html>
  )
}
