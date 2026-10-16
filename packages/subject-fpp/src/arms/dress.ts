import {
  AdditiveBlending, BufferGeometry, CanvasTexture, Color, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  PlaneGeometry, PointLight, RepeatWrapping, SRGBColorSpace, SkinnedMesh, TextureLoader, Vector2, type Material, type Object3D, type Texture,
} from 'three'
import sleeveColor from '../../assets/materials/sleeve_c.webp?url'
import sleeveNormal from '../../assets/materials/sleeve_n.webp?url'
import gloveColor from '../../assets/materials/glove_c.webp?url'
import gloveNormal from '../../assets/materials/glove_n.webp?url'
import gunmetalColor from '../../assets/materials/gunmetal_c.webp?url'
import gunmetalNormal from '../../assets/materials/gunmetal_n.webp?url'
import paintColor from '../../assets/materials/paint_c.webp?url'
import paintNormal from '../../assets/materials/paint_n.webp?url'
import polymerColor from '../../assets/materials/polymer_c.webp?url'
import polymerNormal from '../../assets/materials/polymer_n.webp?url'
import type { ArmsWeapon } from './state'

type Finish = 'sleeve' | 'glove' | 'gunmetal' | 'paint' | 'polymer' | 'grip' | 'brass'
type Region = (bone: string, x: number, y: number, z: number) => Finish

const finishes: Record<Finish, { map?: [string, string]; color: string; roughness: number; metalness: number; repeat: number; normal: number }> = {
  sleeve: { map: [sleeveColor, sleeveNormal], color: '#9ea06c', roughness: 0.96, metalness: 0, repeat: 8, normal: 1.4 },
  glove: { map: [gloveColor, gloveNormal], color: '#a0907c', roughness: 0.72, metalness: 0, repeat: 4, normal: 1.2 },
  gunmetal: { map: [gunmetalColor, gunmetalNormal], color: '#c2c4c8', roughness: 0.46, metalness: 0.62, repeat: 3, normal: 0.8 },
  paint: { map: [paintColor, paintNormal], color: '#ffffff', roughness: 0.68, metalness: 0.18, repeat: 1, normal: 0.6 },
  polymer: { map: [polymerColor, polymerNormal], color: '#8a8a82', roughness: 0.78, metalness: 0, repeat: 4, normal: 0.7 },
  grip: { map: [polymerColor, polymerNormal], color: '#c08a62', roughness: 0.6, metalness: 0, repeat: 4, normal: 0.7 },
  brass: { color: '#b38f55', roughness: 0.34, metalness: 0.85, repeat: 1, normal: 0 },
}

const regions: Record<ArmsWeapon, Region> = {
  rifle: (bone, _x, y, z) => {
    if (bone === 'bullets') return 'brass'
    if (bone === 'stock') return 'polymer'
    if (bone === 'magazine') return 'polymer'
    if (bone !== 'root') return 'gunmetal'
    if (z > 0.17 && z < 0.37 && y < 0.122) return 'paint'
    if (y < 0.03 && z < 0.06) return 'polymer'
    return 'gunmetal'
  },
  pistol: (bone, _x, y, z) => {
    if (bone !== 'root') return 'gunmetal'
    if (y < 0.03 && z < 0.035) return 'grip'
    return 'gunmetal'
  },
}

const order: Finish[] = ['sleeve', 'glove', 'gunmetal', 'paint', 'polymer', 'grip', 'brass']

function flashTexture() {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d')!
  const glow = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  glow.addColorStop(0, 'rgba(255,248,225,1)')
  glow.addColorStop(0.18, 'rgba(255,196,110,0.9)')
  glow.addColorStop(0.5, 'rgba(255,120,40,0.25)')
  glow.addColorStop(1, 'rgba(255,90,20,0)')
  context.fillStyle = glow
  context.fillRect(0, 0, size, size)
  context.globalCompositeOperation = 'lighter'
  for (let index = 0; index < 7; index++) {
    const angle = index / 7 * Math.PI * 2 + (index % 2) * 0.2
    const length = size * (index % 2 ? 0.34 : 0.48)
    context.save()
    context.translate(size / 2, size / 2)
    context.rotate(angle)
    const spike = context.createLinearGradient(0, 0, length, 0)
    spike.addColorStop(0, 'rgba(255,230,170,0.95)')
    spike.addColorStop(1, 'rgba(255,140,50,0)')
    context.fillStyle = spike
    context.beginPath()
    context.moveTo(0, -size * 0.045)
    context.lineTo(length, 0)
    context.lineTo(0, size * 0.045)
    context.fill()
    context.restore()
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

export async function loadArmsDress() {
  const loader = new TextureLoader()
  const load = (url: string, color: boolean) => loader.loadAsync(url).then(texture => {
    texture.wrapS = texture.wrapT = RepeatWrapping
    texture.anisotropy = 4
    if (color) texture.colorSpace = SRGBColorSpace
    return texture
  })
  const textures = new Map<string, Texture>()
  await Promise.all(Object.values(finishes).flatMap(finish => finish.map ?? []).map(async (url, index) => {
    if (!textures.has(url)) textures.set(url, await load(url, index % 2 === 0))
  }))
  const materials = Object.fromEntries(order.map(name => {
    const finish = finishes[name]
    const repeat = (texture: Texture) => { const copy = texture.clone(); copy.repeat.setScalar(finish.repeat); return copy }
    const material = new MeshStandardMaterial({
      name: `BlacksiteArms_${name}`, color: new Color(finish.color), roughness: finish.roughness, metalness: finish.metalness,
      map: finish.map ? repeat(textures.get(finish.map[0])!) : null,
      normalMap: finish.map ? repeat(textures.get(finish.map[1])!) : null,
      normalScale: new Vector2(finish.normal, finish.normal), envMapIntensity: 0.9,
    })
    return [name, material]
  })) as Record<Finish, MeshStandardMaterial>
  const field = { glove: materials.glove.clone(), sleeve: materials.sleeve.clone() }
  field.glove.vertexColors = field.sleeve.vertexColors = true
  field.glove.name = 'BlacksiteArms_fieldGlove'
  field.glove.color.set('#b9b2a4')
  field.glove.roughness = 0.62
  field.glove.normalScale.setScalar(1.6)
  field.sleeve.name = 'BlacksiteArms_fieldSleeve'
  field.sleeve.map = materials.sleeve.map!.clone(); field.sleeve.map.repeat.setScalar(1)
  field.sleeve.normalMap = materials.sleeve.normalMap!.clone(); field.sleeve.normalMap.repeat.setScalar(1)
  field.glove.map = materials.glove.map!.clone(); field.glove.map.repeat.setScalar(1)
  field.glove.normalMap = materials.glove.normalMap!.clone(); field.glove.normalMap.repeat.setScalar(1)
  const flash = flashTexture()
  const cuff = materials.sleeve.clone()
  cuff.side = DoubleSide
  const sleeves: BufferGeometry[] = []
  return {
    arms(scene: Object3D) {
      scene.traverse(object => {
        if (!(object instanceof SkinnedMesh)) return
        const sources = Array.isArray(object.material) ? object.material : [object.material]
        object.material = sources.map((material: Material) => /^Hand_/.test(material.name) ? materials.glove : materials.sleeve)
      })
      for (const side of [1, -1]) {
        const bone = scene.getObjectByName(side > 0 ? 'lowerarm_l' : 'lowerarm_r')
        if (!bone) continue
        const geometry = new CylinderGeometry(side > 0 ? 0.052 : 0.064, side > 0 ? 0.064 : 0.052, 0.5, 14, 1, true)
        geometry.rotateZ(-Math.PI / 2)
        geometry.translate(side * -0.19, 0, 0)
        sleeves.push(geometry)
        const sleeve = new Mesh(geometry, cuff)
        sleeve.name = 'BlacksiteArmsSleeve'
        sleeve.frustumCulled = false
        bone.add(sleeve)
      }
    },
    fieldArms(scene: Object3D) {
      scene.traverse(object => {
        if (!(object instanceof SkinnedMesh)) return
        const pick = (material: Material) => /glove/i.test(material.name) ? field.glove : field.sleeve
        object.material = Array.isArray(object.material) ? object.material.map(pick) : pick(object.material)
        object.castShadow = object.receiveShadow = false
      })
    },
    fieldWeapon(weapon: ArmsWeapon, object: Object3D) {
      if (weapon === 'rifle') return
      object.traverse(child => {
        if (!(child instanceof Mesh)) return
        const pick = (material: Material) => material.name.startsWith('polymer') ? materials.grip : materials.gunmetal
        child.material = Array.isArray(child.material) ? child.material.map(pick) : pick(child.material)
      })
    },
    weapon(weapon: ArmsWeapon, object: Object3D) {
      object.traverse(child => {
        if (!(child instanceof SkinnedMesh)) return
        child.geometry = splitRegions(child, regions[weapon])
        child.material = order.map(name => materials[name])
      })
    },
    flash: (weapon: ArmsWeapon, object: Object3D) => createMuzzleFlash(object, flash, weapon),
    dispose() {
      cuff.dispose()
      for (const material of Object.values(field)) { material.map?.dispose(); material.normalMap?.dispose(); material.dispose() }
      for (const geometry of sleeves) geometry.dispose()
      for (const material of Object.values(materials)) { material.map?.dispose(); material.normalMap?.dispose(); material.dispose() }
      for (const texture of textures.values()) texture.dispose()
      flash.dispose()
    },
  }
}

export type ArmsDress = Awaited<ReturnType<typeof loadArmsDress>>
export type MuzzleFlash = ReturnType<typeof createMuzzleFlash>

function splitRegions(mesh: SkinnedMesh, region: Region): BufferGeometry {
  const source = mesh.geometry
  const position = source.getAttribute('position')
  const joints = source.getAttribute('skinIndex')
  const weights = source.getAttribute('skinWeight')
  const finishOf = new Uint8Array(position.count)
  for (let vertex = 0; vertex < position.count; vertex++) {
    let best = 0
    let weight = -1
    for (let slot = 0; slot < 4; slot++) {
      const value = weights.getComponent(vertex, slot)
      if (value > weight) { weight = value; best = joints.getComponent(vertex, slot) }
    }
    finishOf[vertex] = order.indexOf(region(mesh.skeleton.bones[best]?.name ?? 'root', position.getX(vertex), position.getY(vertex), position.getZ(vertex)))
  }
  const geometry = source.clone()
  geometry.clearGroups()
  const index = source.getIndex()
  const count = index?.count ?? position.count
  const buckets = order.map(() => [] as number[])
  for (let corner = 0; corner < count; corner += 3) {
    const a = index?.getX(corner) ?? corner
    const b = index?.getX(corner + 1) ?? corner + 1
    const c = index?.getX(corner + 2) ?? corner + 2
    const votes = [finishOf[a], finishOf[b], finishOf[c]]
    const finish = votes[1] === votes[2] ? votes[1] : votes[0]
    buckets[finish].push(a, b, c)
  }
  const indices: number[] = []
  buckets.forEach((bucket, material) => {
    if (!bucket.length) return
    geometry.addGroup(indices.length, bucket.length, material)
    for (const value of bucket) indices.push(value)
  })
  geometry.setIndex(indices)
  return geometry
}

function createMuzzleFlash(weapon: Object3D, texture: Texture, kind: ArmsWeapon) {
  const muzzle = weapon.getObjectByName('muzzle') ?? weapon
  const group = new Group()
  group.name = 'BlacksiteArmsMuzzleFlash'
  const material = new MeshBasicMaterial({ map: texture, color: new Color(6, 4.6, 3), blending: AdditiveBlending, transparent: true, depthWrite: false, side: DoubleSide, toneMapped: false, fog: false })
  const size = kind === 'rifle' ? 0.16 : 0.058
  const front = new Mesh(new PlaneGeometry(size, size), material)
  const side = new Mesh(new PlaneGeometry(size * 1.9, size * 0.7), material)
  side.rotation.y = Math.PI / 2
  side.position.z = size * 0.55
  const top = side.clone()
  top.rotation.set(0, Math.PI / 2, Math.PI / 2)
  group.add(front, side, top)
  group.position.z = 0.012
  group.visible = false
  group.traverse(child => { child.frustumCulled = false; child.renderOrder = 10 })
  const light = new PointLight('#ffb766', 0, 1.6, 2)
  group.add(light)
  muzzle.add(group)
  let age = Infinity
  return {
    fire(random: number) {
      age = 0
      group.rotation.z = random * Math.PI * 2
      group.scale.setScalar(0.8 + random * 0.45)
    },
    update(delta: number) {
      age += delta
      const life = 0.05
      group.visible = age < life
      const fade = Math.max(0, 1 - age / life)
      light.intensity = fade * (kind === 'rifle' ? 3.2 : 1.3)
      material.opacity = fade
    },
    dispose() {
      front.geometry.dispose()
      side.geometry.dispose()
      material.dispose()
    },
  }
}
