/**
 * Video Compilation Service
 *
 * Simple approach: concatenate all uploaded videos into one file
 * in upload order, then run the standard single-video pipeline.
 * Riley sees the combined footage and edits it as one piece.
 */

import { PrismaClient } from '@prisma/client'
import { execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import axios from 'axios'
import { getPresignedUrl } from '../services/storage/s3.service'
import { uploadFile } from '../services/storage/s3.service'
import VideoProcessingService from './videoProcessing.service'

const execFileAsync = promisify(execFile)

/**
 * Process a multi-video compilation:
 * 1. Download all videos
 * 2. Concatenate into one file (in upload order)
 * 3. Upload combined file to S3
 * 4. Run the standard single-video pipeline on it
 */
export async function processCompilation(
  prisma: PrismaClient,
  compilationId: string,
): Promise<void> {
  const compilation = await prisma.videoCompilation.findUnique({
    where: { id: compilationId },
  })
  if (!compilation) throw new Error('Compilation not found')

  await prisma.videoCompilation.update({
    where: { id: compilationId },
    data: { status: 'processing' },
  })

  const workDir = path.join(os.tmpdir(), `sovexa-compile-${compilationId}`)

  try {
    fs.mkdirSync(workDir, { recursive: true })

    // Load all uploads in order
    const uploads = await prisma.videoUpload.findMany({
      where: { id: { in: compilation.uploadIds } },
    })

    // Sort by the order they appear in uploadIds (upload order)
    const ordered = compilation.uploadIds
      .map((id) => uploads.find((u) => u.id === id))
      .filter(Boolean) as typeof uploads

    if (ordered.length === 0) throw new Error('No uploads found')

    console.log(`[compilation] Downloading ${ordered.length} videos...`)

    // Download each video
    const localPaths: string[] = []
    for (let i = 0; i < ordered.length; i++) {
      const upload = ordered[i]
      const localPath = path.join(workDir, `part-${String(i).padStart(3, '0')}.mp4`)

      // Get fresh presigned URL
      const s3Key = extractS3Key(upload.sourceVideoUrl)
      const url = await getPresignedUrl(s3Key, 3600)

      const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 180000 })
      fs.writeFileSync(localPath, Buffer.from(resp.data))
      localPaths.push(localPath)

      const sizeMB = (resp.data.byteLength / 1024 / 1024).toFixed(1)
      console.log(`[compilation]   ${i + 1}/${ordered.length}: ${upload.fileName || 'video'} (${sizeMB}MB)`)
    }

    // Build concat list
    const concatPath = path.join(workDir, 'concat.txt')
    const concatContent = localPaths.map((p) => `file '${p}'`).join('\n')
    fs.writeFileSync(concatPath, concatContent)

    // Concatenate all videos into one
    const combinedPath = path.join(workDir, 'combined.mp4')
    console.log(`[compilation] Concatenating ${ordered.length} videos...`)

    // Re-encode during concat to ensure consistent codecs across all videos
    // (different .mov files may have different audio formats or no audio)
    await execFileAsync('ffmpeg', [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatPath,
      '-c:v', 'h264_videotoolbox', '-b:v', '8M',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      combinedPath,
    ], { timeout: 600000 })

    const combinedSize = (fs.statSync(combinedPath).size / 1024 / 1024).toFixed(1)
    console.log(`[compilation] Combined: ${combinedSize}MB`)

    // Upload combined video to S3
    const combinedBuffer = fs.readFileSync(combinedPath)
    const s3Key = `studio/clips/${compilation.companyId}/${Date.now()}-combined.mp4`
    await uploadFile({ key: s3Key, body: combinedBuffer, contentType: 'video/mp4' })
    const combinedUrl = await getPresignedUrl(s3Key, 86400)

    console.log(`[compilation] Uploaded combined video to S3`)

    // Create a VideoUpload record for the combined file
    const combinedUpload = await prisma.videoUpload.create({
      data: {
        companyId: compilation.companyId,
        sourceVideoUrl: combinedUrl,
        fileName: `compilation-${ordered.length}-videos.mp4`,
      },
    })

    // Get the user ID for processing
    const company = await prisma.company.findUnique({
      where: { id: compilation.companyId },
      select: { userId: true },
    })
    if (!company) throw new Error('Company not found')

    // Run the standard single-video pipeline on the combined file
    console.log(`[compilation] Running Riley on combined ${combinedSize}MB video...`)
    const svc = new VideoProcessingService(prisma)
    await svc.processVideo(combinedUpload.id, combinedUrl, company.userId)

    // Update compilation status
    await prisma.videoCompilation.update({
      where: { id: compilationId },
      data: { status: 'complete', clipId: combinedUpload.id },
    })

    console.log(`[compilation] Complete — ${ordered.length} videos → 1 reel`)
  } catch (err) {
    console.error(`[compilation] Failed:`, (err as Error).message)
    await prisma.videoCompilation.update({
      where: { id: compilationId },
      data: { status: 'failed', error: (err as Error).message },
    })
    throw err
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }) } catch {}
  }
}

function extractS3Key(url: string): string {
  if (url.startsWith('s3://')) return url.replace('s3://', '')
  // Extract key from presigned URL
  try {
    const u = new URL(url)
    return u.pathname.slice(1) // remove leading /
  } catch {
    return url
  }
}
