import { Router } from 'express'
import { PrismaClient, EmployeeRole } from '@prisma/client'
import { z } from 'zod'
import { requireAuth, AuthedRequest } from '../middleware/auth'

const prisma = new PrismaClient()
const router = Router()

const EMPLOYEE_SEED: Array<{ role: EmployeeRole; name: string }> = [
  { role: 'analyst', name: 'Maya' },
  { role: 'strategist', name: 'Jordan' },
  { role: 'copywriter', name: 'Alex' },
  { role: 'creative_director', name: 'Riley' },
]

const companySchema = z.object({
  name: z.string().min(1).max(120),
  niche: z.string().min(1),
  subNiche: z.string().max(200).optional(),
  brandVoice: z.record(z.any()).optional(),
  audience: z.record(z.any()).optional(),
  goals: z.record(z.any()).optional(),
  agentTools: z.record(z.any()).optional(),
})

router.post('/company', requireAuth, async (req, res, next) => {
  try {
    const data = companySchema.parse(req.body)
    const { userId } = (req as AuthedRequest).session

    const company = await prisma.company.create({
      data: {
        userId,
        name: data.name,
        niche: data.niche,
        subNiche: data.subNiche,
        brandVoice: data.brandVoice ?? {},
        audience: data.audience ?? {},
        goals: data.goals ?? {},
        agentTools: data.agentTools ?? {},
        employees: {
          create: EMPLOYEE_SEED.map((e) => ({ role: e.role, name: e.name })),
        },
      },
      include: { employees: true },
    })

    res.status(201).json({ company })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'invalid_input', issues: err.issues })
      return
    }
    next(err)
  }
})

export default router
