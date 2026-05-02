/**
 * Feed Relevance Scoring
 *
 * Combines two signals into a single score for ranking + gating:
 *   1. Token overlap (existing logic from feedContentProfile.service.ts —
 *      "does the item share keywords/hashtags with the user's content?")
 *   2. Tag similarity (new — "does the item match the user's mood, visual
 *      style, format, hook, audience?")
 *
 * The combined score lets a strong tag match compensate for weak keyword
 * overlap (and vice versa). Items below the threshold are dropped from
 * the explore feed.
 *
 * No I/O, no Bedrock — pure scoring math. Testable in isolation.
 */
import type { CommunityTags } from './communityTagging.service'
import { relevanceOverlap, type FeedContentProfile } from './feedContentProfile.service'
import { cosine } from './feedEmbedding.service'

/**
 * Score how well an item's mood/style/format/hook/audience tags match the
 * user's dominant fingerprint. Returns 0–10. Pure additive — a perfect
 * mood + style match alone scores 5.5.
 *
 * Coefficients (tuned manually based on which dimensions discriminate
 * best in the diagnostic dataset):
 *   mood     +3.0   (most discriminating — energetic vs motivational
 *                    is a stronger signal than format vs format)
 *   style    +2.5
 *   format   +2.0
 *   hook     +1.5
 *   audience +1.0
 */
export function scoreTagSimilarity(
  itemTags: CommunityTags | null | undefined,
  profile: FeedContentProfile,
): number {
  if (!itemTags) return 0
  let score = 0

  const moods = profile.dominantMoods.slice(0, 3).map((m) => m.toLowerCase())
  if (itemTags.mood && moods.includes(itemTags.mood.toLowerCase())) score += 3.0

  const styles = profile.dominantStyles.slice(0, 3).map((s) => s.toLowerCase())
  if (itemTags.visualStyle && styles.includes(itemTags.visualStyle.toLowerCase())) score += 2.5

  const formats = profile.dominantFormats.slice(0, 3).map((f) => f.toLowerCase())
  if (itemTags.format && formats.includes(itemTags.format.toLowerCase())) score += 2.0

  const hooks = profile.dominantHooks.slice(0, 3).map((h) => h.toLowerCase())
  if (itemTags.hookType && hooks.includes(itemTags.hookType.toLowerCase())) score += 1.5

  const audiences = profile.dominantAudiences.slice(0, 3).map((a) => a.toLowerCase())
  if (itemTags.audienceType && audiences.includes(itemTags.audienceType.toLowerCase())) score += 1.0

  return score
}

/**
 * Score the semantic similarity between an item's embedding and the
 * user's profile embedding via cosine similarity.
 *
 * Titan Embed v2 produces vectors where in-niche similarity typically
 * falls in 0.3–0.8. We linearly remap that range to 0–10 so this
 * component is comparable in scale to the tag and token signals.
 *
 * Returns 0 when either vector is missing (cold-start path, transient
 * Bedrock failure, etc.) — the other signals carry the score in that case.
 */
export function scoreSemanticSimilarity(
  itemEmbedding: number[] | null | undefined,
  profileEmbedding: number[] | null | undefined,
): number {
  if (!itemEmbedding || !profileEmbedding) return 0
  const sim = cosine(itemEmbedding, profileEmbedding)
  return Math.max(0, Math.min(10, ((sim - 0.3) / 0.5) * 10))
}

/**
 * Combined feed-item score. Used both as a ranking signal and as the
 * gate-or-drop threshold.
 *
 * Three additive components, each in roughly comparable [0, ~10] range:
 *   - Token overlap (existing): matched keywords/hashtags/tags
 *   - Tag similarity (existing): mood/style/format/hook/audience match
 *   - Semantic similarity (new): cosine(itemEmbedding, profileEmbedding)
 *
 * Any component returns 0 when its inputs are missing, so cold-start
 * profiles (no embedding) and IG items pre-tagging still get scored.
 */
export function scoreFeedItem(
  item: {
    title?: string
    summary?: string
    source?: string | null
    tags?: CommunityTags | null
    embedding?: number[] | null
  },
  profile: FeedContentProfile,
  profileEmbedding: number[] | null = null,
): number {
  const blob = `${item.title ?? ''} ${item.summary ?? ''} ${item.source ?? ''}`
  const tokenScore = relevanceOverlap(blob, profile)
  const tagScore = scoreTagSimilarity(item.tags ?? null, profile)
  const semanticScore = scoreSemanticSimilarity(item.embedding ?? null, profileEmbedding)
  return tokenScore + tagScore + semanticScore
}

/**
 * Threshold below which a feed item is dropped. Cold-start users (thin or
 * empty profile) always pass through. Rich profiles use 5.0 once the
 * embedding signal is available (the new third component bumps the
 * comfortable range up from the tag-only world's 3.0).
 */
export function relevanceThreshold(profile: FeedContentProfile): number {
  if (profile.strength !== 'rich') return 0
  return 5.0
}
