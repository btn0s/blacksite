import { writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { lintTriangles, summarizeLint } from '../packages/check/src/zfight/lint.mjs'
import { readGltfSoup } from '../packages/check/src/zfight/gltf.mjs'

export async function runLint(argv) {
  const value = name => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined }
  const number = name => value(name) === undefined ? undefined : Number(value(name))
  const target = argv.find((item, index) => !item.startsWith('--') && !argv[index - 1]?.startsWith('--'))
  if (!target || argv.includes('--help')) {
    process.stdout.write('blacksite lint <built-dir|url|model.glb> [--page frames/game.html] [--profile desktop|phone] [--near m] [--far m] [--bits 24] [--float] [--reversed] [--safety 2] [--distance m] [--out report.json] [--json]\n')
    return
  }
  const depth = { near: number('--near'), far: number('--far'), bits: number('--bits'), float: argv.includes('--float') ? true : undefined, reversed: argv.includes('--reversed') ? true : undefined }
  const settings = { ...Object.fromEntries(Object.entries(depth).filter(([, item]) => item !== undefined)), safety: number('--safety'), distance: number('--distance'), minPixels: number('--min-pixels') }
  for (const key of Object.keys(settings)) if (settings[key] === undefined) delete settings[key]
  const json = argv.includes('--json')
  let report
  if (!/^https?:\/\//.test(target) && /\.(glb|gltf)$/i.test(target)) {
    if (!existsSync(target)) throw new Error(`No such file: ${target}`)
    report = lintTriangles(await readGltfSoup(target), { ...settings, near: settings.near ?? 0.1, far: settings.far ?? 300, distance: settings.distance ?? 20 })
    report.url = path.resolve(target)
  } else {
    const { lintPage } = await import('../packages/check/src/zfight/page-lint.mjs')
    report = await lintPage({ target, page: value('--page'), profile: value('--profile') ?? 'desktop', options: { lint: settings }, log: json ? undefined : line => process.stderr.write(`${line}\n`) })
  }
  if (value('--out')) await writeFile(value('--out'), `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(json ? `${JSON.stringify(report)}\n` : `${summarizeLint(report)}\n`)
  if (!report.pass) process.exitCode = 1
}
