/**
 * Niche Knowledge — RAG layer for the agents.
 *
 * Each agent (Maya / Jordan / Alex / Riley) pulls a small, ranked subset
 * of niche-specific knowledge entries when building a prompt. The result
 * is injected into the system prompt so the agent reasons from the
 * creator's actual lane instead of generic LLM defaults.
 *
 * Retrieval is currently keyword + tag scoring on Postgres rows. An
 * `embedding` column is reserved for a future swap to pgvector / Bedrock
 * embeddings without a schema or call-site change.
 *
 * Niches are matched by substring so 'Fitness & Wellness',
 * 'health+fitness', etc. all resolve to the 'fitness' bucket.
 */
import { PrismaClient, NicheKnowledgeKind, NicheKnowledge } from '@prisma/client'

export type AgentRole = 'analyst' | 'strategist' | 'copywriter' | 'creative_director'

const NICHE_ALIASES: Array<{ match: RegExp; bucket: string }> = [
  { match: /fit|gym|health|wellness|workout|trainer|yoga|pilates/i, bucket: 'fitness' },
  { match: /financ|money|invest|wealth|bank|budget|debt|tax/i,     bucket: 'finance' },
  { match: /food|chef|cook|recipe|bakery|nutrition|diet/i,         bucket: 'food' },
  { match: /coach|consult|executive|career|leadership|mindset/i,   bucket: 'coaching' },
  { match: /lifestyle|fashion|beauty|home|travel|parenting/i,      bucket: 'lifestyle' },
]

export function bucketForNiche(niche: string | null | undefined): string {
  if (!niche) return 'default'
  for (const { match, bucket } of NICHE_ALIASES) {
    if (match.test(niche)) return bucket
  }
  return 'default'
}

/**
 * Default kinds each agent role cares about. Used when the caller does
 * not specify a kinds filter.
 */
const KINDS_BY_ROLE: Record<AgentRole, NicheKnowledgeKind[]> = {
  analyst: ['format_signal', 'audience', 'competitor_archetype', 'pillar'],
  strategist: ['pillar', 'cadence', 'framework', 'audience'],
  copywriter: ['hook_pattern', 'language', 'audience', 'taboo'],
  creative_director: ['format_signal', 'framework', 'taboo'],
}

interface RetrieveOptions {
  niche: string
  role?: AgentRole
  kinds?: NicheKnowledgeKind[]
  query?: string         // free-text query (the user's message, the brief title, etc.)
  limit?: number
  /** When true, fall back to the 'default' bucket if niche bucket is empty. */
  fallbackToDefault?: boolean
}

/**
 * Score an entry against a free-text query. Simple but predictable:
 *  +3  for each tag that appears as a substring of the query
 *  +2  for each title word (3+ chars) appearing in the query
 *  +1  for each title word appearing in the body
 *  + entry.weight (so curated entries can be biased)
 *
 * Even with no query, results are returned ranked by weight so callers
 * still get a stable curated set.
 */
function scoreEntry(entry: NicheKnowledge, query: string | undefined): number {
  let score = entry.weight
  const q = (query || '').toLowerCase()
  if (q) {
    for (const tag of entry.tags) {
      if (q.includes(tag.toLowerCase())) score += 3
    }
    const titleWords = entry.title.toLowerCase().split(/\W+/).filter((w) => w.length >= 3)
    for (const w of titleWords) {
      if (q.includes(w)) score += 2
    }
  }
  return score
}

export async function retrieveNicheKnowledge(
  prisma: PrismaClient,
  opts: RetrieveOptions,
): Promise<NicheKnowledge[]> {
  const bucket = bucketForNiche(opts.niche)
  const kinds = opts.kinds || (opts.role ? KINDS_BY_ROLE[opts.role] : undefined)
  const limit = opts.limit ?? 8
  const where = {
    niche: bucket,
    ...(kinds ? { kind: { in: kinds } } : {}),
    ...(opts.role ? { OR: [{ forRoles: { has: opts.role } }, { forRoles: { isEmpty: true } }] } : {}),
  }
  // Resilience: if the NicheKnowledge table doesn't exist yet (schema
  // pushed but seed not run, or db:push not run on an old dev DB), we
  // return an empty list rather than throwing — the agents still work
  // with just memory + platform data.
  let entries: NicheKnowledge[] = []
  try {
    entries = await prisma.nicheKnowledge.findMany({ where, take: 200 })
    if (entries.length === 0 && opts.fallbackToDefault && bucket !== 'default') {
      entries = await prisma.nicheKnowledge.findMany({
        where: { ...where, niche: 'default' },
        take: 200,
      })
    }
  } catch (err) {
    console.warn('[nicheKnowledge] retrieval failed (table missing? seed not run?)', (err as Error)?.message)
    return []
  }

  return entries
    .map((e) => ({ entry: e, score: scoreEntry(e, opts.query) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.entry)
}

/**
 * Format retrieved entries into a prompt-ready block. Designed to drop
 * straight into a Bedrock system prompt under a clearly-labeled section.
 */
export function formatNicheKnowledgeForPrompt(entries: NicheKnowledge[], niche: string): string {
  if (entries.length === 0) return ''
  const bucket = bucketForNiche(niche)
  const lines = entries.map((e) => {
    const head = `[${e.kind}] ${e.title}`
    return `- ${head}\n  ${e.body.replace(/\n+/g, ' ').trim()}`
  })
  return `

--- Niche knowledge (${bucket}) ---
The following has been curated by the team for this creator's niche. Reason
from these patterns when forming your response. Do not name the knowledge
base; just sound like someone who knows the lane.
${lines.join('\n')}
--- End niche knowledge ---`
}

/**
 * Convenience: retrieve + format in one call.
 */
export async function nicheKnowledgeBlock(
  prisma: PrismaClient,
  opts: RetrieveOptions,
): Promise<string> {
  const entries = await retrieveNicheKnowledge(prisma, { ...opts, fallbackToDefault: true })
  return formatNicheKnowledgeForPrompt(entries, opts.niche)
}
