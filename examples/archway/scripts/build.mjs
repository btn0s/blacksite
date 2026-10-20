import { readFile, mkdir, mkdtemp, link, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve, join } from 'node:path'
import { readPageDirectory } from '../../../packages/geometry/scripts/pages.mjs'

const root = resolve(process.argv[2] ?? 'D:/dev/owned-assets/dark-ruins')
const pageBuild = resolve(process.argv[3] ?? join(root, 'build-pages-v5-20261020-01'))
const manifest = JSON.parse(await readFile(join(root, 'courtyard.json'), 'utf8'))
const level = JSON.parse(await readFile(join(pageBuild, 'level.json'), 'utf8'))
if (level.version !== 5) throw new Error('Courtyard requires the verified version 5 page build')
const output = await mkdtemp(join(root, 'build-courtyard-pages-'))
await mkdir(join(output, 'geometry'))
const generation = basename(output)
const geometries = []
const totals = { pages: 0, pinnedPages: 0, wireBytes: 0, residentBytes: 0, directoryBytes: 0 }
for (const previous of manifest.geometries) {
  const geometry = level.geometries.find(entry => entry.id === `${previous.file}:${previous.meshIndex}`)
  if (!geometry) throw new Error(`Page build omits courtyard geometry: ${previous.file}:${previous.meshIndex}`)
  const directory = await readPageDirectory(join(pageBuild, geometry.url))
  const m = directory.metadata
  const previousMetadata = previous.metadata ?? (await readPageDirectory(join(root, previous.url))).metadata
  if (m.source.sha256 !== previousMetadata.source.sha256 || m.sourceTriangles !== previousMetadata.sourceTriangles) throw new Error('Courtyard source provenance changed')
  const name = basename(geometry.url)
  await link(join(pageBuild, geometry.url), join(output, 'geometry', name))
  await link(join(pageBuild, dirname(geometry.url), m.pagePack), join(output, 'geometry', m.pagePack))
  geometries.push({ file: previous.file, meshIndex: previous.meshIndex, url: `${generation}/geometry/${name}` })
  totals.pages += m.pageCount
  totals.pinnedPages += m.pinnedPages
  totals.wireBytes += m.packBytes
  totals.residentBytes += m.residentBytes
  totals.directoryBytes += directory.bytes
}
const next = { ...manifest, version: 5, geometries }
await writeFile(join(output, 'courtyard.json'), JSON.stringify(next))
await writeFile(join(output, 'census.json'), JSON.stringify({ version: 5, sourceBuild: pageBuild, placements: manifest.placements.length, geometries: geometries.length, totals }, null, 2))
console.log(JSON.stringify({ output, totals, published: false }, null, 2))
