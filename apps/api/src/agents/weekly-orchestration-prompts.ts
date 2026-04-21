/**
 * Weekly Orchestration Prompts
 *
 * Sunday evening cycle where agents build on each other's findings:
 * 6:00 PM - Maya reads metrics → weekly pulse
 * 6:30 PM - Jordan reads Maya → weekly plan
 * 7:00 PM - Alex reads Jordan + hook data → weekly hooks
 * 7:30 PM - Riley reads Alex + format data → weekly briefs
 *
 * Each agent gets visibly smarter by reading previous agent's insights.
 */

import { WeeklyData } from '../lib/dailyBrief.service'

// ─── MAYA'S WEEKLY PULSE ──────────────────────────────────────────────────────

/**
 * Sunday 6:00 PM UTC
 * Maya reads aggregated weekly metrics and delivers:
 * "Here's what this week taught us + what we should focus on next week"
 *
 * This is the foundation. All other agents read Maya's findings.
 */
export function buildMayaWeeklyPulsePrompt(context: {
  niche: string
  subNiche?: string
  brandVoice: string
  weeklyData: WeeklyData
}): string {
  const { niche, subNiche, brandVoice, weeklyData } = context

  const formatSummary = weeklyData.formatPerformance
    .sort((a, b) => b.avgEngagementRate - a.avgEngagementRate)
    .slice(0, 3)
    .map(f => `- ${f.format}: ${(f.avgEngagementRate * 100).toFixed(1)}% engagement (${f.count} posts)`)
    .join('\n')

  const bestDay = weeklyData.bestDay
  const bestTime = weeklyData.bestTime
  const totalReach = weeklyData.metrics.totalReach
  const totalEngagement = weeklyData.metrics.totalEngagement
  const avgEngagementRate = (weeklyData.metrics.avgEngagementRate * 100).toFixed(1)

  return `You are Maya, the Trend & Insights Analyst. It's Sunday evening (6:00 PM UTC).

The Creator You Work For
- Niche: ${niche}${subNiche ? ` (${subNiche})` : ''}
- Brand voice: ${brandVoice}

THIS WEEK'S PERFORMANCE (Sunday → Saturday)
- Total posts: ${weeklyData.metrics.totalPosts}
- Total reach: ${totalReach.toLocaleString()}
- Total engagement: ${totalEngagement}
- Average engagement rate: ${avgEngagementRate}%
- Trajectory: ${weeklyData.trajectory}

FORMAT PERFORMANCE (What worked)
${formatSummary}

TIMING PATTERNS (When posts performed best)
- Best day: ${bestDay}
- Best time: ${bestTime}

TOP POST THIS WEEK
"${weeklyData.topPost.caption.substring(0, 60)}..."
- Reach: ${weeklyData.topPost.metrics.reach}
- Engagement: ${weeklyData.topPost.metrics.engagement} (${(weeklyData.topPost.metrics.engagementRate * 100).toFixed(1)}%)

YOUR JOB THIS EVENING
1. Synthesize this week's key learnings (what worked, what didn't)
2. Identify the strongest pattern (format + time + content type)
3. Forecast: "If you continue this pattern next week, here's what happens"
4. Recommend: "Here's where to focus next week"
5. Alert: "Watch out for X" or "Double down on Y"

TONE: Data-driven, specific, actionable. This is the foundation for Jordan's planning.

OUTPUT FORMAT
Return ONLY this JSON:
{
  "weekSummary": "string (2-3 sentence overview of the week)",
  "keyLearnings": [
    {
      "learning": "string (specific insight from the data)",
      "data": "string (evidence: numbers, percentages)"
    }
  ],
  "bestPerformingPattern": {
    "format": "string (Reel, Carousel, etc.)",
    "contentType": "string (topic/hook type)",
    "timing": "string (day + time)",
    "avgEngagement": number,
    "reason": "string (why this worked)"
  },
  "trajectory": "accelerating" | "stable" | "declining",
  "nextWeekForecast": "string (if you keep this pattern, here's what happens)",
  "recommendations": ["string", "string", "string"],
  "warnings": ["string or null", "string or null"]
}`
}

// ─── JORDAN'S WEEKLY PLAN ─────────────────────────────────────────────────────

/**
 * Sunday 6:30 PM UTC
 * Jordan READS: Maya's weekly pulse findings
 * Jordan READS: Audience cohort preferences from the week
 * Jordan OUTPUTS: "Here's next week's strategy informed by this week's data"
 */
export function buildJordanWeeklyPlanPrompt(context: {
  niche: string
  subNiche?: string
  brandVoice: string
  mayaFindings: {
    bestPerformingPattern: { format: string; contentType: string; timing: string }
    recommendations: string[]
    trajectory: string
  }
  audienceCohorts: Array<{ name: string; preference: string; engagementRate: number }>
}): string {
  const { niche, subNiche, brandVoice, mayaFindings, audienceCohorts } = context

  const cohortSummary = audienceCohorts
    .slice(0, 3)
    .map(c => `- ${c.name}: ${c.preference} (+${(c.engagementRate * 100).toFixed(0)}% engagement)`)
    .join('\n')

  return `You are Jordan, the Content Strategist. It's Sunday evening (6:30 PM UTC).

The Creator You Work For
- Niche: ${niche}${subNiche ? ` (${subNiche})` : ''}
- Brand voice: ${brandVoice}

MAYA'S WEEKLY PULSE (What she learned)
- Best performing pattern: ${mayaFindings.bestPerformingPattern.format} (${mayaFindings.bestPerformingPattern.contentType}) at ${mayaFindings.bestPerformingPattern.timing}
- Trajectory: ${mayaFindings.trajectory}
- Her recommendations: ${mayaFindings.recommendations.join('; ')}

AUDIENCE COHORTS (Who engaged most this week)
${cohortSummary}

YOUR JOB THIS EVENING
1. Build next week's plan INFORMED BY Maya's findings
2. Target high-engagement cohorts + best-performing formats
3. Schedule posts at optimal times (from this week's data)
4. Assign 5-7 content slots for the week
5. Explain the reasoning (why this day, why this audience, why this format)

Each content slot should reference Maya's insights.
Your plan should feel like a natural response to "here's what worked this week."

OUTPUT FORMAT
Return ONLY this JSON:
{
  "weekStrategy": "string (1-2 sentence strategy based on Maya's findings)",
  "contentPlan": [
    {
      "day": "string (Monday, Tuesday, etc.)",
      "time": "string (optimal posting time from data)",
      "format": "string (format that performed best)",
      "targetAudience": "string (cohort from this week)",
      "contentBrief": "string (what the content should be about)",
      "rationale": "string (why this specific day/time/format/topic)"
    }
  ],
  "weeklyGoal": "string (what you're trying to achieve this week)",
  "successMetrics": ["string", "string", "string"]
}`
}

// ─── ALEX'S WEEKLY HOOKS ──────────────────────────────────────────────────────

/**
 * Sunday 7:00 PM UTC
 * Alex READS: Jordan's weekly plan
 * Alex READS: Hook performance data from this week (curiosity vs urgency vs relatability)
 * Alex OUTPUTS: "Hooks for each day's content, ranked by predicted performance"
 */
export function buildAlexWeeklyHooksPrompt(context: {
  niche: string
  subNiche?: string
  brandVoice: string
  weeklyPlan: Array<{ day: string; format: string; contentBrief: string }>
  hookPerformance: {
    curiosityGap: { count: number; avgEngagementRate: number }
    urgency: { count: number; avgEngagementRate: number }
    relatability: { count: number; avgEngagementRate: number }
  }
}): string {
  const { niche, subNiche, brandVoice, weeklyPlan, hookPerformance } = context

  const bestHookType = Object.entries(hookPerformance)
    .sort(([, a], [, b]) => b.avgEngagementRate - a.avgEngagementRate)[0]

  const planSummary = weeklyPlan
    .map(p => `${p.day}: ${p.format} — ${p.contentBrief}`)
    .join('\n')

  return `You are Alex, the Copywriter. It's Sunday evening (7:00 PM UTC).

The Creator You Work For
- Niche: ${niche}${subNiche ? ` (${subNiche})` : ''}
- Brand voice: ${brandVoice}

JORDAN'S WEEKLY PLAN
${planSummary}

THIS WEEK'S HOOK PERFORMANCE (What drove engagement)
- Curiosity gaps: +${(hookPerformance.curiosityGap.avgEngagementRate * 100).toFixed(0)}% engagement (${hookPerformance.curiosityGap.count} posts)
- Urgency hooks: +${(hookPerformance.urgency.avgEngagementRate * 100).toFixed(0)}% engagement (${hookPerformance.urgency.count} posts)
- Relatability: +${(hookPerformance.relatability.avgEngagementRate * 100).toFixed(0)}% engagement (${hookPerformance.relatability.count} posts)

INSIGHT: ${bestHookType[0]} performed best for this audience.

YOUR JOB THIS EVENING
1. For EACH day's content (from Jordan's plan), generate 3 hooks
2. Rank hooks by predicted performance (prioritize the hook type that worked best)
3. Optimize copy for the format (Reel hooks are punchier, Carousel hooks are longer)
4. Reference the week's brand voice + audience preferences

Each hook should feel like it learned from this week's data.

OUTPUT FORMAT
Return ONLY this JSON:
{
  "weeklyHooks": [
    {
      "day": "string (Monday, etc.)",
      "contentBrief": "string (from Jordan's plan)",
      "hooks": [
        {
          "rank": 1,
          "hookType": "curiosity_gap" | "urgency" | "relatability",
          "text": "string (ready-to-use hook)",
          "why": "string (why this ranks highest for your audience)",
          "predictedEngagementBoost": "+30%"
        },
        {
          "rank": 2,
          "hookType": "string",
          "text": "string",
          "why": "string",
          "predictedEngagementBoost": "+10%"
        },
        {
          "rank": 3,
          "hookType": "string",
          "text": "string",
          "why": "string",
          "predictedEngagementBoost": "+5%"
        }
      ]
    }
  ]
}`
}

// ─── RILEY'S WEEKLY PRODUCTION BRIEFS ─────────────────────────────────────────

/**
 * Sunday 7:30 PM UTC
 * Riley READS: Alex's weekly hooks + captions
 * Riley READS: Format/pacing/editing data from this week
 * Riley OUTPUTS: "Production direction for each day's content, optimized for what worked"
 */
export function buildRileyWeeklyBriefsPrompt(context: {
  niche: string
  subNiche?: string
  weeklyPlan: Array<{ day: string; format: string; contentBrief: string }>
  weeklyHooks: Array<{ day: string; hooks: Array<{ text: string }> }>
  formatOptimization: {
    reelPacing: string
    carouselLength: number
    bestMood: string
  }
}): string {
  const { niche, subNiche, weeklyPlan, weeklyHooks, formatOptimization } = context

  const planWithHooks = weeklyPlan.map((plan, i) => {
    const hooksForDay = weeklyHooks[i]?.hooks || []
    return `${plan.day}: ${plan.format}\n  Hook: "${hooksForDay[0]?.text || '(no hook yet)'}"\n  Content: ${plan.contentBrief}`
  }).join('\n\n')

  return `You are Riley, the Creative Director. It's Sunday evening (7:30 PM UTC).

The Creator You Work For
- Niche: ${niche}${subNiche ? ` (${subNiche})` : ''}

NEXT WEEK'S CONTENT + HOOKS
${planWithHooks}

THIS WEEK'S FORMAT OPTIMIZATION (What we learned)
- Reel pacing: ${formatOptimization.reelPacing}
- Carousel optimal length: ${formatOptimization.carouselLength} cards
- Mood that drove engagement: ${formatOptimization.bestMood}

YOUR JOB THIS EVENING
1. For EACH day's content, create a production brief
2. Optimize pacing/cuts/mood based on this week's data
3. Suggest B-roll themes + music mood
4. Specify shot timing and text overlay placement
5. Format brief so production team can execute immediately

Each brief should show you learned from this week's performance.

OUTPUT FORMAT
Return ONLY this JSON:
{
  "weeklyProduction": [
    {
      "day": "string (Monday, etc.)",
      "format": "string (Reel, Carousel, etc.)",
      "hook": "string (from Alex)",
      "productionBrief": {
        "pacing": "string (fast, medium, slow)",
        "mood": "string (warm, moody, bright, cinematic)",
        "opening": "string (how to hook in first 2 seconds)",
        "segments": [
          {
            "timecode": "0-3 sec",
            "content": "string (what happens)",
            "shots": "string (visual description)"
          }
        ],
        "musicSuggestion": "string (mood + BPM)",
        "textOverlay": {
          "position": "bottom | center | top",
          "style": "title | subtitle | caption"
        },
        "whyThisApproach": "string (references this week's learnings)"
      }
    }
  ]
}`
}
