/**
 * Run every preset brief through the executor and print each output.
 * Used to audit the content/format/quality of what the agents produce.
 *
 * Usage:  tsx scripts/test-briefs.ts [niche]
 *   niche defaults to 'fitness'. Try 'finance', 'food', 'coaching',
 *   'lifestyle' to see how the niche knowledge shifts the result.
 */
import { PrismaClient, OutputType } from '@prisma/client'
import { executeBrief } from '../src/services/agentExecutor'
import type { AgentRole } from '../src/lib/nicheKnowledge'
import type { PersonalContext } from '../src/lib/personalContext'

const prisma = new PrismaClient()

// Two stub personalContexts so we can verify per-user variation in the
// audit — same niche, different data should produce visibly different
// content (different handles in headlines, different sizing in
// competitor scans, different bio recommendations, etc.).
function stubA(niche: string): PersonalContext {
  return {
    companyId: 'stub-a',
    companyName: 'Stub A',
    niche,
    subNiche: niche === 'fitness' ? 'women\'s strength training' : null,
    brandVoice: {},
    audience: {},
    goals: {},
    instagram: {
      handle: 'creator_a',
      source: 'phyllo',
      accountType: 'CREATOR',
      followerCount: 6_300,
      followingCount: 980,
      postCount: 39,
      engagementRate: 3.2,
      avgReach: 28_000,
      avgImpressions: 32_000,
      topPosts: [
        { caption: 'The 15-min weighted walk that beats cardio', likeCount: 4_120, commentCount: 312, permalink: null, mediaType: 'REEL' },
        { caption: 'How to read a label · 3 red flags', likeCount: 1_840, commentCount: 92, permalink: null, mediaType: 'CAROUSEL_ALBUM' },
      ],
      audienceAge: [{ bucket: '25-34', share: 0.42 }, { bucket: '35-44', share: 0.31 }, { bucket: '18-24', share: 0.16 }],
      audienceGender: [{ bucket: 'FEMALE', share: 0.78 }, { bucket: 'MALE', share: 0.22 }],
      audienceTopCountries: [{ bucket: 'US', share: 0.62 }, { bucket: 'CA', share: 0.09 }],
      audienceTopCities: [{ bucket: 'New York, NY', share: 0.08 }, { bucket: 'Los Angeles, CA', share: 0.06 }],
      lastSyncedAt: new Date(),
    },
    activeGoal: { type: 'followers', target: 10_000, byDate: '2026-07-01', baseline: 6_300, metricLabel: 'Followers' },
    recentMemories: [],
    seed: 12_345,
  }
}

function stubB(niche: string): PersonalContext {
  return {
    companyId: 'stub-b',
    companyName: 'Stub B',
    niche,
    subNiche: niche === 'fitness' ? 'busy-mom HIIT' : null,
    brandVoice: {},
    audience: {},
    goals: {},
    instagram: {
      handle: 'creator_b',
      source: 'phyllo',
      accountType: 'BUSINESS',
      followerCount: 84_000,
      followingCount: 412,
      postCount: 218,
      engagementRate: 2.1,
      avgReach: 145_000,
      avgImpressions: 180_000,
      topPosts: [
        { caption: 'Why your hormones hate intermittent fasting', likeCount: 26_400, commentCount: 1_810, permalink: null, mediaType: 'REEL' },
        { caption: 'My 4 supplement non-negotiables', likeCount: 12_200, commentCount: 540, permalink: null, mediaType: 'CAROUSEL_ALBUM' },
      ],
      audienceAge: [{ bucket: '35-44', share: 0.48 }, { bucket: '25-34', share: 0.27 }, { bucket: '45-54', share: 0.16 }],
      audienceGender: [{ bucket: 'FEMALE', share: 0.91 }, { bucket: 'MALE', share: 0.09 }],
      audienceTopCountries: [{ bucket: 'US', share: 0.71 }, { bucket: 'AU', share: 0.06 }],
      audienceTopCities: [{ bucket: 'Austin, TX', share: 0.06 }, { bucket: 'Denver, CO', share: 0.04 }],
      lastSyncedAt: new Date(),
    },
    activeGoal: null,
    recentMemories: [],
    seed: 98_765,
  }
}

interface Preset {
  role: AgentRole
  briefKind: string
  title: string
  description: string
  type: OutputType
}

const BRIEFS: Preset[] = [
  // Maya
  { role: 'analyst', briefKind: 'weekly_trends',        type: 'trend_report', title: 'Scan my niche for this week\'s trends', description: 'Top 3 trends.' },
  { role: 'analyst', briefKind: 'competitor_scan',      type: 'trend_report', title: 'Competitor scan — top 3 in my niche', description: 'Three best-performing accounts.' },
  { role: 'analyst', briefKind: 'hashtag_report',       type: 'trend_report', title: 'Which hashtags are actually working', description: '10-15 hashtags in 3 buckets.' },
  { role: 'analyst', briefKind: 'audience_deep_dive',   type: 'trend_report', title: 'Audience deep dive', description: 'Demographics + pillars + one thing to stop.' },
  { role: 'analyst', briefKind: 'engagement_diagnosis', type: 'trend_report', title: 'Why my engagement dropped', description: 'Last two weeks, what changed, one fix.' },
  // Jordan
  { role: 'strategist', briefKind: 'weekly_plan',     type: 'content_plan', title: 'Plan next week\'s content', description: '3-5 posts.' },
  { role: 'strategist', briefKind: 'pillar_rebuild',  type: 'content_plan', title: 'Rebuild my content pillars', description: '3-4 pillars.' },
  { role: 'strategist', briefKind: 'cadence_plan',    type: 'content_plan', title: 'Suggest a posting cadence', description: 'Per-week rhythm.' },
  { role: 'strategist', briefKind: 'ninety_day_plan', type: 'content_plan', title: '90-day growth plan', description: '12 weeks mapped.' },
  { role: 'strategist', briefKind: 'slot_audit',      type: 'content_plan', title: 'Audit what is not working', description: 'Two weakest slots.' },
  // Alex
  { role: 'copywriter', briefKind: 'top_trend_hooks',        type: 'hooks',   title: '5 hooks for this week\'s top trend', description: '5 variations.' },
  { role: 'copywriter', briefKind: 'reel_script_30s',        type: 'script',  title: 'Reel script — 30 seconds', description: 'Cold open + 3 beats + payoff.' },
  { role: 'copywriter', briefKind: 'caption_next_post',      type: 'caption', title: 'Caption for my next post', description: 'Tight, punchy, one CTA.' },
  { role: 'copywriter', briefKind: 'carousel_opening_lines', type: 'hooks',   title: '3 opening lines for a carousel', description: 'Slide 1 hooks.' },
  { role: 'copywriter', briefKind: 'bio_rewrite',            type: 'caption', title: 'Rewrite my bio', description: 'Current niche + audience.' },
  // Riley
  { role: 'creative_director', briefKind: 'reel_shot_list',   type: 'shot_list', title: 'Shot list for next Reel', description: 'Opening + 3-5 mids + close.' },
  { role: 'creative_director', briefKind: 'pacing_notes',     type: 'shot_list', title: 'Pacing notes for an existing cut', description: 'Hold lengths + beat-to-cut.' },
  { role: 'creative_director', briefKind: 'visual_direction', type: 'shot_list', title: 'Visual direction — new aesthetic', description: 'Palette + lighting + shot style.' },
  { role: 'creative_director', briefKind: 'thumbnail_brief',  type: 'shot_list', title: 'Thumbnail brief for a carousel', description: 'Slide-1 spec.' },
  { role: 'creative_director', briefKind: 'fix_weak_reel',    type: 'shot_list', title: 'Fix the weakest Reel of the week', description: 'Reshoot the first 2s.' },
]

const PERSONA: Record<AgentRole, string> = {
  analyst: 'Maya', strategist: 'Jordan', copywriter: 'Alex', creative_director: 'Riley',
}

async function run() {
  const niche = process.argv[2] || 'fitness'
  // Personas: 'a' = small creator with goal, 'b' = larger creator no goal,
  // 'none' = no PersonalContext (graceful-fallback path).
  const persona = process.argv[3] || 'a'
  const personal = persona === 'a' ? stubA(niche) : persona === 'b' ? stubB(niche) : null

  console.log(`\n============================================================`)
  console.log(` Brief audit — niche: ${niche} · persona: ${persona}`)
  if (personal) {
    console.log(` @${personal.instagram?.handle} · ${personal.instagram?.followerCount.toLocaleString()} followers · seed ${personal.seed}`)
  } else {
    console.log(` no PersonalContext (testing graceful fallback)`)
  }
  console.log(`============================================================\n`)

  for (const b of BRIEFS) {
    console.log(`\n────────────────────────────────────────────────────────────`)
    console.log(` ${PERSONA[b.role]} (${b.role}) · ${b.type}`)
    console.log(` Brief: "${b.title}"`)
    console.log(`────────────────────────────────────────────────────────────`)
    try {
      const result = await executeBrief(prisma, {
        taskId: 'test',
        companyId: 'test',
        niche,
        role: b.role,
        type: b.type,
        title: b.title,
        description: b.description,
        briefKind: b.briefKind,
        personal,
      })
      console.log(`  source: ${result.source} · knowledge entries used: ${result.knowledgeUsed}`)
      console.log(`  content:\n${JSON.stringify(result.content, null, 2).split('\n').map((l) => '    ' + l).join('\n')}`)
    } catch (err) {
      console.log(`  ERROR: ${(err as Error).message}`)
    }
  }

  await prisma.$disconnect()
}

run().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
