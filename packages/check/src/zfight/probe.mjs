import { decodeIds } from './analyze.mjs'
const state = { ids: new WeakMap(), variants: new WeakMap(), table: [null] }

function halton(index, base) {
  let result = 0
  let fraction = 1 / base
  let i = index
  while (i > 0) { result += fraction * (i % base); i = Math.floor(i / base); fraction /= base }
  return result
}

function pathName(object) {
  const parts = []
  for (let node = object; node; node = node.parent) if (node.name) parts.push(node.name)
  return parts.reverse().join('/')
}

function idColor(id) {
  return [(id & 255) / 255, ((id >> 8) & 255) / 255, ((id >> 16) & 255) / 255]
}

function variantOf(material, id) {
  let byId = state.variants.get(material)
  if (!byId) { byId = new Map(); state.variants.set(material, byId) }
  let variant = byId.get(id)
  if (variant) return variant
  variant = material.clone()
  const prior = material.onBeforeCompile
  const colour = idColor(id)
  variant.onBeforeCompile = (shader, renderer) => {
    if (prior) prior.call(variant, shader, renderer)
    shader.uniforms.bsId = { value: colour }
    const body = shader.fragmentShader.replace(/\}\s*$/, '\n\tgl_FragColor = vec4(bsId, 1.0);\n}')
    const precision = body.match(/precision\s+\w+\s+float\s*;/)
    shader.fragmentShader = precision ? body.replace(precision[0], `${precision[0]}\nuniform vec3 bsId;`) : `uniform vec3 bsId;\n${body}`
  }
  variant.customProgramCacheKey = () => `bsid|${material.customProgramCacheKey ? material.customProgramCacheKey() : ''}`
  variant.blending = 0
  variant.alphaToCoverage = false
  variant.userData = {}
  byId.set(id, variant)
  return variant
}

function readTarget(renderer, target, width, height) {
  const gl = renderer.getContext()
  if (!target) {
    const data = new Uint8Array(width * height * 4)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data)
    return { data, floats: false }
  }
  const framebuffer = renderer.properties.get(target).__webglFramebuffer
  const previous = gl.getParameter(gl.FRAMEBUFFER_BINDING)
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  try {
    if (target.texture.type === 1009) {
      const data = new Uint8Array(width * height * 4)
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data)
      return { data, floats: false }
    }
    const data = new Float32Array(width * height * 4)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, data)
    return { data, floats: true }
  } finally { gl.bindFramebuffer(gl.FRAMEBUFFER, previous) }
}

export function runIdProbe(renderer, original, scene, camera, options = {}) {
  const frames = options.frames ?? 6
  const jitter = options.jitter ?? 0.4
  const nudge = options.nudge ?? 0.0007
  const gl = renderer.getContext()
  const target = renderer.getRenderTarget()
  const width = target ? target.width : gl.drawingBufferWidth
  const height = target ? target.height : gl.drawingBufferHeight
  const swaps = []
  const hidden = []
  scene.traverse(object => {
    if (object.isMesh) {
      const list = Array.isArray(object.material) ? object.material : [object.material]
      if (list.some(material => !material || material.isRawShaderMaterial)) { if (object.visible) { hidden.push(object); object.visible = false } return }
      let id = state.ids.get(object)
      if (!id) {
        id = state.table.length
        state.ids.set(object, id)
        state.table.push({ id, name: object.name || `${list[0].name || object.geometry?.type || 'mesh'}#${id}`, path: pathName(object), material: list.map(material => material.name).join('|'), uuid: object.uuid })
      }
      swaps.push([object, object.material])
      const variants = list.map(material => variantOf(material, id))
      object.material = Array.isArray(object.material) ? variants : variants[0]
    } else if ((object.isLine || object.isPoints || object.isSprite) && object.visible) {
      hidden.push(object)
      object.visible = false
    }
  })
  const saved = {
    background: scene.background,
    override: scene.overrideMaterial,
    autoClear: renderer.autoClear,
    autoUpdate: renderer.shadowMap.autoUpdate,
    alpha: renderer.getClearAlpha(),
    view: camera.view ? { ...camera.view } : null,
    position: [camera.position.x, camera.position.y, camera.position.z],
  }
  const clear = { r: 0, g: 0, b: 0, isColor: true, copy(color) { this.r = color.r; this.g = color.g; this.b = color.b; return this } }
  renderer.getClearColor(clear)
  scene.background = null
  scene.overrideMaterial = null
  renderer.autoClear = false
  renderer.shadowMap.autoUpdate = false
  renderer.setClearColor(0x000000, 1)
  const scale = saved.view && saved.view.enabled ? saved.view.width / width : 1
  const base = saved.view && saved.view.enabled ? saved.view : { fullWidth: width, fullHeight: height, offsetX: 0, offsetY: 0, width, height }
  const right = [camera.matrixWorld.elements[0], camera.matrixWorld.elements[1], camera.matrixWorld.elements[2]]
  const up = [camera.matrixWorld.elements[4], camera.matrixWorld.elements[5], camera.matrixWorld.elements[6]]
  const forward = [-camera.matrixWorld.elements[8], -camera.matrixWorld.elements[9], -camera.matrixWorld.elements[10]]
  const captured = []
  let floats = false
  try {
    for (let k = 0; k < frames; k++) {
      const jx = k === 0 ? 0 : (halton(k, 2) - 0.5) * 2 * jitter * scale
      const jy = k === 0 ? 0 : (halton(k, 3) - 0.5) * 2 * jitter * scale
      const nx = k === 0 ? 0 : (halton(k, 5) - 0.5) * 2 * nudge
      const ny = k === 0 ? 0 : (halton(k, 7) - 0.5) * 2 * nudge
      const nz = k === 0 ? 0 : (halton(k, 11) - 0.5) * 2 * nudge
      if (camera.setViewOffset) camera.setViewOffset(base.fullWidth, base.fullHeight, base.offsetX + jx, base.offsetY + jy, base.width, base.height)
      camera.position.set(
        saved.position[0] + right[0] * nx + up[0] * ny + forward[0] * nz,
        saved.position[1] + right[1] * nx + up[1] * ny + forward[1] * nz,
        saved.position[2] + right[2] * nx + up[2] * ny + forward[2] * nz,
      )
      camera.updateProjectionMatrix()
      camera.updateMatrixWorld(true)
      renderer.clear(true, true, true)
      original.call(renderer, scene, camera)
      const read = readTarget(renderer, target, width, height)
      floats = read.floats
      captured.push(decodeIds(read.data, width, height, read.floats))
    }
  } finally {
    camera.position.set(...saved.position)
    if (saved.view) camera.view = saved.view
    else if (camera.clearViewOffset) camera.clearViewOffset()
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld(true)
    for (const [object, material] of swaps) object.material = material
    for (const object of hidden) object.visible = true
    scene.background = saved.background
    scene.overrideMaterial = saved.override
    renderer.autoClear = saved.autoClear
    renderer.shadowMap.autoUpdate = saved.autoUpdate
    renderer.setClearColor(clear, saved.alpha)
  }
  return { width, height, floats, frames: captured, table: state.table }
}
