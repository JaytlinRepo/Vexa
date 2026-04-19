import { Router } from 'express'
import { z } from 'zod'
import prisma from '../lib/prisma'

const router = Router()

const waitlistSchema = z.object({
  email: z.string().email(),
  name: z.string().max(120).optional(),
})

// POST /api/waitlist — join the waitlist
router.post('/', async (req, res, next) => {
  try {
    const data = waitlistSchema.parse(req.body)

    const existing = await prisma.waitlistEntry.findUnique({
      where: { email: data.email },
    })

    if (existing) {
      res.json({ ok: true, message: 'already_on_list' })
      return
    }

    await prisma.waitlistEntry.create({
      data: {
        email: data.email,
        name: data.name,
        source: 'website',
      },
    })

    // Send welcome email
    try {
      const { Resend } = await import('resend')
      const resend = new Resend(process.env.RESEND_API_KEY || '')
      await resend.emails.send({
        from: 'Sovexa <team@sovexa.ai>',
        to: data.email,
        subject: "You're on the list",
        html: `
          <div style="font-family:'DM Sans',system-ui,sans-serif;max-width:520px;margin:0 auto;padding:40px 20px">
            <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:400;font-style:italic;color:#1a1a1a;margin:0 0 16px">Welcome to Sovexa.</h1>
            <p style="font-size:15px;line-height:1.7;color:#555;margin:0 0 20px">
              ${data.name ? data.name + ', you' : 'You'}'re on the early access list. We're building something different — an AI content team that works for you, not a chatbot you have to manage.
            </p>
            <p style="font-size:15px;line-height:1.7;color:#555;margin:0 0 20px">
              When we launch, you'll be first in line. Your team — Maya, Jordan, Alex, and Riley — will be ready to go.
            </p>
            <p style="font-size:13px;color:#999;margin:0">
              — The Sovexa team
            </p>
          </div>
        `,
      })
    } catch (emailErr) {
      console.warn('[waitlist] email send failed:', (emailErr as Error).message)
    }

    res.status(201).json({ ok: true, message: 'joined' })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'invalid_email', issues: err.issues })
      return
    }
    next(err)
  }
})

// GET /api/waitlist/count — public count for social proof
router.get('/count', async (_req, res, next) => {
  try {
    const count = await prisma.waitlistEntry.count()
    res.json({ count })
  } catch (err) {
    next(err)
  }
})

export default router
