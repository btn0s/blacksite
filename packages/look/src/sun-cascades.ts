import { MeshBasicNodeMaterial, NoBlending, QuadMesh, Vector2 } from 'three/webgpu'
import type { Camera, NodeFrame, Scene, Vector4 } from 'three/webgpu'
import { If, float, mix, normalWorld, positionView, reference, renderGroup, shadowPositionWorld, smoothstep, uniform, vec4 } from 'three/tsl'
import type { SunLight } from 'three/addons/lights/SunLight.js'
import { SunLightShadow } from 'three/addons/lights/SunLightShadow.js'
import { SunShadowNode } from 'three/addons/lights/SunShadowNode.js'

type CascadeShadow = SunLightShadow & { _cascadeData: Vector4[] }

const NORMAL_OFFSET_TEXELS = 1.5

export class StaggeredSunShadowNode extends SunShadowNode {
  private readonly fit = new SunLightShadow() as CascadeShadow
  private readonly clearMaterial = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: true, blending: NoBlending, fog: false })
  private readonly clearTile = new QuadMesh(this.clearMaterial)
  private camera: Camera | null = null
  private frame = 0
  private readonly size = new Vector2()

  constructor(light: SunLight, private readonly scene: Scene, private readonly view: Camera) {
    super(light)
    this.clearMaterial.allowOverride = false
    this.clearMaterial.colorNode = vec4(0)
    this.clearMaterial.depthNode = float(1)
    this.clearTile.name = 'Sun cascade clear'
    this.clearTile.castShadow = true
  }

  _setupCascades(builder: { observer: { hasNode: boolean } }, filterFn: unknown) {
    builder.observer.hasNode = true
    const shadow = this.shadow as CascadeShadow
    const depthTexture = this.shadowMap!.depthTexture
    const intensity = reference('intensity', 'float', shadow).setGroup(renderGroup)
    const viewDepth = positionView.z.negate().toVar()
    const value = float(1).toVar('shadowValue')
    const offsets = Array.from({ length: shadow.getViewportCount() }, (_, index) => {
      const offset = uniform(0).setGroup(renderGroup).onRenderUpdate(() => {
        const camera = shadow.getCamera(index)
        return Math.max(shadow.normalBias, NORMAL_OFFSET_TEXELS * (camera.right - camera.left) / shadow.mapSize.x)
      })
      return vec4(shadowPositionWorld.add(normalWorld.mul(offset)), 1).toVar()
    })
    for (let index = shadow.getViewportCount() - 1; index >= 0; index--) {
      const matrix = uniform('mat4').setGroup(renderGroup).onRenderUpdate(() => shadow.getMatrix(index))
      const cascade = uniform('vec4').setGroup(renderGroup).onRenderUpdate(() => shadow._cascadeData[index])
      If(viewDepth.greaterThanEqual(cascade.x).and(viewDepth.lessThan(cascade.y)), () => {
        const coordinate = this.setupShadowCoord(builder, matrix.mul(offsets[index]!))
        const filtered = this.setupShadowFilter(builder, { filterFn, shadowTexture: this.shadowMap!.texture, depthTexture, shadowCoord: coordinate, shadow: this._filterShadow, depthLayer: this.depthLayer })
        value.assign(mix(filtered, value, smoothstep(cascade.z, cascade.y, viewDepth)))
      })
    }
    return mix(1, value, intensity)
  }

  override updateBefore(frame: NodeFrame) {
    super.updateBefore({ ...frame, scene: this.scene, camera: this.view } as NodeFrame)
  }

  reset() { this.camera = null }

  override renderShadow(frame: NodeFrame) {
    const { renderer, scene, camera } = frame
    const shadow = this.shadow as CascadeShadow
    const map = this.shadowMap!
    const width = shadow.mapSize.x
    const height = shadow.mapSize.y
    const initialize = this.camera !== camera || this.size.x !== width || this.size.y !== height
    this.camera = camera
    this.size.copy(shadow.mapSize)
    this.fit.camera.copy(shadow.camera)
    this.fit.mapSize.copy(shadow.mapSize)
    this.fit.radius = shadow.radius
    this.fit.updateMatrices(this.light, camera)
    map.setSize(width * shadow.getFrameExtents().x, height * shadow.getFrameExtents().y)
    ;(this as unknown as { _atlasSize: Vector2 })._atlasSize.set(map.width, map.height)
    renderer.autoClear = false
    const previousName = scene.name
    scene.name = `Shadow Map [ ${this.light.name} ]`
    for (let index = 0; index < shadow.getViewportCount(); index++) {
      if (!initialize && index !== this.frame % 2) continue
      const cascadeCamera = shadow.getCamera(index)
      const layers = cascadeCamera.layers.mask
      cascadeCamera.copy(this.fit.getCamera(index))
      cascadeCamera.layers.mask = layers
      shadow.getMatrix(index).copy(this.fit.getMatrix(index))
      shadow.getFrustum(index).copy(this.fit.getFrustum(index))
      shadow._cascadeData[index]!.copy(this.fit._cascadeData[index]!)
      const viewport = shadow.getViewport(index).copy(this.fit.getViewport(index))
      map.viewport.set(index * width, 0, width, height)
      this.clearTile.render(renderer)
      map.viewport.set(width * viewport.x, map.height - height * (viewport.y + viewport.w), width * viewport.z, height * viewport.w)
      renderer.render(scene, cascadeCamera)
    }
    scene.name = previousName
    this.frame++
  }

  override dispose() {
    this.clearMaterial.dispose()
    this.fit.dispose()
    super.dispose()
  }
}
