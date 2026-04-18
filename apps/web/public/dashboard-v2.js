/* Sovexa — dashboard v2
 *
 * Replaces everything inside #view-db-dashboard with a single clean,
 * purposeful layout. All data comes from the same endpoints; the goal is
 * readability, not feature density. No emojis. Typography-driven.
 *
 * Sections (top to bottom) — growth-first: agents own tactics toward a bigger
 * platform; the CEO sees outcomes and weighs in when it matters.
 *   1. Header — greeting + plan chip + how the day should feel (one line)
 *   2. Next for you + team pulse + queue nav + overview tiles
 *   3. When you weigh in — only items that need a human decision
 *   4. Team — always-on workforce cards
 *   5. Performance + outcomes-style activity
 */
;(function () {
  // If the user has an active session, immediately flip to the dashboard
  // view so the home/marketing page never flashes on refresh.
  try {
    if (localStorage.getItem('vx-authed') === '1') {
      document.querySelectorAll('.view').forEach((v) => {
        if (v.id === 'view-db-dashboard') v.classList.add('active')
        else v.classList.remove('active')
      })
    }
    const oldLayout = document.querySelector('#view-db-dashboard .db-layout')
    if (oldLayout) oldLayout.style.opacity = '0'
  } catch {}

  const STATE = {
    me: null,
    tasks: [],
    usage: null,
    insights: null,        // Instagram insights (InstagramConnection)
    tiktok: null,          // TikTok connection (TiktokConnection)
    overview: null,        // combined platform overview (PlatformAccount + snapshots)
    feed: [],
    notifs: [],
    phylloAccounts: [], // raw Phyllo account list (multi-platform)
  }

  // ─────────────── data ────────────────────────────────────────────
  const get = (u) => fetch(u, { credentials: 'include' }).then((r) => r.ok ? r.json() : null).catch(() => null)

  async function fetchAll() {
    // Critical path: auth + tasks + usage — enough to render the layout
    const [me, tasks, usage] = await Promise.all([
      get('/api/auth/me'),
      get('/api/tasks'),
      get('/api/usage'),
    ])
    STATE.me = me
    STATE.tasks = tasks?.tasks || []
    STATE.usage = usage
    // Persist auth state so next page load skips the home view flash
    // Only set the flag, never remove it here — removal happens on explicit logout.
    // Removing on failed /api/auth/me causes the home page to flash on refresh.
    try { if (me?.user) localStorage.setItem('vx-authed', '1') } catch {}

    const companyId = me?.companies?.[0]?.id
    if (companyId) {
      // Platform data — needed for overview tiles. Notifications + feed
      // are supplementary and fetched in parallel but don't block render.
      const [insights, tiktok, overview, notifs] = await Promise.all([
        get(`/api/instagram/insights?companyId=${companyId}`),
        get(`/api/tiktok/insights?companyId=${companyId}`),
        get('/api/platform/overview'),
        get('/api/notifications'),
      ])
      STATE.insights = insights?.connection || null
      STATE.tiktok = tiktok?.connection || null
      STATE.overview = overview || null
      STATE.notifs = notifs?.items || []

      // Supplementary: feed + phyllo are slow (RSS timeouts, Phyllo 429s).
      // Fetch after render so they don't delay the dashboard.
      // Re-render when feed arrives so the sidebar appears.
      void Promise.all([
        get('/api/feed').then((f) => {
          const items = f?.items || []
          if (items.length > 0 && STATE.feed.length === 0) {
            STATE.feed = items
            if (typeof render === 'function') render()
          } else {
            STATE.feed = items
          }
        }),
        get('/api/phyllo/accounts').then((p) => { STATE.phylloAccounts = p?.accounts || [] }),
      ])
    }
  }

  // Background Instagram sync — runs AFTER the first render
  function backgroundInstagramSync() {
    const companyId = STATE.me?.companies?.[0]?.id
    if (!companyId || !STATE.insights) return
    if (STATE.insights.source !== 'meta') return // only sync Meta-connected accounts
    fetch('/api/instagram/sync', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId }),
    }).then((r) => r.ok ? r.json() : null).then((result) => {
      if (result?.synced && result.newPosts > 0) {
        console.log(`[v2] IG sync found ${result.newPosts} new posts`)
        get('/api/platform/overview').then((ov) => {
          if (ov) { STATE.overview = ov; if (typeof render === 'function') render() }
        })
      }
    }).catch(() => {})
  }

  // Background TikTok sync — runs AFTER the first render, not during fetchAll
  function backgroundTiktokSync() {
    const companyId = STATE.me?.companies?.[0]?.id
    if (!companyId || !STATE.tiktok) return
    fetch('/api/tiktok/sync', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId }),
    }).then((r) => r.ok ? r.json() : null).then((result) => {
      if (result?.synced && result.newPosts > 0) {
        console.log(`[v2] TikTok sync found ${result.newPosts} new posts`)
        get(`/api/platform/overview`).then((ov) => {
          if (ov) { STATE.overview = ov; if (typeof render === 'function') render() }
        })
      }
    }).catch(() => {})
  }

  // Returns the connection state the overview tiles should show for IG:
  //   'ready'      — real numbers in STATE.insights
  //   'syncing'    — Phyllo says CONNECTED but InstagramConnection is empty/stub
  //                  (Meta 24-48h propagation is the usual cause)
  //   'none'       — no IG connection at all
  function instagramState() {
    const ig = STATE.insights
    const phylloIg = STATE.phylloAccounts.find(
      (a) => (a.work_platform?.name || '').toLowerCase() === 'instagram' && a.status === 'CONNECTED',
    )
    if (ig && ig.source === 'phyllo' && Number(ig.followerCount) > 0) return 'ready'
    if (phylloIg) return 'syncing'
    if (ig && ig.source === 'stub') return 'demo'
    return 'none'
  }

  // ─────────────── helpers ─────────────────────────────────────────
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  // Some feed sources ship titles with embedded HTML (e.g. "<strong>Wait!
  // Do I Need a Statin Now?</strong>"). Strip tags + decode entities before
  // passing to esc() so the card doesn't show raw markup.
  const stripTags = (s) => {
    const str = String(s ?? '')
    const noTags = str.replace(/<[^>]*>/g, '')
    const ta = typeof document !== 'undefined' ? document.createElement('textarea') : null
    if (!ta) return noTags
    ta.innerHTML = noTags
    return ta.value
  }

  function pickLatestOutput(task) {
    const outs = task?.outputs
    if (!outs || outs.length === 0) return null
    return outs.reduce((a, b) => (new Date(a.createdAt) > new Date(b.createdAt) ? a : b))
  }

  const short = (n) => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
    // Below 10K show the exact grouped number (6,313), above that compact.
    if (n >= 10_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
    return Number(n || 0).toLocaleString()
  }

  // ── Dynamic tooltip builder — computes real insights from data ────
  // Maya reads the data. Jordan tells you what to do about it.
  function igTip(metric, ig, ov) {
    const accounts = ov?.accounts || []
    const igAcct = accounts.find((a) => a.platform === 'instagram')
    const reachPct = ig.followerCount > 0 ? Math.round(ig.avgReach / ig.followerCount * 100) : 0
    const media = ig.recentMedia || []
    const formats = {}
    media.forEach((m) => { const k = m.media_type === 'VIDEO' ? 'Reels' : m.media_type === 'CAROUSEL_ALBUM' ? 'Carousels' : 'Photos'; formats[k] = (formats[k]||0)+1 })
    const topFormat = Object.entries(formats).sort((a,b) => b[1]-a[1])[0]

    switch (metric) {
      case 'followers':
        if (igAcct?.prevFollowers != null) {
          const weekDelta = ig.followerCount - igAcct.prevFollowers
          const maya = weekDelta > 0 ? 'Maya: Up ' + short(weekDelta) + ' this week.' : weekDelta < 0 ? 'Maya: Down ' + short(Math.abs(weekDelta)) + ' this week.' : 'Maya: Flat this week.'
          const jordan = weekDelta > 50 ? ' Jordan: Momentum is real — don\'t change the formula.' : weekDelta > 0 ? ' Jordan: Post one extra time this week to compound the growth.' : weekDelta < 0 ? ' Jordan: Revisit your last 3 posts — something shifted. Lean back into personal content.' : ' Jordan: Try a slideshow with a strong caption on Thursday — your best performing day.'
          return maya + jordan
        }
        return 'Maya: ' + short(ig.followerCount) + ' followers tracked. Jordan: Connect more data for weekly growth insights.'
      case 'posts':
        const maya = 'Maya: ' + ig.postCount + ' posts.' + (topFormat ? ' ' + topFormat[0] + ' are ' + Math.round(topFormat[1]/media.length*100) + '% of content.' : '')
        const jordan = media.length < 10 ? ' Jordan: You need more content in the catalog — aim for 3 posts this week.' : topFormat && topFormat[0] === 'Photos' ? ' Jordan: Shift toward slideshows and reels — they get 2-3x more reach.' : ''
        return maya + jordan
      case 'engagement':
        return 'Maya: ' + ig.engagementRate.toFixed(1) + '% engagement, reaching ' + reachPct + '% of followers.' + (reachPct > 30 ? ' Jordan: Distribution is strong. Focus on converting followers to commenters with questions in captions.' : ' Jordan: Reach is low at ' + reachPct + '%. Post a Reel this week — they get 3x the algorithmic push of static posts.')
      case 'reach':
        return 'Maya: ' + short(ig.avgReach) + ' people per post, ' + reachPct + '% of followers.' + (reachPct > 50 ? ' Jordan: Excellent. Your content is living on Explore. Keep this format going.' : reachPct < 20 ? ' Jordan: Most followers aren\'t seeing your posts. Post between 6-8pm on your best day and lead with a Reel.' : ' Jordan: Solid. Bump this by using trending audio or location tags in your next post.')
      default: return ''
    }
  }

  function ttTip(metric, tt) {
    var vr = tt.followerCount > 0 ? (tt.avgViews / tt.followerCount * 100).toFixed(0) : 0
    var conv = tt.avgViews > 0 ? (tt.avgLikes / tt.avgViews * 100).toFixed(1) : 0
    switch (metric) {
      case 'followers':
        return 'Maya: ' + short(tt.followerCount) + ' followers. Reach rate is ' + vr + '%.' + (tt.followerCount < 1000 ? ' Jordan: Focus on captions — one viral video can 10x this number overnight.' : ' Jordan: Your ' + vr + '% reach means the algorithm is serving you to ' + short(tt.avgViews) + ' people per video. Keep posting.')
      case 'videos':
        return 'Maya: ' + tt.videoCount + ' videos in your catalog.' + (tt.videoCount < 20 ? ' Jordan: Post daily for the next 2 weeks — TikTok rewards frequency heavily in the first 30 videos.' : tt.videoCount < 50 ? ' Jordan: Building momentum. Batch-film 5 videos on Sunday so you can post every day.' : ' Jordan: Strong library. The algorithm will resurface your best content — focus on new formats.')
      case 'views':
        return 'Maya: ' + short(tt.avgViews) + ' avg views (' + vr + '% of followers).' + (Number(vr) > 100 ? ' Jordan: For You feed is your main channel. Double down on what\'s working — the algorithm is on your side.' : Number(vr) < 50 ? ' Jordan: Videos aren\'t escaping your follower base. Open with a question or visual pattern interrupt in the first second.' : ' Jordan: Close to breakout. Your next video — lead with your strongest caption from your top performer.')
      case 'engagement':
        return 'Maya: ' + ((tt.engagementRate || 0) * 100).toFixed(1) + '% engagement rate.' + (tt.engagementRate >= 0.08 ? ' Jordan: This is excellent. The algorithm reads this as quality — it will push you further.' : tt.engagementRate >= 0.05 ? ' Jordan: Healthy. End your next 3 videos with a direct question to drive comments up.' : ' Jordan: Viewers watch but don\'t interact. Try a "reply to this comment" video or a duet this week.')
      case 'reach':
        return 'Maya: ' + vr + '% reach rate.' + (Number(vr) >= 100 ? ' Jordan: You\'re reaching beyond followers. For You is your distribution — keep testing new content angles.' : ' Jordan: Most views from existing followers. Use trending sounds and hashtags on your next 3 posts to break into new audiences.')
      case 'conversion':
        return 'Maya: ' + conv + '% of viewers like your videos.' + (Number(conv) >= 8 ? ' Jordan: High conversion — your content connects on first watch. Lead with this format for the next week.' : Number(conv) >= 4 ? ' Jordan: Average. Your thumbnail and first frame determine who likes — test a text overlay hook.' : ' Jordan: Low conversion. The emotional payoff isn\'t landing. Study your top-liked video and replicate its structure.')
      default: return ''
    }
  }

  const timeAgo = (iso) => {
    const diff = Math.max(0, Date.now() - new Date(iso).getTime())
    const m = Math.floor(diff / 60000)
    if (m < 1) return 'just now'
    if (m < 60) return m + 'm ago'
    const h = Math.floor(m / 60)
    if (h < 24) return h + 'h ago'
    return Math.floor(h / 24) + 'd ago'
  }

  const greetingFor = (name) => {
    const h = new Date().getHours()
    const g = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
    return `${g}, ${name || 'there'}.`
  }

  const ROLE = {
    analyst: { name: 'Maya', title: 'Trend Analyst', init: 'M' },
    strategist: { name: 'Jordan', title: 'Content Strategist', init: 'J' },
    copywriter: { name: 'Alex', title: 'Copywriter', init: 'A' },
    creative_director: { name: 'Riley', title: 'Creative Director', init: 'R' },
  }

  const EMPLOYEE_ROLES = ['strategist', 'analyst', 'copywriter', 'creative_director']

  /** When there is no open task, rotate slow “always working” copy per role. */
  const AMBIENT_BY_ROLE = {
    analyst: [
      'Scanning niche signals and velocity in the feed.',
      'Cross-checking trends against your last wins.',
      'Watching competitor moves in your category.',
      'Refreshing the insight window for the next read.',
    ],
    strategist: [
      'Reconciling pillars with live trends Maya flagged.',
      'Pulling next-week slots against growth signals.',
      'Tuning cadence to when your audience peaks.',
      'Stress-testing captions Alex will write.',
    ],
    copywriter: [
      "Drafting variants against Jordan's plan.",
      'Sharpening saves and CTAs for your voice.',
      'Pulling caption patterns from top performers.',
      'Aligning captions with what Riley can shoot.',
    ],
    creative_director: [
      'Storyboarding shots that match the script.',
      'Locking pacing and cut points for the edit.',
      'Sourcing visual references for the next reel.',
      'Checking production feasibility for cold opens.',
    ],
  }

  function ambientLine(role) {
    const lines = AMBIENT_BY_ROLE[role] || ['Standing watch on your lane.']
    const i = (Math.floor(Date.now() / 90000) + role.length * 7) % lines.length
    return lines[i]
  }

  const TASK_FOCUS_ORDER = { in_progress: 0, revision: 1, pending: 2, delivered: 3, approved: 4, rejected: 5 }

  function sortTasksForFocus(tasks) {
    return tasks.slice().sort((a, b) => {
      const pa = TASK_FOCUS_ORDER[a.status] ?? 9
      const pb = TASK_FOCUS_ORDER[b.status] ?? 9
      if (pa !== pb) return pa - pb
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })
  }

  function injectMotionStyles() {
    if (document.getElementById('vx-dash-v2-motion')) return
    const st = document.createElement('style')
    st.id = 'vx-dash-v2-motion'
    st.textContent = `
      @keyframes vx-pulse-dot { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(0.92)} }
      .vx-pulse-dot { animation: vx-pulse-dot 2.4s ease-in-out infinite; }
      .vx-team-avatar-ring { position: relative; }
      .vx-team-avatar-ring::after {
        content: ''; position: absolute; inset: -3px; border-radius: 9px;
        border: 1px solid var(--b2);
        opacity: 0.9; pointer-events: none;
        animation: vx-pulse-dot 2.8s ease-in-out infinite;
      }
      .vx-hint {
        position: relative; cursor: help; color: var(--t2); font-size: 11px;
        opacity: 0.7; transition: opacity .15s;
      }
      .vx-hint:hover { opacity: 1; z-index: 10000; }
      .vx-dcard { overflow: visible !important; position: relative; }
      .vx-dcard:has(.vx-hint:hover) { z-index: 10000; }
      .vx-hint-tip {
        display: none; position: absolute; top: 50%; left: calc(100% + 8px);
        transform: translateY(-50%); width: 260px; padding: 12px 14px;
        border-radius: 10px; background: var(--t1); color: var(--inv, var(--bg));
        font-size: 11px; font-weight: 400; letter-spacing: 0; text-transform: none;
        line-height: 1.65; z-index: 9999;
        box-shadow: 0 8px 24px rgba(0,0,0,.35);
        pointer-events: none;
      }
      .vx-hint-tip.vx-tip-left {
        left: auto; right: calc(100% + 8px);
      }
      .vx-hint:hover .vx-hint-tip { display: block; }

      /* ── Reveal animations (Harry George style) ────────────────── */
      #view-db-dashboard main {
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }
      #view-db-dashboard section { margin-bottom: 32px; }

      /* Scoped to dashboard only: marketing uses the same .vx-reveal class via
         reveal-wire.js + .is-in, and must not inherit blur(10px) here. */
      #view-db-dashboard .vx-reveal {
        opacity: 0;
        filter: blur(10px);
        transform: translateY(28px);
        transition: opacity 0.8s cubic-bezier(.16,1,.3,1),
                    filter 0.8s cubic-bezier(.16,1,.3,1),
                    transform 0.8s cubic-bezier(.16,1,.3,1);
      }
      #view-db-dashboard .vx-reveal.vx-visible {
        opacity: 1;
        filter: blur(0);
        transform: translateY(0);
      }

      /* Card hover depth */
      .vx-dcard {
        transition: transform 0.25s cubic-bezier(.16,1,.3,1),
                    border-color 0.25s ease,
                    box-shadow 0.25s ease;
      }
      .vx-dcard:hover {
        transform: translateY(-2px);
        border-color: var(--b2);
        box-shadow: 0 4px 20px rgba(0,0,0,0.06);
      }

      /* Sparkline draw */
      @keyframes vx-draw {
        to { stroke-dashoffset: 0; }
      }
      .vx-sparkline-draw {
        stroke-dasharray: var(--path-length);
        stroke-dashoffset: var(--path-length);
        animation: vx-draw 1.2s cubic-bezier(.16,1,.3,1) 0.4s forwards;
      }
      .vx-sparkline-fill {
        opacity: 0;
        animation: vx-fade-in 0.6s ease 1.2s forwards;
      }
      @keyframes vx-fade-in { to { opacity: 0.08; } }

      /* Respect reduced motion */
      @media (prefers-reduced-motion: reduce) {
        #view-db-dashboard .vx-reveal { opacity: 1; filter: none; transform: none; transition: none; }
        .vx-sparkline-draw { animation: none; stroke-dashoffset: 0; }
        .vx-sparkline-fill { animation: none; opacity: 0.08; }
        .vx-dcard { transition: none; }
      }
    `
    document.head.appendChild(st)
  }

  // ── Scroll reveal observer ────────────────────────────────────────
  function animateOnReveal(root) {
    if (typeof IntersectionObserver === 'undefined') return
    const scrollParent = root.querySelector('main')
    if (!scrollParent) return
    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return
        e.target.classList.add('vx-visible')
        var cards = e.target.querySelectorAll('.vx-dcard, .vx-reveal-child')
        cards.forEach(function (card, i) {
          card.style.transitionDelay = (i * 0.08) + 's'
          card.classList.add('vx-visible')
        })
        observer.unobserve(e.target)
      })
    }, { root: scrollParent, threshold: 0.05 })
    var sectionIdx = 0
    scrollParent.querySelectorAll('section').forEach(function (s) {
      s.classList.add('vx-reveal')
      s.style.transitionDelay = (sectionIdx * 0.15) + 's'
      s.querySelectorAll('.vx-dcard').forEach(function (c) { c.classList.add('vx-reveal') })
      observer.observe(s)
      sectionIdx++
    })
    // Also reveal non-section direct children (pulse banner, next-action)
    scrollParent.querySelectorAll(':scope > div').forEach(function (d) {
      if (d.querySelector('section')) return
      d.classList.add('vx-reveal')
      d.style.transitionDelay = (sectionIdx * 0.1) + 's'
      observer.observe(d)
      sectionIdx++
    })
  }

  // ── Number count-up ───────────────────────────────────────────────
  function animateCounters(root) {
    root.querySelectorAll('.vx-tile-value').forEach(function (el) {
      var text = el.textContent.trim()
      var match = text.match(/^([0-9,.]+)(.*)$/)
      if (!match) return
      var target = parseFloat(match[1].replace(/,/g, ''))
      var suffix = match[2] || ''
      if (!target || isNaN(target)) return
      var isDecimal = match[1].includes('.')
      var duration = 800
      var start = performance.now()
      function tick(now) {
        var t = Math.min(1, (now - start) / duration)
        var eased = 1 - Math.pow(1 - t, 3)
        var current = target * eased
        if (isDecimal) {
          el.textContent = current.toFixed(1) + suffix
        } else if (current >= 1000) {
          el.textContent = Math.round(current).toLocaleString() + suffix
        } else {
          el.textContent = Math.round(current) + suffix
        }
        if (t < 1) requestAnimationFrame(tick)
        else el.textContent = text // restore exact original
      }
      requestAnimationFrame(tick)
    })
  }

  // ── Sparkline draw setup ──────────────────────────────────────────
  function animateSparklines(root) {
    root.querySelectorAll('polyline').forEach(function (line) {
      try {
        var len = line.getTotalLength()
        if (!len || len < 10) return
        line.style.setProperty('--path-length', len)
        line.classList.add('vx-sparkline-draw')
      } catch (e) { /* SVG not rendered yet */ }
    })
    root.querySelectorAll('polygon').forEach(function (poly) {
      poly.classList.add('vx-sparkline-fill')
    })
  }

  // ─────────────── sections ────────────────────────────────────────
  function sectionHeader() {
    const me = STATE.me
    const user = me?.user
    const company = me?.companies?.[0]
    const u = STATE.usage
    const status = u?.subscriptionStatus || 'trial'
    const daysLeft = u?.trialEndsAt ? Math.max(0, Math.ceil((new Date(u.trialEndsAt).getTime() - Date.now()) / 86400000)) : null
    const chipLabel = status === 'trial' && daysLeft != null
      ? `${capitalize(u.plan)} · Trial · ${daysLeft}d left`
      : `${capitalize(u?.plan || 'starter')} · ${capitalize(status)}`

    return `
      <section style="margin-bottom:28px">
        <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap">
          <div>
            <h1 style="font-family:'Cormorant Garamond',serif;font-size:clamp(30px,3.5vw,44px);font-weight:500;line-height:1.08;letter-spacing:-.02em;color:var(--t1);margin:0 0 6px">${esc(greetingFor(user?.fullName || user?.username))}</h1>
            <div style="color:var(--t2);font-size:12px">${esc(company?.name || 'Your company')} · ${esc(formatNiche(company?.niche))}</div>
            <p style="margin:12px 0 0;color:var(--t3);font-size:11px;max-width:680px;line-height:1.6">Everyone here is trying to <span style="color:var(--t2)">grow the platform</span> — the team figures the best moves from signals, memory, and performance. Your day should skew to <span style="color:var(--t2)">what shipped and what worked</span>; you only need to step in when something is worth a real decision, not every micro-step.</p>
          </div>
          <button data-v2-nav="db-settings" style="background:var(--s2);border:none;color:var(--t2);padding:7px 14px;border-radius:8px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;font-family:inherit">${esc(chipLabel)}</button>
        </div>
      </section>
    `
  }

  /** One line under the header: the workforce is never framed as “idle”. */
  function sectionTeamPulseBanner() {
    const live = EMPLOYEE_ROLES.filter((role) => {
      const ts = STATE.tasks.filter((t) => t.employee?.role === role)
      return ts.some((t) => t.status === 'in_progress' || t.status === 'revision' || t.status === 'pending')
    }).length
    const awaiting = STATE.tasks.filter((t) => t.status === 'delivered').length
    let body
    if (awaiting > 0 && live > 0) {
      body = `${awaiting} drop${awaiting > 1 ? 's' : ''} need your sign-off — and ${live} teammate${live > 1 ? 's are' : ' is'} still executing in parallel.`
    } else if (awaiting > 0) {
      body = `${awaiting} drop${awaiting > 1 ? 's' : ''} need your sign-off. The rest of the team stays on watch for the next move.`
    } else if (live > 0) {
      body = `${live} teammate${live > 1 ? 's are' : ' is'} live on briefs. Nothing is waiting on you right now — they keep the lane warm until the next drop.`
    } else {
      body = 'Your team is on watch: scanning signals, keeping plans aligned, and staged for the next brief — even when the queue is quiet.'
    }

    // Posting activity nudge
    let postingNote = ''
    const tt = STATE.tiktok
    if (tt) {
      const vids = Array.isArray(tt.recentVideos) ? tt.recentVideos : []
      const latest = vids.length > 0 ? vids.reduce((a, b) => ((b.createdAt || 0) > (a.createdAt || 0) ? b : a)) : null
      if (latest?.createdAt) {
        const daysAgo = Math.floor((Date.now() - latest.createdAt * 1000) / 86400000)
        if (daysAgo === 0) {
          postingNote = 'You posted today — nice.'
        } else if (daysAgo === 1) {
          postingNote = 'Last post was yesterday.'
        } else if (daysAgo >= 3) {
          postingNote = `You haven\u2019t posted in ${daysAgo} days. Brief Alex for a quick caption?`
        }
      }
    }

    return `
      <div style="margin:-4px 0 24px;padding:16px 20px;border:1px solid var(--b1);border-radius:12px;background:var(--s1);color:var(--t2);font-size:12px;line-height:1.55">
        <span style="color:var(--t3);font-size:10px;letter-spacing:.12em;text-transform:uppercase;display:block;margin-bottom:4px">Team pulse</span>
        ${esc(body)}${postingNote ? `<br/><span style="color:var(--t1);font-weight:500">${esc(postingNote)}</span>` : ''}
      </div>
    `
  }

  /** Single hero CTA — inbox-first, not “dashboard wallpaper”. */
  function sectionCeoNextAction() {
    const delivered = STATE.tasks
      .filter((t) => t.status === 'delivered')
      .slice()
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    const inProgress = STATE.tasks.filter((t) => t.status === 'in_progress')
    if (delivered.length === 0 && inProgress.length > 0) {
      const working = inProgress[0]
      const workingRole = ROLE[working.employee?.role] || { name: 'Your team', init: '?' }
      return `
        <section style="margin-bottom:22px">
          <div style="border:1px solid var(--b1);border-radius:14px;padding:22px 24px;background:linear-gradient(145deg, var(--s1) 0%, var(--s3) 100%)">
            <div style="color:var(--t3);font-size:10px;letter-spacing:.14em;text-transform:uppercase;margin-bottom:8px;font-family:'Syne',sans-serif">Next for you</div>
            <div style="color:var(--t1);font-family:'Cormorant Garamond',serif;font-size:clamp(22px,2.6vw,28px);line-height:1.15;font-weight:500;letter-spacing:-.01em;margin-bottom:8px">${esc(workingRole.name)} is working on something for you.</div>
            <p style="color:var(--t2);font-size:12px;line-height:1.55;margin:0">${esc(working.title)} — you'll see it here when it's ready.</p>
          </div>
        </section>
      `
    }
    if (delivered.length === 0) {
      // Check if platforms are connected — tailor the empty state
      const hasAccounts = STATE.overview?.accounts?.length > 0
      const headline = hasAccounts
        ? 'Your team is standing by.'
        : 'Connect a platform to get started.'
      const sub = hasAccounts
        ? 'Brief an agent or wait for the next proactive report.'
        : 'Once your TikTok or Instagram is connected, Maya will analyze your content automatically.'
      return `
        <section style="margin-bottom:22px">
          <div style="border:1px solid var(--b1);border-radius:14px;padding:22px 24px;background:var(--s1)">
            <div style="color:var(--t3);font-size:10px;letter-spacing:.14em;text-transform:uppercase;margin-bottom:8px;font-family:'Syne',sans-serif">Next for you</div>
            <div style="color:var(--t1);font-family:'Cormorant Garamond',serif;font-size:clamp(22px,2.6vw,28px);line-height:1.15;font-weight:500;letter-spacing:-.01em;margin-bottom:8px">${esc(headline)}</div>
            <p style="color:var(--t2);font-size:12px;line-height:1.55;margin:0 0 16px">${esc(sub)}</p>
            <div style="display:flex;flex-wrap:wrap;gap:10px">
              ${hasAccounts
                ? `<button type="button" data-v2-brief="analyst" data-v2-brief-name="Maya" style="background:var(--t1);color:var(--inv,var(--bg));border:none;padding:8px 18px;border-radius:8px;font-size:11px;font-weight:600;font-family:'Syne',sans-serif;cursor:pointer">Brief Maya</button>`
                : `<button type="button" data-v2-nav="db-settings" style="background:var(--t1);color:var(--inv,var(--bg));border:none;padding:8px 18px;border-radius:8px;font-size:11px;font-weight:600;font-family:'Syne',sans-serif;cursor:pointer">Connect a platform</button>`}
            </div>
          </div>
        </section>
      `
    }
    const first = delivered[0]
    const role = ROLE[first.employee?.role] || { name: 'Your teammate', title: '', init: '?' }
    const n = delivered.length
    const headline =
      n === 1
        ? `One drop is waiting — start with ${role.name}.`
        : `You have ${n} drops waiting — start with ${role.name}'s first.`
    return `
      <section style="margin-bottom:22px">
        <div style="border:1px solid var(--b1);border-radius:14px;padding:22px 24px;background:linear-gradient(145deg, var(--s1) 0%, var(--s3) 100%)">
          <div style="color:var(--t3);font-size:10px;letter-spacing:.14em;text-transform:uppercase;margin-bottom:8px;font-family:'Syne',sans-serif">Next for you</div>
          <div style="display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:16px">
            <div style="min-width:0;flex:1">
              <div style="color:var(--t1);font-family:'Cormorant Garamond',serif;font-size:clamp(22px,2.8vw,30px);line-height:1.12;font-weight:500;letter-spacing:-.01em">${esc(headline)}</div>
              <div style="color:var(--t2);font-size:12px;margin-top:8px;line-height:1.45">${esc(first.title)} · ${esc(formatType(first.type))}</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;align-items:stretch;min-width:140px">
              <button type="button" data-v2-focus-task="${first.id}" style="background:var(--t1);color:var(--inv,var(--bg));border:none;padding:10px 18px;border-radius:8px;font-size:12px;font-weight:600;font-family:'Syne',sans-serif;letter-spacing:.04em;cursor:pointer">Open & decide</button>
              <button type="button" data-v2-scroll-review="${first.id}" style="background:transparent;border:1px solid var(--b2);color:var(--t2);padding:8px 14px;border-radius:8px;font-size:11px;font-family:inherit;cursor:pointer">Scroll to card</button>
            </div>
          </div>
        </div>
      </section>
    `
  }

  function sectionQueueNav() {
    return `
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:-6px 0 24px">
        <span style="color:var(--t3);font-size:10px;letter-spacing:.12em;text-transform:uppercase;font-family:'Syne',sans-serif">Operating mode</span>
        <strong style="color:var(--t1);font-size:12px">Queue first</strong>
        <span style="color:var(--t3)">·</span>
        <button type="button" data-v2-nav="db-tasks" style="background:none;border:none;color:var(--t2);font-size:12px;cursor:pointer;font-family:inherit;text-decoration:underline;padding:0">Work queue</button>
        <button type="button" data-v2-nav="db-knowledge" style="background:none;border:none;color:var(--t3);font-size:11px;cursor:pointer;font-family:inherit;padding:0">Explore feed</button>
        <button type="button" data-v2-nav="db-outputs" style="background:none;border:none;color:var(--t3);font-size:11px;cursor:pointer;font-family:inherit;padding:0">Outputs</button>
      </div>
    `
  }

  function sectionOverview() {
    const u = STATE.usage
    const ov = STATE.overview
    const awaiting = STATE.tasks.filter((t) => t.status === 'delivered').length
    const hasAccounts = ov && ov.accounts && ov.accounts.length > 0

    const tasksLimit = u?.tasks?.limit ?? 30
    const tasksUsed = u?.tasks?.used ?? 0
    const pct = Math.min(100, Math.round((tasksUsed / Math.max(1, tasksLimit)) * 100))

    // Followers tile
    const fVal = hasAccounts ? short(ov.combinedFollowers) : '—'
    const fSub = hasAccounts
      ? ov.accounts.map((a) => `${platformBadge(a.platform)} ${short(a.latestFollowers)}`).join(' · ')
      : 'Not connected'
    const fDelta = hasAccounts && ov.combinedFollowersDelta !== 0
      ? `${ov.combinedFollowersDelta >= 0 ? '+' : ''}${short(Math.abs(ov.combinedFollowersDelta))} this week`
      : ''

    // Top post tile — with thumbnail
    const tp = ov?.topPost

    function topPostTile() {
      if (!tp) return tile('Top post', '—', 'No posts synced yet')
      var thumb = tp.thumbnailUrl || ''
      var caption = (tp.caption || '').slice(0, 50)
      var badge = platformBadge(tp.platform)
      var url = tp.url || '#'
      return '<a href="' + esc(url) + '" target="_blank" rel="noopener" class="vx-dcard" style="text-decoration:none;color:inherit;background:var(--s1);border:1px solid var(--b1);border-radius:14px;padding:20px 22px;display:flex;gap:14px;align-items:center">'
        + (thumb
          ? '<img src="' + esc(thumb) + '" alt="" style="width:48px;height:48px;border-radius:8px;object-fit:cover;flex-shrink:0;background:var(--s3)" loading="lazy" onerror="this.style.display=\'none\'" />'
          : '<div style="width:48px;height:48px;border-radius:8px;background:var(--s3);flex-shrink:0;display:grid;place-items:center;color:var(--t3);font-size:9px">' + esc(badge) + '</div>')
        + '<div style="min-width:0;flex:1">'
        + '<div style="color:var(--t3);font-size:10px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px;display:flex;align-items:center;gap:5px">Top post<span class="vx-hint" aria-label="Your best performing post overall. Comments and shares count more because they show deeper audience connection.">ⓘ<span class="vx-hint-tip">Your best performing post overall. Comments and shares count more because they show deeper audience connection.</span></span></div>'
        + '<div class="vx-tile-value" style="color:var(--t1);font-family:\'DM Sans\',system-ui;font-weight:500;font-size:20px;letter-spacing:-.01em;line-height:1;margin-bottom:4px">' + short(tp.engagementScore) + '</div>'
        + '<div style="color:var(--t2);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(badge) + ' ' + esc(caption) + (caption.length >= 50 ? '…' : '') + '</div>'
        + '</div></a>'
    }

    return `
      <section style="margin-bottom:32px">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px">
          ${''}<!-- awaiting review is now the notification list below -->
          ${tile('Followers', fVal, fDelta || fSub)}
          ${topPostTile()}
          ${tile('Tasks used', `${tasksUsed}/${tasksLimit >= 9999 ? '∞' : tasksLimit}`, `${pct}% of plan`, null, pct)}
        </div>

        ${overviewSparkline(ov)}
        ${overviewAudiencePeek(ov)}

        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:18px">
          <button type="button" data-v2-soft-refresh style="background:var(--s2);border:none;color:var(--t2);padding:7px 14px;border-radius:8px;font-size:10px;font-family:inherit;cursor:pointer">Refresh dashboard</button>
          ${hasAccounts
            ? `<button type="button" data-v2-nav="db-settings" style="background:var(--s2);border:none;color:var(--t2);padding:7px 14px;border-radius:8px;font-size:10px;font-family:inherit;cursor:pointer">See data in Settings</button>
               <button type="button" data-v2-nav="db-outputs" style="background:var(--s2);border:none;color:var(--t2);padding:7px 14px;border-radius:8px;font-size:10px;font-family:inherit;cursor:pointer">See what shipped</button>`
            : `<button type="button" data-v2-nav="db-settings" style="background:var(--t1);color:var(--inv,var(--bg));border:none;padding:7px 16px;border-radius:8px;font-size:10px;font-weight:600;font-family:inherit;cursor:pointer">Connect a platform</button>`}
        </div>
      </section>
    `
  }

  function platformBadge(platform) {
    const labels = { instagram: 'IG', tiktok: 'TT', youtube: 'YT', twitter_x: 'X' }
    return labels[platform] || platform
  }

  function overviewSparkline(ov) {
    if (!ov || !ov.sparkline || ov.sparkline.length === 0) return ''
    const spark = ov.sparkline
    if (spark.length < 2) {
      return `
        <div style="background:var(--s1);border:1px solid var(--b1);border-radius:14px;padding:22px 24px;margin-top:14px">
          <div style="color:var(--t3);font-size:10px;letter-spacing:.14em;text-transform:uppercase;margin-bottom:8px">FOLLOWER TRAJECTORY — 30D</div>
          <div style="height:80px;display:grid;place-items:center;color:var(--t3);font-size:12px">Trajectory builds as your team syncs data</div>
        </div>`
    }
    const ys = spark.map((s) => s.total)
    const min = Math.min(...ys), max = Math.max(...ys)
    const range = Math.max(1, max - min)
    const W = 600, H = 110, top = 10, bottom = H - 24
    const step = W / (spark.length - 1)
    const pts = spark.map((s, i) => `${(i * step).toFixed(1)},${(bottom - ((s.total - min) / range) * (bottom - top)).toFixed(1)}`).join(' ')
    const areaPts = `0,${H} ${pts} ${W},${H}`
    const delta = ov.combinedFollowersDelta
    const deltaBadge = delta !== 0
      ? `<span style="color:${delta > 0 ? '#34d27a' : '#ff6b6b'};font-size:12px;font-weight:600;margin-left:10px">${delta > 0 ? '+' : ''}${short(Math.abs(delta))} this week</span>`
      : ''
    const firstDate = spark[0].date.slice(5)
    const midDate = spark[Math.floor(spark.length / 2)].date.slice(5)
    const lastDate = spark[spark.length - 1].date.slice(5)
    const startY = bottom - ((ys[0] - min) / range) * (bottom - top)

    return `
      <div style="background:var(--s1);border:1px solid var(--b1);border-radius:14px;padding:22px 24px;margin-top:14px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px">
          <div style="color:var(--t3);font-size:10px;letter-spacing:.14em;text-transform:uppercase">FOLLOWER TRAJECTORY — 30D${deltaBadge}</div>
          <div style="color:var(--t1);font-size:13px;font-weight:600">${short(ys[ys.length - 1])}</div>
        </div>
        <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" style="display:block">
          <line x1="0" y1="${startY.toFixed(1)}" x2="${W}" y2="${startY.toFixed(1)}" stroke="var(--b2)" stroke-width="1" stroke-dasharray="4,4" />
          <polygon points="${areaPts}" fill="var(--t1)" fill-opacity="0.08" />
          <polyline points="${pts}" fill="none" stroke="var(--t1)" stroke-width="2" stroke-linejoin="round" />
        </svg>
        <div style="display:flex;justify-content:space-between;color:var(--t3);font-size:9px;margin-top:4px">
          <span>${firstDate}</span><span>${midDate}</span><span>${lastDate}</span>
        </div>
      </div>`
  }

  function overviewAudiencePeek(ov) {
    if (!ov || !ov.audience) return ''
    const a = ov.audience
    const topAge = (a.ageBreakdown || []).slice().sort((x, y) => y.share - x.share)[0]
    const topCountry = (a.topCountries || []).slice().sort((x, y) => y.share - x.share)[0]
    const genders = (a.genderBreakdown || []).slice().sort((x, y) => y.share - x.share)
    const topGender = genders[0]

    if (!topAge && !topCountry && !topGender) return ''

    const mini = (label, value, hint) => {
      const hintEl = hint
        ? `<span class="vx-hint" aria-label="${esc(hint)}">ⓘ<span class="vx-hint-tip">${esc(hint)}</span></span>`
        : ''
      return `
      <div style="flex:1;background:var(--s1);border:1px solid var(--b1);border-radius:12px;padding:16px 18px">
        <div style="color:var(--t3);font-size:9px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:8px;display:flex;align-items:center;gap:4px">${esc(label)}${hintEl}</div>
        <div style="color:var(--t1);font-size:16px;font-weight:500;letter-spacing:-.01em">${esc(value)}</div>
      </div>`
    }

    return `
      <div style="margin-top:12px">
        <div style="color:var(--t3);font-size:10px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:8px">AUDIENCE</div>
        <div style="display:flex;gap:10px">
          ${topAge ? mini('Top age', `${topAge.bucket} · ${Math.round(topAge.share * 100)}%`) : ''}
          ${topCountry ? mini('Top country', `${topCountry.bucket} · ${Math.round(topCountry.share * 100)}%`) : ''}
          ${topGender ? mini('Gender split', `${Math.round(topGender.share * 100)}% ${topGender.bucket}`) : ''}
        </div>
      </div>`
  }

  function tile(label, value, sub, navId, progressPct, hint) {
    const action = navId ? `data-v2-nav="${navId}" style="cursor:pointer"` : ''
    const hintEl = hint
      ? `<span class="vx-hint" aria-label="${esc(hint)}">ⓘ<span class="vx-hint-tip">${esc(hint)}</span></span>`
      : ''
    return `
      <div ${action} class="vx-dcard${navId ? ' vx-dcard-nav' : ''}" style="background:var(--s1);border:1px solid var(--b1);border-radius:14px;padding:20px 22px">
        <div style="color:var(--t3);font-size:10px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px;display:flex;align-items:center;gap:5px">${esc(label)}${hintEl}</div>
        <div class="vx-tile-value" style="color:var(--t1);margin-bottom:4px;font-family:'DM Sans',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-weight:500;font-size:26px;letter-spacing:-.01em;line-height:1;font-style:normal">${esc(value)}</div>
        <div style="color:var(--t2);font-size:11px">${esc(sub)}</div>
        ${progressPct != null ? `<div style="height:2px;border-radius:2px;background:var(--s3);margin-top:8px;overflow:hidden"><div style="width:${progressPct}%;height:100%;background:var(--t1);transition:width .4s ease"></div></div>` : ''}
      </div>
    `
  }

  function sectionReviewQueue() {
    const delivered = STATE.tasks.filter((t) => t.status === 'delivered').slice(0, 6)
    if (delivered.length === 0) return ''
    return `
      <div style="margin-bottom:20px">
        <div style="display:flex;flex-direction:column;gap:1px;border:1px solid var(--b1);border-radius:14px;overflow:hidden">
          ${delivered.map(reviewNotif).join('')}
        </div>
      </div>
    `
  }

  function reviewNotif(t) {
    const role = ROLE[t.employee?.role] || { name: 'Sovexa', init: 'V' }
    return '<div data-task-id="' + t.id + '" class="vx-dcard" style="background:var(--s1);padding:14px 18px;display:flex;align-items:center;gap:14px;cursor:pointer;transition:background .15s" onmouseenter="this.style.background=\'var(--s2)\'" onmouseleave="this.style.background=\'var(--s1)\'">'
      + '<div style="width:30px;height:30px;border-radius:8px;background:var(--s3);color:var(--t1);display:grid;place-items:center;font-weight:600;font-size:11px;font-family:\'Syne\',sans-serif;flex-shrink:0">' + role.init + '</div>'
      + '<div style="flex:1;min-width:0">'
      + '<div style="color:var(--t1);font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(t.title) + '</div>'
      + '<div style="color:var(--t3);font-size:10px">' + esc(role.name) + ' · ' + esc(formatType(t.type)) + ' · ' + esc(timeAgo(t.createdAt)) + '</div>'
      + '</div>'
      + '<div style="display:flex;gap:6px;flex-shrink:0">'
      + '<button data-v2-action="approve" data-task-id="' + t.id + '" style="background:var(--t1);color:var(--inv,var(--bg));border:none;padding:6px 14px;border-radius:8px;font-size:10px;font-weight:600;font-family:inherit;cursor:pointer">Approve</button>'
      + '<button data-v2-action="reject" data-task-id="' + t.id + '" style="background:transparent;border:1px solid var(--b2);color:var(--t2);padding:6px 14px;border-radius:8px;font-size:10px;font-family:inherit;cursor:pointer">Reject</button>'
      + '</div>'
      + '</div>'
  }

  function outputPreview(o) {
    if (!o) return ''
    const c = o.content || {}
    if (Array.isArray(c.hooks) && c.hooks.length) {
      return `<ol style="margin:10px 0 0;padding-left:16px;color:var(--t2);font-size:12px;line-height:1.65">
        ${c.hooks.slice(0, 4).map((h) => `<li${h.flagged ? ' style="color:var(--t1);font-weight:500"' : ''}>${esc(h.text || '')}</li>`).join('')}
      </ol>`
    }
    if (Array.isArray(c.trends) && c.trends.length) {
      return `<ul style="margin:10px 0 0;padding-left:0;list-style:none;color:var(--t2);font-size:12px;line-height:1.6">
        ${c.trends.slice(0, 3).map((t) => `<li style="padding:2px 0"><strong style="color:var(--t1);font-weight:500">${esc(t.topic || '')}</strong> <span style="color:var(--t3);margin:0 5px">·</span> ${esc(t.growth || '')} <span style="color:var(--t3);margin:0 5px">·</span> ${esc(t.verdict || '')}</li>`).join('')}
      </ul>`
    }
    if (Array.isArray(c.posts) && c.posts.length) {
      return `<ul style="margin:10px 0 0;padding-left:0;list-style:none;color:var(--t2);font-size:12px;line-height:1.6">
        ${c.posts.slice(0, 3).map((p) => `<li style="padding:2px 0"><strong style="color:var(--t1);font-weight:500;width:36px;display:inline-block">${esc(p.day || '')}</strong> ${esc(p.format || '')} <span style="color:var(--t3);margin:0 5px">·</span> ${esc(p.topic || '')}</li>`).join('')}
      </ul>`
    }
    return ''
  }

  function sectionTeam() {
    const tasksByRole = {}
    for (const t of STATE.tasks) {
      const r = t.employee?.role
      if (!r) continue
      if (!tasksByRole[r]) tasksByRole[r] = []
      tasksByRole[r].push(t)
    }
    return `
      <section style="margin-bottom:32px">
        ${sectionLabel('Your team')}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px">
          ${EMPLOYEE_ROLES.map((role) => teamCard(role, tasksByRole[role] || [])).join('')}
        </div>
      </section>
    `
  }

  function teamCard(role, tasks) {
    const r = ROLE[role]
    // Check if this role is locked on the current plan
    const userPlan = STATE.me?.user?.plan || 'starter'
    const planEmployees = {
      starter: ['analyst', 'copywriter'],
      pro: ['analyst', 'strategist', 'copywriter', 'creative_director'],
      agency: ['analyst', 'strategist', 'copywriter', 'creative_director'],
    }
    const isLocked = !(planEmployees[userPlan] || planEmployees.starter).includes(role)
    if (isLocked) {
      return `
        <div class="vx-dcard" style="background:var(--s1);border:1px dashed var(--b2);border-radius:12px;padding:16px 18px;opacity:0.6">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <div style="width:26px;height:26px;border-radius:7px;background:var(--s3);color:var(--t3);display:grid;place-items:center;font-weight:600;font-size:12px;font-family:'Syne',sans-serif;flex-shrink:0">${r.init}</div>
            <div>
              <div style="color:var(--t2);font-size:12px;font-weight:600;line-height:1.2">${esc(r.name)}</div>
              <div style="color:var(--t3);font-size:9px;letter-spacing:.06em;text-transform:uppercase">${esc(r.title)}</div>
            </div>
          </div>
          <div style="color:var(--t3);font-size:11px;line-height:1.4;margin-bottom:10px">${esc(r.name)} is available on the Pro plan.</div>
          <button type="button" data-v2-nav="db-settings" style="width:100%;background:transparent;border:1px solid var(--b2);color:var(--t2);padding:6px 10px;border-radius:8px;font-size:10px;font-family:inherit;cursor:pointer">Upgrade to unlock</button>
        </div>
      `
    }

    const delivered = tasks.find((t) => t.status === 'delivered')
    const working = tasks.find((t) => t.status === 'pending' || t.status === 'in_progress' || t.status === 'revision')
    const sorted = sortTasksForFocus(tasks)
    const primary = sorted[0]

    let statusLabel
    let detailLine
    let dotColor
    let pulseDot = true
    let avatarRing = false

    if (delivered) {
      statusLabel = 'Needs your sign-off'
      detailLine = `${delivered.title} — ready when you open review.`
      dotColor = 'var(--t1)'
    } else if (working) {
      statusLabel = 'Live on a brief'
      detailLine = working.title
      dotColor = '#e8c87a'
      avatarRing = true
    } else if (tasks.some((t) => t.status === 'approved' || t.status === 'rejected')) {
      statusLabel = 'Clearing the deck'
      detailLine = primary ? `${primary.title} — lining up what is next.` : 'Prepping the next move for your queue.'
      dotColor = 'var(--t2)'
    } else if (primary) {
      statusLabel = 'On watch'
      detailLine = primary.title
      dotColor = 'var(--t2)'
    } else {
      statusLabel = 'On watch'
      detailLine = ambientLine(role)
      dotColor = 'var(--t2)'
      avatarRing = true
    }

    const dotClass = pulseDot ? 'vx-pulse-dot' : ''
    const avClass = avatarRing ? 'vx-team-avatar-ring' : ''

    return `
      <div class="vx-dcard" style="background:var(--s1);border:1px solid var(--b1);border-radius:12px;padding:16px 18px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <div class="${avClass}" style="width:26px;height:26px;border-radius:7px;background:var(--s3);color:var(--t1);display:grid;place-items:center;font-weight:600;font-size:12px;font-family:'Syne',sans-serif;flex-shrink:0">${r.init}</div>
          <div style="min-width:0">
            <div style="color:var(--t1);font-size:12px;font-weight:600;line-height:1.2">${esc(r.name)}</div>
            <div style="color:var(--t3);font-size:9px;letter-spacing:.06em;text-transform:uppercase">${esc(r.title)}</div>
          </div>
        </div>
        <div style="color:var(--t2);font-size:10px;margin-bottom:4px;display:flex;align-items:center;gap:6px">
          <span class="${dotClass}" style="width:6px;height:6px;border-radius:50%;background:${dotColor};flex-shrink:0"></span>
          ${esc(statusLabel)}
        </div>
        <div style="color:var(--t2);font-size:11px;line-height:1.4;margin-bottom:10px;min-height:32px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${esc(detailLine)}</div>
        <div style="display:flex;gap:6px">
          <button data-v2-brief="${role}" data-v2-brief-name="${r.name}" style="flex:1;background:var(--t1);color:var(--bg);border:none;padding:6px 10px;border-radius:8px;font-size:10px;font-family:inherit;font-weight:600;cursor:pointer">Brief</button>
          <button type="button" data-v2-meeting="${r.name}" data-v2-role="${r.title}" data-v2-init="${r.init}" data-v2-task-id="${delivered ? delivered.id : ''}" style="flex:1;background:transparent;border:1px solid var(--b2);color:var(--t2);padding:6px 10px;border-radius:8px;font-size:10px;font-family:inherit;cursor:pointer">Meeting</button>
        </div>
      </div>
    `
  }

  function sectionPerformance() {
    const ig = STATE.insights
    if (!ig) {
      return `
        <section style="margin-bottom:32px">
          ${sectionLabel('Instagram')}
          <div style="padding:36px;text-align:center;color:var(--t2);font-size:13px;line-height:1.55;border:1px dashed var(--b1);border-radius:14px">
            Connect Instagram to unlock follower, engagement, and audience charts.
            <div style="margin-top:16px">
              <button type="button" data-v2-nav="db-settings" style="background:var(--t1);color:var(--inv,var(--bg));border:none;padding:10px 20px;border-radius:8px;font-size:11px;font-weight:600;font-family:'Syne',sans-serif;cursor:pointer">Connect Instagram</button>
            </div>
          </div>
        </section>
      `
    }
    // Sparse data detection — IG connected via Direct but insights haven't propagated
    const isSparse = ig.engagementRate === 0 && (!ig.recentMedia || ig.recentMedia.length === 0)
    if (isSparse) {
      const platform = ig.platform === 'instagram direct' ? 'Instagram Direct' : 'Instagram'
      return `
        <section style="margin-bottom:32px">
          ${sectionLabel('Instagram')}
          <div style="padding:24px 20px;border:1px solid var(--b1);border-radius:12px;background:var(--s1)">
            <div style="color:var(--t1);font-size:14px;font-weight:500;margin-bottom:8px">@${esc(ig.handle)} connected — insights are syncing</div>
            <div style="color:var(--t2);font-size:12px;line-height:1.55;margin-bottom:4px">
              ${esc(platform)} shows <strong>${ig.followerCount?.toLocaleString() || 0} followers</strong> but detailed metrics (engagement, reach, post performance) aren't available yet.
            </div>
            <ul style="color:var(--t3);font-size:11px;line-height:1.7;margin:12px 0 0;padding-left:18px">
              <li>Make sure your Instagram is a <strong>Professional</strong> account (Creator or Business) — personal accounts don't expose insights.</li>
              <li>If you just switched to Professional, Meta takes 24-48 hours to start reporting data.</li>
              <li>Try resyncing from Settings → Integrations once you've confirmed.</li>
            </ul>
          </div>
        </section>
      `
    }

    const igHandle = ig.handle || ''
    const igBio = ig.bio || ''
    const igProfileUrl = ig.profileUrl || `https://instagram.com/${igHandle}`
    const igEngPct = ig.engagementRate ? ig.engagementRate.toFixed(1) + '%' : '—'
    const igAvatar = (STATE.overview?.accounts || []).find((a) => a.platform === 'instagram')?.profileImageUrl || ''

    return `
      <section style="margin-bottom:32px">
        ${sectionLabel('Instagram')}
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;padding:16px 18px;background:var(--s1);border:1px solid var(--b1);border-radius:14px">
          ${igAvatar ? `<img src="${esc(igAvatar)}" alt="" width="48" height="48" style="border-radius:12px;flex-shrink:0" onerror="this.style.display='none'">` : ''}
          <div style="min-width:0;flex:1">
            <div style="color:var(--t1);font-size:14px;font-weight:500">@${esc(igHandle)}</div>
            ${igBio ? `<div style="color:var(--t2);font-size:12px;line-height:1.4;margin-top:2px;max-width:560px">${esc(String(igBio).slice(0, 140))}${igBio.length > 140 ? '…' : ''}</div>` : ''}
          </div>
          <a href="${esc(igProfileUrl)}" target="_blank" rel="noopener" style="color:var(--t2);font-size:11px;padding:7px 14px;border:none;background:var(--s2);border-radius:8px;text-decoration:none">Open profile</a>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:16px">
          ${kvTile('Followers', short(ig.followerCount), igTip('followers', ig, STATE.overview))}
          ${kvTile('Posts', short(ig.postCount), igTip('posts', ig, STATE.overview))}
          ${kvTile('Engagement', igEngPct, igTip('engagement', ig, STATE.overview))}
          ${kvTile('Avg reach', short(ig.avgReach), igTip('reach', ig, STATE.overview))}
        </div>
        <div style="display:flex;flex-direction:column;gap:14px">
          ${igPostsGrid(ig.recentMedia)}
          ${topPostCard(ig.topPosts && ig.topPosts[0], ig.recentMedia)}
          ${(() => {
            const delta = followerDelta(ig)
            const igAcct = (STATE.overview?.accounts || []).find((a) => a.platform === 'instagram')
            const weekDelta = igAcct?.prevFollowers != null ? ig.followerCount - igAcct.prevFollowers : null
            const hint = weekDelta != null && weekDelta > 0 ? '+' + short(weekDelta) + ' this week (' + delta + ' in 30d). Growth is steady — consistency is compounding.'
              : weekDelta != null && weekDelta < 0 ? short(Math.abs(weekDelta)) + ' lost this week. Review what changed in posting frequency or content style.'
              : delta && delta.startsWith('+') ? delta + ' in 30 days. Keep this cadence going.'
              : 'Flat growth. Try a new format or collaboration to reach new audiences.'
            return chartCard('Follower growth', followerGrowthSvg(ig.followerSeries), delta, hint)
          })()}
          ${igBestDayCard(ig.recentMedia)}
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">
            ${(() => {
              const media = ig.recentMedia || []
              const fmtEng = {}; const fmtCount = {}
              media.forEach(m => {
                const k = m.media_type === 'VIDEO' ? 'Reels' : m.media_type === 'CAROUSEL_ALBUM' ? 'Carousels' : 'Photos'
                fmtCount[k] = (fmtCount[k]||0)+1
                fmtEng[k] = (fmtEng[k]||0) + (m.like_count||0) + (m.comments_count||0)
              })
              const sorted = Object.entries(fmtCount).sort((a,b) => b[1]-a[1])
              const topFmt = sorted[0]
              const bestEng = Object.entries(fmtEng).sort((a,b) => (b[1]/(fmtCount[b[0]]||1)) - (a[1]/(fmtCount[a[0]]||1)))[0]
              let hint = ''
              if (topFmt && bestEng) {
                hint = topFmt[0] + ' are ' + Math.round(topFmt[1]/media.length*100) + '% of your posts.'
                if (topFmt[0] !== bestEng[0]) hint += ' But ' + bestEng[0] + ' get higher engagement per post — consider posting more of those.'
                else hint += ' And they\'re also your highest-engagement format — strong alignment.'
              }
              return chartCard('Format mix', formatDonutSvg(ig.recentMedia), null, hint || 'Post more to see format trends.')
            })()}
            ${(() => {
              const topAge = (ig.audienceAge || []).slice().sort((a,b) => b.share-a.share)[0]
              const topGender = (ig.audienceGender || []).slice().sort((a,b) => b.share-a.share)[0]
              const secondAge = (ig.audienceAge || []).slice().sort((a,b) => b.share-a.share)[1]
              let hint = ''
              if (topAge && topGender) {
                hint = Math.round(topGender.share*100) + '% ' + topGender.bucket.toLowerCase() + ', ' + Math.round(topAge.share*100) + '% aged ' + topAge.bucket + '.'
                if (secondAge) hint += ' Second largest: ' + secondAge.bucket + ' at ' + Math.round(secondAge.share*100) + '%.'
                hint += ' Create content that speaks to this demographic\'s interests and language.'
              } else {
                hint = 'Audience data populates as your account grows. Requires 100+ followers.'
              }
              return chartCard('Audience mix', audienceMixBars(ig.audienceGender, ig.audienceAge), dominantGenderLabel(ig.audienceGender), hint)
            })()}
          </div>
        </div>
      </section>
    `
  }

  function igBestDayCard(media) {
    if (!media || media.length < 3) return ''
    var days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    var sums = Array(7).fill(0)
    var counts = Array(7).fill(0)
    for (var i = 0; i < media.length; i++) {
      var m = media[i]
      if (!m.timestamp) continue
      var dow = (new Date(m.timestamp).getUTCDay() + 6) % 7
      var eng = (m.insights?.engagement || 0) || (Number(m.like_count || 0) + Number(m.comments_count || 0))
      sums[dow] += eng
      counts[dow]++
    }
    var avg = sums.map(function(s, j) { return counts[j] > 0 ? s / counts[j] : 0 })
    var peak = Math.max.apply(null, avg)
    var peakIdx = avg.indexOf(peak)
    var peakLabel = counts[peakIdx] > 0 ? days[peakIdx] : ''

    var barsHtml = days.map(function(d, j) {
      var w = Math.max(4, Math.round((avg[j] / Math.max(1, peak)) * 100))
      var isTop = avg[j] === peak && avg[j] > 0
      return '<div style="display:flex;align-items:center;gap:8px">'
        + '<div style="width:30px;color:' + (isTop ? 'var(--t1);font-weight:600' : 'var(--t3)') + ';font-size:11px">' + d + '</div>'
        + '<div style="flex:1;height:8px;background:var(--s3);border-radius:4px;overflow:hidden">'
        + '<div style="width:' + w + '%;height:100%;background:' + (isTop ? 'var(--t1)' : 'var(--t2)') + ';opacity:' + (isTop ? '1' : '0.35') + ';border-radius:4px"></div>'
        + '</div></div>'
    }).join('')

    var weakIdx = avg.indexOf(Math.min.apply(null, avg.filter(function(v) { return v > 0 })))
    var weakDay = counts[weakIdx] > 0 ? days[weakIdx] : ''
    var bestDayHint = peakLabel ? 'Maya: ' + peakLabel + ' gets the highest engagement on IG.' + (weakDay && weakDay !== peakLabel ? ' ' + weakDay + ' is your weakest.' : '') + ' Jordan: Schedule your most important content for ' + peakLabel + '. Save lightweight posts for slower days.' : ''

    return '<div style="background:var(--s1);border:1px solid var(--b1);border-radius:14px;padding:18px 20px">'
      + '<div style="color:var(--t3);font-size:10px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:8px;display:flex;align-items:center;gap:5px">Best day to post' + (bestDayHint ? '<span class="vx-hint" aria-label="' + esc(bestDayHint) + '">ⓘ<span class="vx-hint-tip">' + formatHint(bestDayHint) + '</span></span>' : '') + '</div>'
      + (peakLabel
        ? '<div style="color:var(--t1);font-size:28px;font-weight:500;letter-spacing:-.01em;line-height:1;margin-bottom:12px">' + peakLabel + '</div>'
        : '<div style="color:var(--t2);font-size:14px;margin-bottom:12px">Not enough data</div>')
      + '<div style="display:flex;flex-direction:column;gap:4px">' + barsHtml + '</div>'
      + '</div>'
  }

  function formatDonutSvg(media) {
    if (!media || media.length === 0) return '<div style="height:140px;color:var(--t3);font-size:12px;display:grid;place-items:center">No data</div>'
    const counts = {}
    for (const m of media) {
      const k = prettyMedia(m.media_type)
      counts[k] = (counts[k] || 0) + 1
    }
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
    const total = entries.reduce((a, [, c]) => a + c, 0)
    const palette = ['var(--t1)', 'var(--t2)', 'var(--b2)', 'var(--s3)']
    const CIRC = 201.06
    let offset = 0
    const segs = entries.map(([, c], i) => {
      const len = (c / total) * CIRC
      const seg = `<circle cx="45" cy="45" r="32" fill="none" stroke="${palette[i] || 'var(--b2)'}" stroke-width="14" stroke-dasharray="${len.toFixed(2)} ${CIRC}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 45 45)"/>`
      offset += len
      return seg
    }).join('')
    const legend = entries.map(([label, c], i) => {
      const pct = Math.round((c / total) * 100)
      return `<div style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--t2)">
        <span style="width:10px;height:10px;border-radius:2px;background:${palette[i] || 'var(--b2)'}"></span>
        <span style="color:var(--t1)">${esc(label)}</span>
        <span style="margin-left:auto">${pct}%</span>
      </div>`
    }).join('')
    return `
      <div style="display:flex;gap:14px;align-items:center">
        <svg viewBox="0 0 90 90" width="110" height="110" style="flex-shrink:0">
          <circle cx="45" cy="45" r="32" fill="none" stroke="var(--b1)" stroke-width="14" />
          ${segs}
        </svg>
        <div style="flex:1;display:flex;flex-direction:column;gap:6px">${legend}</div>
      </div>
    `
  }

  function audienceMixBars(gender, age) {
    const g = Array.isArray(gender) ? gender : []
    if (g.length === 0) return '<div style="height:110px;color:var(--t3);font-size:12px;display:grid;place-items:center">No audience data yet</div>'
    const labels = { MALE: 'Men', FEMALE: 'Women', OTHER: 'Other', UNKNOWN: 'Other' }
    const ordered = g
      .slice()
      .filter((b) => b && typeof b.share === 'number')
      .sort((a, b) => b.share - a.share)
    const domAge = (Array.isArray(age) ? age : []).slice().sort((a, b) => b.share - a.share)[0]
    const domAgeLabel = domAge ? domAge.bucket : ''
    const max = Math.max(...ordered.map((b) => b.share), 0.01)
    return `
      <div style="display:flex;flex-direction:column;gap:10px;padding-top:4px">
        ${ordered.map((b) => {
          const pct = Math.round(b.share * 100)
          const label = labels[b.bucket] || b.bucket
          const width = Math.max(6, Math.round((b.share / max) * 100))
          return `
            <div style="display:flex;align-items:center;gap:10px">
              <span style="width:44px;color:var(--t2);font-size:11px;flex-shrink:0">${escape(label)}</span>
              <div style="flex:1;height:10px;background:var(--s3);border-radius:5px;overflow:hidden">
                <div style="width:${width}%;height:100%;background:var(--t1);border-radius:5px"></div>
              </div>
              <span style="width:36px;color:var(--t1);font-size:12px;font-weight:600;text-align:right">${pct}%</span>
            </div>
          `
        }).join('')}
        ${domAgeLabel ? `<div style="color:var(--t3);font-size:11px;margin-top:2px">Dominant age: <strong style="color:var(--t2)">${escape(domAgeLabel)}</strong></div>` : ''}
      </div>
    `
  }

  function dominantGenderLabel(gender) {
    const g = Array.isArray(gender) ? gender : []
    if (g.length === 0) return null
    const top = g.slice().sort((a, b) => b.share - a.share)[0]
    const labels = { MALE: 'Men', FEMALE: 'Women', OTHER: 'Other' }
    const name = labels[top.bucket] || top.bucket
    return `${name} ${Math.round(top.share * 100)}%`
  }

  function topCitiesBars(cities) {
    const c = Array.isArray(cities) ? cities : []
    if (c.length === 0) {
      return '<div style="height:110px;color:var(--t3);font-size:12px;display:grid;place-items:center;text-align:center;line-height:1.5">No city data yet<br/><span style="font-size:10px">Populates on next sync</span></div>'
    }
    const ordered = c.slice().sort((a, b) => b.share - a.share).slice(0, 5)
    const max = Math.max(...ordered.map((b) => b.share), 0.01)
    return `
      <div style="display:flex;flex-direction:column;gap:8px;padding-top:4px">
        ${ordered.map((b) => {
          const pct = (b.share * 100).toFixed(1)
          const width = Math.max(6, Math.round((b.share / max) * 100))
          const shortName = String(b.bucket || '').split(',')[0]
          return `
            <div style="display:flex;align-items:center;gap:10px">
              <span style="flex:0 0 120px;color:var(--t2);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escape(b.bucket)}">${escape(shortName)}</span>
              <div style="flex:1;height:8px;background:var(--s3);border-radius:4px;overflow:hidden">
                <div style="width:${width}%;height:100%;background:var(--t1);border-radius:4px"></div>
              </div>
              <span style="width:44px;color:var(--t1);font-size:11px;font-weight:600;text-align:right">${pct}%</span>
            </div>
          `
        }).join('')}
      </div>
    `
  }

  function prettyMedia(t) {
    switch (t) {
      case 'REEL': return 'Reels'
      case 'CAROUSEL_ALBUM': return 'Carousel'
      case 'IMAGE': return 'Static'
      case 'VIDEO': return 'Video'
      default: return String(t || 'Other')
    }
  }

  function weeklyReachSvg(series) {
    if (!series || series.length < 7) return '<div style="height:110px;color:var(--t3);font-size:12px;display:grid;place-items:center">No data</div>'
    const last28 = series.slice(-28)
    const weekly = []
    for (let w = 0; w < 4; w++) {
      const slice = last28.slice(w * 7, (w + 1) * 7)
      weekly.push(slice.reduce((a, p) => a + (p.reach || 0), 0) / Math.max(1, slice.length))
    }
    if (weekly.every((v) => v === 0)) {
      return '<div style="height:110px;color:var(--t3);font-size:12px;display:grid;place-items:center;text-align:center;line-height:1.5">Reach unavailable<br/><span style="font-size:10px">Requires a Creator or Business account</span></div>'
    }
    const min = Math.min(...weekly), max = Math.max(...weekly)
    const range = Math.max(1, max - min)
    const W = 220, H = 110, top = 10, bottom = H - 22
    const step = W / (weekly.length - 1)
    const pts = weekly.map((v, i) => `${(i * step).toFixed(1)},${(bottom - ((v - min) / range) * (bottom - top)).toFixed(1)}`).join(' ')
    const labels = ['W1', 'W2', 'W3', 'W4']
    return `
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none">
        <polygon points="0,${H} ${pts} ${W},${H}" fill="var(--t1)" fill-opacity="0.10" />
        <polyline points="${pts}" fill="none" stroke="var(--t1)" stroke-width="2" stroke-linejoin="round" />
        ${labels.map((l, i) => `<text x="${(i * step).toFixed(1)}" y="${H - 4}" fill="var(--t3)" font-size="9" text-anchor="${i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}">${l}</text>`).join('')}
      </svg>
    `
  }

  function reachDelta(series) {
    if (!series || series.length < 14) return null
    const last28 = series.slice(-28)
    const w1 = last28.slice(0, 7).reduce((a, p) => a + (p.reach || 0), 0)
    const w4 = last28.slice(21, 28).reduce((a, p) => a + (p.reach || 0), 0)
    if (w1 === 0) return null
    const delta = Math.round(((w4 - w1) / w1) * 100)
    return (delta >= 0 ? '+' : '') + delta + '%'
  }

  function chartCard(title, body, statRight, hint) {
    const hintEl = hint
      ? `<span class="vx-hint" aria-label="${esc(hint)}">ⓘ<span class="vx-hint-tip">${formatHint(hint)}</span></span>`
      : ''
    return `
      <div style="background:var(--s1);border:1px solid var(--b1);border-radius:14px;padding:24px 26px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:16px">
          <div style="color:var(--t3);font-size:10px;letter-spacing:.14em;text-transform:uppercase;display:flex;align-items:center;gap:5px">${esc(title)}${hintEl}</div>
          ${statRight ? `<div style="color:var(--t1);font-size:13px;font-weight:600">${esc(statRight)}</div>` : ''}
        </div>
        ${body}
      </div>
    `
  }

  function followerGrowthSvg(series) {
    if (!series || series.length < 2) return '<div style="height:110px;color:var(--t3);font-size:12px;display:grid;place-items:center">No data</div>'
    const ys = series.map((p) => p.followers)
    const min = Math.min(...ys), max = Math.max(...ys)
    const range = Math.max(1, max - min)
    const W = 340, H = 110, top = 10, bottom = H - 20
    const step = W / (series.length - 1)
    const pts = series.map((p, i) => `${(i * step).toFixed(1)},${(bottom - ((p.followers - min) / range) * (bottom - top)).toFixed(1)}`).join(' ')
    const areaPts = `0,${H} ${pts} ${W},${H}`
    return `
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none">
        <polygon points="${areaPts}" fill="var(--t1)" fill-opacity="0.1" />
        <polyline points="${pts}" fill="none" stroke="var(--t1)" stroke-width="2" stroke-linejoin="round" />
      </svg>
    `
  }

  function followerDelta(ig) {
    const s = ig.followerSeries
    if (!s || s.length < 2) return ''
    const delta = s[s.length - 1].followers - s[0].followers
    return (delta >= 0 ? '+' : '') + short(Math.abs(delta))
  }

  function weekdayBars(media) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    if (!media || media.length === 0) {
      return '<div style="height:110px;color:var(--t3);font-size:12px;display:grid;place-items:center;text-align:center;line-height:1.5">Per-post engagement unavailable<br/><span style="font-size:10px">Requires a Creator or Business account</span></div>'
    }
    const sums = Array(7).fill(0)
    const counts = Array(7).fill(0)
    for (const m of (media || [])) {
      const dow = (new Date(m.timestamp).getUTCDay() + 6) % 7
      const rate = ((m.insights?.engagement || 0) / Math.max(1, m.insights?.reach || 1)) * 100
      sums[dow] += rate
      counts[dow] += 1
    }
    const avg = sums.map((s, i) => counts[i] ? s / counts[i] : 0)
    const peak = Math.max(...avg, 0.001)
    return `
      <div style="display:flex;align-items:flex-end;gap:6px;height:110px;padding:4px 0 6px">
        ${avg.map((v, i) => {
          const h = Math.max(4, Math.round((v / peak) * 90))
          const isTop = v === peak && v > 0
          return `<div style="flex:1;display:flex;flex-direction:column;align-items:stretch;gap:6px">
            <div style="background:${isTop ? 'var(--t1)' : 'var(--t2)'};opacity:${isTop ? 1 : 0.45};height:${h}px;border-radius:3px"></div>
            <div style="color:var(--t3);font-size:9px;text-align:center;letter-spacing:.04em">${days[i]}</div>
          </div>`
        }).join('')}
      </div>
    `
  }

  function bestDayLabel(media) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    const sums = Array(7).fill(0)
    const counts = Array(7).fill(0)
    for (const m of (media || [])) {
      const dow = (new Date(m.timestamp).getUTCDay() + 6) % 7
      const rate = ((m.insights?.engagement || 0) / Math.max(1, m.insights?.reach || 1)) * 100
      sums[dow] += rate
      counts[dow] += 1
    }
    const avg = sums.map((s, i) => counts[i] ? s / counts[i] : 0)
    const i = avg.indexOf(Math.max(...avg))
    return avg[i] > 0 ? days[i] : ''
  }

  function topPostCard(topPost, media) {
    if (!topPost) return chartCard('Top post', '<div style="color:var(--t3);font-size:12px">No posts yet</div>', '')
    const rate = ((topPost.insights?.engagement || 0) / Math.max(1, topPost.insights?.reach || 1)) * 100
    return `
      <div style="background:var(--s1);border:1px solid var(--b1);border-radius:14px;padding:18px 20px;display:flex;flex-direction:column">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px">
          <div style="color:var(--t3);font-size:10px;letter-spacing:.12em;text-transform:uppercase">Top post</div>
          <div style="color:var(--t1);font-size:13px;font-weight:600">${rate.toFixed(1)}%</div>
        </div>
        <div style="color:var(--t1);font-size:13px;line-height:1.5;margin-bottom:12px;flex:1">${esc(topPost.caption || '—')}</div>
        <div style="color:var(--t3);font-size:11px;display:flex;gap:14px">
          <span>${short(topPost.like_count || 0)} likes</span>
          <span>${short(topPost.comments_count || 0)} comments</span>
          <span>${short(topPost.insights?.saved || 0)} saves</span>
        </div>
      </div>
    `
  }

  function igPostsGrid(media) {
    if (!media || media.length === 0) return ''
    // Show up to 9 most recent posts in a grid
    const posts = media.slice(0, 5)
    const cards = posts.map((m) => {
      const caption = (m.caption || '').slice(0, 60)
      const type = m.media_type === 'VIDEO' ? 'Reel' : m.media_type === 'CAROUSEL_ALBUM' ? 'Carousel' : 'Photo'
      const reach = m.insights?.reach || 0
      const likes = m.like_count || 0
      const comments = m.comments_count || 0
      const saved = m.insights?.saved || 0
      const thumb = m.thumbnail_url || m.media_url || ''
      const permalink = m.permalink || ''
      const date = m.timestamp ? new Date(m.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
      return `
        <a href="${esc(permalink)}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit;background:var(--s1);border:1px solid var(--b1);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;transition:border-color .15s" onmouseenter="this.style.borderColor='var(--t2)'" onmouseleave="this.style.borderColor='var(--b1)'">
          ${thumb
            ? `<div style="width:100%;aspect-ratio:1;background:#1a1a1a;overflow:hidden"><img src="${esc(thumb)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block" loading="lazy" /></div>`
            : `<div style="width:100%;aspect-ratio:1;background:var(--s3);display:grid;place-items:center;color:var(--t3);font-size:10px">${esc(type)}</div>`}
          <div style="padding:10px 12px;flex:1;display:flex;flex-direction:column;gap:6px">
            <div style="font-size:11px;color:var(--t1);line-height:1.4;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;min-height:30px">${esc(caption) || `<span style="color:var(--t3)">(no caption)</span>`}</div>
            <div style="font-size:10px;color:var(--t3);display:flex;flex-wrap:wrap;gap:8px;margin-top:auto">
              <span>${likes} likes</span>
              <span>${comments} cmts</span>
              ${reach > 0 ? `<span>${short(reach)} reach</span>` : ''}
              ${saved > 0 ? `<span>${saved} saves</span>` : ''}
            </div>
            <div style="font-size:9px;color:var(--t3);display:flex;justify-content:space-between">
              <span>${esc(type)}</span>
              <span>${esc(date)}</span>
            </div>
          </div>
        </a>
      `
    }).join('')
    return `
      <div style="margin-top:4px">
        <div style="color:var(--t3);font-size:10px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:10px">Recent posts</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px">
          ${cards}
        </div>
      </div>
    `
  }

  // ── TikTok section ───────────────────────────────────────────────
  //
  // Separate from Instagram so each platform owns its dashboard location.
  // TikTok Login Kit doesn't expose profile-view / traffic-source insights
  // in sandbox, so we surface what we CAN derive: identity + the four
  // aggregate counts + engagement + top 3 videos by views.
  function sectionTiktok() {
    const companyId = STATE.me?.companies?.[0]?.id || ''
    const tt = STATE.tiktok
    if (!tt) {
      const href = companyId
        ? `/api/tiktok/auth/start?companyId=${encodeURIComponent(companyId)}`
        : '/api/tiktok/auth/start'
      return `
        <section id="tiktok" style="margin-bottom:32px">
          ${sectionLabel('TikTok — not connected')}
          <div style="padding:36px;text-align:center;color:var(--t2);font-size:13px;line-height:1.55;border:1px dashed var(--b1);border-radius:14px">
            Connect TikTok to pull your profile, engagement, and recent videos into the workspace.
            <div style="margin-top:16px">
              <a href="${esc(href)}" style="display:inline-block;background:var(--accent,var(--t1));color:var(--accent-text,var(--inv,var(--bg)));border:none;padding:10px 20px;border-radius:8px;font-size:11px;font-weight:600;font-family:'Syne',sans-serif;text-decoration:none;cursor:pointer">Connect TikTok</a>
            </div>
          </div>
        </section>
      `
    }

    var totalViews = 0, totalLikes = 0
    var allVids = Array.isArray(tt.recentVideos) ? tt.recentVideos : []
    allVids.forEach(function(v) { totalViews += Number(v.views||0); totalLikes += Number(v.likes||0) })
    const engagementPct = ((tt.engagementRate || 0) * 100).toFixed(2) + '%'
    const reachPct = ((tt.reachRate || 0) * 100).toFixed(2) + '%'
    const topVideos = Array.isArray(tt.topVideos) ? tt.topVideos.slice(0, 3) : []

    const tiles = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px">
        ${kvTile('Followers', shortNum(tt.followerCount), ttTip('followers', tt))}
        ${kvTile('Videos', shortNum(tt.videoCount), ttTip('videos', tt))}
        ${kvTile('Avg views', shortNum(tt.avgViews), ttTip('views', tt))}
        ${kvTile('Engagement rate', engagementPct, ttTip('engagement', tt), 'left')}
        ${tt.followerCount > 0 ? kvTile('Reach rate', reachPct, ttTip('reach', tt)) : ''}
        ${kvTile('Like conversion', totalViews > 0 ? (totalLikes / totalViews * 100).toFixed(1) + '%' : '—', ttTip('conversion', tt))}
      </div>
    `

    const recentVids = Array.isArray(tt.recentVideos) ? tt.recentVideos.slice(0, 5) : topVideos
    const postsGrid = recentVids.length === 0
      ? ''
      : '<div style="margin-top:16px">'
        + '<div style="color:var(--t3);font-size:10px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:10px">Recent posts</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px">'
        + recentVids.map(ttPostCard).join('')
        + '</div></div>'

    const avatar = tt.avatarUrl || ''
    const handle = tt.handle || ''
    const displayName = tt.displayName || ''
    const profileUrl = tt.profileUrl || ''

    return `
      <section id="tiktok" style="margin-bottom:32px">
        ${sectionLabel('TikTok')}
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;padding:16px 18px;background:var(--s1);border:1px solid var(--b1);border-radius:14px">
          ${avatar ? `<img src="${esc(avatar)}" alt="" width="48" height="48" style="border-radius:12px;flex-shrink:0">` : ''}
          <div style="min-width:0;flex:1">
            <div style="color:var(--t1);font-size:14px;font-weight:500">${esc(displayName) || esc(handle) || 'TikTok account'} ${handle && handle !== displayName ? `<span style="color:var(--t3);font-weight:400;margin-left:6px">${esc(handle)}</span>` : ''}</div>
            ${tt.bio ? `<div style="color:var(--t2);font-size:12px;line-height:1.4;margin-top:2px;max-width:560px">${esc(String(tt.bio).slice(0, 140))}${String(tt.bio).length > 140 ? '…' : ''}</div>` : ''}
          </div>
          ${profileUrl ? `<a href="${esc(profileUrl)}" target="_blank" rel="noopener" style="color:var(--t2);font-size:11px;padding:7px 14px;border:none;background:var(--s2);border-radius:8px;text-decoration:none">Open profile</a>` : ''}
          <button type="button" data-v2-tiktok-disconnect style="color:var(--t3);font-size:11px;padding:7px 14px;border:none;background:var(--s2);border-radius:8px;cursor:pointer;font-family:inherit">Disconnect</button>
        </div>
        ${tiles}
        ${postsGrid}
        ${ttInsightCharts(tt)}
      </section>
    `
  }

  function ttInsightCharts(tt) {
    var vids = Array.isArray(tt.recentVideos) ? tt.recentVideos : []
    if (vids.length < 3) return ''

    // Top post by engagement
    var sorted = vids.slice().sort(function (a, b) {
      return (Number(b.likes||0) + Number(b.comments||0)*2 + Number(b.shares||0)*3)
           - (Number(a.likes||0) + Number(a.comments||0)*2 + Number(a.shares||0)*3)
    })
    var top = sorted[0]
    var topEng = Number(top.likes||0) + Number(top.comments||0)*2 + Number(top.shares||0)*3
    var topTitle = String(top.title || '').slice(0, 80)

    // Performance trend — engagement score per video chronologically
    // Shows if the creator is improving or declining over time
    var chronoVids = vids.slice().filter(function(v) { return v.createdAt })
      .sort(function(a, b) { return Number(a.createdAt) - Number(b.createdAt) })
      .slice(-12)
    var trendSvg = ''
    if (chronoVids.length >= 3) {
      var engScores = chronoVids.map(function(v) {
        return Number(v.likes||0) + Number(v.comments||0)*2 + Number(v.shares||0)*3
      })
      var tMin = Math.min.apply(null, engScores)
      var tMax = Math.max.apply(null, engScores)
      var tRange = Math.max(1, tMax - tMin)
      var W = 340, H = 100, top2 = 8, bottom2 = H - 16
      var tStep = W / (chronoVids.length - 1)
      var tPts = engScores.map(function(s, i) {
        return (i * tStep).toFixed(1) + ',' + (bottom2 - ((s - tMin) / tRange) * (bottom2 - top2)).toFixed(1)
      }).join(' ')
      var tArea = '0,' + H + ' ' + tPts + ' ' + W + ',' + H
      var firstDate = new Date(chronoVids[0].createdAt * 1000).toLocaleDateString('en-US', {month:'short',day:'numeric'})
      var lastDate = new Date(chronoVids[chronoVids.length-1].createdAt * 1000).toLocaleDateString('en-US', {month:'short',day:'numeric'})
      var trendDir = engScores[engScores.length-1] > engScores[0] ? 'Improving' : engScores[engScores.length-1] < engScores[0] * 0.8 ? 'Declining' : 'Stable'
      trendSvg = '<div style="background:var(--s1);border:1px solid var(--b1);border-radius:14px;padding:18px 20px">'
        + '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px">'
        + (function() {
          var hint = trendDir === 'Improving' ? 'Maya: Recent videos outperform older ones — engagement is rising. Jordan: Whatever you changed is working. Keep this format and posting cadence.' : trendDir === 'Declining' ? 'Maya: Recent videos underperform older content — engagement is falling. Jordan: Revisit your top-performing video and replicate its structure for your next post.' : 'Maya: Engagement is steady across videos — no clear upward or downward trend. Jordan: To break out, test a new format this week. Try a duet or a reply-to-comment video.'
          return '<div style="color:var(--t3);font-size:10px;letter-spacing:.12em;text-transform:uppercase;display:flex;align-items:center;gap:5px">Performance trend<span class="vx-hint" aria-label="' + esc(hint) + '">ⓘ<span class="vx-hint-tip">' + formatHint(hint) + '</span></span></div>'
        })()
        + '<div style="color:var(--t1);font-size:13px;font-weight:600">' + trendDir + '</div>'
        + '</div>'
        + '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" preserveAspectRatio="none" style="display:block">'
        + '<polygon points="' + tArea + '" fill="var(--t1)" fill-opacity="0.08" />'
        + '<polyline points="' + tPts + '" fill="none" stroke="var(--t1)" stroke-width="2" stroke-linejoin="round" />'
        + '</svg>'
        + '<div style="display:flex;justify-content:space-between;color:var(--t3);font-size:9px;margin-top:4px"><span>' + firstDate + '</span><span>' + lastDate + '</span></div>'
        + '</div>'
    }

    // Engagement by day
    var days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    var dayEng = [0,0,0,0,0,0,0]
    var dayCounts = [0,0,0,0,0,0,0]
    vids.forEach(function(v) {
      if (!v.createdAt) return
      var dow = (new Date(v.createdAt * 1000).getUTCDay() + 6) % 7
      dayEng[dow] += Number(v.likes||0) + Number(v.comments||0)*2 + Number(v.shares||0)*3
      dayCounts[dow]++
    })
    var dayAvg = dayEng.map(function(e, i) { return dayCounts[i] > 0 ? e / dayCounts[i] : 0 })
    var peakDayVal = Math.max.apply(null, dayAvg)
    var peakDayIdx = dayAvg.indexOf(peakDayVal)
    var peakLabel = dayCounts[peakDayIdx] > 0 ? days[peakDayIdx] : ''
    // Simplified: show each day as a horizontal bar with label
    var dayBarsHtml = days.map(function(d, i) {
      var w = Math.max(4, Math.round((dayAvg[i] / Math.max(1, peakDayVal)) * 100))
      var isTop = dayAvg[i] === peakDayVal && dayAvg[i] > 0
      return '<div style="display:flex;align-items:center;gap:8px">'
        + '<div style="width:30px;color:' + (isTop ? 'var(--t1);font-weight:600' : 'var(--t3)') + ';font-size:11px">' + d + '</div>'
        + '<div style="flex:1;height:8px;background:var(--s3);border-radius:4px;overflow:hidden">'
        + '<div style="width:' + w + '%;height:100%;background:' + (isTop ? 'var(--t1)' : 'var(--t2)') + ';opacity:' + (isTop ? '1' : '0.35') + ';border-radius:4px"></div>'
        + '</div>'
        + '</div>'
    }).join('')

    return '<div style="display:flex;flex-direction:column;gap:14px;margin-top:16px">'
      // Top post
      + '<div style="background:var(--s1);border:1px solid var(--b1);border-radius:14px;padding:18px 20px">'
      + '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px">'
      + (function() {
        var topHint = 'Maya: "' + topTitle.slice(0, 40) + '" is your strongest video with ' + shortNum(top.views) + ' views and ' + shortNum(top.likes) + ' likes. Jordan: Study what made this work — the hook, the topic, the pacing. Replicate this structure for your next 3 videos.'
        return '<div style="color:var(--t3);font-size:10px;letter-spacing:.12em;text-transform:uppercase;display:flex;align-items:center;gap:5px">Top video<span class="vx-hint" aria-label="' + esc(topHint) + '">ⓘ<span class="vx-hint-tip">' + formatHint(topHint) + '</span></span></div>'
      })()
      + '<div style="color:var(--t1);font-size:13px;font-weight:600">' + shortNum(topEng) + '</div>'
      + '</div>'
      + '<div style="color:var(--t1);font-size:13px;line-height:1.5;margin-bottom:8px">' + esc(topTitle) + '</div>'
      + '<div style="color:var(--t3);font-size:11px;display:flex;gap:14px">'
      + '<span>' + shortNum(top.views) + ' views</span>'
      + '<span>' + shortNum(top.likes) + ' likes</span>'
      + '<span>' + shortNum(top.comments) + ' comments</span>'
      + '<span>' + shortNum(top.shares) + ' shares</span>'
      + '</div></div>'
      // Performance trend (full width)
      + trendSvg
      // Best day insight card
      + '<div style="display:grid;grid-template-columns:1fr;gap:14px">'
      // Best day — headline first
      + (function() {
        var ttWeakIdx = dayAvg.indexOf(Math.min.apply(null, dayAvg.filter(function(v) { return v > 0 })))
        var ttWeakDay = dayCounts[ttWeakIdx] > 0 ? days[ttWeakIdx] : ''
        var ttBestHint = peakLabel ? 'Maya: ' + peakLabel + ' drives the most TikTok engagement.' + (ttWeakDay && ttWeakDay !== peakLabel ? ' ' + ttWeakDay + ' is your weakest.' : '') + ' Jordan: Batch-film your best content ideas for ' + peakLabel + '. Post lighter content on off-days to stay consistent.' : ''
        return '<div style="background:var(--s1);border:1px solid var(--b1);border-radius:14px;padding:18px 20px">'
          + '<div style="color:var(--t3);font-size:10px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:8px;display:flex;align-items:center;gap:5px">Best day to post' + (ttBestHint ? '<span class="vx-hint" aria-label="' + esc(ttBestHint) + '">ⓘ<span class="vx-hint-tip">' + formatHint(ttBestHint) + '</span></span>' : '') + '</div>'
          + (peakLabel
            ? '<div style="color:var(--t1);font-size:28px;font-weight:500;letter-spacing:-.01em;line-height:1;margin-bottom:8px">' + peakLabel + '</div>'
            : '<div style="color:var(--t2);font-size:14px;margin-bottom:8px">Not enough data yet</div>')
          + '<div style="display:flex;flex-direction:column;gap:4px">' + dayBarsHtml + '</div>'
      })()
      + '</div></div>'
      + '</div>'
  }

  function formatHint(hint) {
    // Bold agent names + line break between Maya and Jordan
    return esc(hint)
      .replace(/Maya:/g, '<strong style="color:var(--inv,var(--bg));opacity:.7">Maya:</strong>')
      .replace(/Jordan:/g, '<br/><strong style="color:var(--inv,var(--bg))">Jordan:</strong>')
  }

  function kvTile(label, value, hint, tipDir) {
    const tipCls = tipDir === 'left' ? ' vx-tip-left' : ''
    const hintEl = hint
      ? `<span class="vx-hint" aria-label="${esc(hint)}">ⓘ<span class="vx-hint-tip${tipCls}">${formatHint(hint)}</span></span>`
      : ''
    return `
      <div class="vx-dcard" style="background:var(--s1);border:1px solid var(--b1);border-radius:12px;padding:16px 18px">
        <div style="color:var(--t3);font-size:10px;letter-spacing:.12em;text-transform:uppercase;display:flex;align-items:center;gap:5px">${esc(label)}${hintEl}</div>
        <div style="color:var(--t1);font-size:20px;font-weight:500;letter-spacing:-.01em;margin-top:6px">${esc(String(value))}</div>
      </div>
    `
  }

  function shortNum(n) {
    const v = Number(n || 0)
    if (!isFinite(v)) return '—'
    return short(v)
  }

  function ttPostCard(v) {
    const title = String(v.title || '').trim().slice(0, 60)
    const cover = String(v.cover || '')
    const url = String(v.shareUrl || '')
    const views = Number(v.views || 0)
    const likes = Number(v.likes || 0)
    const comments = Number(v.comments || 0)
    const shares = Number(v.shares || 0)
    const date = v.createdAt ? new Date(v.createdAt * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
    const thumb = cover
      ? '<div style="width:100%;aspect-ratio:9/16;max-height:220px;background:#1a1a1a;overflow:hidden"><img src="' + esc(cover) + '" alt="" style="width:100%;height:100%;object-fit:cover;display:block" loading="lazy" onerror="this.style.display=\'none\'" /></div>'
      : '<div style="width:100%;aspect-ratio:9/16;max-height:220px;background:var(--s3);display:grid;place-items:center;color:var(--t3);font-size:10px">Video</div>'
    const cmts = comments > 0 ? '<span>' + comments + ' cmts</span>' : ''
    const shr = shares > 0 ? '<span>' + shares + ' shares</span>' : ''
    return '<a href="' + esc(url || '#') + '" target="_blank" rel="noopener" style="text-decoration:none;color:inherit;background:var(--s1);border:1px solid var(--b1);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;transition:border-color .15s" onmouseenter="this.style.borderColor=\'var(--t2)\'" onmouseleave="this.style.borderColor=\'var(--b1)\'">'
      + thumb
      + '<div style="padding:10px 12px;flex:1;display:flex;flex-direction:column;gap:6px">'
      + '<div style="font-size:11px;color:var(--t1);line-height:1.4;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;min-height:30px">' + (esc(title) || '<span style="color:var(--t3)">(no caption)</span>') + '</div>'
      + '<div style="font-size:10px;color:var(--t3);display:flex;flex-wrap:wrap;gap:8px;margin-top:auto"><span>' + shortNum(views) + ' views</span><span>' + likes + ' likes</span>' + cmts + shr + '</div>'
      + '<div style="font-size:9px;color:var(--t3)">' + esc(date) + '</div>'
      + '</div></a>'
  }

  function tiktokVideoCard(v) {
    const title = String(v.title || '').trim() || '(untitled)'
    const cover = String(v.cover || '')
    const url = String(v.shareUrl || '')
    const views = Number(v.views || 0)
    const likes = Number(v.likes || 0)
    const comments = Number(v.comments || 0)
    return `
      <a href="${esc(url || '#')}" target="_blank" rel="noopener" class="vx-dcard" style="display:flex;gap:10px;background:var(--s1);border:1px solid var(--b1);border-radius:12px;padding:10px;text-decoration:none;color:inherit">
        ${cover
          ? `<img src="${esc(cover)}" alt="" width="54" height="74" style="border-radius:8px;object-fit:cover;background:var(--s3);flex-shrink:0" loading="lazy" onerror="this.style.display='none'">`
          : `<div style="width:54px;height:74px;border-radius:8px;background:var(--s3);flex-shrink:0"></div>`}
        <div style="min-width:0;flex:1">
          <div style="color:var(--t1);font-size:12.5px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${esc(title.slice(0, 140))}${title.length > 140 ? '…' : ''}</div>
          <div style="color:var(--t3);font-size:10.5px;margin-top:4px">👁 ${shortNum(views)} · ❤ ${shortNum(likes)} · 💬 ${shortNum(comments)}</div>
        </div>
      </a>
    `
  }

  function sectionActivity() {
    // Build a timeline from notifications (most recent 8).
    const items = STATE.notifs.slice(0, 8)
    if (items.length === 0) {
      return `
        <section>
          ${sectionLabel('Activity')}
          <div style="padding:24px;color:var(--t2);font-size:12px;line-height:1.55;text-align:center;border:1px dashed var(--b1);border-radius:12px">
            No notifications in the last little while — the team is still running scans and keeping drops warm in the background.
          </div>
        </section>
      `
    }
    return `
      <section style="margin-bottom:32px">
        ${sectionLabel('Activity')}
        <ol style="list-style:none;padding:0;margin:0;border-left:1px solid var(--b1)">
          ${items.map((n) => `
            <li style="position:relative;padding:10px 0 10px 20px">
              <div style="position:absolute;left:-4px;top:18px;width:7px;height:7px;border-radius:50%;background:${n.isRead ? 'var(--t3)' : 'var(--t1)'}"></div>
              <div style="color:var(--t1);font-size:13px;margin-bottom:2px">${esc(n.title)}</div>
              <div style="color:var(--t2);font-size:12px;line-height:1.4">${esc(n.body)}</div>
              <div style="color:var(--t3);font-size:10px;margin-top:4px;letter-spacing:.04em">${esc(timeAgo(n.createdAt))}</div>
            </li>
          `).join('')}
        </ol>
      </section>
    `
  }

  function sectionLabel(text) {
    return `<h2 style="color:var(--t2);font-size:11px;letter-spacing:.16em;text-transform:uppercase;font-weight:600;margin:0 0 14px;font-family:'Syne',sans-serif">${esc(text)}</h2>`
  }

  function capitalize(s) {
    return String(s || '').replace(/^./, (c) => c.toUpperCase())
  }

  function formatNiche(s) {
    const map = { fitness: 'Fitness & Wellness', finance: 'Finance & Investing', food: 'Food & Cooking', coaching: 'Coaching & Education', lifestyle: 'Lifestyle', personal_dev: 'Personal Development', personal_development: 'Personal Development' }
    return map[s] || capitalize(s || '')
  }

  function formatType(t) {
    return String(t || 'task').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  }

  // ─────────────── actions ─────────────────────────────────────────
  function removeOutcomeModal() {
    document.getElementById('vx-outcome-modal')?.remove()
  }

  function showOutcomeModal(opts) {
    removeOutcomeModal()
    const wrap = document.createElement('div')
    wrap.id = 'vx-outcome-modal'
    wrap.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.65);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);z-index:9000;display:flex;align-items:center;justify-content:center;padding:24px;font-family:DM Sans,system-ui,sans-serif'
    const title = opts.title || 'Done'
    const body = opts.body || ''
    const primary = opts.primaryLabel || 'OK'
    const secondary = opts.secondaryLabel
    wrap.innerHTML = `
      <div style="max-width:420px;width:100%;background:var(--bg);border:1px solid var(--b1);border-radius:16px;padding:28px 30px;box-shadow:0 24px 80px rgba(0,0,0,.45);backdrop-filter:blur(20px)">
        <div style="color:var(--t1);font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:500;margin-bottom:10px;line-height:1.2">${esc(title)}</div>
        <p style="color:var(--t2);font-size:13px;line-height:1.55;margin:0 0 18px">${esc(body)}</p>
        <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end">
          ${secondary ? `<button type="button" data-vx-sec style="background:transparent;border:1px solid var(--b2);color:var(--t2);padding:8px 16px;border-radius:8px;font-size:11px;font-family:inherit;cursor:pointer">${esc(secondary)}</button>` : ''}
          <button type="button" data-vx-pri style="background:var(--t1);color:var(--inv,var(--bg));border:none;padding:8px 18px;border-radius:8px;font-size:11px;font-weight:600;font-family:'Syne',sans-serif;cursor:pointer">${esc(primary)}</button>
        </div>
      </div>
    `
    wrap.addEventListener('click', (ev) => {
      if (ev.target === wrap) removeOutcomeModal()
    })
    wrap.querySelector('[data-vx-pri]')?.addEventListener('click', () => {
      removeOutcomeModal()
      opts.onPrimary?.()
    })
    wrap.querySelector('[data-vx-sec]')?.addEventListener('click', () => {
      removeOutcomeModal()
      opts.onSecondary?.()
    })
    document.body.appendChild(wrap)
  }

  async function taskAction(id, actionType, feedback) {
    const res = await fetch(`/api/tasks/${id}/action`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: actionType, ...(feedback ? { feedback } : {}) }),
    })
    if (!res.ok) return { ok: false }
    const data = await res.json().catch(() => ({}))
    return { ok: true, data }
  }

  function wireEvents(host) {
    host.addEventListener('click', async (e) => {
      const soft = e.target.closest('[data-v2-soft-refresh]')
      if (soft) {
        e.preventDefault()
        await refresh()
        return
      }
      const ttDisc = e.target.closest('[data-v2-tiktok-disconnect]')
      if (ttDisc) {
        e.preventDefault()
        if (!window.confirm('Disconnect TikTok? We\'ll drop the token and stop syncing.')) return
        const companyId = STATE.me?.companies?.[0]?.id
        if (!companyId) return
        ttDisc.disabled = true
        ttDisc.textContent = 'Disconnecting…'
        try {
          await fetch(`/api/tiktok/connections/${companyId}`, { method: 'DELETE', credentials: 'include' })
        } catch {}
        await refresh()
        return
      }
      const ft = e.target.closest('[data-v2-focus-task]')
      if (ft) {
        e.preventDefault()
        const tid = ft.dataset.v2FocusTask
        try {
          if (tid) sessionStorage.setItem('vxFocusTaskId', tid)
        } catch {}
        if (typeof window.navigate === 'function') window.navigate('db-tasks')
        return
      }
      const sr = e.target.closest('[data-v2-scroll-review]')
      if (sr) {
        e.preventDefault()
        const tid = sr.dataset.v2ScrollReview
        const el = host.querySelector(`[data-task-id="${tid}"]`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        return
      }
      const tgt = e.target.closest('[data-v2-action]')
      if (tgt) {
        const id = tgt.dataset.taskId
        const action = tgt.dataset.v2Action
        if (!id) return
        let feedback
        if (action === 'reject') {
          feedback = window.prompt('What should change? (optional — helps the revision)', '')
          if (feedback === null) return
        }
        const prev = tgt.textContent
        tgt.disabled = true
        tgt.textContent = '…'
        const result = await taskAction(id, action, feedback || undefined)
        tgt.disabled = false
        tgt.textContent = prev
        if (!result.ok) return
        await refresh()
        const chain = result.data?.chain
        if (action === 'approve' && chain?.ok === true) {
          const who = chain.nextEmployeeName || 'Your teammate'
          showOutcomeModal({
            title: `${who} picked up the next step`,
            body: `“${chain.title}” is in your queue now — open it to review what they shipped.`,
            primaryLabel: 'Open next drop',
            onPrimary: () => {
              try {
                sessionStorage.setItem('vxFocusTaskId', chain.nextTaskId)
              } catch {}
              if (typeof window.navigate === 'function') window.navigate('db-tasks')
            },
            secondaryLabel: 'Stay on dashboard',
            onSecondary: () => {
              refresh()
            },
          })
        } else if (action === 'approve') {
          showOutcomeModal({
            title: 'Approved',
            body:
              chain?.reason === 'quota_exceeded'
                ? 'Plan task limit reached — the next role did not auto-start. Check usage in Settings or wait for your monthly reset.'
                : chain?.reason === 'end_of_pipeline'
                  ? 'That was the last step in this pipeline. Nothing else auto-chained.'
                  : 'Your approval is saved. Refresh the queue when you are ready for the next move.',
            primaryLabel: 'Open queue',
            onPrimary: () => {
              if (typeof window.navigate === 'function') window.navigate('db-tasks')
            },
          })
        } else if (action === 'reject') {
          showOutcomeModal({
            title: 'Revision requested',
            body: feedback
              ? 'Your note was sent with the rejection so the teammate can rework with context.'
              : 'Rejection recorded — they will rework from your last review.',
            primaryLabel: 'Open queue',
            onPrimary: () => {
              if (typeof window.navigate === 'function') window.navigate('db-tasks')
            },
          })
        }
        try {
          window.dispatchEvent(new CustomEvent('vx-task-changed'))
        } catch {}
        return
      }
      const nav = e.target.closest('[data-v2-nav]')
      if (nav) {
        const id = nav.dataset.v2Nav
        if (typeof window.navigate === 'function') window.navigate(id)
        return
      }
      const mt = e.target.closest('[data-v2-meeting]')
      if (mt) {
        const name = mt.dataset.v2Meeting
        const role = mt.dataset.v2Role
        const init = mt.dataset.v2Init
        const tid = mt.dataset.v2TaskId
        if (tid && typeof window.openMeetingWithTaskOutput === 'function') {
          const task = STATE.tasks.find((t) => t.id === tid)
          if (task && task.status === 'delivered') {
            const output = pickLatestOutput(task)
            window.openMeetingWithTaskOutput({ name, role, init, task, output })
            return
          }
        }
        if (typeof window.openMeeting === 'function') window.openMeeting(name, role, init)
        return
      }
      const bf = e.target.closest('[data-v2-brief]')
      if (bf) {
        const r = bf.dataset.v2Brief
        const name = bf.dataset.v2BriefName
        if (typeof window.vxOpenAssignModal === 'function') window.vxOpenAssignModal(r, name)
      }
    })
  }

  // ─────────────── feed strip (right rail) ────────────────────────
  function sectionFeedStrip() {
    const items = STATE.feed.slice(0, 10)
    const company = STATE.me?.companies?.[0]
    const niche = (company?.detectedNiche && company?.nicheConfidence >= 0.6 ? company.detectedNiche : company?.niche) || ''
    const header = `
      <div style="padding:18px 20px 14px;border-bottom:1px solid var(--b1);display:flex;align-items:center;justify-content:space-between;gap:10px">
        <div>
          <div style="color:var(--t3);font-size:10px;letter-spacing:.14em;text-transform:uppercase;margin-bottom:2px">Knowledge feed</div>
          <div style="color:var(--t1);font-size:12px">Maya — ${esc(formatNiche(niche))}</div>
        </div>
        <button data-v2-nav="db-knowledge" style="background:transparent;border:1px solid var(--b2);color:var(--t2);padding:6px 12px;border-radius:8px;font-size:10px;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;font-family:inherit">Full feed</button>
      </div>
    `
    if (items.length === 0) {
      return `
        ${header}
        <div style="padding:32px 20px;text-align:center;color:var(--t2);font-size:12px;line-height:1.55">
          Signals are still wiring up — open the full feed or brief Maya while we pull the next batch.
          <div style="margin-top:14px;display:flex;flex-wrap:wrap;gap:8px;justify-content:center">
            <button type="button" data-v2-nav="db-knowledge" style="background:var(--t1);color:var(--inv,var(--bg));border:none;padding:8px 16px;border-radius:8px;font-size:11px;font-weight:600;font-family:inherit;cursor:pointer">Open full feed</button>
            <button type="button" data-v2-brief="analyst" data-v2-brief-name="Maya" style="background:transparent;border:1px solid var(--b2);color:var(--t2);padding:8px 16px;border-radius:8px;font-size:11px;font-family:inherit;cursor:pointer">Turn into brief</button>
          </div>
        </div>
      `
    }
    const list = items.map(feedItemHTML).join('')
    const feedFooter = `
      <div style="padding:12px 16px;border-top:1px solid var(--b1);display:flex;flex-wrap:wrap;gap:8px">
        <button type="button" data-v2-brief="analyst" data-v2-brief-name="Maya" style="background:var(--t1);color:var(--inv,var(--bg));border:none;padding:6px 12px;border-radius:8px;font-size:10px;font-weight:600;font-family:inherit;cursor:pointer">Turn signal into brief</button>
        <button type="button" data-v2-brief="strategist" data-v2-brief-name="Jordan" style="background:transparent;border:1px solid var(--b2);color:var(--t2);padding:6px 12px;border-radius:8px;font-size:10px;font-family:inherit;cursor:pointer">Schedule for Jordan</button>
        <button type="button" data-v2-nav="db-knowledge" style="background:transparent;border:1px solid var(--b2);color:var(--t3);padding:6px 12px;border-radius:8px;font-size:10px;font-family:inherit;cursor:pointer">Ask Maya to go deeper</button>
      </div>
    `
    return `
      ${header}
      <ol style="list-style:none;padding:0;margin:0">${list}</ol>
      ${feedFooter}
    `
  }

  function feedItemHTML(item) {
    const when = timeAgo(item.createdAt)
    const thumb = item.imageUrl
      ? `<img src="${esc(item.imageUrl)}" alt="" style="width:72px;height:72px;border-radius:8px;object-fit:cover;flex-shrink:0;background:var(--s3)" loading="lazy" onerror="this.style.display='none'" />`
      : `<div style="width:72px;height:72px;border-radius:8px;background:var(--s3);flex-shrink:0;display:grid;place-items:center;color:var(--t3);font-size:10px;letter-spacing:.06em;text-transform:uppercase">${esc(item.type || 'Link')}</div>`
    const isTrend = item.type === 'trend'
    const scoreTag = item.score != null
      ? `<span style="color:${isTrend ? '#34d27a' : 'var(--t1)'};font-weight:600;margin-left:auto">${isTrend ? '↑' : ''}${item.score}</span>`
      : ''
    return `
      <li class="vx-dcard-row" style="padding:14px 20px;border-bottom:1px solid var(--b1)">
        <a href="${esc(item.url)}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit;display:flex;gap:14px;align-items:flex-start">
          ${thumb}
          <div style="flex:1;min-width:0">
            <div style="color:var(--t3);font-size:10px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px;display:flex;gap:8px;align-items:center">
              <span>${esc(item.source)}</span>
              <span>·</span>
              <span>${esc(when)}</span>
              ${scoreTag}
            </div>
            <div style="color:var(--t1);font-size:13px;font-weight:500;line-height:1.35;margin-bottom:4px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${esc(stripTags(item.title))}</div>
            <div style="color:var(--t2);font-size:11px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(stripTags(item.mayaTake || item.summary))}</div>
          </div>
        </a>
      </li>
    `
  }

  // ─────────────── render ──────────────────────────────────────────
  async function render() {
    const view = document.getElementById('view-db-dashboard')
    if (!view) return
    try { await fetchAll() } catch (e) { console.warn('[v2] fetchAll failed, rendering with partial data', e) }
    injectMotionStyles()
    const root = view.querySelector('.db-layout') || view
    // The prototype's .db-layout is a grid (1fr 280px); our flex pane was
    // being clipped into just the first column. Reset to a plain block so
    // our inner flex layout can span the full view.
    root.style.cssText = 'height:100%;display:block;overflow:hidden;grid-template-columns:none'
    root.innerHTML = `
      <div style="height:100%;display:flex;min-height:0;font-family:'DM Sans',sans-serif">
        <main style="flex:1;min-width:0;overflow-y:auto;padding:36px 48px 72px">
          ${sectionHeader()}
          ${sectionCeoNextAction()}
          ${sectionOverview()}
          ${sectionTeamPulseBanner()}
          ${sectionReviewQueue()}
          ${''}<!-- team section moved to Work page -->
          ${sectionPerformance()}
          ${sectionTiktok()}
          ${sectionActivity()}
        </main>
        ${''}<!-- knowledge feed moved to its own page -->
      </div>
    `
    wireEvents(root)
    // Remove the auth gate style now that v2 owns the DOM
    document.getElementById('vx-auth-gate')?.remove()
    // Animations — staggered reveal + counters + sparkline draw
    requestAnimationFrame(function () {
      animateOnReveal(root)
      animateCounters(root)
      animateSparklines(root)
    })
    // Kick off background syncs AFTER rendering — doesn't delay the UI
    backgroundTiktokSync()
    backgroundInstagramSync()
    // Show unread drop toasts
    setTimeout(showDeliverableToasts, 600)
  }

  // ── Deliverable toasts — rotating single notification ──────────
  var toastsStarted = false
  var toastQueue = []
  var toastRotateTimer = null

  function showDeliverableToasts() {
    if (toastsStarted) return
    var delivered = STATE.tasks.filter(function (t) { return t.status === 'delivered' })
    if (delivered.length === 0) return
    toastsStarted = true
    toastQueue = delivered.slice()
    showNextToast()
  }

  function buildToastPreview(t) {
    var output = t.outputs && t.outputs[0]
    var c = output?.content || {}
    var type = t.type || ''
    var lines = []

    // Title context
    lines.push(t.title || 'New drop')

    // Type-specific detail
    if (Array.isArray(c.hooks) && c.hooks.length) {
      lines.push(c.hooks.length + ' hook' + (c.hooks.length > 1 ? 's' : '') + ' ready — "' + (c.hooks[0].text || '').slice(0, 60) + '..."')
    } else if (Array.isArray(c.trends) && c.trends.length) {
      var topTrend = c.trends[0]
      lines.push(c.trends.length + ' trend' + (c.trends.length > 1 ? 's' : '') + ' flagged. Top: ' + (topTrend.topic || '') + ' (' + (topTrend.growth || topTrend.verdict || '') + ')')
    } else if (Array.isArray(c.posts) && c.posts.length) {
      lines.push(c.posts.length + '-day plan ready. ' + c.posts.slice(0, 3).map(function (p) { return (p.day || '').slice(0, 3) + ': ' + (p.format || '') }).join(', '))
    } else if (Array.isArray(c.shots) && c.shots.length) {
      lines.push(c.shots.length + ' shots planned. Opens with: "' + (c.shots[0].description || c.shots[0].shot || '').slice(0, 50) + '..."')
    } else if (c.summary) {
      lines.push(String(c.summary).slice(0, 100))
    } else if (c.script) {
      lines.push('Script ready — ' + String(c.script).slice(0, 60) + '...')
    }

    // Time context
    if (t.createdAt) {
      lines.push('Delivered ' + timeAgo(t.createdAt))
    }

    return lines.join('\n')
  }

  function showNextToast() {
    clearTimeout(toastRotateTimer)
    if (toastQueue.length === 0) {
      var el = document.getElementById('vx-deliver-toasts')
      if (el) { el.style.opacity = '0'; setTimeout(function () { el.remove() }, 400) }
      return
    }

    var t = toastQueue[0]
    var role = ROLE[t.employee?.role] || { name: 'Sovexa', title: 'Agent', init: 'V' }
    var preview = buildToastPreview(t)
    var counter = toastQueue.length > 1 ? '<span style="color:var(--t3);font-size:10px;margin-left:8px">' + toastQueue.length + ' unread</span>' : ''

    var container = document.getElementById('vx-deliver-toasts')
    if (!container) {
      container = document.createElement('div')
      container.id = 'vx-deliver-toasts'
      container.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:8000;max-width:360px;width:100%;transition:opacity .4s ease'
      document.body.appendChild(container)
    }

    container.style.opacity = '0'
    setTimeout(function () {
      container.innerHTML = '<div class="vx-dcard" style="background:var(--s1);border:1px solid var(--b1);border-radius:12px;padding:16px 18px;box-shadow:0 8px 32px rgba(0,0,0,.4)">'
        + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">'
        + '<div style="width:28px;height:28px;border-radius:8px;background:var(--s3);color:var(--t1);display:grid;place-items:center;font-weight:600;font-size:11px;font-family:Syne,sans-serif;flex-shrink:0">' + role.init + '</div>'
        + '<div style="flex:1"><div style="color:var(--t1);font-size:12px;font-weight:500">' + esc(role.name) + ' — ' + esc(role.title) + counter + '</div></div>'
        + '<button id="vx-toast-close" style="background:none;border:none;color:var(--t3);font-size:16px;cursor:pointer;padding:0 4px;line-height:1">&times;</button>'
        + '</div>'
        + '<div style="color:var(--t2);font-size:12px;line-height:1.55">'
        + preview.split('\n').map(function (line, i) {
            if (i === 0) return '<div style="color:var(--t1);font-size:13px;font-weight:500;margin-bottom:4px">' + esc(line) + '</div>'
            if (i === preview.split('\n').length - 1) return '<div style="color:var(--t3);font-size:10px;margin-top:4px">' + esc(line) + '</div>'
            return '<div style="font-style:italic">' + esc(line) + '</div>'
          }).join('')
        + '</div>'
        + '<div style="margin-top:10px;display:flex;gap:8px">'
        + '<button id="vx-toast-review" style="background:var(--t1);color:var(--inv);border:none;padding:6px 14px;border-radius:8px;font-size:10px;font-weight:600;font-family:inherit;cursor:pointer;letter-spacing:.04em;text-transform:uppercase">Review</button>'
        + '<button id="vx-toast-dismiss" style="background:transparent;border:1px solid var(--b2);color:var(--t3);padding:6px 14px;border-radius:8px;font-size:10px;font-family:inherit;cursor:pointer">Dismiss</button>'
        + '</div></div>'

      container.style.opacity = '1'

      // Close — dismiss this one, show next
      container.querySelector('#vx-toast-close').addEventListener('click', function () {
        toastQueue.shift()
        showNextToast()
      })

      // Dismiss — remove from rotation, show next
      container.querySelector('#vx-toast-dismiss').addEventListener('click', function () {
        toastQueue.shift()
        showNextToast()
      })

      // Review — go to work page
      container.querySelector('#vx-toast-review').addEventListener('click', function () {
        clearTimeout(toastRotateTimer)
        container.remove()
        toastQueue = []
        sessionStorage.setItem('vxFocusTaskId', t.id)
        if (typeof window.navigate === 'function') window.navigate('db-tasks')
      })

      // Auto-rotate after 10s
      toastRotateTimer = setTimeout(function () {
        // Move current to end of queue (rotate)
        toastQueue.push(toastQueue.shift())
        showNextToast()
      }, 10000)
    }, 150)
  }

  async function refresh() {
    await render()
  }

  window.vxDashboardRefresh = refresh

  const prevEnter = window.enterDashboard
  window.enterDashboard = async function () {
    if (typeof prevEnter === 'function') await prevEnter()
    setTimeout(render, 100)
  }

  const origNavigate = window.navigate
  window.navigate = function (id) {
    const r = typeof origNavigate === 'function' ? origNavigate(id) : undefined
    if (id === 'db-dashboard') setTimeout(render, 150)
    return r
  }

  // Initial render — run as soon as possible, not after 800ms delay
  if (document.readyState !== 'loading') setTimeout(render, 50)
  document.addEventListener('DOMContentLoaded', () => setTimeout(render, 50))

  // Re-render when a task is created (brief delivered) so the team
  // strip flips from "Working" to "Output ready" without the CEO
  // having to reload.
  window.addEventListener('vx-task-changed', () => { setTimeout(render, 80) })

  // When the user returns from the TikTok OAuth callback (?tiktokConnected=1),
  // jump straight to the dashboard and scroll the TikTok section into view.
  function maybeHandleTiktokReturn() {
    try {
      const params = new URLSearchParams(window.location.search)
      if (params.get('tiktokConnected') !== '1') return
      // Clear the query param so a refresh doesn't re-trigger.
      const clean = window.location.pathname + (window.location.hash || '')
      window.history.replaceState({}, '', clean)
      setTimeout(async () => {
        if (typeof window.navigate === 'function') window.navigate('db-dashboard')
        await refresh()
        setTimeout(() => {
          document.getElementById('tiktok')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }, 250)
      }, 400)
    } catch { /* noop */ }
  }
  if (document.readyState !== 'loading') maybeHandleTiktokReturn()
  document.addEventListener('DOMContentLoaded', maybeHandleTiktokReturn)
})()
