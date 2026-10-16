import * as THREE from 'three'
import { createLook } from '@blacksite/look'
import { loadBaked, standardMaterial, type BakedMaterial, type MaterialTextures } from '@blacksite/materials/three'

const modules = import.meta.glob<BakedMaterial>('../../baked/*/index.ts', { import: 'default' })
const names = Object.keys(modules).sort()
if (!names.length) throw new Error('Run pnpm --filter @blacksite/materials bake:library first')
const renderer = new THREE.WebGLRenderer({ antialias: false })
renderer.setPixelRatio(1)
renderer.setSize(innerWidth, innerHeight)
document.body.append(renderer.domElement)
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100)
camera.position.set(1.6, 1.2, 2.8)
camera.lookAt(0, 0, 0)
const look = createLook(renderer, scene, camera, { atmosphere: 'zone', quality: 'low', environment: true })
look.setSize(innerWidth, innerHeight)
const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())
scene.add(mesh)
const jobs = new Map<string, () => Promise<void>>()
const registerWarmup = (name: string, run: () => Promise<void>) => jobs.set(name, run)
const output = document.querySelector('output')!
const select = document.querySelector('select')!
let textures: MaterialTextures | undefined
let version = 0

async function show(file: string) {
  const request = ++version
  output.value = 'Loading baked textures…'
  const baked = await modules[file]!()
  const next = await loadBaked(baked, { renderer, resolution: innerWidth < 600 ? 512 : 1024 })
  if (request !== version) {
    for (const map of [next.color, next.normal, next.orm, next.masks]) map.dispose()
    return
  }
  mesh.material.dispose()
  if (textures) for (const map of [textures.color, textures.normal, textures.orm, textures.masks]) map.dispose()
  textures = next
  for (const map of [next.color, next.normal, next.orm]) map.repeat.set(1 / baked.size, 1 / baked.size)
  mesh.material = standardMaterial(next)
  await renderer.compileAsync(scene, camera)
  output.value = `${baked.title ?? baked.name} · ${baked.size} m tile · baked KTX2`
}

for (const name of names) select.add(new Option(name.split('/').at(-2), name))
select.onchange = () => { void show(select.value).catch(error => { output.value = String(error); console.error(error) }) }
registerWarmup('first-material', () => show(names[0]!))
await Promise.all([...jobs.values()].map(run => run()))
renderer.setAnimationLoop(() => look.render(1 / 60))
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
  look.setSize(innerWidth, innerHeight)
})
