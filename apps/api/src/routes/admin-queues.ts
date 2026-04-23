/**
 * Bull Board Dashboard
 *
 * Visual dashboard for monitoring all BullMQ queues.
 * Mounted at /admin/queues — protected by admin auth.
 */

import { createBullBoard } from '@bull-board/api'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'
import { ExpressAdapter } from '@bull-board/express'
import { videoQueue, agentQueue, contentQueue, syncQueue } from '../queues'

export function setupQueueDashboard() {
  const serverAdapter = new ExpressAdapter()
  serverAdapter.setBasePath('/admin/queues')

  createBullBoard({
    queues: [
      new BullMQAdapter(videoQueue),
      new BullMQAdapter(agentQueue),
      new BullMQAdapter(contentQueue),
      new BullMQAdapter(syncQueue),
    ],
    serverAdapter,
  })

  return serverAdapter.getRouter()
}
