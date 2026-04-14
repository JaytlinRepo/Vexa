import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  console.log('\n──── PlatformAccount rows ────')
  const accts = await prisma.platformAccount.findMany({
    select: { id: true, platform: true, handle: true, status: true, accountType: true, phylloAccountId: true, lastSyncedAt: true, connectedAt: true, disconnectedAt: true },
    orderBy: { connectedAt: 'desc' },
  })
  console.log(JSON.stringify(accts, null, 2))

  console.log('\n──── InstagramConnection rows ────')
  const igs = await prisma.instagramConnection.findMany({
    select: { id: true, handle: true, source: true, accountType: true, followerCount: true, engagementRate: true, phylloAccountId: true, lastSyncedAt: true, connectedAt: true },
  })
  console.log(JSON.stringify(igs, null, 2))

  console.log('\n──── Snapshots (last 10 per account) ────')
  const snaps = await prisma.platformSnapshot.findMany({
    orderBy: { capturedAt: 'desc' },
    take: 20,
  })
  console.log(JSON.stringify(snaps, null, 2))

  console.log('\n──── Users with Phyllo ────')
  const users = await prisma.user.findMany({
    where: { phylloUserId: { not: null } },
    select: { id: true, email: true, phylloUserId: true },
  })
  console.log(JSON.stringify(users, null, 2))

  await prisma.$disconnect()
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
