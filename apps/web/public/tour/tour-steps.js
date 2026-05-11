// Sovexa onboarding tour steps — two tiers:
//
// 1. VEXA_TOUR_STEPS — main tour (10 panels). Auto-fires on first login
//    (and on every login for test usernames). Welcome → Connect → HQ
//    (forecast · playbook · anomalies · pipeline) → Notifications →
//    Posts → Studio → Wrap up. High-level walkthrough.
//
// 2. VEXA_MINI_TOURS — surface-specific deep-dives. Fires the first
//    time a user navigates to that surface AFTER completing the main
//    tour. Goes deeper than the main tour can in one step.
//    Each mini tour walks a single page, so no navigate() calls.

window.VEXA_TOUR_STEPS = [
  {
    id: 'welcome',
    target: null,
    page: 'dashboard',
    eyebrow: 'Welcome to Sovexa',
    title: 'Your AI\ncontent team.',
    body: 'Three specialists. Zero management overhead. They analyze, plan, and direct — you make the final call.',
    cta: 'Take the tour',
  },
  {
    id: 'connect',
    target: 'connect-platforms',
    page: 'dashboard',
    eyebrow: 'Step 1 of 8',
    title: 'Your data,\nplugged in.',
    body: 'Connect Instagram or TikTok so Maya can read your numbers. The forecast, playbook, and anomalies all pull from your connected accounts.',
    cta: 'Next',
  },
  {
    id: 'hq-forecast',
    target: 'hq-forecast',
    page: 'dashboard',
    eyebrow: 'Step 2 of 8',
    title: 'Your trajectory,\nforecast.',
    body: 'Maya projects where your reach and followers are heading. The dotted line is what\'s coming if nothing changes.',
    cta: 'Next',
  },
  {
    id: 'hq-playbook',
    target: 'hq-playbook',
    page: 'dashboard',
    eyebrow: 'Step 3 of 8',
    title: 'Maya\'s daily\nplaybook.',
    body: 'Fresh every morning — Maya reads your numbers and writes the day\'s standing orders. First playbook lands within 24 hours of your first sync.',
    cta: 'Next',
  },
  {
    id: 'hq-anomalies',
    target: 'hq-anomalies',
    page: 'dashboard',
    eyebrow: 'Step 4 of 8',
    title: 'What\'s popping,\nright now.',
    body: 'Posts performing 2-5× above your usual surface here automatically. Maya flags them so you can repeat what\'s working.',
    cta: 'Next',
  },
  {
    id: 'hq-pipeline',
    target: 'hq-pipeline',
    page: 'dashboard',
    eyebrow: 'Step 5 of 8',
    title: 'Your team,\nin motion.',
    body: 'The pipeline runs on its own. Maya hands off to Jordan, Jordan briefs Riley. You step in only when something needs your approval.',
    cta: 'Next',
  },
  {
    id: 'hq-maya-takes',
    target: 'maya-takes',
    page: 'dashboard',
    eyebrow: 'Step 6 of 8',
    title: 'Maya\'s takes,\non every tile.',
    body: 'Every metric, heatmap, and chart on HQ comes with Maya\'s reading. Tap to expand — what the number means, what changed, what to do about it.',
    cta: 'Next',
  },
  {
    id: 'posts',
    target: 'posts-filters',
    page: 'posts',
    eyebrow: 'Step 7 of 8',
    title: 'Every post,\nsorted.',
    body: 'Your full content history — filtered by platform, format, and performance. Honest data, no vanity charts.',
    cta: 'Next',
  },
  {
    id: 'studio',
    target: 'studio-upload',
    page: 'studio',
    eyebrow: 'Step 8 of 8',
    title: 'Clip, edit,\nand ship.',
    body: 'Drop raw footage. Riley auto-clips and applies your aesthetic. Finished cuts land in your library — you approve before anything publishes.',
    cta: 'Next',
  },
  {
    id: 'ready',
    target: null,
    page: 'dashboard',
    eyebrow: 'Wrap up',
    title: 'You\'re the CEO.\nThey do the work.',
    body: 'Connect your accounts to kick everything off. Your team is ready when you are.',
    cta: 'Enter Sovexa',
  },
]

// ─── Mini tours ───────────────────────────────────────────────────────
// Trigger condition: user navigates to the surface AND main tour is done
// AND mini tour for this surface hasn't fired yet (test users replay).

window.VEXA_MINI_TOURS = {
  studio: [
    {
      id: 'studio-mini-upload',
      target: 'studio-upload',
      eyebrow: 'Studio · 1 of 4',
      title: 'Drop your\nraw footage.',
      body: 'Upload one or many videos. Riley pulls the strongest moments, applies your aesthetic, and prepares them for your review.',
      cta: 'Next',
    },
    {
      id: 'studio-mini-edits',
      target: 'studio-edits',
      eyebrow: 'Studio · 2 of 4',
      title: 'Riley\'s edits,\nfor your review.',
      body: 'Each clip lands here as a card — preview the cut, see the version, color toning, and how closely it matches your aesthetic.',
      cta: 'Next',
    },
    {
      id: 'studio-mini-buttons',
      target: 'studio-card',
      eyebrow: 'Studio · 3 of 4',
      title: 'Five decisions,\nper clip.',
      body: 'Approve to ship it · ↓ Download the file · ↻ Re-cut to ask Riley for a different version · ✕ Reject with feedback so Riley learns · Discard to remove the clip entirely.',
      cta: 'Next',
    },
    {
      id: 'studio-mini-schedule',
      target: 'studio-schedule',
      eyebrow: 'Studio · 4 of 4',
      title: 'Jordan picks\nthe moment.',
      body: 'Once approved, Jordan slots the clip into the highest-performance window for your audience — or you pick your own time. Finished cuts sit in your library until they ship.',
      cta: 'Got it',
    },
  ],
}
