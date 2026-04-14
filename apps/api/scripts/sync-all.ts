/**
 * Manually trigger the same sync the scheduled cron runs.
 *
 * Usage:
 *   npm run sync:all --workspace @vexa/api
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { syncAllConnectedAccounts } from '../src/lib/phylloSync'

const prisma = new PrismaClient()

async function main() {
  console.log('[sync-all] starting…')
  const results = await syncAllConnectedAccounts(prisma)
  console.log(`[sync-all] done — ${results.length} accounts`)
  for (const r of results) {
    const tag = r.error ? 'ERR  ' : r.sparse ? 'SPRS ' : r.skipped ? 'SKIP ' : 'OK   '
    const detail = r.error || r.skipped || `${r.followers.toLocaleString()} followers`
    console.log(`  ${tag} ${r.platform.padEnd(20)} @${(r.handle || '—').padEnd(20)} ${detail}`)
  }
}

main()
  .catch((e) => {
    console.error('[sync-all] failed', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
