import { MeshStandardMaterial, ObjectSpaceNormalMap, RepeatWrapping, ShaderChunk, ShaderLib, Texture } from 'three';
import type { WebGLRenderer } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { applyStochasticTiling } from '../packages/look/src/stochastic';

function texture() {
  const result = new Texture();
  result.wrapS = result.wrapT = RepeatWrapping;
  result.repeat.set(18, 18);
  return result;
}

function material() {
  const orm = texture();
  return new MeshStandardMaterial({ map: texture(), normalMap: texture(), roughnessMap: orm, metalnessMap: orm.clone(), aoMap: orm.clone() });
}

function compile(target: MeshStandardMaterial) {
  const shader = { ...ShaderLib.standard, uniforms: { ...ShaderLib.standard.uniforms } };
  target.onBeforeCompile(shader as Parameters<typeof target.onBeforeCompile>[0], {} as WebGLRenderer);
  return shader.fragmentShader;
}

describe('stochastic material sampling', () => {
  it('shares transformed coordinates, weights and continuous derivatives between every PBR channel', () => {
    const target = material();
    const repeat = target.map!.repeat.clone();
    applyStochasticTiling(target);
    const shader = compile(target);
    expect(shader).toContain('blacksiteTile(vMapUv)');
    expect(shader).toContain('blacksiteTileColour(map, blacksiteTiles)');
    expect(shader).toContain('blacksiteTileNormal(normalMap, blacksiteTiles, normalScale)');
    expect(shader).toContain('textureGrad(sourceMap, tile.a, tile.rotationA * tile.dx, tile.rotationA * tile.dy)');
    expect(shader).toContain('weights, dFdx(uv), dFdy(uv)');
    expect(shader).not.toContain('texture2D( normalMap, vNormalMapUv )');
    expect(target.map!.repeat).toEqual(repeat);
    expect(shader).not.toContain('time');
  });

  it('rotates each normal back into surface tangent space after applying normal scale', () => {
    const target = material();
    target.normalScale.set(0.7, -0.4);
    applyStochasticTiling(target);
    const shader = compile(target);
    expect(shader).toContain('normal.xy = transpose(rotation) * (normal.xy * scale);');
    expect(shader).toContain('normal.z = sqrt(max(1.0 - dot(normal.xy, normal.xy), 0.0));');
    expect(shader).not.toContain('mapN.xy *= normalScale;');
    expect(shader).not.toContain('mapN = vec3( mapN.xy, sqrt(');
    expect(shader).toContain('normal = normalize( tbn * mapN );');
  });

  it('gives directional and unrestricted rotation modes distinct programs', () => {
    const caches = new Set<string>();
    for (const [rotation, code] of [['none', 0], ['half-turn', 2], ['quarter-turn', 4]] as const) {
      const target = material();
      applyStochasticTiling(target, { rotation });
      expect(compile(target)).toContain(`#define BLACKSITE_TILE_ROTATION ${code}`);
      caches.add(target.customProgramCacheKey());
    }
    expect(caches.size).toBe(3);
  });

  it('composes already expanded map chunks and preserves liveMaterial float-colour decoding', () => {
    const target = material();
    target.defines = { DECODE_VIDEO_TEXTURE: 1 };
    const previous = vi.fn((shader: Parameters<typeof target.onBeforeCompile>[0]) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', ShaderChunk.map_fragment);
    });
    target.onBeforeCompile = previous;
    target.customProgramCacheKey = () => 'live-srgb';
    applyStochasticTiling(target);
    const shader = compile(target);
    expect(previous).toHaveBeenCalledOnce();
    expect(shader).toContain('sRGBTransferEOTF(textureGrad(sourceMap, tile.a,');
    expect(shader).toContain('return sRGBTransferOETF(a * tile.weights.x + b * tile.weights.y + c * tile.weights.z);');
    expect(shader).toContain('sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );');
    expect(shader).toContain('blacksiteTileColour(map, blacksiteTiles)');
    expect(target.defines.DECODE_VIDEO_TEXTURE).toBe(1);
    expect(target.customProgramCacheKey()).toContain('live-srgb|blacksite-stochastic-v2');
  });

  it('supports an existing custom sRGB decoding hook without replacing its effect', () => {
    const target = material();
    target.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', ShaderChunk.map_fragment.replace('#ifdef DECODE_VIDEO_TEXTURE', '#if 1'));
    };
    applyStochasticTiling(target, { shaderDecodesSRGB: true });
    const shader = compile(target);
    expect(shader).toContain('#define BLACKSITE_TILE_SHADER_SRGB 1');
    expect(shader).toContain('#if 1\n\t\tsampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );');
  });

  it('samples a packed ORM source once even when its textures are clones', () => {
    const target = material();
    applyStochasticTiling(target);
    const shader = compile(target);
    expect(shader.match(/blacksiteTileSample\(roughnessMap, blacksiteTiles\)/g)).toHaveLength(1);
    expect(shader).toContain('vec4 texelRoughness = blacksiteOrm;');
    expect(shader).toContain('vec4 texelMetalness = blacksiteOrm;');
    expect(shader).toContain('( blacksiteOrm.r - 1.0 )');
    expect(shader).not.toContain('blacksiteTileSample(aoMap');
  });

  it('keeps separate ORM images separate and includes the layout in the program cache', () => {
    const packed = material();
    const separate = material();
    separate.aoMap = texture();
    applyStochasticTiling(packed);
    applyStochasticTiling(separate);
    const shader = compile(separate);
    expect(shader).toContain('blacksiteTileSample(roughnessMap, blacksiteTiles)');
    expect(shader).toContain('blacksiteTileSample(metalnessMap, blacksiteTiles)');
    expect(shader).toContain('blacksiteTileSample(aoMap, blacksiteTiles)');
    expect(separate.customProgramCacheKey()).not.toEqual(packed.customProgramCacheKey());
  });

  it('preserves existing compilation and cache hooks and restores them on removal', () => {
    const target = material();
    const previous = vi.fn(function (shader: Parameters<typeof target.onBeforeCompile>[0]) {
      shader.fragmentShader = shader.fragmentShader.replace('uniform float opacity;', 'uniform float opacity;\nuniform float customValue;');
    });
    const cache = () => 'existing-material';
    target.onBeforeCompile = previous;
    target.customProgramCacheKey = cache;
    const initialVersion = target.version;
    const remove = applyStochasticTiling(target);
    expect(compile(target)).toContain('uniform float customValue;');
    expect(previous).toHaveBeenCalledOnce();
    expect(target.customProgramCacheKey()).toContain('existing-material|blacksite-stochastic');
    expect(target.version).toBeGreaterThan(initialVersion);
    remove();
    remove();
    expect(target.onBeforeCompile).toBe(previous);
    expect(target.customProgramCacheKey).toBe(cache);
    expect(() => applyStochasticTiling(target)).not.toThrow();
  });

  it('keeps different original compilation hooks in separate cached programs', () => {
    const a = material();
    const b = material();
    a.onBeforeCompile = function () { return; };
    b.onBeforeCompile = function () {};
    applyStochasticTiling(a);
    applyStochasticTiling(b);
    expect(a.customProgramCacheKey()).not.toEqual(b.customProgramCacheKey());
  });

  it('rejects maps that would lose alignment or tangent-space correctness', () => {
    const mismatched = material();
    mismatched.normalMap!.repeat.set(1, 1);
    expect(() => applyStochasticTiling(mismatched)).toThrow('matching UV channels and transforms');
    const channel = material();
    channel.aoMap!.channel = 1;
    expect(() => applyStochasticTiling(channel)).toThrow('matching UV channels and transforms');
    const objectSpace = material();
    objectSpace.normalMapType = ObjectSpaceNormalMap;
    expect(() => applyStochasticTiling(objectSpace)).toThrow('tangent-space normal map');
    const extra = material();
    extra.displacementMap = texture();
    expect(() => applyStochasticTiling(extra)).toThrow('colour, tangent normal and ORM maps only');
  });

  it('validates repeat wrapping and numeric controls', () => {
    expect(() => applyStochasticTiling(new MeshStandardMaterial())).toThrow('colour map');
    expect(() => applyStochasticTiling(new MeshStandardMaterial({ map: new Texture() }))).toThrow('RepeatWrapping');
    expect(() => applyStochasticTiling(material(), { tileSpan: 0 })).toThrow('tileSpan');
    expect(() => applyStochasticTiling(material(), { blendSharpness: Infinity })).toThrow('blendSharpness');
    expect(() => applyStochasticTiling(material(), { seed: NaN })).toThrow('seed');
  });
});
