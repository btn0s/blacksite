import {
  AddEquation,
  Box3,
  ClampToEdgeWrapping,
  CustomBlending,
  DepthTexture,
  DoubleSide,
  FloatType,
  HalfFloatType,
  LessEqualCompare,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  OneFactor,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderChunk,
  ShaderMaterial,
  Uniform,
  UnsignedIntType,
  Vector2,
  Vector3,
  WebGL3DRenderTarget,
  WebGLRenderTarget,
} from 'three';
import type { Material, Object3D, WebGLRenderer, WebGLProgramParametersWithUniforms } from 'three';
import type { Rgb } from './atmosphere';

export interface BakeOptions {
  readonly root: Object3D;
  readonly min: Rgb;
  readonly max: Rgb;
  readonly cell?: number;
  readonly haze?: number;
  readonly ground?: number;
  readonly albedo?: number;
  readonly reach?: number;
}

export interface BakeQuality {
  readonly directions: number;
  readonly sky: number;
  readonly sun: number;
}

export interface BakedLight {
  readonly uniforms: BakedUniforms;
  readonly options: BakeOptions;
  readonly milliseconds: number;
  bake(sun: Rgb): void;
  setSun(color: Rgb, strength: number): void;
  light(material: Material): void;
  track(root: Object3D): void;
  dispose(): void;
}

export interface BakedUniforms {
  readonly lookSky: Uniform;
  readonly lookSkyMin: Uniform<Vector3>;
  readonly lookSkySize: Uniform<Vector3>;
  readonly lookSkyCell: Uniform<number>;
  readonly lookSun: Uniform;
  readonly lookSunMatrix: Uniform<Matrix4>;
  readonly lookGround: Uniform<number>;
  readonly lookSunBias: Uniform<number>;
  readonly lookBounce: Uniform;
  readonly lookSunColor: Uniform<Vector3>;
}

const SPLAT_VERTEX = `
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const SPLAT_FRAGMENT = `
  precision highp float;
  uniform highp sampler2D depthMap;
  uniform mat4 view;
  uniform vec3 direction;
  uniform vec3 origin;
  uniform vec3 cell;
  uniform float layer;
  uniform float weight;
  uniform float texel;
  void main() {
    vec2 index = floor(gl_FragCoord.xy);
    vec3 probe = origin + (vec3(index.x, layer, index.y) + 0.5) * cell;
    vec4 clip = view * vec4(probe, 1.0);
    vec3 ndc = clip.xyz / clip.w * 0.5 + 0.5;
    float visible = 0.0;
    for (int i = 0; i < 4; i++) {
      vec2 offset = (vec2(float(i & 1), float(i >> 1)) - 0.5) * texel;
      visible += step(ndc.z, texture2D(depthMap, ndc.xy + offset).r);
    }
    visible *= 0.25 * weight;
    gl_FragColor = vec4(visible, visible * direction);
  }
`;

const BOUNCE_FRAGMENT = `
  precision highp float;
  precision highp sampler3D;
  uniform highp sampler2D sunDepth;
  uniform sampler3D sky;
  uniform mat4 sunView;
  uniform mat4 sunInverse;
  uniform vec3 sunDirection;
  uniform vec3 origin;
  uniform vec3 cell;
  uniform vec3 skyMin;
  uniform vec3 skySize;
  uniform vec2 radius;
  uniform vec2 texel;
  uniform float layer;
  uniform float area;
  uniform float albedo;

  vec3 surfaceAt(vec2 uv) {
    vec4 world = sunInverse * vec4(uv * 2.0 - 1.0, texture2D(sunDepth, uv).r * 2.0 - 1.0, 1.0);
    return world.xyz / world.w;
  }

  void main() {
    vec2 index = floor(gl_FragCoord.xy);
    vec3 probe = origin + (vec3(index.x, layer, index.y) + 0.5) * cell;
    vec4 clip = sunView * vec4(probe, 1.0);
    vec2 center = clip.xy / clip.w * 0.5 + 0.5;
    float spin = fract(sin(dot(probe, vec3(12.9898, 78.233, 37.719))) * 43758.5453) * 6.2831853;
    vec4 sum = vec4(0.0);
    for (int i = 0; i < BOUNCE_SAMPLES; i++) {
      float along = sqrt((float(i) + 0.5) / float(BOUNCE_SAMPLES));
      float angle = float(i) * 2.39996323 + spin;
      vec2 uv = center + vec2(cos(angle), sin(angle)) * along * radius;
      if (any(lessThan(uv, texel)) || any(greaterThan(uv, 1.0 - texel))) continue;
      if (texture2D(sunDepth, uv).r >= 1.0) continue;
      vec3 surface = surfaceAt(uv);
      vec3 normal = normalize(cross(surfaceAt(uv + vec2(texel.x, 0.0)) - surface, surfaceAt(uv + vec2(0.0, texel.y)) - surface));
      if (dot(normal, sunDirection) < 0.0) normal = -normal;
      vec3 uvw = (surface + normal * 0.3 - skyMin) / skySize;
      if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) continue;
      float enclosed = 1.0 - clamp(texture(sky, uvw.xzy).x * 1.6, 0.0, 1.0);
      vec3 toward = surface - probe;
      float distance2 = dot(toward, toward);
      toward *= inversesqrt(max(distance2, 1e-6));
      float strength = enclosed * max(dot(normal, -toward), 0.0) / (3.14159265 * (distance2 + area));
      sum += vec4(strength, strength * toward);
    }
    gl_FragColor = sum * area * albedo;
  }
`;

export const LIGHT_CHUNK = `
  uniform highp sampler3D lookSky;
  uniform vec3 lookSkyMin;
  uniform vec3 lookSkySize;
  uniform float lookSkyCell;
  uniform highp sampler2DShadow lookSun;
  uniform mat4 lookSunMatrix;
  uniform float lookGround;
  uniform float lookSunBias;
  uniform highp sampler3D lookBounce;
  uniform vec3 lookSunColor;

  float lookInside(vec3 uvw) {
    vec3 edge = min(uvw, 1.0 - uvw) * lookSkySize;
    return clamp(min(min(edge.x, edge.y), edge.z) / max(lookSkyCell * 2.0, 1e-4), 0.0, 1.0);
  }

  vec4 lookSkyAt(vec3 world) {
    vec3 uvw = (world - lookSkyMin) / lookSkySize;
    vec4 sky = texture(lookSky, clamp(uvw.xzy, 0.0, 1.0));
    return mix(vec4(1.0, 0.0, 0.5, 0.0), sky, lookInside(uvw));
  }

  vec3 lookBounceAt(vec3 world, vec3 n) {
    vec3 uvw = (world - lookSkyMin) / lookSkySize;
    vec4 bounce = texture(lookBounce, clamp(uvw.xzy, 0.0, 1.0)) * lookInside(uvw);
    return lookSunColor * max(0.25 * bounce.x + 0.75 * dot(bounce.yzw, n), 0.0);
  }

  float lookOpen(vec4 sky, vec3 n) {
    float above = max(0.5 * sky.x + dot(sky.yzw, n), 0.0);
    float below = 0.5 * (1.0 - n.y) * max(sky.x, lookGround);
    return above + below;
  }

  float lookSunAt(vec3 world) {
    vec4 clip = lookSunMatrix * vec4(world, 1.0);
    vec3 uvz = clip.xyz * 0.5 + 0.5;
    if (any(lessThan(uvz.xy, vec2(0.0))) || any(greaterThan(uvz.xy, vec2(1.0))) || uvz.z > 1.0) return 1.0;
    return texture(lookSun, vec3(uvz.xy, uvz.z - lookSunBias));
  }
`;

const fibonacci = (count: number) => Array.from({ length: count }, (_, index) => {
  const y = 1 - (index + 0.5) / count;
  const radius = Math.sqrt(1 - y * y);
  const angle = index * Math.PI * (3 - Math.sqrt(5));
  return new Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
});

function fit(camera: OrthographicCamera, direction: Vector3, box: Box3, reach: number) {
  const center = box.getCenter(new Vector3());
  camera.position.copy(center).addScaledVector(direction, reach);
  camera.up.set(Math.abs(direction.y) > 0.99 ? 1 : 0, Math.abs(direction.y) > 0.99 ? 0 : 1, 0);
  camera.lookAt(center);
  camera.updateMatrixWorld();
  const inverse = camera.matrixWorldInverse;
  const local = new Box3();
  for (let corner = 0; corner < 8; corner++) local.expandByPoint(new Vector3(corner & 1 ? box.max.x : box.min.x, corner & 2 ? box.max.y : box.min.y, corner & 4 ? box.max.z : box.min.z).applyMatrix4(inverse));
  camera.left = local.min.x;
  camera.right = local.max.x;
  camera.bottom = local.min.y;
  camera.top = local.max.y;
  camera.near = 0.5;
  camera.far = reach + Math.max(local.max.z - local.min.z, 1) * 2;
  camera.updateProjectionMatrix();
}

function occluders(root: Object3D) {
  const meshes: Mesh[] = [];
  root.traverseVisible(object => {
    if (!(object instanceof Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.some(material => material.transparent || !material.depthWrite || material.blending !== 1)) return;
    meshes.push(object);
  });
  return meshes;
}

export function bakeLight(renderer: WebGLRenderer, sun: Rgb, options: BakeOptions, quality: BakeQuality): BakedLight {
  const cell = options.cell ?? 0.25;
  const reach = options.reach ?? 4;
  const box = new Box3(new Vector3(...options.min), new Vector3(...options.max));
  const size = box.getSize(new Vector3());
  const counts = new Vector3(Math.ceil(size.x / cell), Math.ceil(size.y / cell), Math.ceil(size.z / cell));
  const step = new Vector3(size.x / counts.x, size.y / counts.y, size.z / counts.z);
  const distance = 200;

  const coarse = new Vector3(Math.ceil(counts.x / 2), Math.ceil(counts.y / 2), Math.ceil(counts.z / 2));
  const coarseStep = new Vector3(size.x / coarse.x, size.y / coarse.y, size.z / coarse.z);
  const volume = (counts: Vector3) => {
    const target = new WebGL3DRenderTarget(counts.x, counts.z, counts.y, { type: HalfFloatType, format: RGBAFormat, depthBuffer: false });
    target.texture.minFilter = target.texture.magFilter = LinearFilter;
    target.texture.wrapS = target.texture.wrapT = target.texture.wrapR = ClampToEdgeWrapping;
    return target;
  };
  const depthTarget = (resolution: number, compare: boolean) => {
    const target = new WebGLRenderTarget(resolution, resolution, { depthBuffer: true });
    target.depthTexture = new DepthTexture(resolution, resolution, compare ? UnsignedIntType : FloatType);
    target.depthTexture.minFilter = target.depthTexture.magFilter = compare ? LinearFilter : NearestFilter;
    if (compare) target.depthTexture.compareFunction = LessEqualCompare;
    return target;
  };
  const sky = volume(counts);
  const bounce = volume(coarse);
  const sunTarget = depthTarget(quality.sun, true);

  const uniforms: BakedUniforms = {
    lookSky: new Uniform(sky.texture),
    lookSkyMin: new Uniform(box.min.clone()),
    lookSkySize: new Uniform(size.clone()),
    lookSkyCell: new Uniform(cell),
    lookSun: new Uniform(sunTarget.depthTexture),
    lookSunMatrix: new Uniform(new Matrix4()),
    lookGround: new Uniform(options.ground ?? 0.06),
    lookSunBias: new Uniform(0),
    lookBounce: new Uniform(bounce.texture),
    lookSunColor: new Uniform(new Vector3(1, 1, 1)),
  };

  const additive = { depthTest: false, depthWrite: false, blending: CustomBlending, blendEquation: AddEquation, blendSrc: OneFactor, blendDst: OneFactor } as const;
  const splat = new ShaderMaterial({
    vertexShader: SPLAT_VERTEX,
    fragmentShader: SPLAT_FRAGMENT,
    uniforms: {
      depthMap: { value: null },
      view: { value: new Matrix4() },
      direction: { value: new Vector3() },
      origin: { value: box.min.clone() },
      cell: { value: step.clone() },
      layer: { value: 0 },
      weight: { value: 0 },
      texel: { value: 0 },
    },
    ...additive,
  });
  const gather = new ShaderMaterial({
    vertexShader: SPLAT_VERTEX,
    fragmentShader: BOUNCE_FRAGMENT,
    defines: { BOUNCE_SAMPLES: 192 },
    uniforms: {
      sunDepth: { value: null },
      sky: { value: sky.texture },
      sunView: { value: new Matrix4() },
      sunInverse: { value: new Matrix4() },
      sunDirection: { value: new Vector3() },
      origin: { value: box.min.clone() },
      cell: { value: coarseStep.clone() },
      skyMin: { value: box.min.clone() },
      skySize: { value: size.clone() },
      radius: { value: new Vector2() },
      texel: { value: new Vector2() },
      layer: { value: 0 },
      area: { value: 0 },
      albedo: { value: options.albedo ?? 0.35 },
    },
    depthTest: false,
    depthWrite: false,
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), splat);
  quad.frustumCulled = false;
  const quadScene = new Scene();
  quadScene.add(quad);
  const camera = new OrthographicCamera();
  const directions = fibonacci(quality.directions);

  const each = (target: WebGL3DRenderTarget, material: ShaderMaterial) => {
    quad.material = material;
    for (let layer = 0; layer < target.depth; layer++) {
      material.uniforms.layer!.value = layer;
      renderer.setRenderTarget(target, layer);
      renderer.render(quadScene, camera);
    }
  };

  const bake = (direction: Rgb) => {
    const meshes = occluders(options.root);
    const hidden: Object3D[] = [];
    const kept = new Set<Object3D>(meshes);
    for (const mesh of meshes) for (let parent = mesh.parent; parent; parent = parent.parent) kept.add(parent);
    options.root.traverseVisible(object => { if (!kept.has(object)) hidden.push(object) });
    const swapped = new Map<Mesh, Mesh['material']>();
    const depthMaterial = new MeshBasicMaterial({ side: DoubleSide, colorWrite: false });
    for (const mesh of meshes) { swapped.set(mesh, mesh.material); mesh.material = depthMaterial; }
    for (const object of hidden) object.visible = false;
    const wasAuto = options.root.matrixWorldAutoUpdate;
    options.root.updateMatrixWorld(true);
    options.root.matrixWorldAutoUpdate = false;
    const previous = { target: renderer.getRenderTarget(), autoClear: renderer.autoClear, shadow: renderer.shadowMap.enabled, clear: renderer.getClearAlpha() };
    renderer.shadowMap.enabled = false;
    renderer.setClearColor(0x000000, 0);

    renderer.autoClear = true;
    for (let layer = 0; layer < counts.y; layer++) {
      renderer.setRenderTarget(sky, layer);
      renderer.clear(true, false, false);
    }
    const skyDepth = depthTarget(quality.sky, false);
    for (const ray of directions) {
      fit(camera, ray, box, distance);
      renderer.autoClear = true;
      renderer.setRenderTarget(skyDepth);
      renderer.render(options.root, camera);
      renderer.autoClear = false;
      splat.uniforms.depthMap!.value = skyDepth.depthTexture;
      (splat.uniforms.view!.value as Matrix4).multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      (splat.uniforms.direction!.value as Vector3).copy(ray);
      splat.uniforms.weight!.value = 1 / directions.length;
      splat.uniforms.texel!.value = 0.5 / quality.sky;
      each(sky, splat);
    }
    skyDepth.dispose();

    const sunDirection = new Vector3(...direction).normalize();
    fit(camera, sunDirection, box, distance);
    renderer.autoClear = true;
    renderer.setRenderTarget(sunTarget);
    renderer.render(options.root, camera);
    const sunDepth = depthTarget(quality.sun, false);
    renderer.setRenderTarget(sunDepth);
    renderer.render(options.root, camera);
    uniforms.lookSunMatrix.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    uniforms.lookSunBias.value = 0.03 / (camera.far - camera.near);
    const width = camera.right - camera.left;
    const height = camera.top - camera.bottom;
    const g = gather.uniforms;
    g.sunDepth!.value = sunDepth.depthTexture;
    (g.sunView!.value as Matrix4).copy(uniforms.lookSunMatrix.value);
    (g.sunInverse!.value as Matrix4).copy(uniforms.lookSunMatrix.value).invert();
    (g.sunDirection!.value as Vector3).copy(sunDirection);
    (g.radius!.value as Vector2).set(reach / width, reach / height);
    (g.texel!.value as Vector2).set(1 / quality.sun, 1 / quality.sun);
    g.area!.value = Math.PI * reach * reach / Number(gather.defines.BOUNCE_SAMPLES);
    renderer.autoClear = true;
    each(bounce, gather);
    sunDepth.dispose();

    renderer.setRenderTarget(previous.target);
    renderer.autoClear = previous.autoClear;
    renderer.shadowMap.enabled = previous.shadow;
    renderer.setClearAlpha(previous.clear);
    for (const [mesh, material] of swapped) mesh.material = material;
    for (const object of hidden) object.visible = true;
    options.root.matrixWorldAutoUpdate = wasAuto;
    depthMaterial.dispose();
  };

  const started = performance.now();
  bake(sun);
  const milliseconds = performance.now() - started;

  const patched = new WeakSet<Material>();
  const light = (material: Material) => {
    if (patched.has(material)) return;
    patched.add(material);
    const lit = 'isMeshStandardMaterial' in material || 'isMeshLambertMaterial' in material || 'isMeshPhongMaterial' in material;
    if (!lit) return;
    const before = material.onBeforeCompile;
    const key = material.customProgramCacheKey;
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer) => {
      before.call(material, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLookWorld;')
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          vec4 lookWorld = vec4(transformed, 1.0);
          #ifdef USE_BATCHING
            lookWorld = batchingMatrix * lookWorld;
          #endif
          #ifdef USE_INSTANCING
            lookWorld = instanceMatrix * lookWorld;
          #endif
          vLookWorld = (modelMatrix * lookWorld).xyz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vLookWorld;\n${LIGHT_CHUNK}`)
        .replace('#include <lights_fragment_begin>', `
          vec3 lookNormal = inverseTransformDirection(normal, viewMatrix);
          vec3 lookFace = inverseTransformDirection(nonPerturbedNormal, viewMatrix);
          vec3 lookProbe = vLookWorld + lookFace * lookSkyCell * 0.6;
          vec4 lookSkyHere = lookSkyAt(lookProbe);
          float lookIndirect = lookOpen(lookSkyHere, lookNormal);
          vec3 lookView = normalize(vLookWorld - cameraPosition);
          float lookSpecular = lookOpen(lookSkyHere, reflect(lookView, lookNormal));
          float lookSunlit = lookSunAt(vLookWorld + lookFace * 0.03);
          #include <lights_fragment_begin>`)
        .replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\ndirectLight.color *= lookSunlit;')
        .replace('#include <lights_fragment_end>', `
          irradiance *= lookIndirect;
          iblIrradiance *= lookIndirect;
          irradiance += lookBounceAt(lookProbe, lookNormal);
          #if defined( RE_IndirectSpecular )
            radiance *= lookSpecular;
          #endif
          #include <lights_fragment_end>`)
        .replace('#include <fog_fragment>', `
          #ifdef USE_FOG
            vec3 lookFogColor = fogColor * mix(0.12, 1.0, clamp(max(lookSkyAt(cameraPosition).x, lookSkyHere.x) * 1.6, 0.0, 1.0));
          #endif
          ${ShaderChunk.fog_fragment.replace('fogColor, fogFactor', 'lookFogColor, fogFactor')}`);
    };
    material.customProgramCacheKey = () => `${key.call(material)}|look-light`;
    material.needsUpdate = true;
  };

  return {
    uniforms,
    options,
    milliseconds,
    bake,
    setSun(color, strength) {
      uniforms.lookSunColor.value.set(...color).multiplyScalar(strength);
    },
    light,
    track(root) {
      root.traverse(object => {
        const material = (object as Mesh).material;
        if (!material) return;
        if (Array.isArray(material)) material.forEach(light);
        else light(material);
      });
    },
    dispose() {
      sky.dispose();
      bounce.dispose();
      sunTarget.dispose();
      splat.dispose();
      gather.dispose();
      quad.geometry.dispose();
    },
  };
}
