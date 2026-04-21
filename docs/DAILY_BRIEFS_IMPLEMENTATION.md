# Daily Briefs Implementation Spec

## Overview
Daily briefs keep users engaged between weekly plans. Three core briefing times:
- **Morning (8am UTC)**: Trends + queue + yesterday recap
- **Midday (1pm UTC)**: Performance pulse (optional)
- **Evening (8pm UTC)**: Full recap + tomorrow forecast

---

## Database Schema Changes

### Add to TaskStatus enum
```prisma
enum OutputType {
  // existing...
  morning_brief      // Daily 8am
  midday_check       // Daily 1pm (optional)
  evening_recap      // Daily 8pm
}
```

---

## Backend Implementation

### 1. Daily Brief Service (`apps/api/src/lib/dailyBrief.service.ts`)

**Functions needed:**

```typescript
// Get trends from Google Trends API + RSS + Reddit for niche
getTrendingTopics(niche: string, subNiche?: string): Promise<TrendingTopic[]>

// Get yesterday's post performance
getYesterdayPerformance(companyId: string): Promise<PostPerformance[]>

// Get queue status (posts ready to post today/tomorrow/week)
getQueueStatus(companyId: string): Promise<QueuedPost[]>

// Get audience insights (cohort engagement, peak times)
getAudienceInsights(companyId: string): Promise<AudienceInsight>

// Compute midday forecast (how today's posts are tracking)
getMidayPerformance(companyId: string): Promise<MidayMetrics>

// Get evening performance summary
getEveningPerformance(companyId: string): Promise<EveningMetrics>

// Detect real-time anomalies (surge, underperformance)
detectAnomalies(companyId: string): Promise<Anomaly[]>
```

**Key data structures:**

```typescript
type TrendingTopic = {
  topic: string
  category: string
  growthPercent: number
  timeframe: string
  isNewlyTrending: boolean
  saturationLevel: 'low' | 'medium' | 'high'
}

type PostPerformance = {
  id: string
  caption: string
  platform: string
  publishedAt: Date
  metrics: {
    reach: number
    engagement: number
    engagementRate: number
    saves: number
    comments: number
  }
  vsAverage: string // "+15% above avg"
  topCohort: { name: string; percentage: number }
}

type QueuedPost = {
  id: string
  scheduledTime: Date
  caption: string
  format: string
  platform: string
  status: 'ready' | 'in_production'
  eta?: Date
}

type AudienceInsight = {
  topCohorts: Array<{
    name: string
    engagementRate: number
    engagementVsAvg: string
  }>
  peakTimes: string[] // "Wed 6-8pm", "Fri 6pm"
  mobileVsDesktop: { mobile: number; desktop: number }
}

type MidayMetrics = {
  post: PostPerformance
  hoursPublished: number
  trajectory: string // "tracking well", "underperforming", "exceeding"
  forecast: { estimatedFinalReach: number; confidence: number }
}

type EveningMetrics = {
  posts: PostPerformance[]
  insights: string[]
  bestPerformer: PostPerformance
  worstPerformer?: PostPerformance
  forecast: { tomorrowExpectedReach: number; topCohort: string }
}

type Anomaly = {
  type: 'surge' | 'underperformance' | 'trend_match'
  post?: string
  trend?: string
  message: string
  urgency: 'high' | 'medium'
}
```

---

### 2. Maya's Daily Brief Prompts

**File:** `apps/api/src/agents/maya/daily-brief-prompts.ts`

```typescript
// Morning brief (8am)
export function buildMayaMorningBriefPrompt(context: {
  niche: string
  subNiche?: string
  trends: TrendingTopic[]
  yesterdayPosts: PostPerformance[]
  queuedPosts: QueuedPost[]
  audienceInsights: AudienceInsight
}): string

// Midday check (1pm)
export function buildMayaMidayCheckPrompt(context: {
  niche: string
  todaysPosts: PostPerformance[]
  hoursElapsed: number
  forecast: MidayMetrics
}): string

// Evening recap (8pm)
export function buildMayaEveningRecapPrompt(context: {
  niche: string
  todaysPosts: PostPerformance[]
  insights: string[]
  forecast: EveningMetrics
  queuedTomorrow: QueuedPost[]
}): string
```

**Expected outputs:**

```typescript
type MorningBrief = {
  trendingTopics: Array<{
    topic: string
    urgency: 'act_now' | 'keep_watching'
    angle: string // "Here's how this creator should approach it"
    shouldBrief?: boolean // "Should Jordan create a new brief?"
  }>
  yesterdayWin: {
    post: string
    reach: number
    engagementRate: number
    why: string
    topCohort: string
  }
  queueStatus: {
    ready: number
    inProduction: number
    todaysContent: QueuedPost[]
  }
  audiencePulse: {
    peakTime: string
    activeToday: string // "Women 18-24 more active today (+20%)"
  }
  recommendation: string // Quick guidance for the day
}

type MidayCheck = {
  trackedPost: { caption: string; platform: string }
  hoursPublished: number
  currentMetrics: { reach: number; engagement: number }
  trajectory: string // "on pace", "accelerating", "underperforming"
  forecast: { estimatedReach: number; estimatedEngagement: number }
  actionIfSurging?: string // "Consider boosting"
}

type EveningRecap = {
  summary: string // "Here's what happened today"
  bestPost: {
    caption: string
    reach: number
    engagementRate: number
    why: string // Why it outperformed
    topCohort: string
  }
  learnings: string[] // 3 key learnings
  tomorrowForecast: {
    expectedReach: number
    topCohort: string
    recommendation: string
  }
  trendOpportunity?: {
    trend: string
    shouldBrief: boolean
    reason: string
  }
}
```

---

### 3. Update Scheduler (`apps/api/src/scheduler.ts`)

**Add three new cron jobs:**

```typescript
// 8:00 AM UTC — Morning brief
cron.schedule('0 8 * * *', async () => {
  const companies = await prisma.company.findMany({
    select: { id: true }
  })
  for (const { id } of companies) {
    await triggerMorningBrief(prisma, id)
  }
})

// 1:00 PM UTC — Midday check (optional)
cron.schedule('0 13 * * *', async () => {
  const companies = await prisma.company.findMany({
    select: { id: true }
  })
  for (const { id } of companies) {
    await triggerMidayCheck(prisma, id)
  }
})

// 8:00 PM UTC — Evening recap
cron.schedule('0 20 * * *', async () => {
  const companies = await prisma.company.findMany({
    select: { id: true }
  })
  for (const { id } of companies) {
    await triggerEveningRecap(prisma, id)
  }
})
```

**New functions in proactiveAnalysis.ts:**

```typescript
export async function triggerMorningBrief(
  prisma: PrismaClient,
  companyId: string
): Promise<{ triggered: boolean; taskId?: string }>

export async function triggerMidayCheck(
  prisma: PrismaClient,
  companyId: string
): Promise<{ triggered: boolean; taskId?: string }>

export async function triggerEveningRecap(
  prisma: PrismaClient,
  companyId: string
): Promise<{ triggered: boolean; taskId?: string }>
```

---

### 4. API Routes (`apps/api/src/routes/briefs.ts` - NEW)

```typescript
// GET /api/briefs/morning
// Get today's morning brief
router.get('/morning', async (req, res) => {
  const companyId = req.body.companyId
  const brief = await getMorningBrief(prisma, companyId)
  res.json(brief)
})

// GET /api/briefs/midday
// Get midday performance check
router.get('/midday', async (req, res) => {
  const companyId = req.body.companyId
  const check = await getMidayCheck(prisma, companyId)
  res.json(check)
})

// GET /api/briefs/evening
// Get evening recap
router.get('/evening', async (req, res) => {
  const companyId = req.body.companyId
  const recap = await getEveningRecap(prisma, companyId)
  res.json(recap)
})

// GET /api/briefs/queue
// Get queue status (used in multiple places)
router.get('/queue', async (req, res) => {
  const companyId = req.body.companyId
  const queue = await getQueueStatus(prisma, companyId)
  res.json(queue)
})

// POST /api/briefs/queue/:postId/post-now
// Immediately post queued content
router.post('/queue/:postId/post-now', async (req, res) => {
  // Trigger immediate posting to platform
})

// POST /api/briefs/approve-trend
// Approve trend pivot (creates Jordan brief task)
router.post('/approve-trend', async (req, res) => {
  // Create task for Jordan to brief Alex on new trend
})
```

---

## Frontend Implementation

### 1. Morning Brief Wire (`apps/web/public/morning-brief-wire.js`)

```javascript
// Renders morning brief UI
// - Trending topics with urgency levels
// - Yesterday's performance highlight
// - Queue status
// - Audience pulse
// - Action buttons: [View full brief] [Approve trends] [Talk to Maya]
```

### 2. Queue Status Wire (`apps/web/public/queue-status-wire.js`)

```javascript
// Renders post queue display
// - Today's posts with times
// - Tomorrow's posts
// - Week overview
// - Action buttons per post: [Post now] [Preview] [Edit]
```

### 3. Midday Check Wire (`apps/web/public/midday-check-wire.js`)

```javascript
// Renders midday performance pulse
// - How is today's post(s) tracking
// - Forecast to completion
// - Early signals
// - Action: [Full stats] [Alert if surges]
```

### 4. Evening Recap Wire (`apps/web/public/evening-recap-wire.js`)

```javascript
// Renders evening summary
// - Today's posts final performance
// - Learnings extracted by Maya
// - Tomorrow's forecast
// - Trend opportunity (if any)
// - Action: [Full report] [Approve trend] [Tomorrow's posts]
```

### 5. Update Dashboard Shell

Add brief display sections to `_prototype/body.html`:
- Top of page: Morning brief (if time < 11am)
- Sidebar: Queue status (always visible)
- Modal/card: Evening recap (evening)
- Toast/banner: Anomaly alerts (real-time)

---

## Implementation Sequence

### Phase 1 (Week 1) - Core Daily Briefs
1. Add task types to schema
2. Create dailyBrief.service.ts with data fetching
3. Create Maya's daily prompts
4. Update scheduler with 3 cron jobs
5. Create /api/briefs/* routes
6. Create front-end wires
7. Integrate briefs into dashboard

### Phase 2 (Week 2) - Queue Management
1. Implement queue display wire
2. Add post-now action
3. Add preview/edit actions
4. Wire to platform posting APIs

### Phase 3 (Week 3) - Advanced Features
1. Real-time anomaly detection
2. Trend pivot flow (→ Jordan briefing)
3. Midday check (optional but nice)
4. Push notifications for briefs

---

## Testing Checklist

- [ ] Morning brief renders correctly with real data
- [ ] Queue status shows posts ready to post
- [ ] "Post now" actually posts to Instagram/TikTok
- [ ] Evening recap has accurate performance data
- [ ] Trend opportunity suggestions appear correctly
- [ ] Scheduler triggers at correct times
- [ ] No duplicate briefs (dedup logic works)
- [ ] Mobile responsive (brief fits in phone screen)

---

## Notes

- **Time zones:** All cron times are UTC. Consider company's preference (if added later)
- **Dedup:** Don't send duplicate briefs. Check if brief already sent in last 24h
- **Data freshness:** Briefs need real-time post data. May need Redis caching for performance
- **Notifications:** Email + in-app. User preference toggle needed (post-MVP)
