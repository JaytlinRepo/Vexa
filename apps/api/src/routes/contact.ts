import { Router } from 'express'
import { z } from 'zod'

const router = Router()

const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  reason: z.enum(['sales', 'support', 'partnership', 'other']).default('other'),
  message: z.string().trim().min(1).max(4000),
})

const NOTIFY_EMAIL = process.env.ADMIN_EMAILS?.split(',')[0]?.trim() || 'hello@sovexa.ai'

router.post('/', async (req, res) => {
  try {
    const body = contactSchema.parse(req.body)

    console.log('[contact]', {
      name: body.name,
      email: body.email,
      reason: body.reason,
      messageLength: body.message.length,
    })

    // Email the submission to the admin
    try {
      const { Resend } = await import('resend')
      const resend = new Resend(process.env.RESEND_API_KEY || '')

      await resend.emails.send({
        from: 'Sovexa <team@sovexa.ai>',
        to: NOTIFY_EMAIL,
        replyTo: body.email,
        subject: `[Sovexa Contact] ${body.reason} — ${body.name}`,
        html: `
          <div style="font-family:'DM Sans',system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px 20px">
            <h2 style="font-size:18px;font-weight:500;color:#1a1a1a;margin:0 0 20px">New contact form submission</h2>
            <table style="width:100%;border-collapse:collapse;font-size:14px;color:#333">
              <tr><td style="padding:8px 0;color:#888;width:80px">Name</td><td style="padding:8px 0">${body.name}</td></tr>
              <tr><td style="padding:8px 0;color:#888">Email</td><td style="padding:8px 0"><a href="mailto:${body.email}" style="color:#d4a574">${body.email}</a></td></tr>
              <tr><td style="padding:8px 0;color:#888">Reason</td><td style="padding:8px 0">${body.reason}</td></tr>
            </table>
            <div style="margin-top:20px;padding:16px;background:#faf9f7;border-radius:8px;border:1px solid rgba(0,0,0,.06)">
              <div style="font-size:12px;color:#888;margin-bottom:8px">Message</div>
              <div style="font-size:14px;color:#1a1a1a;line-height:1.7;white-space:pre-wrap">${body.message}</div>
            </div>
            <p style="font-size:12px;color:#aaa;margin-top:20px">Reply directly to this email to respond to ${body.name}.</p>
          </div>
        `,
      })
    } catch (emailErr) {
      console.warn('[contact] email notification failed:', (emailErr as Error).message)
    }

    res.json({ ok: true })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'invalid_input', issues: err.issues })
      return
    }
    console.warn('[contact] unexpected error', err)
    res.status(500).json({ error: 'internal_error' })
  }
})

export default router
