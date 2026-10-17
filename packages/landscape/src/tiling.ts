export const ANTI_TILING_GLSL = /* glsl */ `
struct BsTiles {
  vec2 o1;
  vec2 o2;
  vec2 o3;
  vec3 w;
};
vec2 bsTileOffset(ivec2 v, float salt) {
  vec2 p = vec2(v) + salt * 17.13;
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}
BsTiles bsTilesAt(vec2 uv, float salt) {
  vec2 skewed = mat2(1.0, 0.0, -0.57735027, 1.15470054) * (uv * 3.4641016);
  ivec2 base = ivec2(floor(skewed));
  vec3 t = vec3(fract(skewed), 0.0);
  t.z = 1.0 - t.x - t.y;
  ivec2 v1;
  ivec2 v2;
  ivec2 v3;
  vec3 w;
  if (t.z > 0.0) { w = vec3(t.z, t.y, t.x); v1 = base; v2 = base + ivec2(0, 1); v3 = base + ivec2(1, 0); }
  else { w = vec3(-t.z, 1.0 - t.y, 1.0 - t.x); v1 = base + ivec2(1, 1); v2 = base + ivec2(1, 0); v3 = base + ivec2(0, 1); }
  w = w * w * w;
  w /= dot(w, vec3(1.0));
  return BsTiles(bsTileOffset(v1, salt), bsTileOffset(v2, salt), bsTileOffset(v3, salt), w);
}
vec4 bsTileSample(sampler2DArray tex, vec2 uv, float layer, BsTiles tiles, vec4 mean) {
  vec2 dx = dFdx(uv);
  vec2 dy = dFdy(uv);
  vec4 a = textureGrad(tex, vec3(uv + tiles.o1, layer), dx, dy) - mean;
  vec4 b = textureGrad(tex, vec3(uv + tiles.o2, layer), dx, dy) - mean;
  vec4 c = textureGrad(tex, vec3(uv + tiles.o3, layer), dx, dy) - mean;
  return mean + (a * tiles.w.x + b * tiles.w.y + c * tiles.w.z) * inversesqrt(max(dot(tiles.w, tiles.w), 1e-4));
}
`
