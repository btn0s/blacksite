import { Material, RepeatWrapping, ShaderChunk, TangentSpaceNormalMap } from 'three';
import type { MeshStandardMaterial, Texture } from 'three';

export interface StochasticTilingOptions {
  tileSpan?: number;
  blendSharpness?: number;
  seed?: number;
  rotation?: 'none' | 'half-turn' | 'quarter-turn';
  shaderDecodesSRGB?: boolean;
}

const installed = new WeakSet<MeshStandardMaterial>();

const sampling = `
struct BlacksiteTile {
  vec2 a;
  vec2 b;
  vec2 c;
  mat2 rotationA;
  mat2 rotationB;
  mat2 rotationC;
  vec3 weights;
  vec2 dx;
  vec2 dy;
};
vec2 blacksiteTileOffset(vec2 cell) {
  vec3 p = fract(vec3(cell.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yzx + 33.33 + BLACKSITE_TILE_SEED);
  return fract((p.xx + p.yz) * p.zy);
}
mat2 blacksiteTileRotation(vec2 cell) {
  float choice = floor(blacksiteTileOffset(cell + vec2(19.19, 47.27)).x * 4.0);
  #if BLACKSITE_TILE_ROTATION == 0
    choice = 0.0;
  #elif BLACKSITE_TILE_ROTATION == 2
    choice = floor(choice * 0.5) * 2.0;
  #endif
  if (choice < 0.5) return mat2(1.0, 0.0, 0.0, 1.0);
  if (choice < 1.5) return mat2(0.0, 1.0, -1.0, 0.0);
  if (choice < 2.5) return mat2(-1.0, 0.0, 0.0, -1.0);
  return mat2(0.0, -1.0, 1.0, 0.0);
}
BlacksiteTile blacksiteTile(vec2 uv) {
  vec2 skewed = mat2(1.0, 0.0, -0.57735026919, 1.15470053838) * uv / BLACKSITE_TILE_SPAN;
  vec2 cell = floor(skewed);
  vec2 local = fract(skewed);
  vec2 a;
  vec2 b;
  vec2 c;
  vec3 weights;
  if (local.x + local.y < 1.0) {
    a = cell;
    b = cell + vec2(1.0, 0.0);
    c = cell + vec2(0.0, 1.0);
    weights = vec3(1.0 - local.x - local.y, local.x, local.y);
  } else {
    a = cell + vec2(1.0);
    b = cell + vec2(0.0, 1.0);
    c = cell + vec2(1.0, 0.0);
    weights = vec3(local.x + local.y - 1.0, 1.0 - local.x, 1.0 - local.y);
  }
  weights = pow(max(weights, vec3(0.0)), vec3(BLACKSITE_TILE_SHARPNESS));
  weights /= dot(weights, vec3(1.0));
  mat2 rotationA = blacksiteTileRotation(a);
  mat2 rotationB = blacksiteTileRotation(b);
  mat2 rotationC = blacksiteTileRotation(c);
  return BlacksiteTile(rotationA * uv + blacksiteTileOffset(a), rotationB * uv + blacksiteTileOffset(b), rotationC * uv + blacksiteTileOffset(c), rotationA, rotationB, rotationC, weights, dFdx(uv), dFdy(uv));
}
vec4 blacksiteTileSample(sampler2D sourceMap, BlacksiteTile tile) {
  return textureGrad(sourceMap, tile.a, tile.rotationA * tile.dx, tile.rotationA * tile.dy) * tile.weights.x
    + textureGrad(sourceMap, tile.b, tile.rotationB * tile.dx, tile.rotationB * tile.dy) * tile.weights.y
    + textureGrad(sourceMap, tile.c, tile.rotationC * tile.dx, tile.rotationC * tile.dy) * tile.weights.z;
}
vec4 blacksiteTileColour(sampler2D sourceMap, BlacksiteTile tile) {
  #if defined(DECODE_VIDEO_TEXTURE) || BLACKSITE_TILE_SHADER_SRGB == 1
    vec4 a = sRGBTransferEOTF(textureGrad(sourceMap, tile.a, tile.rotationA * tile.dx, tile.rotationA * tile.dy));
    vec4 b = sRGBTransferEOTF(textureGrad(sourceMap, tile.b, tile.rotationB * tile.dx, tile.rotationB * tile.dy));
    vec4 c = sRGBTransferEOTF(textureGrad(sourceMap, tile.c, tile.rotationC * tile.dx, tile.rotationC * tile.dy));
    return sRGBTransferOETF(a * tile.weights.x + b * tile.weights.y + c * tile.weights.z);
  #else
    return blacksiteTileSample(sourceMap, tile);
  #endif
}
vec3 blacksiteTileNormalSample(sampler2D sourceMap, vec2 uv, mat2 rotation, vec2 dx, vec2 dy, vec2 scale) {
  vec3 normal = textureGrad(sourceMap, uv, rotation * dx, rotation * dy).xyz * 2.0 - 1.0;
  #if defined(USE_PACKED_NORMALMAP)
    normal.z = sqrt(max(1.0 - dot(normal.xy, normal.xy), 0.0));
  #endif
  normal.xy = transpose(rotation) * (normal.xy * scale);
  return normal;
}
vec3 blacksiteTileNormal(sampler2D sourceMap, BlacksiteTile tile, vec2 scale) {
  return blacksiteTileNormalSample(sourceMap, tile.a, tile.rotationA, tile.dx, tile.dy, scale) * tile.weights.x
    + blacksiteTileNormalSample(sourceMap, tile.b, tile.rotationB, tile.dx, tile.dy, scale) * tile.weights.y
    + blacksiteTileNormalSample(sourceMap, tile.c, tile.rotationC, tile.dx, tile.dy, scale) * tile.weights.z;
}
`;

function checkMaps(material: MeshStandardMaterial) {
  const map = material.map;
  if (!map) throw new Error('Stochastic tiling requires a colour map.');
  if (material.bumpMap || material.displacementMap || material.alphaMap || material.emissiveMap) {
    throw new Error('Stochastic tiling supports colour, tangent normal and ORM maps only.');
  }
  if (material.normalMap && material.normalMapType !== TangentSpaceNormalMap) {
    throw new Error('Stochastic tiling requires a tangent-space normal map.');
  }
  if (map.matrixAutoUpdate) map.updateMatrix();
  for (const texture of [map, material.normalMap, material.roughnessMap, material.metalnessMap, material.aoMap]) {
    if (!texture) continue;
    if (texture.matrixAutoUpdate) texture.updateMatrix();
    if (texture.wrapS !== RepeatWrapping || texture.wrapT !== RepeatWrapping) {
      throw new Error('Stochastic tiling requires RepeatWrapping on every map.');
    }
    if (texture.channel !== map.channel || !texture.matrix.equals(map.matrix)) {
      throw new Error('Stochastic tiling requires matching UV channels and transforms on every map.');
    }
  }
}

function sameSource(a: Texture | null, b: Texture | null) {
  return !!a && !!b && a.source === b.source && a.colorSpace === b.colorSpace
    && a.minFilter === b.minFilter && a.magFilter === b.magFilter && a.anisotropy === b.anisotropy
    && a.flipY === b.flipY && a.format === b.format && a.type === b.type;
}

function positive(value: number, name: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a finite positive number.`);
  return value.toExponential(8);
}

export function applyStochasticTiling(material: MeshStandardMaterial, options: StochasticTilingOptions = {}): () => void {
  checkMaps(material);
  if (installed.has(material)) throw new Error('Stochastic tiling is already applied to this material.');
  const span = positive(options.tileSpan ?? 1, 'tileSpan');
  const sharpness = positive(options.blendSharpness ?? 4, 'blendSharpness');
  const seed = options.seed ?? 0;
  if (!Number.isFinite(seed)) throw new Error('seed must be finite.');
  const rotation = options.rotation ?? 'quarter-turn';
  const rotationCode = { none: 0, 'half-turn': 2, 'quarter-turn': 4 }[rotation];
  if (rotationCode === undefined) throw new Error('rotation must be none, half-turn or quarter-turn.');
  const previousCompile = material.onBeforeCompile;
  const previousCache = material.customProgramCacheKey;
  const baseCache = previousCache === Material.prototype.customProgramCacheKey
    ? () => previousCompile.toString()
    : () => previousCache.call(material);
  const isPacked = () => sameSource(material.roughnessMap, material.metalnessMap) && sameSource(material.roughnessMap, material.aoMap);
  const define = `#define BLACKSITE_TILE_SPAN ${span}\n#define BLACKSITE_TILE_SHARPNESS ${sharpness}\n#define BLACKSITE_TILE_SEED ${seed.toExponential(8)}\n#define BLACKSITE_TILE_ROTATION ${rotationCode}\n#define BLACKSITE_TILE_SHADER_SRGB ${options.shaderDecodesSRGB ? 1 : 0}\n`;

  const compile: typeof material.onBeforeCompile = function (this: MeshStandardMaterial, shader, renderer) {
    previousCompile.call(this, shader, renderer);
    checkMaps(material);
    const packed = isPacked();
    const replace = (anchor: RegExp, replacement: string) => {
      if (!anchor.test(shader.fragmentShader)) throw new Error(`Stochastic tiling cannot find shader expression ${anchor}.`);
      shader.fragmentShader = shader.fragmentShader.replace(anchor, replacement);
    };
    for (const chunk of ['map_fragment', 'normal_fragment_maps', 'roughnessmap_fragment', 'metalnessmap_fragment', 'aomap_fragment'] as const) {
      shader.fragmentShader = shader.fragmentShader.replace(`#include <${chunk}>`, ShaderChunk[chunk]);
    }
    let setup = 'BlacksiteTile blacksiteTiles = blacksiteTile(vMapUv);';
    if (packed) setup += '\nvec4 blacksiteOrm = blacksiteTileSample(roughnessMap, blacksiteTiles);';
    replace(/void\s+main\s*\(\s*\)\s*\{/, `${define}${sampling}\nvoid main() {\n${setup}`);
    replace(/texture(?:2D)?\(\s*map\s*,\s*vMapUv\s*\)/g, 'blacksiteTileColour(map, blacksiteTiles)');
    replace(/texture(?:2D)?\(\s*normalMap\s*,\s*vNormalMapUv\s*\)\.xyz\s*\*\s*2\.0\s*-\s*1\.0/g, 'blacksiteTileNormal(normalMap, blacksiteTiles, normalScale)');
    shader.fragmentShader = shader.fragmentShader.replace(/#if defined\( USE_PACKED_NORMALMAP \)\s*mapN = vec3\( mapN\.xy, sqrt\( saturate\( 1\.0 - dot\( mapN\.xy, mapN\.xy \) \) \) \);\s*#endif/, '').replace(/mapN\.xy\s*\*=\s*normalScale\s*;/, '');
    for (const [sampler, uv] of [
      ['roughnessMap', 'vRoughnessMapUv'],
      ['metalnessMap', 'vMetalnessMapUv'],
      ['aoMap', 'vAoMapUv'],
    ] as const) {
      replace(new RegExp(`texture(?:2D)?\\(\\s*${sampler}\\s*,\\s*${uv}\\s*\\)`, 'g'), packed ? 'blacksiteOrm' : `blacksiteTileSample(${sampler}, blacksiteTiles)`);
    }
  };
  const cache = () => `${baseCache()}|blacksite-stochastic-v2:${span}:${sharpness}:${seed}:${rotation}:${!!options.shaderDecodesSRGB}:${isPacked()}`;
  material.onBeforeCompile = compile;
  material.customProgramCacheKey = cache;
  material.needsUpdate = true;
  installed.add(material);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    if (material.onBeforeCompile === compile) material.onBeforeCompile = previousCompile;
    if (material.customProgramCacheKey === cache) material.customProgramCacheKey = previousCache;
    material.needsUpdate = true;
    installed.delete(material);
  };
}
