/**
 * Worker Entrypoint
 *
 * Starts all BullMQ workers in a separate Node process.
 * Run: tsx watch src/workers/index.ts (dev)
 *      node dist/workers/index.js (prod)
 */

import 'dotenv/config'
import { createVideoProcessingWorker } from './video-processing.worker'
import { createAgentTasksWorker } from './agent-tasks.worker'
import { createContentAnalysisWorker } from './content-analysis.worker'
import { createPlatformSyncWorker } from './platform-sync.worker'

console.log('[workers] starting all workers...')

const workers = [
  createVideoProcessingWorker(),
  createAgentTasksWorker(),
  createContentAnalysisWorker(),
  createPlatformSyncWorker(),
]

console.log(`[workers] ${workers.length} workers started`)

// Graceful shutdown
async function shutdown() {
  console.log('[workers] shutting down...')
  await Promise.all(workers.map((w) => w.close()))
  console.log('[workers] all workers stopped')
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
