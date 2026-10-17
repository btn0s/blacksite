import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import { Matrix4, Uniform, Vector3, Vector4 } from 'three';
import type { Camera, WebGLRenderer, WebGLRenderTarget } from 'three';
import type { Atmosphere } from './atmosphere';
import { ATMOSPHERE_CORE } from './physical';
import type { AtmosphereLuts } from './physical';

const AERIAL_FRAGMENT = `
  ${ATMOSPHERE_CORE}
  uniform mat4 atProjectionInverse;
  uniform mat4 atCameraWorld;
  uniform float atAerial;
  uniform float atElevation;
  uniform vec4 atFog;
  uniform vec3 atFogTint;

  float atLayer(float h0, float h1, float span, float scale) {
    float a = exp(-h0 / scale);
    float b = exp(-h1 / scale);
    float dh = h1 - h0;
    return abs(dh) < 1e-3 * scale ? span * 0.5 * (a + b) : span * scale * (a - b) / dh;
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
    float d = depth;
    #ifdef AT_EDGES
      if (d >= 1.0) {
        vec4 around = vec4(readDepth(uv + vec2(texelSize.x, 0.0)), readDepth(uv - vec2(texelSize.x, 0.0)), readDepth(uv + vec2(0.0, texelSize.y)), readDepth(uv - vec2(0.0, texelSize.y)));
        d = min(min(around.x, around.y), min(around.z, around.w));
      }
    #endif
    if (d >= 1.0) {
      outputColor = inputColor;
      return;
    }
    vec4 ray = atProjectionInverse * vec4(uv * 2.0 - 1.0, 0.5, 1.0);
    vec3 view = ray.xyz / ray.w;
    vec3 point = view * (getViewZ(d) / view.z);
    float span = length(point);
    vec3 direction = normalize(mat3(atCameraWorld) * point);
    float y0 = atCameraWorld[3].y;
    float y1 = y0 + direction.y * span;
    float km = span * 0.001;
    float h0 = max(y0 + atElevation, 0.0) * 0.001;
    float h1 = max(y1 + atElevation, 0.0) * 0.001;
    vec3 tauAir = (atRayleigh * atLayer(h0, h1, km, 8.0) + atMieExtinction * atLayer(h0, h1, km, 1.2)) * atAerial;
    float tauFog = atFog.x > 0.0 ? atFog.x * atLayer(max(y0 - atFog.y, 0.0), max(y1 - atFog.y, 0.0), span, atFog.z) : 0.0;
    vec3 tau = (tauAir + tauFog) * clamp(1.0 - atClear / max(span, 1.0), 0.0, 1.0);
    vec3 transmittance = exp(-tau);
    vec3 horizon = normalize(vec3(direction.x, max(direction.y, 0.0), direction.z));
    vec3 air = atSky(horizon);
    vec3 fog = air;
    if (atFog.x > 0.0) {
      float r = AT_RG + atAltitude;
      vec3 sunlight = atSunlight(r, atSun.y) * atPhaseHg(dot(direction, atSun), 0.55);
      fog = atFogTint * (atSky(vec3(0.0, 1.0, 0.0)) * 0.55 + air * 0.45 + sunlight);
    }
    vec3 weight = vec3(tauFog) / max(tauAir + tauFog, vec3(1e-6));
    vec3 inscatter = mix(air, fog, weight) * (1.0 - transmittance);
    outputColor = vec4(inputColor.rgb * transmittance + inscatter, inputColor.a);
  }
`;

export class AerialEffect extends Effect {
  private readonly camera: Camera;

  constructor(camera: Camera, luts: AtmosphereLuts) {
    const shared = Object.entries(luts.uniforms) as [string, Uniform][];
    super('AerialEffect', AERIAL_FRAGMENT, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, Uniform>([
        ...shared,
        ['atProjectionInverse', new Uniform(new Matrix4())],
        ['atCameraWorld', new Uniform(new Matrix4())],
        ['atAerial', new Uniform(1)],
        ['atElevation', new Uniform(0)],
        ['atFog', new Uniform(new Vector4())],
        ['atFogTint', new Uniform(new Vector3(1, 1, 1))],
      ]),
    });
    this.camera = camera;
  }

  setEdges(on: boolean): void {
    if (this.defines.has('AT_EDGES') === on) return;
    if (on) this.defines.set('AT_EDGES', '1');
    else this.defines.delete('AT_EDGES');
    this.setChanged();
  }

  setAtmosphere(atmosphere: Atmosphere): void {
    const spec = atmosphere.physical;
    if (!spec) return;
    this.uniforms.get('atAerial')!.value = spec.aerial;
    this.uniforms.get('atElevation')!.value = spec.elevation;
    const fog = spec.heightFog;
    (this.uniforms.get('atFog')!.value as Vector4).set(fog ? fog.density : 0, fog?.base ?? 0, Math.max(fog?.falloff ?? 1, 1), 0);
    (this.uniforms.get('atFogTint')!.value as Vector3).set(...(fog?.tint ?? [1, 1, 1]));
  }

  override update(_renderer: WebGLRenderer, _input: WebGLRenderTarget, _dt?: number): void {
    (this.uniforms.get('atProjectionInverse')!.value as Matrix4).copy(this.camera.projectionMatrixInverse);
    (this.uniforms.get('atCameraWorld')!.value as Matrix4).copy(this.camera.matrixWorld);
  }
}
