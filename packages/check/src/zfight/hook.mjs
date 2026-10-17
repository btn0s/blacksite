export function installHook() {
  if (window.__bsHook) return
  const hook = { renderers: [], scenes: new Set(), renders: new Map(), pending: null, frame: 0, originals: new Map() }
  window.__bsHook = hook
  const devtools = window.__THREE_DEVTOOLS__ ?? new EventTarget()
  window.__THREE_DEVTOOLS__ = devtools
  const wrap = renderer => {
    const original = renderer.render
    hook.originals.set(renderer, original)
    renderer.render = function (scene, camera) {
      hook.frame++
      hook.renders.set(scene, { renderer, camera, frame: hook.frame })
      const pending = hook.pending
      if (pending && pending.scene === scene) {
        hook.pending = null
        try { pending.resolve(pending.run(renderer, original, scene, camera)) } catch (error) { pending.reject(error) }
      }
      return original.apply(this, arguments)
    }
  }
  devtools.addEventListener('observe', event => {
    const object = event.detail
    if (!object) return
    if (object.isScene) hook.scenes.add(object)
    else if (object.isWebGLRenderer && !hook.originals.has(object)) { hook.renderers.push(object); wrap(object) }
  })
}
