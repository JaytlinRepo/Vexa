import fs from 'node:fs/promises'
import path from 'node:path'
import PrototypeShell from './_prototype/PrototypeShell'
import './prototype.css'

export default async function HomePage() {
  const bodyPath = path.join(process.cwd(), 'src/app/_prototype/body.html')
  const html = await fs.readFile(bodyPath, 'utf8')
  return <PrototypeShell html={html} />
}
