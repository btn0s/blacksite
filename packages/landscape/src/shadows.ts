import { DirectionalLight, Mesh, PCFShadowMap, Vector3 } from 'three'
import type { Material, Object3D, PerspectiveCamera, WebGLRenderer } from 'three'
import { CSM } from 'three/examples/jsm/csm/CSM.js'
import { patchMaterial } from './patch'

export interface SunShadowOptions {
  readonly camera: PerspectiveCamera
  readonly parent: Object3D
  readonly cascades?: number
  readonly distance?: number
  readonly mapSize?: number
  readonly bias?: number
  readonly normalBias?: number
  readonly margin?: number
  readonly proxyLayer?: number
}

export interface SunShadows {
  readonly csm: CSM
  readonly lights: readonly DirectionalLight[]
  setup(material: Material): void
  track(root: Object3D): void
  follow(sun: DirectionalLight): void
  update(): void
  dispose(): void
}

const LIT = new Set(['MeshStandardMaterial', 'MeshPhysicalMaterial', 'MeshLambertMaterial', 'MeshPhongMaterial', 'MeshToonMaterial'])

export function configureShadowRenderer(renderer: WebGLRenderer): void {
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFShadowMap
}

export function createSunShadows(options: SunShadowOptions): SunShadows {
  const csm = new CSM({
    camera: options.camera,
    parent: options.parent,
    cascades: options.cascades ?? 3,
    maxFar: options.distance ?? 180,
    mode: 'practical',
    shadowMapSize: options.mapSize ?? 2048,
    shadowBias: options.bias ?? -0.0004,
    lightDirection: new Vector3(-0.5, -0.8, 0.3).normalize(),
    lightIntensity: 3,
    lightNear: 1,
    lightFar: 1400,
    lightMargin: options.margin ?? 260,
  })
  csm.fade = true
  const layer = options.proxyLayer ?? 2
  for (const light of csm.lights) {
    light.shadow.normalBias = options.normalBias ?? 0.04
    light.shadow.camera.layers.enable(layer)
    light.shadow.radius = 2
  }
  const done = new WeakSet<Material>()
  let followed: DirectionalLight | null = null
  const direction = new Vector3()
  let frustumKey = ''
  const setup = (material: Material) => {
    if (done.has(material) || !LIT.has(material.type)) return
    done.add(material)
    material.defines = material.defines ?? {}
    material.defines.USE_CSM = 1
    material.defines.CSM_CASCADES = csm.cascades
    if (csm.fade) material.defines.CSM_FADE = ''
    const breaks: unknown[] = []
    patchMaterial(material, 'world-csm', shader => {
      const camera = csm.camera as PerspectiveCamera
      const far = Math.min(camera.far, csm.maxFar)
      ;(csm as unknown as { _getExtendedBreaks(target: unknown[]): void })._getExtendedBreaks(breaks)
      shader.uniforms.CSM_cascades = { value: breaks }
      shader.uniforms.cameraNear = { value: camera.near }
      shader.uniforms.shadowFar = { value: far }
      csm.shaders.set(material, shader as never)
    })
    csm.shaders.set(material, null as never)
  }
  const visit = (object: Object3D) => {
    if (!(object instanceof Mesh)) return
    const list = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of list) setup(material)
  }
  return {
    csm,
    lights: csm.lights,
    setup,
    track(root) { root.traverse(visit) },
    follow(sun) { followed = sun },
    update() {
      if (followed) {
        direction.copy(followed.target.position).sub(followed.position).normalize()
        csm.lightDirection.copy(direction)
        for (const light of csm.lights) {
          light.color.copy(followed.color)
          light.intensity = followed.intensity
        }
      }
      const camera = csm.camera as PerspectiveCamera
      const key = `${camera.fov}|${camera.aspect}|${camera.near}|${camera.far}`
      if (key !== frustumKey) { frustumKey = key; csm.updateFrustums() }
      csm.update()
    },
    dispose() {
      csm.remove()
      csm.dispose()
    },
  }
}
