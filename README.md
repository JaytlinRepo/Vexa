# Vexa — AI Content Company OS

> Your content. Run by a team.

Vexa is a SaaS platform that gives every content creator a full AI workforce — a Trend Analyst, Content Strategist, Copywriter, and Creative Director — that specializes in their niche, learns their brand, and delivers real structured work every day. You are the CEO. You approve, redirect, and call meetings. Your team does everything else.

## Where it runs

Two stacks. See [docs/STACKS.md](./docs/STACKS.md) for the comparison.

| | Status | Stack |
|---|---|---|
| **Test preview** | ✅ Live | Vercel + Railway + Neon + Phyllo staging — see [docs/DEPLOY-TEST.md](./docs/DEPLOY-TEST.md) |
| **Production** | 🟡 Architecture defined, not deployed | AWS Amplify + ECS Fargate + RDS + Phyllo prod + Bedrock — see [docs/DEPLOY-PROD.md](./docs/DEPLOY-PROD.md) |

The current public URL (`https://vexa-web-chi.vercel.app`) is the **test preview**. Do not route real users or real money through it. Production migration plan is in `docs/DEPLOY-PROD.md`.

---

## What Makes Vexa Different

Most AI tools make you the prompt engineer — you still do all the thinking. Vexa inverts that. Your employees proactively deliver work without being asked. You respond to their outputs using action buttons. The only place you type freely is in a Meeting.

| Other AI tools | Vexa |
|---|---|
| You write the prompt | Employees deliver work |
| Generic outputs | Deep niche specialization |
| No memory | Brand memory that compounds |
| You manage workflow | Pipeline runs automatically |
| Feels like software | Feels like running a company |

---

## The Team

| Employee | Role | Delivers |
|---|---|---|
| **Maya** | Trend & Insights Analyst | Monday trend report, Knowledge Feed curation, viral hook signals |
| **Jordan** | Content Strategist | Sunday content plan, pillar strategy, briefs Alex on approval |
| **Alex** | Copywriter & Script Writer | Hooks, Reel scripts, captions, carousel copy — in your voice |
| **Riley** | Creative Director | Shot lists, visual direction, sends to video generation |

Pipeline: Jordan approval → Alex → Riley → Creatomate video render.

---

## Tech Stack

### Frontend
- **Next.js 14** (App Router)
- **TailwindCSS**
- **Zustand** (client state)
- **TanStack Query** (server state)

### Backend
- **Express** on **AWS Lambda** + API Gateway
- **PostgreSQL** on AWS RDS, **Prisma** ORM
- **Redis** via ioredis (ElastiCache)

### AI & Data
- **AWS Bedrock** — Claude Haiku (`anthropic.claude-haiku-20240307-v1:0`)
- **AWS Bedrock Knowledge Bases** — per-niche RAG
- **AWS Cognito** via Amplify — auth

### Integrations (all free or near-free to start)
| Service | Cost | Purpose |
|---|---|---|
| Reddit public JSON | Free | Trend signals, hook language |
| Google Trends (npm) | Free | Rising keyword detection |
| NewsAPI | Free (100 req/day) | Niche news scanning |
| RSS feeds | Free | Industry publications |
| YouTube Data API v3 | Free (10k units/day) | Format and trend analysis |
| Pexels API | Free | B-roll footage for Riley |
| Pixabay API | Free | B-roll footage for Riley |
| Creatomate | $29/mo | Video rendering pipeline |

**Total integration cost at launch: ~$29/mo**

### Payments & Email
- **Stripe** — subscriptions, webhooks, plan management
- **Resend** — transactional email (free to 3,000/mo)

### Infrastructure
- **AWS Amplify** — frontend hosting
- **AWS Lambda** — backend functions
- **AWS RDS** — PostgreSQL database
- **AWS S3** — file storage
- **AWS ElastiCache** — Redis (~$13/mo)

---

## Pricing

| Plan | Monthly | Annual | Includes |
|---|---|---|---|
| Starter | $14.99/mo | $11/mo | Maya + Alex, 30 tasks/mo, Knowledge Feed |
| Pro | $49.99/mo | $37/mo | Full team, unlimited tasks, meetings, memory, 10 videos/mo |
| Agency | $99.99/mo | $74/mo | 5 workspaces, 50 videos/mo, white-label |

All plans start with a 7-day free trial. No credit card required.

---

## Project Structure

```
vexa/
├── .claude/
│   └── CLAUDE.md                    # Claude Code master instructions
├── apps/
│   ├── api/
│   │   ├── prisma/
│   │   │   └── schema.prisma        # Full database schema
│   │   └── src/
│   │       ├── agents/
│   │       │   ├── maya/
│   │       │   │   └── system-prompt.ts        # Maya's task + meeting prompts
│   │       │   ├── jordan-alex-riley-prompts.ts # Other agent prompts
│   │       │   └── task-orchestrator.ts         # Pipeline engine + button actions
│   │       └── services/
│   │           ├── bedrock/
│   │           │   └── bedrock.service.ts       # AWS Bedrock + RAG
│   │           ├── cache/
│   │           │   └── cache.service.ts         # Redis cache-aside + rate limiting
│   │           ├── email/
│   │           │   └── email.service.ts         # Resend email templates
│   │           ├── feed/
│   │           │   └── feed.service.ts          # Knowledge Feed aggregation
│   │           ├── integrations/
│   │           │   ├── index.ts                 # Master orchestrator
│   │           │   ├── reddit.service.ts        # Reddit public API
│   │           │   ├── google-trends.service.ts # Google Trends (npm)
│   │           │   ├── newsapi.service.ts       # NewsAPI
│   │           │   ├── rss.service.ts           # RSS feed aggregator
│   │           │   ├── youtube.service.ts       # YouTube Data API v3
│   │           │   ├── stock-media.service.ts   # Pexels + Pixabay
│   │           │   └── creatomate.service.ts    # Video generation
│   │           ├── meeting.service.ts           # Meeting flow + SSE streaming
│   │           ├── notifications/
│   │           │   └── notification.service.ts  # SSE real-time + DB notifications
│   │           └── stripe/
│   │               └── stripe.service.ts        # Checkout + webhooks
│   └── web/
│       ├── STRUCTURE.md                         # Frontend component guide
│       └── src/
│           ├── app/
│           │   └── auth/
│           │       └── onboarding/
│           │           └── OnboardingFlow.tsx   # 4-step onboarding + team reveal
│           └── components/
│               └── shared/
│                   └── NotificationBell.tsx     # Real-time SSE notification bell
├── infrastructure/
│   └── aws/
│       └── cdk/
│           └── vexa-stack.ts                    # CDK: full AWS infrastructure
├── packages/
│   └── types/
│       └── index.ts                             # Shared TypeScript types
├── .env.example                                 # All environment variables documented
└── README.md
```

Also included:
- `vexa-website.html` — Full interactive prototype (marketing site + onboarding + dashboard)

---

## Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL 15+
- Redis 7+
- AWS account with Bedrock access enabled

### 1. Clone and install

```bash
git clone https://github.com/JaytlinRepo/Vexa.git
cd Vexa
npm install
```

### 2. Environment variables

```bash
cp .env.example .env
```

Fill in all values. The minimum required to run locally:

```env
# Database
DATABASE_URL=postgresql://localhost:5432/vexa

# Redis
REDIS_URL=redis://localhost:6379

# AWS Bedrock (requires AWS CLI configured)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

# Auth
NEXT_PUBLIC_COGNITO_USER_POOL_ID=
NEXT_PUBLIC_COGNITO_CLIENT_ID=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# Email
RESEND_API_KEY=

# App URLs
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:4000
```

Optional (integrations start working without these, just degrade gracefully):
```env
NEWS_API_KEY=          # newsapi.org — free 100 req/day
YOUTUBE_API_KEY=       # Google Cloud Console — free 10k units/day
PEXELS_API_KEY=        # pexels.com/api — free
PIXABAY_API_KEY=       # pixabay.com/api — free
CREATOMATE_API_KEY=    # creatomate.com — $29/mo
```

### 3. Database setup

```bash
cd apps/api
npx prisma migrate dev --name init
npx prisma generate
```

### 4. Run locally

```bash
# Terminal 1 — API
cd apps/api
npm run dev

# Terminal 2 — Web
cd apps/web
npm run dev
```

Frontend: http://localhost:3000  
API: http://localhost:4000

---

## Build Order (for Claude Code)

Follow `.claude/CLAUDE.md` for the full build sequence. High-level order:

1. **Types** — `packages/types/index.ts`
2. **Database** — Prisma schema + migrations
3. **Auth** — Cognito + Amplify setup
4. **Core services** — Bedrock, cache, email, notifications
5. **Agent prompts** — Maya, Jordan, Alex, Riley
6. **Task orchestrator** — Pipeline engine + button action handler
7. **Integrations** — Reddit, Trends, NewsAPI, RSS, YouTube, Pexels, Creatomate
8. **API routes** — Tasks, meetings, feed, outputs, stripe webhooks
9. **Frontend** — Onboarding, dashboard, team, tasks/calendar, outputs, knowledge feed, settings
10. **Infrastructure** — CDK stack deploy

---

## Key Design Decisions

**Button-first interaction model**  
Users never prompt the AI. Every output surfaces with structured action buttons (Approve / Reject / Reconsider). The only free-text input is inside Meetings. This is intentional and central to the product identity.

**Agent pipeline auto-triggers**  
Approving Jordan's content plan automatically triggers Alex to receive a brief. Approving Alex's script automatically triggers Riley. Approving Riley's shot list triggers Creatomate. Users manage decisions, not workflow.

**Cache-aside for external APIs**  
All external data (Reddit, Trends, RSS, YouTube) is cached in Redis with TTLs. Trend data: 6hrs. RSS: 2hrs. Brand memory: 30min. Without this, every agent task hits 5+ external APIs simultaneously.

**SSE for real-time notifications**  
Server-Sent Events for agent notifications — simpler than WebSockets and works through API Gateway without extra configuration. Falls back gracefully if disconnected.

**Brand memory compounds over time**  
Every approval, rejection, and meeting decision is stored and fed back into agent prompts. The team gets better the more you use it.

---

## Interaction Rules (important for AI implementation)

- Agents deliver outputs unprompted on a schedule (Maya: Monday 9am, Jordan: Sunday 7pm)
- Agents reference previous decisions in their outputs
- Meeting room is the ONLY place users type freely
- Approving a plan triggers the next agent automatically — no manual assignment
- Every rejection is stored as brand memory with the reason

---

## Environment Variables Reference

See `.env.example` for the complete documented list. All variables are grouped by service with comments explaining cost, limits, and where to sign up.

---

## License

Private — all rights reserved.

---

*Built with Claude Code.*
