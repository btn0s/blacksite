import { access, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? 'D:/dev/owned-assets/dark-ruins')
const pageBuild = resolve(process.argv[3])
const output = resolve(process.argv[4])
const materialBuild = resolve(process.argv[5])
const pathFromRoot = file => {
  const path = relative(root, file).replaceAll('\\', '/')
  if (path.startsWith('../') || path.includes(':')) throw new Error('Playable builds must stay inside the owned asset root')
  return path
}
const level = JSON.parse(await readFile(join(pageBuild, 'level.json'), 'utf8'))
const surfaces = JSON.parse(await readFile(join(materialBuild, 'surfaces.json'), 'utf8'))
const courtyard = JSON.parse(await readFile(join(root, 'courtyard.json'), 'utf8'))
if (level.version !== 5 || surfaces.version !== 2 || surfaces.untranslated.length) throw new Error('Playable level requires version 5 pages and complete version 2 materials')
await access(join(output, 'collision.json'))
const accounted = new Set([...surfaces.surfaces, ...surfaces.excluded].map(surface => surface.path))
for (const path of level.materialPaths) if (!accounted.has(path)) throw new Error(`Whole-level surface is unaccounted: ${path}`)
const manifest = {
  version: 5, placements: 20430, centre: courtyard.centre, minimumWorldError: level.minimumWorldError,
  directory: pathFromRoot(join(pageBuild, level.directory)), environment: pathFromRoot(join(pageBuild, level.environment)),
  collision: pathFromRoot(join(output, 'collision.json')), surfaces: pathFromRoot(join(materialBuild, 'surfaces.json')),
  materialPaths: level.materialPaths, geometries: level.geometries.map(({ id, url }) => ({ id, url: pathFromRoot(join(pageBuild, url)) })),
  untranslated: [], excluded: surfaces.excluded,
}
await writeFile(join(output, 'full.json'), JSON.stringify(manifest), { flag: 'wx' })
console.log(JSON.stringify({ complete: true, output, geometries: manifest.geometries.length, placements: manifest.placements, surfaces: surfaces.surfaces.length, excluded: surfaces.excluded.length, published: false }))
