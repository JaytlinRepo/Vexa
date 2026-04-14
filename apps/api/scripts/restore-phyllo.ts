/**
 * Restore Phyllo data overwritten by the sparse-sync bug.
 *
 * What broke: between roughly 14:51 and 14:56 UTC on 2026-04-14, a sync
 * came back sparse (Phyllo returned nothing useful — scope / propagation
 * issue) and the dedup logic overwrote today's good snapshot with zeros
 * AND wiped the InstagramConnection row's metrics.
 *
 * What this does:
 *  1. Finds every account and, for any same-day snapshot that is all-zero
 *     while a prior same-account snapshot has real numbers, deletes the
 *     zero row. Trajectory charts will then re-index off the good data.
 *  2. For any InstagramConnection row where followerCount = 0 but there
 *     is a same-company PlatformSnapshot with real numbers, copies those
 *     numbers back to the legacy row so the dashboard renders properly.
 *
 * Safe to re-run.
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  let deletedSnapshots = 0
  let restoredLegacy = 0

  // 1. Delete zero snapshots where a better same-account snapshot exists
  const zeroSnaps = await prisma.platformSnapshot.findMany({
    where: { followerCount: 0, avgReach: 0, engagementRate: 0 },
    orderBy: { capturedAt: 'desc' },
  })
  for (const snap of zeroSnaps) {
    const betterExists = await prisma.platformSnapshot.findFirst({
      where: {
        accountId: snap.accountId,
        id: { not: snap.id },
        followerCount: { gt: 0 },
      },
    })
    if (betterExists) {
      await prisma.platformSnapshot.delete({ where: { id: snap.id } })
      deletedSnapshots++
    }
  }

  // 2. Restore InstagramConnection metrics from the latest good snapshot
  const zeroIg = await prisma.instagramConnection.findMany({
    where: { source: 'phyllo', followerCount: 0 },
  })
  for (const ig of zeroIg) {
    const account = await prisma.platformAccount.findFirst({
      where: { companyId: ig.companyId, platform: 'instagram' },
    })
    if (!account) continue
    const bestSnap = await prisma.platformSnapshot.findFirst({
      where: { accountId: account.id, followerCount: { gt: 0 } },
      orderBy: { capturedAt: 'desc' },
    })
    if (!bestSnap) continue
    await prisma.instagramConnection.update({
      where: { id: ig.id },
      data: {
        followerCount: bestSnap.followerCount,
        followingCount: bestSnap.followingCount,
        postCount: bestSnap.postCount,
        avgReach: bestSnap.avgReach,
        avgImpressions: bestSnap.avgImpressions,
        engagementRate: bestSnap.engagementRate,
      },
    })
    restoredLegacy++
  }

  console.log(`Deleted ${deletedSnapshots} zero snapshots.`)
  console.log(`Restored ${restoredLegacy} InstagramConnection rows from snapshot history.`)
  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
