/**
 * Hybrid Intelligence Service
 *
 * Entry point for the intelligence layer. Combines:
 * 1. Heuristics — platform best-practice rules
 * 2. Analytics — company-specific performance data
 * 3. AI Synthesis — Bedrock merges signals into actionable report
 *
 * Results are cached for 6 hours per company.
 */

import { PrismaClient } from '@prisma/client'
import { evaluateHeuristics, type HeuristicSignal } from './heuristics'
import { computeAnalytics, type AnalyticsSignal } from './analytics'
import { invokeAgent, parseAgentOutput } from '../bedrock/bedrock.service'

export interface IntelligenceReport {
  summary: string                    // 2-3 sentence overview
  recommendations: string[]         // actionable items for agents
  bestFormats: string[]              // top performing content types
  bestTimes: string[]                // optimal posting windows
  contentGaps: string[]             // topics not covered enough
  audienceInsights: string[]        // what the audience responds to
  heuristicSignals: HeuristicSignal[]
  analytics: AnalyticsSignal
  generatedAt: string
}

// In-memory cache (6h TTL)
const reportCache = new Map<string, { report: IntelligenceReport; ts: number }>()
const CACHE_TTL = 6 * 60 * 60 * 1000

export async function getIntelligenceReport(
  prisma: PrismaClient,
  companyId: string,
  context?: { platform?: string; mediaType?: string },
): Promise<IntelligenceReport> {
  // Check cache
  const cached = reportCache.get(companyId)
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.report
  }

  // Compute analytics
  const analytics = await computeAnalytics(prisma, companyId)

  // Evaluate heuristics
  const heuristics = evaluateHeuristics({
    platform: context?.platform || 'instagram',
    mediaType: context?.mediaType || 'REEL',
    captionLength: 80,
    hasQuestion: analytics.hookEffectiveness.question > analytics.hookEffectiveness.statement,
    postingHour: analytics.bestPostingHours[0],
  })

  // AI synthesis — merge heuristics + analytics into report
  const raw = await invokeAgent({
    systemPrompt: `You synthesize performance data and best practices into actionable intelligence for content creators.
Return ONLY valid JSON:
{
  "summary": "2-3 sentence overview of the creator's current position",
  "recommendations": ["3-5 specific, actionable items"],
  "bestFormats": ["top 2-3 content formats"],
  "bestTimes": ["optimal posting windows as human-readable strings"],
  "contentGaps": ["2-3 topics or formats they should try"],
  "audienceInsights": ["2-3 observations about what their audience responds to"]
}`,
    messages: [{
      role: 'user',
      content: `Creator analytics (last 30 days):
- Avg engagement rate: ${(analytics.avgEngagementRate * 100).toFixed(2)}%
- Avg save rate: ${(analytics.avgSaveRate * 100).toFixed(2)}%
- Content velocity: ${analytics.contentVelocity.toFixed(1)} posts/week
- Audience growth: ${analytics.audienceGrowthRate.toFixed(0)} followers/week
- Top themes: ${analytics.topContentThemes.join(', ') || 'no data'}
- Best posting hours (UTC): ${analytics.bestPostingHours.join(', ') || 'no data'}
- Format ranking: ${analytics.formatRanking.map((f) => `${f.format}: ${(f.avgEngagement * 100).toFixed(1)}%`).join(', ')}
- Hook effectiveness: questions=${(analytics.hookEffectiveness.question * 100).toFixed(1)}%, statements=${(analytics.hookEffectiveness.statement * 100).toFixed(1)}%

Platform heuristics:
${heuristics.filter((h) => h.applies).map((h) => `- ${h.suggestion}`).join('\n')}

Generate an intelligence report.`,
    }],
    maxTokens: 512,
    temperature: 0.4,
    companyId,
  })

  const parsed = parseAgentOutput<Omit<IntelligenceReport, 'heuristicSignals' | 'analytics' | 'generatedAt'>>(raw)

  const report: IntelligenceReport = {
    ...parsed,
    recommendations: parsed.recommendations || [],
    bestFormats: parsed.bestFormats || [],
    bestTimes: parsed.bestTimes || [],
    contentGaps: parsed.contentGaps || [],
    audienceInsights: parsed.audienceInsights || [],
    heuristicSignals: heuristics,
    analytics,
    generatedAt: new Date().toISOString(),
  }

  // Cache
  reportCache.set(companyId, { report, ts: Date.now() })

  return report
}
