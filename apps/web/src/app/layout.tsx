import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import SovexaThemeBridge from './SovexaThemeBridge'
import './globals.css'
import './mobile.css'  // phone Safari / Chrome — scoped to html[data-vx-device="mobile"]

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
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400;1,500&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&family=Syne:wght@600;700;800&display=swap"
          rel="stylesheet"
        />
        {/* Hide everything until JS determines what to show — prevents any flash */}
        <style dangerouslySetInnerHTML={{ __html: `
          html:not([data-vx-ready]) .view { opacity: 0 !important; }
          html:not([data-vx-ready]) #topbar { opacity: 0 !important; }
          html:not([data-vx-ready]) #onboarding { opacity: 0 !important; }
        `}} />
        {/* ── Device class: html[data-vx-device="desktop"|"mobile"|"app"] ─
             Single source of truth for which UI surface this session uses.
             Set synchronously in beforeInteractive (no FOUC). matchMedia
             listener keeps it in sync with resize / DevTools responsive mode.

             Detection priority (first match wins):
               1. NEXT_PUBLIC_VX_FORCE_DEVICE env var (build-time inline) —
                  forces a single surface for the dev port (3005 = mobile).
               2. ?vxapp=1  → "app"   (Capacitor injects this on launch)
               3. localStorage.vx-device-app === '1' → "app" (sticky)
               4. matchMedia('(max-width: 640px)') → "mobile"
               5. otherwise → "desktop"                                       */}
        <Script id="vx-device-class" strategy="beforeInteractive">{`
          try{
            var html=document.documentElement;
            // Runtime port-based force (NEXT_PUBLIC env vars inline into a
            // shared .next bundle when two servers share the same project
            // dir, so we can't use them to distinguish 3004 from 3005).
            // Port 3005 = mobile-prod preview, 3002 = mobile-app preview,
            // anything else falls through to matchMedia.
            var port=location.port;
            var forced=(port==='3005')?'mobile':(port==='3002')?'app':'';
            if(forced==='desktop'||forced==='mobile'||forced==='app'){
              html.dataset.vxDevice=forced;
            } else {
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
            }
          }catch(_e){}
        `}</Script>
        {/* beforeInteractive must live in root layout — not in page-level PrototypeShell */}
        <Script src="/theme-dark-default.js" strategy="beforeInteractive" />
        <Script id="vx-session-gate" strategy="beforeInteractive">{`
          try{if(localStorage.getItem('vx-authed')==='1'){
            document.documentElement.dataset.vxAuthed='1';
            var s=document.createElement('style');
            s.id='vx-auth-gate';
            s.textContent='.view{opacity:0!important;pointer-events:none!important;position:absolute!important}#view-db-dashboard{opacity:1!important;pointer-events:auto!important;position:relative!important}#nav-marketing{display:none!important}#topbar-login{display:none!important}#topbar-cta{display:none!important}#nav-app{display:flex!important}';
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
