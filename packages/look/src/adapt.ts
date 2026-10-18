import { HalfFloatType, LinearFilter, LinearMipmapLinearFilter, Mesh, NearestFilter, OrthographicCamera, PlaneGeometry, RGBAFormat, Scene, ShaderMaterial, WebGLRenderTarget } from 'three';
import type { Texture, WebGLRenderer } from 'three';

const VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const MEASURE = `
  uniform sampler2D inputBuffer;
  uniform vec2 texel;
  varying vec2 vUv;
  float logLuma(vec2 uv) {
    vec3 colour = texture2D(inputBuffer, uv).rgb;
    return log(max(dot(colour, vec3(0.2126, 0.7152, 0.0722)), 1e-4));
  }
  void main() {
    float sum = logLuma(vUv + texel * vec2(-0.25, -0.25)) + logLuma(vUv + texel * vec2(0.25, -0.25)) + logLuma(vUv + texel * vec2(-0.25, 0.25)) + logLuma(vUv + texel * vec2(0.25, 0.25));
    gl_FragColor = vec4(sum * 0.25, 0.0, 0.0, 1.0);
  }
`;

const ADAPT = `
  uniform sampler2D measured;
  uniform sampler2D previous;
  uniform float level;
  uniform float blend;
  void main() {
    float target = textureLod(measured, vec2(0.5), level).r;
    gl_FragColor = vec4(mix(texture2D(previous, vec2(0.5)).r, target, blend), 0.0, 0.0, 1.0);
  }
`;

const SIZE = 64;

export class EyeAdaptation {
  private readonly measured = new WebGLRenderTarget(SIZE, SIZE, { type: HalfFloatType, format: RGBAFormat, depthBuffer: false, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, generateMipmaps: true });
  private targets = [0, 1].map(() => new WebGLRenderTarget(1, 1, { type: HalfFloatType, format: RGBAFormat, depthBuffer: false, minFilter: NearestFilter, magFilter: NearestFilter }));
  private readonly measure = new ShaderMaterial({ vertexShader: VERTEX, fragmentShader: MEASURE, uniforms: { inputBuffer: { value: null }, texel: { value: [1 / SIZE, 1 / SIZE] } }, depthTest: false, depthWrite: false });
  private readonly adapt = new ShaderMaterial({ vertexShader: VERTEX, fragmentShader: ADAPT, uniforms: { measured: { value: this.measured.texture }, previous: { value: null }, level: { value: Math.log2(SIZE) }, blend: { value: 1 } }, depthTest: false, depthWrite: false });
  private readonly quad = new Mesh(new PlaneGeometry(2, 2), this.measure);
  private readonly scene = new Scene().add(this.quad);
  private readonly camera = new OrthographicCamera();
  private primed = false;

  rate = 1.5;

  get texture(): Texture {
    return this.targets[0]!.texture;
  }

  update(renderer: WebGLRenderer, input: Texture, dt: number): void {
    const previous = renderer.getRenderTarget();
    this.measure.uniforms.inputBuffer!.value = input;
    this.quad.material = this.measure;
    renderer.setRenderTarget(this.measured);
    renderer.render(this.scene, this.camera);
    const [last, next] = this.targets as [WebGLRenderTarget, WebGLRenderTarget];
    this.adapt.uniforms.previous!.value = last.texture;
    this.adapt.uniforms.blend!.value = this.primed ? 1 - Math.exp(-Math.max(dt, 0) * this.rate) : 1;
    this.quad.material = this.adapt;
    renderer.setRenderTarget(next);
    renderer.render(this.scene, this.camera);
    this.targets = [next, last];
    this.primed = true;
    renderer.setRenderTarget(previous);
  }

  reset(): void {
    this.primed = false;
  }

  dispose(): void {
    this.measured.dispose();
    for (const target of this.targets) target.dispose();
    this.measure.dispose();
    this.adapt.dispose();
    this.quad.geometry.dispose();
  }
}
