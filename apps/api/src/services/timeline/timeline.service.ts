/**
 * Timeline Generation Service
 *
 * Produces a weekly content calendar by merging agent outputs:
 * Jordan's plan (structure) + Alex's hooks (copy) + Riley's briefs (production)
 * Uses historical engagement data for optimal posting times.
 */

import { PrismaClient } from '@prisma/client'
import { invokeAgent, parseAgentOutput } from '../bedrock/bedrock.service'

export interface TimelineSlot {
  date: string
  dayOfWeek: string
  time: string           // suggested posting time
  platform: 'instagram' | 'tiktok' | 'both'
  contentType: string    // from Jordan's plan
  hook: string           // from Alex's hooks
  shotBrief: string      // from Riley's shot list
  status: 'planned' | 'in-progress' | 'ready' | 'posted'
  confidence: number     // 0-1
  sourceTaskIds: string[]
}

export interface WeeklyTimeline {
  weekOf: string
  slots: TimelineSlot[]
  strategy: string
  generatedAt: string
}

export async function generateWeeklyTimeline(
  prisma: PrismaClient,
  companyId: string,
): Promise<WeeklyTimeline | null> {
  // Get the most recent approved outputs from each agent
  const recentOutputs = await prisma.output.findMany({
    where: { companyId, status: 'approved' },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { task: { select: { type: true, employeeId: true } } },
  })

  if (recentOutputs.length === 0) return null

  // Separate by agent type
  const plans = recentOutputs.filter((o) => o.type === 'content_plan')
  const hooks = recentOutputs.filter((o) => o.type === 'hooks')
  const briefs = recentOutputs.filter((o) => o.type === 'shot_list')

  // Get best posting times from historical data
  const posts = await prisma.platformPost.findMany({
    where: { account: { companyId } },
    select: { publishHour: true, publishDayOfWeek: true, engagementRate: true },
    orderBy: { engagementRate: 'desc' },
    take: 50,
  })

  const bestHours = new Map<number, number>()
  for (const p of posts) {
    if (p.publishHour != null) {
      bestHours.set(p.publishHour, (bestHours.get(p.publishHour) || 0) + p.engagementRate)
    }
  }
  const topHours = [...bestHours.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([h]) => h)

  // Build prompt for Bedrock to synthesize into a timeline
  const planContent = plans[0]?.content ? JSON.stringify(plans[0].content).slice(0, 800) : 'No plan available'
  const hookContent = hooks[0]?.content ? JSON.stringify(hooks[0].content).slice(0, 500) : 'No hooks available'
  const briefContent = briefs[0]?.content ? JSON.stringify(briefs[0].content).slice(0, 500) : 'No briefs available'
  const bestTimesStr = topHours.length > 0 ? `Best posting hours (UTC): ${topHours.join(', ')}` : 'No historical timing data'

  const raw = await invokeAgent({
    systemPrompt: `You are a content calendar builder. Create a 7-day content timeline from agent outputs.
Return ONLY valid JSON: { "strategy": "one-line strategy", "slots": [{ "dayOfWeek": "Monday", "time": "HH:MM", "platform": "instagram|tiktok|both", "contentType": "reel|carousel|story|post", "hook": "the hook text", "shotBrief": "production notes", "confidence": 0.0-1.0 }] }
Fill 5-7 slots across the week. Distribute content types evenly. Use the best posting times from analytics.`,
    messages: [{
      role: 'user',
      content: `Jordan's content plan:\n${planContent}\n\nAlex's hooks:\n${hookContent}\n\nRiley's briefs:\n${briefContent}\n\n${bestTimesStr}\n\nGenerate a 7-day timeline starting next Monday.`,
    }],
    maxTokens: 1024,
    temperature: 0.4,
  })

  const parsed = parseAgentOutput<{ strategy: string; slots: Array<Omit<TimelineSlot, 'date' | 'status' | 'sourceTaskIds'>> }>(raw)

  // Calculate the next Monday
  const now = new Date()
  const daysUntilMonday = (8 - now.getDay()) % 7 || 7
  const nextMonday = new Date(now.getTime() + daysUntilMonday * 86400000)
  const weekOf = nextMonday.toISOString().slice(0, 10)
  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

  const slots: TimelineSlot[] = (parsed.slots || []).map((slot, i) => {
    const dayIdx = dayNames.indexOf(slot.dayOfWeek)
    const slotDate = new Date(nextMonday.getTime() + (dayIdx >= 0 ? dayIdx : i) * 86400000)
    return {
      date: slotDate.toISOString().slice(0, 10),
      dayOfWeek: slot.dayOfWeek || dayNames[i % 7],
      time: slot.time || `${topHours[0] || 12}:00`,
      platform: slot.platform || 'both',
      contentType: slot.contentType || 'reel',
      hook: slot.hook || '',
      shotBrief: slot.shotBrief || '',
      status: 'planned',
      confidence: slot.confidence || 0.5,
      sourceTaskIds: [
        ...(plans[0]?.taskId ? [plans[0].taskId] : []),
        ...(hooks[0]?.taskId ? [hooks[0].taskId] : []),
        ...(briefs[0]?.taskId ? [briefs[0].taskId] : []),
      ],
    }
  })

  const timeline: WeeklyTimeline = {
    weekOf,
    slots,
    strategy: parsed.strategy || '',
    generatedAt: new Date().toISOString(),
  }

  // Persist to database
  await prisma.contentTimeline.upsert({
    where: { companyId_weekOf: { companyId, weekOf } },
    update: {
      slots: slots as any,
      strategy: timeline.strategy,
      sourceTaskIds: slots.flatMap((s) => s.sourceTaskIds),
      generatedAt: new Date(),
    },
    create: {
      companyId,
      weekOf,
      slots: slots as any,
      strategy: timeline.strategy,
      sourceTaskIds: slots.flatMap((s) => s.sourceTaskIds),
    },
  })

  return timeline
}

export async function getLatestTimeline(
  prisma: PrismaClient,
  companyId: string,
): Promise<WeeklyTimeline | null> {
  const record = await prisma.contentTimeline.findFirst({
    where: { companyId },
    orderBy: { generatedAt: 'desc' },
  })
  if (!record) return null

  return {
    weekOf: record.weekOf,
    slots: record.slots as unknown as TimelineSlot[],
    strategy: record.strategy || '',
    generatedAt: record.generatedAt.toISOString(),
  }
}
