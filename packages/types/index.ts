// ─── ENUMS ───────────────────────────────────────────────────────────────────

export type SubscriptionStatus = 'trial' | 'active' | 'canceled' | 'past_due'
export type Plan = 'starter' | 'pro' | 'agency'
export type Platform = 'instagram'
export type EmployeeRole = 'analyst' | 'strategist' | 'copywriter' | 'creative_director'
export type TaskStatus = 'pending' | 'in_progress' | 'delivered' | 'approved' | 'rejected' | 'revision'
export type OutputType = 'trend_report' | 'content_plan' | 'hooks' | 'caption' | 'script' | 'shot_list' | 'video' | 'performance_review' | 'weekly_pulse' | 'upload_review' | 'content_audit' | 'growth_strategy' | 'feed_audit' | 'format_analysis'
export type OutputStatus = 'draft' | 'approved' | 'rejected'
export type MemoryType = 'feedback' | 'preference' | 'performance' | 'voice'

// ─── USER ────────────────────────────────────────────────────────────────────

export interface User {
  id: string
  email: string
  cognitoId: string
  fullName?: string
  subscriptionStatus: SubscriptionStatus
  plan: Plan
  stripeCustomerId?: string
  stripeSubscriptionId?: string
  createdAt: Date
  updatedAt: Date
}

// ─── COMPANY ─────────────────────────────────────────────────────────────────

export interface BrandVoice {
  tone: string[]           // e.g. ['motivational', 'direct', 'conversational']
  avoid: string[]          // e.g. ['corporate jargon', 'overly technical']
  examples?: string[]      // sample posts the user has approved
  personality: string      // free text description
}

export interface Audience {
  ageRange?: string
  gender?: string
  interests: string[]
  painPoints: string[]
  goals: string[]
}

export interface CompanyGoals {
  followerTarget?: number
  contentFrequency: string  // e.g. '5x per week'
  primaryGoal: string       // e.g. 'grow following', 'drive sales', 'build authority'
}

export interface Company {
  id: string
  userId: string
  name: string
  niche: string
  subNiche?: string
  platform: Platform
  brandVoice: BrandVoice
  audience: Audience
  goals: CompanyGoals
  createdAt: Date
}

// ─── EMPLOYEES ───────────────────────────────────────────────────────────────

export interface Employee {
  id: string
  companyId: string
  role: EmployeeRole
  name: string
  isActive: boolean
  lastActive?: Date
}

export interface EmployeeWithStatus extends Employee {
  currentTask?: Task
  lastOutput?: Output
  pendingActions: number
}

// Employee display config (static, not from DB)
export interface EmployeeConfig {
  role: EmployeeRole
  name: string
  title: string
  emoji: string
  color: string
  personality: string
  specialties: string[]
  proactiveSchedule: string
}

export const EMPLOYEE_CONFIGS: Record<EmployeeRole, EmployeeConfig> = {
  analyst: {
    role: 'analyst',
    name: 'Maya',
    title: 'Trend & Insights Analyst',
    emoji: '📊',
    color: '#6ab4ff',
    personality: 'Data-driven, precise, slightly urgent. Always backs claims with numbers.',
    specialties: ['Trend reports', 'Competitor intel', 'Viral hook opportunities', 'Content gap analysis'],
    proactiveSchedule: 'Every Monday 9am'
  },
  strategist: {
    role: 'strategist',
    name: 'Jordan',
    title: 'Content Strategist',
    emoji: '🗺️',
    color: '#c8f060',
    personality: 'Calm, organized, big-picture thinker. Speaks in systems and frameworks.',
    specialties: ['Weekly content calendars', 'Content pillars', 'Audience analysis', 'Posting strategy'],
    proactiveSchedule: 'Every Sunday 7pm'
  },
  copywriter: {
    role: 'copywriter',
    name: 'Alex',
    title: 'Copywriter & Script Writer',
    emoji: '✍️',
    color: '#e8c87a',
    personality: 'Creative, punchy, opinionated. Pushes back if a brief is weak.',
    specialties: ['Hooks', 'Captions', 'Reel scripts', 'Carousel copy', 'CTAs'],
    proactiveSchedule: 'After Jordan\'s plan is approved'
  },
  creative_director: {
    role: 'creative_director',
    name: 'Riley',
    title: 'Creative Director',
    emoji: '🎬',
    color: '#b482ff',
    personality: 'Visual thinker, detail-obsessed. Speaks in scenes and shots.',
    specialties: ['Shot lists', 'Pacing guides', 'Visual direction', 'Editing notes'],
    proactiveSchedule: 'After Alex\'s copy is approved'
  }
}

// ─── TASKS ───────────────────────────────────────────────────────────────────

export interface TaskAction {
  type: string        // e.g. 'approve', 'reject', 'reconsider', 'use_hook_3'
  label: string       // display label
  feedback?: string   // optional user feedback on reconsider
  timestamp: Date
}

export interface Task {
  id: string
  companyId: string
  employeeId: string
  title: string
  description?: string
  type: string
  status: TaskStatus
  output?: Output
  userAction?: TaskAction
  createdAt: Date
  completedAt?: Date
}

// ─── OUTPUTS ─────────────────────────────────────────────────────────────────

// Trend Report (Maya)
export interface TrendReport {
  trends: Array<{
    topic: string
    category: string
    growthPercent: number
    timeframe: string
    whyItMatters: string
    contentOpportunity: string
    urgency: 'high' | 'medium' | 'low'
    suggestedHook: string
  }>
  weekSummary: string
  topOpportunity: string
  generatedAt: Date
}

// Content Plan (Jordan)
export interface ContentPlan {
  weekOf: string
  pillars: string[]
  posts: Array<{
    day: string
    date: string
    format: 'reel' | 'carousel' | 'static' | 'story'
    topic: string
    angle: string
    goal: string
    notes?: string
  }>
  strategyNote: string
  audienceFocus: string
}

// Hooks (Alex)
export interface HooksOutput {
  hooks: Array<{
    id: string
    text: string
    style: string     // e.g. 'bold claim', 'question', 'story opener', 'controversial'
    targetEmotion: string
    alexNote: string  // Alex's commentary on why this hook works
  }>
  recommendedHook: string   // id of Alex's top pick
  briefNote: string         // Alex's overall note on the brief
}

// Script (Alex)
export interface ScriptOutput {
  hookLine: string
  sections: Array<{
    timestamp: string
    direction: string
    speakingText?: string
    textOverlay?: string
  }>
  cta: string
  estimatedDuration: string
  alexNote: string
}

// Shot List (Riley)
export interface ShotListOutput {
  shots: Array<{
    number: number
    type: string       // e.g. 'close-up', 'wide', 'POV', 'B-roll'
    description: string
    duration: string
    cameraNote: string
    audioNote?: string
  }>
  editingNotes: string
  musicMood: string
  textOverlayGuide: string
  rileyNote: string
}

export interface PerformanceReview {
  accountHandle: string
  platform: 'tiktok'
  snapshotDate: string
  accountHealth: {
    followerCount: number
    totalLikes: number
    totalVideos: number
    avgViews: number
    engagementRate: number
    reachRate: number
    overallAssessment: string
  }
  whatsWorking: Array<{
    videoTitle: string
    url: string | null
    viewCount: number
    likeCount: number
    engagementScore: number
    whyItWorked: string
  }>
  whatsNotWorking: Array<{
    videoTitle: string
    url: string | null
    viewCount: number
    likeCount: number
    engagementScore: number
    whyItUnderperformed: string
  }>
  recentActivity: Array<{
    videoTitle: string
    url: string | null
    publishedAt: string
    viewCount: number
    likeCount: number
    vsAverage: string
  }>
  trajectory: 'improving' | 'stable' | 'declining'
  postingFrequency: {
    postsPerWeek: number
    assessment: string
    bestDayPattern: string
  }
  keyInsights: string[]
  topRecommendation: string
  generatedAt: string
}

export interface WeeklyPulse {
  accountHandle: string
  platform: 'tiktok'
  weekOf: string
  postsThisWeek: number
  winOfTheWeek: {
    videoTitle: string
    url: string | null
    viewCount: number
    engagementScore: number
    whyItWorked: string
  } | null
  missOfTheWeek: {
    videoTitle: string
    url: string | null
    viewCount: number
    engagementScore: number
    whatToTryNext: string
  } | null
  trajectory: {
    direction: 'up' | 'down' | 'flat'
    summary: string
  }
  oneThingToDo: string
  generatedAt: string
}

// Content Audit (Jordan)
export interface ContentAudit {
  period: string                // e.g. "Last 30 days"
  postsAnalyzed: number
  formatBreakdown: Array<{
    format: string              // 'reel' | 'carousel' | 'static' | 'story'
    count: number
    avgEngagement: number
    verdict: 'overused' | 'underused' | 'balanced'
  }>
  postingPatterns: {
    postsPerWeek: number
    bestDays: string[]
    bestTimes: string[]
    consistency: 'strong' | 'inconsistent' | 'declining'
    note: string
  }
  pillarBalance: Array<{
    pillar: string
    percentage: number
    performance: 'strong' | 'weak' | 'average'
    note: string
  }>
  topPerformers: Array<{
    caption: string
    format: string
    engagement: number
    whyItWorked: string
  }>
  gaps: string[]                // what's missing from their content mix
  jordanNote: string
  generatedAt: string
}

// Growth Strategy (Jordan)
export interface GrowthStrategy {
  currentState: {
    followers: number
    avgEngagement: number
    trajectory: 'growing' | 'flat' | 'declining'
    summary: string
  }
  strategy: Array<{
    priority: number
    action: string
    why: string
    expectedImpact: 'high' | 'medium' | 'low'
    timeframe: string           // e.g. "This week", "Next 30 days"
  }>
  postingSchedule: {
    recommended: string         // e.g. "5x per week"
    current: string
    optimalDays: string[]
    optimalTimes: string[]
    note: string
  }
  audienceInsights: {
    whoEngages: string
    whatTheyWant: string
    contentTheyIgnore: string
  }
  competitorGaps: string[]      // opportunities from similar creators
  jordanNote: string
  generatedAt: string
}

// Feed Audit (Riley)
export interface FeedAudit {
  postsReviewed: number
  overallAesthetic: {
    score: number               // 1-10
    description: string         // e.g. "Warm, earthy tones with high contrast"
    consistency: 'cohesive' | 'mixed' | 'scattered'
  }
  colorPalette: {
    dominant: string[]          // e.g. ["warm tones", "earth browns", "golden hour"]
    note: string
  }
  moodPattern: {
    primary: string             // e.g. "aspirational lifestyle"
    secondary: string
    note: string
  }
  gridFlow: {
    score: number               // 1-10 — how well posts look together on the grid
    note: string
  }
  brandAlignment: {
    score: number
    onBrand: string[]           // posts that match the brand
    offBrand: string[]          // posts that feel out of place
    note: string
  }
  recommendations: string[]
  rileyNote: string
  generatedAt: string
}

// Format Analysis (Riley)
export interface FormatAnalysis {
  postsAnalyzed: number
  formatPerformance: Array<{
    format: string
    count: number
    avgViews: number
    avgLikes: number
    avgShares: number
    engagementRate: number
    trend: 'rising' | 'stable' | 'falling'
    note: string
  }>
  bestFormat: {
    format: string
    why: string
    topExample: string          // caption of best-performing post in this format
  }
  underusedFormat: {
    format: string
    why: string
    opportunity: string
  }
  trendingFormats: Array<{
    format: string
    whyTrending: string
    nicheRelevance: 'high' | 'medium' | 'low'
  }>
  recommendations: string[]
  rileyNote: string
  generatedAt: string
}

// Upload Review (Riley)
export interface VideoEditCommand {
  type: 'trim' | 'speed' | 'crop' | 'text' | 'audio_norm' | 'audio_strip' | 'mood'
  label: string                 // human-readable description
  // trim
  startSec?: number
  endSec?: number
  // speed
  factor?: number
  // crop
  aspect?: '9:16' | '1:1' | '4:5' | '16:9'
  // text overlay
  content?: string
  position?: 'top' | 'center' | 'bottom'
  fontSize?: number
  color?: string
  // mood (color grading)
  mood?: 'warm' | 'cool' | 'moody' | 'bright' | 'vintage' | 'cinematic'
}

export interface UploadReview {
  verdict: 'ready_to_post' | 'needs_work'
  overallScore: number          // 1-10
  breakdown: {
    nicheFit: { score: number; note: string }
    brandConsistency: { score: number; note: string }
    hook: { score: number; note: string }
    moodTone: { score: number; note: string }
    engagementPotential: { score: number; note: string }
    platformFit: { score: number; note: string }
  }
  strengths: string[]
  issues: string[]              // empty if ready_to_post
  suggestedEdits: VideoEditCommand[]  // post-production edits the system can auto-apply
  rileyNote: string             // Riley's creative assessment
  uploadKey: string             // S3 key of the uploaded file
  uploadType: 'video' | 'image'
  thumbnailUrl?: string
  editedKey?: string            // S3 key of edited version (after edits applied)
  editedUrl?: string            // presigned URL of edited version
  videoDuration?: number        // probed duration in seconds
}

export interface OutputContent {
  trend_report: TrendReport
  content_plan: ContentPlan
  hooks: HooksOutput
  caption: { caption: string; hashtags: string[]; ctaNote: string }
  script: ScriptOutput
  shot_list: ShotListOutput
  video: { url: string; s3Key: string; duration: string; thumbnailUrl: string }
  performance_review: PerformanceReview
  weekly_pulse: WeeklyPulse
  upload_review: UploadReview
  content_audit: ContentAudit
  growth_strategy: GrowthStrategy
  feed_audit: FeedAudit
  format_analysis: FormatAnalysis
}

export interface Output {
  id: string
  taskId: string
  companyId: string
  employeeId: string
  type: OutputType
  content: OutputContent[OutputType]
  status: OutputStatus
  feedback?: Record<string, unknown>
  version: number
  createdAt: Date
}

// ─── MEETINGS ─────────────────────────────────────────────────────────────────

export interface MeetingMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

export interface MeetingDecision {
  decision: string
  actionItem?: string
  assignedTo?: EmployeeRole
}

export interface Meeting {
  id: string
  companyId: string
  employeeId: string
  messages: MeetingMessage[]
  summary?: string
  decisions?: MeetingDecision[]
  tasksCreated?: string[]   // task IDs created from this meeting
  startedAt: Date
  endedAt?: Date
}

// ─── API RESPONSES ───────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

// ─── ACTION BUTTONS ──────────────────────────────────────────────────────────

export interface ActionButton {
  id: string
  label: string
  emoji: string
  variant: 'approve' | 'reject' | 'reconsider' | 'neutral'
  confirmRequired?: boolean
  feedbackPrompt?: string  // if set, show a brief text input before submitting
}

// Button sets per output type
export const OUTPUT_ACTIONS: Record<OutputType, ActionButton[]> = {
  trend_report: [
    { id: 'use_trend', label: 'Use this trend', emoji: '✅', variant: 'approve' },
    { id: 'skip', label: 'Skip — not relevant', emoji: '⏭', variant: 'reject' },
    { id: 'more_like_this', label: 'Show me more like this', emoji: '🔄', variant: 'reconsider' },
    { id: 'save_later', label: 'Save for later', emoji: '📅', variant: 'neutral' },
  ],
  content_plan: [
    { id: 'approve', label: 'Approve plan', emoji: '✅', variant: 'approve' },
    { id: 'rethink_angle', label: 'Rethink the angle', emoji: '🔄', variant: 'reconsider' },
    { id: 'adjust_timing', label: 'Adjust the timing', emoji: '⏰', variant: 'reconsider' },
    { id: 'modify_days', label: 'Modify specific days', emoji: '📋', variant: 'neutral' },
  ],
  hooks: [
    { id: 'use_hook', label: 'Use this hook', emoji: '✅', variant: 'approve' },
    { id: 'be_bolder', label: 'Too safe — be bolder', emoji: '🔄', variant: 'reconsider' },
    { id: 'off_brand', label: 'Off-brand — try again', emoji: '🎯', variant: 'reject' },
    { id: 'more_variations', label: 'Give me 5 more', emoji: '➕', variant: 'neutral' },
    { id: 'tweak_tone', label: 'Use but tweak tone', emoji: '✏️', variant: 'reconsider', feedbackPrompt: 'How should the tone change?' },
  ],
  caption: [
    { id: 'approve', label: 'Use this caption', emoji: '✅', variant: 'approve' },
    { id: 'shorter', label: 'Make it shorter', emoji: '✂️', variant: 'reconsider' },
    { id: 'stronger_cta', label: 'Stronger CTA', emoji: '💪', variant: 'reconsider' },
    { id: 'rewrite', label: 'Rewrite completely', emoji: '🔄', variant: 'reject' },
  ],
  script: [
    { id: 'approve', label: 'Send to Riley', emoji: '✅', variant: 'approve' },
    { id: 'tighten', label: 'Tighten it up', emoji: '✂️', variant: 'reconsider' },
    { id: 'change_hook', label: 'Change the hook', emoji: '🎣', variant: 'reconsider' },
    { id: 'rewrite', label: 'Start over', emoji: '🔄', variant: 'reject' },
  ],
  shot_list: [
    { id: 'approve', label: 'Start production', emoji: '✅', variant: 'approve' },
    { id: 'simplify', label: 'Simplify the shots', emoji: '🔄', variant: 'reconsider' },
    { id: 'pacing', label: 'Change the pacing', emoji: '⚡', variant: 'reconsider' },
    { id: 'regenerate', label: 'Regenerate completely', emoji: '🎬', variant: 'reject' },
  ],
  video: [
    { id: 'approve', label: 'Approve for posting', emoji: '✅', variant: 'approve' },
    { id: 'revise', label: 'Revise the edit', emoji: '✂️', variant: 'reconsider' },
    { id: 'regenerate', label: 'Regenerate completely', emoji: '🔄', variant: 'reject' },
  ],
  performance_review: [
    { id: 'acknowledge', label: 'Got it — brief the team', emoji: '✅', variant: 'approve' },
    { id: 'deep_dive', label: 'Deep dive on this', emoji: '🔍', variant: 'reconsider' },
    { id: 'dismiss', label: 'Not useful', emoji: '⏭', variant: 'reject' },
  ],
  weekly_pulse: [
    { id: 'acknowledge', label: 'Got it', emoji: '✅', variant: 'approve' },
    { id: 'full_review', label: 'Run full analysis', emoji: '🔍', variant: 'reconsider' },
    { id: 'dismiss', label: 'Skip', emoji: '⏭', variant: 'reject' },
  ],
  upload_review: [
    { id: 'approve', label: 'Ready — send to Jordan', emoji: '✅', variant: 'approve' },
    { id: 'post_anyway', label: 'Post anyway', emoji: '⚡', variant: 'approve' },
    { id: 'accept_notes', label: 'Accept notes — I\'ll re-upload', emoji: '🔄', variant: 'reconsider' },
    { id: 'reject', label: 'Scrap it', emoji: '🗑', variant: 'reject' },
  ],
  content_audit: [
    { id: 'acknowledge', label: 'Got it — update the plan', emoji: '✅', variant: 'approve' },
    { id: 'deep_dive', label: 'Dig deeper on this', emoji: '🔍', variant: 'reconsider' },
    { id: 'dismiss', label: 'Not useful', emoji: '⏭', variant: 'reject' },
  ],
  growth_strategy: [
    { id: 'approve', label: 'Let\'s execute this', emoji: '✅', variant: 'approve' },
    { id: 'adjust', label: 'Adjust priorities', emoji: '🔄', variant: 'reconsider', feedbackPrompt: 'What should we focus on instead?' },
    { id: 'dismiss', label: 'Not now', emoji: '⏭', variant: 'reject' },
  ],
  feed_audit: [
    { id: 'acknowledge', label: 'Noted — keep watching', emoji: '✅', variant: 'approve' },
    { id: 'deep_dive', label: 'What should I change?', emoji: '🔍', variant: 'reconsider' },
    { id: 'dismiss', label: 'Skip', emoji: '⏭', variant: 'reject' },
  ],
  format_analysis: [
    { id: 'acknowledge', label: 'Got it — adjust the mix', emoji: '✅', variant: 'approve' },
    { id: 'deep_dive', label: 'Show me examples', emoji: '🔍', variant: 'reconsider' },
    { id: 'dismiss', label: 'Skip', emoji: '⏭', variant: 'reject' },
  ],
}

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────

export type NotificationType =
  | 'output_delivered'
  | 'task_approved'
  | 'meeting_summary'
  | 'trend_report_ready'
  | 'plan_ready'
  | 'video_ready'
  | 'trial_ending'
  | 'payment_failed'
  | 'team_update'
  | 'connected'

export interface Notification {
  id: string
  userId: string
  companyId?: string
  type: NotificationType
  title: string
  body: string
  emoji: string
  actionUrl?: string
  actionLabel?: string
  isRead: boolean
  createdAt: Date | string
  metadata?: Record<string, unknown>
}
