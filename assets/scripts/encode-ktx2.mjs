import { readFile, readdir, writeFile, mkdir, rm, mkdtemp } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { encodeKtx2 } from './process.mjs'

const CANDIDATES = ['uastc-rdo', 'uastc']

function hasKtxTool() {
  return spawnSync('ktx', ['--version'], { encoding: 'utf8' }).status === 0
}

async function decode(ktx2, scratch) {
  const input = path.join(scratch, 'probe.ktx2')
  const output = path.join(scratch, 'probe.png')
  await writeFile(input, ktx2)
  await rm(output, { force: true })
  const result = spawnSync('ktx', ['extract', '--transcode', 'rgba8', '--level', '0', input, output], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`ktx extract failed: ${result.stderr}`)
  return sharp(await readFile(output)).flip().ensureAlpha().raw().toBuffer()
}

function psnr(a, b, alpha) {
  let sum = 0
  let count = 0
  for (let i = 0; i < a.length; i++) {
    if (!alpha && i % 4 === 3) continue
    const d = a[i] - b[i]
    sum += d * d
    count++
  }
  return sum === 0 ? 99 : 10 * Math.log10((255 * 255) / (sum / count))
}

export async function encodeDirectory(source, out, options = {}) {
  const threshold = options.threshold ?? 42
  const normalPattern = options.normal ?? /_n\.[a-z]+$/i
  const verify = options.verify ?? hasKtxTool()
  const scratch = await mkdtemp(path.join(tmpdir(), 'blacksite-ktx2-'))
  await mkdir(out, { recursive: true })
  const files = (await readdir(source)).filter(name => /\.(?:webp|png|jpe?g)$/i.test(name)).sort()
  const results = []
  try {
    for (const name of files) {
      const input = await readFile(path.join(source, name))
      const meta = await sharp(input).metadata()
      const normal = normalPattern.test(name)
      const alpha = Boolean(meta.hasAlpha)
      const png = await sharp(input).png().toBuffer()
      const reference = await sharp(input).ensureAlpha().raw().toBuffer()
      let chosen
      for (const mode of verify ? CANDIDATES : ['uastc']) {
        const data = await encodeKtx2(png, { srgb: !normal, normal, mode })
        const quality = verify ? psnr(await decode(data, scratch), reference, alpha) : undefined
        chosen = { mode, data, quality }
        if (!verify || quality >= threshold) break
      }
      const target = name.replace(/\.[a-z]+$/i, '.ktx2')
      await writeFile(path.join(out, target), chosen.data)
      const row = { file: target, source: name, width: meta.width, height: meta.height, mode: chosen.mode, bytes: chosen.data.length, sourceBytes: input.length, ...(chosen.quality === undefined ? {} : { psnr: Number(chosen.quality.toFixed(1)), withinThreshold: chosen.quality >= threshold }) }
      results.push(row)
      options.log?.(`${target}: ${row.mode}, ${Math.round(row.bytes / 1024)} KB${row.psnr === undefined ? '' : `, ${row.psnr} dB${row.withinThreshold ? '' : ' BELOW QUALITY THRESHOLD'}`}`)
    }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
  return { threshold, verified: verify, withinThreshold: verify ? results.every(row => row.withinThreshold) : null, files: results }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const value = flag => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined }
  const source = args[0]
  if (!source) { process.stderr.write('Usage: node assets/scripts/encode-ktx2.mjs <dir> [--out <dir>] [--threshold 42] [--report <file>]\n'); process.exit(1) }
  const out = value('--out') ?? source
  const report = await encodeDirectory(path.resolve(source), path.resolve(out), { threshold: value('--threshold') ? Number(value('--threshold')) : undefined, log: line => process.stdout.write(`${line}\n`) })
  if (!report.verified) process.stdout.write('ktx tool not found: encoded everything as UASTC without a quality check\n')
  if (value('--report')) await writeFile(path.resolve(value('--report')), JSON.stringify(report, null, 2) + '\n')
}
