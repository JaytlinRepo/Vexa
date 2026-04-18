import { Router, raw } from 'express'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import {
  createCheckoutSession,
  createBillingPortalSession,
  handleStripeWebhook,
} from '../services/stripe/stripe.service'

const router = Router()

// ─── POST /api/stripe/checkout — Create a Stripe checkout session ────────────

router.post('/checkout', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const { plan, billing } = req.body as {
      plan?: 'starter' | 'pro' | 'agency'
      billing?: 'monthly' | 'annual'
    }

    if (!plan || !['starter', 'pro', 'agency'].includes(plan)) {
      res.status(400).json({ error: 'Invalid plan. Must be starter, pro, or agency.' })
      return
    }

    const billingCycle = billing === 'annual' ? 'annual' : 'monthly'
    const origin = req.headers.origin || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    const url = await createCheckoutSession({
      userId,
      plan,
      billing: billingCycle,
      successUrl: `${origin}/?checkout=success`,
      cancelUrl: `${origin}/?checkout=canceled`,
    })

    res.json({ url })
  } catch (err) {
    next(err)
  }
})

// ─── POST /api/stripe/portal — Open Stripe billing portal ───────────────────

router.post('/portal', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const origin = req.headers.origin || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    const url = await createBillingPortalSession(userId, `${origin}/`)

    res.json({ url })
  } catch (err) {
    if ((err as Error).message?.includes('No Stripe customer')) {
      res.status(400).json({ error: 'No subscription found. Subscribe first.' })
      return
    }
    next(err)
  }
})

// ─── POST /api/stripe/webhook — Stripe webhook handler ──────────────────────
// IMPORTANT: This endpoint must receive the RAW body (not JSON-parsed).
// Express's json() middleware is applied globally, so we need to skip it
// for this route. The raw body is passed via express.raw() middleware
// registered in index.ts specifically for this path.

router.post('/webhook', async (req, res, next) => {
  try {
    const signature = req.headers['stripe-signature'] as string
    if (!signature) {
      res.status(400).json({ error: 'Missing stripe-signature header' })
      return
    }

    await handleStripeWebhook(req.body, signature)

    res.json({ received: true })
  } catch (err) {
    const message = (err as Error).message || 'Webhook error'
    console.error('[stripe] webhook error:', message)
    if (message.includes('Invalid webhook signature')) {
      res.status(400).json({ error: message })
    } else {
      res.status(500).json({ error: message })
    }
  }
})

// ─── GET /api/stripe/subscription — Get current subscription details ─────────

router.get('/subscription', requireAuth, async (req, res, next) => {
  try {
    const { PrismaClient } = await import('@prisma/client')
    const prisma = new PrismaClient()
    const { userId } = (req as AuthedRequest).session

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        plan: true,
        subscriptionStatus: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        trialEndsAt: true,
      },
    })

    if (!user) {
      res.status(404).json({ error: 'user_not_found' })
      return
    }

    const trialDaysLeft = user.trialEndsAt
      ? Math.max(0, Math.ceil((new Date(user.trialEndsAt).getTime() - Date.now()) / 86400000))
      : null

    res.json({
      plan: user.plan,
      status: user.subscriptionStatus,
      hasStripeCustomer: !!user.stripeCustomerId,
      hasSubscription: !!user.stripeSubscriptionId,
      trialDaysLeft,
      trialEndsAt: user.trialEndsAt,
    })

    await prisma.$disconnect()
  } catch (err) {
    next(err)
  }
})

export default router
