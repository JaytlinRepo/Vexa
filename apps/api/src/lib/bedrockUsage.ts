/**
 * Thin re-export shim. All state now lives in rateLimitStore (Redis-backed
 * with in-memory fallback) so usage survives server restarts and works
 * correctly across multiple App Runner instances.
 */

export {
  trackBedrockCall,
  getBedrockUsage,
  getAllBedrockUsage,
  estimateCost,
  type BedrockRecord as InvocationRecord,
} from './rateLimitStore'
