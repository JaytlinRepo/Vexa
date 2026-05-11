# VEXA — Claude Code Master Instructions

## What is Sovexa?
Sovexa is a SaaS platform that gives content creators an AI-powered content team.
Users are CEOs. They manage AI employees who plan, write, and produce social media content.

This is NOT a chatbot product. It is a structured workforce simulation platform.

---

## Core Design Principles (Never Violate These)

1. **No chat interfaces** — Users never type prompts. All AI interaction is structured.
2. **Button-first decisions** — Every employee output has Approve / Reject / Reconsider actions.
3. **Meetings, not chats** — When users need to talk to an agent, it's called a "Meeting." It opens a dedicated meeting room UI. The employee comes prepared with context.
4. **Employees have personality** — Each agent has a name, role, tone, and communication style. They are not interchangeable.
5. **Everything is task-based** — No action happens outside the task system.
6. **Users feel like CEOs** — Every UI decision should reinforce this feeling.

---

## Tech Stack

### Frontend
- **Framework**: Next.js 14 (App Router)
- **Styling**: TailwindCSS + shadcn/ui
- **State**: Zustand
- **Data fetching**: TanStack Query
- **Auth**: Custom JWT (jose + bcrypt) with httpOnly cookie sessions
- **Fonts**: Syne (headings) + DM Sans (body)

### Backend
- **Runtime**: Node.js
- **Framework**: Express.js on AWS App Runner
- **API**: REST (direct Express, no API Gateway)
- **Database**: PostgreSQL on AWS RDS
- **ORM**: Prisma

### AI Layer
- **LLM**: AWS Bedrock — Claude Haiku (`anthropic.claude-haiku-20240307-v1:0`)
- **RAG**: AWS Bedrock Knowledge Bases (one per niche)
- **Memory**: Custom memory service using RDS + Bedrock embeddings

### Infrastructure
- **Hosting**: AWS
- **Frontend**: AWS Amplify (sovexa.ai)
- **Backend**: AWS App Runner (api.sovexa.ai)
- **Database**: AWS RDS PostgreSQL (prod: sovexa_prod, dev: sovexa_dev)
- **Storage**: AWS S3 (sovexa-outputs)
- **Auth**: Custom JWT sessions (jose + bcrypt, httpOnly cookies)
- **Secrets**: AWS SSM Parameter Store (/sovexa/dev/, /sovexa/prod/)
- **Email**: Resend (team@sovexa.ai)
- **Video Generation**: Creatomate API
- **Trend Data**: Google Trends API + NewsAPI + YouTube + Reddit + RSS
- **Payments**: Stripe

---

## AI Employees

### Maya — Trend & Insights Analyst
- **Personality**: Data-driven, precise, slightly urgent. Always references numbers.
- **Voice**: "I'm seeing a 340% spike in this search term over 48 hours — here's why it matters for your audience."
- **Outputs**: Trend reports, competitor insights, viral hook opportunities, content gap analysis
- **Proactive**: Delivers Monday morning trend report automatically
- **Bedrock prompt file**: `apps/api/src/agents/maya/system-prompt.ts`

### Jordan — Content Strategist  
- **Personality**: Calm, organized, big-picture thinker. Speaks in systems and frameworks.
- **Voice**: "Based on your last 30 days, your audience responds best to transformation content on Tuesdays. Here's how I've adjusted the plan."
- **Outputs**: Weekly content calendars, content pillars, audience analysis, posting strategy
- **Proactive**: Delivers weekly plan every Sunday evening
- **Bedrock prompt file**: `apps/api/src/agents/jordan/system-prompt.ts`

### Alex — Copywriter & Script Writer  *(SHELVED — kept for future re-enable)*
- **Status**: Removed from active team as of 2026-05-06. Code paths preserved (prompt files, executor, prompt builders, Plan enum value `copywriter`) so the role can be reactivated without a migration.
- **What's hidden**: not seeded into new Companies (`onboarding.ts EMPLOYEE_SEED`), not in any plan's `employees` array, no UI surfaces, no marketing.
- **Personality** *(reference)*: Creative, punchy, opinionated. Pushes back if a brief is weak.
- **Voice** *(reference)*: "I wrote 5 hooks. Hook #3 is the one — the others are safe, this one will stop thumbs."
- **Outputs** *(reference)*: Hooks (3-10 variations), captions, Reel scripts, carousel copy, CTAs
- **Bedrock prompt file**: `apps/api/src/agents/alex/system-prompt.ts`

### Riley — Creative Director
- **Personality**: Visual thinker, detail-obsessed, speaks in scenes and shots.
- **Voice**: "Open on a close-up. No talking for the first 2 seconds. Let the visual do the work."
- **Outputs**: Shot lists, pacing guides, visual direction, editing notes, Creatomate templates
- **Proactive**: Delivers production brief once Jordan's plan is approved
- **Bedrock prompt file**: `apps/api/src/agents/riley/system-prompt.ts`

---

## Interaction Model

### Standard Flow (Default)
```
Employee delivers structured output
    → User sees rich visual card (NOT a chat bubble)
    → User responds with action buttons only
    → System processes button choice
    → Next step triggers automatically
```

### Button Sets by Output Type

**Trend Report (Maya)**
- ✅ Use this trend
- ⏭ Skip — not relevant
- 🔄 Show me more like this
- 📅 Save for later

**Content Plan (Jordan)**
- ✅ Approve plan
- 🔄 Rethink the angle
- ⏰ Adjust the timing
- 📋 Modify specific days

**Hooks & Copy (Alex)** *(SHELVED — design reference for future re-enable)*
- ✅ Use this hook
- 🔄 Too safe — be bolder
- 🎯 Off-brand — try again
- ➕ Give me 5 more variations
- ✏️ Use but tweak tone

**Shot List (Riley)**
- ✅ Start production
- 🔄 Simplify the shots
- ⚡ Change the pacing
- 🎬 Regenerate completely

**Rendered Video**
- ✅ Approve for posting
- ✂️ Revise the edit
- 🔄 Regenerate completely

### Meeting Flow
```
User taps "Call a Meeting" on any employee card
    → Meeting room opens (full-screen modal, distinct visual style)
    → Employee opens with prepared context from recent work + brand memory
    → Conversation happens (this is the ONLY place free-form text input exists)
    → User ends meeting with "End Meeting" button
    → System auto-generates a meeting summary
    → Summary converts key decisions into tasks automatically
```

---

## Database Schema

### Users
```sql
users (
  id UUID PRIMARY KEY,
  email VARCHAR UNIQUE NOT NULL,
  username VARCHAR UNIQUE,
  password_hash VARCHAR,
  full_name VARCHAR,
  subscription_status ENUM('trial', 'active', 'canceled', 'past_due'),
  plan ENUM('starter', 'pro', 'agency'),
  stripe_customer_id VARCHAR,
  stripe_subscription_id VARCHAR,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)
```

### Companies (Brand Workspaces)
```sql
companies (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  name VARCHAR NOT NULL,
  niche VARCHAR NOT NULL,
  sub_niche VARCHAR,
  platform ENUM('instagram') DEFAULT 'instagram',
  brand_voice JSONB,
  audience JSONB,
  goals JSONB,
  created_at TIMESTAMP
)
```

### Employees
```sql
employees (
  id UUID PRIMARY KEY,
  company_id UUID REFERENCES companies(id),
  role ENUM('analyst', 'strategist', 'copywriter', 'creative_director'),
  name VARCHAR NOT NULL,
  is_active BOOLEAN DEFAULT true,
  last_active TIMESTAMP
)
```

### Tasks
```sql
tasks (
  id UUID PRIMARY KEY,
  company_id UUID REFERENCES companies(id),
  employee_id UUID REFERENCES employees(id),
  title VARCHAR NOT NULL,
  description TEXT,
  type VARCHAR NOT NULL,
  status ENUM('pending', 'in_progress', 'delivered', 'approved', 'rejected', 'revision'),
  output JSONB,
  user_action JSONB,
  created_at TIMESTAMP,
  completed_at TIMESTAMP
)
```

### Outputs
```sql
outputs (
  id UUID PRIMARY KEY,
  task_id UUID REFERENCES tasks(id),
  company_id UUID REFERENCES companies(id),
  employee_id UUID REFERENCES employees(id),
  type ENUM('trend_report', 'content_plan', 'hooks', 'caption', 'script', 'shot_list', 'video'),
  content JSONB NOT NULL,
  status ENUM('draft', 'approved', 'rejected'),
  feedback JSONB,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMP
)
```

### Meetings
```sql
meetings (
  id UUID PRIMARY KEY,
  company_id UUID REFERENCES companies(id),
  employee_id UUID REFERENCES employees(id),
  messages JSONB NOT NULL DEFAULT '[]',
  summary TEXT,
  decisions JSONB,
  tasks_created JSONB,
  started_at TIMESTAMP,
  ended_at TIMESTAMP
)
```

### Memory
```sql
brand_memory (
  id UUID PRIMARY KEY,
  company_id UUID REFERENCES companies(id),
  memory_type ENUM('feedback', 'preference', 'performance', 'voice'),
  content JSONB NOT NULL,
  weight FLOAT DEFAULT 1.0,
  created_at TIMESTAMP
)
```

---

## API Routes

### Auth (Custom JWT + bcrypt)
```
POST /api/auth/signup              — Create user, hash password, set session cookie
POST /api/auth/login               — Verify password, set session cookie
POST /api/auth/logout              — Clear session cookie
POST /api/auth/change-password     — Verify current, hash new
GET  /api/auth/me                  — Read session cookie, return user + companies
```

### Onboarding
```
POST /api/onboarding/company        — Create company + spawn employees
POST /api/onboarding/niche          — Set niche, load RAG knowledge base
POST /api/onboarding/brand-voice    — Set brand voice preferences
```

### Employees
```
GET  /api/employees                 — Get all employees for company
GET  /api/employees/:id             — Get single employee + recent work
POST /api/employees/:id/assign      — Assign a task to employee
GET  /api/employees/:id/history     — Get work history
```

### Tasks
```
GET  /api/tasks                     — Get all tasks (filterable)
GET  /api/tasks/:id                 — Get single task + output
POST /api/tasks/:id/action          — Submit button action (approve/reject/reconsider)
POST /api/tasks/:id/regenerate      — Trigger regeneration
```

### Meetings
```
POST /api/meetings/start            — Start a meeting with an employee
POST /api/meetings/:id/message      — Send message in meeting
POST /api/meetings/:id/end          — End meeting, generate summary
GET  /api/meetings/:id              — Get meeting transcript
```

### Outputs
```
GET  /api/outputs                   — Get outputs library (filterable)
GET  /api/outputs/:id               — Get single output
GET  /api/outputs/:id/export        — Export output
```

### Trends
```
GET  /api/trends/current            — Get current trends for niche
GET  /api/trends/report             — Get latest Maya trend report
POST /api/trends/refresh            — Trigger fresh trend pull
```

### Video
```
POST /api/video/generate            — Send to Creatomate for rendering
GET  /api/video/:id/status          — Check render status
GET  /api/video/:id/download        — Get download URL from S3
```

### Stripe
```
POST /api/stripe/create-checkout    — Create Stripe checkout session
POST /api/stripe/portal             — Open billing portal
POST /api/stripe/webhook            — Stripe webhook handler
GET  /api/stripe/subscription       — Get current subscription details
```

---

## Agent Prompt Architecture

Each agent prompt is built from layers:

```typescript
buildAgentPrompt({
  basePersonality: AGENT_CONFIGS[role].systemPrompt,
  nicheContext: await getNicheKnowledge(company.niche),      // RAG
  brandContext: await getBrandMemory(company.id),             // Memory
  recentWork: await getRecentOutputs(company.id, role),       // History
  currentTask: task.description
})
```

### Bedrock Call Pattern
```typescript
const response = await bedrockClient.invokeModel({
  modelId: 'anthropic.claude-haiku-20240307-v1:0',
  body: JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: 'user', content: taskContent }]
  })
})
```

### Output Format Rule
Every agent MUST return structured JSON. Never raw prose.
Prompt every agent to respond in a defined JSON schema.
Parse and validate before storing.

---

## Key Components to Build

### Frontend Components

```
EmployeeCard          — Shows employee, status, current task, action buttons
MeetingRoom           — Full-screen meeting modal with character header
OutputCard            — Rich display of any output type with action buttons
TrendReportCard       — Maya's trend report visual display
ContentCalendar       — Jordan's weekly plan grid
HooksDisplay          — Alex's hooks with individual approve/reject per hook
ShotListDisplay       — Riley's production brief
VideoPlayer           — Preview rendered video before approval
OnboardingFlow        — Multi-step niche + brand setup
ActionButtonGroup     — Reusable approve/reject/reconsider button sets
MeetingSummary        — End-of-meeting decisions + auto-created tasks
```

### Backend Services

```
BedrockService        — All LLM calls, prompt building, response parsing
TrendService          — Google Trends + NewsAPI + RapidAPI aggregation
VideoService          — Creatomate integration, S3 upload/download
MemoryService         — Read/write brand memory, weight feedback
StripeService         — Checkout, webhooks, subscription management
TaskOrchestrator      — Manages task flow between agents
MeetingService        — Meeting state, Bedrock streaming, summary generation
```

---

## Environment Variables Needed

```env
# AWS
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_BEDROCK_REGION=us-east-1
AWS_KNOWLEDGE_BASE_ID_FITNESS=
AWS_KNOWLEDGE_BASE_ID_FINANCE=
AWS_KNOWLEDGE_BASE_ID_FOOD=
AWS_KNOWLEDGE_BASE_ID_COACHING=
AWS_KNOWLEDGE_BASE_ID_LIFESTYLE=
AWS_S3_BUCKET=vexa-outputs

# Database
DATABASE_URL=postgresql://...

# Auth
SESSION_SECRET=

# Admin
ADMIN_EMAILS=

# Payments
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_STARTER_PRICE_ID=
STRIPE_PRO_PRICE_ID=
STRIPE_AGENCY_PRICE_ID=

# Trend APIs
GOOGLE_TRENDS_API_KEY=
NEWS_API_KEY=
RAPIDAPI_KEY=

# Video
CREATOMATE_API_KEY=

# App
NEXT_PUBLIC_APP_URL=https://app.sovexa.ai
NEXT_PUBLIC_MARKETING_URL=https://sovexa.ai
```

---

## Subscription Plans

**Pricing strategy: same team quality + same features at every tier; differentiation is volume only (Claude model).**
All plans include all 3 employees (Maya · Jordan · Riley — Alex/copywriter currently shelved) AND every feature: meetings, brand memory, weekly pulse, video generation. Upgrading buys MORE — more daily tasks, more Studio edits, more video renders — not access to features. Free is the audition tier.

### Price reference (live Stripe — verified 2026-05-06)

| Tier | Monthly | Annual (billed yearly) | Annual ÷ 12 | Discount vs. monthly | Stripe product |
|---|---:|---:|---:|---:|---|
| **Free** | $0 | — | — | — | (no Stripe product) |
| **Pro** | **$19/mo** | **$180/yr** | $15/mo | 21.1% | `prod_URWKikqqN2k7xM` |
| **Max** | **$59/mo** | **$564/yr** | $47/mo | 20.3% | `prod_URWKUx8ObgzDTr` |
| **Agency** | **$149/mo** | **$1,428/yr** | $119/mo | 20.1% | `prod_URWKO5JG98Rp7b` |

Live Stripe price IDs (account `acct_1TNxeAFo8PldjyKY`, `livemode=true`):

```
STRIPE_PRO_MONTHLY_PRICE_ID    = price_1TSdHbFo8PldjyKYYj2uNfB5  ($19/mo)
STRIPE_PRO_ANNUAL_PRICE_ID     = price_1TSdHbFo8PldjyKYDWExG3MB  ($180/yr)
STRIPE_MAX_MONTHLY_PRICE_ID    = price_1TSdHbFo8PldjyKYlJivLENB  ($59/mo)
STRIPE_MAX_ANNUAL_PRICE_ID     = price_1TSdHcFo8PldjyKYG9cAMx3k  ($564/yr)
STRIPE_AGENCY_MONTHLY_PRICE_ID = price_1TSdHcFo8PldjyKYz2WUbtuw  ($149/mo)
STRIPE_AGENCY_ANNUAL_PRICE_ID  = price_1TSdHcFo8PldjyKYaWGunZyU  ($1,428/yr)
```

These IDs are set as plain env vars on the App Runner service (`sovexa-api-prod`), not via SSM. Plain env vars override SSM when both are present. As of 2026-05-06: 0 customers, 0 subscriptions, 0 charges in live Stripe — billing is wired but not yet publicly opened.

Marketing copy says "Save 20%" — true for all three tiers (effective discounts are slightly above 20% because the annual prices use clean round monthly equivalents instead of exact 20% off).

### Free — $0
- Full team + every feature, just smaller daily runway
- **3 user tasks / day** (resets 00:00 UTC)
- 25 Bedrock calls / day (silent abuse ceiling)
- 3 Studio edits / month (full iteration loop demo)
- 0 video renders
- 1-hour brief cooldown
- 1 revision per output
- No proactive auto-briefs (manual creation only — keeps Free cost predictable)

### Pro — $19/mo (annual: $15/mo, $180/yr)
- Full team + every feature, modest daily runway
- **8 user tasks / day**
- 200 Bedrock calls / day (silent ceiling)
- 8 Studio edits / month
- 3 video renders / month
- 10-min brief cooldown
- 5 revisions per output
- Proactive auto-briefs + weekly Maya pulse (Sonnet 4)

### Max — $59/mo (annual: $47/mo, $564/yr)
- **20 user tasks / day**
- 500 Bedrock calls / day
- 25 Studio edits / month
- 15 video renders / month
- 5-min brief cooldown
- 10 revisions per output

### Agency — $149/mo (annual: $119/mo, $1,428/yr)
- **150 user tasks / day** (across all owned workspaces — ~30/ws × 5 ws)
- 1,500 Bedrock calls / day
- 100 Studio edits / month (across all 5 workspaces)
- 75 video renders / month
- Up to 5 brand workspaces
- 2-min brief cooldown (priority queue)
- Custom employee personas
- White-label exports

### Quota architecture (added 2026-05-06)

The user-visible "tasks/day" cap is **`Task.source = 'user'`** only. Proactive cron-fired tasks set `source: 'system'` (`proactiveAnalysis.ts`, `metricTracking.ts`); onboarding seed tasks set `source: 'seed'` (`seedStarterTasks.ts`). `assertTaskQuota` in `usage.ts` filters by `source: 'user'` so system fires never block user actions. Without this split, a Free user would hit the wall before clicking anything because morning/midday/evening briefs alone consumed the entire monthly budget.

`assertBedrockQuota` in `bedrock.service.ts` is the pre-invoke cap gate. It reads plan + reset window from `PLAN_LIMITS`, current usage from `rateLimitStore` (Redis with in-memory fallback, daily and monthly buckets), and throws `bedrock_quota_exceeded` BEFORE the paid Bedrock call is made. Unlimited users (`isUnlimitedUser`) bypass.

`Studio` is metered separately via `assertStudioEditQuota` in `routes/video.ts:60` and `:239` — gates on `VideoUpload.count` because Studio edits cost ~15-50× more per call than a typical task ($0.10-0.15 vs $0.003-0.012).

> Internal notes: Plan enum is `free | pro | max | agency` — the Stripe product names match exactly. The legacy `starter` slug was retired. Live Stripe (account `acct_1TNxeAFo8PldjyKY`) has the matching products live, billing not yet open to public. App Runner env vars `STRIPE_PRO_*`, `STRIPE_MAX_*`, `STRIPE_AGENCY_*_PRICE_ID` carry the live price IDs.

### Notification infrastructure (SNS topics — added 2026-05-07, financial impact)

Two SNS topics provision operational alerting and inbound mail forwarding. Both are **fixed-cost infrastructure** (don't scale per paid user) and both run almost entirely on the AWS Free Tier today (1,000 publishes/mo + 1,000 email deliveries/mo + 100 SMS/mo free).

| Topic ARN | Fed by | Subscribers | Purpose |
|---|---|---|---|
| `arn:aws:sns:us-east-1:322513863369:sovexa-alerts` | 13 CloudWatch alarms (full list below) | 1 email → `jaytaskew@gmail.com` | Ops alerting sink |
| `arn:aws:sns:us-east-1:322513863369:sovexa-mail-inbound` | SES receipt rule `sovexa-inbound` (active) routing 6 inboxes: contact / hello / legal / privacy / support / team @ sovexa.ai | 1 email → `jaytaskew@gmail.com` | Inbound-mail forwarder |

**No application code publishes to either** — they are fed by CloudWatch and SES directly. Sovexa codebase has zero `@aws-sdk/client-sns` usage; only `docs/DEPLOY-PROD.md` references the topics.

CloudWatch alarms publishing to `sovexa-alerts` (built out incrementally 2026-05-07 → 2026-05-11, **13 alarms total**):

| Alarm name | Metric | Threshold | Protects against |
|---|---|---:|---|
| `sovexa-api-5xx-errors` | AppRunner 5xxStatusResponses | 10 | API crashes / unhandled exceptions |
| `sovexa-api-4xx-spike` | AppRunner 4xxStatusResponses | 50 | Abuse signal: bot signup flood, brute force |
| `sovexa-api-high-latency` | AppRunner RequestLatency | 5,000 ms | App Runner saturation, DB slowness |
| `sovexa-billing-50-usd` | AWS/Billing EstimatedCharges | $50 | First warning when credits exhaust |
| `sovexa-billing-100-usd` | AWS/Billing EstimatedCharges | $100 | Second warning — escalation |
| `sovexa-billing-200-usd` | AWS/Billing EstimatedCharges | $200 | Third warning — sustained burn |
| `sovexa-billing-500-usd` | AWS/Billing EstimatedCharges | $500 | Hard escalation |
| `sovexa-bedrock-monthly-cost` | AWS/Billing EstimatedCharges (Bedrock only) | $200/mo | Bedrock spike — biggest variable COGS line |
| `sovexa-rds-prod-connections-high` | RDS DatabaseConnections | 70 | Connection pool exhaustion |
| `sovexa-rds-prod-storage-low` | RDS FreeStorageSpace | 5 GB | RDS write failure imminent |
| `sovexa-s3-outputs-size-high` | S3 BucketSizeBytes (sovexa-outputs) | 50 GB | Unbounded storage growth (no lifecycle yet) |
| `sovexa-s3-outputs-dev-size-high` | S3 BucketSizeBytes (dev bucket) | 50 GB | Dev bucket runaway |
| `sovexa-stripe-webhook-errors` | Sovexa/Stripe.StripeWebhookErrors (custom) | 1 | Silent subscription-flow breakage |

> The `sovexa-stripe-webhook-errors` alarm is fed by a CloudWatch Logs metric filter (`sovexa-stripe-webhook-errors`) on the prod App Runner log group that matches the literal string `[stripe] webhook error`. That string lives in [apps/api/src/routes/stripe.ts:83](apps/api/src/routes/stripe.ts#L83) and is pinned in code with a CONTRACT comment — if anyone refactors it, the alarm silently stops firing. End-to-end SNS delivery validated 2026-05-11 via `set-alarm-state`.

Projected cost (added to "AWS misc" line in COGS, all tiers absorb it amortized):

| Scenario | SNS $/mo | CloudWatch alarms $/mo *(10 free, $0.10/alarm thereafter)* | Custom metrics $/mo *(10 free)* | Total |
|---|---:|---:|---:|---:|
| Today (13 alarms, 1 custom metric, ~190 publishes) | $0 | $0.30 (3 beyond free tier) | $0 | **$0.30/mo** |
| 100 paying users | $0 | $0.30 | $0 | **$0.30/mo** |
| 1,000 users — busier alarms, ~100 inbound/day | ~$0.84 | $0.30 | $0 | **~$1.14/mo** |
| 10,000 users — heavy alarms (likely 15-20 by then) | ~$4.30 | ~$1.00 | $0 | **~$5.30/mo** |

**SNS + CloudWatch monitoring will not exceed ~$5–6/mo** at meaningful scale. Net effect on tier margins: zero rounded. Each additional alarm beyond the first 10 costs $0.10/month — cheapest insurance in the stack and the only thing that catches credit-pool depletion + Bedrock spikes before they show up on the next bill. Treat as part of the "AWS misc/amortized" line in tier COGS.

### Deferred work — pricing/quota system (track here, ship deliberately)

These were scoped during the 2026-05-06 daily-cap rollout but intentionally NOT shipped because each requires a setup decision, external service, or operational migration that shouldn't happen autonomously. Order is rough urgency.

| # | Item | Why deferred | When to do |
|---|---|---|---|
| 1 | **Run `npx prisma migrate dev --name add_task_source`** | Migrates `TaskSource` enum + `Task.source` column added in code. Existing tasks default to `user`. Without this, the API won't start. | **Before next deploy** |
| 2 | **Activate `project=sovexa` cost-allocation tag** | One-click in AWS Billing → Cost allocation tags. Lets Cost Explorer split Sovexa costs from vp-agent's in the shared account. | Anytime — low effort, immediate win |
| 3 | **Tiered auto-brief schedule** (Free 1/day, Pro 2/day, Max/Agency 3/day) | All tiers currently get all 3 briefs. The `source: 'system'` split protects user quota, but Bedrock cost on Free is ~$0.30/user/mo higher than spec. | When Free user count > ~1K |
| 4 | **Phone verification on Free signup** (Twilio) | ~$0.05/signup. Policy decisions: which countries, fallback for non-phone, message body. | **Before opening public Free signup** |
| 5 | **IP / device fingerprinting** (FingerprintJS Pro ~$50/mo or open-source) | Vendor selection + integration. Anti-abuse alongside #4. | Before scaling Free past ~1K users |
| 6 | **30-day idle-suspend cron** | Code-only but affects existing users — needs UX decisions (email warning day 25? grace period? reactivation flow?). | Same trigger as #4–5 |
| 7 | **Meeting minutes meter** | Field exists in `usage.ts` types but not actually metered. Sonnet 4 streams in meetings = real cost vector. Free now has meetings — uncapped time = uncapped cost. | **Before opening meetings to Free at scale** |
| 8 | **Brand memory eviction policy** | `BrandMemory` table is unbounded today. Caps in `plans.ts` (10/100/1000/5000 entries) declared but not enforced — needs LRU eviction or write-rejection. | Before paid base hits ~500 users |
| 9 | **Move Sovexa to its own AWS sub-account** (Organizations) | Operational migration: replumb `DATABASE_URL`, S3 clone, App Runner re-create, DNS, Stripe webhook URLs. vp-agent currently burns ~$112/mo of shared credit pool. | When paid base hits ~500 users OR credit pool depletes |
| 10 | **CloudFront for video delivery** | DNS coordination + cache config. S3 egress is biggest scaling cost on Studio. | When S3 egress > ~$500/mo |
| 11 | **Dual daily+monthly Studio cap** | Currently monthly-only. A heavy Pro user could burn all 8 Studio edits in one Monday. | Only if abuse pattern emerges |
| 12 | **Bedrock model invocation logging** (`/aws/bedrock/*` CloudWatch group) | ~$0.50/mo. Full audit trail of every model call (caller IAM, model, tokens). Catches future cost anomalies in real time. | Anytime — small lift |

**Margin protection — already shipped:**
- ✅ `Task.source` enum + `assertTaskQuota` filtering by `source: 'user'` (proactive briefs never burn user budget)
- ✅ `assertBedrockQuota` pre-invoke gate (DB-backed via `rateLimitStore`, daily/monthly buckets, throws before paid call)
- ✅ `assertStudioEditQuota` in `routes/video.ts:60` and `:239` (Studio metered separately because per-call cost is 15-50× a normal task)
- ✅ Daily resets across all paid tiers (smooths AWS load, matches creator rhythm, sharpens Free→Pro conversion mechanic)

---

## Working contracts — DO NOT BREAK without coordinated updates

These are the fragile coupling points where current working features depend on
specific strings, selectors, or keys that span multiple files. Each one is the
shape of a regression we've actually shipped this session or one we caught
mid-session. **Before renaming, deleting, or refactoring any of the
identifiers below, check the listed dependents and update them in the same
commit.** Anchor commit for "what works today" is `f966470` (tagged
`tour-stable-2026-05-11`).

### Tour (apps/web/public/tour/tour-engine.js + tour-steps.js)

The tour spotlights real DOM elements via `data-tour-target` attributes that
`tagTargets()` sets on these selectors. Rename the selector → spotlight rings
around nothing → tour silently degrades to center-screen fallback.

| Tour step | Selector | Where it lives | If renamed, also update |
|---|---|---|---|
| Connect | `#vx-integrations-cta` | injected by `integrations-wire.js:115` | `tour-engine.js` tagTargets |
| HQ forecast | `#view-db-dashboard .hq3-hero` | `body.html` HQ section | `tour-engine.js` tagTargets |
| HQ playbook | `#view-db-dashboard.hq-v3 .playbook` | `body.html` pulse grid | `tour-engine.js` tagTargets |
| HQ anomalies | `#hq3-anomalies` | `body.html` side stack | `tour-engine.js` tagTargets |
| HQ pipeline | `#hq3-pipeline-sect` | `body.html` pipeline section | `tour-engine.js` tagTargets |
| Notifications | `#notif-btn` (topbar) | `body.html:178` | `tour-engine.js` tagTargets |
| Posts | `#view-db-posts .filters` | `body.html` Posts view | `tour-engine.js` tagTargets |
| Studio upload | `#studio-upload-zone` | `body.html` Studio | `tour-engine.js` tagTargets |
| Studio edits | `#studio-pending-container` | `body.html` Studio dash | `tour-engine.js` tagTargets |
| Studio schedule | `#view-db-studio .dash-side` | `body.html` Studio dash | `tour-engine.js` tagTargets |

**Studio demo cards** (injected when the tour spotlights Studio targets) use
these CSS classes from `vexa-shared.css:2117+`. Renaming the classes breaks
the demo's visual fidelity to real studio-wire cards:
`.studio-clip-card`, `.studio-clip-inner`, `.studio-clip-visual`,
`.studio-clip-placeholder`, `.studio-clip-meta`, `.studio-clip-meta-row`,
`.studio-clip-ver`, `.studio-clip-toning`, `.studio-clip-score`,
`.studio-clip-actions`, `.studio-clip-footer`, `.vx-icon-btn`.

**Tour state keys** (localStorage / sessionStorage):
- `vx-authed='1'` — set by auth-ui after login. Tour bails if missing.
- `vx-tour-done='1'` — set on main tour close. Test usernames bypass.
- `vx-mini-tour-<name>-done='1'` — set on mini tour close (e.g. `…-studio-done`).
- `vx-tour-auto-fired` — sessionStorage, prevents multi-fire from dash-ready.

**Test-user contract**: `tour-engine.js` `TEST_USERNAMES = ['jaytlin']` mirrors
`apps/api/src/lib/unlimitedAccounts.ts` `UNLIMITED_USERNAMES`. If you add a
test user to one, add to both.

**Event contract**: `tour-engine.js` listens for `vx-dash-ready` to know when
`window.__vxDashState.me.user.username` is populated. Dispatched by
`apps/web/public/dashboard-v2.js` at L57, L75, L2041. Don't drop the dispatch.

### Stripe webhook alarm (Sovexa/Stripe/StripeWebhookErrors)

The literal string `[stripe] webhook error` at
[apps/api/src/routes/stripe.ts:83](apps/api/src/routes/stripe.ts#L83) is
matched by the CloudWatch Logs metric filter `sovexa-stripe-webhook-errors`
on the prod App Runner log group. If the log line text changes, the alarm
silently stops firing — subscriptions break invisibly because Stripe retries
for 3 days then gives up. There's an inline CONTRACT comment at the catch
block; honor it.

### Hidden routes (apps/web/public/prototype.js)

`HIDDEN_ROUTES=['db-tasks']` reroutes hidden views to HQ if reached via URL
hash. `view-db-tasks` is preserved in `body.html` and reachable via
notification deep-links — don't delete it, don't add it to the nav. Other
orphan views (audience / outputs / pipeline) were deleted 2026-05-11; if you
re-add any of them, you must wire them into the nav AND add them to the
tour OR HIDDEN_ROUTES.

### Studio render contract (apps/web/public/studio-wire.js)

- `outputs-wire.js` renders into `[data-outputs-host]` selectors on the Work
  view (`#view-db-tasks`), NOT the standalone `#view-db-outputs` (deleted).
  If anyone re-introduces a standalone outputs view, update outputs-wire.js
  to render there too.
- `studio-wire.js` reads `clip.clippedUrl` and treats URLs containing
  `web.descript.com` as external editor links rather than playable videos.
  Don't change this detection — it's the contract with the Descript
  integration.
- `#studio-pending-container` is a 3-col grid (2-col at <1320px, 1-col at
  <720px) per `vexa-shared.css:2107`. Demo cards span all columns via
  `grid-column:1 / -1`; real studio-wire cards fit 1/N width.

### Auth + session contract

- Session cookie is httpOnly — JS can't read `vx_session` directly. The
  `vx-authed` localStorage flag is the JS-visible proxy. Both auth-ui and
  intro-wire / waitlist depend on this flag pattern.
- `/api/auth/me` must return `{ user: { username, plan, ... }, companies: [...] }`.
  The frontend reads `__vxDashState.me.user.username` — schema change breaks
  the tour test-user check and the profile-wire display.

### CloudWatch alarms (13 total → `sovexa-alerts` SNS topic)

Full list documented in the "Notification infrastructure" section above.
Don't delete the SNS topic or detach the email subscriber without replacing
the alerting chain — the 5xx / latency / billing / RDS / S3 / Bedrock /
Stripe-webhook alarms all rely on it. End-to-end SNS delivery validated
2026-05-11.

### `BEDROCK_MODEL_ID` env var (deferred but documented)

The code default `anthropic.claude-3-haiku-20240307-v1:0` in
[bedrock.service.ts:13](apps/api/src/services/bedrock/bedrock.service.ts#L13)
is a LEGACY model ID — direct ON_DEMAND invocations return
`ValidationException: Operation not allowed`. The fix is to set
`BEDROCK_MODEL_ID=us.anthropic.claude-3-haiku-20240307-v1:0` (the inference
profile variant) as an App Runner env var on `sovexa-api-dev` and
`sovexa-api-prod`. Deferred this session because the AWS account-level
anomaly flag was blocking App Runner deploys; apply it once the flag clears.
Until then, Maya's playbook, forecast narrative, briefs, and video style
analysis all fail silently with `Operation not allowed`.

---

## Build Order (Recommended)

### Phase 1 — Foundation ✅
1. Next.js project setup + Tailwind + shadcn
2. Custom JWT auth (signup, login, session cookies)
3. RDS database + Prisma schema
4. Express API on App Runner

### Phase 2 — Core Product
5. Onboarding flow (niche selection, brand voice)
6. Employee system (spawn, display, status)
7. Bedrock integration (Haiku, agent prompts)
8. Task system (create, deliver, action buttons)
9. Meeting room (conversation + summary)

### Phase 3 — Intelligence
10. RAG knowledge bases per niche
11. Brand memory system
12. Trend service integrations
13. Auto-proactive deliveries (Monday reports, Sunday plan)

### Phase 4 — Production
14. Creatomate video generation
15. S3 output storage
16. Stripe subscriptions + webhooks
17. Outputs library

### Phase 5 — Launch
18. Marketing website
19. Email notifications
20. Analytics + monitoring

---

## Notes for Claude Code

- Always use TypeScript. No JavaScript files.
- All agent responses must be validated against a Zod schema before storing.
- Never expose Bedrock credentials client-side. All AI calls go through the API.
- The meeting feature is free-form text input — the ONLY place in the app where this exists.
- Button actions should optimistically update the UI before the API confirms.
- Use streaming for meeting responses from Bedrock for a real-time feel.
- Every output stored in DB must include version number for revision tracking.
- Brand memory should be updated after every approved output and every meeting.
