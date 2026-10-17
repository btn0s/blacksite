import { spawnSync } from 'node:child_process'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

export const BUDGETS = {
  material: { bytes: 900_000, note: 'colour, normal and ORM at 1K WebP' },
  hdri: { bytes: 1_400_000, note: 'sky backdrop WebP plus a small HDR for PMREM' },
  prop: { bytes: 1_500_000, triangles: 30_000, note: 'GLB, meshopt, 1K WebP textures' },
  foliage: { bytes: 1_500_000, triangles: 30_000, note: 'GLB, meshopt, 1K WebP textures' },
  weapon: { bytes: 2_000_000, triangles: 30_000, note: 'GLB, meshopt, 1K WebP textures' },
  character: { bytes: 3_000_000, triangles: 40_000, note: 'GLB, meshopt, 1K WebP textures' },
  animation: { bytes: 4_000_000, note: 'GLB clip library, meshopt, resampled' },
  sound: { bytes: 80_000, note: 'one variation, mono Opus 64 kb/s' },
  footstep: { bytes: 60_000, note: 'one step, mono Opus 64 kb/s' },
  ambience: { bytes: 1_600_000, note: 'stereo Opus 96 kb/s loop' },
  ir: { bytes: 250_000, note: 'stereo Opus 128 kb/s, 4 s max' },
  terrain: { bytes: 3_000_000, note: '16-bit PNG heightmap plus metadata' },
}

const MAPS = {
  color: /(_Color|_diff|_albedo|_basecolor|_col)\b|Color\.|_diff_/i,
  normalGL: /(_NormalGL|_nor_gl)/i,
  normalDX: /(_NormalDX|_nor_dx)/i,
  roughness: /(_Roughness|_rough)\b|_rough_|Roughness\./i,
  ao: /(_AmbientOcclusion|_ao)\b|_ao_|AmbientOcclusion\./i,
  metalness: /(_Metalness|_metal)\b|_metal_|Metalness\./i,
  arm: /_arm[_.]/i,
  opacity: /(_Opacity|_alpha)\b|Opacity\./i,
}

async function files(directory) {
  const out = []
  for (const name of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, name.name)
    if (name.isDirectory()) out.push(...await files(full))
    else out.push(full)
  }
  return out
}

function pick(list, pattern, extensions = /\.(jpe?g|png|tiff?|exr|webp)$/i) {
  return list.filter(file => extensions.test(file) && pattern.test(path.basename(file))).sort((a, b) => a.length - b.length)[0]
}

function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' })
  if (result.error) throw new Error('ffmpeg is required for audio processing')
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr.trim().split('\n').pop()}`)
  return result
}

function probe(file) {
  const result = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=channels,sample_rate', '-of', 'json', file], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`ffprobe failed on ${path.basename(file)}`)
  const data = JSON.parse(result.stdout)
  return { duration: Number(data.format.duration), channels: data.streams[0]?.channels ?? 1, rate: Number(data.streams[0]?.sample_rate ?? 48000) }
}

function peak(file, filters, start = 0) {
  const chain = [filters, 'aformat=sample_fmts=flt', 'astats=metadata=0:reset=0'].filter(Boolean).join(',')
  const result = spawnSync('ffmpeg', ['-hide_banner', '-ss', String(start), '-i', file, '-af', chain, '-f', 'null', '-'], { encoding: 'utf8' })
  const levels = [...result.stderr.matchAll(/Peak level dB:\s*(-?[\d.]+)/g)].map(match => Number(match[1]))
  if (result.status !== 0 || !levels.length) throw new Error(`Cannot measure peak of ${path.basename(file)}`)
  return Math.max(...levels)
}

let encoderPromise
export const KTX2_MODES = {
  etc1s: { isUASTC: false, qualityLevel: 255, compressionLevel: 4 },
  'etc1s-160': { isUASTC: false, qualityLevel: 160, compressionLevel: 2 },
  'uastc-rdo': { isUASTC: true, needSupercompression: true, enableRDO: true, rdoQualityLevel: 1, uastcLDRQualityLevel: 2 },
  'uastc-rdo-1': { isUASTC: true, needSupercompression: true, enableRDO: true, rdoQualityLevel: 2, uastcLDRQualityLevel: 1 },
  'uastc-rdo-0': { isUASTC: true, needSupercompression: true, enableRDO: true, rdoQualityLevel: 3, uastcLDRQualityLevel: 0 },
  uastc: { isUASTC: true, needSupercompression: true, enableRDO: false, uastcLDRQualityLevel: 2 },
}

export async function encodeKtx2(buffer, { srgb, normal, mode }) {
  const sharp = (await import('sharp')).default
  encoderPromise ||= import('ktx2-encoder')
  const { encodeToKTX2 } = await encoderPromise
  const flipped = await sharp(buffer).flip().png().toBuffer()
  const imageDecoder = async input => {
    const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) }
  }
  const options = { ...KTX2_MODES[mode], isNormalMap: normal, isPerceptual: srgb, isSetKTX2SRGBTransferFunc: srgb, generateMipmap: true, isKTX2File: true, imageDecoder }
  const log = console.log
  console.log = () => {}
  try { return Buffer.from(await encodeToKTX2(new Uint8Array(flipped), options)) } finally { console.log = log }
}

async function grey(sharp, file, size, fallback) {
  if (!file) return Buffer.alloc(size * size, fallback)
  return sharp(file).resize(size, size, { fit: 'fill', kernel: 'lanczos3' }).toColourspace('b-w').extractChannel(0).raw().toBuffer()
}

async function material(entry, source, out, options) {
  const sharp = (await import('sharp')).default
  const list = (await files(source)).filter(file => !/preview|thumb|sphere|swatch/i.test(path.basename(file)))
  const arm = pick(list, MAPS.arm)
  const maps = { color: pick(list, MAPS.color), normal: pick(list, MAPS.normalGL), normalDX: pick(list, MAPS.normalDX), roughness: pick(list, MAPS.roughness), ao: pick(list, MAPS.ao), metalness: pick(list, MAPS.metalness), opacity: pick(list, MAPS.opacity) }
  if (!maps.color) throw new Error(`${entry.id}: no colour map found`)
  if (!maps.normal && !maps.normalDX) throw new Error(`${entry.id}: no normal map found`)
  const outputs = []
  for (const size of options.sizes ?? [1024, 512]) {
    const tier = path.join(out, size >= 1024 ? '1k' : String(size))
    await mkdir(tier, { recursive: true })
    const resize = image => image.resize(size, size, { fit: 'fill', kernel: 'lanczos3' })
    let colour = resize(sharp(maps.color)).removeAlpha()
    if (maps.opacity) colour = colour.joinChannel(await grey(sharp, maps.opacity, size, 255), { raw: { width: size, height: size, channels: 1 } })
    const colourPng = await colour.png().toBuffer()
    let normal = resize(sharp(maps.normal ?? maps.normalDX)).removeAlpha()
    if (!maps.normal) {
      const { data, info } = await normal.raw().toBuffer({ resolveWithObject: true })
      for (let i = 1; i < data.length; i += info.channels) data[i] = 255 - data[i]
      normal = sharp(data, { raw: { width: size, height: size, channels: info.channels } })
    }
    const normalPng = await normal.png().toBuffer()
    let orm
    if (arm) orm = await resize(sharp(arm)).removeAlpha().raw().toBuffer()
    else {
      const [ao, rough, metal] = await Promise.all([grey(sharp, maps.ao, size, 255), grey(sharp, maps.roughness, size, 200), grey(sharp, maps.metalness, size, 0)])
      orm = Buffer.alloc(size * size * 3)
      for (let i = 0; i < size * size; i++) { orm[i * 3] = ao[i]; orm[i * 3 + 1] = rough[i]; orm[i * 3 + 2] = metal[i] }
    }
    const ormPng = await sharp(orm, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer()
    const write = async (name, data) => { await writeFile(path.join(tier, name), data); outputs.push(path.join(tier, name)) }
    const limit = (BUDGETS.material.bytes * (size >= 1024 ? 1 : 0.3))
    let quality = [82, 90, 85]
    let encoded
    for (let step = 0; step < 6; step++) {
      encoded = await Promise.all([sharp(colourPng).webp({ quality: quality[0], effort: 6, alphaQuality: 90 }).toBuffer(), sharp(normalPng).webp({ quality: quality[1], effort: 6 }).toBuffer(), sharp(ormPng).webp({ quality: quality[2], effort: 6 }).toBuffer()])
      if (encoded.reduce((sum, buffer) => sum + buffer.length, 0) <= limit) break
      quality = quality.map(q => Math.max(60, q - 5))
    }
    await write('c.webp', encoded[0])
    await write('n.webp', encoded[1])
    await write('orm.webp', encoded[2])
    if (options.ktx2 !== false) {
      await write('c.ktx2', await encodeKtx2(colourPng, { srgb: true, normal: false, mode: 'etc1s-160' }))
      await write('n.ktx2', await encodeKtx2(normalPng, { srgb: false, normal: true, mode: 'uastc-rdo-1' }))
      await write('orm.ktx2', await encodeKtx2(ormPng, { srgb: false, normal: false, mode: 'uastc-rdo-0' }))
    }
  }
  return { outputs, ship: ['1k/c.webp', '1k/n.webp', '1k/orm.webp'], meta: { maps: Object.fromEntries(Object.entries(maps).filter(([, v]) => v).map(([k, v]) => [k, path.basename(v)])), packed: arm ? 'arm' : 'orm' } }
}

function readHDR(buffer) {
  let offset = 0
  const line = () => { let s = ''; while (offset < buffer.length && buffer[offset] !== 0x0a) s += String.fromCharCode(buffer[offset++]); offset++; return s }
  if (!line().startsWith('#?')) throw new Error('Not a Radiance HDR file')
  let header
  while ((header = line()) !== '') if (header.startsWith('FORMAT') && !header.includes('32-bit_rle_rgbe')) throw new Error('Unsupported HDR format')
  const size = /-Y (\d+) \+X (\d+)/.exec(line())
  if (!size) throw new Error('Unsupported HDR orientation')
  const height = Number(size[1]), width = Number(size[2])
  const pixels = new Float32Array(width * height * 3)
  const scan = new Uint8Array(width * 4)
  for (let y = 0; y < height; y++) {
    if (buffer[offset] === 2 && buffer[offset + 1] === 2 && ((buffer[offset + 2] << 8) | buffer[offset + 3]) === width) {
      offset += 4
      for (let c = 0; c < 4; c++) {
        let x = 0
        while (x < width) {
          let count = buffer[offset++]
          if (count > 128) { count -= 128; const value = buffer[offset++]; for (let i = 0; i < count; i++) scan[(x++) * 4 + c] = value }
          else for (let i = 0; i < count; i++) scan[(x++) * 4 + c] = buffer[offset++]
        }
      }
    } else { for (let i = 0; i < width * 4; i++) scan[i] = buffer[offset++] }
    for (let x = 0; x < width; x++) {
      const e = scan[x * 4 + 3]
      const f = e ? Math.pow(2, e - 136) : 0
      const p = (y * width + x) * 3
      pixels[p] = scan[x * 4] * f; pixels[p + 1] = scan[x * 4 + 1] * f; pixels[p + 2] = scan[x * 4 + 2] * f
    }
  }
  return { width, height, pixels }
}

function downsample(image, width) {
  const factor = image.width / width
  const height = Math.round(image.height / factor)
  const pixels = new Float32Array(width * height * 3)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let r = 0, g = 0, b = 0, n = 0
    const x0 = Math.floor(x * factor), x1 = Math.max(x0 + 1, Math.floor((x + 1) * factor))
    const y0 = Math.floor(y * factor), y1 = Math.max(y0 + 1, Math.floor((y + 1) * factor))
    for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) { const p = (sy * image.width + sx) * 3; r += image.pixels[p]; g += image.pixels[p + 1]; b += image.pixels[p + 2]; n++ }
    const p = (y * width + x) * 3
    pixels[p] = r / n; pixels[p + 1] = g / n; pixels[p + 2] = b / n
  }
  return { width, height, pixels }
}

function writeHDR(image) {
  const header = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${image.height} +X ${image.width}\n`, 'ascii')
  const chunks = [header]
  const scan = new Uint8Array(image.width * 4)
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const p = (y * image.width + x) * 3
      const r = image.pixels[p], g = image.pixels[p + 1], b = image.pixels[p + 2]
      const m = Math.max(r, g, b)
      if (m < 1e-32) { scan.fill(0, x * 4, x * 4 + 4); continue }
      const e = Math.ceil(Math.log2(m) + 1e-9)
      const scale = 256 / Math.pow(2, e)
      scan[x * 4] = Math.min(255, r * scale); scan[x * 4 + 1] = Math.min(255, g * scale); scan[x * 4 + 2] = Math.min(255, b * scale); scan[x * 4 + 3] = e + 128
    }
    const line = [2, 2, image.width >> 8, image.width & 255]
    for (let c = 0; c < 4; c++) {
      let x = 0
      while (x < image.width) {
        let run = 1
        while (x + run < image.width && run < 127 && scan[(x + run) * 4 + c] === scan[x * 4 + c]) run++
        if (run > 2) { line.push(128 + run, scan[x * 4 + c]); x += run; continue }
        const start = x
        while (x < image.width && x - start < 128 && !(x + 2 < image.width && scan[x * 4 + c] === scan[(x + 1) * 4 + c] && scan[x * 4 + c] === scan[(x + 2) * 4 + c])) x++
        line.push(x - start)
        for (let i = start; i < x; i++) line.push(scan[i * 4 + c])
      }
    }
    chunks.push(Buffer.from(line))
  }
  return Buffer.concat(chunks)
}

function display(image, exposure) {
  const out = Buffer.alloc(image.width * image.height * 3)
  const curve = v => { const x = v * exposure; const t = x / (1 + x); return Math.round(255 * Math.min(1, t <= 0.0031308 ? 12.92 * t : 1.055 * Math.pow(t, 1 / 2.4) - 0.055)) }
  for (let i = 0; i < image.pixels.length; i++) out[i] = curve(image.pixels[i])
  return out
}

function median(image) {
  const values = []
  for (let i = 0; i < image.pixels.length; i += 3 * 97) values.push(0.2126 * image.pixels[i] + 0.7152 * image.pixels[i + 1] + 0.0722 * image.pixels[i + 2])
  values.sort((a, b) => a - b)
  return values[Math.floor(values.length * 0.6)] || 1
}

async function hdri(entry, source, out) {
  const sharp = (await import('sharp')).default
  const file = (await files(source)).find(name => /\.hdr$/i.test(name))
  if (!file) throw new Error(`${entry.id}: no .hdr file found`)
  const full = readHDR(await readFile(file))
  await mkdir(out, { recursive: true })
  const sky = downsample(full, Math.min(2048, full.width))
  const env = downsample(full, 512)
  const exposure = 0.9 / median(sky)
  const outputs = [path.join(out, 'sky.webp'), path.join(out, 'env.hdr'), path.join(out, 'preview.webp')]
  await writeFile(outputs[0], await sharp(display(sky, exposure), { raw: { width: sky.width, height: sky.height, channels: 3 } }).webp({ quality: 84, effort: 6 }).toBuffer())
  await writeFile(outputs[1], writeHDR(env))
  await writeFile(outputs[2], await sharp(display(sky, exposure), { raw: { width: sky.width, height: sky.height, channels: 3 } }).resize(512).webp({ quality: 80 }).toBuffer())
  return { outputs, ship: ['sky.webp', 'env.hdr'], meta: { source: path.basename(file), width: full.width, height: full.height, exposure: Number(exposure.toFixed(4)) } }
}

async function model(entry, source, out, options) {
  const [{ Logger, NodeIO }, { ALL_EXTENSIONS, EXTTextureWebP }, functions, { MeshoptDecoder, MeshoptEncoder }, sharp] = await Promise.all([
    import('@gltf-transform/core'), import('@gltf-transform/extensions'), import('@gltf-transform/functions'), import('meshoptimizer'), import('sharp').then(m => m.default),
  ])
  await MeshoptEncoder.ready
  await MeshoptDecoder.ready
  const wanted = options.file ? new RegExp(options.file, 'i') : /./
  const list = (await files(source)).filter(file => wanted.test(file.replaceAll('\\', '/')))
  let input = list.find(file => /\.glb$/i.test(file)) ?? list.find(file => /\.gltf$/i.test(file))
  const foreign = list.find(file => /\.(blend|fbx|obj)$/i.test(file))
  let converted
  if (!input && foreign) {
    converted = input = path.join(path.dirname(out), `.${entry.id}.convert.glb`)
    const kind = path.extname(foreign).slice(1).toLowerCase()
    const load = kind === 'blend' ? 'bpy.ops.wm.open_mainfile(filepath=src)' : kind === 'fbx' ? "bpy.ops.wm.read_factory_settings(use_empty=True)\nbpy.ops.import_scene.fbx(filepath=src)" : "bpy.ops.wm.read_factory_settings(use_empty=True)\nbpy.ops.wm.obj_import(filepath=src)"
    const script = `import bpy,sys,os\nroot,src,dst=sys.argv[-3],sys.argv[-2],sys.argv[-1]\n${load}\nfound={}\nfor d,_,names in os.walk(root):\n    for n in names: found.setdefault(n.lower(),os.path.join(d,n))\nfor image in bpy.data.images:\n    if image.source=='FILE' and not image.packed_file:\n        name=os.path.basename(image.filepath.replace('\\\\','/')).lower()\n        if not image.has_data and name in found:\n            image.filepath=found[name]\n            image.reload()\n        if image.has_data: image.pack()\nbpy.ops.export_scene.gltf(filepath=dst,export_format='GLB',export_apply=True,export_yup=True,export_image_format='AUTO',use_visible=True)\n`
    const result = spawnSync('blender', ['-b', '--factory-startup', '--python-expr', script, '--', source, foreign, input], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    if (result.status !== 0 || !existsSync(input)) throw new Error(`${entry.id}: converting ${path.basename(foreign)} needs Blender on PATH (${(result.stderr || result.error?.message || '').trim().split('\n').pop()})`)
  }
  if (!input) throw new Error(`${entry.id}: no glTF, GLB, FBX, OBJ or .blend found`)
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })
  const document = await io.read(input)
  document.setLogger(new Logger(Logger.Verbosity.WARN))
  if (options.animations) {
    const keep = new RegExp(options.animations, 'i')
    for (const animation of document.getRoot().listAnimations()) if (!keep.test(animation.getName())) animation.dispose()
    if (!document.getRoot().listAnimations().length) throw new Error(`${entry.id}: no animations match ${options.animations}`)
  }
  const nodes = document.getRoot().listNodes()
  if (nodes.some(node => /lod0?$|lod_?0\b/i.test(node.getName()))) for (const node of nodes) if (/lod_?[1-9]\b|lod[1-9]$/i.test(node.getName())) node.dispose()
  const skinned = document.getRoot().listSkins().length > 0
  const scene = document.getRoot().listScenes()[0]
  let rescaled
  if (options.dimensions && !skinned) {
    const before = functions.getBounds(scene)
    const factor = options.dimensions[2] / (before.max[1] - before.min[1])
    if (Math.abs(factor - 1) > 0.05) {
      rescaled = Number(factor.toFixed(4))
      for (const node of scene.listChildren()) { node.setScale(node.getScale().map(v => v * factor)); node.setTranslation(node.getTranslation().map(v => v * factor)) }
    }
  }
  const steps = [functions.dedup(), functions.prune(), functions.weld()]
  if (document.getRoot().listAnimations().length) steps.push(functions.resample())
  if (options.simplify && !document.getRoot().listSkins().length) steps.push(functions.simplify({ simplifier: (await import('meshoptimizer')).MeshoptSimplifier, ratio: options.simplify, error: 0.001 }))
  steps.push(functions.textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [options.textureSize ?? 1024, options.textureSize ?? 1024], quality: 85, effort: 6 }))
  steps.push(functions.meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
  await document.transform(...steps)
  if (document.getRoot().listTextures().length) document.createExtension(EXTTextureWebP).setRequired(true)
  let triangles = 0
  for (const mesh of document.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const indices = prim.getIndices()
    const position = prim.getAttribute('POSITION')
    if (prim.getMode() === 4) triangles += (indices ? indices.getCount() : position?.getCount() ?? 0) / 3
  }
  const bounds = functions.getBounds(scene)
  await mkdir(out, { recursive: true })
  const target = path.join(out, 'model.glb')
  await io.write(target, document)
  if (converted) await rm(converted, { force: true })
  const animations = document.getRoot().listAnimations().map(animation => animation.getName())
  const extent = bounds.max.map((v, i) => Number((v - bounds.min[i]).toFixed(3)))
  const size = skinned || !extent.every(Number.isFinite) ? undefined : extent
  return { outputs: [target], ship: ['model.glb'], meta: { triangles: Math.round(triangles), size, ...(rescaled ? { rescaled } : {}), animations: animations.length ? animations : undefined, skinned } }
}

async function audio(entry, source, out) {
  const list = (await files(source)).filter(file => /\.(wav|flac|ogg|oga|mp3|aiff?|m4a|opus)$/i.test(file) && !/(?:^|\/)(?:__MACOSX|\._)/.test(path.relative(source, file))).sort()
  if (!list.length) throw new Error(`${entry.id}: no audio files found`)
  const kind = entry.category
  const pattern = entry.process?.take ? new RegExp(entry.process.take, 'i') : undefined
  const take = pattern ? list.filter(file => pattern.test(path.basename(file)) || pattern.test(path.relative(source, file).replaceAll(path.sep, '/'))) : list
  if (!take.length) throw new Error(`${entry.id}: no audio files match the take filter`)
  const limit = entry.process?.limit ?? (kind === 'ambience' || kind === 'ir' ? 1 : 12)
  const regions = entry.process?.regions ?? (entry.process?.split ? onsets(take[0], entry.process) : undefined)
  const sourceDuration = regions ? probe(take[0]).duration : undefined
  if (regions && (!Array.isArray(regions) || regions.some(region => !Array.isArray(region) || region.length !== 2 || !region.every(Number.isFinite) || region[0] < 0 || region[1] <= 0 || region[0] + region[1] > sourceDuration))) throw new Error(`${entry.id}: audio regions must contain valid [start, length] pairs within the source`)
  const chosen = regions ? regions.slice(0, limit).map(([start, length]) => ({ file: take[0], start, length })) : take.slice(0, limit).map(file => ({ file }))
  if (!chosen.length) throw new Error(`${entry.id}: no audio takes were detected`)
  await mkdir(out, { recursive: true })
  const outputs = []
  const variations = []
  const stereo = kind === 'ambience' || kind === 'ir'
  const bitrate = kind === 'ambience' ? 96 : kind === 'ir' ? 128 : 64
  for (const [index, item] of chosen.entries()) {
    const file = item.file
    const info = probe(file)
    const base = chosen.length > 1 ? String(index + 1).padStart(2, '0') : 'clip'
    const channels = stereo ? String(Math.min(2, info.channels)) : '1'
    const filters = [`aformat=sample_fmts=fltp:channel_layouts=${channels === '2' ? 'stereo' : 'mono'}`, 'aresample=48000']
    const start = item.start ?? entry.process?.start ?? 0
    const length = item.length ?? entry.process?.length ?? (kind === 'ambience' ? Math.min(info.duration - start, 90) : kind === 'ir' ? Math.min(info.duration, 4) : Math.min(info.duration - start, 4))
    if ((kind === 'sound' || kind === 'footstep') && item.start === undefined) filters.push(`silenceremove=start_periods=1:start_threshold=${entry.process?.trimThreshold ?? -50}dB:start_silence=0.004`)
    if (entry.process?.highpass) filters.push(`highpass=f=${entry.process.highpass}`)
    filters.push(`atrim=0:${length.toFixed(3)}`)
    if (kind === 'ambience') filters.push(`afade=t=in:d=0.05,afade=t=out:st=${Math.max(0, length - 0.05).toFixed(3)}:d=0.05`)
    else filters.push(`afade=t=out:st=${Math.max(0, length - Math.min(0.25, length * 0.2)).toFixed(3)}:d=${Math.min(0.25, length * 0.2).toFixed(3)}`)
    if (kind === 'ambience') filters.push('loudnorm=I=-26:TP=-2:LRA=11')
    else {
      const max = peak(file, filters.join(','), start)
      const target = kind === 'ir' ? -6 : -1
      filters.push(`volume=${(target - max).toFixed(2)}dB`)
    }
    const chain = filters.join(',')
    const opus = path.join(out, `${base}.ogg`)
    const aac = path.join(out, `${base}.m4a`)
    let encodedPeak
    let correction = 0
    for (let attempt = 0; attempt < 4; attempt++) {
      const corrected = correction ? `${chain},volume=${correction.toFixed(3)}dB` : chain
      ffmpeg(['-ss', String(start), '-i', file, '-af', corrected, '-ac', channels, '-ar', '48000', '-c:a', 'libopus', '-b:a', `${bitrate}k`, '-vbr', 'on', opus])
      ffmpeg(['-ss', String(start), '-i', file, '-af', corrected, '-ac', channels, '-ar', '48000', '-c:a', process.platform === 'darwin' ? 'aac_at' : 'aac', '-b:a', `${Math.round(bitrate * 1.5)}k`, aac])
      if (kind === 'ambience') break
      encodedPeak = Math.max(peak(opus), peak(aac))
      const ceiling = kind === 'ir' ? -6 : -1
      if (encodedPeak <= ceiling) break
      correction -= encodedPeak - ceiling + 0.2
      if (attempt === 3) throw new Error(`${entry.id}: encoded audio peak ${encodedPeak.toFixed(2)} dB exceeds ${ceiling} dB`)
    }
    outputs.push(opus, aac)
    variations.push({ file: `${base}.ogg`, fallback: `${base}.m4a`, seconds: Number(probe(opus).duration.toFixed(3)), source: path.basename(file), ...(item.start !== undefined ? { at: Number(item.start.toFixed(3)) } : {}), ...(encodedPeak === undefined ? {} : { peakDb: Number(encodedPeak.toFixed(2)) }) })
  }
  return { outputs, ship: variations.map(v => v.file), meta: { variations, channels: stereo ? 2 : 1 } }
}

function onsets(file, options) {
  const threshold = options.threshold ?? -32
  const result = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', `highpass=f=60,silencedetect=noise=${threshold}dB:d=${options.gap ?? 0.06}`, '-f', 'null', '-'], { encoding: 'utf8' })
  const duration = probe(file).duration
  const starts = [...result.stderr.matchAll(/silence_end: ([\d.]+)/g)].map(m => Number(m[1]))
  const ends = [...result.stderr.matchAll(/silence_start: ([\d.]+)/g)].map(m => Number(m[1]))
  if (!(ends[0] < 0.005)) starts.unshift(0)
  const max = options.maxLength ?? 1.2
  const takes = []
  for (const start of starts) {
    const end = Math.min(ends.find(e => e > start + 0.02) ?? duration, starts.find(s => s > start + 0.02) ?? duration, start + max)
    const pre = Math.max(0, start - 0.012)
    if (end - start >= (options.minLength ?? 0.07)) takes.push([pre, Math.min(max, duration - pre, end - pre + 0.08)])
  }
  return takes
}

async function terrain(entry, source, out) {
  const sharp = (await import('sharp')).default
  const file = (await files(source)).find(name => /\.(tiff?|png)$/i.test(name))
  if (!file) throw new Error(`${entry.id}: no GeoTIFF or PNG heightmap found`)
  const size = entry.process?.size ?? 1025
  const crop = entry.process?.crop
  let image = sharp(file, { limitInputPixels: false, unlimited: true })
  if (crop) image = image.extract(crop)
  const { data, info } = await image.resize(size, size, { fit: 'fill', kernel: 'cubic' }).raw({ depth: 'float' }).toBuffer({ resolveWithObject: true })
  const values = new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4)
  let min = Infinity, max = -Infinity
  for (let i = 0; i < size * size; i++) { const v = values[i * info.channels]; if (v > -1000) { min = Math.min(min, v); max = Math.max(max, v) } }
  const height = new Uint16Array(size * size)
  for (let i = 0; i < size * size; i++) { const v = Math.max(min, values[i * info.channels]); height[i] = Math.round(((v - min) / (max - min || 1)) * 65535) }
  await mkdir(out, { recursive: true })
  const png = path.join(out, 'height.png')
  await sharp(height, { raw: { width: size, height: size, channels: 1, premultiplied: false } }).toColourspace('grey16').png({ compressionLevel: 9 }).toFile(png)
  const meta = { size, minMetres: Number(min.toFixed(2)), maxMetres: Number(max.toFixed(2)), metresPerPixel: entry.process?.metresPerPixel }
  await writeFile(path.join(out, 'height.json'), JSON.stringify(meta, null, 2))
  return { outputs: [png, path.join(out, 'height.json')], ship: ['height.png', 'height.json'], meta }
}

export async function processAsset(entry, source, out, options = {}) {
  await rm(out, { recursive: true, force: true })
  await mkdir(out, { recursive: true })
  const kind = entry.category
  const result = kind === 'material' ? await material(entry, source, out, { ...options, ...entry.process })
    : kind === 'hdri' ? await hdri(entry, source, out)
      : ['prop', 'foliage', 'weapon', 'character', 'animation'].includes(kind) ? await model(entry, source, out, { ...options, ...entry.process })
        : ['sound', 'footstep', 'ambience', 'ir'].includes(kind) ? await audio(entry, source, out)
          : kind === 'terrain' ? await terrain(entry, source, out)
            : null
  if (!result) throw new Error(`${entry.id}: unknown category ${kind}`)
  const sizes = {}
  for (const file of result.outputs) sizes[path.relative(out, file).replaceAll('\\', '/')] = (await stat(file)).size
  const budget = BUDGETS[kind]
  const perItem = ['sound', 'footstep'].includes(kind)
  const shipped = result.ship.map(name => sizes[name] ?? 0)
  const bytes = perItem ? Math.max(...shipped) : shipped.reduce((a, b) => a + b, 0)
  const over = []
  if (bytes > budget.bytes) over.push(`${bytes} B > ${budget.bytes} B`)
  if (budget.triangles && result.meta.triangles > budget.triangles) over.push(`${result.meta.triangles} triangles > ${budget.triangles}`)
  const ktx2Bytes = Object.entries(sizes).filter(([name]) => name.startsWith('1k/') && name.endsWith('.ktx2')).reduce((sum, [, size]) => sum + size, 0)
  const manifest = { id: entry.id, category: kind, ship: result.ship, files: sizes, bytes, ...(ktx2Bytes ? { ktx2Bytes } : {}), budget: budget.bytes, withinBudget: over.length === 0, over, ...result.meta }
  await writeFile(path.join(out, 'asset.json'), JSON.stringify(manifest, null, 2))
  return manifest
}
