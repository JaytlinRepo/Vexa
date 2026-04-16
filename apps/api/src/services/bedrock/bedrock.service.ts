import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime'

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0'
const BEDROCK_REGION = process.env.AWS_BEDROCK_REGION || 'us-east-1'

const client = new BedrockRuntimeClient({ region: BEDROCK_REGION })

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface BedrockMessage {
  role: 'user' | 'assistant'
  content: string
}

interface InvokeOptions {
  systemPrompt: string
  messages: BedrockMessage[]
  maxTokens?: number
  temperature?: number
}

interface StreamOptions extends InvokeOptions {
  onChunk: (text: string) => void
  onComplete: (fullText: string) => void
  onError: (error: Error) => void
}

// ─── CORE INVOKE (structured output) ─────────────────────────────────────────

/**
 * Standard invoke for structured JSON outputs from agents.
 * Used for: trend reports, content plans, hooks, scripts, shot lists.
 */
export async function invokeAgent(options: InvokeOptions): Promise<string> {
  const { systemPrompt, messages, maxTokens = 2048, temperature = 0.7 } = options

  const body = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    messages,
  })

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    body,
    contentType: 'application/json',
    accept: 'application/json',
  })

  const response = await client.send(command)
  const responseBody = JSON.parse(new TextDecoder().decode(response.body))

  return responseBody.content[0].text
}

// ─── STREAMING INVOKE (meeting conversations) ─────────────────────────────────

/**
 * Streaming invoke for meeting conversations.
 * Gives real-time feel as the employee "responds" in the meeting room.
 */
export async function invokeAgentStream(options: StreamOptions): Promise<void> {
  const { systemPrompt, messages, maxTokens = 1024, temperature = 0.8, onChunk, onComplete, onError } = options

  const body = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    messages,
  })

  const command = new InvokeModelWithResponseStreamCommand({
    modelId: MODEL_ID,
    body,
    contentType: 'application/json',
    accept: 'application/json',
  })

  try {
    const response = await client.send(command)
    let fullText = ''

    if (!response.body) throw new Error('No response body from Bedrock')

    for await (const event of response.body) {
      if (event.chunk?.bytes) {
        const chunk = JSON.parse(new TextDecoder().decode(event.chunk.bytes))

        if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
          const text = chunk.delta.text
          fullText += text
          onChunk(text)
        }
      }
    }

    onComplete(fullText)
  } catch (error) {
    onError(error instanceof Error ? error : new Error('Bedrock streaming error'))
  }
}

// ─── STRUCTURED OUTPUT PARSER ─────────────────────────────────────────────────

/**
 * Parse and validate agent JSON output.
 * Strips any accidental markdown code fences before parsing.
 */
export function parseAgentOutput<T>(rawOutput: string): T {
  // Strip markdown fences
  let cleaned = rawOutput
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim()

  // If the LLM added prose before/after the JSON, extract the outermost { ... }
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1)
  }

  try {
    return JSON.parse(cleaned) as T
  } catch (firstErr) {
    // Common Haiku issue: trailing commas before closing brace/bracket
    const repaired = cleaned
      .replace(/,\s*}/g, '}')
      .replace(/,\s*]/g, ']')
    try {
      return JSON.parse(repaired) as T
    } catch {
      // Surface the original error with context for debugging
      const preview = cleaned.slice(0, 200)
      throw new Error(`JSON parse failed: ${(firstErr as Error).message} — preview: ${preview}`)
    }
  }
}

// ─── PROMPT BUILDER ───────────────────────────────────────────────────────────

/**
 * Build a layered agent prompt combining personality, niche context, and brand memory.
 */
export function buildLayeredPrompt({
  baseSystemPrompt,
  nicheContext,
  brandMemory,
  recentOutputSummary,
  platformData,
}: {
  baseSystemPrompt: string
  nicheContext?: string
  brandMemory?: string
  recentOutputSummary?: string
  platformData?: string
}): string {
  let prompt = baseSystemPrompt

  if (nicheContext) {
    prompt += `\n\n## Niche Knowledge (RAG)\n${nicheContext}`
  }

  if (brandMemory) {
    prompt += `\n\n## Brand Memory (What You've Learned About This Creator)\n${brandMemory}`
  }

  if (recentOutputSummary) {
    prompt += `\n\n## Recent Work Context\n${recentOutputSummary}`
  }

  if (platformData) {
    prompt += `\n\n## Creator's Platform Data (Live Numbers)\n${platformData}`
  }

  return prompt
}

// ─── BEDROCK KNOWLEDGE BASE (RAG) ────────────────────────────────────────────

import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
} from '@aws-sdk/client-bedrock-agent-runtime'

const agentRuntimeClient = new BedrockAgentRuntimeClient({ region: BEDROCK_REGION })

const KNOWLEDGE_BASE_IDS: Record<string, string> = {
  fitness: process.env.AWS_KNOWLEDGE_BASE_ID_FITNESS || '',
  finance: process.env.AWS_KNOWLEDGE_BASE_ID_FINANCE || '',
  food: process.env.AWS_KNOWLEDGE_BASE_ID_FOOD || '',
  coaching: process.env.AWS_KNOWLEDGE_BASE_ID_COACHING || '',
  lifestyle: process.env.AWS_KNOWLEDGE_BASE_ID_LIFESTYLE || '',
  personal_development: process.env.AWS_KNOWLEDGE_BASE_ID_PERSONAL_DEV || '',
}

/**
 * Retrieve niche-relevant context from AWS Bedrock Knowledge Bases.
 * Called when building agent prompts to inject RAG context.
 */
export async function retrieveNicheContext(niche: string, query: string): Promise<string> {
  const knowledgeBaseId = KNOWLEDGE_BASE_IDS[niche.toLowerCase()]

  if (!knowledgeBaseId) {
    console.warn(`No knowledge base configured for niche: ${niche}`)
    return ''
  }

  const command = new RetrieveCommand({
    knowledgeBaseId,
    retrievalQuery: { text: query },
    retrievalConfiguration: {
      vectorSearchConfiguration: { numberOfResults: 5 },
    },
  })

  const response = await agentRuntimeClient.send(command)

  if (!response.retrievalResults?.length) return ''

  return response.retrievalResults
    .map(r => r.content?.text || '')
    .filter(Boolean)
    .join('\n\n')
}
