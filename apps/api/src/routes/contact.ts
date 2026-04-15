import { Router } from 'express'
import { z } from 'zod'

const router = Router()

const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  reason: z.enum(['sales', 'support', 'partnership', 'other']).default('other'),
  message: z.string().trim().min(1).max(4000),
})

/**
 * POST /api/contact — receive a contact-form submission.
 *
 * For now this just logs and returns 200. Wire to Resend / Slack / a DB
 * table when we're ready to actually route these somewhere.
 */
router.post('/', (req, res) => {
  try {
    const body = contactSchema.parse(req.body)
    console.log('[contact]', {
      name: body.name,
      email: body.email,
      reason: body.reason,
      messageLength: body.message.length,
      preview: body.message.slice(0, 160),
    })
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
