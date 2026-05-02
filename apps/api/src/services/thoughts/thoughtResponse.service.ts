import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import prisma from '../../lib/prisma'
import { EmployeeRole } from '@prisma/client'

const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_BEDROCK_REGION || 'us-east-1' })

const ROLE_PERSONALITY: Record<EmployeeRole, string> = {
  analyst: `You are Maya, the Trend & Insights Analyst. You are data-driven, precise, and bring hard numbers to conversations.
Your job is to analyze user thoughts and provide data-backed insights about engagement, trends, and performance metrics.
Respond conversationally but with specific numbers and percentages when relevant.
Keep responses concise (2-3 sentences max) and use a confident, analytical tone.`,

  strategist: `You are Jordan, the Content Strategist. You are calm, organized, and think in systems and frameworks.
Your job is to provide strategic perspective on user thoughts and connect them to bigger-picture content goals.
Respond thoughtfully about how thoughts fit into their overall content strategy and audience positioning.
Keep responses concise (2-3 sentences max) and use a strategic, organized tone.`,

  copywriter: `You are Alex, the Copywriter & Script Writer. You are creative, opinionated, and excited about language and hooks.
Your job is to react to user thoughts from a creative angle and suggest how they could translate to compelling copy or scripts.
Be enthusiastic about creative opportunities and specific about execution ideas.
Keep responses concise (2-3 sentences max) and use an energetic, creative tone.`,

  creative_director: `You are Riley, the Creative Director. You are a visual thinker, detail-oriented, and speak in shots, scenes, and visual language.
Your job is to consider user thoughts from a production and visual angle. What would this look like on screen?
Be practical about production constraints while being visually inspired.
Keep responses concise (2-3 sentences max) and use a visual, practical tone.`,
}

const ROLE_RELEVANCE: Record<EmployeeRole, string[]> = {
  analyst: ['data', 'engagement', 'metrics', 'trending', 'numbers', 'analytics', 'performance'],
  strategist: ['strategy', 'content plan', 'goals', 'audience', 'direction', 'positioning', 'approach'],
  copywriter: ['copy', 'tone', 'hook', 'script', 'captions', 'creative', 'writing'],
  creative_director: ['visual', 'format', 'production', 'filming', 'design', 'aesthetic', 'shots'],
}

// Pick the best agent for this thought based on content
function selectAgent(thoughtContent: string): EmployeeRole {
  const lower = thoughtContent.toLowerCase()

  for (const [role, keywords] of Object.entries(ROLE_RELEVANCE)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return role as EmployeeRole
    }
  }

  // Default: strategist handles everything else (broader perspective)
  return 'strategist'
}

export async function generateThoughtResponse(
  companyId: string,
  thoughtId: string,
  thoughtContent: string,
): Promise<string> {
  const selectedRole = selectAgent(thoughtContent)

  // Get the employee for this company and role
  const employee = await prisma.employee.findUnique({
    where: {
      companyId_role: { companyId, role: selectedRole },
    },
  })

  if (!employee) {
    throw new Error(`No employee found for ${selectedRole} in company ${companyId}`)
  }

  // Get brand context
  const company = await prisma.company.findUnique({
    where: { id: companyId },
  })

  if (!company) {
    throw new Error(`Company ${companyId} not found`)
  }

  // Build system prompt with personality
  const systemPrompt = `${ROLE_PERSONALITY[selectedRole]}

About the creator you're working with:
- Niche: ${company.niche}${company.subNiche ? ` (${company.subNiche})` : ''}
- Brand voice: ${JSON.stringify(company.brandVoice)}

Respond to their thought. Do not suggest actions or create tasks.
Just provide your perspective, data, or strategic insight based on what they said.`

  // Call Bedrock
  const response = await bedrockClient.send(
    new InvokeModelCommand({
      modelId: 'anthropic.claude-haiku-20240307-v1:0',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 256,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `The creator just shared this thought: "${thoughtContent}"\n\nRespond with your perspective.`,
          },
        ],
      }),
    }),
  )

  const result = JSON.parse(new TextDecoder().decode(response.body))
  const responseText = result.content[0].text

  // Store the response
  await prisma.thoughtResponse.create({
    data: {
      thoughtId,
      companyId,
      employeeId: employee.id,
      content: responseText,
    },
  })

  return responseText
}

// Scheduler job: check for thoughts without responses and generate them
export async function processThoughtResponses() {
  try {
    // Find all thoughts that don't have a response yet
    const thoughtsWithoutResponse = await prisma.thought.findMany({
      where: {
        thoughtResponses: {
          none: {},
        },
      },
      include: {
        company: true,
      },
    })

    console.log(`[thoughts] Found ${thoughtsWithoutResponse.length} thoughts awaiting responses`)

    for (const thought of thoughtsWithoutResponse) {
      try {
        await generateThoughtResponse(thought.companyId, thought.id, thought.content)
        console.log(`[thoughts] Generated response for thought ${thought.id}`)

        // Create notification for the user
        const company = await prisma.company.findUnique({
          where: { id: thought.companyId },
          select: { userId: true },
        })

        if (company) {
          await prisma.notification.create({
            data: {
              userId: company.userId,
              companyId: thought.companyId,
              type: 'thought_response',
              title: 'Team responded to your thought',
              body: 'One of your agents replied to something you shared',
              emoji: '💬',
              actionUrl: `/db-team?thought=${thought.id}`,
              actionLabel: 'View response',
            },
          })
        }
      } catch (err) {
        console.error(`[thoughts] Failed to respond to thought ${thought.id}:`, err)
      }
    }
  } catch (err) {
    console.error('[thoughts] Error in processThoughtResponses:', err)
  }
}
