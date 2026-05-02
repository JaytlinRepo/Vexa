/**
 * Riley Pipeline Test CLI
 *
 * Runs the full video automation pipeline against an existing VideoUpload row,
 * printing every stage's decisions in detail. Optionally downloads the rendered
 * reel locally for review.
 *
 * Usage:
 *   tsx scripts/test-riley.ts                 # interactive: pick from recent uploads
 *   tsx scripts/test-riley.ts --upload <id>   # run against a specific uploadId
 *   tsx scripts/test-riley.ts --list          # only list recent uploads, don't run
 *   tsx scripts/test-riley.ts --no-download   # skip downloading the rendered clip
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as readline from 'readline'
import axios from 'axios'
import VideoProcessingService from '../src/lib/videoProcessing.service'
import { setBroadcastFn } from '../src/lib/videoProcessing.service'
import { getPresignedUrl } from '../src/services/storage/s3.service'

const prisma = new PrismaClient({ log: ['warn', 'error'] })

const args = new Map<string, string>()
const flags = new Set<string>()
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a.startsWith('--')) {
    const next = process.argv[i + 1]
    if (next && !next.startsWith('--')) {
      args.set(a.slice(2), next)
      i++
    } else {
      flags.add(a.slice(2))
    }
  }
}

async function listRecentUploads(limit = 8) {
  const uploads = await prisma.videoUpload.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      company: { select: { id: true, name: true, niche: true } },
      clips: { select: { id: true, status: true, visualApprovalStatus: true, copyApprovalStatus: true } },
    },
  })
  return uploads
}

async function ensureFreshSourceUrl(uploadId: string, sourceVideoUrl: string): Promise<string> {
  // If the URL is presigned and looks recent, keep it. Otherwise re-sign.
  const m = sourceVideoUrl.match(/\.amazonaws\.com\/([^?]+)/)
  if (!m) return sourceVideoUrl
  const key = decodeURIComponent(m[1])
  const fresh = await getPresignedUrl(key, 3600)
  return fresh
}

async function main() {
  console.log('🎬 Riley Pipeline Test CLI')
  console.log('═══════════════════════════════════════════════════════════\n')

  // ── Pick the upload ────────────────────────────────────────────────────
  let uploadId = args.get('upload')

  if (!uploadId) {
    const uploads = await listRecentUploads(8)
    if (uploads.length === 0) {
      console.error('No video uploads found in the database.')
      process.exit(1)
    }

    console.log('Recent uploads:')
    uploads.forEach((u, i) => {
      const clipCount = u.clips.length
      const dur = u.duration ? `${u.duration}s` : 'unknown'
      const ago = ((Date.now() - u.createdAt.getTime()) / 3600000).toFixed(1)
      console.log(`  [${i + 1}] ${u.id}`)
      console.log(`      Company: ${u.company.name} (${u.company.niche})`)
      console.log(`      Created: ${ago}h ago, duration: ${dur}, existing clips: ${clipCount}`)
    })

    if (flags.has('list')) {
      await prisma.$disconnect()
      return
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const answer: string = await new Promise((resolve) => {
      rl.question('\nWhich upload? (1-' + uploads.length + ', or paste an uploadId): ', resolve)
    })
    rl.close()

    const trimmed = answer.trim()
    if (/^\d+$/.test(trimmed)) {
      const idx = parseInt(trimmed, 10) - 1
      if (idx < 0 || idx >= uploads.length) {
        console.error('Out of range.')
        process.exit(1)
      }
      uploadId = uploads[idx].id
    } else {
      uploadId = trimmed
    }
  }

  // ── Load the upload ────────────────────────────────────────────────────
  const upload = await prisma.videoUpload.findUnique({
    where: { id: uploadId },
    include: { company: { include: { user: { select: { id: true } } } } },
  })

  if (!upload) {
    console.error(`Upload ${uploadId} not found.`)
    process.exit(1)
  }

  console.log(`\nRunning pipeline on upload ${upload.id}`)
  console.log(`  Company: ${upload.company.name}`)
  console.log(`  Source URL: ${upload.sourceVideoUrl.slice(0, 100)}...`)

  // The pipeline checks for an existing clip and short-circuits (idempotency).
  // For testing, optionally archive any prior clip so we get a fresh run.
  const existing = await prisma.videoClip.findFirst({
    where: { uploadId: upload.id },
    orderBy: { createdAt: 'desc' },
  })
  if (existing && !flags.has('reuse')) {
    console.log(`\nAn existing clip ${existing.id} would short-circuit the pipeline.`)
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const ans: string = await new Promise((resolve) => {
      rl.question('Archive it and re-run? (y/N): ', resolve)
    })
    rl.close()
    if (ans.trim().toLowerCase() === 'y') {
      await prisma.videoClip.update({
        where: { id: existing.id },
        data: { status: 'archived' },
      })
      // Also rename the row's uploadId association is impossible (FK); the
      // idempotency check uses findFirst on uploadId so we need to delete or
      // mark such that findFirst doesn't return it. The check returns the
      // most recent regardless of status, so we have to delete or change
      // findFirst to filter. We'll just delete since this is a test script.
      await prisma.videoClip.delete({ where: { id: existing.id } })
      console.log(`Deleted ${existing.id} so the pipeline runs fresh.`)
    } else {
      console.log('Reusing existing clip — pipeline will short-circuit and just print summary.')
    }
  }

  // ── Refresh presigned URL (24h URLs may have expired) ──────────────────
  const freshUrl = await ensureFreshSourceUrl(upload.id, upload.sourceVideoUrl)

  // ── Wire up SSE-equivalent broadcast to console ────────────────────────
  let lastStage = ''
  const startTime = Date.now()
  setBroadcastFn((event: string, data: any) => {
    if (event === 'stage_start' && data.stage !== lastStage) {
      const t = ((Date.now() - startTime) / 1000).toFixed(1)
      console.log(`\n  [+${t}s] ▶ ${data.stage} (${data.progress ?? '??'}%)`)
      lastStage = data.stage
    } else if (event === 'stage_done') {
      const t = ((Date.now() - startTime) / 1000).toFixed(1)
      console.log(`  [+${t}s] ✓ ${data.stage} done in ${(data.durationMs / 1000).toFixed(1)}s`)
    } else if (event === 'processing_complete') {
      console.log(`\n🎉 Processing complete: clipId=${data.clipId} hook="${data.hook}"`)
    } else if (event === 'processing_error') {
      console.error(`\n💥 Processing error: ${data.error}`)
    }
  })

  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('PIPELINE RUN — watch the console for stage transitions')
  console.log('═══════════════════════════════════════════════════════════')

  const service = new VideoProcessingService(prisma)
  let result
  try {
    result = await service.processVideo(upload.id, freshUrl, upload.company.user.id)
  } catch (err) {
    console.error('\n💥 Pipeline failed:', (err as Error).stack || (err as Error).message)
    await prisma.$disconnect()
    process.exit(1)
  }

  const totalSec = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\n═══════════════════════════════════════════════════════════`)
  console.log(`PIPELINE COMPLETE — ${totalSec}s wallclock`)
  console.log(`═══════════════════════════════════════════════════════════\n`)

  // ── Pull the clip back out and report Riley's decisions in detail ──────
  const clip = await prisma.videoClip.findUnique({ where: { id: result.videoClip.id } })
  if (!clip) {
    console.error('Could not load the resulting clip from DB.')
    await prisma.$disconnect()
    process.exit(1)
  }

  const adj = (clip.adjustments as Record<string, unknown>) || {}
  const segments = (adj.segments as Array<{ startTime: number; endTime: number; label: string; energy: string }>) || []
  const captionOptions = (clip.captionOptions as Array<{ id: string; text: string; type?: string }>) || []
  const styleMetrics = (clip.styleMetrics as Record<string, unknown>) || {}

  console.log('📊 RILEY\'S DECISIONS')
  console.log(`  Source duration: ${upload.duration}s`)
  console.log(`  Final clip:      ${clip.duration}s`)
  console.log(`  Compression:     ${upload.duration ? ((clip.duration / upload.duration) * 100).toFixed(0) : '?'}% of source`)
  console.log(`  Cut count:       ${segments.length}`)
  console.log(`  Length tier:     ${(adj.lengthTier as string) || '(unknown)'}`)
  console.log(`  Hook:            "${clip.hook}"`)
  console.log(`  Rationale:       ${(adj.rationale as string) || '(none)'}\n`)

  console.log('  Segments Riley picked:')
  segments.forEach((s, i) => {
    const dur = (s.endTime - s.startTime).toFixed(1)
    console.log(`    ${i + 1}. [${s.startTime.toFixed(1)}s - ${s.endTime.toFixed(1)}s] (${dur}s) [${s.energy}] — ${s.label}`)
  })

  console.log('\n📝 ALEX\'S CAPTIONS')
  const hooks = captionOptions.filter((c) => c.type === 'hook')
  const captions = captionOptions.filter((c) => !c.type || c.type === 'caption')
  if (hooks.length > 0) {
    console.log('  Hooks:')
    hooks.forEach((h, i) => console.log(`    ${i + 1}. ${h.text}`))
  }
  if (captions.length > 0) {
    console.log('  Captions:')
    captions.forEach((c, i) => console.log(`    ${i + 1}. ${c.text}`))
  }

  console.log('\n📈 METRICS')
  console.log(`  styleMetrics: ${JSON.stringify(styleMetrics, null, 2).split('\n').join('\n  ')}`)

  // ── Optionally download the rendered reel locally ──────────────────────
  if (!flags.has('no-download')) {
    const s3Url = clip.clippedUrl
    let downloadUrl = s3Url
    if (s3Url.startsWith('s3://')) {
      downloadUrl = await getPresignedUrl(s3Url.replace('s3://', ''), 3600)
    }
    // Drop into the project's tmp/riley-tests so the reel sits next to the
    // code instead of getting cleaned up out of /var/folders.
    const projectTmp = path.resolve(__dirname, '..', '..', '..', 'tmp', 'riley-tests')
    fs.mkdirSync(projectTmp, { recursive: true })
    const outPath = path.join(projectTmp, `riley-test-${clip.id}.mp4`)
    console.log(`\n⬇️  Downloading rendered reel to ${outPath} ...`)
    try {
      const resp = await axios.get(downloadUrl, { responseType: 'arraybuffer', timeout: 120000 })
      fs.writeFileSync(outPath, Buffer.from(resp.data))
      const sizeMB = (resp.data.byteLength / 1024 / 1024).toFixed(1)
      console.log(`✓ Saved ${sizeMB}MB to ${outPath}`)
      console.log(`  Open with: open "${outPath}"`)
    } catch (err) {
      console.warn(`✗ Could not download: ${(err as Error).message}`)
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════')
  console.log(`Clip ID: ${clip.id}`)
  console.log(`Status:  visual=${clip.visualApprovalStatus}, copy=${clip.copyApprovalStatus}`)
  console.log('═══════════════════════════════════════════════════════════')

  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error('Fatal:', err)
  await prisma.$disconnect()
  process.exit(1)
})
