'use client'

import { useState, useEffect, useRef } from 'react'
import type { Notification } from '@vexa/types'

// ─── NOTIFICATION BELL ────────────────────────────────────────────────────────

export default function NotificationBell({ userId }: { userId: string }) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  // ── LOAD INITIAL NOTIFICATIONS ────────────────────────────────────────────

  useEffect(() => {
    loadNotifications()
    connectSSE()

    return () => {
      eventSourceRef.current?.close()
    }
  }, [userId])

  // ── CLOSE ON OUTSIDE CLICK ────────────────────────────────────────────────

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // ── METHODS ───────────────────────────────────────────────────────────────

  async function loadNotifications() {
    try {
      const res = await fetch('/api/notifications?limit=15')
      const data = await res.json()
      setNotifications(data.notifications || [])
      setUnreadCount(data.unreadCount || 0)
    } catch {
      console.warn('Failed to load notifications')
    } finally {
      setIsLoading(false)
    }
  }

  function connectSSE() {
    if (typeof window === 'undefined') return

    const es = new EventSource('/api/notifications/stream')

    es.onmessage = (event) => {
      try {
        const notification = JSON.parse(event.data) as Notification
        if (notification.type === 'connected') return

        // Prepend new notification
        setNotifications(prev => [notification, ...prev].slice(0, 20))
        setUnreadCount(prev => prev + 1)

        // Browser notification if tab is not focused
        if (document.hidden && 'Notification' in window && window.Notification.permission === 'granted') {
          new window.Notification(`${notification.emoji} ${notification.title}`, {
            body: notification.body,
            icon: '/favicon.ico',
          })
        }
      } catch {
        // ignore parse errors
      }
    }

    es.onerror = () => {
      es.close()
      // Reconnect after 5 seconds
      setTimeout(connectSSE, 5000)
    }

    eventSourceRef.current = es
  }

  async function handleMarkAllRead() {
    await fetch('/api/notifications/read-all', { method: 'POST' })
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })))
    setUnreadCount(0)
  }

  async function handleNotificationClick(notification: Notification) {
    // Mark as read
    if (!notification.isRead) {
      await fetch(`/api/notifications/${notification.id}/read`, { method: 'POST' })
      setNotifications(prev => prev.map(n =>
        n.id === notification.id ? { ...n, isRead: true } : n
      ))
      setUnreadCount(prev => Math.max(0, prev - 1))
    }

    // Navigate to action URL
    if (notification.actionUrl) {
      window.location.href = notification.actionUrl
    }

    setIsOpen(false)
  }

  // ── RENDER ────────────────────────────────────────────────────────────────

  return (
    <div style={{ position: 'relative' }} ref={dropdownRef}>

      {/* Bell Button */}
      <button
        onClick={() => setIsOpen(o => !o)}
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          border: '1px solid var(--border-2)',
          background: isOpen ? 'var(--bg-3)' : 'var(--card)',
          color: 'var(--text-2)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 16,
          position: 'relative',
          transition: 'all .2s',
        }}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        🔔
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute',
            top: -4,
            right: -4,
            minWidth: 18,
            height: 18,
            borderRadius: 100,
            background: 'var(--text)',
            color: 'var(--text-inv)',
            fontSize: 10,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 4px',
            fontFamily: "'Syne', sans-serif",
            border: '2px solid var(--bg)',
          }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          right: 0,
          width: 360,
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          boxShadow: '0 20px 60px var(--shadow)',
          zIndex: 300,
          overflow: 'hidden',
        }}>

          {/* Header */}
          <div style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "'Syne', sans-serif" }}>
              Notifications
            </span>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-2)',
                  fontSize: 12,
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Notification List */}
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            {isLoading ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-3)', fontSize: 14 }}>
                Loading...
              </div>
            ) : notifications.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center' }}>
                <p style={{ fontSize: 24, marginBottom: 8 }}>🔔</p>
                <p style={{ fontSize: 14, color: 'var(--text-3)' }}>No notifications yet.</p>
                <p style={{ fontSize: 13, color: 'var(--text-3)' }}>Your team will check in here.</p>
              </div>
            ) : (
              notifications.map(n => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  onClick={() => handleNotificationClick(n)}
                />
              ))
            )}
          </div>

        </div>
      )}
    </div>
  )
}

// ─── NOTIFICATION ITEM ────────────────────────────────────────────────────────

function NotificationItem({
  notification: n,
  onClick,
}: {
  notification: Notification
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        padding: '14px 20px',
        background: n.isRead ? 'transparent' : 'var(--bg-3)',
        border: 'none',
        borderBottom: '1px solid var(--border)',
        cursor: 'pointer',
        textAlign: 'left',
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        transition: 'background .15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-2)')}
      onMouseLeave={e => (e.currentTarget.style.background = n.isRead ? 'transparent' : 'var(--bg-3)')}
    >
      {/* Emoji */}
      <span style={{
        width: 36,
        height: 36,
        borderRadius: 10,
        background: 'var(--bg-3)',
        border: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 16,
        flexShrink: 0,
      }}>
        {n.emoji}
      </span>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          margin: '0 0 3px',
          fontSize: 13,
          fontWeight: n.isRead ? 400 : 600,
          color: 'var(--text)',
          lineHeight: 1.4,
        }}>
          {n.title}
        </p>
        <p style={{
          margin: '0 0 6px',
          fontSize: 12,
          color: 'var(--text-2)',
          lineHeight: 1.5,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {n.body}
        </p>
        <p style={{ margin: 0, fontSize: 11, color: 'var(--text-3)' }}>
          {getRelativeTime(new Date(n.createdAt))}
        </p>
      </div>

      {/* Unread dot */}
      {!n.isRead && (
        <div style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: 'var(--text)',
          flexShrink: 0,
          marginTop: 4,
        }} />
      )}
    </button>
  )
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function getRelativeTime(date: Date): string {
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
