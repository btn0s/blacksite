import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCatalog } from '../../cli/library.mjs'

const catalog = await loadCatalog()
const pack = process.argv[2] ?? 'starter'
const selected = catalog.packs[pack]
if (!selected) throw new Error(`Unknown pack ${pack}`)
const root = process.env.BLACKSITE_LIBRARY_BUILD_DIR ?? fileURLToPath(new URL('../.build', import.meta.url))
const assets = []
const problems = []
for (const id of selected.assets) {
  const entry = catalog.assets.find(asset => asset.id === id)
  const directory = path.resolve(root, id)
  try {
    const manifest = JSON.parse(await readFile(path.join(directory, 'asset.json'), 'utf8'))
    const files = []
    for (const [name, size] of Object.entries(manifest.files)) {
      const file = path.resolve(directory, name)
      if (!file.startsWith(directory + path.sep) || /login|token|secret|key|credential/i.test(path.basename(file))) throw new Error(`Refusing file ${name}`)
      const bytes = await readFile(file)
      if (bytes.length !== size) problems.push(`${id}/${name}: expected ${size} bytes, got ${bytes.length}`)
      files.push({ name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
    }
    if (!manifest.withinBudget) problems.push(`${id}: ${manifest.over.join(', ')}`)
    if (!entry.files.length || entry.files.some(file => !file.sha256 || !file.size)) problems.push(`${id}: source not pinned`)
    const shippedBytes = manifest.ship.reduce((sum, name) => sum + (files.find(file => file.name === name)?.size ?? 0), 0)
    for (const name of manifest.ship) if (!files.some(file => file.name === name)) problems.push(`${id}: missing shipped file ${name}`)
    assets.push({ id, category: entry.category, budget: manifest.budget, budgetBytes: manifest.bytes, shippedBytes, installedBytes: files.reduce((sum, file) => sum + file.size, 0), files })
  } catch (error) { problems.push(`${id}: ${error.message}`) }
}
console.log(JSON.stringify({ pack, count: assets.length, files: assets.reduce((sum, asset) => sum + asset.files.length, 0), shippedBytes: assets.reduce((sum, asset) => sum + asset.shippedBytes, 0), installedBytes: assets.reduce((sum, asset) => sum + asset.installedBytes, 0), problems, assets }, null, 2))
if (problems.length) process.exitCode = 1
