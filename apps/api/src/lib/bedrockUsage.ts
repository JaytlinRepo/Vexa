/**
 * Lightweight Bedrock invocation tracker. Counts calls per company
 * in-memory and exposes totals for the usage endpoint + cost alerts.
 *
 * For now in-memory is sufficient — resets on server restart, which is
 * fine for dev. For production, flush to a DB table on a timer.
 */

interface InvocationRecord {
  count: number
  inputTokens: number
  outputTokens: number
  lastCallAt: Date
}

// companyId → monthly bucket → record
const usage = new Map<string, InvocationRecord>()

function bucketKey(companyId: string): string {
  const d = new Date()
  return `${companyId}:${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function trackBedrockCall(companyId: string | undefined, inputTokens = 0, outputTokens = 0): void {
  if (!companyId) return
  const key = bucketKey(companyId)
  const existing = usage.get(key) || { count: 0, inputTokens: 0, outputTokens: 0, lastCallAt: new Date() }
  existing.count++
  existing.inputTokens += inputTokens
  existing.outputTokens += outputTokens
  existing.lastCallAt = new Date()
  usage.set(key, existing)
}

export function getBedrockUsage(companyId: string): InvocationRecord {
  const key = bucketKey(companyId)
  return usage.get(key) || { count: 0, inputTokens: 0, outputTokens: 0, lastCallAt: new Date(0) }
}

export function getAllBedrockUsage(): Array<{ key: string } & InvocationRecord> {
  return [...usage.entries()].map(([key, record]) => ({ key, ...record }))
}

// Rough cost estimate: Haiku input $0.25/MTok, output $1.25/MTok
export function estimateCost(record: InvocationRecord): number {
  return (record.inputTokens / 1_000_000) * 0.25 + (record.outputTokens / 1_000_000) * 1.25
}
