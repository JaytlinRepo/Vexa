/* Vexa — dashboard v2
 *
 * Replaces everything inside #view-db-dashboard with a single clean,
 * purposeful layout. All data comes from the same endpoints; the goal is
 * readability, not feature density. No emojis. Typography-driven.
 *
 * Sections (top to bottom):
 *   1. Header — greeting + plan chip
 *   2. Overview — 4 stat tiles (review queue / followers / engagement / plan usage)
 *   3. Awaiting your review — big task cards with output preview + approve/reject
 *   4. Team — 4 employee cards with status + meeting button
 *   5. Performance — follower growth + engagement-by-weekday + top post
 *   6. Activity — timeline of last 10 events
 */
;(function () {
  const STATE = { me: null, tasks: [], usage: null, insights: null, feed: [], notifs: [] }

  // ─────────────── data ────────────────────────────────────────────
  async function fetchAll() {
    const get = (u) => fetch(u, { credentials: 'include' }).then((r) => r.ok ? r.json() : null).catch(() => null)
    const [me, tasks, usage, notifs] = await Promise.all([
      get('/api/auth/me'),
      get('/api/tasks'),
      get('/api/usage'),
      get('/api/notifications'),
    ])
    STATE.me = me
    STATE.tasks = tasks?.tasks || []
    STATE.usage = usage
    STATE.notifs = notifs?.items || []
    const companyId = me?.companies?.[0]?.id
    if (companyId) {
      const [insights, feed] = await Promise.all([
        get(`/api/instagram/insights?companyId=${companyId}`),
        get('/api/feed'),
      ])
      STATE.insights = insights?.connection || null
      STATE.feed = feed?.items || []
    }
  }

  // ─────────────── helpers ─────────────────────────────────────────
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

  const short = (n) => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
    if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
    return String(n)
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
      <section style="margin-bottom:32px">
        <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap">
          <div>
            <h1 style="font-family:'Cormorant Garamond',serif;font-size:clamp(28px,3.5vw,44px);font-weight:500;line-height:1.1;color:var(--t1);margin:0 0 6px">${esc(greetingFor(user?.fullName || user?.username))}</h1>
            <div style="color:var(--t2);font-size:13px">${esc(company?.name || 'Your company')} · ${esc(formatNiche(company?.niche))}</div>
          </div>
          <button data-v2-nav="db-settings" style="background:transparent;border:1px solid var(--b2);color:var(--t2);padding:8px 16px;border-radius:999px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;font-family:inherit">${esc(chipLabel)}</button>
        </div>
      </section>
    `
  }

  function sectionOverview() {
    const u = STATE.usage
    const ig = STATE.insights
    const awaiting = STATE.tasks.filter((t) => t.status === 'delivered').length

    const tasksLimit = u?.tasks?.limit ?? 30
    const tasksUsed = u?.tasks?.used ?? 0
    const pct = Math.min(100, Math.round((tasksUsed / Math.max(1, tasksLimit)) * 100))

    const series = ig?.followerSeries || []
    const followerDelta = series.length >= 2 ? series[series.length - 1].followers - series[0].followers : 0
    const engRate = ig?.engagementRate ?? 0

    return `
      <section style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:40px">
        ${tile('Awaiting review', String(awaiting), awaiting > 0 ? 'Tap to triage below' : 'All caught up', awaiting > 0 ? 'db-tasks' : null)}
        ${tile('Followers', ig ? short(ig.followerCount) : '—', ig ? `${followerDelta >= 0 ? '+' : ''}${short(Math.abs(followerDelta))} in 30d` : 'No IG connected')}
        ${tile('Engagement', ig ? engRate.toFixed(1) + '%' : '—', ig ? `Avg across last ${ig.recentMedia?.length || 0} posts` : '—')}
        ${tile('Tasks this month', `${tasksUsed} / ${tasksLimit >= 9999 ? '∞' : tasksLimit}`, `${pct}% used`, null, pct)}
      </section>
    `
  }

  function tile(label, value, sub, navId, progressPct) {
    const action = navId ? `data-v2-nav="${navId}" style="cursor:pointer"` : ''
    return `
      <div ${action} style="background:var(--s1);border:1px solid var(--b1);border-radius:14px;padding:20px;${navId ? 'transition:border-color .2s' : ''}">
        <div style="color:var(--t3);font-size:10px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:10px">${esc(label)}</div>
        <div style="color:var(--t1);font-family:'Cormorant Garamond',serif;font-size:36px;font-weight:500;line-height:1;margin-bottom:6px">${esc(value)}</div>
        <div style="color:var(--t2);font-size:11px">${esc(sub)}</div>
        ${progressPct != null ? `<div style="height:3px;border-radius:2px;background:var(--s3);margin-top:10px;overflow:hidden"><div style="width:${progressPct}%;height:100%;background:var(--t1);transition:width .4s ease"></div></div>` : ''}
      </div>
    `
  }

  function sectionReviewQueue() {
    const delivered = STATE.tasks.filter((t) => t.status === 'delivered').slice(0, 3)
    if (delivered.length === 0) {
      return `
        <section style="margin-bottom:40px">
          ${sectionLabel('Awaiting your review')}
          <div style="padding:32px;text-align:center;color:var(--t3);font-size:13px;border:1px dashed var(--b1);border-radius:12px">Your team is working. New deliveries will surface here.</div>
        </section>
      `
    }
    return `
      <section style="margin-bottom:40px">
        ${sectionLabel('Awaiting your review')}
        <div style="display:flex;flex-direction:column;gap:12px">
          ${delivered.map(reviewCard).join('')}
        </div>
      </section>
    `
  }

  function reviewCard(t) {
    const role = ROLE[t.employee?.role] || { name: t.employee?.name || 'Vexa', title: '', init: 'V' }
    return `
      <article data-task-id="${t.id}" style="background:var(--s1);border:1px solid var(--b1);border-radius:14px;padding:20px 22px">
        <header style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:6px">
          <div>
            <div style="color:var(--t3);font-size:10px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px">${esc(role.name)} · ${esc(formatType(t.type))}</div>
            <h3 style="font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:500;color:var(--t1);margin:0">${esc(t.title)}</h3>
          </div>
          <span style="color:var(--t3);font-size:11px;flex-shrink:0">${esc(timeAgo(t.createdAt))}</span>
        </header>
        ${t.description ? `<p style="color:var(--t2);font-size:13px;line-height:1.6;margin:8px 0 0">${esc(t.description)}</p>` : ''}
        ${outputPreview(t.outputs?.[0])}
        <footer style="display:flex;gap:10px;margin-top:16px">
          <button data-v2-action="approve" data-task-id="${t.id}" style="background:var(--t1);color:var(--inv,var(--bg));border:none;padding:10px 18px;border-radius:8px;font-size:12px;font-weight:600;font-family:'Syne',sans-serif;letter-spacing:.04em;cursor:pointer">Approve</button>
          <button data-v2-action="reject" data-task-id="${t.id}" style="background:transparent;border:1px solid var(--b2);color:var(--t2);padding:10px 18px;border-radius:8px;font-size:12px;font-weight:500;font-family:'Syne',sans-serif;letter-spacing:.04em;cursor:pointer">Reject</button>
          <button data-v2-meeting="${role.name}" data-v2-role="${role.title}" data-v2-init="${role.init}" style="margin-left:auto;background:transparent;border:1px solid var(--b2);color:var(--t3);padding:10px 18px;border-radius:8px;font-size:12px;font-family:inherit;cursor:pointer">Call meeting</button>
        </footer>
      </article>
    `
  }

  function outputPreview(o) {
    if (!o) return ''
    const c = o.content || {}
    if (Array.isArray(c.hooks) && c.hooks.length) {
      return `<ol style="margin:12px 0 0;padding-left:18px;color:var(--t2);font-size:13px;line-height:1.8">
        ${c.hooks.slice(0, 4).map((h) => `<li${h.flagged ? ' style="color:var(--t1);font-weight:500"' : ''}>${esc(h.text || '')}</li>`).join('')}
      </ol>`
    }
    if (Array.isArray(c.trends) && c.trends.length) {
      return `<ul style="margin:12px 0 0;padding-left:0;list-style:none;color:var(--t2);font-size:13px;line-height:1.7">
        ${c.trends.slice(0, 3).map((t) => `<li style="padding:4px 0"><strong style="color:var(--t1);font-weight:500">${esc(t.topic || '')}</strong> <span style="color:var(--t3);margin:0 6px">·</span> ${esc(t.growth || '')} <span style="color:var(--t3);margin:0 6px">·</span> ${esc(t.verdict || '')}</li>`).join('')}
      </ul>`
    }
    if (Array.isArray(c.posts) && c.posts.length) {
      return `<ul style="margin:12px 0 0;padding-left:0;list-style:none;color:var(--t2);font-size:13px;line-height:1.7">
        ${c.posts.slice(0, 3).map((p) => `<li style="padding:4px 0"><strong style="color:var(--t1);font-weight:500;width:40px;display:inline-block">${esc(p.day || '')}</strong> ${esc(p.format || '')} <span style="color:var(--t3);margin:0 6px">·</span> ${esc(p.topic || '')}</li>`).join('')}
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
      <section style="margin-bottom:40px">
        ${sectionLabel('Your team')}
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
          ${EMPLOYEE_ROLES.map((role) => teamCard(role, tasksByRole[role] || [])).join('')}
        </div>
      </section>
    `
  }

  function teamCard(role, tasks) {
    const r = ROLE[role]
    const delivered = tasks.find((t) => t.status === 'delivered')
    const working = tasks.find((t) => t.status === 'pending' || t.status === 'in_progress' || t.status === 'revision')
    const status = delivered ? 'Output ready' : working ? 'Working' : tasks.length ? 'Done' : 'Idle'
    const latest = tasks[0]

    return `
      <div style="background:var(--s1);border:1px solid var(--b1);border-radius:14px;padding:18px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <div style="width:32px;height:32px;border-radius:10px;background:var(--s3);color:var(--t1);display:grid;place-items:center;font-weight:600;font-size:13px;font-family:'Syne',sans-serif">${r.init}</div>
          <div style="min-width:0">
            <div style="color:var(--t1);font-size:13px;font-weight:600;line-height:1.2">${esc(r.name)}</div>
            <div style="color:var(--t3);font-size:10px;letter-spacing:.06em;text-transform:uppercase">${esc(r.title)}</div>
          </div>
        </div>
        <div style="color:var(--t2);font-size:11px;margin-bottom:4px;display:flex;align-items:center;gap:6px">
          <span style="width:6px;height:6px;border-radius:50%;background:${delivered ? 'var(--t1)' : working ? '#e8c87a' : 'var(--t3)'}"></span>
          ${esc(status)}
        </div>
        <div style="color:var(--t2);font-size:12px;line-height:1.4;margin-bottom:14px;min-height:32px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${esc(latest ? latest.title : 'Getting ready for their first task.')}</div>
        <button data-v2-meeting="${r.name}" data-v2-role="${r.title}" data-v2-init="${r.init}" style="width:100%;background:transparent;border:1px solid var(--b2);color:var(--t2);padding:8px 12px;border-radius:8px;font-size:11px;font-family:inherit;cursor:pointer">Call meeting</button>
      </div>
    `
  }

  function sectionPerformance() {
    const ig = STATE.insights
    if (!ig) {
      return `
        <section style="margin-bottom:40px">
          ${sectionLabel('Performance — last 30 days')}
          <div style="padding:32px;text-align:center;color:var(--t3);font-size:13px;border:1px dashed var(--b1);border-radius:12px">Connect Instagram to see performance charts.</div>
        </section>
      `
    }
    return `
      <section style="margin-bottom:40px">
        ${sectionLabel('Performance — last 30 days')}
        <div style="display:flex;flex-direction:column;gap:14px">
          ${chartCard('Follower growth', followerGrowthSvg(ig.followerSeries), followerDelta(ig))}
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            ${chartCard('Content mix', formatDonutSvg(ig.recentMedia), null)}
            ${chartCard('Weekly reach', weeklyReachSvg(ig.followerSeries), reachDelta(ig.followerSeries))}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            ${chartCard('Engagement by day', weekdayBars(ig.recentMedia), bestDayLabel(ig.recentMedia))}
            ${topPostCard(ig.topPosts?.[0], ig.recentMedia)}
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

  function chartCard(title, body, statRight) {
    return `
      <div style="background:var(--s1);border:1px solid var(--b1);border-radius:14px;padding:18px 20px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px">
          <div style="color:var(--t3);font-size:10px;letter-spacing:.12em;text-transform:uppercase">${esc(title)}</div>
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

  function sectionActivity() {
    // Build a timeline from notifications (most recent 8).
    const items = STATE.notifs.slice(0, 8)
    if (items.length === 0) {
      return `
        <section>
          ${sectionLabel('Activity')}
          <div style="padding:24px;color:var(--t3);font-size:13px;text-align:center;border:1px dashed var(--b1);border-radius:12px">Nothing yet.</div>
        </section>
      `
    }
    return `
      <section style="margin-bottom:40px">
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
    return `<h2 style="color:var(--t1);font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;margin:0 0 14px;font-family:'Syne',sans-serif">${esc(text)}</h2>`
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
  async function taskAction(id, action) {
    const res = await fetch(`/api/tasks/${id}/action`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    return res.ok
  }

  function wireEvents(host) {
    host.addEventListener('click', async (e) => {
      const tgt = e.target.closest('[data-v2-action]')
      if (tgt) {
        const id = tgt.dataset.taskId
        const action = tgt.dataset.v2Action
        if (!id) return
        tgt.disabled = true
        tgt.textContent = '...'
        const ok = await taskAction(id, action)
        if (ok) refresh()
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
        if (typeof window.openMeeting === 'function') window.openMeeting(name, role, init)
      }
    })
  }

  // ─────────────── feed strip (right rail) ────────────────────────
  function sectionFeedStrip() {
    const items = STATE.feed.slice(0, 12)
    const niche = STATE.me?.companies?.[0]?.niche || ''
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
        <div style="padding:40px 20px;text-align:center;color:var(--t3);font-size:12px">Pulling fresh signals…</div>
      `
    }
    const list = items.map(feedItemHTML).join('')
    return `
      ${header}
      <ol style="list-style:none;padding:0;margin:0">${list}</ol>
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
      <li style="padding:14px 20px;border-bottom:1px solid var(--b1)">
        <a href="${esc(item.url)}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit;display:flex;gap:12px;align-items:flex-start">
          ${thumb}
          <div style="flex:1;min-width:0">
            <div style="color:var(--t3);font-size:10px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px;display:flex;gap:8px;align-items:center">
              <span>${esc(item.source)}</span>
              <span>·</span>
              <span>${esc(when)}</span>
              ${scoreTag}
            </div>
            <div style="color:var(--t1);font-size:13px;font-weight:500;line-height:1.35;margin-bottom:4px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${esc(item.title)}</div>
            <div style="color:var(--t2);font-size:11px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(item.mayaTake || item.summary)}</div>
          </div>
        </a>
      </li>
    `
  }

  // ─────────────── render ──────────────────────────────────────────
  async function render() {
    const view = document.getElementById('view-db-dashboard')
    if (!view) return
    await fetchAll()
    const root = view.querySelector('.db-layout') || view
    root.style.height = '100%'
    root.innerHTML = `
      <div style="height:100%;display:flex;min-height:0;font-family:'DM Sans',sans-serif">
        <main style="flex:1;min-width:0;overflow-y:auto;padding:44px 48px 80px">
          <div style="max-width:820px">
            ${sectionHeader()}
            ${sectionOverview()}
            ${sectionReviewQueue()}
            ${sectionTeam()}
            ${sectionPerformance()}
            ${sectionActivity()}
          </div>
        </main>
        <aside style="width:340px;flex-shrink:0;overflow-y:auto;border-left:1px solid var(--b1);background:var(--s1)">
          ${sectionFeedStrip()}
        </aside>
      </div>
    `
    wireEvents(root)
  }

  async function refresh() {
    await render()
  }

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

  // Initial render for session-restore path.
  if (document.readyState !== 'loading') setTimeout(render, 800)
  document.addEventListener('DOMContentLoaded', () => setTimeout(render, 850))
})()
