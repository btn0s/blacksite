import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { autoQuality, createLook, applyStochasticTiling, type QualityTier } from '@blacksite/look'
import { internalPixelRatio, meterSurface, releaseSurface, worldBoxGeometry } from '@blacksite/look/world'
import { compile, createGpuEvaluator, liveMaterial, loadBakedSurface, disposeSurfaceSource, autoResolution, type BakedMaterial, type GpuEvaluator, type MaterialGraph, type Weather } from '../src'
import scanManifest from '../scans/scans.json'

type SourceKind = 'graph' | 'image' | 'scan' | 'baked' | 'baked-image'
type Scan = { id: string; assetId: string; url: string; author: string; licence: string; size: number[]; sizeEstimated?: boolean; creationMethod: string; maps: string[] }
type SideKey = 'a' | 'b'

const graphs = import.meta.glob<MaterialGraph>('../library/*.json', { eager: true, import: 'default' })
const imageUrls = import.meta.glob<string>('../images/*.webp', { eager: true, query: '?url', import: 'default' })
const scanUrls = import.meta.glob<string>('../scans/*/*.webp', { eager: true, query: '?url', import: 'default' })
const bakedModules = import.meta.glob<BakedMaterial>('../baked/*/index.ts', { import: 'default' })

const ORDER = ['poured-concrete', 'precast-panel', 'plaster-paint', 'brick', 'corrugated-rust', 'painted-metal', 'wet-tile', 'asphalt', 'gravel-soil', 'bark', 'wood-planks']
const ROTATED_SCANS = new Set(['corrugated-rust', 'wood-planks'])
const STOCHASTIC_MATERIALS = new Set(['plaster-paint', 'asphalt', 'gravel-soil', 'bark'])
const WEATHER_KEYS = ['age', 'dirt', 'moisture', 'puddles', 'rust', 'wear', 'chips', 'bullets', 'scorch'] as const
type WeatherKey = (typeof WEATHER_KEYS)[number]

const graphOf = (id: string, kind: 'graph' | 'image') => graphs[`../library/${kind === 'image' ? `${id}-image` : id}.json`]
const scans = scanManifest as Scan[]
const scanOf = (id: string) => scans.find(scan => scan.id === id)
const bakedOf = (id: string, kind: 'graph' | 'image') => bakedModules[`../baked/${kind === 'image' ? `${id}-image` : id}/index.ts`]
const ids = ORDER.filter(id => graphOf(id, 'graph'))

const params = new URLSearchParams(location.search)
const portrait = innerHeight > innerWidth
const state = {
  id: ids.includes(params.get('m') ?? '') ? params.get('m')! : ids[0]!,
  sources: { a: (params.get('a') ?? 'scan') as SourceKind, b: (params.get('b') ?? 'graph') as SourceKind },
  layout: (params.get('layout') ?? (portrait ? 'single' : 'split')) as 'split' | 'single',
  active: (params.get('show') ?? 'a') as SideKey,
  view: params.get('view') ?? 'wide',
  res: params.get('res') === '512' ? 512 : params.get('res') === '1024' ? 1024 : autoResolution(),
  weatherOn: params.get('weather') !== 'none',
  tiling: params.get('tiling') === 'off' ? 'off' : 'auto',
  overrides: {} as Partial<Record<WeatherKey, number>>,
}
for (const key of WEATHER_KEYS) if (params.has(key)) state.overrides[key] = Number(params.get(key))

const ready = { ready: false, ms: {} as Record<string, number>, error: '', state, textures: 0 }
;(window as unknown as { __materials: typeof ready }).__materials = ready

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
renderer.setPixelRatio(internalPixelRatio())
renderer.setSize(innerWidth, innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 200)
const sun = new THREE.DirectionalLight('#ffffff', 2)
sun.castShadow = true
sun.shadow.mapSize.set(portrait ? 1024 : 2048, portrait ? 1024 : 2048)
Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 100 })
sun.shadow.bias = -0.0004
sun.shadow.normalBias = 0.02
scene.add(sun, sun.target)
const fill = new THREE.HemisphereLight('#ffffff', '#444444', 1)
scene.add(fill)
const quality = (params.get('quality') as QualityTier | null) ?? autoQuality()
const look = createLook(renderer, scene, camera, { atmosphere: 'zone', quality, environment: true, sun, fill })

const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#57554e', roughness: 1 }))
ground.receiveShadow = true
scene.add(ground)

const sphereGeometry = (() => {
  const radius = 0.45
  const geometry = new THREE.SphereGeometry(radius, 96, 48)
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * 2 * radius, uv.getY(i) * Math.PI * radius)
  return geometry
})()
const SHAPES: Array<{ geometry: THREE.BufferGeometry; position: [number, number, number] }> = [
  { geometry: worldBoxGeometry(3.6, 0.08, 3, 1), position: [0, 0.04, 0] },
  { geometry: worldBoxGeometry(3.6, 2.4, 0.2, 1), position: [0, 1.28, -1.4] },
  { geometry: worldBoxGeometry(0.2, 2.4, 1.6, 1), position: [-1.7, 1.28, -0.5] },
  { geometry: worldBoxGeometry(0.7, 0.7, 0.7, 1), position: [0.95, 0.43, 0.25] },
  { geometry: sphereGeometry, position: [-0.45, 0.53, 0.45] },
]

const css = document.createElement('style')
css.textContent = `
html,body{margin:0;height:100%;overflow:hidden;background:#0d0f0c;color:#d8d6cc;font:12px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace}
canvas{display:block;touch-action:none}
.label{position:fixed;top:12px;padding:6px 9px;background:#0d0f0cd0;border:1px solid #ffffff22;max-width:44vw;pointer-events:none}
.label b{color:#f0eee4;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
.label small{display:block;color:#a9a79c;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.label.a{left:12px}.label.b{right:12px;text-align:right}
.panel{position:fixed;left:12px;bottom:12px;padding:9px;background:#0d0f0ce0;border:1px solid #ffffff22;max-height:calc(100vh - 90px);overflow:auto}
.panel summary{cursor:pointer;min-height:24px;line-height:24px}.fields{display:grid;grid-template-columns:auto auto;gap:4px 8px;align-items:center}.panel[open] summary{margin-bottom:6px}
.panel select,.panel button{font:inherit;color:inherit;background:#1b1d18;border:1px solid #ffffff2a;padding:5px;min-height:30px}
.panel input[type=range]{width:120px}
.panel .wide{grid-column:1/3}
.status{position:fixed;right:12px;bottom:12px;padding:6px 9px;background:#0d0f0cd0;border:1px solid #ffffff22;color:#a9a79c}
.error{color:#ff8a7a}
body.noui .panel,body.noui .status{display:none}
body.nolabel .label{display:none}
@media (max-width:640px){.panel{left:8px;right:8px;bottom:8px;max-height:38vh}.fields{grid-template-columns:auto minmax(0,1fr)}.panel input[type=range]{width:100%;min-height:32px}.panel select,.panel button{min-height:40px;max-width:100%}.label{max-width:calc(100vw - 42px)}.status{bottom:63px;font-size:10px;max-width:calc(100vw - 42px)}body:has(.panel[open]) .status{display:none}}
`
document.head.appendChild(css)
if (params.get('ui') === '0') document.body.classList.add('noui')
if (params.get('labels') === '0') document.body.classList.add('nolabel')

class Side {
  readonly group = new THREE.Group()
  readonly meshes: THREE.Mesh[]
  readonly label = document.createElement('div')
  evaluator: GpuEvaluator | null = null
  material: THREE.Material | null = null
  release: (() => void) | null = null
  version = 0

  constructor(readonly key: SideKey) {
    this.meshes = SHAPES.map(shape => {
      const mesh = new THREE.Mesh(shape.geometry, placeholder)
      mesh.position.set(...shape.position)
      mesh.castShadow = mesh.receiveShadow = true
      this.group.add(mesh)
      return mesh
    })
    this.label.className = `label ${key}`
    document.body.appendChild(this.label)
    scene.add(this.group)
  }

  use(material: THREE.MeshStandardMaterial, release: () => void) {
    let tiled: THREE.MeshStandardMaterial | null = null
    let uninstall: (() => void) | null = null
    if (state.tiling === 'auto' && STOCHASTIC_MATERIALS.has(state.id)) {
      tiled = material.clone()
      tiled.onBeforeCompile = material.onBeforeCompile
      tiled.customProgramCacheKey = material.customProgramCacheKey
      try {
        uninstall = applyStochasticTiling(tiled, { seed: 17, tileSpan: 1, blendSharpness: 4 })
      } catch (error) {
        tiled.dispose()
        release()
        throw error
      }
    }
    this.release?.()
    this.release = () => { uninstall?.(); tiled?.dispose(); release() }
    this.material = material
    for (const [index, mesh] of this.meshes.entries()) mesh.material = index < 3 && tiled ? tiled : material
  }

  setLabel(title: string, detail: string) {
    this.label.innerHTML = ''
    const b = document.createElement('b')
    b.textContent = title
    const small = document.createElement('small')
    small.textContent = detail
    this.label.append(b, small)
    this.label.title = detail
  }
}

const placeholder = new THREE.MeshStandardMaterial({ color: '#57554e', roughness: 1 })
const sides = { a: new Side('a'), b: new Side('b') }
const imageTextures = new Map<string, Promise<THREE.Texture>>()
const textureLoader = new THREE.TextureLoader()

function loadImageTexture(url: string) {
  let texture = imageTextures.get(url)
  if (!texture) {
    texture = textureLoader.loadAsync(url).then(t => {
      t.colorSpace = THREE.NoColorSpace
      t.generateMipmaps = false
      t.minFilter = t.magFilter = THREE.NearestFilter
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      return t
    })
    imageTextures.set(url, texture)
  }
  return texture
}

function weatherFor(graph: MaterialGraph): Weather | null {
  if (!state.weatherOn) return null
  const base = graph.weather ?? {}
  const o = state.overrides
  const wear = o.wear === undefined ? base.wear : typeof base.wear === 'object' ? { ...base.wear, amount: o.wear } : o.wear
  const damage = { ...base.damage, ...(o.chips !== undefined && { chips: o.chips }), ...(o.bullets !== undefined && { bullets: o.bullets }), ...(o.scorch !== undefined && { scorch: o.scorch }) }
  return {
    ...base,
    ...(o.age !== undefined && { age: o.age }),
    ...(o.dirt !== undefined && { dirt: o.dirt }),
    ...(o.moisture !== undefined && { moisture: o.moisture }),
    ...(o.puddles !== undefined && { puddles: o.puddles }),
    ...(o.rust !== undefined && { rust: o.rust }),
    ...(wear !== undefined && { wear }),
    damage,
  }
}

function weatherValue(graph: MaterialGraph | undefined, key: WeatherKey) {
  if (state.overrides[key] !== undefined) return state.overrides[key]!
  const weather = graph?.weather ?? {}
  if (key === 'wear') return typeof weather.wear === 'object' ? weather.wear.amount : weather.wear ?? 0
  if (key === 'chips' || key === 'bullets' || key === 'scorch') return weather.damage?.[key] ?? 0
  return weather[key] ?? 0
}

function disposeMaterial(material: THREE.MeshStandardMaterial, textures = true) {
  if (textures) {
    const maps = new Set([material.map, material.normalMap, material.roughnessMap, material.metalnessMap, material.aoMap])
    for (const map of maps) map?.dispose()
  }
  material.dispose()
}

async function scanMaterial(scan: Scan) {
  const rotate = ROTATED_SCANS.has(scan.id)
  const [sx, sy] = [scan.size[0]!, scan.size[1] ?? scan.size[0]!]
  const loaded: THREE.Texture[] = []
  const load = async (map: string, color: boolean) => {
    const url = scanUrls[`../scans/${scan.id}/${map}.webp`]
    if (!url || !scan.maps.includes(`${map}.webp`)) return null
    const texture = await textureLoader.loadAsync(url)
    loaded.push(texture)
    texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
    texture.repeat.set(1 / sx, 1 / sy)
    texture.rotation = rotate ? Math.PI / 2 : 0
    return texture
  }
  const results = await Promise.allSettled([load('color', true), load('normal', false), load('roughness', false), load('ao', false), load('metalness', false)])
  const failure = results.find(result => result.status === 'rejected')
  if (failure?.status === 'rejected') {
    for (const texture of loaded) texture.dispose()
    throw failure.reason
  }
  const [map, normalMap, roughnessMap, aoMap, metalnessMap] = results.map(result => result.status === 'fulfilled' ? result.value : null)
  return new THREE.MeshStandardMaterial({
    name: `scan-${scan.id}`,
    map,
    normalMap,
    roughnessMap,
    aoMap,
    metalnessMap,
    roughness: 1,
    metalness: metalnessMap ? 1 : 0,
    envMapIntensity: 0.55,
  })
}

async function updateSide(side: Side) {
  const version = ++side.version
  const kind = state.sources[side.key]
  const id = state.id
  const start = performance.now()
  if (kind === 'scan') {
    const scan = scanOf(id)
    if (!scan) throw new Error(`No scan reference for ${id}`)
    const material = await scanMaterial(scan)
    if (version !== side.version) { disposeMaterial(material); return }
    side.use(material, () => disposeMaterial(material))
    side.evaluator?.dispose()
    side.evaluator = null
    side.setLabel(`CC0 reference · ${scan.assetId}`, `${scan.creationMethod === 'PBRPhotogrammetry' ? 'photo-scan' : 'photo-derived PBR'} · ${scan.size[0]} × ${scan.size[1] ?? scan.size[0]} m${scan.sizeEstimated ? ' (estimated)' : ''} · ambientCG`)
    ready.ms[side.key] = 0
    return
  }
  if (kind === 'baked' || kind === 'baked-image') {
    const variant = kind === 'baked' ? 'graph' : 'image'
    const module = bakedOf(id, variant)
    if (!module) throw new Error(`No baked ${variant} for ${id}`)
    const baked = await module()
    const source = await loadBakedSurface(baked, { renderer, resolution: state.res })
    const disposeSource = () => {
      releaseSurface(source)
      disposeSurfaceSource(source)
    }
    if (version !== side.version) { disposeSource(); return }
    const material = meterSurface(source, { ao: false })
    side.use(material, () => { disposeMaterial(material); disposeSource() })
    side.evaluator?.dispose()
    side.evaluator = null
    side.setLabel(`baked ${variant} · ${baked.format}`, `${baked.title ?? baked.name} · ${baked.size} m tile · ${state.res}px`)
    ready.ms[side.key] = performance.now() - start
    return
  }
  const graph = graphOf(id, kind)
  if (!graph) throw new Error(`No ${kind} for ${id}`)
  const program = compile(graph, state.res, { weather: weatherFor(graph) })
  const images = new Map<string, THREE.Texture>()
  for (const src of program.images) {
    const url = imageUrls[`../images/${src.split('/').pop()}`]
    if (!url) throw new Error(`${graph.name}: image ${src} is not in packages/materials/images`)
    images.set(src, await loadImageTexture(url))
  }
  if (version !== side.version) return
  side.evaluator ??= createGpuEvaluator(renderer)
  const evalStart = performance.now()
  const result = side.evaluator.evaluate(program, images)
  side.evaluator.readback(program.outputs.color, 0, 0, 1, 1)
  const ms = performance.now() - evalStart
  for (const texture of [result.color, result.normal, result.orm, result.masks]) texture.repeat.set(1 / graph.size, 1 / graph.size)
  const material = liveMaterial(result, side.key)
  side.use(material, () => disposeMaterial(material, false))
  ready.ms[side.key] = ms
  const detail = kind === 'image' && graph.source ? `${graph.source.model} · ${graph.size} m tile · ${state.res}px · ${ms.toFixed(0)} ms` : `${program.steps.length} steps · ${graph.size} m tile · ${state.res}px · ${ms.toFixed(0)} ms`
  side.setLabel(`${kind === 'image' ? 'image graph' : 'graph'} · ${graph.title ?? graph.name}`, detail)
}

function layout() {
  const split = state.layout === 'split'
  sides.a.group.position.x = split ? -1.95 : 0
  sides.b.group.position.x = split ? 1.95 : 0
  sides.a.group.visible = split || state.active === 'a'
  sides.b.group.visible = split || state.active === 'b'
  sides.a.label.style.display = sides.a.group.visible ? '' : 'none'
  sides.b.label.style.display = sides.b.group.visible ? '' : 'none'
  if (!split) sides.b.label.className = 'label a'
  else sides.b.label.className = 'label b'
}

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.maxPolarAngle = Math.PI * 0.49

function setView(view: string) {
  state.view = view
  const split = state.layout === 'split'
  const focus = params.get('focus') === 'b' ? sides.b : split ? null : state.active === 'b' ? sides.b : sides.a
  const cx = focus ? focus.group.position.x : 0
  const narrow = camera.aspect < 1
  camera.fov = narrow ? 70 : 45
  camera.updateProjectionMatrix()
  const views: Record<string, [[number, number, number], [number, number, number]]> = {
    wide: split ? [[0, 1.9, narrow ? 12.5 : 6.2], [0, 0.95, -0.4]] : [[cx + 0.9, 1.75, narrow ? 6.2 : 4.2], [cx - 0.2, 0.95, -0.5]],
    corner: [[cx + 0.2, 1.45, 0.9], [cx - 1.2, 1.15, -1.1]],
    wall: [[cx, 1.3, 0.2], [cx, 1.3, -1.3]],
    detail: [[cx - 0.3, 1.3, -0.75], [cx - 0.3, 1.3, -1.3]],
    floor: [[cx + 0.3, 1.0, 1.4], [cx + 0.1, 0.08, 0.2]],
    sphere: [[cx - 0.1, 0.9, 1.5], [cx - 0.45, 0.53, 0.45]],
    cube: [[cx + 1.7, 1.05, 1.3], [cx + 0.95, 0.43, 0.25]],
  }
  const [position, target] = views[view] ?? views.wide!
  camera.position.set(...position)
  controls.target.set(...target)
  controls.update()
}

const panel = document.createElement('details')
panel.className = 'panel'
panel.open = !portrait
const summary = document.createElement('summary')
summary.textContent = 'Material controls · drag to orbit'
const fields = document.createElement('div')
fields.className = 'fields'
panel.append(summary, fields)
const status = document.createElement('div')
status.className = 'status'
document.body.append(panel, status)

function select(label: string, options: Array<[string, string]>, value: string, change: (value: string) => void) {
  const name = document.createElement('label')
  name.textContent = label
  const input = document.createElement('select')
  input.id = `control-${label}`
  name.htmlFor = input.id
  for (const [key, text] of options) input.add(new Option(text, key, false, key === value))
  input.onchange = () => change(input.value)
  fields.append(name, input)
  return input
}

const SOURCE_OPTIONS: Array<[string, string]> = [['graph', 'procedural graph'], ['image', 'image graph'], ['scan', 'CC0 reference'], ['baked', 'baked graph (KTX2)'], ['baked-image', 'baked image (KTX2)']]
const sliders = new Map<WeatherKey, HTMLInputElement>()
let pending = false
let revision = 0
let settled = 0

function refresh(which: SideKey[] = ['a', 'b']) {
  const current = ++revision
  ready.ready = false
  ready.error = ''
  pending = false
  settled = 0
  const jobs = which.map(key => updateSide(sides[key]))
  Promise.all(jobs).then(() => {
    if (current !== revision) return
    pending = true
    status.textContent = `${state.id} · ${state.res}px · A ${ready.ms.a?.toFixed(0) ?? '–'} ms · B ${ready.ms.b?.toFixed(0) ?? '–'} ms`
  }, error => {
    if (current !== revision) return
    ready.error = String(error?.message ?? error)
    status.innerHTML = ''
    const span = document.createElement('span')
    span.className = 'error'
    span.textContent = ready.error
    status.append(span)
    console.error(error)
  })
}

function syncSliders() {
  const graph = graphOf(state.id, 'graph')
  for (const [key, input] of sliders) input.value = String(weatherValue(graph, key))
}

function syncUrl() {
  const next = new URLSearchParams()
  next.set('m', state.id)
  next.set('a', state.sources.a)
  next.set('b', state.sources.b)
  if (state.layout !== (portrait ? 'single' : 'split')) next.set('layout', state.layout)
  if (state.layout === 'single' && state.active === 'b') next.set('show', 'b')
  if (state.view !== 'wide') next.set('view', state.view)
  next.set('res', String(state.res))
  if (!state.weatherOn) next.set('weather', 'none')
  if (state.tiling === 'off') next.set('tiling', 'off')
  for (const [key, value] of Object.entries(state.overrides)) next.set(key, String(value))
  history.replaceState(null, '', `${location.pathname}?${next}`)
}

const sourceInputs = new Map<SideKey, HTMLSelectElement>()
function syncSources() {
  for (const key of ['a', 'b'] as const) {
    const available = SOURCE_OPTIONS.filter(([kind]) => kind === 'graph' || kind === 'scan' ? true : kind === 'image' ? !!graphOf(state.id, 'image') : !!bakedOf(state.id, kind === 'baked' ? 'graph' : 'image'))
    if (!available.some(([kind]) => kind === state.sources[key])) state.sources[key] = key === 'a' ? 'scan' : 'graph'
    const input = sourceInputs.get(key)
    if (input) input.replaceChildren(...available.map(([value, title]) => new Option(title, value, false, value === state.sources[key])))
  }
}
syncSources()

select('material', ids.map(id => [id, graphOf(id, 'graph')!.title ?? id]), state.id, value => { state.id = value; state.overrides = {}; syncSources(); syncSliders(); syncUrl(); refresh() })
sourceInputs.set('a', select('A', [], state.sources.a, value => { state.sources.a = value as SourceKind; syncUrl(); refresh(['a']) }))
sourceInputs.set('b', select('B', [], state.sources.b, value => { state.sources.b = value as SourceKind; syncUrl(); refresh(['b']) }))
syncSources()
const layoutInput = select('layout', [['split', 'side by side'], ['single', 'one set, toggle']], state.layout, value => { state.layout = value as 'split' | 'single'; layout(); setView(state.view); syncUrl() })
select('view', ['wide', 'corner', 'wall', 'detail', 'floor', 'sphere', 'cube'].map(v => [v, v]), state.view, value => { setView(value); syncUrl() })
select('texels', [['512', '512'], ['1024', '1024']], String(state.res), value => { state.res = Number(value); syncUrl(); refresh() })
select('tiling', [['auto', 'auto · preserve ordered joints'], ['off', 'regular repeat']], state.tiling, value => { state.tiling = value; syncUrl(); refresh() })
const toggle = document.createElement('button')
toggle.className = 'wide'
toggle.textContent = 'toggle A / B'
toggle.onclick = () => { state.active = state.active === 'a' ? 'b' : 'a'; if (state.layout === 'split') state.layout = 'single'; layoutInput.value = state.layout; layout(); setView(state.view); syncUrl() }
fields.prepend(toggle)
const weatherName = document.createElement('span')
weatherName.textContent = 'weather'
const weatherToggle = document.createElement('input')
weatherToggle.type = 'checkbox'
weatherToggle.checked = state.weatherOn
weatherToggle.onchange = () => { state.weatherOn = weatherToggle.checked; syncUrl(); refresh() }
weatherToggle.setAttribute('aria-label', 'weathering enabled')
fields.append(weatherName, weatherToggle)
let sliderTimer = 0
for (const key of WEATHER_KEYS) {
  const name = document.createElement('label')
  name.textContent = key
  const input = document.createElement('input')
  input.id = `weather-${key}`
  name.htmlFor = input.id
  input.type = 'range'
  input.min = '0'
  input.max = '1'
  input.step = '0.01'
  input.oninput = () => {
    state.overrides[key] = Number(input.value)
    clearTimeout(sliderTimer)
    sliderTimer = window.setTimeout(() => { syncUrl(); refresh() }, 60)
  }
  sliders.set(key, input)
  fields.append(name, input)
}
syncSliders()

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
  look.setSize(innerWidth, innerHeight)
  setView(state.view)
})

look.setSize(innerWidth, innerHeight)
layout()
setView(state.view)
if (!['parity', 'bake'].includes(params.get('verify') ?? '')) refresh()

let last = performance.now()
if (!['parity', 'bake'].includes(params.get('verify') ?? '')) renderer.setAnimationLoop(now => {
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  controls.update()
  look.render(dt)
  if (pending && ++settled > 30) { pending = false; settled = 0; ready.ready = true; ready.textures = renderer.info.memory.textures }
})

addEventListener('pagehide', () => {
  ++revision
  renderer.setAnimationLoop(null)
  clearTimeout(sliderTimer)
  controls.dispose()
  for (const side of Object.values(sides)) {
    ++side.version
    side.release?.()
    side.evaluator?.dispose()
  }
  for (const texture of imageTextures.values()) void texture.then(value => value.dispose())
  for (const shape of SHAPES) shape.geometry.dispose()
  placeholder.dispose()
  ground.geometry.dispose()
  ground.material.dispose()
  sun.shadow.dispose()
  look.dispose()
  renderer.dispose()
})

if (params.get('verify') === 'parity') {
  const verification = window as unknown as { __materialParity: unknown }
  verification.__materialParity = { status: 'running' }
  void import('./parity').then(module => module.runMaterialParity(renderer)).then(result => {
    verification.__materialParity = { status: 'complete', result }
  }, error => {
    verification.__materialParity = { status: 'failed', error: String(error?.message ?? error) }
    console.error(error)
  })
}

if (params.get('verify') === 'bake') {
  const verification = window as unknown as { __materialBake: unknown }
  verification.__materialBake = { status: 'running' }
  void import('./bake-check').then(module => module.runBakeCheck(renderer)).then(result => {
    verification.__materialBake = { status: 'complete', result }
  }, error => {
    verification.__materialBake = { status: 'failed', error: String(error?.message ?? error) }
    console.error(error)
  })
}
