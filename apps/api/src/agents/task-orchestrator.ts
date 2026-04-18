import { PrismaClient, Prisma, OutputType as PrismaOutputType } from '@prisma/client'
import { invokeAgent, parseAgentOutput, retrieveNicheContext, buildLayeredPrompt } from '../services/bedrock/bedrock.service'
import { buildMayaSystemPrompt, buildMayaTaskPrompt, buildMayaPerformanceSystemPrompt, buildMayaPerformanceTaskPrompt, buildMayaPulseSystemPrompt, buildMayaPulseTaskPrompt } from './maya/system-prompt'
import { buildJordanSystemPrompt, buildJordanContentAuditPrompt, buildJordanGrowthStrategyPrompt, buildAlexSystemPrompt, buildRileySystemPrompt, buildRileyUploadReviewPrompt, buildRileyFeedAuditPrompt, buildRileyFormatAnalysisPrompt } from './jordan-alex-riley-prompts'
import { TrendReport, ContentPlan, HooksOutput, ScriptOutput, ShotListOutput, PerformanceReview, WeeklyPulse, UploadReview, ContentAudit, GrowthStrategy, FeedAudit, FormatAnalysis, OutputType } from '@vexa/types'
import { executeAndStore } from '../services/agentExecutor'
import { assertTaskQuota } from '../lib/usage'
import { tryAutoApproveDeliveredTask } from '../lib/autoShip'
import { AgentRole } from '../lib/nicheKnowledge'

const prisma = new PrismaClient()

// ─── ORCHESTRATE TASK ─────────────────────────────────────────────────────────

/**
 * Main entry point for executing a task.
 * Determines which agent handles it, builds the prompt, calls Bedrock, stores output.
 */
export async function orchestrateTask(taskId: string): Promise<void> {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      employee: true,
      company: true,
    },
  })

  await prisma.task.update({
    where: { id: taskId },
    data: { status: 'in_progress' },
  })

  try {
    const outputContent = await executeAgentTask(task)

    // Store output
    await prisma.output.create({
      data: {
        taskId,
        companyId: task.companyId,
        employeeId: task.employeeId,
        type: getOutputTypeForTask(task.type) as OutputType,
        content: outputContent as unknown as never,
        status: 'draft',
        version: 1,
      },
    })

    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'delivered',
        completedAt: new Date(),
      },
    })
  } catch (error) {
    await prisma.task.update({
      where: { id: taskId },
      data: { status: 'pending' }, // reset to retry
    })
    throw error
  }
}

// ─── EXECUTE BY ROLE ──────────────────────────────────────────────────────────

async function executeAgentTask(task: {
  id: string
  companyId: string
  type: string
  description: string | null
  employee: { role: string; name: string }
  company: {
    niche: string
    subNiche: string | null
    brandVoice: unknown
    audience: unknown
    goals: unknown
  }
}): Promise<unknown> {
  const { company, employee, description } = task
  const niche = company.niche
  const brandVoice = JSON.stringify(company.brandVoice)
  const audience = JSON.stringify(company.audience)
  const goals = JSON.stringify(company.goals)

  // Fetch niche context from RAG
  const nicheContext = await retrieveNicheContext(niche, description || task.type)

  // Fetch brand memory
  const brandMemory = await getBrandMemory(task.id)

  // Load live platform data so every agent sees real numbers
  const { loadPersonalContext, buildPlatformDataSummary } = await import('../lib/personalContext')
  const personal = await loadPersonalContext(prisma, task.companyId)
  const platformData = buildPlatformDataSummary(personal)

  switch (employee.role) {
    case 'analyst':
      return executeMayaTask({ niche, brandVoice, nicheContext, brandMemory, platformData, description, taskType: task.type, companyId: task.companyId })

    case 'strategist':
      if (task.type === 'content_audit') {
        return executeJordanContentAudit({ niche, subNiche: company.subNiche, brandVoice, audience, goals, nicheContext, brandMemory, platformData, companyId: task.companyId })
      }
      if (task.type === 'growth_strategy') {
        return executeJordanGrowthStrategy({ niche, subNiche: company.subNiche, brandVoice, audience, goals, nicheContext, brandMemory, platformData, companyId: task.companyId })
      }
      return executeJordanTask({ niche, brandVoice, audience, goals, nicheContext, brandMemory, platformData, description })

    case 'copywriter':
      return executeAlexTask({ niche, brandVoice, audience, nicheContext, brandMemory, platformData, description, taskType: task.type })

    case 'creative_director':
      if (task.type === 'upload_review') {
        return executeRileyUploadReview({ niche, brandVoice, nicheContext, brandMemory, platformData, description, companyId: task.companyId })
      }
      if (task.type === 'feed_audit') {
        return executeRileyFeedAudit({ niche, subNiche: company.subNiche, brandVoice, nicheContext, brandMemory, platformData, companyId: task.companyId })
      }
      if (task.type === 'format_analysis') {
        return executeRileyFormatAnalysis({ niche, subNiche: company.subNiche, brandVoice, nicheContext, brandMemory, platformData, companyId: task.companyId })
      }
      return executeRileyTask({ niche, brandVoice, nicheContext, brandMemory, platformData, description })

    default:
      throw new Error(`Unknown employee role: ${employee.role}`)
  }
}

// ─── AGENT EXECUTORS ──────────────────────────────────────────────────────────

async function executeMayaTask(ctx: {
  niche: string
  brandVoice: string
  nicheContext: string
  brandMemory: string
  platformData?: string
  description: string | null
  taskType?: string
  companyId?: string
}): Promise<TrendReport | PerformanceReview | WeeklyPulse> {
  if (ctx.taskType === 'performance_review' && ctx.companyId) {
    return executeMayaPerformanceReview({ ...ctx, companyId: ctx.companyId })
  }
  if (ctx.taskType === 'weekly_pulse' && ctx.companyId) {
    return executeMayaWeeklyPulse({ ...ctx, companyId: ctx.companyId })
  }

  // Brief topics about the creator's own data should use the performance
  // analysis prompt (which loads TikTok/IG data), not the external trend
  // report prompt. Detect from the task description.
  const desc = (ctx.description || '').toLowerCase()
  const isInternalAnalysis =
    /my.*(engagement|content|perform|posts|videos)/i.test(desc) ||
    /audience.*(deep|dive|breakdown|demograph|where|age)/i.test(desc) ||
    /recent.*(content|posts|performance)/i.test(desc) ||
    /analyz.*my/i.test(desc)
  if (isInternalAnalysis && ctx.companyId) {
    return executeMayaPerformanceReview({ ...ctx, companyId: ctx.companyId })
  }

  const basePrompt = buildMayaSystemPrompt({
    niche: ctx.niche,
    brandVoice: ctx.brandVoice,
  })

  const systemPrompt = buildLayeredPrompt({
    baseSystemPrompt: basePrompt,
    nicheContext: ctx.nicheContext,
    brandMemory: ctx.brandMemory,
    platformData: ctx.platformData,
  })

  const raw = await invokeAgent({
    systemPrompt,
    messages: [{ role: 'user', content: buildMayaTaskPrompt(ctx.description || 'Generate weekly trend report') }],
    maxTokens: 4096,
    temperature: 0.6,
  })

  return parseAgentOutput<TrendReport>(raw)
}

async function executeMayaPerformanceReview(ctx: {
  niche: string
  brandVoice: string
  nicheContext: string
  brandMemory: string
  companyId: string
}): Promise<PerformanceReview> {
  const { loadPersonalContext } = await import('../lib/personalContext')
  const personal = await loadPersonalContext(prisma, ctx.companyId)
  const tt = personal?.tiktok
  if (!tt || tt.recentVideos.length === 0) {
    throw new Error('No TikTok data available for performance review')
  }

  const basePrompt = buildMayaPerformanceSystemPrompt({
    niche: ctx.niche,
    brandVoice: ctx.brandVoice,
    platform: 'tiktok',
  })

  const systemPrompt = buildLayeredPrompt({
    baseSystemPrompt: basePrompt,
    nicheContext: ctx.nicheContext,
    brandMemory: ctx.brandMemory,
  })

  const taskPrompt = buildMayaPerformanceTaskPrompt({
    handle: tt.handle,
    followerCount: tt.followerCount,
    totalLikes: tt.likesCount,
    totalVideos: tt.videoCount,
    avgViews: tt.avgViews,
    engagementRate: tt.engagementRate,
    reachRate: tt.reachRate,
    videos: tt.recentVideos.map((v) => ({
      caption: v.caption,
      url: v.url,
      publishedAt: v.publishedAt,
      viewCount: v.viewCount,
      likeCount: v.likeCount,
      commentCount: v.commentCount,
      shareCount: v.shareCount,
    })),
  })

  const raw = await invokeAgent({
    systemPrompt,
    messages: [{ role: 'user', content: taskPrompt }],
    maxTokens: 3072,
    temperature: 0.5,
  })

  return parseAgentOutput<PerformanceReview>(raw)
}

async function executeMayaWeeklyPulse(ctx: {
  niche: string
  brandVoice: string
  nicheContext: string
  brandMemory: string
  companyId: string
}): Promise<WeeklyPulse> {
  const { loadPersonalContext } = await import('../lib/personalContext')
  const personal = await loadPersonalContext(prisma, ctx.companyId)
  const tt = personal?.tiktok
  if (!tt || tt.recentVideos.length === 0) {
    throw new Error('No TikTok data available for weekly pulse')
  }

  const basePrompt = buildMayaPulseSystemPrompt({
    niche: ctx.niche,
    brandVoice: ctx.brandVoice,
    platform: 'tiktok',
  })

  const systemPrompt = buildLayeredPrompt({
    baseSystemPrompt: basePrompt,
    nicheContext: ctx.nicheContext,
    brandMemory: ctx.brandMemory,
  })

  const taskPrompt = buildMayaPulseTaskPrompt({
    handle: tt.handle,
    followerCount: tt.followerCount,
    avgViews: tt.avgViews,
    engagementRate: tt.engagementRate,
    videos: tt.recentVideos.map((v) => ({
      caption: v.caption,
      url: v.url,
      publishedAt: v.publishedAt,
      viewCount: v.viewCount,
      likeCount: v.likeCount,
      commentCount: v.commentCount,
      shareCount: v.shareCount,
    })),
  })

  const raw = await invokeAgent({
    systemPrompt,
    messages: [{ role: 'user', content: taskPrompt }],
    maxTokens: 1024,
    temperature: 0.5,
  })

  return parseAgentOutput<WeeklyPulse>(raw)
}

async function executeJordanTask(ctx: {
  niche: string
  brandVoice: string
  audience: string
  goals: string
  nicheContext: string
  brandMemory: string
  platformData?: string
  description: string | null
}): Promise<ContentPlan> {
  const basePrompt = buildJordanSystemPrompt({
    niche: ctx.niche,
    brandVoice: ctx.brandVoice,
    audience: ctx.audience,
    goals: ctx.goals,
  })

  const systemPrompt = buildLayeredPrompt({
    baseSystemPrompt: basePrompt,
    nicheContext: ctx.nicheContext,
    brandMemory: ctx.brandMemory,
    platformData: ctx.platformData,
  })

  const raw = await invokeAgent({
    systemPrompt,
    messages: [{ role: 'user', content: ctx.description || 'Build the weekly content plan' }],
    maxTokens: 2048,
    temperature: 0.7,
  })

  return parseAgentOutput<ContentPlan>(raw)
}

async function executeAlexTask(ctx: {
  niche: string
  brandVoice: string
  audience: string
  nicheContext: string
  brandMemory: string
  platformData?: string
  description: string | null
  taskType: string
}): Promise<HooksOutput | ScriptOutput> {
  const basePrompt = buildAlexSystemPrompt({
    niche: ctx.niche,
    brandVoice: ctx.brandVoice,
    audience: ctx.audience,
  })

  const systemPrompt = buildLayeredPrompt({
    baseSystemPrompt: basePrompt,
    nicheContext: ctx.nicheContext,
    brandMemory: ctx.brandMemory,
    platformData: ctx.platformData,
  })

  const raw = await invokeAgent({
    systemPrompt,
    messages: [{ role: 'user', content: ctx.description || 'Write hooks for this week\'s content' }],
    maxTokens: 2048,
    temperature: 0.85,
  })

  return parseAgentOutput<HooksOutput | ScriptOutput>(raw)
}

async function executeRileyTask(ctx: {
  niche: string
  brandVoice: string
  nicheContext: string
  brandMemory: string
  platformData?: string
  description: string | null
}): Promise<ShotListOutput> {
  const basePrompt = buildRileySystemPrompt({
    niche: ctx.niche,
    brandVoice: ctx.brandVoice,
  })

  const systemPrompt = buildLayeredPrompt({
    baseSystemPrompt: basePrompt,
    nicheContext: ctx.nicheContext,
    brandMemory: ctx.brandMemory,
    platformData: ctx.platformData,
  })

  const raw = await invokeAgent({
    systemPrompt,
    messages: [{ role: 'user', content: ctx.description || 'Create the shot list and production brief' }],
    maxTokens: 2048,
    temperature: 0.7,
  })

  return parseAgentOutput<ShotListOutput>(raw)
}

// ─── JORDAN PROACTIVE EXECUTORS ──────────────────────────────────────────────

async function loadPostContext(companyId: string): Promise<string> {
  const accounts = await prisma.platformAccount.findMany({ where: { companyId } })
  if (!accounts.length) return ''

  const posts = await prisma.platformPost.findMany({
    where: { accountId: { in: accounts.map(a => a.id) } },
    orderBy: { publishedAt: 'desc' },
    take: 30,
  })
  if (!posts.length) return ''

  const scored = posts.map(p => ({
    ...p,
    engScore: (p.likeCount || 0) + (p.commentCount || 0) * 2 + (p.shareCount || 0) * 3,
  })).sort((a, b) => b.engScore - a.engScore)

  const lines: string[] = []
  lines.push(`## Creator's Post History (${posts.length} posts analyzed)`)

  const avgViews = posts.reduce((s, p) => s + (p.viewCount || 0), 0) / posts.length
  const avgLikes = posts.reduce((s, p) => s + (p.likeCount || 0), 0) / posts.length
  lines.push(`Average: ${Math.round(avgViews)} views, ${Math.round(avgLikes)} likes per post.`)

  // Format breakdown
  const formats: Record<string, { count: number; totalEng: number }> = {}
  for (const p of posts) {
    const fmt = (p.mediaType || 'unknown').toLowerCase()
    if (!formats[fmt]) formats[fmt] = { count: 0, totalEng: 0 }
    formats[fmt].count++
    formats[fmt].totalEng += (p.likeCount || 0) + (p.commentCount || 0)
  }
  lines.push('\nFormat breakdown:')
  for (const [fmt, data] of Object.entries(formats)) {
    lines.push(`  - ${fmt}: ${data.count} posts, avg ${Math.round(data.totalEng / data.count)} engagement`)
  }

  // Top 5 posts
  lines.push('\nTop performing posts:')
  for (const p of scored.slice(0, 5)) {
    lines.push(`  - [${(p.mediaType || '').toLowerCase()}] "${(p.caption || '').slice(0, 80)}" — ${p.viewCount} views, ${p.likeCount} likes, ${p.shareCount} shares`)
  }

  // Recent 5 posts
  lines.push('\nMost recent posts:')
  for (const p of [...posts].slice(0, 5)) {
    lines.push(`  - [${(p.mediaType || '').toLowerCase()}] "${(p.caption || '').slice(0, 80)}" — ${p.viewCount} views, ${p.likeCount} likes`)
  }

  // Posting frequency
  if (posts.length >= 2) {
    const first = posts[posts.length - 1].publishedAt
    const last = posts[0].publishedAt
    if (first && last) {
      const days = Math.max(1, (last.getTime() - first.getTime()) / (1000 * 60 * 60 * 24))
      const perWeek = (posts.length / days * 7).toFixed(1)
      lines.push(`\nPosting frequency: ~${perWeek} posts/week over ${Math.round(days)} days`)
    }
  }

  return lines.join('\n')
}

async function executeJordanContentAudit(ctx: {
  niche: string; subNiche?: string | null; brandVoice: string; audience: string; goals: string
  nicheContext: string; brandMemory: string; platformData?: string; companyId: string
}): Promise<ContentAudit> {
  const postContext = await loadPostContext(ctx.companyId)
  const basePrompt = buildJordanContentAuditPrompt({
    niche: ctx.niche, subNiche: ctx.subNiche || undefined, brandVoice: ctx.brandVoice, audience: ctx.audience, goals: ctx.goals,
  })
  const systemPrompt = buildLayeredPrompt({
    baseSystemPrompt: basePrompt, nicheContext: ctx.nicheContext, brandMemory: ctx.brandMemory,
    platformData: ctx.platformData, recentOutputSummary: postContext || undefined,
  })
  const raw = await invokeAgent({
    systemPrompt, messages: [{ role: 'user', content: 'Deliver the content audit based on my posting history. Reference specific posts and patterns.' }],
    maxTokens: 3072, temperature: 0.6, companyId: ctx.companyId,
  })
  return parseAgentOutput<ContentAudit>(raw)
}

async function executeJordanGrowthStrategy(ctx: {
  niche: string; subNiche?: string | null; brandVoice: string; audience: string; goals: string
  nicheContext: string; brandMemory: string; platformData?: string; companyId: string
}): Promise<GrowthStrategy> {
  const postContext = await loadPostContext(ctx.companyId)
  const basePrompt = buildJordanGrowthStrategyPrompt({
    niche: ctx.niche, subNiche: ctx.subNiche || undefined, brandVoice: ctx.brandVoice, audience: ctx.audience, goals: ctx.goals,
  })
  const systemPrompt = buildLayeredPrompt({
    baseSystemPrompt: basePrompt, nicheContext: ctx.nicheContext, brandMemory: ctx.brandMemory,
    platformData: ctx.platformData, recentOutputSummary: postContext || undefined,
  })
  const raw = await invokeAgent({
    systemPrompt, messages: [{ role: 'user', content: 'Build my growth strategy based on my current data. Prioritize actions by impact.' }],
    maxTokens: 3072, temperature: 0.6, companyId: ctx.companyId,
  })
  return parseAgentOutput<GrowthStrategy>(raw)
}

// ─── RILEY PROACTIVE EXECUTORS ───────────────────────────────────────────────

async function executeRileyFeedAudit(ctx: {
  niche: string; subNiche?: string | null; brandVoice: string
  nicheContext: string; brandMemory: string; platformData?: string; companyId: string
}): Promise<FeedAudit> {
  const postContext = await loadPostContext(ctx.companyId)
  const basePrompt = buildRileyFeedAuditPrompt({
    niche: ctx.niche, subNiche: ctx.subNiche || undefined, brandVoice: ctx.brandVoice,
  })
  const systemPrompt = buildLayeredPrompt({
    baseSystemPrompt: basePrompt, nicheContext: ctx.nicheContext, brandMemory: ctx.brandMemory,
    platformData: ctx.platformData, recentOutputSummary: postContext || undefined,
  })
  const raw = await invokeAgent({
    systemPrompt, messages: [{ role: 'user', content: 'Audit my feed. How does my content look as a whole? Is the visual identity cohesive?' }],
    maxTokens: 2048, temperature: 0.6, companyId: ctx.companyId,
  })
  return parseAgentOutput<FeedAudit>(raw)
}

async function executeRileyFormatAnalysis(ctx: {
  niche: string; subNiche?: string | null; brandVoice: string
  nicheContext: string; brandMemory: string; platformData?: string; companyId: string
}): Promise<FormatAnalysis> {
  const postContext = await loadPostContext(ctx.companyId)
  const basePrompt = buildRileyFormatAnalysisPrompt({
    niche: ctx.niche, subNiche: ctx.subNiche || undefined, brandVoice: ctx.brandVoice,
  })
  const systemPrompt = buildLayeredPrompt({
    baseSystemPrompt: basePrompt, nicheContext: ctx.nicheContext, brandMemory: ctx.brandMemory,
    platformData: ctx.platformData, recentOutputSummary: postContext || undefined,
  })
  const raw = await invokeAgent({
    systemPrompt, messages: [{ role: 'user', content: 'Analyze my content format performance. Which formats work best and what should I change?' }],
    maxTokens: 2048, temperature: 0.6, companyId: ctx.companyId,
  })
  return parseAgentOutput<FormatAnalysis>(raw)
}

async function executeRileyUploadReview(ctx: {
  niche: string
  brandVoice: string
  nicheContext: string
  brandMemory: string
  platformData?: string
  description: string | null
  companyId: string
}): Promise<UploadReview> {
  // Description contains JSON with uploadKey, uploadType, and optional notes
  let uploadMeta: { uploadKey: string; uploadType: 'video' | 'image'; notes?: string } | null = null
  try {
    uploadMeta = JSON.parse(ctx.description || '{}')
  } catch { /* fallback below */ }

  if (!uploadMeta?.uploadKey) {
    throw new Error('Upload review requires an uploadKey in the task description')
  }

  const { getPresignedUrl } = await import('../services/storage/s3.service')
  const fileUrl = await getPresignedUrl(uploadMeta.uploadKey)

  // Probe video for duration/dimensions
  let videoDuration: number | undefined
  if (uploadMeta.uploadType === 'video') {
    try {
      const { probeVideo } = await import('../services/video/ffmpeg.service')
      const probe = await probeVideo(uploadMeta.uploadKey)
      videoDuration = probe.duration
    } catch (e) {
      console.warn('[upload-review] Video probe failed:', (e as Error).message)
    }
  }

  // Load the creator's existing posts so Riley can learn their style
  let postContext = ''
  try {
    const accounts = await prisma.platformAccount.findMany({
      where: { companyId: ctx.companyId },
    })
    if (accounts.length > 0) {
      const posts = await prisma.platformPost.findMany({
        where: { accountId: { in: accounts.map(a => a.id) } },
        orderBy: { publishedAt: 'desc' },
        take: 30,
      })

      if (posts.length > 0) {
        // Sort by engagement to find top performers
        const scored = posts.map(p => ({
          ...p,
          engScore: (p.likeCount || 0) + (p.commentCount || 0) * 2 + (p.shareCount || 0) * 3,
        })).sort((a, b) => b.engScore - a.engScore)

        const topPosts = scored.slice(0, 5)
        const recentPosts = [...posts].slice(0, 5)
        const avgViews = posts.reduce((s, p) => s + (p.viewCount || 0), 0) / posts.length
        const avgLikes = posts.reduce((s, p) => s + (p.likeCount || 0), 0) / posts.length

        const lines: string[] = []
        lines.push(`## Creator's Existing Content (use this to judge brand consistency & niche fit)`)
        lines.push(`Analyzed ${posts.length} posts. Avg ${Math.round(avgViews)} views, ${Math.round(avgLikes)} likes per post.`)
        lines.push('')
        lines.push('### Top performing posts (what their audience loves):')
        for (const p of topPosts) {
          const fmt = (p.mediaType || '').toLowerCase()
          lines.push(`- [${fmt}] "${(p.caption || '').slice(0, 100)}" — ${p.viewCount} views, ${p.likeCount} likes, ${p.shareCount} shares`)
        }
        lines.push('')
        lines.push('### Most recent posts (their current direction):')
        for (const p of recentPosts) {
          const fmt = (p.mediaType || '').toLowerCase()
          lines.push(`- [${fmt}] "${(p.caption || '').slice(0, 100)}" — ${p.viewCount} views, ${p.likeCount} likes`)
        }
        lines.push('')
        lines.push('Use this data to evaluate whether the new upload matches what performs well for this creator. Flag if the new content is a departure from their established style or top-performing themes.')

        postContext = lines.join('\n')
      }
    }
  } catch (e) {
    console.warn('[upload-review] Failed to load post context:', (e as Error).message)
  }

  const basePrompt = buildRileyUploadReviewPrompt({
    niche: ctx.niche,
    brandVoice: ctx.brandVoice,
    uploadType: uploadMeta.uploadType,
    videoDuration,
  })

  const systemPrompt = buildLayeredPrompt({
    baseSystemPrompt: basePrompt,
    nicheContext: ctx.nicheContext,
    brandMemory: ctx.brandMemory,
    platformData: ctx.platformData,
    recentOutputSummary: postContext || undefined,
  })

  // Build the user message — for images, include the image via base64 if possible
  let messages: Array<{ role: 'user' | 'assistant'; content: string | Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }> }>

  if (uploadMeta.uploadType === 'image') {
    try {
      const response = await fetch(fileUrl)
      const buffer = Buffer.from(await response.arrayBuffer())
      const base64 = buffer.toString('base64')
      const contentType = response.headers.get('content-type') || 'image/jpeg'

      messages = [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: contentType, data: base64 },
          },
          {
            type: 'text',
            text: `Review this ${uploadMeta.uploadType} for posting on social media.${uploadMeta.notes ? `\n\nCEO's notes: ${uploadMeta.notes}` : ''}\n\nAnalyze: framing, lighting, composition, hook potential, and overall quality. Return your structured review with suggestedEdits as an empty array.`,
          },
        ],
      }]
    } catch {
      messages = [{
        role: 'user',
        content: `Review this uploaded ${uploadMeta.uploadType} for social media posting. The file is at: ${fileUrl}\n${uploadMeta.notes ? `CEO's notes: ${uploadMeta.notes}` : ''}\n\nProvide your structured review based on social media best practices for the ${ctx.niche} niche. Return suggestedEdits as an empty array.`,
      }]
    }
  } else {
    // Video — text-based review with edit suggestion context
    const durationNote = videoDuration ? `\nVideo duration: ${videoDuration.toFixed(1)} seconds.` : ''
    messages = [{
      role: 'user',
      content: `Review this uploaded video for social media posting. The video file is available at: ${fileUrl}${durationNote}\n${uploadMeta.notes ? `CEO's notes: ${uploadMeta.notes}` : ''}\n\nBased on social media video best practices for the ${ctx.niche} niche:\n1. Score each category 1-10 (hook, pacing, framing, lighting, audio, editing)\n2. Suggest specific AI edits the system can auto-apply (trim, speed, crop, text overlay, audio normalization)\n3. Only suggest edits that would meaningfully improve the content`,
    }]
  }

  const raw = await invokeAgent({
    systemPrompt,
    messages: messages as never,
    maxTokens: 3072,
    temperature: 0.6,
    companyId: ctx.companyId,
  })

  const review = parseAgentOutput<Omit<UploadReview, 'uploadKey' | 'uploadType' | 'videoDuration'>>(raw)

  return {
    ...review,
    suggestedEdits: review.suggestedEdits || [],
    uploadKey: uploadMeta.uploadKey,
    uploadType: uploadMeta.uploadType,
    videoDuration,
  }
}

// ─── HANDLE USER ACTION ON OUTPUT ────────────────────────────────────────────

/**
 * Process a button action from the user on a delivered output.
 * Approved: store memory, mark done.
 * Rejected: mark rejected.
 * Reconsider: trigger regeneration with feedback.
 */
export async function handleTaskAction(
  taskId: string,
  action: {
    type: string
    label: string
    feedback?: string
  }
): Promise<void> {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: { outputs: true, employee: true, company: true },
  })

  const isSaveUnreleased = action.type === 'save_unreleased'
  const isApprove = action.type === 'approve' || action.type.startsWith('use_') || action.type === 'start_production' || action.type === 'post_anyway' || isSaveUnreleased
  const isReject = action.type === 'reject' || action.type === 'regenerate' || action.type === 'start_over'
  const isReconsider = !isApprove && !isReject

  if (isApprove) {
    await prisma.task.update({ where: { id: taskId }, data: { status: 'approved', userAction: action as never } })

    // Save as positive brand memory
    const latestOutput = task.outputs[task.outputs.length - 1]
    if (latestOutput) {
      await prisma.output.update({ where: { id: latestOutput.id }, data: { status: 'approved' } })

      // CEO override on upload review — store what Riley flagged and that
      // the CEO overrode it. Riley's future reviews will factor this in.
      if (action.type === 'post_anyway' && latestOutput.type === 'upload_review') {
        const reviewContent = latestOutput.content as Record<string, unknown>
        await prisma.brandMemory.create({
          data: {
            companyId: task.companyId,
            memoryType: 'feedback',
            content: {
              type: 'ceo_override',
              context: 'upload_review',
              rileyFlagged: reviewContent.issues || [],
              verdict: reviewContent.verdict,
              overallScore: reviewContent.overallScore,
              rileyNote: reviewContent.rileyNote,
              ceoDecision: 'posted_anyway',
              timestamp: new Date().toISOString(),
            } as never,
            weight: 2.0,  // High weight — overrides are strong signals
          },
        })
      } else {
        await prisma.brandMemory.create({
          data: {
            companyId: task.companyId,
            memoryType: 'feedback',
            content: {
              type: 'approval',
              outputType: latestOutput.type,
              employeeRole: task.employee.role,
              action: action.type,
            } as never,
            weight: 1.5,
          },
        })
      }
    }

    // Trigger next agent in pipeline — but NOT for unreleased saves.
    // Nothing gets published without explicit CEO confirmation.
    if (!isSaveUnreleased) {
      await triggerNextAgentAfterApproval(prisma, task)
    }

  } else if (isReject) {
    await prisma.task.update({ where: { id: taskId }, data: { status: 'rejected', userAction: action as never } })

    const latestOutput = task.outputs[task.outputs.length - 1]
    if (latestOutput) {
      await prisma.output.update({ where: { id: latestOutput.id }, data: { status: 'rejected' } })
    }

  } else if (isReconsider) {
    await prisma.task.update({ where: { id: taskId }, data: { status: 'revision', userAction: action as never } })

    // Save reconsider as memory signal with lower weight
    await prisma.brandMemory.create({
      data: {
        companyId: task.companyId,
        memoryType: 'feedback',
        content: {
          type: 'reconsider',
          outputType: task.type,
          action: action.type,
          feedback: action.feedback || action.label,
        } as never,
        weight: 0.8,
      },
    })

    // Regenerate with feedback context
    await regenerateWithFeedback(taskId, action)
  }
}

// ─── REGENERATE WITH FEEDBACK ─────────────────────────────────────────────────

async function regenerateWithFeedback(
  taskId: string,
  action: { type: string; label: string; feedback?: string }
): Promise<void> {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: { employee: true, company: true, outputs: true },
  })

  const latestOutput = task.outputs[task.outputs.length - 1]
  const feedbackContext = `Previous output was sent back with action: "${action.label}". ${action.feedback ? `CEO note: "${action.feedback}"` : ''} Please improve accordingly.`

  const modifiedTask = {
    ...task,
    description: `${task.description || ''}\n\nREVISION FEEDBACK: ${feedbackContext}`,
  }

  const newContent = await executeAgentTask(modifiedTask)

  const newVersion = (latestOutput?.version || 1) + 1

  await prisma.output.create({
    data: {
      taskId,
      companyId: task.companyId,
      employeeId: task.employeeId,
      type: latestOutput!.type as OutputType,
      content: newContent as never,
      status: 'draft',
      version: newVersion,
      feedback: { action: action.type, note: action.feedback } as never,
    },
  })

  await prisma.task.update({
    where: { id: taskId },
    data: { status: 'delivered' },
  })
}

// ─── PIPELINE TRIGGERS ────────────────────────────────────────────────────────

const PIPELINE_OUTPUT_TYPE: Record<string, PrismaOutputType> = {
  strategist: 'content_plan',
  copywriter: 'hooks',
  creative_director: 'shot_list',
}

/** Result of trying to run the next pipeline step after an approval. */
export type AgentPipelineChainResult =
  | { ok: false; reason: 'end_of_pipeline' | 'no_company' | 'quota_exceeded' | 'no_next_employee' | 'bad_config' }
  | {
      ok: true
      nextTaskId: string
      title: string
      outputType: PrismaOutputType
      nextRole: string
      nextEmployeeName: string
    }

/**
 * After an output is approved, create the next role's task and run the same
 * execution path as POST /api/tasks (`executeAndStore`), so chained work
 * matches manual briefs (Bedrock / mocks, niche RAG, brand memory).
 */
export async function triggerNextAgentAfterApproval(
  db: PrismaClient,
  task: { companyId: string; employee: { role: string }; id?: string },
): Promise<AgentPipelineChainResult> {
  const nextRoleMap: Record<string, string | null> = {
    analyst: 'strategist',
    strategist: 'copywriter',
    copywriter: 'creative_director',
    creative_director: null,
  }

  const currentRole = task.employee.role
  const nextRoleStr = nextRoleMap[currentRole]
  if (!nextRoleStr) return { ok: false, reason: 'end_of_pipeline' }

  const company = await db.company.findUnique({
    where: { id: task.companyId },
    select: { niche: true, userId: true, agentTools: true },
  })
  if (!company) return { ok: false, reason: 'no_company' }

  try {
    await assertTaskQuota(db, company.userId)
  } catch (err) {
    const e = err as Error & { code?: string }
    if (e.code === 'plan_limit_exceeded') {
      console.warn('[triggerNextAgentAfterApproval] plan limit exceeded; skipping chained task')
      return { ok: false, reason: 'quota_exceeded' }
    }
    throw err
  }

  const nextEmployee = await db.employee.findFirst({
    where: { companyId: task.companyId, role: nextRoleStr as never, isActive: true },
  })
  if (!nextEmployee) return { ok: false, reason: 'no_next_employee' }

  const outputType = PIPELINE_OUTPUT_TYPE[nextRoleStr]
  if (!outputType) return { ok: false, reason: 'bad_config' }

  const title = getAutoTaskTitle(nextRoleStr)

  // Build context from the previous agent's approved output so the next
  // agent builds on their work instead of starting from scratch
  let description = ''
  if (task.id) {
    const prevOutput = await db.output.findFirst({
      where: { taskId: task.id, status: 'approved' },
      orderBy: { version: 'desc' },
    })
    if (prevOutput) {
      description = buildHandoffContext(currentRole, nextRoleStr, prevOutput.content as Record<string, unknown>)
    }
  }

  const nextTask = await db.task.create({
    data: {
      companyId: task.companyId,
      employeeId: nextEmployee.id,
      title,
      description,
      type: outputType,
      status: 'in_progress',
    },
  })

  try {
    await executeAndStore(db, {
      taskId: nextTask.id,
      companyId: task.companyId,
      niche: company.niche,
      role: nextRoleStr as AgentRole,
      type: outputType,
      title,
      description,
    })
  } catch (err) {
    console.warn('[triggerNextAgentAfterApproval] executeAndStore failed', err)
    try {
      await db.output.create({
        data: {
          taskId: nextTask.id,
          companyId: task.companyId,
          employeeId: nextEmployee.id,
          type: outputType,
          content: {
            error: 'execution_failed',
            note: 'The agent could not complete this chained brief. Re-brief to try again.',
            message: (err as Error)?.message?.slice(0, 500) || null,
          } as unknown as Prisma.InputJsonObject,
          status: 'draft',
        },
      })
      await db.task.update({
        where: { id: nextTask.id },
        data: { status: 'revision' },
      })
    } catch (e2) {
      console.warn('[triggerNextAgentAfterApproval] failed to persist error stub', e2)
    }
  }

  let chainResult: AgentPipelineChainResult = {
    ok: true,
    nextTaskId: nextTask.id,
    title,
    outputType,
    nextRole: nextRoleStr,
    nextEmployeeName: nextEmployee.name,
  }

  const afterRun = await db.task.findUnique({ where: { id: nextTask.id } })
  if (afterRun?.status === 'delivered') {
    const auto = await tryAutoApproveDeliveredTask(db, {
      companyId: task.companyId,
      taskId: nextTask.id,
      outputType,
      agentTools: company.agentTools,
    })
    if (auto.didAuto) {
      const inner = await triggerNextAgentAfterApproval(db, {
        id: nextTask.id,
        companyId: task.companyId,
        employee: nextEmployee,
      })
      chainResult = inner
    }
  }

  return chainResult
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

async function getBrandMemory(taskId: string): Promise<string> {
  const task = await prisma.task.findUnique({ where: { id: taskId } })
  if (!task) return ''

  const memories = await prisma.brandMemory.findMany({
    where: { companyId: task.companyId },
    orderBy: [{ weight: 'desc' }, { createdAt: 'desc' }],
    take: 10,
  })

  if (!memories.length) return ''

  return memories
    .map(m => JSON.stringify(m.content))
    .join('\n')
}

function getOutputTypeForTask(taskType: string): string {
  const map: Record<string, string> = {
    trend_analysis: 'trend_report',
    content_planning: 'content_plan',
    hook_writing: 'hooks',
    caption_writing: 'caption',
    script_writing: 'script',
    shot_list: 'shot_list',
    video_production: 'video',
    performance_review: 'performance_review',
    weekly_pulse: 'weekly_pulse',
    upload_review: 'upload_review',
    content_audit: 'content_audit',
    growth_strategy: 'growth_strategy',
    feed_audit: 'feed_audit',
    format_analysis: 'format_analysis',
  }
  return map[taskType] || taskType || 'hooks'
}

/**
 * Summarize the previous agent's output into context the next agent can
 * act on. Each handoff is tailored: Maya→Jordan passes trends + insights,
 * Jordan→Alex passes the content plan, Alex→Riley passes the script.
 */
function buildHandoffContext(fromRole: string, toRole: string, content: Record<string, unknown>): string {
  const lines: string[] = []
  lines.push(`Context from ${fromRole} (approved by the CEO):`)

  if (fromRole === 'analyst' && toRole === 'strategist') {
    // Maya → Jordan: pass trends + key recommendation
    const trends = content.trends as Array<{ topic: string; contentOpportunity: string; urgency: string }> | undefined
    if (trends?.length) {
      lines.push('Top trends Maya identified:')
      for (const t of trends.slice(0, 5)) {
        lines.push(`  - ${t.topic} (${t.urgency}): ${t.contentOpportunity}`)
      }
    }
    if (content.topOpportunity) lines.push('Maya\'s top recommendation: ' + String(content.topOpportunity))
    if (content.topRecommendation) lines.push('Maya\'s top recommendation: ' + String(content.topRecommendation))
    // Performance review context
    if (content.whatsWorking) {
      const wins = content.whatsWorking as Array<{ videoTitle: string; whyItWorked: string }>
      lines.push('What\'s working for this creator:')
      for (const w of wins.slice(0, 3)) lines.push(`  - "${w.videoTitle}": ${w.whyItWorked}`)
    }
    if (content.keyInsights) {
      lines.push('Key insights:')
      for (const i of content.keyInsights as string[]) lines.push(`  - ${i}`)
    }
    lines.push('')
    lines.push('Build the content plan around these insights. Anchor slots on what\'s working and the trends Maya flagged.')
  }

  if (fromRole === 'strategist' && toRole === 'copywriter') {
    // Jordan → Alex: pass the content plan with specific days/topics
    const days = content.days as Array<{ day?: string; topic?: string; format?: string; angle?: string }> | undefined
    if (days?.length) {
      lines.push('Jordan\'s approved content plan:')
      for (const d of days) {
        lines.push(`  - ${d.day || '?'}: ${d.topic || '?'} (${d.format || '?'})${d.angle ? ' — ' + d.angle : ''}`)
      }
    }
    if (content.strategyNote) lines.push('Strategy note: ' + String(content.strategyNote))
    lines.push('')
    lines.push('Write hooks and captions for each post in this plan. Match the format Jordan specified. Your copy should be ready to post.')
  }

  if (fromRole === 'copywriter' && toRole === 'creative_director') {
    // Alex → Riley: pass the hooks/script
    const hooks = content.hooks as Array<{ text?: string; hook?: string }> | undefined
    if (hooks?.length) {
      lines.push('Alex\'s approved hooks:')
      for (const h of hooks.slice(0, 5)) lines.push(`  - "${h.text || h.hook || ''}"`)
    }
    if (content.script) {
      lines.push('Alex\'s approved script:')
      const script = content.script as { scenes?: Array<{ dialogue?: string }> }
      if (script.scenes) {
        for (const s of script.scenes.slice(0, 3)) lines.push(`  - ${s.dialogue || ''}`)
      }
    }
    if (content.alexNote) lines.push('Alex\'s note: ' + String(content.alexNote))
    lines.push('')
    lines.push('Create the shot list and production brief based on Alex\'s copy. Match the energy and pacing to the hooks.')
  }

  // Fallback if no specific handoff
  if (lines.length <= 1) {
    lines.push(JSON.stringify(content).slice(0, 500))
    lines.push('')
    lines.push('Use the above context from the previous agent to inform your work.')
  }

  return lines.join('\n')
}

function getAutoTaskTitle(role: string): string {
  const map: Record<string, string> = {
    strategist: 'Build this week\'s content plan',
    copywriter: 'Write hooks and scripts for the content plan',
    creative_director: 'Create production brief and shot list',
  }
  return map[role] || 'New task'
}

