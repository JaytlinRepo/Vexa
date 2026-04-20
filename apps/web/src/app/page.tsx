import fs from 'node:fs/promises'
import path from 'node:path'
import { unstable_noStore as noStore } from 'next/cache'
import PrototypeShell from './_prototype/PrototypeShell'
import './vexa-landing.css'
import './vexa-shared.css'
import './prototype.css'

// Do not statically prerender: body.html is read via fs (not in the module
// graph), so a static build bakes markup at build time and dev can look
// "stuck" on old HTML until a full rebuild/restart.
export const dynamic = 'force-dynamic'

export default async function HomePage() {
  noStore()
  const bodyPath = path.join(process.cwd(), 'src/app/_prototype/body.html')
  const html = await fs.readFile(bodyPath, 'utf8')
  return <PrototypeShell html={html} />
}
