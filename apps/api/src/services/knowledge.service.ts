import { PrismaClient, KnowledgeType, KnowledgeSource } from '@prisma/client'
import { z } from 'zod'

export interface CreateKnowledgeInput {
  type: KnowledgeType
  source: KnowledgeSource
  title: string
  summary: string
  details?: any
  tags?: string[]
  sourceUrl?: string | null
  relevanceScore?: number
}

export type KnowledgeItem = {
  id: string
  companyId: string
  type: KnowledgeType
  source: KnowledgeSource
  title: string
  summary: string
  details: any
  tags: string[]
  sourceUrl: string | null
  relatedItemIds: string[]
  relevanceScore: number
  isArchived: boolean
  createdAt: Date
  updatedAt: Date
}

export interface KnowledgeFilters {
  type?: KnowledgeType
  source?: KnowledgeSource
  tags?: string[]
  archived?: boolean
  limit?: number
  offset?: number
}

/**
 * Extract a usable text summary from a brand_memory content blob without
 * ever returning the literal "[object Object]" String() yields on objects.
 */
function extractMemorySummary(content: Record<string, unknown>): string {
  const candidates = ['summary', 'text', 'note', 'message', 'content']
  for (const key of candidates) {
    const v = content[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  // Last resort: a compact JSON of the blob — never the [object Object] toString
  try {
    const json = JSON.stringify(content)
    if (json && json !== '{}') return json.length > 500 ? json.slice(0, 500) : json
  } catch {
    // ignore
  }
  return ''
}

export class KnowledgeService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Create a new knowledge item
   */
  async createKnowledge(companyId: string, input: CreateKnowledgeInput): Promise<KnowledgeItem> {
    const knowledge = await this.prisma.knowledge.create({
      data: {
        companyId,
        type: input.type,
        source: input.source,
        title: input.title,
        summary: input.summary,
        details: input.details || {},
        tags: input.tags || [],
        sourceUrl: input.sourceUrl,
        relevanceScore:
          input.relevanceScore !== undefined
            ? Math.max(0, Math.min(1, input.relevanceScore))
            : 0.5,
      },
    })
    return knowledge
  }

  /**
   * Get knowledge items for a company with optional filters
   */
  async getKnowledge(companyId: string, filters?: KnowledgeFilters): Promise<KnowledgeItem[]> {
    const where: Record<string, unknown> = { companyId }

    if (filters?.type) where.type = filters.type
    if (filters?.source) where.source = filters.source
    if (filters?.archived !== undefined) where.isArchived = filters.archived
    if (filters?.tags && filters.tags.length > 0) {
      where.tags = { hasSome: filters.tags }
    }

    const items = await this.prisma.knowledge.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filters?.limit || 50,
      skip: filters?.offset || 0,
    })

    return items
  }

  /**
   * Count knowledge items matching the same filters as getKnowledge.
   * Used by routes to return an accurate total alongside a page of items.
   */
  async countKnowledge(companyId: string, filters?: KnowledgeFilters): Promise<number> {
    const where: Record<string, unknown> = { companyId }
    if (filters?.type) where.type = filters.type
    if (filters?.source) where.source = filters.source
    if (filters?.archived !== undefined) where.isArchived = filters.archived
    if (filters?.tags && filters.tags.length > 0) {
      where.tags = { hasSome: filters.tags }
    }
    return this.prisma.knowledge.count({ where })
  }

  /**
   * Get a specific knowledge item
   */
  async getKnowledgeById(id: string, companyId: string): Promise<KnowledgeItem | null> {
    const knowledge = await this.prisma.knowledge.findFirst({
      where: { id, companyId },
    })
    return knowledge
  }

  /**
   * Update a knowledge item
   */
  async updateKnowledge(
    id: string,
    companyId: string,
    updates: Partial<CreateKnowledgeInput> & { isArchived?: boolean }
  ): Promise<KnowledgeItem> {
    // Use updateMany so the companyId scope is enforced atomically at the DB
    // layer (Prisma's `update` does not support multi-field where without a
    // composite unique key). updateMany returns a count; if 0, throw.
    const res = await this.prisma.knowledge.updateMany({
      where: { id, companyId },
      data: {
        ...(updates.title !== undefined && { title: updates.title }),
        ...(updates.summary !== undefined && { summary: updates.summary }),
        ...(updates.details !== undefined && { details: updates.details }),
        ...(updates.tags !== undefined && { tags: updates.tags }),
        ...(updates.sourceUrl !== undefined && { sourceUrl: updates.sourceUrl }),
        ...(updates.relevanceScore !== undefined && {
          relevanceScore: Math.max(0, Math.min(1, updates.relevanceScore)),
        }),
        ...(updates.isArchived !== undefined && { isArchived: updates.isArchived }),
      },
    })
    if (res.count === 0) throw new Error('Knowledge item not found')
    const updated = await this.prisma.knowledge.findFirst({ where: { id, companyId } })
    return updated as KnowledgeItem
  }

  /**
   * Link related knowledge items
   */
  async addRelatedItem(id: string, relatedId: string, companyId: string): Promise<void> {
    // Verify both items belong to the same company
    const [item, relatedItem] = await Promise.all([
      this.prisma.knowledge.findFirst({ where: { id, companyId } }),
      this.prisma.knowledge.findFirst({ where: { id: relatedId, companyId } }),
    ])

    if (!item || !relatedItem) {
      throw new Error('One or both knowledge items not found')
    }

    // Add relationship in both directions (avoid duplicates)
    await this.prisma.$transaction([
      this.prisma.knowledge.update({
        where: { id },
        data: {
          relatedItemIds: Array.from(new Set([...item.relatedItemIds, relatedId])),
        },
      }),
      this.prisma.knowledge.update({
        where: { id: relatedId },
        data: {
          relatedItemIds: Array.from(new Set([...relatedItem.relatedItemIds, id])),
        },
      }),
    ])
  }

  /**
   * Soft-delete a knowledge item by archiving it.
   * (The DELETE route is documented as a soft delete via archive; preserve
   * data so related-item references are not silently orphaned.)
   */
  async deleteKnowledge(id: string, companyId: string): Promise<void> {
    const res = await this.prisma.knowledge.updateMany({
      where: { id, companyId },
      data: { isArchived: true },
    })
    if (res.count === 0) {
      throw new Error('Knowledge item not found')
    }
  }

  /**
   * Permanently delete a knowledge item and clean up references to it
   * from other items' relatedItemIds. Use with care.
   */
  async hardDeleteKnowledge(id: string, companyId: string): Promise<void> {
    const knowledge = await this.prisma.knowledge.findFirst({
      where: { id, companyId },
    })
    if (!knowledge) {
      throw new Error('Knowledge item not found')
    }
    // Strip references from any other item in the same company
    const referencing = await this.prisma.knowledge.findMany({
      where: { companyId, relatedItemIds: { has: id } },
      select: { id: true, relatedItemIds: true },
    })
    await this.prisma.$transaction([
      ...referencing.map((r) =>
        this.prisma.knowledge.update({
          where: { id: r.id },
          data: { relatedItemIds: r.relatedItemIds.filter((x) => x !== id) },
        })
      ),
      this.prisma.knowledge.delete({ where: { id } }),
    ])
  }

  /**
   * Extract insights from feed items and create knowledge
   * This would be called periodically or after new feed items arrive
   */
  async extractInsightsFromFeed(
    companyId: string,
    feedItems: Array<{
      id: string
      title: string
      summary: string
      source: string
      type: string
      mayaTake?: string
      score?: number
    }>
  ): Promise<KnowledgeItem[]> {
    const eligible = feedItems.filter((item) => !(item.score && item.score < 75))
    if (eligible.length === 0) return []

    // Single round-trip dedup: pull all candidate prefixes that already exist
    // in this company so we don't issue one findFirst per feed item.
    const prefixes = eligible.map((i) => i.title.substring(0, 30).toLowerCase())
    const existing = await this.prisma.knowledge.findMany({
      where: { companyId },
      select: { title: true },
    })
    const existingLower = new Set(existing.map((e) => e.title.toLowerCase()))

    const createdItems: KnowledgeItem[] = []
    for (let idx = 0; idx < eligible.length; idx++) {
      const item = eligible[idx]
      const prefix = prefixes[idx]
      const dup = [...existingLower].some((t) => t.includes(prefix))
      if (dup) continue

      const knowledge = await this.createKnowledge(companyId, {
        type: 'trend_summary',
        source: 'feed_item',
        title: item.title,
        summary: item.mayaTake || item.summary,
        details: {
          originalTitle: item.title,
          source: item.source,
          feedType: item.type,
          score: item.score,
        },
        tags: [item.type, item.source.toLowerCase()],
        sourceUrl: undefined,
        relevanceScore: Math.max(0, Math.min(1, (item.score || 75) / 100)),
      })

      createdItems.push(knowledge)
      existingLower.add(item.title.toLowerCase())
    }

    return createdItems
  }

  /**
   * Extract patterns from brand memory and create knowledge
   */
  async extractPatternsFromMemory(companyId: string): Promise<KnowledgeItem[]> {
    const createdItems: KnowledgeItem[] = []

    // Get recent brand memories
    const memories = await this.prisma.brandMemory.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })

    // Pre-fetch existing titles once for cheap dedup
    const existing = await this.prisma.knowledge.findMany({
      where: { companyId, source: 'brand_memory' },
      select: { title: true },
    })
    const existingLower = new Set(existing.map((e) => e.title.toLowerCase()))

    for (const memory of memories) {
      // Only create knowledge from feedback and performance memories
      if (!['feedback', 'performance'].includes(memory.memoryType)) continue

      const content = (memory.content ?? {}) as Record<string, unknown>
      // Pull a usable text payload — never let an object stringify to "[object Object]"
      const summary = extractMemorySummary(content)
      if (!summary) continue

      const candidateTitle = `Learned: ${summary.substring(0, 60)}`
      if ([...existingLower].some((t) => t.includes(candidateTitle.substring(0, 30).toLowerCase()))) {
        continue
      }

      const knowledge = await this.createKnowledge(companyId, {
        type: memory.memoryType === 'feedback' ? 'learning' : 'pattern',
        source: 'brand_memory',
        title: candidateTitle,
        summary,
        details: { ...content, memoryWeight: memory.weight },
        tags: [memory.memoryType],
        relevanceScore: Math.max(0, Math.min(1, memory.weight)),
      })

      createdItems.push(knowledge)
      existingLower.add(candidateTitle.toLowerCase())
    }

    return createdItems
  }

  /**
   * Archive old knowledge items (keep learning fresh)
   */
  async archiveOldKnowledge(
    companyId: string,
    daysOld: number = 90
  ): Promise<number> {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - daysOld)

    const result = await this.prisma.knowledge.updateMany({
      where: {
        companyId,
        createdAt: { lt: cutoffDate },
        isArchived: false,
      },
      data: { isArchived: true },
    })

    return result.count
  }

  /**
   * Search knowledge by keyword
   */
  async searchKnowledge(
    companyId: string,
    query: string,
    limit: number = 20
  ): Promise<KnowledgeItem[]> {
    const items = await this.prisma.knowledge.findMany({
      where: {
        companyId,
        isArchived: false,
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { summary: { contains: query, mode: 'insensitive' } },
          { tags: { has: query.toLowerCase() } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    return items
  }
}

export function createKnowledgeService(prisma: PrismaClient): KnowledgeService {
  return new KnowledgeService(prisma)
}
