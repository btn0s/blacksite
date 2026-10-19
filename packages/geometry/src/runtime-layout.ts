import { struct } from 'three/tsl'

export const clusterLayout = struct({ bounds: 'vec4', selfSphere: 'vec4', parentSphere: 'vec4', errors: 'vec4', draw: 'uvec4' }, 'GeometryCluster')
export const instanceLayout = struct({ transform: 'mat4', normal: 'mat4', scale: 'vec4' }, 'GeometryInstance')
export const vertexLayout = struct({ position: 'vec4', normal: 'vec4' }, 'GeometryVertex')
