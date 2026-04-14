/**
 * Shared Phyllo sync routine used by the HTTP route, the scheduled cron,
 * and the manual CLI script. Given an accountId, pulls fresh data from
 * Phyllo, writes it to both InstagramConnection (legacy) and the
 * generalized Platform* tables (history). Idempotent and safe to call as
 * often as every minute.
 */

import { PrismaClient } from '@prisma/client'
import * as phyllo from './phyllo'
import { mapPhylloToStub } from './phylloMapper'
import { persistPhylloSync } from './platformSync'
import { writeMemory } from './brandMemory'
import { createNotification } from '../services/notifications/notification.service'
import { runWatch } from './metricsWatch'

export interface SyncResult {
  accountId: string
  platform: string
  handle: string | null
  followers: number
  sparse: boolean
  skipped?: string
  error?: string
}

const INSTAGRAM_VARIANTS = new Set(['instagram', 'instagram direct', 'instagram lite'])

export async function syncPhylloAccount(
  prisma: PrismaClient,
  companyId: string,
  userId: string,
  phylloUserId: string,
  accountId: string,
  opts: { writeMemory?: boolean; writeNotification?: boolean } = {},
): Promise<SyncResult> {
  const account = await phyllo.getAccount(accountId)
  if (phyllo.accountOwnerId(account) !== phylloUserId) {
    return {
      accountId,
      platform: account.work_platform?.name || '',
      handle: account.platform_username,
      followers: 0,
      sparse: false,
      error: 'account_not_owned',
    }
  }

  const platformName = (account.work_platform?.name || '').toLowerCase()
  const isInstagram = INSTAGRAM_VARIANTS.has(platformName)

  // Pull analytics in parallel; each is best-effort.
  const [profile, contents, audience] = await Promise.allSettled([
    phyllo.getProfile(accountId),
    phyllo.getContents(accountId, 30),
    phyllo.getAudience(accountId),
  ])
  const profileItem = profile.status === 'fulfilled' ? profile.value.data?.[0] ?? null : null
  const contentList = contents.status === 'fulfilled' ? contents.value : { data: [] }
  const audienceRes = audience.status === 'fulfilled' ? audience.value : null

  const stub = mapPhylloToStub({ account, profile: profileItem, contents: contentList, audience: audienceRes })
  const sparse = stub.followerCount === 0 && stub.recentMedia.length === 0

  // Legacy InstagramConnection row — only for IG variants.
  if (isInstagram) {
    const payload = {
      handle: stub.username || account.platform_username || '',
      profileUrl: stub.profileUrl,
      accountType: stub.accountType,
      bio: stub.bio,
      followerCount: stub.followerCount,
      followingCount: stub.followingCount,
      postCount: stub.postCount,
      engagementRate: stub.engagementRate,
      avgReach: stub.avgReach,
      avgImpressions: stub.avgImpressions,
      topPosts: stub.topPosts as unknown as object,
      recentMedia: stub.recentMedia as unknown as object,
      followerSeries: stub.followerSeries as unknown as object,
      audienceAge: stub.audienceAge as unknown as object,
      audienceGender: stub.audienceGender as unknown as object,
      audienceTop: stub.audienceTopCountries as unknown as object,
      audienceCities: stub.audienceTopCities as unknown as object,
      igUserId: stub.igUserId,
      phylloAccountId: account.id,
      platform: platformName,
      source: 'phyllo',
      lastSyncedAt: new Date(),
    }
    await prisma.instagramConnection.upsert({
      where: { companyId },
      update: { ...payload, connectedAt: new Date() },
      create: { companyId, ...payload },
    })
  }

  // New generalized tables (all platforms).
  let internalAccountId: string | null = null
  try {
    const persisted = await persistPhylloSync(prisma, companyId, phylloUserId, account, stub)
    internalAccountId = persisted.accountId
  } catch (e) {
    console.warn('[phylloSync] platform-snapshot write failed', e)
  }

  // Maya's watch loop — compare the snapshot we just wrote against recent
  // history and, if engagement has dropped / followers declined / growth
  // has flatlined, emit a Maya-voiced notification. De-duped for 20h
  // inside runWatch.
  if (internalAccountId && !sparse) {
    try {
      await runWatch(prisma, {
        userId,
        companyId,
        accountId: internalAccountId,
        handle: stub.username || account.platform_username || 'your account',
      })
    } catch (e) {
      console.warn('[phylloSync] watch run failed', e)
    }
  }

  // Memory + notification only on the first good snapshot, not on every
  // scheduled re-sync (would spam the bell).
  if (opts.writeMemory && !sparse && isInstagram) {
    try {
      const topCap = (stub.topPosts[0]?.caption || '').slice(0, 80)
      await writeMemory(prisma, {
        companyId,
        type: 'performance',
        weight: 1.5,
        content: {
          source: 'instagram',
          summary: `Instagram @${stub.username}: ${stub.followerCount.toLocaleString()} followers, ${stub.engagementRate}% engagement${topCap ? `, top post "${topCap}"` : ''}`,
          tags: ['instagram', 'analytics'],
        },
      })
    } catch (e) {
      console.warn('[phylloSync] memory write failed', e)
    }
  }
  if (opts.writeNotification && !sparse && isInstagram) {
    try {
      await createNotification({
        userId,
        companyId,
        type: 'team_update',
        emoji: '',
        title: 'Instagram synced',
        body: `Maya has the real numbers for @${stub.username}. Your team is working from live data now.`,
      })
    } catch (e) {
      console.warn('[phylloSync] notification write failed', e)
    }
  }

  return {
    accountId,
    platform: account.work_platform?.name || '',
    handle: account.platform_username,
    followers: stub.followerCount,
    sparse,
    skipped: isInstagram ? undefined : 'non_instagram_legacy_not_persisted',
  }
}

/**
 * Sync every connected platform account across every user. Called by the
 * scheduler and the CLI.
 */
export async function syncAllConnectedAccounts(prisma: PrismaClient): Promise<SyncResult[]> {
  const accounts = await prisma.platformAccount.findMany({
    where: { status: 'connected' },
    include: { company: { include: { user: { select: { id: true, phylloUserId: true } } } } },
  })
  const results: SyncResult[] = []
  for (const acct of accounts) {
    if (!acct.phylloAccountId || !acct.company.user.phylloUserId) continue
    try {
      const r = await syncPhylloAccount(
        prisma,
        acct.companyId,
        acct.company.user.id,
        acct.company.user.phylloUserId,
        acct.phylloAccountId,
      )
      results.push(r)
    } catch (err) {
      results.push({
        accountId: acct.phylloAccountId,
        platform: acct.platform,
        handle: acct.handle,
        followers: 0,
        sparse: false,
        error: (err as Error).message,
      })
    }
  }
  return results
}
