declare module 'three/addons/tsl/lighting/LightProbeGridNode.js' {
  import { AnalyticLightNode } from 'three/webgpu'
  import type { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js'
  export class LightProbeGridNode extends AnalyticLightNode<LightProbeGrid> {}
}
