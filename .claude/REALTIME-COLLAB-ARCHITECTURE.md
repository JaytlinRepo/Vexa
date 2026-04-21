# Real-Time Collaboration Architecture (Phase 1)

## Overview

Current flow is **sequential + polling** (User 1 approves visual → server updates → User 2 refreshes). 

New flow should be **real-time + push** (User 1 approves visual → server broadcasts to User 2's browser instantly).

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     FRONTEND (Browser)                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────┐    ┌──────────────────────┐      │
│  │   User 1 (Sarah)    │    │   User 2 (Marcus)    │      │
│  │  - Reviewing visual │    │  - Reviewing captions│      │
│  │  - Sees live        │    │  - Sees live updates │      │
│  │    updates from U2  │    │    from U1           │      │
│  └────────┬────────────┘    └──────────┬───────────┘      │
│           │ ws://api.vexa/studio/sync  │                   │
│           └────────────┬────────────────┘                   │
│                        │                                    │
│              ┌─────────▼─────────┐                         │
│              │  Zustand Store    │                         │
│              │ (Real-time state) │                         │
│              └────────┬──────────┘                         │
│                       │                                    │
└───────────────────────┼────────────────────────────────────┘
                        │
         ┌──────────────▼──────────────┐
         │    WebSocket Connection     │
         │ (ws:// protocol, keep-alive)│
         └──────────────┬──────────────┘
                        │
┌───────────────────────┼────────────────────────────────────┐
│                       │    BACKEND (Node.js)               │
├───────────────────────┼────────────────────────────────────┤
│                       │                                    │
│          ┌────────────▼──────────────┐                    │
│          │   WebSocket Server        │                    │
│          │ (ws library or Socket.io) │                    │
│          │ Maintains client registry │                    │
│          │ Broadcasts events         │                    │
│          └────────────┬───────────────┘                   │
│                       │                                   │
│         ┌─────────────▼────────────┐                     │
│         │  Studio Approval Handler │                     │
│         │ (Real-time approval logic)│                     │
│         └─────────────┬────────────┘                     │
│                       │                                  │
│       ┌───────────────▼──────────────┐                  │
│       │  Approval State Machine      │                  │
│       │ - Handles conflicts          │                  │
│       │ - Prevents invalid actions   │                  │
│       │ - Locks during regeneration  │                  │
│       └───────────────┬──────────────┘                  │
│                       │                                 │
│         ┌─────────────▼────────────┐                   │
│         │   PostgreSQL Database    │                   │
│         │ (Audit log + state)      │                   │
│         └──────────────────────────┘                   │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

## WebSocket Events

### Client → Server (User Actions)

```typescript
// User approves visual
{
  type: 'approve-visual',
  clipId: 'cuid123',
  userId: 'user123',
  timestamp: '2026-04-21T14:30:00Z',
  clientId: 'client-uuid-123' // For deduplication
}

// User rejects visual with feedback
{
  type: 'reject-visual',
  clipId: 'cuid123',
  userId: 'user123',
  feedback: 'Too warm, needs contrast',
  timestamp: '2026-04-21T14:30:05Z',
  clientId: 'client-uuid-123'
}

// User selects a caption
{
  type: 'approve-copy',
  clipId: 'cuid123',
  userId: 'user123',
  captionId: 'caption-2',
  timestamp: '2026-04-21T14:30:10Z',
  clientId: 'client-uuid-123'
}

// User joins clip editing session
{
  type: 'join-clip',
  clipId: 'cuid123',
  userId: 'user123',
  userName: 'Sarah Chen',
  userRole: 'admin' // or 'editor' or 'viewer'
}

// User leaves session
{
  type: 'leave-clip',
  clipId: 'cuid123',
  userId: 'user123'
}
```

### Server → Client (Broadcast Events)

```typescript
// Visual approval happened
{
  type: 'visual-approved',
  clipId: 'cuid123',
  approvedBy: 'sarah-chen',
  approvedAt: '2026-04-21T14:30:00Z',
  newStatus: 'approved',
  styleMetrics: { styleReplication: 0.92 },
  version: 2
}

// Visual rejection + regeneration queued
{
  type: 'visual-rejected',
  clipId: 'cuid123',
  rejectedBy: 'sarah-chen',
  feedback: 'Too warm, needs contrast',
  rejectedAt: '2026-04-21T14:30:05Z',
  newStatus: 'rejected',
  regenerationQueued: true
}

// Riley is revising
{
  type: 'visual-regenerating',
  clipId: 'cuid123',
  stage: 'regenerating',
  message: 'Riley is revising visual based on your feedback',
  estimatedTime: 30 // seconds
}

// New version ready
{
  type: 'visual-regenerated',
  clipId: 'cuid123',
  newVersion: 3,
  adjustments: { colorTemperature: 2800, contrast: 8 },
  styleMetrics: { styleReplication: 0.89 },
  readyForApproval: true
}

// Caption approved
{
  type: 'copy-approved',
  clipId: 'cuid123',
  approvedBy: 'marcus-thomas',
  selectedCaptionId: 'caption-2',
  selectedCaption: 'This completely changed how I think about it',
  newStatus: 'approved'
}

// Activity: someone joined
{
  type: 'user-joined',
  clipId: 'cuid123',
  userId: 'marcus-thomas',
  userName: 'Marcus Thomas',
  userRole: 'editor',
  activeUsers: [
    { userId: 'sarah-chen', userName: 'Sarah Chen', status: 'reviewing-visual' },
    { userId: 'marcus-thomas', userName: 'Marcus Thomas', status: 'reviewing-copy' }
  ]
}

// Activity: someone left
{
  type: 'user-left',
  clipId: 'cuid123',
  userId: 'sarah-chen',
  userName: 'Sarah Chen',
  activeUsers: [
    { userId: 'marcus-thomas', userName: 'Marcus Thomas', status: 'reviewing-copy' }
  ]
}

// Error: invalid action
{
  type: 'error',
  clipId: 'cuid123',
  error: 'cannot-approve-while-regenerating',
  message: 'Wait for Riley to finish revising before approving',
  retryAfter: 25 // seconds
}
```

---

## Backend Implementation

### WebSocket Server Setup

```typescript
// apps/api/src/services/websocket/studioSync.ts

import { WebSocketServer } from 'ws'
import { Server as ExpressServer } from 'express'
import { PrismaClient } from '@prisma/client'
import { v4 as uuidv4 } from 'uuid'

export class StudioSyncServer {
  private wss: WebSocketServer
  private clientRegistry: Map<string, ClientConnection> = new Map()
  private clipSessions: Map<string, ClipSession> = new Map()

  constructor(
    private expressServer: ExpressServer,
    private prisma: PrismaClient
  ) {
    // Initialize WebSocket server
    this.wss = new WebSocketServer({ server: expressServer })
    this.setupHandlers()
  }

  private setupHandlers() {
    this.wss.on('connection', (ws, req) => {
      // Extract userId and clipId from query params
      const url = new URL(req.url || '', 'ws://localhost')
      const userId = url.searchParams.get('userId')
      const clipId = url.searchParams.get('clipId')

      if (!userId || !clipId) {
        ws.close(1008, 'missing-params')
        return
      }

      // Register client
      const clientId = uuidv4()
      const connection: ClientConnection = {
        clientId,
        userId,
        clipId,
        ws,
        joinedAt: new Date(),
        lastHeartbeat: Date.now()
      }

      this.clientRegistry.set(clientId, connection)
      this.addToSession(clipId, connection)

      // Send welcome + current state
      this.sendCurrentState(ws, clipId)

      // Broadcast user joined
      this.broadcast(clipId, {
        type: 'user-joined',
        clipId,
        userId,
        activeUsers: this.getActiveUsers(clipId)
      })

      // Handle messages
      ws.on('message', (data) => this.handleMessage(data, clientId))

      // Handle disconnect
      ws.on('close', () => this.handleDisconnect(clientId))

      // Heartbeat every 30s
      ws.isAlive = true
      ws.on('pong', () => {
        ws.isAlive = true
      })
    })

    // Heartbeat interval
    setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate()
        ws.isAlive = false
        ws.ping()
      })
    }, 30000)
  }

  private async handleMessage(data: Buffer, clientId: string) {
    const connection = this.clientRegistry.get(clientId)
    if (!connection) return

    try {
      const message = JSON.parse(data.toString())
      console.log(`[studio-sync] ${connection.userId} → ${message.type}`)

      // Deduplicate (client sends clientId, prevent processing twice)
      if (message.clientId === connection.clientId && this.isRecent(message.timestamp)) {
        // Process message
        await this.processApprovalAction(connection, message)
      }
    } catch (err) {
      console.error('[studio-sync] parse error:', err)
      connection.ws.send(
        JSON.stringify({
          type: 'error',
          error: 'invalid-message',
          message: 'Failed to parse message'
        })
      )
    }
  }

  private async processApprovalAction(connection: ClientConnection, message: any) {
    const { type, clipId, feedback, captionId } = message

    // Fetch current clip state
    const clip = await this.prisma.videoClip.findUnique({ where: { id: clipId } })
    if (!clip) {
      connection.ws.send(
        JSON.stringify({ type: 'error', error: 'clip-not-found' })
      )
      return
    }

    // Validate action (state machine)
    const valid = this.validateAction(clip, type, connection.userId)
    if (!valid.allowed) {
      connection.ws.send(
        JSON.stringify({
          type: 'error',
          error: valid.reason,
          message: valid.message,
          retryAfter: valid.retryAfter
        })
      )
      return
    }

    // Process based on type
    if (type === 'approve-visual') {
      await this.handleApproveVisual(connection, clip)
    } else if (type === 'reject-visual') {
      await this.handleRejectVisual(connection, clip, feedback)
    } else if (type === 'approve-copy') {
      await this.handleApproveCopy(connection, clip, captionId)
    }
  }

  private async handleApproveVisual(connection: ClientConnection, clip: any) {
    // Update database
    await this.prisma.videoClip.update({
      where: { id: clip.id },
      data: { visualApprovalStatus: 'approved' }
    })

    // Store in audit log
    await this.prisma.approvalAuditLog.create({
      data: {
        clipId: clip.id,
        userId: connection.userId,
        action: 'visual-approved',
        timestamp: new Date()
      }
    })

    // Broadcast to all users in session
    this.broadcast(clip.id, {
      type: 'visual-approved',
      clipId: clip.id,
      approvedBy: connection.userId,
      approvedAt: new Date().toISOString(),
      newStatus: 'approved'
    })
  }

  private async handleRejectVisual(connection: ClientConnection, clip: any, feedback: string) {
    // Validate feedback
    if (!feedback || feedback.trim().length < 5) {
      connection.ws.send(
        JSON.stringify({
          type: 'error',
          error: 'invalid-feedback',
          message: 'Feedback must be at least 5 characters'
        })
      )
      return
    }

    // Store rejection
    const feedbackHistory = (clip.editorialFeedback as any[]) || []
    feedbackHistory.push({
      type: 'visual',
      reason: feedback,
      rejectedBy: connection.userId,
      timestamp: new Date().toISOString()
    })

    await this.prisma.videoClip.update({
      where: { id: clip.id },
      data: {
        visualApprovalStatus: 'rejected',
        editorialFeedback: feedbackHistory
      }
    })

    // Queue regeneration
    await this.queueRegeneration(clip.id, 'visual', feedback)

    // Broadcast
    this.broadcast(clip.id, {
      type: 'visual-rejected',
      clipId: clip.id,
      rejectedBy: connection.userId,
      feedback: feedback,
      newStatus: 'rejected',
      regenerationQueued: true
    })

    // Immediately show "regenerating" state
    this.broadcast(clip.id, {
      type: 'visual-regenerating',
      clipId: clip.id,
      stage: 'regenerating',
      message: 'Riley is revising visual based on your feedback',
      estimatedTime: 30
    })
  }

  private async queueRegeneration(clipId: string, type: 'visual' | 'copy', feedback: string) {
    // Add to job queue (BullMQ or similar)
    // This triggers the regeneration service asynchronously
    
    const job = await this.regenerationQueue.add(
      'regenerate-' + type,
      { clipId, feedback },
      { delay: 1000, attempts: 3 } // Start in 1s, retry 3x
    )

    console.log(`[regeneration] Queued ${type} job for ${clipId}`)
  }

  private validateAction(clip: any, action: string, userId: string): ValidationResult {
    // Cannot approve while regenerating
    if (clip.visualApprovalStatus === 'regenerating' && action.includes('visual')) {
      return {
        allowed: false,
        reason: 'cannot-approve-while-regenerating',
        message: 'Wait for Riley to finish revising before approving',
        retryAfter: 25
      }
    }

    // Cannot approve copy if visual not approved
    if (action === 'approve-copy' && clip.visualApprovalStatus !== 'approved') {
      return {
        allowed: false,
        reason: 'visual-not-approved-yet',
        message: 'Approve visual first',
        retryAfter: null
      }
    }

    return { allowed: true }
  }

  private broadcast(clipId: string, message: any) {
    const session = this.clipSessions.get(clipId)
    if (!session) return

    const payload = JSON.stringify(message)
    session.clients.forEach((conn) => {
      if (conn.ws.readyState === ws.OPEN) {
        conn.ws.send(payload)
      }
    })
  }

  private sendCurrentState(ws: any, clipId: string) {
    // Fetch clip from DB
    // Send current state to new user
    // Prevents "flash of outdated state"
  }

  private getActiveUsers(clipId: string) {
    const session = this.clipSessions.get(clipId)
    if (!session) return []

    return session.clients.map((conn) => ({
      userId: conn.userId,
      userName: conn.userName, // Fetch from DB
      status: 'reviewing' // Could be more specific
    }))
  }

  private handleDisconnect(clientId: string) {
    const connection = this.clientRegistry.get(clientId)
    if (!connection) return

    // Remove from registry
    this.clientRegistry.delete(clientId)

    // Remove from session
    const session = this.clipSessions.get(connection.clipId)
    if (session) {
      session.clients = session.clients.filter((c) => c.clientId !== clientId)

      // Broadcast user left
      if (session.clients.length > 0) {
        this.broadcast(connection.clipId, {
          type: 'user-left',
          userId: connection.userId,
          activeUsers: this.getActiveUsers(connection.clipId)
        })
      } else {
        // Clean up empty session
        this.clipSessions.delete(connection.clipId)
      }
    }
  }

  private addToSession(clipId: string, connection: ClientConnection) {
    if (!this.clipSessions.has(clipId)) {
      this.clipSessions.set(clipId, {
        clipId,
        clients: [],
        createdAt: new Date()
      })
    }

    this.clipSessions.get(clipId)!.clients.push(connection)
  }

  private isRecent(timestamp: string, maxAgeSec = 30): boolean {
    const msgTime = new Date(timestamp).getTime()
    const now = Date.now()
    return (now - msgTime) < (maxAgeSec * 1000)
  }
}

// Data structures
interface ClientConnection {
  clientId: string
  userId: string
  clipId: string
  ws: any
  joinedAt: Date
  lastHeartbeat: number
  userName?: string
  role?: 'admin' | 'editor' | 'viewer'
}

interface ClipSession {
  clipId: string
  clients: ClientConnection[]
  createdAt: Date
}

interface ValidationResult {
  allowed: boolean
  reason?: string
  message?: string
  retryAfter?: number | null
}
```

---

## Frontend Implementation

### Zustand Store for Real-Time State

```typescript
// apps/web/src/store/studioSync.ts

import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

interface ClipApprovalState {
  clipId: string
  visualApprovalStatus: 'pending' | 'approved' | 'rejected' | 'regenerating'
  copyApprovalStatus: 'pending' | 'approved' | 'rejected'
  activeUsers: Array<{ userId: string; userName: string; status: string }>
  version: number
  editingHistory: Array<{ action: string; by: string; at: string }>
  
  // Actions
  approveVisual: () => void
  rejectVisual: (feedback: string) => void
  approveCopy: (captionId: string) => void
  rejectCopy: (feedback: string) => void
  
  // Real-time updates (from server)
  setVisualApproved: () => void
  setVisualRejected: (feedback: string) => void
  setVisualRegenerating: () => void
  setVisualRegenerated: (newVersion: any) => void
  setActiveUsers: (users: any[]) => void
  
  // Connection state
  isConnected: boolean
  error: string | null
}

export const useStudioSync = create<ClipApprovalState>()(
  devtools(
    (set, get) => ({
      clipId: '',
      visualApprovalStatus: 'pending',
      copyApprovalStatus: 'pending',
      activeUsers: [],
      version: 1,
      editingHistory: [],
      isConnected: false,
      error: null,

      approveVisual: () => {
        // Send via WebSocket
        const { ws } = useWebSocketStore.getState()
        if (!ws) return

        ws.send(JSON.stringify({
          type: 'approve-visual',
          clipId: get().clipId,
          clientId: uuidv4(),
          timestamp: new Date().toISOString()
        }))

        // Optimistic update
        set({ visualApprovalStatus: 'approved' })
      },

      rejectVisual: (feedback: string) => {
        const { ws } = useWebSocketStore.getState()
        if (!ws) return

        ws.send(JSON.stringify({
          type: 'reject-visual',
          clipId: get().clipId,
          feedback,
          clientId: uuidv4(),
          timestamp: new Date().toISOString()
        }))

        set({ visualApprovalStatus: 'rejected' })
      },

      setVisualApproved: () => {
        set((state) => ({
          visualApprovalStatus: 'approved',
          editingHistory: [
            ...state.editingHistory,
            { action: 'visual-approved', by: 'current-user', at: new Date().toISOString() }
          ]
        }))
      },

      setVisualRegenerating: () => {
        set({ visualApprovalStatus: 'regenerating' })
      },

      setVisualRegenerated: (newVersion: any) => {
        set((state) => ({
          visualApprovalStatus: 'pending', // Back to pending for approval
          version: newVersion.version,
          editingHistory: [
            ...state.editingHistory,
            { action: 'visual-regenerated', by: 'riley', at: new Date().toISOString() }
          ]
        }))
      },

      setActiveUsers: (users: any[]) => {
        set({ activeUsers: users })
      }
    }),
    { name: 'studio-sync' }
  )
)
```

### WebSocket Connection Hook

```typescript
// apps/web/src/hooks/useStudioWebSocket.ts

import { useEffect, useRef } from 'react'
import { useStudioSync } from '../store/studioSync'

export function useStudioWebSocket(clipId: string, userId: string) {
  const wsRef = useRef<WebSocket | null>(null)
  const store = useStudioSync()

  useEffect(() => {
    // Build WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const url = `${protocol}//${host}/api/studio/sync?clipId=${clipId}&userId=${userId}`

    // Connect
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      console.log('[studio-sync] Connected')
      store.setConnected(true)
    }

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      handleMessage(message, store)
    }

    ws.onerror = (error) => {
      console.error('[studio-sync] Error:', error)
      store.setError('Connection error')
    }

    ws.onclose = () => {
      console.log('[studio-sync] Disconnected')
      store.setConnected(false)
      // Auto-reconnect after 3 seconds
      setTimeout(() => {
        // Reconnect logic
      }, 3000)
    }

    return () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.close()
      }
    }
  }, [clipId, userId])

  return wsRef.current
}

function handleMessage(message: any, store: any) {
  switch (message.type) {
    case 'visual-approved':
      store.setVisualApproved()
      toast.success('Visual approved')
      break

    case 'visual-rejected':
      store.setVisualRejected(message.feedback)
      toast.info(`Visual rejected: ${message.feedback}`)
      break

    case 'visual-regenerating':
      store.setVisualRegenerating()
      toast.info('Riley is revising...')
      break

    case 'visual-regenerated':
      store.setVisualRegenerated(message)
      toast.success('New version ready')
      break

    case 'user-joined':
      store.setActiveUsers(message.activeUsers)
      toast.info(`${message.userName} joined`)
      break

    case 'user-left':
      store.setActiveUsers(message.activeUsers)
      break

    case 'error':
      toast.error(message.message)
      break
  }
}
```

### UI Component

```typescript
// apps/web/src/components/StudioBatchPreview.tsx

export function StudioBatchPreview({ clipId }: { clipId: string }) {
  const { userId } = useAuth()
  const ws = useStudioWebSocket(clipId, userId)
  const {
    visualApprovalStatus,
    copyApprovalStatus,
    activeUsers,
    approveVisual,
    rejectVisual
  } = useStudioSync()

  return (
    <div className="batch-preview">
      {/* Active Users Badge */}
      <div className="active-users">
        {activeUsers.map((user) => (
          <div key={user.userId} className="user-badge">
            <span className="avatar">{user.userName[0]}</span>
            <span className="name">{user.userName}</span>
            <span className="status">{user.status}</span>
          </div>
        ))}
      </div>

      {/* Visual Approval Section */}
      <div className="visual-section">
        <h3>Visual Edit</h3>

        {/* Show status */}
        {visualApprovalStatus === 'regenerating' && (
          <div className="status-banner">
            🔄 Riley is revising your feedback...
          </div>
        )}

        {/* Preview + buttons */}
        <div className="preview">
          <video src={clipUrl} />
        </div>

        <div className="actions">
          <button
            onClick={approveVisual}
            disabled={visualApprovalStatus === 'regenerating'}
          >
            ✓ Approve
          </button>
          <button
            onClick={() => setShowFeedback(true)}
            disabled={visualApprovalStatus === 'regenerating'}
          >
            ✗ Reject
          </button>
        </div>

        {/* Feedback form */}
        {showFeedback && (
          <FeedbackForm
            onSubmit={(feedback) => rejectVisual(feedback)}
            onCancel={() => setShowFeedback(false)}
          />
        )}
      </div>

      {/* Copy Approval Section */}
      <div className="copy-section">
        <h3>Alex's Captions</h3>
        {/* Caption options... */}
      </div>
    </div>
  )
}
```

---

## Database Schema Updates

### New Tables

```sql
-- Audit log for all approvals
CREATE TABLE approval_audit_log (
  id CUID PRIMARY KEY,
  clip_id CUID NOT NULL REFERENCES video_clips(id),
  user_id UUID NOT NULL,
  action VARCHAR NOT NULL, -- 'visual-approved', 'visual-rejected', etc.
  feedback TEXT,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  
  INDEX (clip_id, timestamp),
  INDEX (user_id, timestamp)
);

-- Track who can edit what clip
CREATE TABLE clip_collaborators (
  id CUID PRIMARY KEY,
  clip_id CUID NOT NULL REFERENCES video_clips(id),
  user_id UUID NOT NULL,
  role VARCHAR NOT NULL, -- 'admin', 'editor', 'viewer'
  added_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(clip_id, user_id)
);

-- WebSocket connection tracking (cache table, can expire)
CREATE TABLE ws_connections (
  id CUID PRIMARY KEY,
  user_id UUID NOT NULL,
  clip_id CUID NOT NULL,
  client_id UUID NOT NULL,
  connected_at TIMESTAMP DEFAULT NOW(),
  last_heartbeat TIMESTAMP,
  
  INDEX (clip_id),
  INDEX (connected_at) -- For cleanup of stale connections
);
```

### Prisma Schema

```prisma
model ApprovalAuditLog {
  id        String   @id @default(cuid())
  clipId    String   @map("clip_id")
  clip      VideoClip @relation(fields: [clipId], references: [id], onDelete: Cascade)
  
  userId    String
  action    String   // 'visual-approved', 'visual-rejected', 'copy-approved'
  feedback  String?
  timestamp DateTime @default(now())

  @@index([clipId, timestamp])
  @@index([userId, timestamp])
  @@map("approval_audit_logs")
}

model ClipCollaborator {
  id      String   @id @default(cuid())
  clipId  String   @map("clip_id")
  clip    VideoClip @relation(fields: [clipId], references: [id], onDelete: Cascade)
  
  userId  String
  role    String   @default("editor") // 'admin', 'editor', 'viewer'
  addedAt DateTime @default(now()) @map("added_at")

  @@unique([clipId, userId])
  @@map("clip_collaborators")
}
```

---

## Error Handling & Edge Cases

### Conflict Resolution

```typescript
// Scenario: Both users reject simultaneously
// Server receives both messages ~same time

// Solution: Accept first, queue second
if (clip.visualApprovalStatus === 'approved') {
  // Already approved, send error to second user
  ws.send({
    type: 'error',
    error: 'state-changed',
    message: 'Visual already approved, cannot reject'
  })
}

// Then broadcast current state to all
broadcast(clipId, getCurrentState())
```

### Regeneration Blocking

```typescript
// Cannot approve while regenerating
if (clip.visualApprovalStatus === 'regenerating') {
  return {
    allowed: false,
    reason: 'cannot-approve-while-regenerating',
    retryAfter: 25
  }
}

// Frontend shows "Please wait 25s" button disabled
```

### Disconnection & Reconnection

```typescript
// Client disconnects without closing WebSocket gracefully
// Server detects via heartbeat timeout (30s)

// When client reconnects:
// 1. Fetch latest clip state from DB
// 2. Send full state snapshot
// 3. Sync with Zustand store

// No data loss—audit log has all actions
```

---

## Performance Considerations

### Message Optimization

```typescript
// ❌ Bad: Send entire clip object
{ type: 'visual-approved', clip: { ...entireClipObject } }

// ✅ Good: Send only changed fields
{ 
  type: 'visual-approved',
  clipId,
  visualApprovalStatus: 'approved',
  approvedAt,
  approvedBy
}
```

### Connection Limits

- One WebSocket per user per clip (prevent duplicate connections)
- Kill old connection if user rejoins
- Graceful degradation if WebSocket unavailable (fallback to polling)

### Broadcast Optimization

```typescript
// Only broadcast to users in this clip's session
broadcast(clipId, message) // Not to entire app
```

---

## Testing Strategy

### Unit Tests

```typescript
// Test validation rules
test('cannot approve while regenerating', () => {
  const clip = { visualApprovalStatus: 'regenerating' }
  const result = validateAction(clip, 'approve-visual')
  expect(result.allowed).toBe(false)
})

// Test conflict resolution
test('second rejection queued if already approved', () => {
  const clip = { visualApprovalStatus: 'approved' }
  handleRejectVisual(clip, 'feedback')
  expect(ws.send).toHaveBeenCalledWith(error)
})
```

### Integration Tests

```typescript
// Test full flow
test('user A rejects, user B sees regenerating state', async () => {
  const wsA = connectUser('sarah', 'clip-123')
  const wsB = connectUser('marcus', 'clip-123')

  // Sarah rejects
  wsA.send({ type: 'reject-visual', feedback: 'too warm' })

  // Marcus receives regenerating event
  await waitFor(() => {
    expect(wsB.received).toContainEqual({
      type: 'visual-rejected',
      clipId: 'clip-123'
    })
  })

  expect(wsB.received).toContainEqual({
    type: 'visual-regenerating',
    message: 'Riley is revising...'
  })
})
```

---

## Deployment Checklist

- [ ] WebSocket infrastructure (ws library + scaling considerations)
- [ ] Audit log table + indexes
- [ ] Collaborator permissions table
- [ ] Connection tracking table (with cleanup job)
- [ ] Error handling for all edge cases
- [ ] Browser reconnection logic
- [ ] Heartbeat monitoring
- [ ] Load testing (simulate 100+ concurrent users per clip)
- [ ] Monitor WebSocket connections in production
- [ ] Graceful shutdown (close all connections)

---

## Next Steps

**Week 1:** Implement WebSocket server + client connection
**Week 2:** Real-time approval actions + broadcast
**Week 3:** Conflict handling + edge cases
**Week 4:** Testing + polish + deploy

Estimated effort: **4-6 weeks**

