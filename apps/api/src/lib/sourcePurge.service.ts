/**
 * Source-upload purge — Tier 2a of the S3 cleanup strategy.
 *
 * Decides whether a `VideoUpload`'s original source MP4 can be safely
 * removed from S3, then does the deletion + flips a `sourcePurgedAt`
 * marker on the row so the UI can disable Re-cut on derived clips.
 *
 * Conservative gate: every clip derived from the upload must be in a
 * "done" state (archived / ready_to_post / posted) AND the most recent
 * activity on the upload's clips must be older than the configured grace
 * period (default 30 days). The grace period gives the user a chance to
 * come back and recut after a download without losing the source.
 *
 * Calls are fire-and-forget from the routes that change clip status;
 * the route's response shouldn't block on cleanup.
 */
import type { PrismaClient } from '@prisma/client'

const DEFAULT_GRACE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

// Statuses that mean "user is done editing this clip" — eligible for
// purging the underlying source. `ready` and `ready_to_post` are
// historical aliases that both mean the same thing in this codebase.
const DONE_STATUSES = new Set(['archived', 'ready', 'ready_to_post', 'posted'])

export type PurgeResult =
  | { ok: true; purged: string; uploadId: string }
  | { ok: false; reason: string; uploadId: string }

export interface PurgeOptions {
  /**
   * Minimum age (in ms) of the most recent clip activity before purge
   * is allowed. Default: 30 days. Pass 0 to bypass the grace period
   * entirely (e.g., for an admin "purge now" button or a recovery
   * script after lifecycle policy already swept the bucket).
   */
  graceMs?: number
}

/**
 * Try to purge a single upload's source. Returns a structured result
 * — never throws (caller can ignore for fire-and-forget, or log).
 */
export async function maybePurgeUploadSource(
  prisma: PrismaClient,
  uploadId: string,
  opts: PurgeOptions = {},
): Promise<PurgeResult> {
  const graceMs = opts.graceMs ?? DEFAULT_GRACE_MS

  const upload = await prisma.videoUpload.findUnique({
    where: { id: uploadId },
    select: {
      id: true,
      sourceVideoUrl: true,
      sourcePurgedAt: true,
      createdAt: true,
      clips: {
        select: {
          id: true,
          status: true,
          userEditedAt: true,
          createdAt: true,
        },
      },
    },
  })
  if (!upload) return { ok: false, reason: 'not_found', uploadId }
  if (upload.sourcePurgedAt) return { ok: false, reason: 'already_purged', uploadId }
  if (upload.clips.length === 0) {
    // No derived clips ever materialized. Treat as eligible if old
    // enough — likely an upload that failed analysis and was abandoned.
    const age = Date.now() - upload.createdAt.getTime()
    if (age < graceMs) return { ok: false, reason: 'orphan_too_recent', uploadId }
  } else {
    // All clips must be in a terminal state.
    const allDone = upload.clips.every((c) => DONE_STATUSES.has(c.status))
    if (!allDone) return { ok: false, reason: 'clips_in_progress', uploadId }

    // Most recent activity across clips must be older than the grace.
    const lastTouchMs = Math.max(
      upload.createdAt.getTime(),
      ...upload.clips.map((c) => Math.max(
        c.userEditedAt?.getTime() ?? 0,
        c.createdAt.getTime(),
      )),
    )
    const age = Date.now() - lastTouchMs
    if (age < graceMs) return { ok: false, reason: 'within_grace_period', uploadId }
  }

  // Extract the S3 key from the stored URL. We accept either an
  // s3://key reference (preferred, set on new uploads) or a presigned
  // https URL containing `vexa-outputs.s3...amazonaws.com/{key}` —
  // the legacy shape from earlier ingest paths.
  const url = upload.sourceVideoUrl
  let key: string | null = null
  if (typeof url === 'string') {
    if (url.startsWith('s3://')) {
      key = url.slice('s3://'.length)
    } else if (url.includes('vexa-outputs') && url.includes('.s3')) {
      const m = url.match(/vexa-outputs\.s3[^/]*\.amazonaws\.com\/([^?]+)/)
      if (m) key = decodeURIComponent(m[1])
    }
  }
  if (!key) return { ok: false, reason: 'unresolvable_url', uploadId }

  // Delete the S3 object. If S3 returns NoSuchKey, that's fine — the
  // object was already gone (manual cleanup, lifecycle policy, etc.) —
  // we still want to flip the DB marker so the UI reflects reality.
  try {
    const { deleteFile } = await import('../services/storage/s3.service')
    await deleteFile(key)
  } catch (err) {
    const msg = (err as Error).message ?? ''
    if (!/NoSuchKey/i.test(msg)) {
      console.warn(`[s3-purge] failed to delete ${key}:`, msg)
      return { ok: false, reason: 'delete_failed', uploadId }
    }
    // NoSuchKey — fall through and mark purged anyway.
  }

  await prisma.videoUpload.update({
    where: { id: upload.id },
    data: { sourcePurgedAt: new Date() },
  })

  console.log(`[s3-purge] purged source ${key} for upload ${upload.id} (${upload.clips.length} clip(s) shipped)`)
  return { ok: true, purged: key, uploadId }
}

/**
 * Fire-and-forget helper for use inside route handlers. Logs failures,
 * never throws. Use this from any code path that changes a clip's
 * status — if the change makes the upload eligible for purge, it'll
 * happen out-of-band without delaying the response.
 */
export function schedulePurgeCheck(
  prisma: PrismaClient,
  uploadId: string,
  opts?: PurgeOptions,
): void {
  ;(async () => {
    try {
      const result = await maybePurgeUploadSource(prisma, uploadId, opts)
      if (!result.ok && result.reason !== 'already_purged' && result.reason !== 'clips_in_progress' && result.reason !== 'within_grace_period') {
        // The "expected" reasons are quiet — only log the surprising ones
        // (unresolvable URL, delete_failed, etc.) for ops visibility.
        console.warn(`[s3-purge] skipped upload ${uploadId}: ${result.reason}`)
      }
    } catch (err) {
      console.warn('[s3-purge] schedulePurgeCheck failed:', (err as Error).message)
    }
  })()
}
