/**
 * Vexa demo seed — creates (or refreshes) a fully-populated account you can
 * log into during testing without going through the 7-step onboarding every
 * time.
 *
 * Usage:
 *   npm run seed:demo --workspace @vexa/api
 *
 * Credentials:
 *   email    demo@vexa.local
 *   password demo1234
 *
 * Running this script multiple times is safe — it wipes and recreates the
 * demo account each time.
 */

import 'dotenv/config'
import { PrismaClient, EmployeeRole, OutputType, TaskStatus } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { trialEnd } from '../src/lib/plans'
import { seedStarterTasks } from '../src/lib/seedStarterTasks'

const prisma = new PrismaClient()

const EMAIL = 'demo@vexa.local'
const USERNAME = 'demo'
const PASSWORD = 'demo1234'

async function main() {
  console.log('[seed] resetting demo account…')
  await prisma.user.deleteMany({ where: { email: EMAIL } })

  const passwordHash = await bcrypt.hash(PASSWORD, 10)
  const user = await prisma.user.create({
    data: {
      email: EMAIL,
      username: USERNAME,
      passwordHash,
      fullName: 'Demo CEO',
      plan: 'pro',
      subscriptionStatus: 'trial',
      trialEndsAt: trialEnd(),
    },
  })
  console.log('[seed] user created:', user.id)

  const employees: Array<{ role: EmployeeRole; name: string }> = [
    { role: 'analyst', name: 'Maya' },
    { role: 'strategist', name: 'Jordan' },
    { role: 'copywriter', name: 'Alex' },
    { role: 'creative_director', name: 'Riley' },
  ]

  const company = await prisma.company.create({
    data: {
      userId: user.id,
      name: 'Marcus Fitness',
      niche: 'fitness',
      subNiche: 'Women\'s strength training, no gym required',
      brandVoice: {
        tone: ['motivational', 'direct', 'conversational'],
        avoid: ['corporate jargon', 'overly technical language'],
      },
      audience: {
        description: 'Women 28–45, intermediate fitness level, training from home',
        age: '28-45',
        interests: 'strength, nutrition, body recomposition',
      },
      goals: { selected: ['grow_following', 'drive_sales', 'build_authority'] },
      agentTools: {
        maya: ['Reddit', 'Google Trends', 'YouTube'],
        jordan: ['Your past outputs', 'Instagram insights'],
        alex: ['Your previous captions', 'Top-performing hooks'],
        riley: ['Pexels', 'Creatomate templates'],
      },
      employees: { create: employees.map((e) => ({ role: e.role, name: e.name })) },
    },
    include: { employees: true },
  })
  console.log('[seed] company:', company.name, '/', company.id)

  await seedStarterTasks(prisma, { companyId: company.id, niche: company.niche })

  // Add a few more tasks to make the dashboard richer.
  const byRole = new Map(company.employees.map((e) => [e.role, e]))

  const extraTasks: Array<{
    role: EmployeeRole
    title: string
    type: OutputType
    status: TaskStatus
    description: string
    content?: Record<string, unknown>
  }> = [
    {
      role: 'analyst',
      title: 'Competitor scan — top 5 women\'s strength accounts',
      type: 'trend_report',
      status: 'approved',
      description: 'Posting cadence, top formats, what converted into saves.',
      content: {
        summary: 'All 5 are weekly-heavy on transformation content. Opportunity: daily micro-wins.',
        accounts: [
          { handle: '@stronghergirl', followers: 240_000, weeklyPosts: 9 },
          { handle: '@homestrongmom', followers: 180_000, weeklyPosts: 6 },
        ],
      },
    },
    {
      role: 'copywriter',
      title: 'Captions — 3 Jan posts',
      type: 'caption',
      status: 'approved',
      description: '3 captions queued for this week. Each with CTA + save trigger.',
      content: {
        captions: [
          { day: 'Mon', text: 'You are not lazy. You are untrained in recovery. Save this.' },
          { day: 'Wed', text: 'The workout that replaced my 45-min cardio session. One kettlebell.' },
          { day: 'Fri', text: 'If you have 12 minutes and 1 dumbbell, I have a plan for you.' },
        ],
      },
    },
    {
      role: 'creative_director',
      title: 'Production brief — kettlebell Reel',
      type: 'shot_list',
      status: 'rejected',
      description: 'First pass was too studio-polished. Going raw, home-gym authenticity.',
      content: {
        decisionNote: 'CEO wants home-gym authenticity. Revising.',
      },
    },
  ]

  for (const t of extraTasks) {
    const emp = byRole.get(t.role)
    if (!emp) continue
    await prisma.task.create({
      data: {
        companyId: company.id,
        employeeId: emp.id,
        title: t.title,
        description: t.description,
        type: t.type,
        status: t.status,
        completedAt: t.status === 'approved' || t.status === 'rejected' ? new Date() : null,
        outputs: t.content
          ? {
              create: {
                companyId: company.id,
                employeeId: emp.id,
                type: t.type,
                status: t.status === 'approved' ? 'approved' : t.status === 'rejected' ? 'rejected' : 'draft',
                content: t.content as never,
              },
            }
          : undefined,
      },
    })
  }

  // Fake Instagram connection.
  await prisma.instagramConnection.create({
    data: {
      companyId: company.id,
      handle: 'marcusfitness',
      profileUrl: 'https://instagram.com/marcusfitness',
      followerCount: 24_300,
      followingCount: 412,
      postCount: 186,
      engagementRate: 4.12,
      topPosts: [
        { id: 'demo_1', caption: 'The 12-minute home workout', likes: 3200, comments: 180, permalink: '#', thumbnail: null },
        { id: 'demo_2', caption: 'Stop doing cardio for fat loss', likes: 2980, comments: 240, permalink: '#', thumbnail: null },
      ],
      source: 'stub',
    },
  })

  // Notifications.
  await prisma.notification.createMany({
    data: [
      {
        userId: user.id,
        companyId: company.id,
        type: 'team_update',
        emoji: '👋',
        title: 'Welcome back, demo',
        body: 'Your team has deliveries waiting for review.',
        isRead: false,
      },
      {
        userId: user.id,
        companyId: company.id,
        type: 'trend_report_ready',
        emoji: '📊',
        title: 'Maya: this week\'s report is ready',
        body: 'Weighted walking is up 340% in your niche.',
        isRead: false,
      },
    ],
  })

  console.log('\n✓ Demo account ready')
  console.log('  email    ', EMAIL)
  console.log('  username ', USERNAME)
  console.log('  password ', PASSWORD)
  console.log('  plan     ', 'pro (trial, 7 days)')
  console.log('  open     ', 'http://localhost:3000 → Log in')
}

main()
  .catch((err) => {
    console.error('[seed] failed', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
