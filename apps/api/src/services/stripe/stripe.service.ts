import Stripe from 'stripe'
import prisma from '../../lib/prisma'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-04-10',
})


// ─── PRICE IDS ────────────────────────────────────────────────────────────────

const PRICE_IDS = {
  starter: {
    monthly: process.env.STRIPE_STARTER_MONTHLY_PRICE_ID || '',
    annual: process.env.STRIPE_STARTER_ANNUAL_PRICE_ID || '',
  },
  pro: {
    monthly: process.env.STRIPE_PRO_MONTHLY_PRICE_ID || '',
    annual: process.env.STRIPE_PRO_ANNUAL_PRICE_ID || '',
  },
  agency: {
    monthly: process.env.STRIPE_AGENCY_MONTHLY_PRICE_ID || '',
    annual: process.env.STRIPE_AGENCY_ANNUAL_PRICE_ID || '',
  },
}

// ─── CREATE CHECKOUT SESSION ──────────────────────────────────────────────────

export async function createCheckoutSession({
  userId,
  plan,
  billing,
  successUrl,
  cancelUrl,
}: {
  userId: string
  plan: 'starter' | 'pro' | 'agency'
  billing: 'monthly' | 'annual'
  successUrl: string
  cancelUrl: string
}): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })

  const priceId = PRICE_IDS[plan][billing]

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { userId, plan, billing },
    subscription_data: {
      trial_period_days: 7,
      metadata: { userId, plan },
    },
  }

  // Attach existing Stripe customer if they have one
  if (user.stripeCustomerId) {
    sessionParams.customer = user.stripeCustomerId
  } else {
    sessionParams.customer_email = user.email
  }

  const session = await stripe.checkout.sessions.create(sessionParams)

  return session.url!
}

// ─── CREATE BILLING PORTAL ────────────────────────────────────────────────────

export async function createBillingPortalSession(userId: string, returnUrl: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })

  if (!user.stripeCustomerId) {
    throw new Error('No Stripe customer found for this user')
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: returnUrl,
  })

  return session.url
}

// ─── WEBHOOK HANDLER ──────────────────────────────────────────────────────────

export async function handleStripeWebhook(payload: Buffer, signature: string): Promise<void> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || ''
  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret)
  } catch {
    throw new Error('Invalid webhook signature')
  }

  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutComplete(event.data.object as Stripe.Checkout.Session)
      break

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await handleSubscriptionUpdate(event.data.object as Stripe.Subscription)
      break

    case 'customer.subscription.deleted':
      await handleSubscriptionCanceled(event.data.object as Stripe.Subscription)
      break

    case 'invoice.payment_failed':
      await handlePaymentFailed(event.data.object as Stripe.Invoice)
      break
  }
}

// ─── WEBHOOK HANDLERS ─────────────────────────────────────────────────────────

async function handleCheckoutComplete(session: Stripe.Checkout.Session): Promise<void> {
  const userId = session.metadata?.userId
  const plan = session.metadata?.plan as 'starter' | 'pro' | 'agency'
  if (!userId || !plan) return

  await prisma.user.update({
    where: { id: userId },
    data: {
      stripeCustomerId: session.customer as string,
      stripeSubscriptionId: session.subscription as string,
      subscriptionStatus: 'active',
      plan,
    },
  })

  // Unlock additional employees based on plan
  await unlockEmployeesForPlan(userId, plan)
}

async function handleSubscriptionUpdate(subscription: Stripe.Subscription): Promise<void> {
  const userId = subscription.metadata?.userId
  if (!userId) return

  const plan = getPlanFromPriceId(subscription.items.data[0]?.price.id)

  await prisma.user.update({
    where: { id: userId },
    data: {
      subscriptionStatus: subscription.status === 'active' ? 'active' : 'past_due',
      plan: plan || undefined,
    },
  })
}

async function handleSubscriptionCanceled(subscription: Stripe.Subscription): Promise<void> {
  const userId = subscription.metadata?.userId
  if (!userId) return

  await prisma.user.update({
    where: { id: userId },
    data: { subscriptionStatus: 'canceled' },
  })
}

async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId = invoice.customer as string
  const user = await prisma.user.findFirst({ where: { stripeCustomerId: customerId } })
  if (!user) return

  await prisma.user.update({
    where: { id: user.id },
    data: { subscriptionStatus: 'past_due' },
  })

  // Send payment failed email
  try {
    const { triggerPaymentFailedEmail } = require('../../lib/emailTriggers')
    triggerPaymentFailedEmail(user.id)
  } catch {}
}

// ─── PLAN HELPERS ─────────────────────────────────────────────────────────────

function getPlanFromPriceId(priceId?: string): 'starter' | 'pro' | 'agency' | null {
  if (!priceId) return null
  for (const [plan, prices] of Object.entries(PRICE_IDS)) {
    if (Object.values(prices).includes(priceId)) {
      return plan as 'starter' | 'pro' | 'agency'
    }
  }
  return null
}

/**
 * Starter: 2 employees (Maya + Alex)
 * Pro/Agency: All 4 employees
 */
async function unlockEmployeesForPlan(userId: string, plan: string): Promise<void> {
  const companies = await prisma.company.findMany({ where: { userId } })

  for (const company of companies) {
    if (plan === 'starter') {
      await prisma.employee.updateMany({
        where: { companyId: company.id, role: { in: ['strategist', 'creative_director'] } },
        data: { isActive: false },
      })
    } else {
      await prisma.employee.updateMany({
        where: { companyId: company.id },
        data: { isActive: true },
      })
    }
  }
}
