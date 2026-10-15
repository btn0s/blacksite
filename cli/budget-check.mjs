import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const config = JSON.parse(await readFile(path.join(root, 'budget.config.json'), 'utf8'))
const dist = path.join(root, config.distDir || 'dist')
const src = path.join(root, config.sourceDir || 'src')
const errors = []
const files = []
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await walk(full)
    else if (entry.isFile()) files.push(full)
  }
}
try { await walk(dist) } catch { errors.push(`Build directory missing: ${dist}`) }
const js = files.filter(file => /\.(?:js|mjs)$/.test(file))
let totalJs = 0
for (const file of files) {
  const relative = path.relative(dist, file).replaceAll(path.sep, '/')
  const bytes = (await stat(file)).size
  if (bytes > config.maxAssetBytes && !/\.(?:js|mjs)$/.test(file)) errors.push(`Asset ${relative}: ${bytes} > ${config.maxAssetBytes} bytes`)
  if (js.includes(file)) {
    totalJs += bytes
    if (bytes > config.maxChunkBytes) errors.push(`JS chunk ${relative}: ${bytes} > ${config.maxChunkBytes} bytes`)
  }
  if ((config.legacyAssetPaths || []).includes(relative)) continue
  if (/\.(?:png|jpe?g|webp|avif|basis|dds)$/i.test(file)) errors.push(`Texture ${relative} is not KTX2`)
  if (/\.(?:fbx|obj|dae)$/i.test(file)) errors.push(`Model ${relative} is not meshopt glTF`)
  if (/\.(?:glb|gltf)$/i.test(file)) {
    try {
      const data = await readFile(file)
      const json = file.endsWith('.glb') ? JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString('utf8')) : JSON.parse(data.toString('utf8'))
      if (!(json.extensionsUsed || []).includes('EXT_meshopt_compression')) errors.push(`Model ${relative} lacks EXT_meshopt_compression`)
    } catch { errors.push(`Model ${relative} could not be inspected`) }
  }
}
if (totalJs > config.maxTotalJsBytes) errors.push(`Total JS: ${totalJs} > ${config.maxTotalJsBytes} bytes`)
const sourceFiles = []
async function sourceWalk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await sourceWalk(full)
    else if (/\.[cm]?[jt]sx?$/.test(full)) sourceFiles.push(full)
  }
}
try { await sourceWalk(src) } catch { errors.push(`Source directory missing: ${src}`) }
const source = (await Promise.all(sourceFiles.map(file => readFile(file, 'utf8')))).join('\n')
if (!/\bregisterWarmup\s*\(/.test(source)) errors.push('No registerWarmup usage in game source')
if (!Number.isInteger(config.fixedStepHz) || config.fixedStepHz <= 0) errors.push('fixedStepHz must be a positive integer')
if (config.requiresFixedStep && !new RegExp(`(?:timeStep\\s*=\\s*\\{\\s*1\\s*\\/\\s*${config.fixedStepHz}|1\\s*\\/\\s*${config.fixedStepHz})`).test(source)) errors.push(`No ${config.fixedStepHz} Hz fixed-step configuration in game source`)
process.stdout.write(`Budget: ${js.length} JS chunks, ${totalJs} JS bytes, ${files.length} build files, fixed step ${config.fixedStepHz} Hz\n`)
for (const error of errors) process.stderr.write(`${error}\n`)
if (errors.length) process.exitCode = 1
