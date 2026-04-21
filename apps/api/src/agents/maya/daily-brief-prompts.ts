/**
 * Maya's Daily Brief Prompts
 *
 * Three briefing times per day:
 * - Morning (8am): Trends + yesterday recap + today's queue
 * - Midday (1pm): Performance tracking of today's posts
 * - Evening (8pm): Full recap + learnings + tomorrow forecast
 */

import { MorningBriefData, MidayCheckData, EveningRecapData } from '../../lib/dailyBrief.service'

// ─── MORNING BRIEF ────────────────────────────────────────────────────────────

/**
 * 8:00 AM UTC — What's happening overnight + yesterday's results + today's queue
 */
export function buildMayaMorningBriefPrompt(context: {
  niche: string
  subNiche?: string
  brandVoice: string
  data: MorningBriefData
}): string {
  const { niche, subNiche, brandVoice, data } = context

  const trendsSummary = data.trendingTopics
    .slice(0, 5)
    .map(
      t =>
        `- "${t.topic}" (+${t.growthPercent}% in ${t.timeframe}, saturation: ${t.saturationLevel})`,
    )
    .join('\n')

  const yesterdayBest = data.yesterdayPosts.reduce((best, curr) =>
    (curr.metrics.engagement > best.metrics.engagement) ? curr : best,
  data.yesterdayPosts[0])

  const queuedCount = data.queuedPosts.length
  const readyCount = data.queuedPosts.filter(p => p.status === 'ready').length

  const peakTimes = data.audienceInsights.peakTimes.join(', ') || 'No data yet'

  return `You are Maya, the Trend & Insights Analyst. It's 8:00 AM UTC.

The Creator You Work For
- Niche: ${niche}${subNiche ? ` (${subNiche})` : ''}
- Brand voice: ${brandVoice}

OVERNIGHT TRENDS (Last 12 hours)
${trendsSummary || 'No new trends yet.'}

YESTERDAY'S PERFORMANCE
${
  yesterdayBest
    ? `- Best post: "${yesterdayBest.caption.substring(0, 50)}..."
   Reach: ${yesterdayBest.metrics.reach} | Engagement: ${yesterdayBest.metrics.engagement} | Rate: ${(yesterdayBest.metrics.engagementRate * 100).toFixed(1)}%
   Top audience: ${yesterdayBest.topCohort.name} (${yesterdayBest.topCohort.percentage}%)
   Result: ${yesterdayBest.vsAverage}`
    : '- No posts published yesterday'
}

TODAY'S QUEUE
- Ready to post: ${readyCount}
- In production: ${queuedCount - readyCount}
- Total queued: ${queuedCount}

AUDIENCE INSIGHTS
- Peak times today: ${peakTimes}
- Top cohorts: ${data.audienceInsights.topCohorts.map(c => c.name).join(', ') || 'No data'}

YOUR JOB THIS MORNING
1. Report what's trending overnight in their niche
2. Highlight yesterday's best-performing post + why it worked
3. Give a quick forecast: "Here's what to expect from today's queue"
4. Flag if any trends align with their upcoming content
5. If a major trend emerges, recommend briefing Jordan for a pivot

OUTPUT FORMAT
Return ONLY this JSON:
{
  "trendingTopics": [
    {
      "topic": "string",
      "urgency": "act_now" | "keep_watching",
      "angle": "How this creator should approach it",
      "shouldBrief": boolean
    }
  ],
  "yesterdayWin": {
    "caption": "string (actual caption from best post)",
    "reach": number,
    "engagementRate": number,
    "why": "string (specific reason it worked)",
    "topCohort": "string (who engaged most)"
  },
  "queueStatus": {
    "ready": number,
    "inProduction": number
  },
  "audiencePulse": {
    "peakTime": "string (e.g. 'Wed 6-8pm')",
    "activeToday": "string (any trends from audience data)"
  },
  "recommendation": "string (1-2 sentence guidance for the day)"
}`
}

// ─── MIDDAY CHECK ────────────────────────────────────────────────────────────

/**
 * 1:00 PM UTC — How are today's posts tracking?
 */
export function buildMayaMidayCheckPrompt(context: {
  niche: string
  subNiche?: string
  data: MidayCheckData
}): string {
  const { niche, subNiche, data } = context

  const posts = data.todaysPosts
    .map(
      p =>
        `- "${p.caption.substring(0, 40)}..." | Published: ${Math.round((Date.now() - p.publishedAt.getTime()) / (1000 * 60))}m ago
   Reach: ${p.metrics.reach} | Engagement: ${p.metrics.engagement} | Rate: ${(p.metrics.engagementRate * 100).toFixed(1)}%`,
    )
    .join('\n')

  return `You are Maya. It's 1:00 PM UTC. Time for a quick performance check.

Creator: ${niche}${subNiche ? ` (${subNiche})` : ''}
Posts published today: ${data.todaysPosts.length}
Hours elapsed: ${data.hoursElapsed}

TODAY'S POSTS (Midday snapshot)
${posts || 'No posts published yet today.'}

YOUR JOB
Report how today's posts are tracking at the midday mark:
1. Which post(s) are performing well?
2. Any that are underperforming?
3. What's the trajectory (on pace, accelerating, struggling)?
4. Should the creator boost any post?

Keep it SHORT. This is a quick pulse check, not a full analysis.

OUTPUT FORMAT
Return ONLY this JSON:
{
  "trackedPost": {
    "caption": "string (first 60 chars)",
    "platform": "string"
  },
  "hoursPublished": number,
  "currentMetrics": {
    "reach": number,
    "engagement": number
  },
  "trajectory": "on_pace" | "accelerating" | "underperforming",
  "forecast": {
    "estimatedReach": number,
    "estimatedEngagement": number
  },
  "actionIfSurging": "string or null (e.g. 'Consider boosting')"
}`
}

// ─── EVENING RECAP ────────────────────────────────────────────────────────────

/**
 * 8:00 PM UTC — Full day recap + tomorrow forecast
 */
export function buildMayaEveningRecapPrompt(context: {
  niche: string
  subNiche?: string
  data: EveningRecapData
}): string {
  const { niche, subNiche, data } = context

  const allPosts = data.todaysPosts
    .map(
      p =>
        `- "${p.caption.substring(0, 50)}..."
   Reach: ${p.metrics.reach} | Engagement: ${p.metrics.engagement} | Rate: ${(p.metrics.engagementRate * 100).toFixed(1)}%
   ${p.vsAverage}`,
    )
    .join('\n')

  const tomorrowQueue = data.queuedTomorrow
    .slice(0, 3)
    .map(p => `- "${p.caption.substring(0, 40)}..." (${p.format})`)
    .join('\n')

  return `You are Maya. It's 8:00 PM UTC. Time to wrap up the day.

Creator: ${niche}${subNiche ? ` (${subNiche})` : ''}

TODAY'S FINAL PERFORMANCE
${allPosts || 'No posts published today.'}

TOMORROW'S QUEUE (Preview)
${tomorrowQueue || 'No posts queued yet for tomorrow.'}

YOUR JOB THIS EVENING
1. Summarize today's performance with specific learnings
2. Highlight the best post — why did it work?
3. Flag any underperformers and why
4. Forecast: "Here's what tomorrow looks like"
5. If a trend opportunity emerged, recommend briefing Jordan

TONE: Congratulatory if good day, constructive if weak day. Always end on what to improve.

OUTPUT FORMAT
Return ONLY this JSON:
{
  "summary": "string (2-3 sentence day recap)",
  "bestPost": {
    "caption": "string (first 60 chars)",
    "reach": number,
    "engagementRate": number,
    "why": "string (specific reason it worked - format, hook, timing, audience fit)",
    "topCohort": "string"
  },
  "learnings": ["string", "string", "string"],
  "tomorrowForecast": {
    "expectedReach": number,
    "topCohort": "string",
    "recommendation": "string"
  },
  "trendOpportunity": {
    "trend": "string or null",
    "shouldBrief": boolean,
    "reason": "string or null"
  }
}`
}
