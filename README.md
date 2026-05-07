# Sovexa — AI Content Company OS

> Your content. Run by a team.

Sovexa is a SaaS platform that gives every content creator a full AI workforce — a Trend Analyst, Content Strategist, Copywriter, and Creative Director — that specializes in their niche, learns their brand, and delivers real structured work every day. You are the CEO. You approve, redirect, and call meetings. Your team does everything else.

---

## What Makes Sovexa Different

Most AI tools make you the prompt engineer — you still do all the thinking. Sovexa inverts that. Your employees proactively deliver work without being asked. You respond to their outputs using action buttons. The only place you type freely is in a Meeting.

| Other AI tools | Sovexa |
|---|---|
| You write the prompt | Employees deliver work |
| Generic outputs | Deep niche specialization |
| No memory | Brand memory that compounds |
| You manage workflow | Pipeline runs automatically |
| Feels like software | Feels like running a company |

---

## The Team

| Employee | Role | Delivers | Proactive |
|---|---|---|---|
| **Maya** | Trend & Insights Analyst | Performance reviews, trend reports, content gap analysis | Monday morning pulse, on-connect analysis |
| **Jordan** | Content Strategist | Weekly content plans, pillar strategy, goal setting | Sunday content plan, metric-based goals |
| **Alex** | Copywriter & Script Writer | Hooks, Reel scripts, captions, carousel copy — in your voice | Auto-briefs from Jordan's approved plan |
| **Riley** | Creative Director | Shot lists, visual direction, editing notes | Auto-briefs from Alex's approved copy |

Pipeline: Maya analysis → Jordan plan → Alex copy → Riley production.

---

## Tech Stack

### Frontend
- **Next.js 14** (App Router) with prototype shell architecture
- **TailwindCSS** + custom design system (HG-style editorial aesthetic)
- **Zustand** (client state) + **TanStack Query** (server state)
- **Wire files** — 25+ companion JS scripts for dashboard, calendar, meetings, etc.

### Backend
- **Express 4.19** — REST API on port 4000
- **PostgreSQL** via **Prisma 5.14** ORM
- **Redis** via ioredis (caching, rate limiting)
- **node-cron** — proactive task scheduling

### AI Layer
- **AWS Bedrock** — Claude Haiku (`anthropic.claude-haiku-20240307-v1:0`)
- **AWS Bedrock Knowledge Bases** — per-niche RAG
- **Layered prompts** — base personality + niche context + brand memory + platform data + task

### Platform Integrations
| Platform | Method | Data |
|---|---|---|
| **Instagram** | Meta Graph API (direct OAuth) | Profile, posts, insights, audience demographics |
| **TikTok** | TikTok Login Kit (OAuth + PKCE) | Profile, videos, engagement, audience |
| **Phyllo** (legacy) | Middleware | Instagram via Phyllo SDK |

All platform data normalizes into `PlatformAccount` / `PlatformSnapshot` / `PlatformPost` / `PlatformAudience` tables.

### Data Sources (Knowledge Feed)
| Service | Cost | Purpose |
|---|---|---|
| Reddit public JSON | Free | Trend signals, hook language |
| Google Trends (npm) | Free | Rising keyword detection |
| NewsAPI | Free (100 req/day) | Niche news scanning |
| RSS feeds | Free | Industry publications |
| YouTube Data API v3 | Free (10k units/day) | Format and trend analysis |

### Payments & Email
- **Stripe** — subscriptions, webhooks, plan management
- **Resend** — transactional email

---

## Pricing

| Plan | Monthly | Includes |
|---|---|---|
| **Free** | $0 | All 3 agents + every feature. **3 tasks/day**, 25 Bedrock/day, 3 Studio edits/mo. No proactive briefs. |
| **Pro** | $19/mo | All 3 agents + every feature. **8 tasks/day**, 200 Bedrock/day, 8 Studio/mo, 3 videos/mo, weekly Maya pulse |
| **Max** | $59/mo | All 3 agents + every feature. **20 tasks/day**, 500 Bedrock/day, 25 Studio/mo, 15 videos/mo |
| **Agency** | $149/mo | 5 workspaces. **150 tasks/day** total, 1,500 Bedrock/day, 100 Studio/mo, 75 videos/mo, 2-min priority cooldown |

**Pricing model:** Same team quality + same features at every tier (Claude-style). Differentiation is purely volume — daily caps reset 00:00 UTC. Free is the acquisition funnel; upgrade = more daily runway, not more features.

**Quota architecture:** User-visible caps count only `Task.source = 'user'` rows. Proactive cron tasks (`source: 'system'`) and onboarding seeds (`source: 'seed'`) never burn user budget. Bedrock has a pre-invoke gate (`assertBedrockQuota`) that throws before the paid call is made when the user is at cap.

Free is no-card; paid tiers checkout via Stripe.

---

## Project Structure

```
vexa/
├── apps/
│   ├── api/
│   │   ├── prisma/schema.prisma           # 16 models, 10 enums
│   │   └── src/
│   │       ├── agents/                    # Agent prompt builders
│   │       │   ├── maya/system-prompt.ts   # Performance review, pulse, trend prompts
│   │       │   ├── jordan-alex-riley-prompts.ts
│   │       │   └── task-orchestrator.ts    # Pipeline engine + handoff
│   │       ├── lib/                       # 25 service modules
│   │       │   ├── personalContext.ts      # Platform data → agent context builder
│   │       │   ├── metaGraph.ts            # Meta Graph API client
│   │       │   ├── tiktokSync.ts           # TikTok data persistence
│   │       │   ├── nicheDetection.ts       # Auto-niche from content
│   │       │   ├── proactiveAnalysis.ts    # Triggered Maya analysis
│   │       │   ├── bedrockUsage.ts         # Usage tracking + caps
│   │       │   └── plans.ts               # Plan limits + feature gates
│   │       ├── routes/                    # 14 REST route files
│   │       │   ├── tasks.ts               # Task CRUD + Bedrock execution
│   │       │   ├── meeting.ts             # Meeting flow + SSE streaming
│   │       │   ├── instagram.ts           # Meta OAuth + sync
│   │       │   ├── tiktok.ts              # TikTok OAuth + sync
│   │       │   └── platformData.ts        # Cross-platform overview
│   │       ├── scheduler.ts               # Cron: daily sync, weekly pulse, stuck tasks
│   │       └── services/bedrock/          # AWS Bedrock + RAG integration
│   └── web/
│       ├── public/                        # 25+ wire.js companion scripts
│       │   ├── prototype.js               # Core UI engine + calendar
│       │   ├── dashboard-v2.js            # Dashboard layout + charts + tooltips
│       │   ├── meeting-wire.js            # Meeting room interactions
│       │   ├── calendar-wire.js           # Task → calendar sync
│       │   └── ...                        # billing, team, outputs, etc.
│       └── src/app/
│           ├── prototype.css              # Design system (tokens, typography, motion)
│           ├── _prototype/
│           │   ├── body.html              # Full page structure
│           │   └── PrototypeShell.tsx      # SSR wrapper
│           └── page.tsx                   # force-dynamic entry
├── packages/types/index.ts                # Shared TypeScript types
├── infrastructure/aws/cdk/               # CDK stack (not deployed)
└── docs/                                 # Deployment guides
```

---

## Database Models

**Core:** User, Company, Employee, Task, Output, Meeting, BrandMemory

**Platform:** PlatformAccount, PlatformSnapshot, PlatformPost, PlatformAudience

**Legacy:** InstagramConnection, TiktokConnection

**Knowledge:** NicheKnowledge, Notification

---

## Infrastructure

### Production URLs
| Service | URL |
|---|---|
| **Frontend** | https://sovexa.ai |
| **API** | https://api.sovexa.ai |

### AWS Services
| Service | Resource | Details |
|---|---|---|
| **Amplify** | `d1y8b9qw8l1748` | Next.js frontend, two branches (production + dev) |
| **App Runner** | `sovexa-api` | Express API, pulls from ECR |
| **ECR** | `sovexa-api` | Docker image repository |
| **Route 53** | `sovexa.ai` | DNS (single hosted zone) |
| **Neon** | PostgreSQL | Database (dev + prod share for now) |
| **Bedrock** | Claude Haiku | LLM for all 4 agents |

### Deployment Workflow
- **Dev**: Push to `dev` branch → auto-deploys to Amplify dev
- **Production**: Merge `dev` → `main`, then manually trigger Amplify build. Production never auto-deploys.
- **API**: Build Docker image → push to ECR → update App Runner service

### Branch Environments
| Branch | Stage | Frontend URL | API URL |
|---|---|---|---|
| `main` | Production | https://sovexa.ai | https://api.sovexa.ai |
| `dev` | Development | https://dev.d1y8b9qw8l1748.amplifyapp.com | https://api.sovexa.ai |

### IAM
- **vexa-dev** — IAM user with ECR, App Runner, Amplify, Bedrock permissions
- **SovexaAppRunnerECRAccess** — IAM role for App Runner to pull from ECR

---

## Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL 15+ (or Neon for cloud)
- Redis 7+ (optional for local dev)
- Docker (for API builds)
- AWS account with Bedrock access

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

Minimum required:
```env
DATABASE_URL=postgresql://localhost:5432/vexa
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:4000
```

Platform integrations (optional):
```env
# TikTok Login Kit
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=

# Meta / Instagram
META_APP_ID=
META_APP_SECRET=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

### 3. Database setup

```bash
cd apps/api
npx prisma db push
npx prisma generate
```

### 4. Run locally

```bash
# Terminal 1 — API (port 4000)
cd apps/api && npm run dev

# Terminal 2 — Web (port 3000)
cd apps/web && npm run dev
```

Frontend: http://localhost:3000
API: http://localhost:4000

### 5. Deploy API to AWS

```bash
# Build and push Docker image
docker build -t sovexa-api -f apps/api/Dockerfile .
docker tag sovexa-api:latest 322513863369.dkr.ecr.us-east-1.amazonaws.com/sovexa-api:latest
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 322513863369.dkr.ecr.us-east-1.amazonaws.com
docker push 322513863369.dkr.ecr.us-east-1.amazonaws.com/sovexa-api:latest

# Update App Runner (picks up latest image)
aws apprunner start-deployment --service-arn <service-arn> --region us-east-1
```

---

## Design System

The visual language follows an editorial/minimalist aesthetic (inspired by harrygeorge.design):

- **Typography:** Cormorant Garamond (italic serif headlines), Syne (bold uppercase labels), DM Sans (body)
- **Color:** Near-black surfaces (#0a0a0a, #111, #171717), warm amber accent, monochromatic palette
- **Motion:** Staggered fade+slide reveals, card hover lift, link underline animation, smooth scroll
- **Layout:** Generous whitespace (96-160px section padding), 8px border-radius, rectangular buttons
- **Borders:** Subtle rgba borders, no heavy outlines — depth through surface color differences

---

## Key Design Decisions

**Button-first interaction model**
Users never prompt the AI. Every output surfaces with structured action buttons (Approve / Reject / Reconsider). The only free-text input is inside Meetings and the quick-brief modal.

**Agent pipeline auto-triggers**
Approving Jordan's content plan automatically briefs Alex. Approving Alex's copy briefs Riley. Each agent builds on the previous output via `buildHandoffContext()`.

**Platform data feeds agent context**
`personalContext.ts` loads real follower counts, engagement rates, posting patterns, and content insights. Agents reference actual numbers — not generic advice.

**Proactive delivery system**
Maya auto-analyzes on platform connect. Weekly pulse fires Monday 8am UTC. Agents don't wait to be asked — they deliver to the CEO's inbox.

**Brand memory compounds over time**
Every approval, rejection, and meeting decision is stored and weighted. Agent prompts include this memory so the team improves with use.

**Niche detection from content**
Captions and bios are analyzed to auto-detect niche (with confidence score). Visual thumbnail fallback for accounts with minimal text.

---

## Interaction Rules

- Agents deliver outputs on schedule (Maya: Monday pulse, Jordan: Sunday plan)
- Agents reference previous decisions and platform data in outputs
- Meeting room is the only place users type freely
- Approving a plan triggers the next agent automatically
- Every rejection is stored as brand memory with the reason
- Internal tasks (performance_review, weekly_pulse) run silently — CEO sees results, not process

---

## License

Private — all rights reserved.

---

*Built with Claude Code.*
