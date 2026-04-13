/**
 * Notification Service
 *
 * Two layers:
 * 1. Persistent notifications — stored in DB, shown in notification center
 * 2. Real-time push — Server-Sent Events (SSE) for instant updates
 *
 * Why SSE over WebSockets:
 * - SSE is one-directional (server → client) which is all we need
 * - Works through AWS API Gateway without extra config
 * - No extra library needed — native browser EventSource API
 * - Much simpler to implement and maintain
 *
 * No third-party push service needed. This is all custom.
 */

import { PrismaClient } from '@prisma/client'
import { Response } from 'express'

const prisma = new PrismaClient()

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type NotificationType =
  | 'output_delivered'      // employee delivered work
  | 'task_approved'         // user approved an output
  | 'meeting_summary'       // meeting ended, summary ready
  | 'trend_report_ready'    // Maya's Monday report is in
  | 'plan_ready'            // Jordan's weekly plan delivered
  | 'video_ready'           // Creatomate render completed
  | 'trial_ending'          // trial ends in 3 days
  | 'payment_failed'        // Stripe payment failed
  | 'team_update'           // system message from the team

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
  createdAt: Date
  metadata?: Record<string, unknown>
}

// ─── SSE CONNECTION REGISTRY ──────────────────────────────────────────────────

/**
 * Active SSE connections — maps userId to response object.
 * In a multi-instance setup, replace this with Redis pub/sub.
 */
const sseClients = new Map<string, Response>()

/**
 * Register an SSE connection for a user.
 * Called when the frontend opens /api/notifications/stream
 */
export function registerSSEClient(userId: string, res: Response): void {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // disable nginx buffering

  // Send initial connection confirmation
  res.write(`data: ${JSON.stringify({ type: 'connected', userId })}\n\n`)

  // Keep connection alive with periodic heartbeat
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n')
  }, 30000)

  // Clean up on disconnect
  res.on('close', () => {
    clearInterval(heartbeat)
    sseClients.delete(userId)
    console.log(`SSE client disconnected: ${userId}`)
  })

  sseClients.set(userId, res)
  console.log(`SSE client connected: ${userId} (total: ${sseClients.size})`)
}

/**
 * Push a real-time event to a specific user if they're connected.
 */
function pushSSEEvent(userId: string, notification: Notification): void {
  const client = sseClients.get(userId)
  if (client && !client.writableEnded) {
    client.write(`data: ${JSON.stringify(notification)}\n\n`)
  }
}

// ─── CREATE NOTIFICATION ──────────────────────────────────────────────────────

/**
 * Create a notification, store it in DB, and push via SSE if user is online.
 */
export async function createNotification(params: {
  userId: string
  companyId?: string
  type: NotificationType
  title: string
  body: string
  emoji: string
  actionUrl?: string
  actionLabel?: string
  metadata?: Record<string, unknown>
}): Promise<Notification> {
  // Store in DB
  const notification = await prisma.notification.create({
    data: {
      userId: params.userId,
      companyId: params.companyId,
      type: params.type,
      title: params.title,
      body: params.body,
      emoji: params.emoji,
      actionUrl: params.actionUrl,
      actionLabel: params.actionLabel,
      isRead: false,
      metadata: params.metadata as never ?? {},
    },
  })

  const result: Notification = {
    id: notification.id,
    userId: notification.userId,
    companyId: notification.companyId ?? undefined,
    type: notification.type as NotificationType,
    title: notification.title,
    body: notification.body,
    emoji: notification.emoji,
    actionUrl: notification.actionUrl ?? undefined,
    actionLabel: notification.actionLabel ?? undefined,
    isRead: notification.isRead,
    createdAt: notification.createdAt,
    metadata: notification.metadata as Record<string, unknown>,
  }

  // Push real-time if user is online
  pushSSEEvent(params.userId, result)

  return result
}

// ─── NOTIFICATION FACTORIES ───────────────────────────────────────────────────
// One function per notification type — easy to find and modify.

export async function notifyOutputDelivered(params: {
  userId: string
  companyId: string
  employeeName: string
  employeeEmoji: string
  outputType: string
  taskId: string
}): Promise<void> {
  await createNotification({
    userId: params.userId,
    companyId: params.companyId,
    type: 'output_delivered',
    emoji: params.employeeEmoji,
    title: `${params.employeeName} delivered`,
    body: `New ${params.outputType} is ready for your review.`,
    actionUrl: `/dashboard/tasks/${params.taskId}`,
    actionLabel: 'Review',
    metadata: { taskId: params.taskId, employeeName: params.employeeName },
  })
}

export async function notifyTrendReportReady(params: {
  userId: string
  companyId: string
  topTrend: string
}): Promise<void> {
  await createNotification({
    userId: params.userId,
    companyId: params.companyId,
    type: 'trend_report_ready',
    emoji: '📊',
    title: 'Maya\'s Monday report is ready',
    body: `Top trend this week: "${params.topTrend}"`,
    actionUrl: '/dashboard/trends',
    actionLabel: 'Read report',
  })
}

export async function notifyPlanReady(params: {
  userId: string
  companyId: string
  weekOf: string
}): Promise<void> {
  await createNotification({
    userId: params.userId,
    companyId: params.companyId,
    type: 'plan_ready',
    emoji: '🗺️',
    title: 'Jordan built your content plan',
    body: `Week of ${params.weekOf} is planned and ready for approval.`,
    actionUrl: '/dashboard/strategy',
    actionLabel: 'Review plan',
  })
}

export async function notifyVideoReady(params: {
  userId: string
  companyId: string
  taskId: string
}): Promise<void> {
  await createNotification({
    userId: params.userId,
    companyId: params.companyId,
    type: 'video_ready',
    emoji: '🎬',
    title: 'Your Reel is rendered',
    body: 'Riley\'s production is done. Preview and approve before posting.',
    actionUrl: `/dashboard/tasks/${params.taskId}`,
    actionLabel: 'Preview Reel',
  })
}

export async function notifyMeetingSummary(params: {
  userId: string
  companyId: string
  employeeName: string
  meetingId: string
  tasksCreated: number
}): Promise<void> {
  await createNotification({
    userId: params.userId,
    companyId: params.companyId,
    type: 'meeting_summary',
    emoji: '📋',
    title: `Meeting with ${params.employeeName} — summary ready`,
    body: params.tasksCreated > 0
      ? `${params.tasksCreated} task${params.tasksCreated > 1 ? 's' : ''} created from your meeting.`
      : 'Your meeting summary and decisions are ready.',
    actionUrl: `/dashboard/tasks`,
    actionLabel: 'View tasks',
    metadata: { meetingId: params.meetingId },
  })
}

export async function notifyTrialEnding(params: {
  userId: string
  daysLeft: number
}): Promise<void> {
  await createNotification({
    userId: params.userId,
    type: 'trial_ending',
    emoji: '⏳',
    title: `${params.daysLeft} day${params.daysLeft > 1 ? 's' : ''} left in your trial`,
    body: 'Subscribe to keep your team running and your memory intact.',
    actionUrl: '/pricing',
    actionLabel: 'Subscribe',
  })
}

export async function notifyPaymentFailed(params: {
  userId: string
}): Promise<void> {
  await createNotification({
    userId: params.userId,
    type: 'payment_failed',
    emoji: '⚠️',
    title: 'Payment failed',
    body: 'Update your payment method to keep your team active.',
    actionUrl: '/settings/billing',
    actionLabel: 'Fix payment',
  })
}

// ─── READ / LIST / MARK READ ──────────────────────────────────────────────────

export async function getNotifications(
  userId: string,
  limit = 20
): Promise<Notification[]> {
  const notifications = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  return notifications.map(n => ({
    id: n.id,
    userId: n.userId,
    companyId: n.companyId ?? undefined,
    type: n.type as NotificationType,
    title: n.title,
    body: n.body,
    emoji: n.emoji,
    actionUrl: n.actionUrl ?? undefined,
    actionLabel: n.actionLabel ?? undefined,
    isRead: n.isRead,
    createdAt: n.createdAt,
    metadata: n.metadata as Record<string, unknown>,
  }))
}

export async function getUnreadCount(userId: string): Promise<number> {
  return prisma.notification.count({
    where: { userId, isRead: false },
  })
}

export async function markAsRead(notificationId: string, userId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { isRead: true },
  })
}

export async function markAllAsRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  })
}
