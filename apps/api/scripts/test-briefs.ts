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

const prisma = new PrismaClient()

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
  console.log(`\n============================================================`)
  console.log(` Brief audit — niche: ${niche}`)
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
