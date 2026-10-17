import { analyzeFrames } from './analyze.mjs'
import { lintZFighting } from './lint.mjs'
import { runIdProbe } from './probe.mjs'
export function describeWorld(hookState) {
  let best = null
  for (const [scene, record] of hookState.renders) {
    if (record.frame < hookState.frame - 60) continue
    let meshes = 0
    scene.traverse(object => { if (object.isMesh) meshes++ })
    if (!best || meshes > best.meshes) best = { scene, record, meshes }
  }
  return best
}

export function depthSetupOf(renderer, camera) {
  const gl = renderer.getContext()
  const target = renderer.getRenderTarget()
  const capabilities = renderer.capabilities
  const depthTexture = target?.depthTexture
  let bits = gl.getParameter(gl.DEPTH_BITS) || 24
  let float = false
  if (target) {
    if (depthTexture) { float = depthTexture.type === 1015; bits = float ? 32 : 24 }
    else bits = 24
  }
  return {
    near: camera.near,
    far: camera.far,
    bits,
    float,
    reversed: capabilities.reversedDepthBuffer === true,
    logarithmic: capabilities.logarithmicDepthBuffer === true,
    orthographic: camera.isOrthographicCamera === true,
  }
}

export function installPage() {
  const hook = window.__bsHook
  const api = {
    world() {
      const found = describeWorld(hook)
      if (!found) return null
      return { scene: found.scene, camera: found.record.camera, renderer: found.record.renderer, meshes: found.meshes }
    },
    depth() {
      const world = api.world()
      return world ? depthSetupOf(world.renderer, world.camera) : null
    },
    lint(options = {}) {
      const world = api.world()
      if (!world) throw new Error('No three.js scene was rendered; the page must draw a WebGLRenderer scene')
      const setup = depthSetupOf(world.renderer, world.camera)
      const bookmarks = window.__blacksite?.bookmarks ?? []
      const fov = world.camera.fov
      const cameras = options.cameras ?? (bookmarks.length ? bookmarks.map(bookmark => ({ ...bookmark, fov: bookmark.fov ?? fov })) : [currentView(world.camera)])
      const size = world.renderer.getSize({ x: 0, y: 0, set(x, y) { this.x = x; this.y = y; return this } })
      return lintZFighting(world.scene, { ...setup, ...(options.depth ?? {}), viewport: { width: size.x || 1440, height: size.y || 900 }, aspect: undefined, ...options, cameras })
    },
    probe(options = {}) {
      return new Promise((resolve, reject) => {
        const found = describeWorld(hook)
        if (!found) { reject(new Error('No three.js scene was rendered')); return }
        const timer = setTimeout(() => { if (hook.pending) { hook.pending = null; reject(new Error('The scene was not rendered again within 8 s')) } }, 8000)
        hook.pending = {
          scene: found.scene,
          resolve: value => { clearTimeout(timer); resolve(value) },
          reject: error => { clearTimeout(timer); reject(error) },
          run: (renderer, original, scene, camera) => {
            const result = runIdProbe(renderer, original, scene, camera, options)
            const analysis = analyzeFrames(result.frames, result.width, result.height, { ...options, depths: result.depths, depth: depthSetupOf(renderer, camera) })
            const used = new Set()
            for (const pair of analysis.pairs) for (const id of pair.pair) used.add(id)
            for (const region of analysis.regions) for (const entry of region.ids) for (const id of entry.pair) used.add(id)
            return { ...analysis, floats: result.floats, depth: depthSetupOf(renderer, camera), names: Object.fromEntries([...used].map(id => [id, result.table[id] ?? { id, name: `id ${id}` }])) }
          },
        }
      })
    },
  }
  window.__bsZ = api
  return api
}

function currentView(camera) {
  const e = camera.matrixWorld.elements
  const position = [e[12], e[13], e[14]]
  return { name: 'view', position, target: [position[0] - e[8], position[1] - e[9], position[2] - e[10]], fov: camera.fov }
}
