import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { PROPS, PROP_NAMES, prop, propsReady, scatterProps } from '../src/world'

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(2, devicePixelRatio))
renderer.setSize(innerWidth, innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.AgXToneMapping
document.body.append(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color('#6f7275')
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture
scene.environmentIntensity = 0.6
const sun = new THREE.DirectionalLight('#ffffff', 2.2)
sun.castShadow = true
sun.shadow.mapSize.set(4096, 4096)
sun.shadow.bias = -0.0004
scene.add(sun, sun.target)

const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: '#8a8c8e', roughness: 0.9 }))
floor.rotation.x = -Math.PI / 2
floor.receiveShadow = true
scene.add(floor)

await propsReady(renderer)

const names = [...PROP_NAMES].sort((a, b) => PROPS[a].size[1] - PROPS[b].size[1])
const columns = 8
const gap = 0.6
const rows = Array.from({ length: Math.ceil(names.length / columns) }, (_, row) => names.slice(row * columns, row * columns + columns))
const labels: { name: string; at: THREE.Vector3 }[] = []
let z = 0
for (const row of rows) {
  const width = row.reduce((sum, name) => sum + PROPS[name].size[0] + gap, -gap)
  const deep = Math.max(...row.map(name => PROPS[name].size[2]))
  let x = -width / 2
  for (const name of row) {
    const { min, max, size } = PROPS[name]
    const at: [number, number, number] = [x + size[0] / 2 - (min[0] + max[0]) / 2, 0, z - deep / 2 - (min[2] + max[2]) / 2]
    scene.add(prop(name, { at }))
    labels.push({ name: `${name} ${size.map(value => value.toFixed(2)).join('×')}`, at: new THREE.Vector3(x + size[0] / 2, 0, z + 0.05) })
    x += size[0] + gap
  }
  z -= deep + gap * 1.6
}

const tints = ['#ffffff', '#9fb0c8', '#c8b49f', '#a6c49c']
scene.add(scatterProps(Array.from({ length: 12 }, (_, index) => ({ name: index % 2 ? 'oil-drum' : 'plastic-crate', at: [-7 + index * 1.2, 0, 1.2] as const, yaw: index * 0.7, tint: tints[index % 4] }))))
const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.1, 200)
const middle = z / 2
camera.position.set(0, 10, middle + 12)
camera.lookAt(0, 0.3, middle + 0.4)
sun.position.set(-6, 12, middle + 8)
sun.target.position.set(0, 0, middle)
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, far: 40 })
sun.shadow.camera.updateProjectionMatrix()

renderer.render(scene, camera)
for (const label of labels) {
  const point = label.at.project(camera)
  const element = document.createElement('div')
  element.className = 'label'
  element.textContent = label.name
  element.style.left = `${(point.x * 0.5 + 0.5) * innerWidth}px`
  element.style.top = `${(-point.y * 0.5 + 0.5) * innerHeight}px`
  document.body.append(element)
}
const info = renderer.info.render
document.title = `ready ${info.calls} calls ${info.triangles} triangles`
