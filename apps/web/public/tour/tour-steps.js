// Sovexa onboarding tour steps — current IA (2026-05-11):
// Welcome → HQ (forecast · playbook · anomalies · pipeline) → Posts → Studio → Ready.
// Limited to the three pages the dashboard nav actually surfaces today:
// HQ, Posts, Studio. (Audience / Outputs / Tasks views exist in markup but
// aren't linked from the nav — adding them to the tour would land users on
// unreachable surfaces.)
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
    id: 'hq-forecast',
    target: 'hq-forecast',
    page: 'dashboard',
    eyebrow: 'Step 1 of 6',
    title: 'Your trajectory,\nforecast.',
    body: 'Maya projects where your reach and followers are heading. The dotted line is what\'s coming if nothing changes.',
    cta: 'Next',
  },
  {
    id: 'hq-playbook',
    target: 'hq-playbook',
    page: 'dashboard',
    eyebrow: 'Step 2 of 6',
    title: 'Maya\'s daily\nplaybook.',
    body: 'Every morning Maya reads your numbers and writes the day\'s standing orders — what to double down on, what to cut.',
    cta: 'Next',
  },
  {
    id: 'hq-anomalies',
    target: 'hq-anomalies',
    page: 'dashboard',
    eyebrow: 'Step 3 of 6',
    title: 'What\'s popping,\nright now.',
    body: 'Posts performing 2-5× above your usual surface here automatically. Maya flags them so you can repeat what\'s working.',
    cta: 'Next',
  },
  {
    id: 'hq-pipeline',
    target: 'hq-pipeline',
    page: 'dashboard',
    eyebrow: 'Step 4 of 6',
    title: 'Your team,\nin motion.',
    body: 'Maya hands off to Jordan, Jordan briefs Riley. Real-time view of what each employee is working on.',
    cta: 'Next',
  },
  {
    id: 'posts',
    target: 'posts-filters',
    page: 'posts',
    eyebrow: 'Step 5 of 6',
    title: 'Every post,\nsorted.',
    body: 'Your full content history — filtered by platform, format, and performance. Honest data, no vanity charts.',
    cta: 'Next',
  },
  {
    id: 'studio',
    target: 'studio-upload',
    page: 'studio',
    eyebrow: 'Step 6 of 6',
    title: 'Clip, edit,\nand ship.',
    body: 'Drop raw footage. Riley auto-clips, applies your aesthetic, and gets it post-ready. You approve before anything goes live.',
    cta: 'Next',
  },
  {
    id: 'ready',
    target: null,
    page: 'dashboard',
    eyebrow: 'Wrap up',
    title: 'You\'re the CEO.\nThey do the work.',
    body: 'Your team is already analyzing your accounts. Check your HQ for what\'s coming.',
    cta: 'Enter Sovexa',
  },
]
