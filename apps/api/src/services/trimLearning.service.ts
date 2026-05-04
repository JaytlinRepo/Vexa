/**
 * Trim-Learning Aggregator
 *
 * Reads VideoClip rows where the user re-cut Riley's segments and
 * derives preference signals:
 *   - dropPatterns: which segment-label keywords get dropped most often
 *   - preferredCutSpeed: average length of segments the user keeps
 *   - droppedEnergyDistribution: which energies (hook/high/medium) get dropped
 *
 * Output is stored in brand_memory (memoryType=preference,
 * source=trim_learning) so it lives alongside the platform-derived style
 * profile without overwriting it. clipAnalyzer reads both and merges.
 *
 * Run nightly via the content-analysis worker. Safe to re-run — it
 * recomputes from the last N edited clips each time.
 */

import type { PrismaClient } from '@prisma/client'

const SAMPLE_SIZE = 30 // last N clips per company
// Keep stop-words out of label-keyword extraction. Labels like
// "woman drinks from cup" should yield ['woman', 'drinks', 'cup'],
// not contribute every "from" / "the" / "a" to the drop signal.
const STOP_WORDS = new Set<string>([
  'a', 'an', 'and', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is',
  'it', 'of', 'on', 'or', 'that', 'the', 'to', 'with', 'into', 'over',
  'this', 'these', 'their', 'her', 'his', 'its', 'as', 'has', 'had',
  'are', 'was', 'were', 'while', 'after', 'before', 'during',
])

/**
 * Minimum total kept-edited clips before we publish a profile.
 * 1 = learn from a single recut. Riley merges this with what she
 * already knows (style profile, prior trim-learning memory) so a
 * small sample is fine — it's a Bayesian update, not a replacement.
 */
const MIN_EDITED_CLIPS = 1

type Segment = {
  startTime: number
  endTime: number
  label?: string
  energy?: string
}

export interface TrimLearningProfile {
  /** Total clips analyzed (with userEditedSegments set). */
  editedClipCount: number
  /** Total segments seen across those clips. */
  totalSegmentsSeen: number
  /** How many were dropped vs kept. */
  totalSegmentsDropped: number
  /** How many were kept BUT trimmed shorter (start or end shifted >0.2s inward). */
  totalSegmentsTrimmed: number
  /** How many were kept AND extended longer than Riley's pick. */
  totalSegmentsExtended: number
  /** Average duration of segments the user KEPT — overrides platform avg if reliable. */
  preferredCutSpeed: number | null
  /** Average segments-per-reel the user actually wants. */
  preferredSegmentCount: number | null
  /**
   * Average trim ratio = userKeptDuration / rileyChosenDuration, computed
   * over kept-but-trimmed segments. <1.0 means user shortens; >1.0 isn't
   * possible (we clamp to original bounds), so the value lives in (0, 1].
   * null only when no trimmed segments exist.
   */
  trimRatio: number | null
  /**
   * Per-energy trim ratio so Riley can react differently for hook /
   * high / medium-energy moments. null per bucket only when the bucket
   * is empty.
   */
  trimRatioByEnergy: { hook: number | null; high: number | null; medium: number | null }
  /**
   * Front-trim vs back-trim preference. >0.5 = "user trims from the
   * START more often" (Riley should be more aggressive about lead-in
   * skip). <0.5 = "user trims from the END more often" (Riley should
   * pull endTime in earlier). null when no trims yet.
   */
  frontTrimRate: number | null
  /** Sorted list of label keywords that get dropped at >50% rate. */
  dropPatterns: string[]
  /**
   * Sorted list of label keywords that get TRIMMED (kept but shortened)
   * — different signal from dropPatterns. Tells Riley which subjects
   * deserve shorter coverage but still belong in the reel.
   */
  trimPatterns: string[]
  /** Drop rate by energy bucket (0..1). null when bucket is empty. */
  dropRateByEnergy: { hook: number | null; high: number | null; medium: number | null }
  /** ISO timestamp of when this was computed. */
  computedAt: string
}

function tokenizeLabel(label: string | undefined): string[] {
  if (!label) return []
  return label
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
}

/**
 * Compute the trim-learning profile for one company. Pulls the most
 * recent SAMPLE_SIZE clips that have userEditedSegments set, diffs each
 * against the original adjustments.segments, and aggregates.
 */
export async function computeTrimLearning(
  prisma: PrismaClient,
  companyId: string,
): Promise<TrimLearningProfile | null> {
  // Only learn from clips the user actually KEPT.
  // "Kept" = visual approval, OR the clip was downloaded / posted.
  //   - visualApprovalStatus = 'approved'  → user clicked Approve
  //   - status in ('posted', 'archived')   → clip made it past the
  //     approval card to be shipped or saved
  // Drafts / pending / rejected clips are excluded: a user who edits
  // but doesn't keep the result was experimenting, and that's noise.
  const clips = await prisma.videoClip.findMany({
    where: {
      companyId,
      userEditedSegments: { not: undefined as any },
      OR: [
        { visualApprovalStatus: 'approved' },
        { status: { in: ['posted', 'archived'] } },
      ],
    },
    orderBy: { userEditedAt: 'desc' },
    take: SAMPLE_SIZE,
    select: {
      id: true,
      adjustments: true,
      userEditedSegments: true,
    },
  })

  if (clips.length < MIN_EDITED_CLIPS) return null

  // Anything beyond this threshold (in seconds) on a side counts as
  // a deliberate trim. Smaller deltas are likely rounding/snap noise.
  const TRIM_EPSILON = 0.2

  let totalSegmentsSeen = 0
  let totalSegmentsDropped = 0
  let totalSegmentsTrimmed = 0
  let totalSegmentsExtended = 0
  // keyword → { dropped, total, trimmed }
  const keywordCounts = new Map<string, { dropped: number; total: number; trimmed: number }>()
  // energy → { dropped, total, trimmed, ratioSum, ratioN }
  const energyCounts: Record<string, { dropped: number; total: number; trimmed: number; ratioSum: number; ratioN: number }> = {
    hook: { dropped: 0, total: 0, trimmed: 0, ratioSum: 0, ratioN: 0 },
    high: { dropped: 0, total: 0, trimmed: 0, ratioSum: 0, ratioN: 0 },
    medium: { dropped: 0, total: 0, trimmed: 0, ratioSum: 0, ratioN: 0 },
  }
  // Front-trim vs back-trim signals (only counted when the segment was
  // actually trimmed on at least one side).
  let frontTrimCount = 0
  let backTrimCount = 0
  // Aggregate trim ratio across all trimmed segments (any energy).
  let trimRatioSum = 0
  let trimRatioN = 0
  // For preferred cut speed — average length of KEPT segments.
  let keptDurationSum = 0
  let keptSegmentCount = 0
  let keptReelCount = 0
  // Counts only clips that contributed to the aggregate (had ≥1 kept
  // segment). The query result `clips.length` includes corrupt rows we
  // skip via the empty-kept guard, so we tally separately for the
  // emitted editedClipCount.
  let processedClipCount = 0

  for (const clip of clips) {
    const adj = (clip.adjustments as any) ?? {}
    const original: Segment[] = Array.isArray(adj.segments) ? adj.segments : []
    const kept = (Array.isArray(clip.userEditedSegments) ? (clip.userEditedSegments as any[]) : [])
      .map((k) => ({
        // index was added in Tier 2 — older entries don't have it; fall
        // back to start-time match below.
        index: typeof k.index === 'number' ? (k.index as number) : null,
        startTime: Number(k.startTime),
        endTime: Number(k.endTime),
      }))
    if (original.length === 0) continue
    // Defensive: a clip with ZERO kept segments isn't a valid edit
    // signal — it's either corrupt data or a legacy row that bypassed
    // the recut endpoint's "≥2 kept" check. Counting it would inflate
    // the drop signal with noise (every original counts as dropped).
    // The recut endpoint already rejects these on creation; this is
    // belt-and-suspenders for historical rows.
    if (kept.length === 0) continue
    processedClipCount++

    // Build per-original-index map of kept entries. Prefer explicit
    // index match (Tier 2); fall back to start-time match (Tier 1).
    const keptByIdx = new Map<number, { startTime: number; endTime: number }>()
    for (const k of kept) {
      if (k.index !== null && k.index >= 0 && k.index < original.length) {
        keptByIdx.set(k.index, { startTime: k.startTime, endTime: k.endTime })
      } else {
        // Tier-1 fallback: find by start-time proximity (≤0.05s).
        const idx = original.findIndex(
          (o) => Math.abs(Number(o.startTime) - k.startTime) <= 0.05,
        )
        if (idx >= 0 && !keptByIdx.has(idx)) {
          keptByIdx.set(idx, { startTime: k.startTime, endTime: k.endTime })
        }
      }
    }

    for (let i = 0; i < original.length; i++) {
      const seg = original[i]
      totalSegmentsSeen++
      const keptEntry = keptByIdx.get(i)
      const wasDropped = !keptEntry
      const energyKey = (seg.energy || 'medium').toLowerCase()
      const energy = energyCounts[energyKey]

      if (wasDropped) totalSegmentsDropped++
      if (energy) {
        energy.total++
        if (wasDropped) energy.dropped++
      }

      // Trim/extend detection. Bounds can move IN (trim) or OUT
      // (extend) past Riley's pick. Both are kept-with-edits, but
      // they're opposite signals — Riley should react differently
      // ("be tighter" vs "show more").
      if (keptEntry) {
        const origLen = Number(seg.endTime) - Number(seg.startTime)
        const newLen = keptEntry.endTime - keptEntry.startTime
        // Positive delta = trim (kept tighter than Riley)
        // Negative delta = extend (kept wider than Riley)
        const frontDelta = keptEntry.startTime - Number(seg.startTime)
        const backDelta = Number(seg.endTime) - keptEntry.endTime
        const wasTrimmed =
          frontDelta > TRIM_EPSILON || backDelta > TRIM_EPSILON
        const wasExtended =
          frontDelta < -TRIM_EPSILON || backDelta < -TRIM_EPSILON
        if (wasTrimmed && origLen > 0 && newLen <= origLen) {
          totalSegmentsTrimmed++
          const ratio = Math.max(0, Math.min(1, newLen / origLen))
          trimRatioSum += ratio
          trimRatioN++
          if (energy) {
            energy.trimmed++
            energy.ratioSum += ratio
            energy.ratioN++
          }
          if (frontDelta > TRIM_EPSILON) frontTrimCount++
          if (backDelta > TRIM_EPSILON) backTrimCount++
        } else if (wasExtended && origLen > 0) {
          // Net extension. Counted separately so it doesn't pull the
          // trim ratio < 1 (which would tell Riley to cut even tighter
          // — wrong signal). Future: emit an extendRatio + matching
          // pattern detection if this bucket fills up.
          totalSegmentsExtended++
        }
      }

      // Label tokens — count both drops and (kept-but-trimmed) hits per word.
      for (const tok of tokenizeLabel(seg.label)) {
        const cur = keywordCounts.get(tok) ?? { dropped: 0, total: 0, trimmed: 0 }
        cur.total++
        if (wasDropped) cur.dropped++
        else if (keptEntry) {
          // Did this segment get trimmed?
          const fd = keptEntry.startTime - Number(seg.startTime)
          const bd = Number(seg.endTime) - keptEntry.endTime
          if (fd > TRIM_EPSILON || bd > TRIM_EPSILON) cur.trimmed++
        }
        keywordCounts.set(tok, cur)
      }
    }

    if (kept.length > 0) {
      keptReelCount++
      for (const k of kept) {
        const dur = Math.max(0, k.endTime - k.startTime)
        keptDurationSum += dur
        keptSegmentCount++
      }
    }
  }

  // Drop patterns: keywords dropped >50% of the time. Trim patterns:
  // kept-but-trimmed >50% of NON-DROPPED occurrences. Sample-size
  // gates removed — Riley uses the existing style profile as the
  // baseline and treats this as a Bayesian update, so even a single
  // sighting is worth surfacing. Risk: a one-off label may dominate
  // until more recuts arrive. We accept that trade for fast learning.
  const dropPatterns: { word: string; rate: number; total: number }[] = []
  const trimPatterns: { word: string; rate: number; total: number }[] = []
  for (const [word, c] of keywordCounts) {
    if (c.total < 1) continue
    const dropRate = c.dropped / c.total
    if (dropRate > 0.5) dropPatterns.push({ word, rate: dropRate, total: c.total })
    const keptOccurrences = c.total - c.dropped
    if (keptOccurrences >= 1 && c.trimmed / keptOccurrences > 0.5) {
      trimPatterns.push({ word, rate: c.trimmed / keptOccurrences, total: keptOccurrences })
    }
  }
  dropPatterns.sort((a, b) => b.rate - a.rate || b.total - a.total)
  trimPatterns.sort((a, b) => b.rate - a.rate || b.total - a.total)

  // Per-energy rates — emitted as soon as ANY segment landed in the
  // bucket. Same Bayesian-update philosophy as the headline metrics.
  const dropRateByEnergy: TrimLearningProfile['dropRateByEnergy'] = {
    hook: energyCounts.hook.total >= 1 ? energyCounts.hook.dropped / energyCounts.hook.total : null,
    high: energyCounts.high.total >= 1 ? energyCounts.high.dropped / energyCounts.high.total : null,
    medium: energyCounts.medium.total >= 1 ? energyCounts.medium.dropped / energyCounts.medium.total : null,
  }

  // Trim ratio per energy bucket — average kept/orig length over
  // trimmed segments only (untrimmed kept segments excluded so the
  // metric reflects trimming behavior, not Riley's average length).
  const trimRatioByEnergy: TrimLearningProfile['trimRatioByEnergy'] = {
    hook: energyCounts.hook.ratioN >= 1 ? Number((energyCounts.hook.ratioSum / energyCounts.hook.ratioN).toFixed(2)) : null,
    high: energyCounts.high.ratioN >= 1 ? Number((energyCounts.high.ratioSum / energyCounts.high.ratioN).toFixed(2)) : null,
    medium: energyCounts.medium.ratioN >= 1 ? Number((energyCounts.medium.ratioSum / energyCounts.medium.ratioN).toFixed(2)) : null,
  }

  // Headline metrics emit as soon as we have anything to report.
  // frontTrimRate: of trimmed sides, what fraction were the START.
  // A segment trimmed on both sides counts in both numerator and
  // denominator, so the rate isn't a strict proportion — but it's
  // still informative ("usually trims front" vs "usually trims back").
  const trimRatio = trimRatioN >= 1 ? Number((trimRatioSum / trimRatioN).toFixed(2)) : null
  const totalTrimSides = frontTrimCount + backTrimCount
  const frontTrimRate = totalTrimSides >= 1
    ? Number((frontTrimCount / totalTrimSides).toFixed(2))
    : null

  const preferredCutSpeed = keptSegmentCount >= 1
    ? Number((keptDurationSum / keptSegmentCount).toFixed(2))
    : null
  const preferredSegmentCount = keptReelCount >= 1
    ? Math.round(keptSegmentCount / keptReelCount)
    : null

  // If every clip in the query was empty-kept (corrupt) we have
  // nothing to learn from — return null and let Riley fall back to
  // platform-derived style only.
  if (processedClipCount === 0) return null

  return {
    editedClipCount: processedClipCount,
    totalSegmentsSeen,
    totalSegmentsDropped,
    totalSegmentsTrimmed,
    totalSegmentsExtended,
    preferredCutSpeed,
    preferredSegmentCount,
    trimRatio,
    trimRatioByEnergy,
    frontTrimRate,
    dropPatterns: dropPatterns.slice(0, 12).map((p) => p.word),
    trimPatterns: trimPatterns.slice(0, 12).map((p) => p.word),
    dropRateByEnergy,
    computedAt: new Date().toISOString(),
  }
}

/**
 * Persist the profile to brand_memory. Upserts on
 * (companyId, memoryType=preference, source=trim_learning).
 */
export async function saveTrimLearning(
  prisma: PrismaClient,
  companyId: string,
  profile: TrimLearningProfile,
): Promise<void> {
  // Cast to Prisma's InputJsonValue: the profile is plain data (numbers,
  // strings, arrays, simple objects) so this is safe — TS just can't
  // verify it through the generic Record<string, unknown>.
  const content = { source: 'trim_learning', ...profile } as unknown as object
  const existing = await prisma.brandMemory.findFirst({
    where: {
      companyId,
      memoryType: 'preference',
      content: { path: ['source'], equals: 'trim_learning' },
    },
  })
  if (existing) {
    await prisma.brandMemory.update({
      where: { id: existing.id },
      data: { content: content as any },
    })
  } else {
    await prisma.brandMemory.create({
      data: { companyId, memoryType: 'preference', content: content as any, weight: 1.0 },
    })
  }
}

/**
 * Read the most recent trim-learning profile for a company. Returns
 * null when the company hasn't been analyzed yet (or hasn't trimmed
 * enough clips to clear MIN_EDITED_CLIPS).
 */
export async function getTrimLearning(
  prisma: PrismaClient,
  companyId: string,
): Promise<TrimLearningProfile | null> {
  const memory = await prisma.brandMemory.findFirst({
    where: {
      companyId,
      memoryType: 'preference',
      content: { path: ['source'], equals: 'trim_learning' },
    },
  })
  if (!memory) return null
  const { source: _src, ...rest } = (memory.content as Record<string, unknown>) ?? {}
  return rest as unknown as TrimLearningProfile
}

/**
 * Top-level entry point used by the content-analysis worker. Aggregates
 * all companies that have at least one user-edited clip in the last 30
 * days — keeps the cron lean. Returns the count for logging.
 */
export async function runTrimLearningForAllCompanies(
  prisma: PrismaClient,
): Promise<{ companies: number; profiles: number }> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  // Same approval gate as the per-company aggregator — only fan out to
  // companies that have at least one KEPT edited clip recently
  // (approved, posted, or archived). Skipping companies with
  // edits-but-no-approvals avoids learning from abandoned experiments.
  const companyRows = await prisma.videoClip.findMany({
    where: {
      userEditedAt: { gte: since },
      OR: [
        { visualApprovalStatus: 'approved' },
        { status: { in: ['posted', 'archived'] } },
      ],
    },
    select: { companyId: true },
    distinct: ['companyId'],
  })
  let profiles = 0
  for (const { companyId } of companyRows) {
    try {
      const profile = await computeTrimLearning(prisma, companyId)
      if (profile) {
        await saveTrimLearning(prisma, companyId, profile)
        profiles++
        console.log(
          `[trim-learning] ${companyId}: ${profile.editedClipCount} edited clips, drop rate ${(profile.totalSegmentsDropped / Math.max(1, profile.totalSegmentsSeen) * 100).toFixed(1)}%, patterns=${profile.dropPatterns.length}`,
        )
      }
    } catch (err) {
      console.warn(`[trim-learning] failed for ${companyId}:`, (err as Error).message)
    }
  }
  return { companies: companyRows.length, profiles }
}
