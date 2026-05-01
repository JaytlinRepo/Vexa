/**
 * Feed Metrics — measurable quality signals for the Knowledge feed.
 *
 * Pure functions. No I/O. Computes a uniform metrics shape from a list
 * of feed items + the user's profile + their profile embedding. Used by:
 *   - Diagnostics: capture baseline + improvement deltas
 *   - Admin dashboards (future): live monitoring per-company
 *   - CI: regression catches if a code change tanks any metric
 *
 * Metrics ship in three buckets:
 *   1. Pipeline health — coverage rates, throttling, latency
 *   2. Content fit — semantic + categorical similarity to the profile
 *   3. Diversity — guard against creator monoculture in the kept set
 */
import type { CommunityTags } from './communityTagging.service'
import type { FeedContentProfile } from './feedContentProfile.service'
import { cosine } from './feedEmbedding.service'
import { scoreFeedItem, relevanceThreshold } from './feedRelevance.service'

interface ScoredItem {
  id: string
  source?: string | null
  title?: string
  summary?: string
  tags?: CommunityTags | null
  embedding?: number[] | null
}

export interface FeedMetrics {
  // ── 1. Pipeline health ─────────────────────────────────────────
  /** Total items fetched from sources before any filtering. */
  fetched: number
  /** Items that survived the relevance gate. */
  kept: number
  /** kept / fetched (0..1). Sweet spot is 0.4–0.7; <0.2 = too strict, >0.85 = ungated. */
  passThroughRate: number
  /** % of kept items that have a non-null tags object. */
  tagCoverage: number
  /** % of kept items that have a non-null embedding vector. */
  embedCoverage: number

  // ── 2. Content fit ─────────────────────────────────────────────
  /** Average cosine(item.embedding, profile.embedding) across kept items
   *  that have an embedding. Higher is more semantically aligned. */
  avgCosine: number
  /** Lowest cosine in kept set — catches gate leniency. */
  minCosine: number
  /** Categorical match rates against the user's top-3 dominant values. */
  moodMatchRate: number
  styleMatchRate: number
  formatMatchRate: number
  hookMatchRate: number
  audienceMatchRate: number

  // ── 3. Diversity ───────────────────────────────────────────────
  /** Distinct sources / total kept. 1.0 = every kept item from a different
   *  source; <0.5 = monoculture warning. */
  sourceDiversity: number
  /** Largest share any single source has. >0.5 = a single creator/lane
   *  is dominating. */
  topSourceShare: number

  // Convenience for human-readable logs
  threshold: number
}

function pct(matched: number, total: number): number {
  return total === 0 ? 0 : matched / total
}

function categoricalMatchRate(
  items: ScoredItem[],
  pickValue: (t: CommunityTags) => string | undefined,
  userTop: string[],
): number {
  const candidates = items.filter((i) => i.tags)
  if (candidates.length === 0) return 0
  const userSet = new Set(userTop.slice(0, 3).map((v) => v.toLowerCase()))
  let hits = 0
  for (const it of candidates) {
    const v = pickValue(it.tags!)
    if (v && userSet.has(v.toLowerCase())) hits++
  }
  return pct(hits, candidates.length)
}

export function computeFeedMetrics(
  fetchedItems: ScoredItem[],
  profile: FeedContentProfile,
  profileEmbedding: number[] | null,
): FeedMetrics {
  const threshold = relevanceThreshold(profile)
  const kept = fetchedItems.filter((it) => scoreFeedItem(it, profile, profileEmbedding) >= threshold)

  // Pipeline health
  const tagCoverage = pct(kept.filter((i) => i.tags).length, kept.length)
  const embedCoverage = pct(kept.filter((i) => i.embedding).length, kept.length)

  // Content fit
  const cosines: number[] = []
  for (const it of kept) {
    if (it.embedding && profileEmbedding) {
      cosines.push(cosine(it.embedding, profileEmbedding))
    }
  }
  const avgCosine = cosines.length === 0 ? 0 : cosines.reduce((a, b) => a + b, 0) / cosines.length
  const minCosine = cosines.length === 0 ? 0 : Math.min(...cosines)

  const moodMatchRate = categoricalMatchRate(kept, (t) => t.mood, profile.dominantMoods)
  const styleMatchRate = categoricalMatchRate(kept, (t) => t.visualStyle, profile.dominantStyles)
  const formatMatchRate = categoricalMatchRate(kept, (t) => t.format, profile.dominantFormats)
  const hookMatchRate = categoricalMatchRate(kept, (t) => t.hookType, profile.dominantHooks)
  const audienceMatchRate = categoricalMatchRate(kept, (t) => t.audienceType, profile.dominantAudiences)

  // Diversity
  const sourceCounts = new Map<string, number>()
  for (const it of kept) {
    const k = (it.source || 'unknown').toLowerCase()
    sourceCounts.set(k, (sourceCounts.get(k) ?? 0) + 1)
  }
  const sourceDiversity = pct(sourceCounts.size, kept.length)
  const topSourceShare = kept.length === 0
    ? 0
    : Math.max(...[...sourceCounts.values()]) / kept.length

  return {
    fetched: fetchedItems.length,
    kept: kept.length,
    passThroughRate: pct(kept.length, fetchedItems.length),
    tagCoverage,
    embedCoverage,
    avgCosine,
    minCosine,
    moodMatchRate,
    styleMatchRate,
    formatMatchRate,
    hookMatchRate,
    audienceMatchRate,
    sourceDiversity,
    topSourceShare,
    threshold,
  }
}

/**
 * Render a FeedMetrics object as a readable single-string for logs / CLI.
 */
export function formatFeedMetrics(m: FeedMetrics): string {
  const p = (n: number) => (n * 100).toFixed(0) + '%'
  return [
    `fetched=${m.fetched} kept=${m.kept} passThru=${p(m.passThroughRate)} threshold=${m.threshold}`,
    `coverage: tag=${p(m.tagCoverage)} embed=${p(m.embedCoverage)}`,
    `cosine: avg=${m.avgCosine.toFixed(3)} min=${m.minCosine.toFixed(3)}`,
    `match: mood=${p(m.moodMatchRate)} style=${p(m.styleMatchRate)} fmt=${p(m.formatMatchRate)} hook=${p(m.hookMatchRate)} aud=${p(m.audienceMatchRate)}`,
    `diversity: sources=${p(m.sourceDiversity)} topShare=${p(m.topSourceShare)}`,
  ].join('\n  ')
}

/**
 * Quality grade — weighted toward content similarity (the biggest goal).
 *
 * Weights:
 *   cosine        x4   (semantic match — what we ultimately care about)
 *   match         x4   (categorical mood/style/format/hook/audience match)
 *   coverage      x1   (we need data to score, but it's a means)
 *   passThrough   x1   (a sanity check that the gate isn't pathological)
 *   diversity     x0   (excluded — IG hashtag results all share source='Instagram',
 *                       making the metric meaningless until community supply scales)
 */
export function gradeFeedMetrics(m: FeedMetrics): { grade: number; details: Record<string, number> } {
  const coverageScore = Math.min(10, ((m.tagCoverage + m.embedCoverage) / 2) * 11)

  // Pass-through bell curve, sweet spot 0.5
  const passScore = Math.max(0, Math.min(10, (1 - Math.abs(m.passThroughRate - 0.5) * 2) * 10))

  // Cosine: 0.2 floor, 0.6 ceiling. Ramps quickly because content
  // similarity is the headline metric.
  const cosineScore = Math.max(0, Math.min(10, ((m.avgCosine - 0.2) / 0.4) * 10))

  // Categorical match rates — equal-weighted average across the five.
  const matchAvg =
    (m.moodMatchRate +
      m.styleMatchRate +
      m.formatMatchRate +
      m.hookMatchRate +
      m.audienceMatchRate) /
    5
  const matchScore = matchAvg * 10

  const diversityScore = Math.max(0, Math.min(10, (1 - Math.max(0, m.topSourceShare - 0.5)) * 10))

  // Weighted final grade — 4x content similarity, 1x infrastructure
  const grade =
    (cosineScore * 4 + matchScore * 4 + coverageScore + passScore) / 10

  return {
    grade,
    details: {
      cosine: cosineScore,
      match: matchScore,
      coverage: coverageScore,
      passThrough: passScore,
      diversity: diversityScore, // shown for context, not weighted
    },
  }
}
