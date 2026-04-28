import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime'
import { trackBedrockCall } from '../../lib/bedrockUsage'

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const DEFAULT_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0'
const BEDROCK_REGION = process.env.AWS_BEDROCK_REGION || 'us-east-1'

const client = new BedrockRuntimeClient({ region: BEDROCK_REGION })

// ─── TYPES ────────────────────────────────────────────────────────────────────

type BedrockContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

interface BedrockMessage {
  role: 'user' | 'assistant'
  content: string | BedrockContentBlock[]
}

interface InvokeOptions {
  systemPrompt: string
  messages: BedrockMessage[]
  maxTokens?: number
  temperature?: number
  modelId?: string
  companyId?: string
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
  const { systemPrompt, messages, maxTokens = 2048, temperature = 0.7, modelId } = options
  const useModel = modelId || DEFAULT_MODEL_ID

  const body = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    messages,
  })

  const command = new InvokeModelCommand({
    modelId: useModel,
    body,
    contentType: 'application/json',
    accept: 'application/json',
  })

  const response = await client.send(command)
  const responseBody = JSON.parse(new TextDecoder().decode(response.body))

  // Track usage for cost monitoring
  trackBedrockCall(
    options.companyId,
    responseBody.usage?.input_tokens || 0,
    responseBody.usage?.output_tokens || 0,
  )

  return responseBody.content[0].text
}

// ─── STREAMING INVOKE (meeting conversations) ─────────────────────────────────

/**
 * Streaming invoke for meeting conversations.
 * Gives real-time feel as the employee "responds" in the meeting room.
 */
export async function invokeAgentStream(options: StreamOptions): Promise<void> {
  const { systemPrompt, messages, maxTokens = 1024, temperature = 0.8, modelId, onChunk, onComplete, onError } = options
  const useModel = modelId || DEFAULT_MODEL_ID

  const body = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    messages,
  })

  const command = new InvokeModelWithResponseStreamCommand({
    modelId: useModel,
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
 * Escape inner double-quotes inside JSON string values. Walks the input
 * tracking whether we're inside a string; any `"` we encounter while
 * already inside a string AND not followed by a JSON-delimiter token is
 * treated as an unescaped inner quote and replaced with `\"`.
 */
function escapeInnerQuotes(input: string): string {
  let out = ''
  let inString = false
  let prev = ''
  for (let i = 0; i < input.length; i++) {
    const c = input[i]
    if (c === '"' && prev !== '\\') {
      if (!inString) {
        inString = true
        out += c
      } else {
        // Look ahead for what comes after, ignoring whitespace
        let j = i + 1
        while (j < input.length && /\s/.test(input[j])) j++
        const next = input[j] || ''
        if (next === ',' || next === '}' || next === ']' || next === ':' || j >= input.length) {
          // Closing quote of the string
          inString = false
          out += c
        } else {
          // Inner quote — escape it
          out += '\\"'
        }
      }
    } else {
      out += c
    }
    prev = c
  }
  return out
}

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

  // Extract the outermost { ... } — LLM sometimes adds prose before/after
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1)
  }

  // Attempt parse with progressively more aggressive repair
  const attempts: Array<[string, string]> = [
    [cleaned, 'raw'],
    // Fix trailing commas
    [cleaned.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']'), 'trailing-comma'],
    // Fix unescaped newlines inside string values
    [cleaned.replace(/(?<=":[\s]*"[^"]*)\n/g, '\\n'), 'newlines'],
    // Escape unescaped inner double-quotes inside string values.
    [escapeInnerQuotes(cleaned), 'inner-quotes'],
    // ONLY if the model used single quotes as the string delimiters (not
    // just inside string values). We detect this by looking for `: '` or
    // `[ '` patterns. Otherwise replacing all `'` corrupts apostrophes.
    [/[\[:][\s]*'/.test(cleaned) ? cleaned.replace(/'/g, '"') : cleaned, 'single-quotes'],
    // Nuclear: strip all control chars inside strings
    [cleaned.replace(/[\x00-\x1f]/g, ' ').replace(/,\s*}/g, '}').replace(/,\s*]/g, ']'), 'control-chars'],
  ]

  let lastErr: Error | null = null
  for (const [text, label] of attempts) {
    try {
      const result = JSON.parse(text) as T
      if (label !== 'raw') console.log(`[bedrock] JSON repaired via ${label}`)
      return result
    } catch (e) {
      lastErr = e as Error
    }
  }

  // Log the area around the error position for debugging
  const posMatch = lastErr?.message?.match(/position (\d+)/)
  const pos = posMatch ? Number(posMatch[1]) : 0
  const around = cleaned.slice(Math.max(0, pos - 80), pos + 80)
  throw new Error(`JSON parse failed after all repair attempts: ${lastErr?.message} — around position ${pos}: ...${around}...`)
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
    prompt += `\n\n## Creator's Platform Data (Live Numbers — Use These to Drive Specific Recommendations)\n${platformData}`
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
