import { Material, RepeatWrapping, ShaderChunk, TangentSpaceNormalMap } from 'three';
import type { MeshStandardMaterial, Texture } from 'three';

export interface StochasticTilingOptions {
  tileSpan?: number;
  blendSharpness?: number;
  seed?: number;
}

const installed = new WeakSet<MeshStandardMaterial>();

const sampling = `
struct BlacksiteTile {
  vec2 a;
  vec2 b;
  vec2 c;
  vec3 weights;
  vec2 dx;
  vec2 dy;
};
vec2 blacksiteTileOffset(vec2 cell) {
  vec3 p = fract(vec3(cell.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yzx + 33.33 + BLACKSITE_TILE_SEED);
  return fract((p.xx + p.yz) * p.zy);
}
BlacksiteTile blacksiteTile(vec2 uv) {
  vec2 skewed = mat2(1.0, -0.57735026919, 0.0, 1.15470053838) * uv / BLACKSITE_TILE_SPAN;
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
  return BlacksiteTile(uv + blacksiteTileOffset(a), uv + blacksiteTileOffset(b), uv + blacksiteTileOffset(c), weights, dFdx(uv), dFdy(uv));
}
vec4 blacksiteTileSample(sampler2D sourceMap, BlacksiteTile tile) {
  return textureGrad(sourceMap, tile.a, tile.dx, tile.dy) * tile.weights.x
    + textureGrad(sourceMap, tile.b, tile.dx, tile.dy) * tile.weights.y
    + textureGrad(sourceMap, tile.c, tile.dx, tile.dy) * tile.weights.z;
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
  const previousCompile = material.onBeforeCompile;
  const previousCache = material.customProgramCacheKey;
  const baseCache = previousCache === Material.prototype.customProgramCacheKey
    ? () => previousCompile.toString()
    : () => previousCache.call(material);
  const isPacked = () => sameSource(material.roughnessMap, material.metalnessMap) && sameSource(material.roughnessMap, material.aoMap);
  const define = `#define BLACKSITE_TILE_SPAN ${span}\n#define BLACKSITE_TILE_SHARPNESS ${sharpness}\n#define BLACKSITE_TILE_SEED ${seed.toExponential(8)}\n`;

  const compile: typeof material.onBeforeCompile = function (this: MeshStandardMaterial, shader, renderer) {
    previousCompile.call(this, shader, renderer);
    checkMaps(material);
    const packed = isPacked();
    const replace = (anchor: string, replacement: string) => {
      if (!shader.fragmentShader.includes(anchor)) throw new Error(`Stochastic tiling cannot find shader chunk ${anchor}.`);
      shader.fragmentShader = shader.fragmentShader.replace(anchor, replacement);
    };
    replace('#include <common>', `#include <common>\n${define}${sampling}`);
    let mapChunk = ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )', 'blacksiteTileSample(map, blacksiteTiles)');
    mapChunk = `BlacksiteTile blacksiteTiles = blacksiteTile(vMapUv);\n${mapChunk}`;
    if (packed) mapChunk += '\nvec4 blacksiteOrm = blacksiteTileSample(roughnessMap, blacksiteTiles);';
    replace('#include <map_fragment>', mapChunk);
    replace('#include <normal_fragment_maps>', ShaderChunk.normal_fragment_maps.replaceAll('texture2D( normalMap, vNormalMapUv )', 'blacksiteTileSample(normalMap, blacksiteTiles)'));
    for (const [chunk, sampler, uv] of [
      ['roughnessmap_fragment', 'roughnessMap', 'vRoughnessMapUv'],
      ['metalnessmap_fragment', 'metalnessMap', 'vMetalnessMapUv'],
      ['aomap_fragment', 'aoMap', 'vAoMapUv'],
    ] as const) {
      replace(`#include <${chunk}>`, ShaderChunk[chunk].replace(`texture2D( ${sampler}, ${uv} )`, packed ? 'blacksiteOrm' : `blacksiteTileSample(${sampler}, blacksiteTiles)`));
    }
  };
  const cache = () => `${baseCache()}|blacksite-stochastic-v1:${span}:${sharpness}:${seed}:${isPacked()}`;
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
