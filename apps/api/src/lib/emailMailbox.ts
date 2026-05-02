/** Reject throwaway / keyboard-mash domains. Keep client rules in sync: apps/web/public/auth-ui.js (search EMAIL_DOMAIN_SYNC). */

export const EMAIL_DOMAIN_REJECT_MESSAGE =
  'That email domain doesn’t look valid. Use a working address you check often.'

/** Lowercase hostnames (registrable-style). */
const DISPOSABLE_HOSTS = new Set<string>([
  'mailinator.com',
  'guerrillamail.com',
  'guerrillamailblock.com',
  'tempmail.com',
  'throwaway.email',
  '10minutemail.com',
  'yopmail.com',
  'trashmail.com',
  'temp-mail.org',
  'getnada.com',
  'maildrop.cc',
  'dispostable.com',
])

function hostnameFromEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at < 1) return ''
  return email.slice(at + 1).trim().toLowerCase()
}

function isDisposableHost(host: string): boolean {
  const h = host.toLowerCase()
  if (DISPOSABLE_HOSTS.has(h)) return true
  for (const d of DISPOSABLE_HOSTS) {
    if (h === d || h.endsWith('.' + d)) return true
  }
  return false
}

/**
 * For `user@name.tld` only (exactly two DNS labels), reject long labels with no
 * vowels (common random typing) and very long consonant runs. Skips `a.b.c` so
 * `yahoo.co.uk` is not misclassified. Skips punycode IDNs.
 */
function twoLabelGibberishReject(sld: string): boolean {
  if (/^xn--/i.test(sld)) return false
  const core = sld.replace(/-/g, '').toLowerCase()
  if (core.length < 5) return false
  if (!/^[a-z0-9]+$/i.test(core)) return false
  if (/^\d+$/.test(core)) return true
  if (!/[aeiouy]/.test(core)) return true
  let run = 0
  for (const ch of core) {
    if (/[aeiouy]/.test(ch)) run = 0
    else {
      run++
      if (run >= 8) return true
    }
  }
  return false
}

/** Registrable host is leftmost label when suffix is compound (without full PSL). */
const KNOWN_MULTI_SUFFIXES = new Set([
  'co.uk',
  'com.au',
  'com.br',
  'co.nz',
  'net.au',
  'org.au',
  'org.uk',
])

/** True if this address should be rejected (after syntactic email validation). */
export function isRejectedMailboxEmail(email: string): boolean {
  const host = hostnameFromEmail(email.trim().toLowerCase())
  if (!host || !email.includes('@')) return false
  const parts = host.split('.').filter((p) => p.length > 0)
  if (parts.length < 2) return false
  if (isDisposableHost(host)) return true
  if (parts.length === 2) {
    return twoLabelGibberishReject(parts[0]!)
  }
  if (
    parts.length === 3
    && KNOWN_MULTI_SUFFIXES.has(`${parts[1]}.${parts[2]}`.toLowerCase())
  ) {
    return twoLabelGibberishReject(parts[0]!)
  }
  return false
}
