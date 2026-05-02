/** Blocklist for vulgar / abusive language at signup and onboarding. Keep in sync with apps/web/public/auth-ui.js (BAD_LANG_TERMS_SYNC). */

export const DISALLOWED_LANGUAGE_MESSAGE =
  'Remove inappropriate language before continuing.'

const TERMS: readonly string[] = [
  'arse',
  'arsehole',
  'asshole',
  'bastard',
  'bitch',
  'bullshit',
  'clit',
  'cock',
  'crap',
  'cunt',
  'dammit',
  'damn',
  'dick',
  'dickhead',
  'dumbass',
  'fuck',
  'fucked',
  'fucker',
  'fucking',
  'jackass',
  'motherfucker',
  'penis',
  'piss',
  'pissed',
  'prick',
  'pussy',
  'shit',
  'shithead',
  'shitty',
  'slut',
  'twat',
  'wank',
  'whore',
]

function termPattern(term: string): RegExp {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^a-z0-9])${esc}(?:[^a-z0-9]|$)`, 'i')
}

/** True if the string contains a blocked term (word-boundary style, Latin). */
export function containsBlockedLanguage(raw: string): boolean {
  const s = typeof raw === 'string' ? raw : ''
  if (!s.trim()) return false
  return TERMS.some((t) => termPattern(t).test(s))
}
