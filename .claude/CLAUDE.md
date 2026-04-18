# VEXA — Claude Code Master Instructions

## What is Vexa?
Vexa is a SaaS platform that gives content creators an AI-powered content team.
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
- **Auth**: AWS Cognito via Amplify Auth
- **Fonts**: Syne (headings) + DM Sans (body)

### Backend
- **Runtime**: Node.js
- **Framework**: Express.js on AWS Lambda
- **API**: REST via API Gateway
- **Database**: PostgreSQL on AWS RDS
- **ORM**: Prisma

### AI Layer
- **LLM**: AWS Bedrock — Claude Haiku (`anthropic.claude-haiku-20240307-v1:0`)
- **RAG**: AWS Bedrock Knowledge Bases (one per niche)
- **Memory**: Custom memory service using RDS + Bedrock embeddings

### Infrastructure
- **Hosting**: AWS
- **Frontend**: AWS Amplify
- **Backend**: AWS Lambda + API Gateway
- **Database**: AWS RDS (PostgreSQL)
- **Storage**: AWS S3 (outputs, video assets)
- **Auth**: AWS Cognito
- **Video Generation**: Creatomate API
- **Trend Data**: Google Trends API + NewsAPI + RapidAPI
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

### Alex — Copywriter & Script Writer
- **Personality**: Creative, punchy, opinionated. Pushes back if a brief is weak.
- **Voice**: "I wrote 5 hooks. Hook #3 is the one — the others are safe, this one will stop thumbs."
- **Outputs**: Hooks (3-10 variations), captions, Reel scripts, carousel copy, CTAs
- **Proactive**: Delivers content copy once Jordan's plan is approved
- **Bedrock prompt file**: `apps/api/src/agents/alex/system-prompt.ts`

### Riley — Creative Director
- **Personality**: Visual thinker, detail-obsessed, speaks in scenes and shots.
- **Voice**: "Open on a close-up. No talking for the first 2 seconds. Let the visual do the work."
- **Outputs**: Shot lists, pacing guides, visual direction, editing notes, Creatomate templates
- **Proactive**: Delivers production brief once Alex's copy is approved
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

**Hooks & Copy (Alex)**
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
  cognito_id VARCHAR UNIQUE NOT NULL,
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

### Auth
```
POST /api/auth/signup
POST /api/auth/login
POST /api/auth/logout
POST /api/auth/refresh
GET  /api/auth/me
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
COGNITO_USER_POOL_ID=
COGNITO_CLIENT_ID=
NEXTAUTH_SECRET=

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

### Starter — $29/mo ($22/mo annual)
- 2 employees (Maya + Alex)
- 20 tasks/month
- Basic brand voice
- 3 revisions per output
- No meeting feature
- No video generation

### Pro — $79/mo ($59/mo annual)
- All 4 employees
- Unlimited tasks
- Full brand voice + memory
- Unlimited revisions
- Meeting feature unlocked
- Video generation (10/month)
- Monday trend reports (automatic)

### Agency — $149/mo ($112/mo annual)
- Up to 5 brand workspaces
- Everything in Pro per workspace
- Priority Bedrock processing
- 50 video generations/month
- Advanced analytics
- Custom employee personas
- White-label exports

---

## Build Order (Recommended)

### Phase 1 — Foundation
1. Next.js project setup + Tailwind + shadcn
2. AWS Cognito auth (signup, login, session)
3. RDS database + Prisma schema + migrations
4. Basic API structure on Lambda

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
