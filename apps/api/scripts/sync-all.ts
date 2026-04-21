/**
 * Manually trigger platform syncs (Instagram + TikTok).
 *
 * Usage:
 *   npm run sync:all --workspace @vexa/api
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { syncInstagramAccount } from '../src/lib/instagramSync'
import { syncTiktokAccount } from '../src/lib/tiktokRefreshSync'

const prisma = new PrismaClient()

async function main() {
  console.log('[sync-all] starting…')

  // Instagram
  const igConns = await prisma.instagramConnection.findMany({ select: { companyId: true, handle: true } })
  for (const { companyId, handle } of igConns) {
    try {
      const result = await syncInstagramAccount(prisma, companyId)
      console.log(`  IG   @${handle.padEnd(20)} ${result.synced ? `OK (${result.newPosts} new posts)` : result.reason || 'skipped'}`)
    } catch (e) {
      console.log(`  IG   @${handle.padEnd(20)} ERR: ${(e as Error).message}`)
    }
  }

  // TikTok
  const ttConns = await prisma.tiktokConnection.findMany({ select: { companyId: true, handle: true } })
  for (const { companyId, handle } of ttConns) {
    try {
      await syncTiktokAccount(prisma, companyId)
      console.log(`  TT   @${(handle || '—').padEnd(20)} OK`)
    } catch (e) {
      console.log(`  TT   @${(handle || '—').padEnd(20)} ERR: ${(e as Error).message}`)
    }
  }

  console.log(`[sync-all] done — ${igConns.length} IG + ${ttConns.length} TT accounts`)
}

main()
  .catch((e) => {
    console.error('[sync-all] failed', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
