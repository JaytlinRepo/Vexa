import { PrismaClient, TaskStatus, OutputType, Prisma } from '@prisma/client'

interface SeedInput {
  companyId: string
  niche: string
}

const STARTER_TASKS: Array<{
  role: 'analyst' | 'strategist' | 'copywriter' | 'creative_director'
  title: string
  type: OutputType
  status: TaskStatus
  description: string
  output: Prisma.InputJsonValue
}> = [
  {
    role: 'strategist',
    title: 'Week one — content plan',
    type: 'content_plan',
    status: 'delivered',
    description: 'Your first weekly plan. Approve to kick off Alex on copy.',
    output: {
      weekOf: new Date().toISOString().slice(0, 10),
      pillars: ['transformation', 'myth busting', 'behind the scenes'],
      posts: [
        { day: 'Mon', format: 'Reel', topic: 'one-change transformation', angle: 'the 10-min swap' },
        { day: 'Wed', format: 'Carousel', topic: 'myth: more cardio = more fat loss', angle: 'the bench study' },
        { day: 'Fri', format: 'Reel', topic: 'client win', angle: 'from tired to on-plan' },
      ],
    },
  },
  {
    role: 'analyst',
    title: 'Trend report — this week',
    type: 'trend_report',
    status: 'delivered',
    description: 'The 3 trends moving fastest in your niche. 2 are viable for this week.',
    output: {
      generatedAt: new Date().toISOString(),
      trends: [
        { topic: 'weighted walking', growth: '+340%', window: '48h', verdict: 'act now — top accounts already moving' },
        { topic: 'protein-first breakfast', growth: '+180%', window: '7d', verdict: 'slower burn — ride this through the month' },
        { topic: 'mini-band booty prep', growth: '+90%', window: '7d', verdict: 'skip — oversaturated in your sub-niche' },
      ],
    },
  },
  {
    role: 'copywriter',
    title: 'Hooks — weighted walking',
    type: 'hooks',
    status: 'delivered',
    description: '5 hook variations. #2 is the one.',
    output: {
      hooks: [
        { n: 1, text: 'The 15-minute walk that burns more than cardio.' },
        { n: 2, text: 'Your treadmill is the problem. Here is what I swapped to.', flagged: true },
        { n: 3, text: 'Why I stopped running and started walking weighted.' },
        { n: 4, text: 'I quit the gym for 30 days. This is what replaced it.' },
        { n: 5, text: 'One change made fat loss feel easy again.' },
      ],
    },
  },
  {
    role: 'creative_director',
    title: 'Shot list — weighted walking Reel',
    type: 'shot_list',
    status: 'pending',
    description: 'Waiting on copy approval before I commit to a final visual direction.',
    output: {
      placeholder: true,
    },
  },
]

export async function seedStarterTasks(prisma: PrismaClient, input: SeedInput): Promise<void> {
  const employees = await prisma.employee.findMany({ where: { companyId: input.companyId } })
  const employeeByRole = new Map(employees.map((e) => [e.role, e]))

  for (const seed of STARTER_TASKS) {
    const employee = employeeByRole.get(seed.role)
    if (!employee) continue
    await prisma.task.create({
      data: {
        companyId: input.companyId,
        employeeId: employee.id,
        title: seed.title,
        description: seed.description,
        type: seed.type,
        status: seed.status,
        outputs:
          seed.status === 'delivered'
            ? {
                create: {
                  companyId: input.companyId,
                  employeeId: employee.id,
                  type: seed.type,
                  content: seed.output,
                  status: 'draft',
                },
              }
            : undefined,
      },
    })
  }
}
