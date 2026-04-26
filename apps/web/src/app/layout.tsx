import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import SovexaThemeBridge from './SovexaThemeBridge'
import './globals.css'
// Platform-specific stylesheets. Each file prefixes every selector with
// the matching html[data-vx-device="..."] attribute, so a rule in one
// platform cannot leak to another. Safe to extend each in isolation.
import './mobile.css'  // phone Safari / Chrome
import './app.css'     // Capacitor wrapper (apps/sovexa-mobile)

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
        {/* ── Device class: html[data-vx-device="desktop"|"mobile"|"app"] ─
             Single source of truth for which UI surface this session uses.
             Set synchronously in beforeInteractive (no FOUC). matchMedia
             listener keeps it in sync with resize / DevTools responsive mode.

             Three platforms, three stylesheets:
               desktop  → shared CSS (no extra file; default)
               mobile   → mobile.css (phone Safari / Chrome on the web)
               app      → app.css    (Capacitor wrapper at apps/sovexa-mobile)

             Detection priority (first match wins, never auto-flips):
               1. ?vxapp=1 in URL  → "app"   (Capacitor injects this on launch)
               2. localStorage.vx-device-app === '1' → "app" (sticky once detected)
               3. matchMedia('(max-width: 640px)') → "mobile"
               4. otherwise → "desktop"

             "app" is sticky so a navigation inside the wrapped WebView keeps
             the app surface even after the URL param is dropped. Clear it via
             localStorage.removeItem('vx-device-app') from devtools to leave.

             Each stylesheet's selectors are prefixed with the matching
             html[data-vx-device="..."] attribute so a rule in one platform
             cannot leak to another — see the audit grep at the top of each
             stylesheet.                                                    */}
        <Script id="vx-device-class" strategy="beforeInteractive">{`
          try{
            var html=document.documentElement;
            var sp=new URLSearchParams(location.search);
            var isApp=sp.get('vxapp')==='1';
            try{
              if(isApp)localStorage.setItem('vx-device-app','1');
              else if(localStorage.getItem('vx-device-app')==='1')isApp=true;
            }catch(_e){}
            if(isApp){
              html.dataset.vxDevice='app';
            } else {
              var mql=window.matchMedia('(max-width: 640px)');
              var apply=function(){ html.dataset.vxDevice = mql.matches ? 'mobile' : 'desktop' };
              apply();
              if(mql.addEventListener)mql.addEventListener('change',apply);
              else if(mql.addListener)mql.addListener(apply);
            }
          }catch(_e){}
        `}</Script>
        {/* beforeInteractive must live in root layout — not in page-level PrototypeShell */}
        <Script src="/theme-dark-default.js" strategy="beforeInteractive" />
        <Script id="vx-session-gate" strategy="beforeInteractive">{`
          try{if(localStorage.getItem('vx-authed')==='1'){
            document.documentElement.dataset.vxAuthed='1';
            // Honor #hash for refresh-restore: alphanumeric + hyphens only (CSS-injection safe).
            var h=(location.hash||'').replace(/^#/,'');
            var v=/^[a-z0-9-]+$/.test(h)?h:'db-dashboard';
            var s=document.createElement('style');
            s.id='vx-auth-gate';
            s.textContent='.view{visibility:hidden!important;pointer-events:none!important}#view-'+v+'{visibility:visible!important;pointer-events:auto!important;z-index:1!important}#nav-marketing{display:none!important}#topbar-login{display:none!important}#topbar-cta{display:none!important}#nav-app{display:flex!important}';
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
