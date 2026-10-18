import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import { HalfFloatType, LinearFilter, Matrix4, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, Uniform, Vector2, Vector3, WebGLRenderTarget } from 'three';
import type { Camera, Texture, WebGLRenderer } from 'three';
import { LIGHT_CHUNK } from './bake';
import type { BakedLight } from './bake';
import type { Rgb } from './atmosphere';

const VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const MARCH = `
  precision highp float;
  ${LIGHT_CHUNK}
  uniform highp sampler2D depthBuffer;
  uniform mat4 shaftProjectionInverse;
  uniform mat4 shaftWorld;
  uniform vec3 shaftCamera;
  uniform vec3 shaftSunDirection;
  uniform vec3 shaftColor;
  uniform float shaftDensity;
  varying vec2 vUv;

  void main() {
    float depth = texture2D(depthBuffer, vUv).r;
    vec4 view = shaftProjectionInverse * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec3 world = (shaftWorld * vec4(view.xyz / view.w, 1.0)).xyz;
    vec3 ray = world - shaftCamera;
    float reach = length(ray);
    ray /= reach;
    vec3 inverse = 1.0 / ray;
    vec3 a = (lookSkyMin - shaftCamera) * inverse;
    vec3 b = (lookSkyMin + lookSkySize - shaftCamera) * inverse;
    vec3 lower = min(a, b);
    vec3 upper = max(a, b);
    float enter = max(max(max(lower.x, lower.y), lower.z), 0.0);
    float leave = min(min(min(upper.x, upper.y), upper.z), reach);
    if (leave <= enter) {
      gl_FragColor = vec4(0.0);
      return;
    }
    float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float stride = (leave - enter) / float(SHAFT_STEPS);
    float sum = 0.0;
    for (int i = 0; i < SHAFT_STEPS; i++) {
      vec3 point = shaftCamera + ray * (enter + (float(i) + jitter) * stride);
      float enclosed = 1.0 - clamp(lookSkyAt(point).x * 1.6, 0.0, 1.0);
      sum += lookSunAt(point) * enclosed;
    }
    float cosine = dot(ray, shaftSunDirection);
    float phase = 0.3 + 0.7 * 0.75 / pow(1.25 - cosine, 1.5);
    gl_FragColor = vec4(shaftColor * (sum * stride * shaftDensity * phase), 1.0);
  }
`;

const BLUR = `
  uniform sampler2D source;
  uniform vec2 direction;
  varying vec2 vUv;
  void main() {
    vec3 sum = texture2D(source, vUv).rgb * 0.2270270;
    sum += (texture2D(source, vUv + direction * 1.3846154).rgb + texture2D(source, vUv - direction * 1.3846154).rgb) * 0.3162162;
    sum += (texture2D(source, vUv + direction * 3.2307692).rgb + texture2D(source, vUv - direction * 3.2307692).rgb) * 0.0702703;
    gl_FragColor = vec4(sum, 1.0);
  }
`;

const COMPOSITE = `
  uniform sampler2D shaftBuffer;
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    outputColor = vec4(inputColor.rgb + texture2D(shaftBuffer, uv).rgb, inputColor.a);
  }
`;

export class ShaftEffect extends Effect {
  private readonly camera: Camera;
  private readonly targets = [0, 1].map(() => new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter })) as [WebGLRenderTarget, WebGLRenderTarget];
  private readonly march: ShaderMaterial;
  private readonly blur = new ShaderMaterial({ vertexShader: VERTEX, fragmentShader: BLUR, uniforms: { source: { value: null }, direction: { value: new Vector2() } }, depthTest: false, depthWrite: false });
  private readonly quad = new Mesh(new PlaneGeometry(2, 2));
  private readonly scene = new Scene().add(this.quad);
  private readonly ortho = new OrthographicCamera();

  constructor(camera: Camera, baked: BakedLight, steps: number) {
    super('ShaftEffect', COMPOSITE, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, Uniform>([['shaftBuffer', new Uniform(null)]]),
    });
    this.camera = camera;
    this.march = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: MARCH,
      defines: { SHAFT_STEPS: steps },
      uniforms: {
        ...baked.uniforms,
        depthBuffer: new Uniform(null),
        shaftProjectionInverse: new Uniform(new Matrix4()),
        shaftWorld: new Uniform(new Matrix4()),
        shaftCamera: new Uniform(new Vector3()),
        shaftSunDirection: new Uniform(new Vector3(0, 1, 0)),
        shaftColor: new Uniform(new Vector3()),
        shaftDensity: new Uniform(baked.options.haze ?? 0.05),
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quad.frustumCulled = false;
    this.uniforms.get('shaftBuffer')!.value = this.targets[0].texture;
  }

  setSun(direction: Rgb, color: Rgb, strength: number): void {
    (this.march.uniforms.shaftSunDirection!.value as Vector3).set(...direction).normalize();
    (this.march.uniforms.shaftColor!.value as Vector3).set(...color).multiplyScalar(strength);
  }

  setSteps(steps: number): void {
    if (this.march.defines.SHAFT_STEPS === steps) return;
    this.march.defines.SHAFT_STEPS = steps;
    this.march.needsUpdate = true;
  }

  override setDepthTexture(depthTexture: Texture): void {
    this.march.uniforms.depthBuffer!.value = depthTexture;
  }

  override setSize(width: number, height: number): void {
    for (const target of this.targets) target.setSize(Math.max(1, Math.ceil(width / 2)), Math.max(1, Math.ceil(height / 2)));
  }

  override update(renderer: WebGLRenderer): void {
    const uniforms = this.march.uniforms;
    uniforms.shaftProjectionInverse!.value.copy((this.camera as Camera & { projectionMatrixInverse: Matrix4 }).projectionMatrixInverse);
    uniforms.shaftWorld!.value.copy(this.camera.matrixWorld);
    (uniforms.shaftCamera!.value as Vector3).setFromMatrixPosition(this.camera.matrixWorld);
    const [first, second] = this.targets;
    this.quad.material = this.march;
    renderer.setRenderTarget(first);
    renderer.render(this.scene, this.ortho);
    this.quad.material = this.blur;
    const direction = this.blur.uniforms.direction!.value as Vector2;
    this.blur.uniforms.source!.value = first.texture;
    direction.set(1 / first.width, 0);
    renderer.setRenderTarget(second);
    renderer.render(this.scene, this.ortho);
    this.blur.uniforms.source!.value = second.texture;
    direction.set(0, 1 / first.height);
    renderer.setRenderTarget(first);
    renderer.render(this.scene, this.ortho);
  }

  override dispose(): void {
    for (const target of this.targets) target.dispose();
    this.march.dispose();
    this.blur.dispose();
    this.quad.geometry.dispose();
    super.dispose();
  }
}
