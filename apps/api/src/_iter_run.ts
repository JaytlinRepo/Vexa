/**
 * Run N iterations on the same 5 sources and report per-source distribution
 * + label uniqueness for each. Lets us judge consistency.
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const N = Number(process.env.ITERS || '1')

async function main() {
  const prisma = new PrismaClient()
  const recent = await prisma.videoCompilation.findFirst({
    where: { status: 'complete' },
    orderBy: { createdAt: 'desc' },
  })
  if (!recent) process.exit(1)
  const sourceUploadIds = recent.uploadIds as string[]
  const sources = await prisma.videoUpload.findMany({ where: { id: { in: sourceUploadIds } } })
  const ordered = sourceUploadIds.map((id) => sources.find((s) => s.id === id)).filter(Boolean) as typeof sources
  console.log(`Running ${N} iteration(s) on ${ordered.length} sources:`)
  for (const s of ordered) console.log(`  - ${s.fileName}`)

  // Get input durations once via the existing _pull_latest pattern; here we
  // just probe the most recent successful compilation's "Input durations"
  // log line. Easier: take from last completed compilation's processing
  // duration → 72.6s total = 7.6 + 15.9 + 23.5 + 14.5 + 11.0 (we know).
  // Hard-code from the log: 7.6 / 15.9 / 23.5 / 14.5 / 11.0 → cumulative
  const inputDurs = [7.6, 15.9, 23.5, 14.5, 11.0]
  const boundaries = inputDurs.reduce<{ start: number; end: number; n: string }[]>((acc, d, i) => {
    const start = i === 0 ? 0 : acc[i - 1].end
    acc.push({ start, end: start + d, n: ordered[i].fileName ?? `clip${i + 1}` })
    return acc
  }, [])

  const results: any[] = []
  for (let iter = 0; iter < N; iter++) {
    console.log(`\n=== ITER ${iter + 1}/${N} ===`)
    const company = await prisma.company.findUnique({ where: { id: recent.companyId } })
    if (!company) process.exit(1)
    const compilation = await prisma.videoCompilation.create({
      data: {
        companyId: recent.companyId,
        uploadIds: sourceUploadIds,
        strategy: 'montage',
        targetDuration: 60,
      },
    })
    const { videoQueue } = await import('./queues')
    await videoQueue.add('compilation', {
      uploadId: compilation.id, videoUrl: '', userId: company.userId, companyId: company.id, s3Key: '',
    })
    console.log(`  enqueued ${compilation.id.slice(0, 8)}`)

    const start = Date.now()
    while (true) {
      await new Promise((r) => setTimeout(r, 5000))
      const elapsed = ((Date.now() - start) / 1000).toFixed(0)
      const row = await prisma.videoCompilation.findUnique({ where: { id: compilation.id } })
      if (!row) continue
      process.stdout.write(`  [${elapsed}s] ${row.status}\r`)
      if (row.status === 'failed') { console.error(`\n  FAILED: ${row.error}`); break }
      if (row.status === 'complete' && row.clipId) {
        console.log('')
        const clip = await prisma.videoClip.findFirst({ where: { uploadId: row.clipId }, orderBy: { createdAt: 'desc' } })
        if (!clip) break
        const adj = clip.adjustments as any
        // Distribution
        const counts: Record<string, number> = {}
        for (const s of adj.segments) {
          const idx = boundaries.findIndex((b) => s.startTime >= b.start && s.startTime < b.end)
          const key = idx >= 0 ? boundaries[idx].n : 'OTHER'
          counts[key] = (counts[key] || 0) + 1
        }
        const labels = adj.segments.map((s: any) => s.label)
        const uniqueLabels = new Set(labels).size
        results.push({
          duration: clip.duration,
          segments: adj.segments.length,
          uniqueLabels,
          counts,
          hook: clip.hook,
          s3: clip.clippedUrl,
        })
        console.log(`  reel:        ${clip.duration?.toFixed(1)}s, ${adj.segments.length} segs, ${uniqueLabels} unique labels`)
        console.log(`  hook:        "${clip.hook}"`)
        console.log(`  per-source:`)
        for (const b of boundaries) {
          console.log(`    ${b.n.padEnd(28)} ${counts[b.n] || 0}`)
        }
        console.log(`  segments:`)
        for (let j = 0; j < adj.segments.length; j++) {
          const s = adj.segments[j]
          console.log(`    ${j + 1}. ${s.startTime.toFixed(2)}s → ${s.endTime.toFixed(2)}s (${(s.endTime - s.startTime).toFixed(2)}s) [${s.energy}] ${s.label}`)
        }
        break
      }
      if (parseInt(elapsed) > 600) { console.error('  timeout'); break }
    }
  }

  console.log('\n\n========= SUMMARY =========')
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    console.log(`Iter ${i + 1}: ${r.duration?.toFixed(1)}s, ${r.segments} segs, ${r.uniqueLabels} labels, distribution: ${JSON.stringify(r.counts)}`)
  }
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
