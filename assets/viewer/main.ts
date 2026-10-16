import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { autoQuality, createLook } from '@blacksite/look'

type Build = { ship: string[]; files: Record<string, number>; bytes: number; ktx2Bytes?: number; budget: number; withinBudget: boolean; over: string[]; triangles?: number; size?: number[]; animations?: string[]; skinned?: boolean; variations?: { file: string; fallback: string; seconds: number }[] }
type Asset = { id: string; title: string; category: string; tags: string[]; source: { url: string; site?: string }; author: string; licence: string; attribution: string; use: string; scale?: { tile?: number }; sourceBytes: number; build: Build }
type Index = { generated: string; packs: Record<string, { description: string; assets: string[] }>; assets: Asset[] }

const MODELS = ['prop', 'foliage', 'weapon', 'character', 'animation']
const SOUNDS = ['sound', 'footstep', 'ambience', 'ir']
const base = import.meta.env.BASE_URL
const url = (asset: Asset, file: string) => `${base}${asset.id}/${file}`
const kb = (bytes: number) => bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(2)} MB` : `${Math.round(bytes / 1000)} KB`
const $ = <T extends HTMLElement>(selector: string) => document.querySelector(selector) as T
const el = (tag: string, className = '', text = '') => { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node }

const index: Index = await fetch(`${base}index.json`).then(response => response.ok ? response.json() : Promise.reject(new Error('Run blacksite assets build --pack starter first')))
const canvas = $<HTMLCanvasElement>('#view')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 400)
camera.position.set(0, 1.8, 11)
const controls = new OrbitControls(camera, canvas)
controls.target.set(0, 1.1, 0)
controls.enableDamping = true
controls.maxPolarAngle = Math.PI * 0.495
const sun = new THREE.DirectionalLight('#ffffff', 1)
sun.position.set(-6, 10, 4)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.left = sun.shadow.camera.bottom = -16
sun.shadow.camera.right = sun.shadow.camera.top = 16
sun.shadow.radius = 6
sun.shadow.bias = -0.0004
const fill = new THREE.HemisphereLight('#b8c0c4', '#4a4a40', 0.6)
scene.add(sun, fill)
const look = createLook(renderer, scene, camera, { atmosphere: 'zone', quality: autoQuality(), sky: false, environment: false, sun, fill })

const thumbCanvas = document.createElement('canvas')
thumbCanvas.width = thumbCanvas.height = 384
const thumbs = new THREE.WebGLRenderer({ canvas: thumbCanvas, antialias: true, preserveDrawingBuffer: true })
thumbs.toneMapping = THREE.AgXToneMapping
thumbs.toneMappingExposure = 1.1
const thumbScene = new THREE.Scene()
const thumbCamera = new THREE.PerspectiveCamera(32, 1, 0.01, 200)
const thumbKey = new THREE.DirectionalLight('#ffffff', 1.2)
thumbKey.position.set(-3, 4, 3)
thumbScene.add(thumbKey)

const ktx2 = new KTX2Loader().setTranscoderPath(`${base}basis/`).detectSupport(renderer)
const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
const images = new THREE.TextureLoader()
const hdr = new HDRLoader()
const pmrem = new THREE.PMREMGenerator(renderer)
const thumbPmrem = new THREE.PMREMGenerator(thumbs)

const assets = index.assets
const materials = assets.filter(asset => asset.category === 'material')
const skies = assets.filter(asset => asset.category === 'hdri')
const models = assets.filter(asset => MODELS.includes(asset.category))
const sounds = assets.filter(asset => SOUNDS.includes(asset.category))

function fillSelect(select: HTMLSelectElement, options: [string, string][], value?: string) {
  select.replaceChildren(...options.map(([key, label]) => { const option = el('option', '', label) as HTMLOptionElement; option.value = key; return option }))
  if (value) select.value = value
}
fillSelect($('#pack'), [['all', `All (${assets.length})`], ...Object.entries(index.packs).map(([name, pack]): [string, string] => [name, `${name} (${pack.assets.length})`])], index.packs.starter ? 'starter' : 'all')
fillSelect($('#sky'), skies.map(asset => [asset.id, asset.title]))
const defaultFloor = materials.find(asset => asset.tags.includes('floor')) ?? materials[0]
fillSelect($('#floor'), materials.map(asset => [asset.id, asset.title]), defaultFloor?.id)

const textureCache = new Map<string, Promise<THREE.Texture>>()
function texture(asset: Asset, map: 'c' | 'n' | 'orm', compressed: boolean) {
  const key = `${asset.id}/${map}/${compressed}`
  if (!textureCache.has(key)) {
    const file = url(asset, `1k/${map}.${compressed ? 'ktx2' : 'webp'}`)
    const promise = (compressed ? ktx2.loadAsync(file) : images.loadAsync(file)).then(loaded => {
      loaded.wrapS = loaded.wrapT = THREE.RepeatWrapping
      loaded.colorSpace = map === 'c' ? THREE.SRGBColorSpace : THREE.NoColorSpace
      loaded.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
      return loaded
    })
    textureCache.set(key, promise)
  }
  return textureCache.get(key)!
}

async function material(asset: Asset, metres: number, compressed = $<HTMLInputElement>('#ktx2').checked) {
  const [map, normalMap, orm] = await Promise.all([texture(asset, 'c', compressed), texture(asset, 'n', compressed), texture(asset, 'orm', compressed)])
  const tile = asset.scale?.tile ?? 2
  const repeat = metres / tile
  const result = new THREE.MeshStandardMaterial({ map: map.clone(), normalMap: normalMap.clone(), roughnessMap: orm.clone(), metalnessMap: orm.clone(), aoMap: orm.clone(), metalness: 1, roughness: 1, transparent: false, alphaTest: asset.tags.includes('decal') ? 0.5 : 0 })
  for (const t of [result.map, result.normalMap, result.roughnessMap, result.metalnessMap, result.aoMap]) { t!.repeat.set(repeat, repeat); t!.needsUpdate = true }
  return result
}

async function applySky(asset: Asset) {
  const [backdrop, environment] = await Promise.all([images.loadAsync(url(asset, 'sky.webp')), hdr.loadAsync(url(asset, 'env.hdr'))])
  backdrop.mapping = THREE.EquirectangularReflectionMapping
  backdrop.colorSpace = THREE.SRGBColorSpace
  environment.mapping = THREE.EquirectangularReflectionMapping
  scene.background = backdrop
  scene.backgroundIntensity = 0.85
  scene.environment = pmrem.fromEquirectangular(environment).texture
  scene.environmentIntensity = 0.9
  thumbScene.environment = thumbPmrem.fromEquirectangular(environment).texture
  thumbScene.background = new THREE.Color('#1a1c19')
  const probe = document.createElement('canvas')
  probe.width = 64; probe.height = 32
  const context = probe.getContext('2d')!
  context.drawImage(backdrop.image as CanvasImageSource, 0, 0, 64, 32)
  const row = context.getImageData(0, 15, 64, 2).data
  const colour = [0, 0, 0]
  for (let i = 0; i < row.length; i += 4) for (let c = 0; c < 3; c++) colour[c] += row[i + c]
  if (scene.fog) scene.fog.color.setRGB(colour[0] / (row.length / 4) / 255, colour[1] / (row.length / 4) / 255, colour[2] / (row.length / 4) / 255, THREE.SRGBColorSpace).multiplyScalar(0.85)
}

const world = new THREE.Group()
scene.add(world)
const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: '#555' }))
floor.rotation.x = -Math.PI / 2
floor.receiveShadow = true
scene.add(floor)
const mixers: THREE.AnimationMixer[] = []
const modelCache = new Map<string, Promise<THREE.Group>>()
const loadModel = (asset: Asset) => { if (!modelCache.has(asset.id)) modelCache.set(asset.id, gltf.loadAsync(url(asset, 'model.glb')).then(result => { result.scene.userData.clips = result.animations; return result.scene })); return modelCache.get(asset.id)! }

function inPack(asset: Asset) {
  const pack = $<HTMLSelectElement>('#pack').value
  return pack === 'all' || index.packs[pack]?.assets.includes(asset.id)
}

function shadows(object: THREE.Object3D) {
  object.traverse(child => { if ((child as THREE.Mesh).isMesh) { child.castShadow = true; child.receiveShadow = true } })
}

function idle(object: THREE.Object3D) {
  const clips = (object.userData.clips ?? []) as THREE.AnimationClip[]
  if (!clips.length) return
  const clip = clips.find(c => /idle/i.test(c.name) && !/crouch|pistol|gun|sword/i.test(c.name)) ?? clips[0]
  const mixer = new THREE.AnimationMixer(object)
  mixer.clipAction(clip).play()
  mixers.push(mixer)
}

async function layout() {
  world.clear()
  mixers.length = 0
  const shownMaterials = materials.filter(inPack)
  const radius = Math.max(8, shownMaterials.length * 2.9 / Math.PI)
  await Promise.all(shownMaterials.map(async (asset, i) => {
    const angle = Math.PI * (0.08 + 0.84 * (shownMaterials.length === 1 ? 0.5 : i / (shownMaterials.length - 1)))
    const wall = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3, 0.35), await material(asset, 2.6))
    wall.position.set(Math.cos(angle) * radius, 1.5, -Math.sin(angle) * radius + 2)
    wall.lookAt(0, 1.5, 4)
    const block = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), await material(asset, 1))
    block.position.copy(wall.position).add(new THREE.Vector3(0, -1, 0)).lerp(new THREE.Vector3(0, 0.5, 4), 0.14)
    block.position.y = 0.5
    block.rotation.y = i * 0.7
    shadows(wall); shadows(block)
    world.add(wall, block)
  }))
  const shownModels = models.filter(inPack)
  const loaded = await Promise.all(shownModels.map(asset => loadModel(asset).then(model => ({ asset, model: model.clone(true) }))))
  let x = 0
  const placed: THREE.Object3D[] = []
  for (const { asset, model } of loaded) {
    const size = asset.build.size ?? [1, 1, 1]
    const width = Math.max(size[0], size[2], 0.4)
    model.userData.clips = (modelCache.has(asset.id) ? (await modelCache.get(asset.id)!).userData.clips : [])
    model.position.set(x + width / 2, 0, 1.5)
    x += width + 0.6
    shadows(model)
    idle(model)
    placed.push(model)
  }
  for (const model of placed) { model.position.x -= x / 2; world.add(model) }
}

async function applyFloor() {
  const asset = materials.find(m => m.id === $<HTMLSelectElement>('#floor').value)
  if (asset) floor.material = await material(asset, 60)
}

function thumbFrame(object: THREE.Object3D, angle = 0.7) {
  const box = new THREE.Box3().setFromObject(object)
  const sphere = box.getBoundingSphere(new THREE.Sphere())
  const distance = sphere.radius / Math.sin(THREE.MathUtils.degToRad(thumbCamera.fov / 2)) * 1.05
  thumbCamera.position.set(sphere.center.x + Math.sin(angle) * distance, sphere.center.y + distance * 0.32, sphere.center.z + Math.cos(angle) * distance)
  thumbCamera.lookAt(sphere.center)
  thumbCamera.near = distance / 100
  thumbCamera.far = distance * 10
  thumbCamera.updateProjectionMatrix()
}

function snapshot(object: THREE.Object3D) {
  thumbScene.add(object)
  thumbs.render(thumbScene, thumbCamera)
  thumbScene.remove(object)
  const image = new Image()
  image.src = thumbCanvas.toDataURL('image/webp', 0.9)
  return image
}

async function materialThumb(asset: Asset) {
  const group = new THREE.Group()
  const cube = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), await material(asset, 1.2, false))
  cube.rotation.y = 0.6
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.42, 64, 32), await material(asset, 1.3, false))
  ball.position.set(0.95, -0.18, 0.75)
  group.add(cube, ball)
  thumbFrame(group, 0.35)
  return snapshot(group)
}

async function modelThumb(asset: Asset) {
  const model = (await loadModel(asset)).clone(true)
  thumbFrame(model)
  return snapshot(model)
}

function meta(asset: Asset) {
  const body = el('div', 'body')
  body.append(el('div', 'title', asset.title))
  const source = el('div', 'meta')
  const link = el('a', '', new URL(asset.source.url).hostname.replace(/^www\./, '')) as HTMLAnchorElement
  link.href = asset.source.url
  link.target = '_blank'
  source.append(`${asset.author} · ${asset.licence} · `, link)
  body.append(source)
  const b = asset.build
  const size = el('div', `meta ${b.withinBudget ? 'ok' : 'bad'}`)
  const parts = [`${SOUNDS.includes(asset.category) && b.variations && b.variations.length > 1 ? 'largest take ' : ''}${kb(b.bytes)} of ${kb(b.budget)}`]
  if (b.ktx2Bytes) parts.push(`KTX2 1K ${kb(b.ktx2Bytes)}`)
  if (b.triangles) parts.push(`${b.triangles.toLocaleString()} tris`)
  if (b.size) parts.push(`${b.size.map(v => v.toFixed(2)).join(' × ')} m`)
  if (b.animations) parts.push(`${b.animations.length} clips`)
  if (b.variations) parts.push(`${b.variations.length} take${b.variations.length > 1 ? 's' : ''}, ${b.variations.reduce((s, v) => s + v.seconds, 0).toFixed(1)} s`)
  parts.push(`source ${kb(asset.sourceBytes)}`)
  size.textContent = parts.join(' · ')
  body.append(size, el('div', 'use', asset.use))
  const tags = el('div', 'tags')
  for (const tag of asset.tags) tags.append(el('span', '', tag))
  body.append(tags)
  if (asset.licence !== 'CC0-1.0') body.append(el('div', 'meta', `Credit: ${asset.attribution}`))
  return body
}

function section(title: string, list: Asset[], card: (asset: Asset) => HTMLElement) {
  if (!list.length) return
  const wrap = el('section')
  wrap.append(el('h2', '', `${title} (${list.length})`))
  const grid = el('div', 'grid')
  for (const asset of list) { const node = card(asset); node.dataset.id = asset.id; grid.append(node) }
  wrap.append(grid)
  $('#sheet').append(wrap)
}

function sheet() {
  $('#sheet').replaceChildren()
  section('Materials', materials.filter(inPack), asset => {
    const card = el('article', 'card')
    const holder = el('div')
    materialThumb(asset).then(image => holder.replaceChildren(image))
    const maps = el('div', 'maps')
    for (const map of ['c', 'n', 'orm']) { const image = el('img') as HTMLImageElement; image.loading = 'lazy'; image.src = url(asset, `512/${map}.webp`); image.alt = `${asset.title} ${map}`; maps.append(image) }
    card.append(holder, maps, meta(asset))
    return card
  })
  section('Skies', skies.filter(inPack), asset => {
    const card = el('article', 'card')
    const image = el('img', 'wide') as HTMLImageElement
    image.src = url(asset, 'preview.webp')
    image.alt = asset.title
    card.append(image, meta(asset))
    return card
  })
  section('Models', models.filter(inPack), asset => {
    const card = el('article', 'card')
    const holder = el('div')
    modelThumb(asset).then(image => holder.replaceChildren(image))
    card.append(holder, meta(asset))
    return card
  })
  section('Sound', sounds.filter(inPack), asset => {
    const card = el('article', 'card sound')
    const body = meta(asset)
    const player = el('audio') as HTMLAudioElement
    player.controls = true
    player.preload = 'none'
    player.loop = asset.category === 'ambience'
    const takes = asset.build.variations ?? []
    const choose = (index: number) => {
      const take = takes[index]
      player.replaceChildren()
      const opus = el('source') as HTMLSourceElement
      opus.src = url(asset, take.file); opus.type = 'audio/ogg; codecs=opus'
      const aac = el('source') as HTMLSourceElement
      aac.src = url(asset, take.fallback); aac.type = 'audio/mp4'
      player.append(opus, aac)
      player.load()
    }
    if (takes.length) choose(0)
    const buttons = el('div', 'takes')
    if (takes.length > 1) {
      takes.forEach((take, i) => { const button = el('button', '', String(i + 1)); button.title = `${take.seconds.toFixed(2)} s`; button.onclick = () => { choose(i); player.play() }; buttons.append(button) })
      const random = el('button', '', 'random')
      random.onclick = () => { choose(Math.floor(Math.random() * takes.length)); player.play() }
      buttons.append(random)
    }
    body.prepend(player, buttons)
    card.append(body)
    return card
  })
}

function summary() {
  const shown = assets.filter(inPack)
  const bytes = shown.reduce((sum, asset) => sum + asset.build.ship.reduce((s, file) => s + (asset.build.files[file] ?? 0), 0), 0)
  const over = shown.filter(asset => !asset.build.withinBudget).length
  $('#summary').textContent = `${shown.length} assets · ${kb(bytes)} shipped at 1K WebP / Opus · ${over ? `${over} over budget` : 'all within budget'} · built ${new Date(index.generated).toLocaleString()}`
}

function resize() {
  const width = canvas.clientWidth, height = canvas.clientHeight
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  look.setSize(width, height, false)
}

const clock = new THREE.Clock()
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1)
  for (const mixer of mixers) mixer.update(dt)
  controls.update()
  look.render(dt)
})
addEventListener('resize', resize)
resize()

$<HTMLSelectElement>('#sky').onchange = () => { const sky = skies.find(s => s.id === $<HTMLSelectElement>('#sky').value); if (sky) applySky(sky) }
$<HTMLSelectElement>('#floor').onchange = applyFloor
$<HTMLSelectElement>('#pack').onchange = () => { summary(); sheet(); layout() }
$<HTMLInputElement>('#ktx2').onchange = () => { applyFloor(); layout() }

if (skies[0]) await applySky(skies[0])
summary()
await Promise.all([applyFloor(), layout()])
sheet()
document.body.dataset.ready = 'true'
