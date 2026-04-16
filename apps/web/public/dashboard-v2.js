/* Vexa — dashboard v2
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
    try { if (me?.user) localStorage.setItem('vx-authed', '1'); else localStorage.removeItem('vx-authed') } catch {}

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
      'Stress-testing hooks Alex will inherit.',
    ],
    copywriter: [
      "Drafting variants against Jordan's plan.",
      'Sharpening saves and CTAs for your voice.',
      'Pulling hook patterns from top performers.',
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
        position: relative; cursor: help; color: var(--t3); font-size: 11px;
        opacity: 0.5; transition: opacity .15s;
      }
      .vx-hint:hover { opacity: 1; z-index: 10000; }
      .vx-dcard { overflow: visible !important; position: relative; }
      .vx-dcard:has(.vx-hint:hover) { z-index: 10000; }
      .vx-hint-tip {
        display: none; position: absolute; top: 50%; left: calc(100% + 8px);
        transform: translateY(-50%); width: 240px; padding: 10px 14px;
        border-radius: 10px; background: var(--t1); color: var(--inv, var(--bg));
        font-size: 12px; font-weight: 400; letter-spacing: 0; text-transform: none;
        line-height: 1.5; z-index: 9999;
        box-shadow: 0 8px 24px rgba(0,0,0,.35);
        pointer-events: none;
      }
      .vx-hint-tip.vx-tip-left {
        left: auto; right: calc(100% + 8px);
      }
      .vx-hint:hover .vx-hint-tip { display: block; }
    `
    document.head.appendChild(st)
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
      <section style="margin-bottom:22px">
        <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap">
          <div>
            <h1 style="font-family:'Cormorant Garamond',serif;font-size:clamp(26px,3vw,38px);font-weight:500;line-height:1.1;color:var(--t1);margin:0 0 4px">${esc(greetingFor(user?.fullName || user?.username))}</h1>
            <div style="color:var(--t2);font-size:12px">${esc(company?.name || 'Your company')} · ${esc(formatNiche(company?.niche))}</div>
            <p style="margin:10px 0 0;color:var(--t3);font-size:11px;max-width:680px;line-height:1.5">Everyone here is trying to <span style="color:var(--t2)">grow the platform</span> — the team figures the best moves from signals, memory, and performance. Your day should skew to <span style="color:var(--t2)">what shipped and what worked</span>; you only need to step in when something is worth a real decision, not every micro-step.</p>
          </div>
          <button data-v2-nav="db-settings" style="background:transparent;border:1px solid var(--b2);color:var(--t2);padding:6px 14px;border-radius:999px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;font-family:inherit">${esc(chipLabel)}</button>
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
      body = `${awaiting} deliverable${awaiting > 1 ? 's' : ''} need your sign-off — and ${live} teammate${live > 1 ? 's are' : ' is'} still executing in parallel.`
    } else if (awaiting > 0) {
      body = `${awaiting} deliverable${awaiting > 1 ? 's' : ''} need your sign-off. The rest of the team stays on watch for the next move.`
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
          postingNote = `You haven\u2019t posted in ${daysAgo} days. Brief Alex for a quick hook?`
        }
      }
    }

    return `
      <div style="margin:-4px 0 20px;padding:12px 16px;border:1px solid var(--b1);border-radius:10px;background:var(--s1);color:var(--t2);font-size:12px;line-height:1.5">
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
        <section style="margin-bottom:18px">
          <div style="border:1px solid var(--b1);border-radius:12px;padding:18px 20px;background:linear-gradient(145deg, var(--s1) 0%, var(--s3) 100%)">
            <div style="color:var(--t3);font-size:10px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:6px;font-family:'Syne',sans-serif">Next for you</div>
            <div style="color:var(--t1);font-family:'Cormorant Garamond',serif;font-size:clamp(20px,2.4vw,26px);line-height:1.2;font-weight:500;margin-bottom:8px">${esc(workingRole.name)} is working on something for you.</div>
            <p style="color:var(--t2);font-size:12px;line-height:1.55;margin:0 0 14px">${esc(working.title)} — you'll see it here when it's ready.</p>
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
        <section style="margin-bottom:18px">
          <div style="border:1px solid var(--b1);border-radius:12px;padding:18px 20px;background:var(--s1)">
            <div style="color:var(--t3);font-size:10px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:6px;font-family:'Syne',sans-serif">Next for you</div>
            <div style="color:var(--t1);font-family:'Cormorant Garamond',serif;font-size:clamp(20px,2.4vw,26px);line-height:1.2;font-weight:500;margin-bottom:8px">${esc(headline)}</div>
            <p style="color:var(--t2);font-size:12px;line-height:1.55;margin:0 0 14px">${esc(sub)}</p>
            <div style="display:flex;flex-wrap:wrap;gap:8px">
              ${hasAccounts
                ? `<button type="button" data-v2-brief="analyst" data-v2-brief-name="Maya" style="background:var(--t1);color:var(--inv,var(--bg));border:none;padding:8px 16px;border-radius:6px;font-size:11px;font-weight:600;font-family:'Syne',sans-serif;cursor:pointer">Brief Maya</button>`
                : `<button type="button" data-v2-nav="db-settings" style="background:var(--t1);color:var(--inv,var(--bg));border:none;padding:8px 16px;border-radius:6px;font-size:11px;font-weight:600;font-family:'Syne',sans-serif;cursor:pointer">Connect a platform</button>`}
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
        ? `One deliverable is waiting — start with ${role.name}.`
        : `You have ${n} deliverables waiting — start with ${role.name}'s first.`
    return `
      <section style="margin-bottom:18px">
        <div style="border:1px solid var(--b1);border-radius:12px;padding:18px 20px;background:linear-gradient(145deg, var(--s1) 0%, var(--s3) 100%)">
          <div style="color:var(--t3);font-size:10px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:6px;font-family:'Syne',sans-serif">Next for you</div>
          <div style="display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:14px">
            <div style="min-width:0;flex:1">
              <div style="color:var(--t1);font-family:'Cormorant Garamond',serif;font-size:clamp(20px,2.6vw,28px);line-height:1.15;font-weight:500">${esc(headline)}</div>
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
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:-6px 0 22px;padding-bottom:14px;border-bottom:1px solid var(--b1)">
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

    // Top post tile
    const tp = ov?.topPost
    const tpVal = tp ? short(tp.engagementScore) : '—'
    const tpSub = tp
      ? `${platformBadge(tp.platform)} ${esc((tp.caption || '').slice(0, 40))}${(tp.caption || '').length > 40 ? '…' : ''}`
      : 'No posts synced yet'

    return `
      <section style="margin-bottom:26px">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px">
          ${tile('Awaiting review', String(awaiting), awaiting > 0 ? 'Tap to triage' : 'Smaller assets clear on defaults — big moves land here', 'db-tasks')}
          ${tile('Followers', fVal, fDelta || fSub)}
          ${tile('Top post', tpVal, tpSub, null, null, 'Engagement score: likes + comments×2 + shares×3. Higher weight on comments and shares because they signal deeper intent.')}
          ${tile('Tasks used', `${tasksUsed}/${tasksLimit >= 9999 ? '∞' : tasksLimit}`, `${pct}% of plan`, null, pct)}
        </div>

        ${overviewSparkline(ov)}
        ${overviewAudiencePeek(ov)}

        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;padding-top:14px;border-top:1px solid var(--b1)">
          <button type="button" data-v2-soft-refresh style="background:transparent;border:1px solid var(--b2);color:var(--t2);padding:6px 12px;border-radius:6px;font-size:10px;font-family:inherit;cursor:pointer">Refresh dashboard</button>
          ${hasAccounts
            ? `<button type="button" data-v2-nav="db-settings" style="background:transparent;border:1px solid var(--b2);color:var(--t2);padding:6px 12px;border-radius:6px;font-size:10px;font-family:inherit;cursor:pointer">See data in Settings</button>
               <button type="button" data-v2-nav="db-outputs" style="background:transparent;border:1px solid var(--b2);color:var(--t2);padding:6px 12px;border-radius:6px;font-size:10px;font-family:inherit;cursor:pointer">See what shipped</button>`
            : `<button type="button" data-v2-nav="db-settings" style="background:var(--t1);color:var(--inv,var(--bg));border:none;padding:6px 14px;border-radius:6px;font-size:10px;font-weight:600;font-family:inherit;cursor:pointer">Connect a platform</button>`}
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
        <div style="background:var(--s1);border:1px solid var(--b1);border-radius:14px;padding:18px 20px;margin-top:12px">
          <div style="color:var(--t3);font-size:10px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:8px">FOLLOWER TRAJECTORY — 30D</div>
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
      <div style="background:var(--s1);border:1px solid var(--b1);border-radius:14px;padding:18px 20px;margin-top:12px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px">
          <div style="color:var(--t3);font-size:10px;letter-spacing:.12em;text-transform:uppercase">FOLLOWER TRAJECTORY — 30D${deltaBadge}</div>
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
      <div style="flex:1;background:var(--s1);border:1px solid var(--b1);border-radius:10px;padding:12px 14px">
        <div style="color:var(--t3);font-size:9px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px;display:flex;align-items:center;gap:4px">${esc(label)}${hintEl}</div>
        <div style="color:var(--t1);font-size:16px;font-weight:500;letter-spacing:-.01em">${esc(value)}</div>
      </div>`
    }

    return `
      <div style="margin-top:12px">
        <div style="color:var(--t3);font-size:10px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:8px">AUDIENCE — ${platformBadge(a.platform)} @${esc(a.handle)}</div>
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
      <div ${action} class="vx-dcard${navId ? ' vx-dcard-nav' : ''}" style="background:var(--s1);border:1px solid var(--b1);border-radius:10px;padding:14px 16px">
        <div style="color:var(--t3);font-size:10px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px;display:flex;align-items:center;gap:5px">${esc(label)}${hintEl}</div>
        <div class="vx-tile-value" style="color:var(--t1);margin-bottom:4px;font-family:'DM Sans',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-weight:500;font-size:26px;letter-spacing:-.01em;line-height:1;font-style:normal">${esc(value)}</div>
        <div style="color:var(--t2);font-size:11px">${esc(sub)}</div>
        ${progressPct != null ? `<div style="height:2px;border-radius:2px;background:var(--s3);margin-top:8px;overflow:hidden"><div style="width:${progressPct}%;height:100%;background:var(--t1);transition:width .4s ease"></div></div>` : ''}
      </div>
    `
  }

  function sectionReviewQueue() {
    const delivered = STATE.tasks.filter((t) => t.status === 'delivered').slice(0, 3)
    if (delivered.length === 0) {
      return `
        <section style="margin-bottom:26px">
          ${sectionLabel('Awaiting your review')}
          <div style="padding:22px;text-align:center;color:var(--t2);font-size:12px;line-height:1.55;border:1px dashed var(--b1);border-radius:10px">
            Nothing needs your pen right now. The team is still running — scans, calendar checks, and staged briefs — so the next delivery can land without you babysitting the board.
            <div style="margin-top:14px">
              <button type="button" data-v2-nav="db-tasks" style="background:var(--t1);color:var(--inv,var(--bg));border:none;padding:8px 18px;border-radius:6px;font-size:11px;font-weight:600;font-family:'Syne',sans-serif;letter-spacing:.04em;cursor:pointer">Open full queue</button>
            </div>
          </div>
        </section>
      `
    }
    return `
      <section style="margin-bottom:26px">
        ${sectionLabel('Awaiting your review')}
        <div style="display:flex;flex-direction:column;gap:10px">
          ${delivered.map(reviewCard).join('')}
        </div>
      </section>
    `
  }

  function reviewCard(t) {
    const role = ROLE[t.employee?.role] || { name: t.employee?.name || 'Vexa', title: '', init: 'V' }
    return `
      <article data-task-id="${t.id}" class="vx-dcard" style="background:var(--s1);border:1px solid var(--b1);border-radius:10px;padding:16px 18px">
        <header style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:4px">
          <div>
            <div style="color:var(--t3);font-size:10px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:2px">${esc(role.name)} · ${esc(formatType(t.type))}</div>
            <h3 style="font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:500;color:var(--t1);margin:0">${esc(t.title)}</h3>
          </div>
          <span style="color:var(--t3);font-size:11px;flex-shrink:0">${esc(timeAgo(t.createdAt))}</span>
        </header>
        ${t.description ? `<p style="color:var(--t2);font-size:12px;line-height:1.55;margin:6px 0 0">${esc(t.description)}</p>` : ''}
        ${outputPreview(t.outputs?.[0])}
        <footer style="display:flex;gap:8px;margin-top:12px">
          <button data-v2-action="approve" data-task-id="${t.id}" style="background:var(--t1);color:var(--inv,var(--bg));border:none;padding:8px 16px;border-radius:6px;font-size:11px;font-weight:600;font-family:'Syne',sans-serif;letter-spacing:.04em;cursor:pointer">Approve</button>
          <button data-v2-action="reject" data-task-id="${t.id}" style="background:transparent;border:1px solid var(--b2);color:var(--t2);padding:8px 16px;border-radius:6px;font-size:11px;font-weight:500;font-family:'Syne',sans-serif;letter-spacing:.04em;cursor:pointer">Reject</button>
          <button type="button" data-v2-meeting="${role.name}" data-v2-role="${role.title}" data-v2-init="${role.init}" data-v2-task-id="${t.id}" style="margin-left:auto;background:transparent;border:1px solid var(--b2);color:var(--t3);padding:8px 14px;border-radius:6px;font-size:11px;font-family:inherit;cursor:pointer">Call meeting</button>
        </footer>
      </article>
    `
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
      <section style="margin-bottom:26px">
        ${sectionLabel('Your team')}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">
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
        <div class="vx-dcard" style="background:var(--s1);border:1px dashed var(--b2);border-radius:10px;padding:12px 14px;opacity:0.6">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <div style="width:26px;height:26px;border-radius:7px;background:var(--s3);color:var(--t3);display:grid;place-items:center;font-weight:600;font-size:12px;font-family:'Syne',sans-serif;flex-shrink:0">${r.init}</div>
            <div>
              <div style="color:var(--t2);font-size:12px;font-weight:600;line-height:1.2">${esc(r.name)}</div>
              <div style="color:var(--t3);font-size:9px;letter-spacing:.06em;text-transform:uppercase">${esc(r.title)}</div>
            </div>
          </div>
          <div style="color:var(--t3);font-size:11px;line-height:1.4;margin-bottom:10px">${esc(r.name)} is available on the Pro plan.</div>
          <button type="button" data-v2-nav="db-settings" style="width:100%;background:transparent;border:1px solid var(--b2);color:var(--t2);padding:6px 10px;border-radius:6px;font-size:10px;font-family:inherit;cursor:pointer">Upgrade to unlock</button>
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
      <div class="vx-dcard" style="background:var(--s1);border:1px solid var(--b1);border-radius:10px;padding:12px 14px">
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
          <button data-v2-brief="${role}" data-v2-brief-name="${r.name}" style="flex:1;background:var(--t1);color:var(--bg);border:none;padding:6px 10px;border-radius:6px;font-size:10px;font-family:inherit;font-weight:600;cursor:pointer">Brief</button>
          <button type="button" data-v2-meeting="${r.name}" data-v2-role="${r.title}" data-v2-init="${r.init}" data-v2-task-id="${delivered ? delivered.id : ''}" style="flex:1;background:transparent;border:1px solid var(--b2);color:var(--t2);padding:6px 10px;border-radius:6px;font-size:10px;font-family:inherit;cursor:pointer">Meeting</button>
        </div>
      </div>
    `
  }

  function sectionPerformance() {
    const ig = STATE.insights
    if (!ig) {
      return `
        <section style="margin-bottom:26px">
          ${sectionLabel('Instagram — last 30 days')}
          <div style="padding:32px;text-align:center;color:var(--t2);font-size:13px;line-height:1.55;border:1px dashed var(--b1);border-radius:12px">
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
        <section style="margin-bottom:26px">
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

    return `
      <section style="margin-bottom:26px">
        ${sectionLabel('Instagram — last 30 days')}
        <div style="display:flex;flex-direction:column;gap:14px">
          ${chartCard('Follower growth', followerGrowthSvg(ig.followerSeries), followerDelta(ig))}
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">
            ${chartCard('Audience mix', audienceMixBars(ig.audienceGender, ig.audienceAge), dominantGenderLabel(ig.audienceGender), 'Gender and age breakdown of your followers. Helps tailor content voice and topics.')}
            ${chartCard('Top cities', topCitiesBars(ig.audienceCities || []), null, 'Cities where your followers are concentrated. Useful for timing posts and localizing content.')}
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">
            ${chartCard('Format mix', formatDonutSvg(ig.recentMedia), null, 'Breakdown of your recent posts by format. Helps identify which formats you rely on most vs. what performs.')}
            ${chartCard('Engagement by weekday', weekdayBars(ig.recentMedia), bestDayLabel(ig.recentMedia) ? `Peak: ${bestDayLabel(ig.recentMedia)}` : null, 'Average engagement rate per weekday across recent posts. Tells you which days your audience is most active.')}
          </div>
          ${topPostCard(ig.topPosts && ig.topPosts[0], ig.recentMedia)}
          <div style="display:flex;flex-wrap:wrap;gap:8px;padding-top:4px">
            <button type="button" data-v2-brief="copywriter" data-v2-brief-name="Alex" style="background:var(--t1);color:var(--inv,var(--bg));border:none;padding:8px 14px;border-radius:6px;font-size:10px;font-weight:600;font-family:inherit;cursor:pointer">Brief Alex on captions</button>
            <button type="button" data-v2-nav="db-outputs" style="background:transparent;border:1px solid var(--b2);color:var(--t2);padding:8px 14px;border-radius:6px;font-size:10px;font-family:inherit;cursor:pointer">Copy talking points from outputs</button>
            <button type="button" data-v2-soft-refresh style="background:transparent;border:1px solid var(--b2);color:var(--t3);padding:8px 14px;border-radius:6px;font-size:10px;font-family:inherit;cursor:pointer">Refresh this view</button>
          </div>
        </div>
      </section>
    `
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
      ? `<span class="vx-hint" aria-label="${esc(hint)}">ⓘ<span class="vx-hint-tip">${esc(hint)}</span></span>`
      : ''
    return `
      <div style="background:var(--s1);border:1px solid var(--b1);border-radius:14px;padding:18px 20px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px">
          <div style="color:var(--t3);font-size:10px;letter-spacing:.12em;text-transform:uppercase;display:flex;align-items:center;gap:5px">${esc(title)}${hintEl}</div>
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
        <div style="color:var(--t3);font-size:11px;display:flex;gap:12px">
          <span>${short(topPost.like_count || 0)} likes</span>
          <span>${short(topPost.comments_count || 0)} comments</span>
          <span>${short(topPost.insights?.saved || 0)} saves</span>
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
        <section id="tiktok" style="margin-bottom:26px">
          ${sectionLabel('TikTok — not connected')}
          <div style="padding:32px;text-align:center;color:var(--t2);font-size:13px;line-height:1.55;border:1px dashed var(--b1);border-radius:12px">
            Connect TikTok to pull your profile, engagement, and recent videos into the workspace.
            <div style="margin-top:16px">
              <a href="${esc(href)}" style="display:inline-block;background:var(--accent,var(--t1));color:var(--accent-text,var(--inv,var(--bg)));border:none;padding:10px 20px;border-radius:8px;font-size:11px;font-weight:600;font-family:'Syne',sans-serif;text-decoration:none;cursor:pointer">Connect TikTok</a>
            </div>
          </div>
        </section>
      `
    }

    const engagementPct = ((tt.engagementRate || 0) * 100).toFixed(2) + '%'
    const reachPct = ((tt.reachRate || 0) * 100).toFixed(2) + '%'
    const topVideos = Array.isArray(tt.topVideos) ? tt.topVideos.slice(0, 3) : []

    const tiles = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px">
        ${kvTile('Followers', shortNum(tt.followerCount))}
        ${kvTile('Videos', shortNum(tt.videoCount))}
        ${kvTile('Avg views', shortNum(tt.avgViews), 'Average view count per video. Views are the primary reach metric on TikTok since every video goes into the For You feed.')}
        ${kvTile('Engagement rate', engagementPct, 'Total (likes + comments + shares) divided by total views across your videos. Above 5% is strong on TikTok.', 'left')}
        ${tt.followerCount > 0 ? kvTile('Reach rate', reachPct, 'Average views per video divided by follower count. Above 100% means your content reaches beyond your followers via the For You feed.') : ''}
        ${kvTile('Total likes', shortNum(tt.likesCount))}
      </div>
    `

    const topRow = topVideos.length === 0
      ? ''
      : `
        <div style="margin-top:16px">
          <div style="color:var(--t3);font-size:10px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:10px;font-family:'Syne',sans-serif">Top 3 by views</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px">
            ${topVideos.map(tiktokVideoCard).join('')}
          </div>
        </div>
      `

    const avatar = tt.avatarUrl || ''
    const handle = tt.handle || ''
    const displayName = tt.displayName || ''
    const profileUrl = tt.profileUrl || ''

    return `
      <section id="tiktok" style="margin-bottom:26px">
        ${sectionLabel('TikTok — last 20 videos')}
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px;padding:12px 14px;background:var(--s1);border:1px solid var(--b1);border-radius:12px">
          ${avatar ? `<img src="${esc(avatar)}" alt="" width="48" height="48" style="border-radius:12px;flex-shrink:0">` : ''}
          <div style="min-width:0;flex:1">
            <div style="color:var(--t1);font-size:14px;font-weight:500">${esc(displayName) || esc(handle) || 'TikTok account'} ${handle && handle !== displayName ? `<span style="color:var(--t3);font-weight:400;margin-left:6px">${esc(handle)}</span>` : ''}</div>
            ${tt.bio ? `<div style="color:var(--t2);font-size:12px;line-height:1.4;margin-top:2px;max-width:560px">${esc(String(tt.bio).slice(0, 140))}${String(tt.bio).length > 140 ? '…' : ''}</div>` : ''}
          </div>
          ${profileUrl ? `<a href="${esc(profileUrl)}" target="_blank" rel="noopener" style="color:var(--t2);font-size:11px;padding:6px 12px;border:1px solid var(--b2);border-radius:999px;text-decoration:none">Open profile</a>` : ''}
          <button type="button" data-v2-tiktok-disconnect style="color:var(--t3);font-size:11px;padding:6px 12px;border:1px solid var(--b2);background:transparent;border-radius:999px;cursor:pointer;font-family:inherit">Disconnect</button>
        </div>
        ${tiles}
        ${topRow}
      </section>
    `
  }

  function kvTile(label, value, hint, tipDir) {
    const tipCls = tipDir === 'left' ? ' vx-tip-left' : ''
    const hintEl = hint
      ? `<span class="vx-hint" aria-label="${esc(hint)}">ⓘ<span class="vx-hint-tip${tipCls}">${esc(hint)}</span></span>`
      : ''
    return `
      <div class="vx-dcard" style="background:var(--s1);border:1px solid var(--b1);border-radius:10px;padding:12px 14px">
        <div style="color:var(--t3);font-size:10px;letter-spacing:.12em;text-transform:uppercase;display:flex;align-items:center;gap:5px">${esc(label)}${hintEl}</div>
        <div style="color:var(--t1);font-size:20px;font-weight:500;letter-spacing:-.01em;margin-top:4px">${esc(String(value))}</div>
      </div>
    `
  }

  function shortNum(n) {
    const v = Number(n || 0)
    if (!isFinite(v)) return '—'
    return short(v)
  }

  function tiktokVideoCard(v) {
    const title = String(v.title || '').trim() || '(untitled)'
    const cover = String(v.cover || '')
    const url = String(v.shareUrl || '')
    const views = Number(v.views || 0)
    const likes = Number(v.likes || 0)
    const comments = Number(v.comments || 0)
    return `
      <a href="${esc(url || '#')}" target="_blank" rel="noopener" class="vx-dcard" style="display:flex;gap:10px;background:var(--s1);border:1px solid var(--b1);border-radius:10px;padding:10px;text-decoration:none;color:inherit">
        ${cover
          ? `<img src="${esc(cover)}" alt="" width="54" height="74" style="border-radius:6px;object-fit:cover;background:var(--s3);flex-shrink:0" loading="lazy" onerror="this.style.display='none'">`
          : `<div style="width:54px;height:74px;border-radius:6px;background:var(--s3);flex-shrink:0"></div>`}
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
            No notifications in the last little while — the team is still running scans and keeping deliverables warm in the background.
          </div>
        </section>
      `
    }
    return `
      <section style="margin-bottom:26px">
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
    return `<h2 style="color:var(--t2);font-size:10px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;margin:0 0 10px;font-family:'Syne',sans-serif">${esc(text)}</h2>`
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
      'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9000;display:flex;align-items:center;justify-content:center;padding:24px;font-family:DM Sans,system-ui,sans-serif'
    const title = opts.title || 'Done'
    const body = opts.body || ''
    const primary = opts.primaryLabel || 'OK'
    const secondary = opts.secondaryLabel
    wrap.innerHTML = `
      <div style="max-width:420px;width:100%;background:var(--s1);border:1px solid var(--b1);border-radius:12px;padding:22px 24px;box-shadow:0 24px 80px rgba(0,0,0,.45)">
        <div style="color:var(--t1);font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:500;margin-bottom:10px;line-height:1.2">${esc(title)}</div>
        <p style="color:var(--t2);font-size:13px;line-height:1.55;margin:0 0 18px">${esc(body)}</p>
        <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end">
          ${secondary ? `<button type="button" data-vx-sec style="background:transparent;border:1px solid var(--b2);color:var(--t2);padding:8px 14px;border-radius:6px;font-size:11px;font-family:inherit;cursor:pointer">${esc(secondary)}</button>` : ''}
          <button type="button" data-vx-pri style="background:var(--t1);color:var(--inv,var(--bg));border:none;padding:8px 16px;border-radius:6px;font-size:11px;font-weight:600;font-family:'Syne',sans-serif;cursor:pointer">${esc(primary)}</button>
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
        const el = host.querySelector(`article[data-task-id="${tid}"]`)
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
            primaryLabel: 'Open next deliverable',
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
    const items = STATE.feed.slice(0, 12)
    const company = STATE.me?.companies?.[0]
    const niche = (company?.detectedNiche && company?.nicheConfidence >= 0.6 ? company.detectedNiche : company?.niche) || ''
    const header = `
      <div style="padding:18px 20px 14px;border-bottom:1px solid var(--b1);display:flex;align-items:center;justify-content:space-between;gap:10px">
        <div>
          <div style="color:var(--t3);font-size:10px;letter-spacing:.14em;text-transform:uppercase;margin-bottom:2px">Knowledge feed</div>
          <div style="color:var(--t1);font-size:12px">Maya — ${esc(formatNiche(niche))}</div>
        </div>
        <button data-v2-nav="db-knowledge" style="background:transparent;border:1px solid var(--b2);color:var(--t2);padding:6px 12px;border-radius:999px;font-size:10px;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;font-family:inherit">Full feed</button>
      </div>
    `
    if (items.length === 0) {
      return `
        ${header}
        <div style="padding:32px 20px;text-align:center;color:var(--t2);font-size:12px;line-height:1.55">
          Signals are still wiring up — open the full feed or brief Maya while we pull the next batch.
          <div style="margin-top:14px;display:flex;flex-wrap:wrap;gap:8px;justify-content:center">
            <button type="button" data-v2-nav="db-knowledge" style="background:var(--t1);color:var(--inv,var(--bg));border:none;padding:8px 16px;border-radius:6px;font-size:11px;font-weight:600;font-family:inherit;cursor:pointer">Open full feed</button>
            <button type="button" data-v2-brief="analyst" data-v2-brief-name="Maya" style="background:transparent;border:1px solid var(--b2);color:var(--t2);padding:8px 16px;border-radius:6px;font-size:11px;font-family:inherit;cursor:pointer">Turn into brief</button>
          </div>
        </div>
      `
    }
    const list = items.map(feedItemHTML).join('')
    const feedFooter = `
      <div style="padding:12px 16px;border-top:1px solid var(--b1);display:flex;flex-wrap:wrap;gap:8px">
        <button type="button" data-v2-brief="analyst" data-v2-brief-name="Maya" style="background:var(--t1);color:var(--inv,var(--bg));border:none;padding:6px 12px;border-radius:6px;font-size:10px;font-weight:600;font-family:inherit;cursor:pointer">Turn signal into brief</button>
        <button type="button" data-v2-brief="strategist" data-v2-brief-name="Jordan" style="background:transparent;border:1px solid var(--b2);color:var(--t2);padding:6px 12px;border-radius:6px;font-size:10px;font-family:inherit;cursor:pointer">Schedule for Jordan</button>
        <button type="button" data-v2-nav="db-knowledge" style="background:transparent;border:1px solid var(--b2);color:var(--t3);padding:6px 12px;border-radius:6px;font-size:10px;font-family:inherit;cursor:pointer">Ask Maya to go deeper</button>
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
    const scoreTag = item.score != null
      ? `<span style="color:var(--t1);font-weight:600;margin-left:auto">${item.score}</span>`
      : ''
    return `
      <li class="vx-dcard-row" style="padding:14px 20px;border-bottom:1px solid var(--b1)">
        <a href="${esc(item.url)}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit;display:flex;gap:12px;align-items:flex-start">
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
        <main style="flex:1;min-width:0;overflow-y:auto;padding:28px 40px 60px">
          ${sectionHeader()}
          ${sectionCeoNextAction()}
          ${sectionTeamPulseBanner()}
          ${sectionQueueNav()}
          ${sectionOverview()}
          ${sectionReviewQueue()}
          ${sectionTeam()}
          ${sectionPerformance()}
          ${sectionTiktok()}
          ${sectionActivity()}
        </main>
        ${STATE.feed.length > 0 ? `<aside style="width:340px;flex-shrink:0;overflow-y:auto;border-left:1px solid var(--b1);background:var(--s1)">
          ${sectionFeedStrip()}
        </aside>` : ''}
      </div>
    `
    wireEvents(root)
    // Remove the auth gate style now that v2 owns the DOM
    document.getElementById('vx-auth-gate')?.remove()
    // Kick off background sync AFTER rendering — doesn't delay the UI
    backgroundTiktokSync()
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
