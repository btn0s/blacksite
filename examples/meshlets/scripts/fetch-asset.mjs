import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import sharp from 'sharp'

if (!process.argv[2]) throw new Error('Usage: node scripts/fetch-asset.mjs <external-runtime-directory>')
const output = resolve(process.argv[2])
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const location = relative(repository, output)
if (!location.startsWith(`..${sep}`)) throw new Error('Downloaded assets must live outside the repository')
const sources = JSON.parse(await readFile(new URL('./cc0-assets.json', import.meta.url), 'utf8'))
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const cache = resolve(output, '.source-cache')
const hash = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex')
const outputs = []

async function download(file, name) {
  const cached = resolve(cache, name)
  const valid = bytes => (!file.size || bytes.length === file.size) && hash(bytes, 'md5') === file.md5
  try {
    const bytes = await readFile(cached)
    if (valid(bytes)) return bytes
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const response = await fetch(file.url)
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${file.url}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!valid(bytes)) throw new Error(`Source checksum changed: ${file.url}`)
  await mkdir(dirname(cached), { recursive: true })
  await writeFile(cached, bytes)
  return bytes
}

async function record(name, source) {
  const bytes = await readFile(resolve(output, name))
  const result = { file: name, bytes: bytes.length, sha256: hash(bytes), source, license: 'CC0-1.0' }
  outputs.push(result)
  console.log(JSON.stringify(result))
}

await mkdir(output, { recursive: true })
for (const model of sources.models) {
  const downloads = new Map(await Promise.all(Object.entries(model.files).map(async ([name, file]) => [name, await download(file, `${model.id}/${name}`)])))
  const document = await io.readJSON({
    json: JSON.parse(downloads.get('scene').toString('utf8')),
    resources: Object.fromEntries([...downloads].filter(([name]) => name !== 'scene')),
  })
  if (model.alphaMask) {
    const mask = model.alphaMask
    const material = document.getRoot().listMaterials().find(value => value.getName() === mask.material)
    if (!material) throw new Error(`Missing source material: ${mask.material}`)
    const alpha = await sharp(await download(mask.alpha, `${model.id}/leaf-alpha.png`)).extractChannel(0).toBuffer()
    const rgba = await sharp(downloads.get(mask.image)).removeAlpha().joinChannel(alpha).png().toBuffer()
    const previous = material.getBaseColorTexture()
    const texture = document.createTexture(`${mask.material}_rgba`).setImage(rgba).setMimeType('image/png')
    material.setBaseColorTexture(texture).setAlphaMode('MASK').setAlphaCutoff(mask.cutoff)
    previous.dispose()
  }
  const name = `${model.name}.glb`
  await io.write(resolve(output, name), document)
  await record(name, model.source)
}
for (const file of sources.files) {
  await writeFile(resolve(output, file.name), await download(file, file.name))
  await record(file.name, file.source)
}
await writeFile(resolve(output, 'public-assets.json'), JSON.stringify(outputs, null, 2) + '\n')
