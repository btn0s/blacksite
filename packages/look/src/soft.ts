import { Pass } from 'postprocessing';
import {
  Color, NormalBlending, ShaderMaterial, UniformsLib, UniformsUtils, Vector3, Vector4,
  type AmbientLight, type Camera, type DirectionalLight, type HemisphereLight, type Object3D, type PerspectiveCamera,
  type Scene, type Texture, type WebGLRenderer, type WebGLRenderTarget,
} from 'three';

const frame = {
  softDepth: { value: null as Texture | null },
  softView: { value: new Vector4(1, 1, 0.1, 1000) },
  softSun: { value: new Color(0, 0, 0) },
  softSunDirection: { value: new Vector3(0, 1, 0) },
  softSky: { value: new Color(0, 0, 0) },
  softGround: { value: new Color(0, 0, 0) },
  softUp: { value: new Vector3(0, 1, 0) },
};

const vertexShader = `
#include <common>
#include <fog_pars_vertex>
attribute float size;
attribute float alpha;
attribute float seed;
attribute vec3 tint;
uniform vec4 softView;
varying vec3 vTint;
varying float vAlpha;
varying float vSeed;
varying float vRadius;
varying float vDistance;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vTint = tint;
  vAlpha = alpha;
  vSeed = seed;
  vRadius = size * 0.5;
  vDistance = -mvPosition.z;
  gl_PointSize = alpha <= 0.0 || vDistance <= 0.0 ? 0.0 : size * projectionMatrix[1][1] * 0.5 * softView.y / vDistance;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const fragmentShader = `
#include <common>
#include <packing>
#include <fog_pars_fragment>
uniform sampler2D softDepth;
uniform vec4 softView;
uniform vec3 softSun;
uniform vec3 softSunDirection;
uniform vec3 softSky;
uniform vec3 softGround;
uniform vec3 softUp;
uniform float softness;
uniform float scatter;
varying vec3 vTint;
varying float vAlpha;
varying float vSeed;
varying float vRadius;
varying float vDistance;
float softNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec4 h = fract(sin(vec4(dot(i, vec2(127.1, 311.7)), dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7)), dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7)), dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7)))) * 43758.5453);
  return mix(mix(h.x, h.y, f.x), mix(h.z, h.w, f.x), f.y);
}
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  c.y = -c.y;
  float r2 = dot(c, c);
  if (r2 >= 1.0) discard;
  float angle = vSeed * 6.2831853;
  vec2 q = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * c;
  float density = softNoise(q * 2.3 + vSeed * 31.0) * 0.62 + softNoise(q * 5.1 - vSeed * 17.0) * 0.38;
  float h = sqrt(1.0 - r2);
  float body = smoothstep(0.0, 0.75, h * (0.45 + density) - 0.2);
  float scene = -perspectiveDepthToViewZ(texture2D(softDepth, gl_FragCoord.xy / softView.xy).x, softView.z, softView.w);
  float contact = clamp((scene - vDistance) / max(vRadius * softness, 1e-3), 0.0, 1.0);
  float near = clamp((vDistance - softView.z) / max(vRadius * 2.0, 1e-3), 0.0, 1.0);
  float alpha = vAlpha * body * contact * near;
  if (alpha < 0.002) discard;
  vec3 n = normalize(vec3(c, h));
  float wrapped = max(0.0, (dot(n, softSunDirection) + 0.6) / 1.6);
  float forward = pow(max(0.0, -softSunDirection.z), 4.0);
  vec3 ambient = mix(softGround, softSky, dot(n, softUp) * 0.5 + 0.5);
  vec3 light = ambient + softSun * wrapped * (1.0 + scatter * forward);
  gl_FragColor = vec4(vTint * (0.85 + 0.3 * density) * RECIPROCAL_PI * light, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export interface SoftParticleOptions {
  readonly softness?: number;
  readonly scatter?: number;
}

export function createSoftParticleMaterial({ softness = 1, scatter = 0.8 }: SoftParticleOptions = {}): ShaderMaterial {
  return new ShaderMaterial({
    name: 'look-soft-particles',
    uniforms: { ...UniformsUtils.merge([UniformsLib.fog, { softness: { value: softness }, scatter: { value: scatter } }]), ...frame },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    fog: true,
  });
}

const sunWorld = new Vector3();
const targetWorld = new Vector3();
const scratch = new Color();

export class SoftPass extends Pass {
  private depth: Texture | null = null;

  constructor(scene: Scene, camera: Camera, readonly particles: Scene) {
    super('SoftPass', scene, camera);
    this.needsSwap = false;
    this.needsDepthTexture = true;
  }

  override setDepthTexture(depthTexture: Texture): void {
    this.depth = depthTexture;
  }

  override render(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget): void {
    if (this.particles.children.length === 0 || !this.depth) return;
    const scene = this.scene;
    const camera = this.camera as PerspectiveCamera;
    let sun: DirectionalLight | null = null;
    let hemisphere: HemisphereLight | null = null;
    const sky = frame.softSky.value.setRGB(0, 0, 0);
    const ground = frame.softGround.value.setRGB(0, 0, 0);
    scene.traverseVisible((object: Object3D) => {
      if (!object.layers.test(camera.layers)) return;
      const light = object as DirectionalLight & HemisphereLight & AmbientLight;
      if (light.isDirectionalLight) {
        if (!sun || light.intensity > sun.intensity) sun = light;
      } else if (light.isHemisphereLight) {
        hemisphere ??= light;
        sky.add(scratch.copy(light.color).multiplyScalar(light.intensity));
        ground.add(scratch.copy(light.groundColor).multiplyScalar(light.intensity));
      } else if (light.isAmbientLight) {
        scratch.copy(light.color).multiplyScalar(light.intensity);
        sky.add(scratch);
        ground.add(scratch);
      }
    });
    const view = camera.matrixWorldInverse;
    const found = sun as DirectionalLight | null;
    if (found) {
      frame.softSun.value.copy(found.color).multiplyScalar(found.intensity);
      sunWorld.setFromMatrixPosition(found.matrixWorld);
      targetWorld.setFromMatrixPosition(found.target.matrixWorld);
      frame.softSunDirection.value.subVectors(sunWorld, targetWorld).transformDirection(view);
    } else {
      frame.softSun.value.setRGB(0, 0, 0);
    }
    const up = hemisphere as HemisphereLight | null;
    if (up) frame.softUp.value.setFromMatrixPosition(up.matrixWorld).normalize().transformDirection(view);
    else frame.softUp.value.set(0, 1, 0).transformDirection(view);
    frame.softDepth.value = this.depth;
    frame.softView.value.set(inputBuffer.width, inputBuffer.height, camera.near, camera.far);
    this.particles.fog = scene.fog;
    renderer.setRenderTarget(this.renderToScreen ? null : inputBuffer);
    renderer.render(this.particles, camera);
  }
}
