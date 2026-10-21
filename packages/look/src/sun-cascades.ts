import { DepthTexture, GreaterEqualCompare, LessEqualCompare, MeshBasicNodeMaterial, NoBlending, QuadMesh, RenderTarget, Vector2 } from 'three/webgpu'
import type { Camera, Node, NodeFrame, Scene, Vector4, WebGPURenderer } from 'three/webgpu'
import { If, float, mix, normalWorld, positionView, reference, renderGroup, shadowPositionWorld, smoothstep, uniform, vec4 } from 'three/tsl'
import type { SunLight } from 'three/addons/lights/SunLight.js'
import { SunLightShadow } from 'three/addons/lights/SunLightShadow.js'
import { SunShadowNode } from 'three/addons/lights/SunShadowNode.js'

type CascadeShadow = SunLightShadow & { _cascadeData: Vector4[] }

interface CascadeInternals {
  readonly shadow: CascadeShadow
  readonly shadowMap: (RenderTarget & { depthTexture: DepthTexture }) | null
  readonly depthLayer: unknown
  readonly _filterShadow: unknown
  _atlasSize: Vector2
  setupShadowCoord(builder: unknown, coordinate: Node): Node
  setupShadowFilter(builder: unknown, inputs: Record<string, unknown>): Node
}

const NORMAL_OFFSET_TEXELS = 1.5

export class StaggeredSunShadowNode extends SunShadowNode {
  private readonly fit: CascadeShadow
  private readonly clearMaterial = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: true, blending: NoBlending, fog: false })
  private readonly clearTile = new QuadMesh(this.clearMaterial)
  private camera: Camera | null = null
  private frame = 0
  private readonly renderedAt: number[] = []
  private readonly size = new Vector2()
  private readonly target: { shadowMap: RenderTarget; depthTexture: DepthTexture }

  constructor(light: SunLight, private readonly scene: Scene, private readonly view: Camera, reversedDepth: boolean) {
    super(light)
    const extents = light.shadow.getFrameExtents()
    const width = light.shadow.mapSize.width * extents.x
    const height = light.shadow.mapSize.height * extents.y
    const depthTexture = new DepthTexture(width, height)
    depthTexture.name = 'SunShadowDepthTexture'
    depthTexture.compareFunction = reversedDepth ? GreaterEqualCompare : LessEqualCompare
    const shadowMap = new RenderTarget(width, height)
    shadowMap.texture.name = 'SunShadowMap'
    shadowMap.texture.type = light.shadow.mapType
    shadowMap.depthTexture = depthTexture
    this.target = { shadowMap, depthTexture }
    this.fit = new SunLightShadow() as CascadeShadow
    this.clearMaterial.allowOverride = false
    this.clearMaterial.colorNode = vec4(0)
    this.clearMaterial.depthNode = float(1)
    this.clearTile.name = 'Sun cascade clear'
    this.clearTile.castShadow = true
  }

  override setupRenderTarget() {
    return this.target
  }

  get depthTexture() {
    return this.target.depthTexture
  }

  _setupCascades(builder: { observer: { hasNode: boolean } }, filterFn: unknown) {
    builder.observer.hasNode = true
    const base = this as unknown as CascadeInternals
    const shadow = base.shadow
    const depthTexture = base.shadowMap!.depthTexture
    const intensity = (reference('intensity', 'float', shadow) as unknown as { setGroup(group: unknown): Node<'float'> }).setGroup(renderGroup)
    const viewDepth = positionView.z.negate().toVar()
    const value = float(1).toVar('shadowValue')
    const offsets = Array.from({ length: shadow.getViewportCount() }, (_, index) => {
      const offset = uniform(0).setGroup(renderGroup).onRenderUpdate(() => {
        const camera = shadow.getCamera(index)
        return Math.max(shadow.normalBias, NORMAL_OFFSET_TEXELS * (camera.right - camera.left) / shadow.mapSize.x)
      })
      return vec4((shadowPositionWorld as Node<'vec3'>).add((normalWorld as Node<'vec3'>).mul(offset)), 1).toVar()
    })
    for (let index = shadow.getViewportCount() - 1; index >= 0; index--) {
      const matrix = uniform('mat4').setGroup(renderGroup).onRenderUpdate(() => shadow.getMatrix(index))
      const cascade = uniform('vec4').setGroup(renderGroup).onRenderUpdate(() => shadow._cascadeData[index])
      If(viewDepth.greaterThanEqual(cascade.x).and(viewDepth.lessThan(cascade.y)), () => {
        const coordinate = base.setupShadowCoord(builder, matrix.mul(offsets[index]!))
        const filtered = base.setupShadowFilter(builder, { filterFn, shadowTexture: base.shadowMap!.texture, depthTexture, shadowCoord: coordinate, shadow: base._filterShadow, depthLayer: base.depthLayer })
        value.assign(mix(filtered as Node<'float'>, value, smoothstep(cascade.z, cascade.y, viewDepth)))
      })
    }
    return mix(1, value, intensity)
  }

  override updateBefore(frame: NodeFrame) {
    return super.updateBefore({ ...frame, scene: this.scene, camera: this.view } as NodeFrame)
  }

  reset() { this.camera = null }

  age(index: number) { return this.frame - (this.renderedAt[index] ?? -1) }

  private due(cascade: number) {
    return this.frame % 2 === cascade % 2
  }

  override renderShadow(frame: NodeFrame) {
    const { renderer, scene, camera } = frame as unknown as { renderer: WebGPURenderer; scene: Scene; camera: Camera }
    const base = this as unknown as CascadeInternals
    const shadow = base.shadow
    const map = base.shadowMap!
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
    base._atlasSize.set(map.width, map.height)
    renderer.autoClear = false
    const previousName = scene.name
    scene.name = `Shadow Map [ ${this.light.name} ]`
    for (let index = 0; index < shadow.getViewportCount(); index++) {
      if (!initialize && !this.due(index)) continue
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
      this.renderedAt[index] = this.frame
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
