/** Short, env-safe summaries for HTTP 500 bodies (full error stays in logs only). */

export function clientSafeApiMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const s = raw.replace(/\s+/g, ' ').trim()
  const lower = s.toLowerCase()

  if (
    /p1001|p1017|econnrefused|can't reach database|could not connect to/i.test(lower)
    || (/connection refused|server has closed/i.test(lower) && /prisma|database|postgres/i.test(lower))
    || (/etimedout|ehostunreach/i.test(lower) && /prisma|query|postgres/i.test(lower))
  ) {
    return 'Could not connect to the database. Start Postgres (or your DB) and verify DATABASE_URL, then try again.'
  }

  if (
    lower.includes('relation') && lower.includes('does not exist')
    || lower.includes('column') && lower.includes('does not exist')
    || /prisma migrations?/i.test(s)
    || /\bp2022\b|\bp2021\b|\bp2002\b|\bp2003\b/i.test(s)
  ) {
    return 'The database schema may be out of date. Run migrations on the API server (prisma migrate deploy), then retry.'
  }

  if (/session_secret is not set|missing.session_secret/i.test(lower)) {
    return 'Missing SESSION_SECRET in the API environment.'
  }

  // Short single-line hints we can expose safely (ASCII only; no URLs).
  // Reject anything that looks like an AWS / IAM / HTTP-stack / arn leak so
  // infra noise never lands in user-visible bodies. Internals stay in logs.
  if (
    /(arn:aws|aws |iam:|s3:|accessdenied|access denied|x-amz|presigned|signature)/i.test(lower)
    || /\bstatus code \d{3}\b/.test(lower)
  ) return 'Something went wrong on our side. Please try again in a moment.'
  if (s.length > 12 && s.length <= 240 && /^[\x20-\x7E]+$/.test(s)) return s

  return 'Something went wrong on our side. Please try again in a moment.'
}

/**
 * Returns a category + user-facing message for video-processing failures
 * that never leak AWS / IAM / HTTP-stack details. The raw error always
 * stays server-side in console logs; the broadcast payload is curated so
 * the Studio UI can display something like "We couldn't finish editing
 * your reel. Please try again." instead of "User: arn:aws:iam::… is not
 * authorized to perform: s3:GetObject…".
 */
export function clientSafeProcessingError(err: unknown): { code: string; message: string } {
  const raw = err instanceof Error ? err.message : String(err)
  const s = raw.replace(/\s+/g, ' ').trim()
  const lower = s.toLowerCase()

  if (
    /\b(arn:aws|aws|iam|s3|accessdenied|access denied|bucket|signature|x-amz|presigned)\b/.test(lower)
    || /\bstatus code (4\d{2}|5\d{2})\b/.test(lower)
    || /\b(forbidden|unauthorized)\b/.test(lower)
  ) {
    return { code: 'storage_unavailable', message: 'We hit a storage hiccup while processing your reel. Please try again in a moment.' }
  }
  if (/\b(bedrock|throttl|rate.?limit|quota|model)\b/.test(lower)) {
    return { code: 'model_busy', message: 'Our AI editor is overloaded right now. Please try again in a minute.' }
  }
  if (/\b(econn|enotfound|etimedout)|fetch failed|\bnetwork\b/.test(lower)) {
    return { code: 'network', message: "We couldn't reach a service we depend on. Please try again." }
  }
  if (/\b(ffmpeg|codec|moov|invalid data|corrupt)\b/.test(lower)) {
    return { code: 'unsupported_video', message: "We couldn't read this video. Try a different file or a shorter clip." }
  }
  return { code: 'processing_failed', message: "We couldn't finish editing your reel. Please try again, or use a shorter clip." }
}
