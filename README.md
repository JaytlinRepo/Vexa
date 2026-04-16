# Vexa — AI Content Company OS

> Your content. Run by a team.

Vexa is a SaaS platform that gives every content creator a full AI workforce — a Trend Analyst, Content Strategist, Copywriter, and Creative Director — that specializes in their niche, learns their brand, and delivers real structured work every day. You are the CEO. You approve, redirect, and call meetings. Your team does everything else.

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
| **Starter** | $29/mo | Maya + Alex, 60 Bedrock calls/mo, proactive analysis, niche detection |
| **Pro** | $79/mo | Full team (4 agents), 500 calls/mo, meetings, weekly pulse |
| **Agency** | $149/mo | 5 workspaces, 2000 calls/mo, 2-min cooldown, all features |

All plans: 7-day free trial, no credit card required.

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

## Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL 15+ (or Neon for cloud)
- Redis 7+ (optional for local dev)
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
npx prisma migrate dev --name init
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
