import { BackSide, Mesh, PMREMGenerator, Scene, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import type { WebGLRenderer, WebGLRenderTarget } from 'three';
import type { Atmosphere } from './atmosphere';

const NOISE_GLSL = `
  float lookHash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float lookNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(lookHash(i), lookHash(i + vec3(1, 0, 0)), f.x),
          mix(lookHash(i + vec3(0, 1, 0)), lookHash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(lookHash(i + vec3(0, 0, 1)), lookHash(i + vec3(1, 0, 1)), f.x),
          mix(lookHash(i + vec3(0, 1, 1)), lookHash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float lookFbm(vec3 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int octave = 0; octave < 3; octave++) {
      value += amplitude * lookNoise(p);
      p = p * 2.03 + vec3(1.7, 9.2, 4.1);
      amplitude *= 0.5;
    }
    return value;
  }
`;

const SKY_FRAGMENT = `
  uniform float exposure;
  uniform vec3 sunDirection;
  uniform vec3 skyZenith;
  uniform vec3 skyHorizon;
  uniform vec3 skyGround;
  uniform float skyOvercast;
  uniform vec3 skySunTint;
  varying vec3 vDirection;
  ${NOISE_GLSL}
  void main() {
    vec3 d = normalize(vDirection);
    float up = clamp(d.y, -1.0, 1.0);
    vec3 sky = mix(skyHorizon, skyZenith, pow(clamp(up, 0.0, 1.0), 0.5));
    vec2 flat_ = d.xz / max(d.y, 0.08);
    float cover = lookFbm(vec3(flat_ * 0.35, 1.7));
    float toSun = max(dot(d, sunDirection), 0.0);
    float clearSky = 1.0 - smoothstep(0.0, 0.6, skyOvercast);
    float glow = pow(toSun, 6.0) * clearSky;
    vec3 cloud = mix(skyZenith * 0.62, mix(skyHorizon * 0.82, skyHorizon * vec3(1.18, 1.05, 0.9), glow), smoothstep(0.3, 0.8, cover + glow * 0.3 + skyOvercast * 0.45));
    sky = mix(sky, cloud, clamp(up * 3.0, 0.0, 1.0) * mix(0.7, 0.95, skyOvercast));
    vec3 colour = up >= 0.0 ? sky : mix(skyHorizon, skyGround, pow(-up, 0.35));
    colour += skySunTint * (glow * 0.25 + pow(toSun, 300.0) * 3.0 * clearSky);
    gl_FragColor = vec4(colour * exposure, 1.0);
  }
`;

const SKY_VERTEX = `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
    gl_Position = clip.xyww;
  }
`;

export function createSkyMaterial(atmosphere: Atmosphere, exposure = 1): ShaderMaterial {
  const material = new ShaderMaterial({
    name: 'LookSky',
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      exposure: { value: exposure },
      sunDirection: { value: new Vector3() },
      skyZenith: { value: new Vector3() },
      skyHorizon: { value: new Vector3() },
      skyGround: { value: new Vector3() },
      skyOvercast: { value: 0 },
      skySunTint: { value: new Vector3() },
    },
  });
  applySkyAtmosphere(material, atmosphere);
  return material;
}

export function applySkyAtmosphere(material: ShaderMaterial, atmosphere: Atmosphere): void {
  const { sky, sun } = atmosphere;
  const u = material.uniforms;
  (u.sunDirection.value as Vector3).set(...sun.direction).normalize();
  (u.skyZenith.value as Vector3).set(...sky.zenith);
  (u.skyHorizon.value as Vector3).set(...sky.horizon);
  (u.skyGround.value as Vector3).set(...sky.ground);
  (u.skySunTint.value as Vector3).set(...sun.color);
  u.skyOvercast.value = sky.overcast;
}

export interface Sky {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;
  update(atmosphere: Atmosphere): void;
  dispose(): void;
}

export function createSky(atmosphere: Atmosphere): Sky {
  const mesh = new Mesh(new SphereGeometry(1, 32, 16), createSkyMaterial(atmosphere));
  mesh.name = 'look-sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  mesh.matrixAutoUpdate = false;
  return {
    mesh,
    update: next => applySkyAtmosphere(mesh.material, next),
    dispose() {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.material.dispose();
    },
  };
}

export function bakeSkyEnvironment(renderer: WebGLRenderer, atmosphere: Atmosphere, exposure = 0.7): WebGLRenderTarget {
  const scene = new Scene();
  const sky = createSky(atmosphere);
  sky.mesh.material.uniforms.exposure.value = exposure;
  scene.add(sky.mesh);
  const pmrem = new PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.04);
  pmrem.dispose();
  sky.dispose();
  return target;
}
