import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'

const base = process.argv[2] ?? 'http://localhost:5244/frames/materials.html'
const output = resolve(process.argv[3] ?? '/tmp/blacksite-materials-captures')
const ids = process.argv.slice(4)
const materials = ids.length ? ids : ['poured-concrete', 'precast-panel', 'plaster-paint', 'brick', 'corrugated-rust', 'painted-metal', 'wet-tile', 'asphalt', 'gravel-soil', 'bark', 'wood-planks']
const session = process.env.MATERIALS_BROWSER_SESSION ?? 'materials-review'
const browser = (...args) => execFileSync('agent-browser', ['--session', session, ...args], { encoding: 'utf8', timeout: 90000 }).trim()
mkdirSync(output, { recursive: true })
browser('--headed', 'false', '--args', '--enable-gpu,--enable-unsafe-webgpu', 'open', base)
browser('set', 'viewport', '1440', '900')
const records = []
for (const id of materials) {
  for (const source of ['graph', 'image']) {
    const url = new URL(base)
    url.search = new URLSearchParams({ m: id, a: source, b: 'scan', res: '1024', ui: '0', layout: 'split' }).toString()
    browser('console', '--clear')
    browser('errors', '--clear')
    browser('open', url.href)
    browser('wait', '--fn', 'window.__materials?.ready || window.__materials?.error', '--timeout', '45000')
    const state = JSON.parse(browser('eval', 'window.__materials'))
    if (!state.ready || state.error) throw new Error(`${id}/${source}: ${state.error || 'not ready'}`)
    const errors = browser('errors')
    const consoleOutput = browser('console')
    if (errors || /\[error\]/i.test(consoleOutput)) throw new Error(`${id}/${source}: ${errors}\n${consoleOutput}`)
    const stem = `${id}-${source}`
    const full = resolve(output, `${stem}-1x.png`)
    browser('screenshot', full)
    const crops = await Promise.all([400, 960].map(left => sharp(full).extract({ left, top: 300, width: 160, height: 128 }).resize(640, 512, { kernel: 'nearest' }).png().toBuffer()))
    await sharp({ create: { width: 1280, height: 512, channels: 3, background: '#000000' } }).composite(crops.map((input, i) => ({ input, top: 0, left: i * 640 }))).png().toFile(resolve(output, `${stem}-4x.png`))
    records.push({ id, source, url: url.href, ...state, console: consoleOutput })
    console.log(`${stem}: ${Math.round(state.ms.a)} ms, ${state.textures} GPU textures, captured 1× and 4×`)
  }
}
writeFileSync(resolve(output, 'capture-results.json'), JSON.stringify(records, null, 2) + '\n')
