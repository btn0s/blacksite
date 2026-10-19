import type { Node } from 'three/webgpu'
import { float, min, smoothstep } from 'three/tsl'

export interface ForestCoverage {
  readonly bounds: { readonly min: readonly [number, number]; readonly max: readonly [number, number] }
  readonly edgeFade: number
  readonly range: readonly [number, number]
  readonly spacing: number
  readonly densityScale: number
}

export function forestDomainWeight(forest: ForestCoverage, root: Node<'vec2'>) {
  const edge = min(min(root.x.sub(forest.bounds.min[0]), root.y.sub(forest.bounds.min[1])), min(float(forest.bounds.max[0]).sub(root.x), float(forest.bounds.max[1]).sub(root.y)))
  return smoothstep(0, forest.edgeFade, edge)
}

export function forestRepresentationWeight(forest: ForestCoverage, root: Node<'vec2'>, distance: Node<'float'>) {
  return forestDomainWeight(forest, root).mul(float(1).sub(smoothstep(forest.range[0], forest.range[1], distance)))
}
