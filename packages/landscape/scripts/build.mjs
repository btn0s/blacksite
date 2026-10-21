import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { deflateSync } from 'node:zlib'
import { bakeLandscape } from '../src/bake.ts'
import { valleyShape } from '../src/valley.ts'

const usage = 'Usage: node --experimental-strip-types build.mjs <output directory> [shape module]'

export async function buildLandscape(output, shape = valleyShape, onProgress) {
  const baked = bakeLandscape(shape, { onProgress })
  await mkdir(output, { recursive: true })
  for (const field of [baked.near, baked.far]) await writeFile(join(output, field.record.file), deflateSync(field.data, { level: 9 }))
  await writeFile(join(output, baked.manifest.water), JSON.stringify(baked.water))
  await writeFile(join(output, 'landscape.json'), JSON.stringify(baked.manifest, null, 1))
  return baked.manifest
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [target, module] = process.argv.slice(2)
  if (!target) throw new Error(usage)
  const shape = module ? (await import(pathToFileURL(resolve(module)).href)).default : valleyShape
  let last = -1
  const started = performance.now()
  await buildLandscape(resolve(target), shape, fraction => {
    const percent = Math.floor(fraction * 10) * 10
    if (percent !== last) { last = percent; process.stdout.write(`landscape ${percent}%\n`) }
  })
  process.stdout.write(`landscape written to ${resolve(target)} in ${((performance.now() - started) / 1000).toFixed(1)} s\n`)
}
