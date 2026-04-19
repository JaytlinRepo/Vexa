import prisma from '../lib/prisma'
import { invokeAgentStream, invokeAgent, parseAgentOutput } from './bedrock/bedrock.service'
import {
  buildMayaMeetingPrompt,
} from '../agents/maya/system-prompt'
import {
  buildJordanMeetingPrompt,
  buildAlexMeetingPrompt,
  buildRileyMeetingPrompt,
} from '../agents/jordan-alex-riley-prompts'
import { EmployeeRole, MeetingMessage, MeetingDecision } from '@vexa/types'


// ─── START MEETING ────────────────────────────────────────────────────────────

export async function startMeeting(companyId: string, employeeId: string) {
  const [company, employee] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: companyId } }),
    prisma.employee.findUniqueOrThrow({ where: { id: employeeId } }),
  ])

  // Build opening message from the employee
  const systemPrompt = buildMeetingSystemPrompt(employee.role as EmployeeRole, {
    niche: company.niche,
    subNiche: company.subNiche || undefined,
    brandContext: JSON.stringify(company.brandVoice),
  })

  const openingMessage = await invokeAgent({
    systemPrompt,
    messages: [
      {
        role: 'user',
        content: 'The CEO just joined the meeting. Open the meeting with a brief, professional greeting that references something relevant from your recent work. Be prepared and specific.',
      },
    ],
    maxTokens: 256,
    temperature: 0.8,
  })

  const initialMessages: MeetingMessage[] = [
    {
      role: 'assistant',
      content: openingMessage,
      timestamp: new Date(),
    },
  ]

  const meeting = await prisma.meeting.create({
    data: {
      companyId,
      employeeId,
      messages: initialMessages as unknown as never,
    },
  })

  await prisma.employee.update({
    where: { id: employeeId },
    data: { lastActive: new Date() },
  })

  return { meeting, openingMessage }
}

// ─── SEND MESSAGE (streaming) ─────────────────────────────────────────────────

export async function sendMeetingMessage(
  meetingId: string,
  userMessage: string,
  onChunk: (text: string) => void
): Promise<string> {
  const meeting = await prisma.meeting.findUniqueOrThrow({
    where: { id: meetingId },
    include: {
      employee: true,
      company: true,
    },
  })

  const messages = meeting.messages as unknown as MeetingMessage[]

  const systemPrompt = buildMeetingSystemPrompt(meeting.employee.role as EmployeeRole, {
    niche: meeting.company.niche,
    brandContext: JSON.stringify(meeting.company.brandVoice),
  })

  // Build conversation history for Bedrock
  const conversationHistory = messages.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }))

  conversationHistory.push({ role: 'user', content: userMessage })

  // Update messages with user's input immediately
  const updatedMessages: MeetingMessage[] = [
    ...messages,
    { role: 'user', content: userMessage, timestamp: new Date() },
  ]

  let fullResponse = ''

  await invokeAgentStream({
    systemPrompt,
    messages: conversationHistory,
    maxTokens: 512,
    temperature: 0.8,
    onChunk: (text) => {
      fullResponse += text
      onChunk(text)
    },
    onComplete: async (text) => {
      fullResponse = text
      const finalMessages: MeetingMessage[] = [
        ...updatedMessages,
        { role: 'assistant', content: text, timestamp: new Date() },
      ]

      await prisma.meeting.update({
        where: { id: meetingId },
        data: { messages: finalMessages as unknown as never },
      })
    },
    onError: (error) => {
      console.error('Meeting stream error:', error)
      throw error
    },
  })

  return fullResponse
}

// ─── END MEETING ──────────────────────────────────────────────────────────────

export async function endMeeting(meetingId: string) {
  const meeting = await prisma.meeting.findUniqueOrThrow({
    where: { id: meetingId },
    include: { employee: true, company: true },
  })

  const messages = meeting.messages as unknown as MeetingMessage[]

  // Generate summary + extract decisions
  const summaryPrompt = `You are a meeting summarizer. Review this meeting transcript and extract:
1. A brief summary (2-3 sentences) of what was discussed
2. Key decisions made
3. Any action items that should become tasks

Meeting transcript:
${messages.map(m => `${m.role === 'user' ? 'CEO' : meeting.employee.name}: ${m.content}`).join('\n\n')}

Return ONLY valid JSON:
{
  "summary": "string",
  "decisions": [
    {
      "decision": "string",
      "actionItem": "string (optional)",
      "assignedTo": "analyst" | "strategist" | "copywriter" | "creative_director" | null
    }
  ]
}`

  const summaryRaw = await invokeAgent({
    systemPrompt: 'You are a precise meeting summarizer. Return only valid JSON.',
    messages: [{ role: 'user', content: summaryPrompt }],
    maxTokens: 512,
    temperature: 0.3,
  })

  const { summary, decisions } = parseAgentOutput<{
    summary: string
    decisions: MeetingDecision[]
  }>(summaryRaw)

  const updatedMeeting = await prisma.meeting.update({
    where: { id: meetingId },
    data: {
      summary,
      decisions: decisions as unknown as never,
      endedAt: new Date(),
    },
  })

  // Save decisions as brand memory
  if (decisions.length > 0) {
    await prisma.brandMemory.create({
      data: {
        companyId: meeting.companyId,
        memoryType: 'feedback',
        content: {
          source: 'meeting',
          meetingId,
          employeeName: meeting.employee.name,
          decisions,
        } as unknown as never,
      },
    })
  }

  return { meeting: updatedMeeting, summary, decisions }
}

// ─── HELPER: Build meeting prompt by role ─────────────────────────────────────

function buildMeetingSystemPrompt(
  role: EmployeeRole,
  context: { niche: string; subNiche?: string; brandContext?: string; recentWork?: string }
): string {
  switch (role) {
    case 'analyst':
      return buildMayaMeetingPrompt(context)
    case 'strategist':
      return buildJordanMeetingPrompt(context)
    case 'copywriter':
      return buildAlexMeetingPrompt(context)
    case 'creative_director':
      return buildRileyMeetingPrompt(context)
    default:
      throw new Error(`Unknown employee role: ${role}`)
  }
}
