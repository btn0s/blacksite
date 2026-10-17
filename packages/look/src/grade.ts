import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import { Data3DTexture, Uniform } from 'three';
import type { GradeSpec } from './atmosphere';

const GRADE_FRAGMENT = `
  uniform float exposure;
  uniform float vignette;
  uniform float split;
  uniform float aberration;
  uniform float grain;
  uniform float saturation;
  uniform float lutSize;
  uniform mediump sampler3D lut;

  vec3 shoulder(vec3 x) {
    vec3 over = max(x - 0.72, 0.0);
    return min(x, vec3(0.72)) + 0.28 * (1.0 - exp(-over / 0.28));
  }

  #ifdef LOOK_FILMIC
    vec3 filmicCurve(vec3 x) {
      return (x * (0.22 * x + 0.03) + 0.002) / (x * (0.22 * x + 0.3) + 0.06) - 0.033333;
    }

    vec3 filmic(vec3 x) {
      return filmicCurve(x * 1.6) / filmicCurve(vec3(9.0));
    }
  #endif

  float grainNoise(vec2 uv) {
    vec2 cell = floor(uv * resolution) + floor(fract(time * 24.0) * 97.0);
    return fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec2 centred = uv - 0.5;
    #ifdef LOOK_ABERRATION
      vec2 fringe = centred * aberration * 0.018;
      vec3 source = vec3(
        texture2D(inputBuffer, uv + fringe).r,
        inputColor.g,
        texture2D(inputBuffer, uv - fringe).b
      );
    #else
      vec3 source = inputColor.rgb;
    #endif
    #ifdef LOOK_FILMIC
      vec3 colour = pow(clamp(filmic(max(source, 0.0) * exposure), 0.0, 1.0), vec3(1.0 / 2.2));
    #else
      vec3 colour = pow(shoulder(max(source, 0.0) * exposure), vec3(1.0 / 2.2));
    #endif
    vec3 base = colour;
    #ifdef LOOK_LUT
      colour = texture(lut, clamp(colour, 0.0, 1.0) * ((lutSize - 1.0) / lutSize) + 0.5 / lutSize).rgb;
    #endif
    float luma = dot(colour, vec3(0.299, 0.587, 0.114));
    float lit = max(
      smoothstep(0.06, 0.45, luma) * smoothstep(0.0, 0.06, base.r - base.b),
      smoothstep(0.55, 0.85, luma)
    );
    vec3 tone = mix(vec3(0.78, 0.94, 1.3), vec3(1.14, 1.0, 0.8), lit);
    colour = mix(colour, colour * tone + vec3(0.004, 0.012, 0.03) * (1.0 - lit), split);
    #ifdef LOOK_SATURATION
      colour = mix(vec3(dot(colour, vec3(0.2126, 0.7152, 0.0722))), colour, saturation);
    #endif
    colour *= 1.0 - dot(centred, centred) * vignette;
    #ifdef LOOK_GRAIN
      colour += grainNoise(uv) * grain;
    #endif
    outputColor = vec4(pow(clamp(colour, 0.0, 1.0), vec3(2.2)), 1.0);
  }
`;

export class GradeEffect extends Effect {
  private readonly empty = new Data3DTexture();

  constructor() {
    super('GradeEffect', GRADE_FRAGMENT, {
      attributes: EffectAttribute.CONVOLUTION,
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, Uniform>([
        ['exposure', new Uniform(1)],
        ['vignette', new Uniform(0)],
        ['split', new Uniform(0)],
        ['aberration', new Uniform(0)],
        ['grain', new Uniform(0)],
        ['saturation', new Uniform(1)],
        ['lutSize', new Uniform(1)],
        ['lut', new Uniform(null)],
      ]),
    });
    this.uniforms.get('lut')!.value = this.empty;
  }

  private toggle(name: string, on: boolean): void {
    if (this.defines.has(name) === on) return;
    if (on) this.defines.set(name, '1');
    else this.defines.delete(name);
    this.setChanged();
  }

  get exposure(): number {
    return this.uniforms.get('exposure')!.value as number;
  }

  set exposure(value: number) {
    this.uniforms.get('exposure')!.value = value;
  }

  get aberration(): number {
    return this.uniforms.get('aberration')!.value as number;
  }

  set aberration(value: number) {
    this.uniforms.get('aberration')!.value = value;
  }

  setGrade(grade: Omit<GradeSpec, 'lut'>): void {
    this.uniforms.get('vignette')!.value = grade.vignette;
    this.uniforms.get('split')!.value = grade.split;
    this.uniforms.get('aberration')!.value = grade.aberration;
    this.uniforms.get('grain')!.value = grade.grain;
    this.uniforms.get('saturation')!.value = grade.saturation ?? 1;
    this.toggle('LOOK_FILMIC', grade.curve === 'filmic');
    this.toggle('LOOK_SATURATION', grade.saturation !== undefined && grade.saturation !== 1);
  }

  setLut(texture: Data3DTexture | null, size = texture?.image.width ?? 1): void {
    this.uniforms.get('lut')!.value = texture ?? this.empty;
    this.uniforms.get('lutSize')!.value = size;
    this.toggle('LOOK_LUT', texture !== null);
  }

  setFeatures(features: { readonly aberration: boolean; readonly grain: boolean }): void {
    this.toggle('LOOK_ABERRATION', features.aberration);
    this.toggle('LOOK_GRAIN', features.grain);
  }

  override dispose(): void {
    this.empty.dispose();
    super.dispose();
  }
}
