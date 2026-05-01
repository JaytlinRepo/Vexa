'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'

function ResetPasswordForm() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const token = searchParams.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!token) {
      setStatus('error')
      setMessage('Invalid reset link. Please request a new one from the login page.')
    }
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setMessage('')

    if (password !== confirm) {
      setStatus('error')
      setMessage('Passwords do not match.')
      return
    }
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      setStatus('error')
      setMessage('Password must be at least 8 characters with one uppercase letter and one number.')
      return
    }

    setStatus('loading')
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setStatus('error')
        setMessage(json.message || 'This reset link is invalid or has expired. Please request a new one.')
        return
      }
      setStatus('success')
      setMessage('Password updated. Redirecting you to log in…')
      setTimeout(() => router.push('/'), 2500)
    } catch {
      setStatus('error')
      setMessage('Network error. Check your connection and try again.')
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0a0a0a', fontFamily: '"DM Sans", Helvetica, Arial, sans-serif', padding: '24px',
    }}>
      <div style={{
        width: '100%', maxWidth: '420px', background: '#161616',
        border: '1px solid #252525', borderRadius: '16px', padding: '40px 36px',
      }}>
        <div style={{ marginBottom: '28px' }}>
          <span style={{ fontFamily: 'Georgia, serif', fontSize: '22px', fontWeight: 'bold', color: '#f5f5f5', letterSpacing: '-1px' }}>
            Sovexa
          </span>
        </div>

        <h1 style={{ margin: '0 0 6px', fontSize: '24px', fontWeight: 700, color: '#f5f5f5', letterSpacing: '-0.5px' }}>
          Set a new password
        </h1>
        <p style={{ margin: '0 0 28px', fontSize: '13px', color: '#888', lineHeight: 1.5 }}>
          Choose something strong — at least 8 characters, one uppercase letter, one number.
        </p>

        {status === 'success' ? (
          <p style={{ color: '#34d27a', fontSize: '14px', lineHeight: 1.6 }}>{message}</p>
        ) : (
          <form onSubmit={handleSubmit}>
            <label style={labelStyle}>New password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="8+ characters"
              autoComplete="new-password"
              disabled={status === 'loading' || !token}
              style={inputStyle}
            />

            <label style={{ ...labelStyle, marginTop: '16px' }}>Confirm password</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Same password again"
              autoComplete="new-password"
              disabled={status === 'loading' || !token}
              style={inputStyle}
            />

            {message && (
              <p style={{ margin: '14px 0 0', fontSize: '13px', color: status === 'error' ? '#ff6b6b' : '#34d27a', lineHeight: 1.5 }}>
                {message}
              </p>
            )}

            <button
              type="submit"
              disabled={status === 'loading' || !token}
              style={{
                marginTop: '24px', width: '100%', padding: '13px',
                background: status === 'loading' ? '#333' : '#f5f5f5',
                color: '#0a0a0a', border: 'none', borderRadius: '8px',
                fontSize: '13px', fontWeight: 600, cursor: status === 'loading' ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit', transition: 'background .15s',
              }}
            >
              {status === 'loading' ? 'Updating…' : 'Update password'}
            </button>
          </form>
        )}

        <p style={{ margin: '20px 0 0', fontSize: '12px', color: '#555', textAlign: 'center' }}>
          <a href="/" style={{ color: '#888', textDecoration: 'none' }}>← Back to Sovexa</a>
        </p>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '11px', color: '#666',
  letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '6px',
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '11px 14px', background: '#1e1e1e',
  border: '1px solid #2e2e2e', borderRadius: '8px', color: '#f5f5f5',
  fontSize: '14px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  )
}
