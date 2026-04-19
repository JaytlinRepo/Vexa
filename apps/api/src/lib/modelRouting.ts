/**
 * Model routing — assigns the right Bedrock model to each task type.
 *
 * Strategy:
 * - Sonnet: meetings, performance reviews, growth strategy (high accuracy needed)
 * - Haiku: hooks, scripts, captions, scheduled tasks (speed + cost)
 *
 * Sonnet costs ~5x more than Haiku per call but follows complex
 * instructions accurately — critical for data-citing conversations
 * where the CEO can verify every number.
 */

export type ModelTier = 'fast' | 'accurate' | 'premium'

export const MODELS: Record<ModelTier, string> = {
  fast: process.env.BEDROCK_MODEL_FAST || 'anthropic.claude-3-haiku-20240307-v1:0',
  accurate: process.env.BEDROCK_MODEL_ACCURATE || 'us.anthropic.claude-sonnet-4-20250514-v1:0',
  premium: process.env.BEDROCK_MODEL_PREMIUM || 'us.anthropic.claude-sonnet-4-20250514-v1:0',
}

// Which model tier to use for each context
const ROUTING: Record<string, ModelTier> = {
  // Meetings — user is verifying data in real-time, accuracy is critical
  meeting: 'accurate',

  // Analysis tasks — accuracy matters for trust
  performance_review: 'accurate',
  weekly_pulse: 'accurate',
  growth_strategy: 'accurate',
  content_audit: 'accurate',
  competitor_analysis: 'accurate',

  // Creative tasks — speed matters, output is reviewed before use
  trend_analysis: 'fast',
  content_planning: 'fast',
  content_plan: 'fast',
  plan_adjustment: 'fast',
  hook_writing: 'fast',
  script_writing: 'fast',
  caption_writing: 'fast',
  trend_hooks: 'fast',
  shot_list: 'fast',
  upload_review: 'fast',
  feed_audit: 'fast',
  format_analysis: 'fast',
}

export function getModelForTask(taskType: string): string {
  const tier = ROUTING[taskType] || 'fast'
  return MODELS[tier]
}

export function getModelForMeeting(): string {
  return MODELS.accurate
}

export function getModelTier(taskType: string): ModelTier {
  return ROUTING[taskType] || 'fast'
}
