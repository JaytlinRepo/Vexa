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
        relevanceScore: input.relevanceScore ?? 0.5,
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

    // For tags filtering, we'd need a more complex query
    const items = await this.prisma.knowledge.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filters?.limit || 50,
      skip: filters?.offset || 0,
    })

    // Filter by tags if specified
    if (filters?.tags && filters.tags.length > 0) {
      return items.filter((item) =>
        filters.tags!.some((tag) => item.tags.includes(tag))
      )
    }

    return items
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
    const knowledge = await this.prisma.knowledge.update({
      where: { id },
      data: {
        ...(updates.title && { title: updates.title }),
        ...(updates.summary && { summary: updates.summary }),
        ...(updates.details !== undefined && { details: updates.details }),
        ...(updates.tags && { tags: updates.tags }),
        ...(updates.sourceUrl !== undefined && { sourceUrl: updates.sourceUrl }),
        ...(updates.relevanceScore !== undefined && { relevanceScore: updates.relevanceScore }),
        ...(updates.isArchived !== undefined && { isArchived: updates.isArchived }),
      },
    })
    return knowledge
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

    // Add relationship (avoid duplicates)
    const updated = await this.prisma.knowledge.update({
      where: { id },
      data: {
        relatedItemIds: Array.from(new Set([...item.relatedItemIds, relatedId])),
      },
    })
  }

  /**
   * Delete a knowledge item
   */
  async deleteKnowledge(id: string, companyId: string): Promise<void> {
    const knowledge = await this.prisma.knowledge.findFirst({
      where: { id, companyId },
    })
    if (!knowledge) {
      throw new Error('Knowledge item not found')
    }
    await this.prisma.knowledge.delete({ where: { id } })
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
    const createdItems: KnowledgeItem[] = []

    for (const item of feedItems) {
      // Only create knowledge for high-signal items (score > 75)
      if (item.score && item.score < 75) continue

      // Skip if similar knowledge already exists (title similarity check)
      const existing = await this.prisma.knowledge.findFirst({
        where: {
          companyId,
          title: { contains: item.title.substring(0, 30), mode: 'insensitive' },
        },
      })

      if (existing) continue

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
        relevanceScore: Math.min(1, (item.score || 75) / 100),
      })

      createdItems.push(knowledge)
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

    for (const memory of memories) {
      const content = memory.content as Record<string, unknown>
      const summary = String(content.summary || content)

      // Only create knowledge from feedback and performance memories
      if (!['feedback', 'performance'].includes(memory.memoryType)) continue

      const existing = await this.prisma.knowledge.findFirst({
        where: {
          companyId,
          title: { contains: summary.substring(0, 30), mode: 'insensitive' },
        },
      })

      if (existing) continue

      const knowledge = await this.createKnowledge(companyId, {
        type: memory.memoryType === 'feedback' ? 'learning' : 'pattern',
        source: 'brand_memory',
        title: `Learned: ${summary.substring(0, 60)}`,
        summary: summary as string,
        details: { ...content, memoryWeight: memory.weight },
        tags: [memory.memoryType],
        relevanceScore: Math.min(1, memory.weight),
      })

      createdItems.push(knowledge)
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
