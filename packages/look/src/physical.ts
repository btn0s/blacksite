import {
  BackSide, BufferGeometry, ClampToEdgeWrapping, Float32BufferAttribute, HalfFloatType, LinearFilter, Mesh, OrthographicCamera, PMREMGenerator,
  RGBAFormat, Scene, ShaderMaterial, SphereGeometry, Uniform, Vector2, Vector3, WebGLRenderTarget,
} from 'three';
import type { DirectionalLight, Texture, WebGLRenderer } from 'three';
import type { Atmosphere, PhysicalSkySpec } from './atmosphere';
import type { QualitySettings } from './quality';
import type { Sky } from './sky';
import { OZONE, RAYLEIGH } from './coefficients';

const TRANSMITTANCE_SIZE = [256, 64] as const;
const MULTI_SIZE = 32;
const SUN_RADIUS = 0.004675;

export const ATMOSPHERE_CORE = `
  #define AT_PI 3.141592653589793
  #define AT_RG 6360.0
  #define AT_RT 6460.0
  uniform sampler2D atTransmittanceLut;
  uniform sampler2D atMultiLut;
  uniform sampler2D atSkyViewLut;
  uniform vec2 atViewSize;
  uniform vec3 atRayleigh;
  uniform float atMieScattering;
  uniform float atMieExtinction;
  uniform float atGroundAlbedo;
  uniform float atMieG;
  uniform vec3 atOzone;
  uniform float atAltitude;
  uniform vec3 atSun;
  uniform float atIlluminance;
  uniform float atSkyGain;
  uniform float atClear;

  vec3 atExtinction(float h, out vec3 rayleigh, out float mie) {
    float height = max(h, 0.0);
    rayleigh = atRayleigh * exp(-height / 8.0);
    float aerosol = exp(-height / 1.2);
    mie = atMieScattering * aerosol;
    return rayleigh + atMieExtinction * aerosol + atOzone * max(0.0, 1.0 - abs(height - 25.0) / 15.0);
  }

  vec2 atRaySphere(vec3 origin, vec3 direction, float radius) {
    float b = dot(origin, direction);
    float c = dot(origin, origin) - radius * radius;
    float d = b * b - c;
    if (d < 0.0) return vec2(-1.0);
    float s = sqrt(d);
    return vec2(-b - s, -b + s);
  }

  float atRho(float r) {
    return sqrt(max(0.0, (r - AT_RG) * (r + AT_RG)));
  }

  vec2 atTransmittanceUv(float r, float mu) {
    float top = sqrt(AT_RT * AT_RT - AT_RG * AT_RG);
    float rho = atRho(r);
    float d = max(0.0, -r * mu + sqrt(max(r * r * (mu * mu - 1.0) + AT_RT * AT_RT, 0.0)));
    float dMin = AT_RT - r;
    float dMax = rho + top;
    return vec2((d - dMin) / (dMax - dMin), rho / top);
  }

  float atToSub(float u, float size) {
    return (u + 0.5 / size) * (size / (size + 1.0));
  }

  float atFromSub(float u, float size) {
    return (u - 0.5 / size) * (size / (size - 1.0));
  }

  float atPhaseRayleigh(float c) {
    return 3.0 / (16.0 * AT_PI) * (1.0 + c * c);
  }

  float atPhaseMie(float c, float g) {
    float g2 = g * g;
    return 3.0 / (8.0 * AT_PI) * ((1.0 - g2) * (1.0 + c * c)) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
  }

  float atPhaseHg(float c, float g) {
    float g2 = g * g;
    return (1.0 - g2) / (4.0 * AT_PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
  }

  bool atSunHidden(float r, float mu) {
    return mu < -atRho(r) / r;
  }

  vec3 atTransmittance(float r, float mu) {
    return texture2D(atTransmittanceLut, atTransmittanceUv(r, mu)).rgb;
  }

  vec2 atSkyViewUv(vec3 direction) {
    float r = AT_RG + atAltitude;
    float cosBeta = atRho(r) / r;
    float beta = acos(clamp(cosBeta, -1.0, 1.0));
    float zenithHorizon = AT_PI - beta;
    float vz = clamp(direction.y, -1.0, 1.0);
    vec2 uv;
    if (vz >= -cosBeta) uv.y = (1.0 - sqrt(max(1.0 - acos(vz) / zenithHorizon, 0.0))) * 0.5;
    else uv.y = sqrt(max((acos(vz) - zenithHorizon) / beta, 0.0)) * 0.5 + 0.5;
    float dl = length(direction.xz);
    float sl = length(atSun.xz);
    float lv = dl > 1e-5 && sl > 1e-5 ? clamp(dot(direction.xz, atSun.xz) / (dl * sl), -1.0, 1.0) : 1.0;
    uv.x = sqrt(max(0.5 - lv * 0.5, 0.0));
    return vec2(atToSub(uv.x, atViewSize.x), atToSub(uv.y, atViewSize.y));
  }

  vec3 atSky(vec3 direction) {
    return texture2D(atSkyViewLut, atSkyViewUv(direction)).rgb * atIlluminance;
  }

  vec3 atSunlight(float r, float mu) {
    return atTransmittance(r, mu) * atIlluminance;
  }
`;

const LUT_VERTEX = `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const TRANSMITTANCE_FRAGMENT = `
  ${ATMOSPHERE_CORE}
  void main() {
    vec2 uv = gl_FragCoord.xy / vec2(${TRANSMITTANCE_SIZE[0]}.0, ${TRANSMITTANCE_SIZE[1]}.0);
    float top = sqrt(AT_RT * AT_RT - AT_RG * AT_RG);
    float rho = top * uv.y;
    float r = sqrt(rho * rho + AT_RG * AT_RG);
    float dMin = AT_RT - r;
    float dMax = rho + top;
    float d = dMin + uv.x * (dMax - dMin);
    float mu = d > 0.0 ? clamp((top * top - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0) : 1.0;
    vec3 origin = vec3(0.0, r, 0.0);
    vec3 direction = vec3(sqrt(max(0.0, 1.0 - mu * mu)), mu, 0.0);
    float span = atRaySphere(origin, direction, AT_RT).y;
    float dt = span / 40.0;
    vec3 depth = vec3(0.0);
    vec3 rayleigh;
    float mie;
    for (int i = 0; i < 40; i++) {
      vec3 p = origin + direction * ((float(i) + 0.5) * dt);
      depth += atExtinction(length(p) - AT_RG, rayleigh, mie) * dt;
    }
    gl_FragColor = vec4(exp(-depth), 1.0);
  }
`;

const MULTI_FRAGMENT = `
  ${ATMOSPHERE_CORE}
  void main() {
    vec2 uv = gl_FragCoord.xy / ${MULTI_SIZE}.0;
    uv = vec2(atFromSub(uv.x, ${MULTI_SIZE}.0), atFromSub(uv.y, ${MULTI_SIZE}.0));
    float cosSun = uv.x * 2.0 - 1.0;
    float r = AT_RG + max(uv.y * (AT_RT - AT_RG), 0.01);
    vec3 origin = vec3(0.0, r, 0.0);
    vec3 sun = vec3(sqrt(max(0.0, 1.0 - cosSun * cosSun)), cosSun, 0.0);
    vec3 total = vec3(0.0);
    vec3 transfer = vec3(0.0);
    vec3 rayleigh;
    float mie;
    for (int a = 0; a < 8; a++) {
      for (int b = 0; b < 8; b++) {
        float theta = acos(1.0 - 2.0 * (float(b) + 0.5) / 8.0);
        float phi = 2.0 * AT_PI * (float(a) + 0.5) / 8.0;
        vec3 direction = vec3(sin(theta) * cos(phi), cos(theta), sin(theta) * sin(phi));
        float span = atRaySphere(origin, direction, AT_RT).y;
        float ground = atRaySphere(origin, direction, AT_RG).x;
        bool hitsGround = ground > 0.0;
        if (hitsGround) span = ground;
        float dt = span / 20.0;
        vec3 throughput = vec3(1.0);
        vec3 light = vec3(0.0);
        vec3 scatterSum = vec3(0.0);
        for (int s = 0; s < 20; s++) {
          vec3 p = origin + direction * ((float(s) + 0.5) * dt);
          float pr = length(p);
          vec3 extinction = max(atExtinction(pr - AT_RG, rayleigh, mie), vec3(1e-9));
          vec3 scattering = rayleigh + vec3(mie);
          vec3 step = exp(-extinction * dt);
          float mu = dot(p, sun) / pr;
          vec3 sunT = atSunHidden(pr, mu) ? vec3(0.0) : atTransmittance(pr, mu);
          vec3 source = scattering * sunT / (4.0 * AT_PI);
          light += throughput * (source - source * step) / extinction;
          scatterSum += throughput * (scattering - scattering * step) / extinction;
          throughput *= step;
        }
        if (hitsGround) {
          vec3 normal = normalize(origin + direction * span);
          float mu = dot(normal, sun);
          light += throughput * atTransmittance(AT_RG, mu) * max(mu, 0.0) * atGroundAlbedo / AT_PI;
        }
        total += light;
        transfer += scatterSum;
      }
    }
    total /= 64.0;
    transfer /= 64.0;
    gl_FragColor = vec4(total / (1.0 - transfer), 1.0);
  }
`;

const SKY_VIEW_FRAGMENT = `
  ${ATMOSPHERE_CORE}
  void main() {
    vec2 uv = gl_FragCoord.xy / atViewSize;
    uv = vec2(atFromSub(uv.x, atViewSize.x), atFromSub(uv.y, atViewSize.y));
    float r = AT_RG + atAltitude;
    float cosBeta = atRho(r) / r;
    float beta = acos(clamp(cosBeta, -1.0, 1.0));
    float zenithHorizon = AT_PI - beta;
    float zenith;
    if (uv.y < 0.5) {
      float c = 1.0 - 2.0 * uv.y;
      zenith = zenithHorizon * (1.0 - c * c);
    } else {
      float c = uv.y * 2.0 - 1.0;
      zenith = zenithHorizon + beta * c * c;
    }
    float lv = -(uv.x * uv.x * 2.0 - 1.0);
    vec3 direction = vec3(sin(zenith) * lv, cos(zenith), sin(zenith) * sqrt(max(0.0, 1.0 - lv * lv)));
    float sunMu = normalize(atSun).y;
    vec3 sun = vec3(sqrt(max(0.0, 1.0 - sunMu * sunMu)), sunMu, 0.0);
    vec3 origin = vec3(0.0, r, 0.0);
    float span = atRaySphere(origin, direction, AT_RT).y;
    float ground = atRaySphere(origin, direction, AT_RG).x;
    if (ground > 0.0) span = ground;
    float c = dot(direction, sun);
    float phaseR = atPhaseRayleigh(c);
    float phaseM = atPhaseMie(c, atMieG);
    vec3 light = vec3(0.0);
    vec3 throughput = vec3(1.0);
    float previous = 0.0;
    vec3 rayleigh;
    float mie;
    for (int i = 0; i < AT_VIEW_STEPS; i++) {
      float f = (float(i) + 1.0) / float(AT_VIEW_STEPS);
      float next = span * f * f;
      float dt = next - previous;
      vec3 p = origin + direction * (previous + dt * 0.3);
      previous = next;
      float pr = length(p);
      float h = pr - AT_RG;
      vec3 extinction = max(atExtinction(h, rayleigh, mie), vec3(1e-9));
      float mu = dot(p, sun) / pr;
      vec3 sunT = atSunHidden(pr, mu) ? vec3(0.0) : atTransmittance(pr, mu);
      vec2 msUv = vec2(atToSub(mu * 0.5 + 0.5, ${MULTI_SIZE}.0), atToSub(clamp(h / (AT_RT - AT_RG), 0.0, 1.0), ${MULTI_SIZE}.0));
      vec3 multi = texture2D(atMultiLut, msUv).rgb;
      vec3 source = sunT * (rayleigh * phaseR + vec3(mie * phaseM)) + multi * (rayleigh + vec3(mie));
      vec3 step = exp(-extinction * dt);
      light += throughput * (source - source * step) / extinction;
      throughput *= step;
    }
    gl_FragColor = vec4(light, 1.0);
  }
`;

const CLOUD_GLSL = `
  uniform float cloudCoverage;
  uniform float cloudAltitude;
  uniform float cloudDensity;
  uniform float cloudScale;
  uniform float cloudTime;

  uint cloudHash(uint v) {
    uint s = v * 747796405u + 2891336453u;
    uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
    return (w >> 22u) ^ w;
  }

  vec2 cloudGradient(vec2 cell) {
    ivec2 i = ivec2(cell);
    uint h = cloudHash(uint(i.x) * 1664525u + cloudHash(uint(i.y) + 1013904223u));
    float a = float(h) * (6.28318530718 / 4294967296.0);
    return vec2(cos(a), sin(a));
  }

  float cloudNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = p - i;
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float a = dot(cloudGradient(i), f);
    float b = dot(cloudGradient(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
    float c = dot(cloudGradient(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
    float d = dot(cloudGradient(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float cloudFbm(vec2 p, float footprint, int octaves) {
    float sum = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    vec2 q = p;
    for (int i = 0; i < CLOUD_OCTAVES; i++) {
      if (i >= octaves) break;
      float n = cloudNoise(q);
      if (i >= 1) n = mix(n, abs(n) * 2.0 - 0.38, 0.3);
      sum += amplitude * n * (1.0 - smoothstep(0.18, 0.45, footprint * frequency));
      q = mat2(0.8, 0.6, -0.6, 0.8) * q * 2.03 + vec2(13.1, 7.7);
      frequency *= 2.03;
      amplitude *= 0.56;
    }
    return sum;
  }

  float cloudEdge(vec2 q, float footprint, int octaves) {
    vec2 p = q * 0.38 * cloudScale + vec2(cloudTime * 0.004, cloudTime * 0.0012);
    p += vec2(cloudNoise(p * 0.3 + vec2(1.7, 9.2)), cloudNoise(p * 0.3 + vec2(8.3, 2.8))) * 0.5;
    float base = cloudFbm(p, footprint * 0.65 * cloudScale, octaves) * 1.3 + 0.5;
    return base + cloudNoise(q * 0.05 * cloudScale + vec2(3.1, 1.3)) * 0.7 - (1.0 - cloudCoverage);
  }

  float cloudSoft(float footprint) {
    return 0.62 + min(footprint * 0.65 * cloudScale, 1.0) * 0.3;
  }

  float cloudAmount(vec2 q, float footprint, int octaves) {
    return clamp(cloudEdge(q, footprint, octaves) / cloudSoft(footprint), 0.0, 1.0);
  }

  vec4 cloudLayer(vec3 direction, float pixel, out float edge) {
    float r = AT_RG + atAltitude;
    vec3 origin = vec3(0.0, r, 0.0);
    float t = atRaySphere(origin, direction, AT_RG + cloudAltitude).y;
    vec3 p = origin + direction * t;
    vec3 up = p / length(p);
    float mu = max(dot(up, direction), 0.03);
    vec2 along = direction.xz / max(length(direction.xz), 1e-4);
    vec2 q = p.xz - along * dot(p.xz, along) * (1.0 - mix(0.45, 1.0, smoothstep(0.04, 0.35, mu))) + cameraPosition.xz * 0.001;
    float footprint = t * pixel / mu;
    edge = cloudEdge(q, footprint, CLOUD_OCTAVES);
    float aa = fwidth(edge);
    float fade = 1.0 - smoothstep(26.0, 52.0, t);
    float d = clamp(edge / cloudSoft(footprint), 0.0, 1.0) * fade;
    if (d <= 0.002) return vec4(0.0);
    vec2 toward = atSun.xz / max(length(atSun.xz), 1e-4);
    float s1 = cloudAmount(q + toward * 0.08, footprint, CLOUD_OCTAVES - 1) * fade;
    float s2 = CLOUD_SHADOW > 1 ? cloudAmount(q + toward * 0.25, footprint, CLOUD_OCTAVES - 2) * fade : s1;
    float s3 = CLOUD_SHADOW > 2 ? cloudAmount(q + toward * 0.6, footprint, CLOUD_OCTAVES - 3) * fade : s2;
    float tau = d * cloudDensity / mu;
    float alpha = 1.0 - exp(-tau);
    float shadow = exp(-(d * 0.5 + s1 * 0.6 + s2 + s3 * 0.7) * cloudDensity * 0.55);
    vec3 sun = atSunlight(AT_RG + cloudAltitude, dot(up, atSun));
    float c = dot(direction, atSun);
    float phase = mix(atPhaseHg(c, 0.75), atPhaseHg(c, -0.2), 0.25);
    float forward = smoothstep(-0.2, 0.7, c);
    vec3 single = sun * shadow * phase * mix(alpha * 0.55, tau * exp(-tau) * 2.2, forward) * 3.0;
    float rim = smoothstep(0.0, 1.0, clamp((d - s1) * 1.2, 0.0, 1.0));
    float side = 1.0 - smoothstep(0.05, 0.45, mu);
    float rise = clamp((d - cloudAmount(q + along * 0.12, footprint, CLOUD_OCTAVES - 1) * fade) * 3.0 + 0.5, 0.0, 1.0);
    single *= mix(1.0, (0.75 + 0.6 * rim) * mix(0.8, 1.2, rise), side * 0.6);
    vec3 multiple = sun * (0.06 + 0.08 * rim + 0.04 * rise * side) * mix(1.0, shadow, 0.5) * alpha * (0.25 + 0.75 * smoothstep(-0.3, 0.9, c));
    vec3 ambient = (atSky(normalize(vec3(direction.x, 0.03, direction.z))) * 0.26 + atSky(vec3(0.0, 1.0, 0.0)) * 0.42) * atSkyGain * alpha * (1.0 - 0.35 * d) * mix(1.0, mix(0.9, 1.1, rise), side);
    vec4 result = vec4(single + multiple + ambient, alpha);
    result *= smoothstep(0.0, aa * 1.5 + 1e-6, edge);
    float haze = exp(-t * 0.02);
    return vec4(result.rgb * haze, result.a * haze);
  }
`;

const SKY_VERTEX = `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
    gl_Position = clip.xyww;
    #ifdef USE_REVERSED_DEPTH_BUFFER
      gl_Position.z = 0.0;
    #endif
  }
`;

const SKY_FRAGMENT = `
  ${ATMOSPHERE_CORE}
  uniform float exposure;
  uniform float atDisk;
  uniform float atDiskRadius;
  varying vec3 vDirection;
  #ifdef CLOUDS
    ${CLOUD_GLSL}
  #endif

  vec3 sunDisk(vec3 direction, float pixel) {
    float angle = sqrt(max(2.0 * (1.0 - dot(direction, atSun)), 0.0));
    float edge = 1.0 - smoothstep(atDiskRadius - pixel, atDiskRadius + pixel, angle);
    if (edge <= 0.0) return vec3(0.0);
    float x = min(angle / atDiskRadius, 1.0);
    vec3 limb = vec3(1.0) - vec3(0.397, 0.503, 0.652) * (1.0 - sqrt(max(1.0 - x * x, 0.0)));
    return atDisk * limb * edge * atTransmittance(AT_RG + atAltitude, max(direction.y, -0.01));
  }

  void main() {
    vec3 view = normalize(vDirection);
    float pixel = max(length(fwidth(view)), 1e-5);
    vec3 direction = normalize(vec3(view.x, max(view.y, 0.0005), view.z));
    vec3 colour = atSky(direction) * atSkyGain;
    float visible = 1.0;
    #ifdef CLOUDS
      float edge;
      vec4 cloud = cloudLayer(direction, pixel, edge);
      colour = colour * (1.0 - cloud.a) + cloud.rgb;
      visible = 1.0 - cloud.a;
    #endif
    colour += sunDisk(view, pixel) * visible;
    gl_FragColor = vec4(colour * exposure, 1.0);
  }
`;

export interface AtmosphereUniforms {
  readonly atTransmittanceLut: Uniform<Texture | null>;
  readonly atMultiLut: Uniform<Texture | null>;
  readonly atSkyViewLut: Uniform<Texture | null>;
  readonly atViewSize: Uniform<Vector2>;
  readonly atRayleigh: Uniform<Vector3>;
  readonly atMieScattering: Uniform<number>;
  readonly atMieExtinction: Uniform<number>;
  readonly atGroundAlbedo: Uniform<number>;
  readonly atMieG: Uniform<number>;
  readonly atOzone: Uniform<Vector3>;
  readonly atAltitude: Uniform<number>;
  readonly atSun: Uniform<Vector3>;
  readonly atIlluminance: Uniform<number>;
  readonly atSkyGain: Uniform<number>;
  readonly atClear: Uniform<number>;
}

export interface AtmosphereLuts {
  readonly uniforms: AtmosphereUniforms;
  readonly sun: Vector3;
  update(atmosphere: Atmosphere): void;
  configure(settings: QualitySettings['atmosphere']): void;
  track(light: DirectionalLight): boolean;
  dispose(): void;
}

function lutTarget(width: number, height: number): WebGLRenderTarget {
  return new WebGLRenderTarget(width, height, {
    type: HalfFloatType,
    format: RGBAFormat,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    wrapS: ClampToEdgeWrapping,
    wrapT: ClampToEdgeWrapping,
    depthBuffer: false,
    generateMipmaps: false,
  });
}

function mediumKey(spec: PhysicalSkySpec): string {
  return `${spec.rayleigh}|${spec.mieScattering}|${spec.mieAbsorption}|${spec.ozone}|${spec.groundAlbedo}`;
}

export function createAtmosphereLuts(renderer: WebGLRenderer, settings: QualitySettings['atmosphere']): AtmosphereLuts {
  const transmittance = lutTarget(TRANSMITTANCE_SIZE[0], TRANSMITTANCE_SIZE[1]);
  const multi = lutTarget(MULTI_SIZE, MULTI_SIZE);
  let view = lutTarget(settings.view[0], settings.view[1]);
  let steps = settings.steps;
  const uniforms: AtmosphereUniforms = {
    atTransmittanceLut: new Uniform<Texture | null>(transmittance.texture),
    atMultiLut: new Uniform<Texture | null>(multi.texture),
    atSkyViewLut: new Uniform<Texture | null>(view.texture),
    atViewSize: new Uniform(new Vector2(settings.view[0], settings.view[1])),
    atRayleigh: new Uniform(new Vector3()),
    atMieScattering: new Uniform(0),
    atMieExtinction: new Uniform(0),
    atGroundAlbedo: new Uniform(0.3),
    atMieG: new Uniform(0.8),
    atOzone: new Uniform(new Vector3()),
    atAltitude: new Uniform(0),
    atSun: new Uniform(new Vector3(0, 1, 0)),
    atIlluminance: new Uniform(1),
    atSkyGain: new Uniform(1),
    atClear: new Uniform(0),
  };
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new Mesh(geometry);
  quad.frustumCulled = false;
  const material = (fragmentShader: string, defines: Record<string, number> = {}) =>
    new ShaderMaterial({ vertexShader: LUT_VERTEX, fragmentShader, uniforms: uniforms as unknown as ShaderMaterial['uniforms'], defines, depthTest: false, depthWrite: false });
  const transmittanceMaterial = material(TRANSMITTANCE_FRAGMENT);
  const multiMaterial = material(MULTI_FRAGMENT);
  let viewMaterial = material(SKY_VIEW_FRAGMENT, { AT_VIEW_STEPS: steps });
  let medium = '';
  let ready = false;
  const sun = new Vector3(0, 1, 0);
  const scratch = new Vector3();

  const draw = (target: WebGLRenderTarget, shader: ShaderMaterial) => {
    const previous = renderer.getRenderTarget();
    const xr = renderer.xr.enabled;
    renderer.xr.enabled = false;
    quad.material = shader;
    renderer.setRenderTarget(target);
    renderer.render(quad, camera);
    renderer.setRenderTarget(previous);
    renderer.xr.enabled = xr;
  };

  const drawView = () => {
    uniforms.atSun.value.copy(sun);
    draw(view, viewMaterial);
  };

  return {
    uniforms,
    sun,
    update(atmosphere) {
      const spec = atmosphere.physical;
      if (!spec) return;
      uniforms.atRayleigh.value.set(RAYLEIGH[0] * spec.rayleigh, RAYLEIGH[1] * spec.rayleigh, RAYLEIGH[2] * spec.rayleigh);
      uniforms.atMieScattering.value = spec.mieScattering;
      uniforms.atMieExtinction.value = spec.mieScattering + spec.mieAbsorption;
      uniforms.atGroundAlbedo.value = spec.groundAlbedo;
      uniforms.atMieG.value = spec.mieAnisotropy;
      uniforms.atOzone.value.set(OZONE[0] * spec.ozone, OZONE[1] * spec.ozone, OZONE[2] * spec.ozone);
      uniforms.atAltitude.value = Math.max(spec.elevation, 1) * 0.001;
      uniforms.atIlluminance.value = spec.illuminance;
      uniforms.atSkyGain.value = spec.sky ?? 1;
      uniforms.atClear.value = spec.clear ?? 0;
      sun.set(...atmosphere.sun.direction).normalize();
      const key = mediumKey(spec);
      if (key !== medium) {
        medium = key;
        draw(transmittance, transmittanceMaterial);
        draw(multi, multiMaterial);
      }
      ready = true;
      drawView();
    },
    configure(next) {
      if (next.view[0] !== view.width || next.view[1] !== view.height) {
        view.dispose();
        view = lutTarget(next.view[0], next.view[1]);
        uniforms.atSkyViewLut.value = view.texture;
        uniforms.atViewSize.value.set(next.view[0], next.view[1]);
      }
      if (next.steps !== steps) {
        steps = next.steps;
        viewMaterial.dispose();
        viewMaterial = material(SKY_VIEW_FRAGMENT, { AT_VIEW_STEPS: steps });
      }
      if (ready) drawView();
    },
    track(light) {
      scratch.copy(light.position).sub(light.target.position);
      const length = scratch.length();
      if (!ready || length === 0) return false;
      scratch.divideScalar(length);
      if (scratch.dot(sun) > 0.9999999) return false;
      sun.copy(scratch);
      drawView();
      return true;
    },
    dispose() {
      transmittance.dispose();
      multi.dispose();
      view.dispose();
      transmittanceMaterial.dispose();
      multiMaterial.dispose();
      viewMaterial.dispose();
      geometry.dispose();
    },
  };
}

export interface PhysicalSky extends Sky {
  readonly luts: AtmosphereLuts;
  tick(dt: number): void;
  configure(settings: QualitySettings['atmosphere']): void;
}

export function createPhysicalSkyMaterial(luts: AtmosphereLuts, settings: QualitySettings['atmosphere'], exposure = 1): ShaderMaterial {
  const shared = luts.uniforms as unknown as ShaderMaterial['uniforms'];
  return new ShaderMaterial({
    name: 'LookPhysicalSky',
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: BackSide,
    depthWrite: false,
    fog: false,
    defines: { CLOUD_OCTAVES: settings.octaves, CLOUD_SHADOW: settings.shadow },
    uniforms: {
      ...shared,
      exposure: { value: exposure },
      atDisk: { value: 0 },
      atDiskRadius: { value: SUN_RADIUS },
      cloudCoverage: { value: 0 },
      cloudAltitude: { value: 1.8 },
      cloudDensity: { value: 1 },
      cloudScale: { value: 1 },
      cloudTime: { value: 0 },
    },
  });
}

export function applyPhysicalSky(material: ShaderMaterial, atmosphere: Atmosphere): void {
  const spec = atmosphere.physical;
  if (!spec) return;
  const u = material.uniforms;
  u.atDiskRadius.value = SUN_RADIUS * Math.max(spec.disk, 0.5);
  u.atDisk.value = spec.disk > 0 ? Math.min(spec.illuminance / (Math.PI * SUN_RADIUS * SUN_RADIUS), 40 * spec.illuminance) : 0;
  const clouds = spec.clouds;
  const on = clouds !== null && clouds.coverage > 0;
  if (('CLOUDS' in material.defines) !== on) {
    if (on) material.defines.CLOUDS = 1;
    else delete material.defines.CLOUDS;
    material.needsUpdate = true;
  }
  if (clouds) {
    u.cloudCoverage.value = clouds.coverage;
    u.cloudAltitude.value = Math.max(clouds.altitude, spec.elevation * 0.001 + 0.3);
    u.cloudDensity.value = clouds.density;
    u.cloudScale.value = clouds.scale;
  }
}

export function createPhysicalSky(renderer: WebGLRenderer, atmosphere: Atmosphere, settings: QualitySettings['atmosphere']): PhysicalSky {
  const luts = createAtmosphereLuts(renderer, settings);
  const mesh = new Mesh(new SphereGeometry(1, 32, 16), createPhysicalSkyMaterial(luts, settings));
  mesh.name = 'look-physical-sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = 1e6;
  mesh.matrixAutoUpdate = false;
  let wind = 0;
  const update = (next: Atmosphere) => {
    luts.update(next);
    applyPhysicalSky(mesh.material, next);
    wind = next.physical?.clouds?.wind ?? 0;
  };
  update(atmosphere);
  return {
    mesh,
    luts,
    update,
    tick(dt) {
      mesh.material.uniforms.cloudTime.value += dt * wind;
    },
    configure(next) {
      luts.configure(next);
      const defines = mesh.material.defines;
      if (defines.CLOUD_OCTAVES !== next.octaves || defines.CLOUD_SHADOW !== next.shadow) {
        defines.CLOUD_OCTAVES = next.octaves;
        defines.CLOUD_SHADOW = next.shadow;
        mesh.material.needsUpdate = true;
      }
    },
    dispose() {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.material.dispose();
      luts.dispose();
    },
  };
}

export function bakePhysicalEnvironment(renderer: WebGLRenderer, sky: PhysicalSky, exposure = 0.7): WebGLRenderTarget {
  const scene = new Scene();
  const source = sky.mesh.material;
  const material = new ShaderMaterial({
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: BackSide,
    depthWrite: false,
    fog: false,
    defines: { ...source.defines },
    uniforms: { ...source.uniforms, exposure: { value: exposure }, atDisk: { value: 0 }, atSkyGain: { value: 1 } },
  });
  const mesh = new Mesh(sky.mesh.geometry, material);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const pmrem = new PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.04);
  pmrem.dispose();
  material.dispose();
  return target;
}
