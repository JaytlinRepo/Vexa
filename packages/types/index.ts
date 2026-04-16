// ─── ENUMS ───────────────────────────────────────────────────────────────────

export type SubscriptionStatus = 'trial' | 'active' | 'canceled' | 'past_due'
export type Plan = 'starter' | 'pro' | 'agency'
export type Platform = 'instagram'
export type EmployeeRole = 'analyst' | 'strategist' | 'copywriter' | 'creative_director'
export type TaskStatus = 'pending' | 'in_progress' | 'delivered' | 'approved' | 'rejected' | 'revision'
export type OutputType = 'trend_report' | 'content_plan' | 'hooks' | 'caption' | 'script' | 'shot_list' | 'video' | 'performance_review'
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

export interface OutputContent {
  trend_report: TrendReport
  content_plan: ContentPlan
  hooks: HooksOutput
  caption: { caption: string; hashtags: string[]; ctaNote: string }
  script: ScriptOutput
  shot_list: ShotListOutput
  video: { url: string; s3Key: string; duration: string; thumbnailUrl: string }
  performance_review: PerformanceReview
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
