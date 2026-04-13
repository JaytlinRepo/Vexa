import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { requireAuth, AuthedRequest } from '../middleware/auth'

const prisma = new PrismaClient()
const router = Router()

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  niche: z.string().min(1).max(80).optional(),
  subNiche: z.string().max(200).optional().nullable(),
  fullName: z.string().max(120).optional(),
  email: z.string().email().optional(),
  brandVoice: z.record(z.any()).optional(),
  audience: z.record(z.any()).optional(),
  goals: z.record(z.any()).optional(),
  agentTools: z.record(z.any()).optional(),
})

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const company = await prisma.company.findFirst({
      where: { userId },
      include: { instagram: true, employees: true },
    })
    res.json({ company })
  } catch (err) {
    next(err)
  }
})

router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const { userId } = (req as AuthedRequest).session
    const data = patchSchema.parse(req.body)

    const company = await prisma.company.findFirst({ where: { id: req.params.id, userId } })
    if (!company) {
      res.status(404).json({ error: 'company_not_found' })
      return
    }

    const { fullName, email, ...companyFields } = data

    // User-level fields are updated on the User row.
    if (fullName != null || email != null) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          ...(fullName != null ? { fullName } : {}),
          ...(email != null ? { email } : {}),
        },
      })
    }

    const updated = await prisma.company.update({
      where: { id: company.id },
      data: {
        ...(companyFields.name != null ? { name: companyFields.name } : {}),
        ...(companyFields.niche != null ? { niche: companyFields.niche } : {}),
        ...(companyFields.subNiche !== undefined ? { subNiche: companyFields.subNiche ?? null } : {}),
        ...(companyFields.brandVoice != null ? { brandVoice: companyFields.brandVoice } : {}),
        ...(companyFields.audience != null ? { audience: companyFields.audience } : {}),
        ...(companyFields.goals != null ? { goals: companyFields.goals } : {}),
        ...(companyFields.agentTools != null ? { agentTools: companyFields.agentTools } : {}),
      },
      include: { instagram: true },
    })

    res.json({ company: updated })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'invalid_input', issues: err.issues })
      return
    }
    next(err)
  }
})

export default router
