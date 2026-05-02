/**
 * One-time migration: move all users currently on plan=starter to their new landing plan.
 *
 * Strategy:
 *   - Active paying subscribers (has stripeSubscriptionId, status active/past_due) → TARGET_PAID
 *     They were paying $19/mo. Confirm with them before upgrading to Pro ($59).
 *     Alternatively set TARGET_PAID = 'starter' to grandfather them in place until
 *     they explicitly upgrade — the starter PLAN_LIMITS entry is kept for this.
 *   - Everyone else (no subscription, canceled, free-riders) → TARGET_FREE
 *
 * HOW TO RUN:
 *   cd apps/api
 *   npx ts-node --project tsconfig.json src/scripts/migrate-starter-users.ts
 *
 * DRY RUN (no writes): set DRY_RUN=true below or set env DRY_RUN=1
 */

import prisma from '../lib/prisma'

// ─── CONFIGURE BEFORE RUNNING ────────────────────────────────────────────────

const TARGET_PAID: 'pro' | 'agency' | 'starter' = 'pro'    // paid starter → this plan
const TARGET_FREE: 'free' = 'free'                          // non-paying starter → free
const DRY_RUN = process.env.DRY_RUN === '1' || false

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[migrate-starter] DRY_RUN=${DRY_RUN}`)
  console.log(`[migrate-starter] Paid landing: ${TARGET_PAID} | Non-paid landing: ${TARGET_FREE}\n`)

  const starters = await prisma.user.findMany({
    where: { plan: 'starter' },
    select: {
      id: true,
      email: true,
      subscriptionStatus: true,
      stripeSubscriptionId: true,
      plan: true,
    },
  })

  console.log(`Found ${starters.length} user(s) on starter plan.\n`)

  const paid   = starters.filter(u => u.stripeSubscriptionId && ['active', 'past_due'].includes(u.subscriptionStatus))
  const unpaid = starters.filter(u => !paid.includes(u))

  console.log(`  ${paid.length} paying subscriber(s)   → ${TARGET_PAID}`)
  console.log(`  ${unpaid.length} non-paying user(s)   → ${TARGET_FREE}\n`)

  if (!DRY_RUN && paid.length > 0) {
    await prisma.user.updateMany({
      where: { id: { in: paid.map(u => u.id) } },
      data: { plan: TARGET_PAID },
    })
    console.log(`[migrate-starter] Updated ${paid.length} paid subscriber(s) → ${TARGET_PAID}`)
    for (const u of paid) console.log(`  ${u.email} (${u.subscriptionStatus})`)
  } else if (paid.length > 0) {
    console.log('[DRY RUN] Would update paid subscribers:')
    for (const u of paid) console.log(`  ${u.email} → ${TARGET_PAID}`)
  }

  if (!DRY_RUN && unpaid.length > 0) {
    await prisma.user.updateMany({
      where: { id: { in: unpaid.map(u => u.id) } },
      data: { plan: TARGET_FREE },
    })
    console.log(`[migrate-starter] Updated ${unpaid.length} non-paying user(s) → ${TARGET_FREE}`)
    for (const u of unpaid) console.log(`  ${u.email} (${u.subscriptionStatus})`)
  } else if (unpaid.length > 0) {
    console.log('[DRY RUN] Would update non-paying users:')
    for (const u of unpaid) console.log(`  ${u.email} → ${TARGET_FREE}`)
  }

  console.log('\n[migrate-starter] Done.')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
