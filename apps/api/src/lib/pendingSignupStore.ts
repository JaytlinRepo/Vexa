import type { PendingSignupData } from '../routes/auth'

// Server-side store for pending signup data, keyed by OAuth nonce.
// Used to avoid relying on cookies surviving the cross-site OAuth redirect.
// Entries expire after 20 minutes (nonce TTL matches state TTL).

const store = new Map<string, { data: PendingSignupData; expiresAt: number }>()
const TTL_MS = 20 * 60 * 1000

export function storePendingByNonce(nonce: string, data: PendingSignupData): void {
  store.set(nonce, { data, expiresAt: Date.now() + TTL_MS })
}

export function getPendingByNonce(nonce: string): PendingSignupData | null {
  const entry = store.get(nonce)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) { store.delete(nonce); return null }
  return entry.data
}

export function deletePendingByNonce(nonce: string): void {
  store.delete(nonce)
}
