import * as THREE from 'three'
import { compile, parseGraph } from '../src/graph'
import { evaluate } from '../src/cpu'
import { disposeSurfaceSource, loadBaked, surfaceSource, type BakedMaterial, type MaterialTextures } from '../src/three'
import fixture from '../proof/asymmetric.json'

const descriptors = import.meta.glob<BakedMaterial>('../proof/baked/asymmetric-check/{index,webp}.ts', { import: 'default' })
const names = ['color', 'normal', 'orm', 'masks'] as const
type MapName = (typeof names)[number]
type Metric = { mean: number; p99: number; max: number }

function metric(a: Float32Array, b: Float32Array, channel: number): Metric {
  const errors = Array.from({ length: a.length / 4 }, (_, i) => Math.abs(a[i * 4 + channel]! - b[i * 4 + channel]!)).sort((x, y) => x - y)
  return { mean: errors.reduce((sum, value) => sum + value, 0) / errors.length, p99: errors[Math.floor(errors.length * 0.99)]!, max: errors.at(-1)! }
}

function reference(data: Float32Array, color: boolean) {
  return Float32Array.from(data, (value, i) => {
    const byte = Math.max(0, Math.min(255, Math.round(value * 255))) / 255
    return color && i % 4 !== 3 ? byte <= 0.04045 ? byte / 12.92 : Math.pow((byte + 0.055) / 1.055, 2.4) : byte
  })
}

export async function runBakeCheck(renderer: THREE.WebGLRenderer) {
  const loadKtx = descriptors['../proof/baked/asymmetric-check/index.ts']
  const loadWebp = descriptors['../proof/baked/asymmetric-check/webp.ts']
  if (!loadKtx || !loadWebp) throw new Error('Run pnpm exec tsx packages/materials/proof/bake-check.ts before verify=bake')
  const graph = parseGraph(fixture)
  const cpu = evaluate(compile(graph, 128))
  const known = Object.fromEntries(names.map(name => [name, reference(cpu[name].data, name === 'color')])) as Record<MapName, Float32Array>
  const target = new THREE.WebGLRenderTarget(128, 128, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false })
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { source: { value: null } },
    vertexShader: 'in vec3 position; out vec2 uv; void main(){uv=position.xy*0.5+0.5;gl_Position=vec4(position,1.0);}',
    fragmentShader: 'precision highp float; uniform sampler2D source; in vec2 uv; out vec4 outputColor; void main(){outputColor=texture(source,uv);}',
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3))
  const scene = new THREE.Scene()
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  scene.add(mesh)
  const camera = new THREE.Camera()
  const loaded: MaterialTextures[] = []
  const previous = renderer.getRenderTarget()
  const errors: string[] = []
  const measurements: Record<string, Record<string, Metric[]>> = {}
  const samples: Record<string, Record<string, number[][]>> = {}
  const coordinates = [[16, 16], [111, 16], [16, 111], [111, 111], [64, 64]]
  let maxDamage = 0
  for (let i = 1; i < 128 * 128; i++) if (known.masks[i * 4 + 3]! > known.masks[maxDamage * 4 + 3]!) maxDamage = i
  coordinates.push([maxDamage % 128, Math.floor(maxDamage / 128)])
  const capture = (texture: THREE.Texture) => {
    material.uniforms.source!.value = texture
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    const result = new Float32Array(128 * 128 * 4)
    renderer.readRenderTargetPixels(target, 0, 0, 128, 128, result)
    return result
  }
  const decoded: Record<string, Record<MapName, Float32Array>> = {}
  try {
    for (const [format, descriptor] of [['ktx2', await loadKtx()], ['webp', await loadWebp()]] as const) {
      const textures = await loadBaked(descriptor, { renderer, resolution: 128 })
      loaded.push(textures)
      decoded[format] = {} as Record<MapName, Float32Array>
      measurements[format] = {}
      samples[format] = {}
      for (const name of names) {
        const data = capture(textures[name])
        decoded[format][name] = data
        const values = Array.from({ length: 4 }, (_, channel) => metric(data, known[name], channel))
        measurements[format][name] = values
        samples[format][name] = coordinates.map(([x, y]) => Array.from(data.subarray((y! * 128 + x!) * 4, (y! * 128 + x!) * 4 + 4)))
        values.forEach((value, channel) => {
          if (!Number.isFinite(value.max) || value.mean > 0.025 || value.p99 > 0.1 || value.max > 0.25) errors.push(`${format}.${name}.${channel}: mean ${value.mean}, p99 ${value.p99}, max ${value.max}`)
        })
      }
    }
    measurements.formats = {}
    for (const name of names) measurements.formats[name] = Array.from({ length: 4 }, (_, channel) => metric(decoded.ktx2![name], decoded.webp![name], channel))
    const orientedError = measurements.ktx2!.color!.reduce((sum, value) => sum + value.mean, 0)
    const flipped = new Float32Array(known.color.length)
    for (let y = 0; y < 128; y++) flipped.set(known.color.subarray((127 - y) * 128 * 4, (128 - y) * 128 * 4), y * 128 * 4)
    const flippedError = Array.from({ length: 4 }, (_, channel) => metric(decoded.ktx2!.color, flipped, channel).mean).reduce((sum, value) => sum + value, 0)
    if (!(flippedError > orientedError * 5)) errors.push(`orientation ambiguous: correct ${orientedError}, flipped ${flippedError}`)
    const expected = Object.fromEntries(names.map(name => [name, coordinates.map(([x, y]) => Array.from(known[name].subarray((y! * 128 + x!) * 4, (y! * 128 + x!) * 4 + 4)))]))
    if (!(known.masks[maxDamage * 4 + 3]! > 0.5)) errors.push('fixture does not exercise a nonzero damage alpha')
    return { passed: errors.length === 0, resolution: 128, coordinates, expected, samples, measurements, orientation: { correct: orientedError, flipped: flippedError }, errors }
  } finally {
    renderer.setRenderTarget(previous)
    for (const textures of loaded) disposeSurfaceSource(surfaceSource(textures))
    target.dispose()
    geometry.dispose()
    material.dispose()
  }
}
