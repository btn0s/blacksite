import type { Material, WebGLProgramParametersWithUniforms, WebGLRenderer } from 'three'

export type ShaderPatch = (shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer) => void

const keys = new WeakMap<Material, string[]>()

export function patchMaterial(material: Material, key: string, patch: ShaderPatch): void {
  const previous = material.onBeforeCompile
  material.onBeforeCompile = function (this: Material, shader, renderer) {
    previous.call(this, shader, renderer)
    patch(shader, renderer)
  }
  const list = keys.get(material) ?? []
  list.push(key)
  keys.set(material, list)
  material.customProgramCacheKey = () => list.join('|')
  material.needsUpdate = true
}

export function replaceChunk(source: string, chunk: string, replacement: string): string {
  const token = `#include <${chunk}>`
  if (!source.includes(token)) throw new Error(`Shader chunk ${chunk} not found`)
  return source.replace(token, replacement)
}
