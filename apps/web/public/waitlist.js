/* Waitlist gate — matches the new dark-theme home page design.
 * Uses the same tokens: --bg, --s1, --s2, --t1, --t2, --t3, --accent.
 * Cormorant Garamond headings, Inter body, JetBrains Mono labels.
 */
;(function () {
  if (document.cookie.indexOf('vx_session') !== -1) return

  var overlay = document.createElement('div')
  overlay.id = 'vx-waitlist'
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9998;background:var(--bg,#0a0a0a);overflow-y:auto;overflow-x:hidden;color:var(--t1,#edede9)'

  overlay.innerHTML = ''

    // ─── HEADER ─────────────────────────────────────────────────
    + '<header id="vx-wl-topbar" style="position:sticky;top:0;z-index:100;padding:18px 48px;display:flex;align-items:center;justify-content:space-between;background:rgba(10,10,10,.85);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border-bottom:1px solid var(--b1,rgba(255,255,255,.08));transition:all .35s cubic-bezier(.16,1,.3,1)">'
    + '<a href="#" style="font-family:Cormorant Garamond,Georgia,serif;font-size:20px;font-weight:400;font-style:italic;color:var(--t1,#edede9);text-decoration:none;letter-spacing:-.01em" onclick="document.getElementById(\'vx-waitlist\').scrollTo({top:0,behavior:\'smooth\'});return false">Sovexa</a>'
    + '<nav style="display:flex;align-items:center;gap:24px;font-family:Inter,sans-serif;font-size:13px">'
    + '<a href="#vx-wl-team" style="color:var(--t2,#8a8880);text-decoration:none;transition:color .2s" onmouseover="this.style.color=\'var(--t1,#edede9)\'" onmouseout="this.style.color=\'var(--t2,#8a8880)\'">The team</a>'
    + '<a href="#vx-wl-process" style="color:var(--t2,#8a8880);text-decoration:none;transition:color .2s" onmouseover="this.style.color=\'var(--t1,#edede9)\'" onmouseout="this.style.color=\'var(--t2,#8a8880)\'">How it works</a>'
    + '<a href="#" id="vx-wl-contact-link" style="color:var(--t2,#8a8880);text-decoration:none;transition:color .2s" onmouseover="this.style.color=\'var(--t1,#edede9)\'" onmouseout="this.style.color=\'var(--t2,#8a8880)\'">Contact</a>'
    + '</nav>'
    + '</header>'

    // ─── HERO / WAITLIST FORM ────────────────────────────────────
    + '<section style="display:flex;align-items:center;justify-content:center;flex-direction:column;padding:120px 20px 80px;text-align:center">'
    + '<div style="max-width:560px;width:100%">'

    + '<div style="font-family:JetBrains Mono,monospace;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--t3,#454540);margin-bottom:20px">Early Access</div>'
    + '<h1 style="font-family:Cormorant Garamond,Georgia,serif;font-size:clamp(40px,6vw,64px);font-weight:400;font-style:italic;color:var(--t1,#edede9);line-height:1.08;letter-spacing:-.03em;margin:0 0 20px">Your content team<br>is <em style="color:var(--accent,#d4a574)">almost ready.</em></h1>'
    + '<p style="font-family:Inter,sans-serif;font-size:16px;line-height:1.7;color:var(--t2,#8a8880);margin:0 0 48px">Create your account to reserve your spot. We\'ll notify you the moment your team is ready.</p>'

    // Account creation form
    + '<form id="vx-wl-form" style="display:flex;flex-direction:column;gap:12px;max-width:400px;margin:0 auto">'
    + '<input id="vx-wl-name" type="text" placeholder="Full name" required style="padding:14px 18px;border-radius:10px;border:1px solid var(--b1,rgba(255,255,255,.08));background:var(--s1,#111);font:15px Inter,sans-serif;color:var(--t1,#edede9);outline:none;transition:border-color .2s" />'
    + '<input id="vx-wl-email" type="email" placeholder="Email" required style="padding:14px 18px;border-radius:10px;border:1px solid var(--b1,rgba(255,255,255,.08));background:var(--s1,#111);font:15px Inter,sans-serif;color:var(--t1,#edede9);outline:none;transition:border-color .2s" />'
    + '<input id="vx-wl-username" type="text" placeholder="Username" required style="padding:14px 18px;border-radius:10px;border:1px solid var(--b1,rgba(255,255,255,.08));background:var(--s1,#111);font:15px Inter,sans-serif;color:var(--t1,#edede9);outline:none;transition:border-color .2s" />'
    + '<input id="vx-wl-password" type="password" placeholder="Password (8+ characters)" required minlength="8" style="padding:14px 18px;border-radius:10px;border:1px solid var(--b1,rgba(255,255,255,.08));background:var(--s1,#111);font:15px Inter,sans-serif;color:var(--t1,#edede9);outline:none;transition:border-color .2s" />'
    + '<div id="vx-wl-error" style="font-family:Inter,sans-serif;font-size:12px;color:#c48a8a;min-height:16px"></div>'
    + '<button type="submit" id="vx-wl-btn" style="padding:14px 28px;border-radius:10px;border:none;background:var(--accent,#d4a574);color:var(--accent-text,#1a0f06);font:600 12px/1 JetBrains Mono,monospace;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;transition:all .3s;box-shadow:0 4px 24px var(--accent-glow,rgba(212,165,116,.28))">Create account</button>'
    + '</form>'

    // Social proof
    + '<div id="vx-wl-count" style="margin-top:16px;font-family:JetBrains Mono,monospace;font-size:10px;color:var(--t3,#454540);letter-spacing:.04em"></div>'

    // Success state
    + '<div id="vx-wl-success" style="display:none;max-width:440px;margin:0 auto">'
    + '<div style="width:48px;height:48px;border-radius:50%;background:rgba(159,179,138,.12);display:flex;align-items:center;justify-content:center;margin:0 auto 20px"><svg width="22" height="22" fill="none" stroke="var(--ok,#9fb38a)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>'
    + '<h2 style="font-family:Cormorant Garamond,Georgia,serif;font-size:28px;font-weight:400;font-style:italic;color:var(--t1,#edede9);margin:0 0 12px">Welcome to Sovexa.</h2>'
    + '<p style="font-family:Inter,sans-serif;font-size:14px;color:var(--t2,#8a8880);line-height:1.7;margin:0 0 24px">Your account is created and you\'re on the early access list. We\'re building your AI content team right now — we\'ll email you the moment it\'s ready.</p>'
    + '<div style="border:1px solid var(--b1,rgba(255,255,255,.08));border-radius:10px;background:var(--s1,#111);padding:20px;text-align:left">'
    + '<div style="font-family:JetBrains Mono,monospace;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--t3,#454540);margin-bottom:12px">What happens next</div>'
    + '<div style="font-family:Inter,sans-serif;font-size:13px;color:var(--t2,#8a8880);line-height:1.7">'
    + '<div style="display:flex;gap:10px;margin-bottom:8px"><span style="color:var(--accent,#d4a574);flex-shrink:0">1.</span> We\'re onboarding creators in small batches</div>'
    + '<div style="display:flex;gap:10px;margin-bottom:8px"><span style="color:var(--accent,#d4a574);flex-shrink:0">2.</span> You\'ll get an email when your team is activated</div>'
    + '<div style="display:flex;gap:10px"><span style="color:var(--accent,#d4a574);flex-shrink:0">3.</span> Log in and your AI employees start working immediately</div>'
    + '</div>'
    + '</div>'
    + '</div>'

    + '</div>'
    + '</section>'

    // ─── YOUR AI TEAM ───────────────────────────────────────────
    + '<section id="vx-wl-team" style="padding:clamp(60px,8vw,100px) 20px;border-top:1px solid var(--b1,rgba(255,255,255,.08));scroll-margin-top:80px">'
    + '<div style="max-width:960px;margin:0 auto">'
    + '<div style="margin-bottom:clamp(48px,6vw,64px);text-align:center">'
    + '<div style="font-family:JetBrains Mono,monospace;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--t3,#454540);margin-bottom:16px">\u00A7 01 \u00B7 Meet the team</div>'
    + '<h2 style="font-family:Cormorant Garamond,Georgia,serif;font-size:clamp(36px,5vw,56px);font-weight:400;font-style:italic;color:var(--t1,#edede9);margin:0 0 16px;letter-spacing:-.02em;line-height:1.08">Four agents. <em style="color:var(--accent,#d4a574)">One voice.</em> Yours.</h2>'
    + '<p style="font-family:Inter,sans-serif;font-size:15px;color:var(--t2,#8a8880);line-height:1.7;max-width:540px;margin:0 auto">Four specialists, each with their own lane. You manage them like a team — because that\'s what they are.</p>'
    + '</div>'

    // Team cards
    + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px">'
    + teamCard('M', 'Maya', 'Trend & Insights Analyst', '"I read the internet so you don\'t have to."', ['66 sources', 'weekly pulse', 'competitor watch'])
    + teamCard('J', 'Jordan', 'Content Strategist', '"Signal is cheap. A plan is the job."', ['pillars', 'briefs', 'cadence'])
    + teamCard('A', 'Alex', 'Copywriter & Script Writer', '"Less ought-to, more felt."', ['voice-locked', 'captions', 'shot lists'])
    + teamCard('R', 'Riley', 'Creative Director', '"Right post. Right minute. Right feed."', ['IG \u00B7 TT \u00B7 YT', 'auto-edit', 'cross-post'])
    + '</div>'

    + '</div>'
    + '</section>'

    // ─── PROCESS ────────────────────────────────────────────────
    + '<section id="vx-wl-process" style="padding:clamp(60px,8vw,100px) 20px;border-top:1px solid var(--b1,rgba(255,255,255,.08));scroll-margin-top:80px">'
    + '<div style="max-width:960px;margin:0 auto">'
    + '<div style="margin-bottom:clamp(48px,6vw,64px);text-align:center">'
    + '<div style="font-family:JetBrains Mono,monospace;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--t3,#454540);margin-bottom:16px">\u00A7 02 \u00B7 The pipeline</div>'
    + '<h2 style="font-family:Cormorant Garamond,Georgia,serif;font-size:clamp(36px,5vw,56px);font-weight:400;font-style:italic;color:var(--t1,#edede9);margin:0 0 16px;letter-spacing:-.02em;line-height:1.08">From <em style="color:var(--accent,#d4a574)">signal</em> to <em style="color:var(--accent,#d4a574)">shipped</em>, in one room.</h2>'
    + '<p style="font-family:Inter,sans-serif;font-size:15px;color:var(--t2,#8a8880);line-height:1.7;max-width:540px;margin:0 auto">Tell Sovexa what you create. Your team is ready to work in five minutes.</p>'
    + '</div>'

    // 4-column steps
    + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px">'
    + stepCard('01', 'Set your niche', 'Choose your content category. Your team specializes instantly.', '2 min')
    + stepCard('02', 'Define your brand', 'Tone, audience, goals. The more context, the better your team sounds.', '2 min')
    + stepCard('03', 'Your team delivers', 'Maya pulls trends. Jordan drafts a plan. Real outputs, not a blank dashboard.', '1 min')
    + stepCard('04', 'Approve and repeat', 'Review with action buttons. Approve triggers the next step. Every decision trains your team.', 'Daily')
    + '</div>'

    + '</div>'
    + '</section>'

    // ─── FOOTER ─────────────────────────────────────────────────
    + '<footer style="padding:64px 40px 32px;border-top:1px solid var(--b1,rgba(255,255,255,.08))">'
    + '<div style="max-width:900px;margin:0 auto;display:grid;grid-template-columns:2fr 1fr;gap:48px;margin-bottom:40px">'
    + '<div>'
    + '<div style="font-family:Cormorant Garamond,Georgia,serif;font-size:24px;font-weight:400;font-style:italic;margin-bottom:10px;color:var(--t1,#edede9)">Sovexa</div>'
    + '<p style="font-family:Inter,sans-serif;font-size:13px;color:var(--t3,#454540);line-height:1.6;margin:0 0 6px;font-style:italic">Your content. Run by a team.</p>'
    + '<p style="font-family:Inter,sans-serif;font-size:12px;color:var(--t3,#454540);line-height:1.6;margin:0;max-width:340px">Four AI specialists that plan, write, edit, and produce content for your brand.</p>'
    + '</div>'
    + '<div style="display:flex;flex-direction:column;gap:10px">'
    + '<div style="font-family:JetBrains Mono,monospace;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--t3,#454540);margin-bottom:4px">Company</div>'
    + '<a href="#" id="vx-wl-contact-footer" style="font-family:Inter,sans-serif;font-size:13px;color:var(--t2,#8a8880);text-decoration:none">Contact</a>'
    + '<a href="#" id="vx-wl-terms" style="font-family:Inter,sans-serif;font-size:13px;color:var(--t2,#8a8880);text-decoration:none">Terms</a>'
    + '<a href="#" id="vx-wl-privacy" style="font-family:Inter,sans-serif;font-size:13px;color:var(--t2,#8a8880);text-decoration:none">Privacy</a>'
    + '<a href="#" id="vx-wl-security" style="font-family:Inter,sans-serif;font-size:13px;color:var(--t2,#8a8880);text-decoration:none">Security</a>'
    + '</div>'
    + '</div>'
    + '<div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--b1,rgba(255,255,255,.08));padding-top:20px;font-family:JetBrains Mono,monospace;font-size:10px;color:var(--t3,#454540);letter-spacing:.04em">'
    + '<span>\u00A9 ' + new Date().getFullYear() + ' Sovexa</span>'
    + '<span>Built for creators</span>'
    + '</div>'
    + '</footer>'

  function teamCard(init, name, role, quote, skills) {
    return '<div style="border:1px solid var(--b1,rgba(255,255,255,.08));border-radius:12px;background:var(--s1,#111);padding:28px 24px;transition:border-color .3s" onmouseover="this.style.borderColor=\'var(--accent,#d4a574)\'" onmouseout="this.style.borderColor=\'var(--b1,rgba(255,255,255,.08))\'">'
      + '<div style="width:40px;height:40px;border-radius:50%;background:var(--s2,#171717);border:1px solid var(--b2,rgba(255,255,255,.14));display:flex;align-items:center;justify-content:center;font-family:Inter,sans-serif;font-size:15px;color:var(--t1,#edede9);margin-bottom:16px">' + init + '</div>'
      + '<div style="font-family:Cormorant Garamond,Georgia,serif;font-size:26px;font-weight:400;font-style:italic;color:var(--t1,#edede9);margin-bottom:4px">' + name + '</div>'
      + '<div style="font-family:JetBrains Mono,monospace;font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:var(--t3,#454540);margin-bottom:16px">' + role + '</div>'
      + '<div style="font-family:Cormorant Garamond,Georgia,serif;font-size:16px;font-style:italic;color:var(--t2,#8a8880);line-height:1.4;margin-bottom:20px">' + quote + '</div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:5px">' + skills.map(function(s) { return '<span style="font-family:JetBrains Mono,monospace;font-size:9px;letter-spacing:.04em;color:var(--t2,#8a8880);padding:4px 10px;border:1px solid var(--b1,rgba(255,255,255,.08));border-radius:100px">' + s + '</span>' }).join('') + '</div>'
      + '</div>'
  }

  function stepCard(num, title, desc, time) {
    return '<div style="border:1px solid var(--b1,rgba(255,255,255,.08));border-radius:12px;background:var(--s1,#111);padding:32px 24px">'
      + '<div style="font-family:Cormorant Garamond,Georgia,serif;font-size:48px;font-weight:400;color:var(--b2,rgba(255,255,255,.14));line-height:1;margin-bottom:20px">' + num + '</div>'
      + '<h3 style="font-family:Inter,sans-serif;font-size:14px;font-weight:600;margin:0 0 10px;color:var(--t1,#edede9)">' + title + '</h3>'
      + '<p style="font-family:Inter,sans-serif;font-size:13px;color:var(--t2,#8a8880);line-height:1.6;margin:0 0 16px">' + desc + '</p>'
      + '<span style="font-family:JetBrains Mono,monospace;font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--t3,#454540);padding:4px 10px;border:1px solid var(--b1,rgba(255,255,255,.08));border-radius:6px">' + time + '</span>'
      + '</div>'
  }

  document.body.appendChild(overlay)

  // Fetch count
  fetch('/api/waitlist/count').then(function(r){return r.json()}).then(function(d){
    if(d.count>0) document.getElementById('vx-wl-count').textContent=d.count+(d.count===1?' person':' people')+' on the list'
  }).catch(function(){})

  // Form submit — create account + join waitlist
  document.getElementById('vx-wl-form').addEventListener('submit', function(e){
    e.preventDefault()
    var btn=document.getElementById('vx-wl-btn')
    var errEl=document.getElementById('vx-wl-error')
    var email=document.getElementById('vx-wl-email').value.trim()
    var name=document.getElementById('vx-wl-name').value.trim()
    var username=document.getElementById('vx-wl-username').value.trim()
    var password=document.getElementById('vx-wl-password').value
    errEl.textContent=''

    if(!email||!username||!password||!name){ errEl.textContent='All fields are required.'; return }
    if(password.length<8){ errEl.textContent='Password must be at least 8 characters.'; return }

    btn.textContent='CREATING ACCOUNT...'
    btn.disabled=true

    // Step 1: Create the account
    fetch('/api/auth/signup',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email:email,username:username,password:password,fullName:name})
    })
    .then(function(r){return r.json().then(function(d){return{ok:r.ok,data:d}})})
    .then(function(res){
      if(!res.ok){
        var msg=res.data.error||res.data.message||'Account creation failed'
        if(msg==='email_taken'||msg==='email_or_username_in_use') msg='An account with this email or username already exists.'
        if(msg==='username_taken') msg='This username is already taken.'
        if(msg==='invalid_input') msg='Please check all fields and try again.'
        errEl.textContent=msg
        btn.textContent='CREATE ACCOUNT'; btn.disabled=false
        return
      }

      // Step 2: Add to waitlist
      fetch('/api/waitlist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email,name:name})}).catch(function(){})

      // Show success
      document.getElementById('vx-wl-form').style.display='none'
      document.getElementById('vx-wl-success').style.display='block'
      document.getElementById('vx-wl-count').style.display='none'
    })
    .catch(function(){
      errEl.textContent='Something went wrong. Please try again.'
      btn.textContent='CREATE ACCOUNT'; btn.disabled=false
    })
  })

  // Topbar island morph on scroll
  var wlTopbar=document.getElementById('vx-wl-topbar')
  var wlP=0
  overlay.addEventListener('scroll',function(){
    var y=overlay.scrollTop
    var target=Math.max(0,Math.min(1,(y-4)/260))
    wlP+=(target-wlP)*0.14
    if(Math.abs(target-wlP)<0.002)wlP=target
    var p=wlP
    var maxW=Math.min(1040,overlay.clientWidth-40)
    wlTopbar.style.width='calc(100% - '+(p*(overlay.clientWidth-maxW))+'px)'
    wlTopbar.style.marginLeft=(p*(overlay.clientWidth-maxW)/2)+'px'
    wlTopbar.style.borderRadius=(p*100)+'px'
    wlTopbar.style.top=(p*12)+'px'
    wlTopbar.style.padding=(18-8*p)+'px '+(48-20*p)+'px'
    wlTopbar.style.boxShadow=p>0.01?'0 '+(p*18)+'px '+(p*52)+'px rgba(0,0,0,.2), 0 0 0 '+(p*1)+'px var(--b1,rgba(255,255,255,.08))':'none'
    wlTopbar.style.borderBottomColor='var(--b1,rgba(255,255,255,.08))'
    if(Math.abs(target-wlP)>0.003)requestAnimationFrame(function(){overlay.dispatchEvent(new Event('scroll'))})
  },{passive:true})

  // Smooth scroll
  overlay.querySelectorAll('a[href^="#vx-wl-"]').forEach(function(a){
    a.addEventListener('click',function(e){ e.preventDefault(); var t=document.querySelector(a.getAttribute('href')); if(t)t.scrollIntoView({behavior:'smooth'}) })
  })

  // Focus styling
  overlay.querySelectorAll('input').forEach(function(inp){
    inp.addEventListener('focus',function(){inp.style.borderColor='var(--accent,#d4a574)'})
    inp.addEventListener('blur',function(){inp.style.borderColor='var(--b1,rgba(255,255,255,.08))'})
  })

  // Legal modals
  var legalContent={
    terms:{title:'Terms of Service',body:'<p><strong>Last updated:</strong> April 2026</p><p>By using Sovexa you agree to these terms. You must be 18+. You retain full ownership of all content you create. We do not sell your data. Paid plans are billed monthly — cancel anytime. AI outputs should be reviewed before publishing. Our liability is limited to what you paid in the last 12 months.</p><p>Questions? <a href="mailto:hello@sovexa.ai" style="color:var(--accent,#d4a574)">hello@sovexa.ai</a></p>'},
    privacy:{title:'Privacy Policy',body:'<p><strong>Last updated:</strong> April 2026</p><p>We collect: account data (email, name), brand data (niche, voice, goals), platform data (social metrics via OAuth), and usage data (approvals/rejections). We never sell data, share content, store social passwords, or train models on your content. One session cookie for auth — no tracking. Data deleted within 30 days on request.</p><p><a href="mailto:hello@sovexa.ai" style="color:var(--accent,#d4a574)">hello@sovexa.ai</a></p>'},
    security:{title:'Security',body:'<p><strong>Last updated:</strong> April 2026</p><p>AWS infrastructure (SOC 2, ISO 27001). RDS PostgreSQL encrypted at rest. TLS 1.2+ in transit. JWT + httpOnly cookies + bcrypt passwords. Rate limiting on all endpoints. OAuth for social accounts — we never see your password. Payments via Stripe (PCI DSS Level 1). Report vulnerabilities: <a href="mailto:security@sovexa.ai" style="color:var(--accent,#d4a574)">security@sovexa.ai</a></p>'},
  }
  function openLegal(kind){
    var existing=document.getElementById('vx-wl-legal'); if(existing)existing.remove()
    var info=legalContent[kind]; if(!info)return
    var m=document.createElement('div'); m.id='vx-wl-legal'
    m.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);padding:24px'
    m.innerHTML='<div style="width:100%;max-width:520px;max-height:80vh;overflow-y:auto;background:var(--s1,#111);border:1px solid var(--b1,rgba(255,255,255,.08));border-radius:14px;padding:32px;color:var(--t1,#edede9);font-family:Inter,sans-serif">'
      +'<h3 style="font-family:Cormorant Garamond,Georgia,serif;font-size:24px;font-weight:400;margin:0 0 20px">'+info.title+'</h3>'
      +'<div style="color:var(--t2,#8a8880);font-size:13px;line-height:1.7;margin:0 0 24px">'+info.body+'</div>'
      +'<div style="text-align:right;border-top:1px solid var(--b1,rgba(255,255,255,.08));padding-top:16px"><button id="vx-wl-legal-close" style="background:var(--accent,#d4a574);color:var(--accent-text,#1a0f06);border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-family:JetBrains Mono,monospace;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase">Close</button></div>'
      +'</div>'
    m.addEventListener('click',function(e){if(e.target===m)m.remove()})
    document.body.appendChild(m)
    document.getElementById('vx-wl-legal-close').addEventListener('click',function(){m.remove()})
  }
  document.getElementById('vx-wl-terms').addEventListener('click',function(e){e.preventDefault();openLegal('terms')})
  document.getElementById('vx-wl-privacy').addEventListener('click',function(e){e.preventDefault();openLegal('privacy')})
  document.getElementById('vx-wl-security').addEventListener('click',function(e){e.preventDefault();openLegal('security')})

  // Contact modal
  function openContact(){
    var existing=document.getElementById('vx-wl-contact'); if(existing)existing.remove()
    var m=document.createElement('div'); m.id='vx-wl-contact'
    m.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);padding:24px'
    m.innerHTML='<div style="width:100%;max-width:480px;background:var(--s1,#111);border:1px solid var(--b1,rgba(255,255,255,.08));border-radius:14px;padding:32px;color:var(--t1,#edede9);font-family:Inter,sans-serif">'
      +'<h3 style="font-family:Cormorant Garamond,Georgia,serif;font-size:24px;font-weight:400;margin:0 0 6px">Get in touch.</h3>'
      +'<p style="font-size:13px;color:var(--t2,#8a8880);margin:0 0 24px">We reply within one business day.</p>'
      +'<form id="vx-wl-contact-form" style="display:flex;flex-direction:column;gap:12px">'
      +'<input name="name" type="text" placeholder="Your name" required style="padding:12px 16px;border-radius:8px;border:1px solid var(--b1,rgba(255,255,255,.08));background:var(--s2,#171717);font:14px Inter,sans-serif;color:var(--t1,#edede9);outline:none" />'
      +'<input name="email" type="email" placeholder="Your email" required style="padding:12px 16px;border-radius:8px;border:1px solid var(--b1,rgba(255,255,255,.08));background:var(--s2,#171717);font:14px Inter,sans-serif;color:var(--t1,#edede9);outline:none" />'
      +'<textarea name="message" rows="4" placeholder="Your message" required style="padding:12px 16px;border-radius:8px;border:1px solid var(--b1,rgba(255,255,255,.08));background:var(--s2,#171717);font:14px Inter,sans-serif;color:var(--t1,#edede9);outline:none;resize:vertical"></textarea>'
      +'<button type="submit" id="vx-wl-contact-send" style="padding:12px 24px;border-radius:8px;border:none;background:var(--accent,#d4a574);color:var(--accent-text,#1a0f06);font:600 11px/1 JetBrains Mono,monospace;letter-spacing:.06em;text-transform:uppercase;cursor:pointer">Send message</button>'
      +'</form>'
      +'<div id="vx-wl-contact-done" style="display:none;text-align:center;padding:20px 0">'
      +'<h4 style="font-family:Cormorant Garamond,Georgia,serif;font-size:22px;font-weight:400;font-style:italic;margin:0 0 8px">Got it \u2014 talk soon.</h4>'
      +'<p style="font-size:13px;color:var(--t2,#8a8880);margin:0">We\'ll reply within one business day.</p>'
      +'</div></div>'
    m.addEventListener('click',function(e){if(e.target===m)m.remove()})
    document.body.appendChild(m)
    document.getElementById('vx-wl-contact-form').addEventListener('submit',function(e){
      e.preventDefault()
      var f=e.target,btn=document.getElementById('vx-wl-contact-send')
      btn.textContent='SENDING...'; btn.disabled=true
      fetch('/api/contact',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:f.name.value,email:f.email.value,message:f.message.value})}).catch(function(){})
      .finally(function(){
        document.getElementById('vx-wl-contact-form').style.display='none'
        document.getElementById('vx-wl-contact-done').style.display='block'
      })
    })
  }
  document.getElementById('vx-wl-contact-link').addEventListener('click',function(e){e.preventDefault();openContact()})
  document.getElementById('vx-wl-contact-footer').addEventListener('click',function(e){e.preventDefault();openContact()})
})()
