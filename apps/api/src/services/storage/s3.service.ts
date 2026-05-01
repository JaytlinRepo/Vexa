import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const REGION = process.env.AWS_REGION || 'us-east-1'
const BUCKET = process.env.AWS_S3_BUCKET || 'vexa-outputs'

const s3 = new S3Client({ region: REGION })

// ─── UPLOAD ──────────────────────────────────────────────────────────────────

/**
 * Upload a file to S3. `body` accepts either a Buffer (in-memory) or a
 * Readable stream (e.g. fs.createReadStream for files on disk). Streaming
 * avoids loading large videos fully into RAM during multi-video uploads.
 * Returns the S3 key for later retrieval.
 */
export async function uploadFile(opts: {
  key: string
  body: Buffer | NodeJS.ReadableStream
  contentType: string
}): Promise<{ key: string; bucket: string }> {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: opts.key,
      Body: opts.body as PutObjectCommand['input']['Body'],
      ContentType: opts.contentType,
    }),
  )
  return { key: opts.key, bucket: BUCKET }
}

// ─── PRESIGNED URL (read) ────────────────────────────────────────────────────

/**
 * Generate a presigned GET URL so the frontend can display the file.
 * Default expiry: 1 hour.
 */
export async function getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn },
  )
}

// ─── PRESIGNED UPLOAD URL ────────────────────────────────────────────────────

/**
 * Generate a presigned PUT URL so the frontend can upload directly to S3.
 * This avoids sending large files through our API server.
 */
export async function getPresignedUploadUrl(opts: {
  key: string
  contentType: string
  expiresIn?: number
}): Promise<string> {
  return getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: opts.key,
      ContentType: opts.contentType,
    }),
    { expiresIn: opts.expiresIn || 600 },
  )
}

// ─── DELETE ──────────────────────────────────────────────────────────────────

export async function deleteFile(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/**
 * Build a unique S3 key for a user upload.
 * Pattern: uploads/{companyId}/{timestamp}-{filename}
 */
export function buildUploadKey(companyId: string, filename: string): string {
  const ts = Date.now()
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `uploads/${companyId}/${ts}-${safe}`
}
