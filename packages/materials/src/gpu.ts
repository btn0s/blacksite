import * as THREE from 'three'
import { PARAMS, type KernelName, type Program } from './graph'

export type GpuOutputs = { readonly color: THREE.Texture; readonly normal: THREE.Texture; readonly orm: THREE.Texture; readonly masks: THREE.Texture }
export type GpuResult = GpuOutputs & { readonly kept: ReadonlyMap<string, THREE.WebGLRenderTarget> }
export type GpuEvaluator = {
  evaluate(program: Program, images?: ReadonlyMap<string, THREE.Texture>, keep?: readonly string[]): GpuResult
  readback(target: THREE.WebGLRenderTarget | string, x?: number, y?: number, width?: number, height?: number): Float32Array
  dispose(): void
}

const OUTPUTS = ['color', 'normal', 'orm', 'masks'] as const

const VERTEX = `precision highp float;
in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`

const PRELUDE = `precision highp float;
precision highp int;
precision highp sampler2D;
uniform float p[16];
uniform vec4 stops[16];
uniform sampler2D t0, t1, t2, t3;
uniform ivec2 size;
uniform ivec2 src;
out vec4 fragColor;
#define TAU 6.283185307179586
int imod(int a, int n) { int r = a - n * (a / n); return r < 0 ? r + n : r; }
float hash3(int x, int y, int s) {
  uint h = (uint(x) * 0x8da6b343u) ^ (uint(y) * 0xd8163841u) ^ (uint(s) * 0xcb1ab31fu);
  h ^= h >> 16u; h *= 0x7feb352du; h ^= h >> 15u; h *= 0x846ca68bu; h ^= h >> 16u;
  return float(h >> 8u) / 16777216.0;
}
int ip(float v) { return int(round(v)); }
float clamp01(float v) { return clamp(v, 0.0, 1.0); }
float smoothe(float e0, float e1, float x) { float t = clamp01((x - e0) / (e1 - e0)); return t * t * (3.0 - 2.0 * t); }
vec4 v1(float v) { return vec4(v, v, v, 1.0); }
vec4 fetchW(sampler2D t, ivec2 q) { ivec2 s = textureSize(t, 0); return texelFetch(t, ivec2(imod(q.x, s.x), imod(q.y, s.y)), 0); }
vec4 bilinear(sampler2D t, vec2 f) {
  vec2 i = floor(f);
  vec2 d = f - i;
  ivec2 q = ivec2(i);
  vec4 a = fetchW(t, q), b = fetchW(t, q + ivec2(1, 0)), c = fetchW(t, q + ivec2(0, 1)), e = fetchW(t, q + ivec2(1, 1));
  vec4 ab = a + (b - a) * d.x;
  return ab + ((c + (e - c) * d.x) - ab) * d.y;
}
vec4 sampleUV(sampler2D t, vec2 uv) { return bilinear(t, uv * vec2(textureSize(t, 0)) - 0.5); }
vec4 gridMean(sampler2D t) {
  ivec2 s = textureSize(t, 0);
  vec4 sum = vec4(0.0);
  for (int j = 0; j < 16; j++) for (int i = 0; i < 16; i++) sum += fetchW(t, ivec2(((2 * i + 1) * s.x) / 32, ((2 * j + 1) * s.y) / 32));
  return sum / 256.0;
}
`

const MAIN = `
void main() {
  ivec2 xy = ivec2(gl_FragCoord.xy);
  fragColor = run((vec2(xy) + 0.5) / vec2(size), xy);
}
`

const KERNELS: Record<KernelName | 'copy', string> = {
  copy: `vec4 run(vec2 uv, ivec2 xy) { return fetchW(t0, xy); }`,

  const: `vec4 run(vec2 uv, ivec2 xy) { return vec4(R, G, B, A); }`,

  noise: `
float quintic(float t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
float valueNoise(vec2 q, int px, int py, int s) {
  vec2 f = floor(q);
  ivec2 i = ivec2(f);
  float ux = quintic(q.x - f.x), uy = quintic(q.y - f.y);
  int i0 = imod(i.x, px), i1 = imod(i.x + 1, px), j0 = imod(i.y, py), j1 = imod(i.y + 1, py);
  float a = hash3(i0, j0, s), b = hash3(i1, j0, s), c = hash3(i0, j1, s), d = hash3(i1, j1, s);
  return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uy;
}
float gradientDot(int i, int j, int s, float dx, float dy) { float a = hash3(i, j, s) * TAU; return cos(a) * dx + sin(a) * dy; }
float perlinNoise(vec2 q, int px, int py, int s) {
  vec2 f = floor(q);
  ivec2 i = ivec2(f);
  float fx = q.x - f.x, fy = q.y - f.y;
  int i0 = imod(i.x, px), i1 = imod(i.x + 1, px), j0 = imod(i.y, py), j1 = imod(i.y + 1, py);
  float a = gradientDot(i0, j0, s, fx, fy), b = gradientDot(i1, j0, s, fx - 1.0, fy);
  float c = gradientDot(i0, j1, s, fx, fy - 1.0), d = gradientDot(i1, j1, s, fx - 1.0, fy - 1.0);
  float ux = quintic(fx), uy = quintic(fy);
  float n = (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uy;
  return clamp01(0.5 + n * 0.70710678);
}
float cellularNoise(vec2 q, int px, int py, int s, float jitter, int mode) {
  ivec2 i = ivec2(floor(q));
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for (int dj = -1; dj <= 1; dj++) for (int di = -1; di <= 1; di++) {
    int cx = i.x + di, cy = i.y + dj;
    int wx = imod(cx, px), wy = imod(cy, py);
    float fx = float(cx) + 0.5 + jitter * (hash3(wx, wy, s) - 0.5);
    float fy = float(cy) + 0.5 + jitter * (hash3(wx, wy, s + 1) - 0.5);
    float d = length(vec2(q.x - fx, q.y - fy));
    if (d < f1) { f2 = f1; f1 = d; id = hash3(wx, wy, s + 2); }
    else if (d < f2) f2 = d;
  }
  if (mode == 0) return clamp01(f1);
  if (mode == 1) return clamp01(f2 * 0.8);
  if (mode == 2) return clamp01((f2 - f1) * 1.6);
  return id;
}
vec4 run(vec2 uv, ivec2 xy) {
  int octaves = ip(OCTAVES), seed = ip(SEED), basis = ip(BASIS), mode = ip(MODE);
  float sum = 0.0, norm = 0.0, amp = 1.0;
  for (int k = 0; k < octaves; k++) {
    float f = float(1 << k);
    int s = (seed + k * 1013) & 0xffffff;
    vec2 q = vec2(uv.x * PX * f, uv.y * PY * f);
    int px = ip(PX * f), py = ip(PY * f);
    float n = basis == 0 ? valueNoise(q, px, py, s) : basis == 1 ? perlinNoise(q, px, py, s) : cellularNoise(q, px, py, s, JITTER, mode);
    if (RIDGED > 0.0) { float b = 1.0 - abs(2.0 * n - 1.0); n = b > 0.0 ? pow(b, SHARPNESS) : 0.0; }
    sum += n * amp;
    norm += amp;
    amp *= GAIN;
  }
  return v1(sum / norm);
}`,

  wave: `vec4 run(vec2 uv, ivec2 xy) {
  float t = (AXIS == 0.0 ? uv.x : uv.y) * CYCLES + PHASE;
  if (SHAPE == 0.0) return v1(0.5 + 0.5 * sin(TAU * t));
  if (SHAPE == 1.0) return v1(1.0 - abs(2.0 * fract(t) - 1.0));
  return v1(fract(t));
}`,

  tiles: `
float boundary(float k, int row, int cols, int seed) { return LENGTH_JITTER > 0.0 ? k + LENGTH_JITTER * (hash3(imod(int(k), cols), row, seed + 7) - 0.5) : k; }
vec4 run(vec2 uv, ivec2 xy) {
  int cols = ip(COLS), rows = ip(ROWS), seed = ip(SEED);
  float gy = uv.y * ROWS;
  float row = floor(gy);
  float fy = gy - row;
  int rowW = imod(int(row), rows);
  float gx = uv.x * COLS + OFFSET * float(rowW) + OFFSET_JITTER * hash3(rowW, 0, seed);
  float col = floor(gx);
  if (gx < boundary(col, rowW, cols, seed)) col -= 1.0;
  else if (gx >= boundary(col + 1.0, rowW, cols, seed)) col += 1.0;
  float left = boundary(col, rowW, cols, seed);
  float right = boundary(col + 1.0, rowW, cols, seed);
  float cellW = SIZE / COLS;
  float cellH = SIZE / ROWS;
  float dx = min(gx - left, right - gx) * cellW;
  float dy = min(fy, 1.0 - fy) * cellH;
  float d = min(dx, dy) - GAP / 2.0;
  float r = hash3(imod(int(col), cols), rowW, seed + 3);
  if (OUTPUT == 1.0) return v1(r);
  if (OUTPUT == 2.0) return v1(clamp01(d / PIXEL + 0.5));
  if (OUTPUT == 3.0) return v1(clamp01(d / (0.5 * min((right - left) * cellW, cellH))));
  float b = clamp01(d / BEVEL);
  return v1(b * (2.0 - b) * (1.0 - JITTER * r));
}`,

  rivets: `vec4 run(vec2 uv, ivec2 xy) {
  float gx = uv.x * COLS - OFFSET_U;
  float gy = uv.y * ROWS - OFFSET_V;
  float dx = (fract(gx) - 0.5) * SIZE / COLS;
  float dy = (fract(gy) - 0.5) * SIZE / ROWS;
  float dist = length(vec2(dx, dy));
  float d = dist / RADIUS;
  float aa = clamp01((RADIUS - dist) / PIXEL + 0.5);
  if (OUTPUT == 1.0) return v1(hash3(imod(int(floor(gx)), ip(COLS)), imod(int(floor(gy)), ip(ROWS)), 11));
  if (OUTPUT == 2.0) return v1(aa);
  if (OUTPUT == 3.0) return v1(min(1.0, d));
  return v1(sqrt(max(0.0, 1.0 - d * d)) * aa);
}`,

  scatter: `
float lobe(float theta, float h5, float h6) { return 1.0 + 0.22 * sin(2.0 * theta + TAU * h5) + 0.12 * sin(3.0 * theta + TAU * h6) + 0.08 * sin(5.0 * theta + TAU * (h5 + h6)) + 0.05 * sin(7.0 * theta + TAU * h6 * 2.3); }
vec4 run(vec2 uv, ivec2 xy) {
  int cols = ip(COLS), rows = ip(ROWS), seed = ip(SEED), shape = ip(SHAPE);
  float gx = uv.x * COLS;
  float gy = uv.y * ROWS;
  int ix = int(floor(gx)), iy = int(floor(gy));
  float height = 0.0, dist = 1.0, rand = 0.0, mask = 0.0;
  int reachX = ip(REACH_X), reachY = ip(REACH_Y);
  for (int dj = -reachY; dj <= reachY; dj++) for (int di = -reachX; di <= reachX; di++) {
    int cx = ix + di, cy = iy + dj;
    int wx = imod(cx, cols), wy = imod(cy, rows);
    if (hash3(wx, wy, seed) >= DENSITY) continue;
    float r = RADIUS * (1.0 - SIZE_JITTER * hash3(wx, wy, seed + 3));
    float qx = (gx - float(cx) - hash3(wx, wy, seed + 1)) * SIZE / COLS;
    float qy = (gy - float(cy) - hash3(wx, wy, seed + 2)) * SIZE / ROWS;
    if (ROTATE > 0.0) {
      float a = hash3(wx, wy, seed + 4) * TAU;
      float ca = cos(a), sa = sin(a);
      float rx = qx * ca - qy * sa;
      qy = qx * sa + qy * ca;
      qx = rx;
    }
    qy /= shape == 4 ? 4.0 * STRETCH : STRETCH;
    float d = length(vec2(qx, qy)) / r;
    if (shape == 2 || shape == 3) d /= lobe(atan(qy, qx), hash3(wx, wy, seed + 5), hash3(wx, wy, seed + 6));
    float edge = clamp01((1.0 - d) * r / PIXEL + 0.5);
    mask = max(mask, edge);
    float value = shape == 0 ? edge : shape == 1 ? clamp01(1.0 - d) : shape == 2 ? edge * (0.6 + 0.4 * clamp01(1.0 - d)) : smoothe(1.0, 0.0, d);
    if (value > height) height = value;
    if (d < dist) { dist = d; rand = hash3(wx, wy, seed + 9); }
  }
  if (OUTPUT == 1.0) return v1(rand);
  if (OUTPUT == 2.0) return v1(mask);
  if (OUTPUT == 3.0) return v1(min(1.0, dist));
  return v1(height);
}`,

  image: `
vec4 box(ivec2 q, ivec2 level, int n) {
  ivec2 o = ivec2(imod(q.x, level.x), imod(q.y, level.y)) * n;
  vec4 sum = vec4(0.0);
  for (int j = 0; j < n; j++) for (int i = 0; i < n; i++) sum += texelFetch(t0, o + ivec2(i, j), 0);
  return sum / float(n * n);
}
vec4 run(vec2 uv, ivec2 xy) {
  ivec2 level = src;
  ivec2 repeat = ivec2(ip(REPEAT_U), ip(REPEAT_V));
  int n = 1;
  for (int k = 0; k < 16; k++) { if (level.x * repeat.x < size.x * 2 || level.y * repeat.y < size.y * 2) break; level >>= 1; n *= 2; }
  vec2 f = uv * vec2(repeat) * vec2(level) - 0.5;
  vec2 i = floor(f);
  vec2 d = f - i;
  ivec2 q = ivec2(i);
  vec4 a = box(q, level, n), b = box(q + ivec2(1, 0), level, n), c = box(q + ivec2(0, 1), level, n), e = box(q + ivec2(1, 1), level, n);
  vec4 ab = a + (b - a) * d.x;
  return vec4((ab + ((c + (e - c) * d.x) - ab) * d.y).rgb, 1.0);
}`,

  warp: `vec4 run(vec2 uv, ivec2 xy) {
  float pixel = SIZE / float(size.x);
  vec2 off;
  if (VECTOR > 0.0) off = AMOUNT * (2.0 * vec2(fetchW(t1, xy).r, fetchW(t2, xy).r) - 1.0);
  else {
    float gx = (fetchW(t1, xy + ivec2(1, 0)).r - fetchW(t1, xy - ivec2(1, 0)).r) / (2.0 * pixel);
    float gy = (fetchW(t1, xy + ivec2(0, 1)).r - fetchW(t1, xy - ivec2(0, 1)).r) / (2.0 * pixel);
    float len = length(vec2(gx, gy));
    float scale = len > 1e-9 ? AMOUNT * min(1.0, len * AMOUNT) / len : 0.0;
    off = vec2(gx, gy) * scale;
  }
  return sampleUV(t0, uv + off / SIZE);
}`,

  blurPass: `vec4 run(vec2 uv, ivec2 xy) {
  int taps = min(ip(TAPS), 256);
  ivec2 dir = AXIS == 0.0 ? ivec2(1, 0) : ivec2(0, 1);
  float s2 = 2.0 * SIGMA * SIGMA;
  vec4 acc = vec4(0.0);
  float total = 0.0;
  for (int i = -taps; i <= taps; i++) {
    float w = exp(-float(i * i) / s2);
    acc += fetchW(t0, xy + dir * i) * w;
    total += w;
  }
  return acc / total;
}`,

  slopeBlur: `vec4 run(vec2 uv, ivec2 xy) {
  int samples = ip(SAMPLES), mode = ip(MODE);
  vec2 f = vec2(xy);
  vec4 acc = bilinear(t0, f);
  for (int s = 1; s <= samples; s++) {
    float gx = bilinear(t1, f + vec2(1.0, 0.0)).r - bilinear(t1, f - vec2(1.0, 0.0)).r;
    float gy = bilinear(t1, f + vec2(0.0, 1.0)).r - bilinear(t1, f - vec2(0.0, 1.0)).r;
    float len = length(vec2(gx, gy));
    if (len > 1e-6) f -= vec2(gx, gy) / len * STEP;
    vec4 value = bilinear(t0, f);
    acc = mode == 0 ? acc + value : mode == 1 ? min(acc, value) : max(acc, value);
  }
  return mode == 0 ? acc / float(samples + 1) : acc;
}`,

  levels: `
float lv(float x, float range) {
  float t = clamp01((x - IN_LOW) / range);
  float g = GAMMA == 1.0 ? t : t > 0.0 ? pow(t, 1.0 / GAMMA) : 0.0;
  return OUT_LOW + g * (OUT_HIGH - OUT_LOW);
}
vec4 run(vec2 uv, ivec2 xy) {
  float range = abs(IN_HIGH - IN_LOW) < 1e-6 ? (IN_HIGH >= IN_LOW ? 1e-6 : -1e-6) : IN_HIGH - IN_LOW;
  vec4 a = fetchW(t0, xy);
  return vec4(lv(a.r, range), lv(a.g, range), lv(a.b, range), a.a);
}`,

  curvature: `vec4 run(vec2 uv, ivec2 xy) {
  vec2 f = vec2(xy);
  float sum = 0.0;
  for (int k = 0; k < 8; k++) {
    float a = (float(k) + 0.5) * TAU / 8.0;
    vec2 c = vec2(cos(a), sin(a));
    sum += bilinear(t0, f + c * RADIUS).r + bilinear(t0, f + c * RADIUS * 0.5).r;
  }
  return v1(0.5 + 0.5 * clamp((fetchW(t0, xy).r - sum / 16.0) * SCALE, -1.0, 1.0));
}`,

  normal: `vec4 run(vec2 uv, ivec2 xy) {
  float dx = (fetchW(t0, xy + ivec2(1, 0)).r - fetchW(t0, xy - ivec2(1, 0)).r) * SCALE;
  float dy = (fetchW(t0, xy + ivec2(0, 1)).r - fetchW(t0, xy - ivec2(0, 1)).r) * SCALE;
  if (BASED > 0.0) {
    vec3 b = fetchW(t1, xy).rgb * 2.0 - 1.0;
    float bz = max(b.z, 0.05);
    dx -= b.x / bz;
    dy -= b.y / bz;
  }
  float len = length(vec3(dx, dy, 1.0));
  return vec4(0.5 - 0.5 * dx / len, 0.5 - 0.5 * dy / len, 0.5 + 0.5 / len, 1.0);
}`,

  ao: `vec4 run(vec2 uv, ivec2 xy) {
  vec2 f = vec2(xy);
  float h0 = fetchW(t0, xy).r;
  float occlusion = 0.0;
  for (int k = 0; k < 8; k++) {
    float a = (float(k) + 0.5) * TAU / 8.0;
    vec2 c = vec2(cos(a), sin(a));
    float best = 0.0;
    for (int s = 1; s <= 6; s++) {
      float t = RADIUS * float(s) / 6.0;
      float tn = (bilinear(t0, f + c * t).r - h0) * DEPTH / t;
      if (tn > best) best = tn;
    }
    occlusion += best / sqrt(1.0 + best * best);
  }
  return v1(clamp01(1.0 - STRENGTH * occlusion / 8.0));
}`,

  blend: `
float blendOne(int mode, float a, float b) {
  if (mode == 0) return b;
  if (mode == 1) return a + b;
  if (mode == 2) return a - b;
  if (mode == 3) return a * b;
  if (mode == 4) return 1.0 - (1.0 - a) * (1.0 - b);
  if (mode == 5) return a < 0.5 ? 2.0 * a * b : 1.0 - 2.0 * (1.0 - a) * (1.0 - b);
  if (mode == 6) return max(a, b);
  if (mode == 7) return min(a, b);
  if (mode == 8) return abs(a - b);
  return a - b + 0.5;
}
vec4 run(vec2 uv, ivec2 xy) {
  int mode = ip(MODE);
  float t = OPACITY * (MASKED > 0.0 ? fetchW(t2, xy).r : 1.0);
  vec4 a = fetchW(t0, xy), b = fetchW(t1, xy);
  return vec4(a.r + (blendOne(mode, a.r, b.r) - a.r) * t, a.g + (blendOne(mode, a.g, b.g) - a.g) * t, a.b + (blendOne(mode, a.b, b.b) - a.b) * t, a.a);
}`,

  ramp: `vec4 run(vec2 uv, ivec2 xy) {
  int count = ip(COUNT);
  float t = clamp01(fetchW(t0, xy).r);
  if (t <= stops[0].x) return vec4(stops[0].yzw, 1.0);
  for (int i = 1; i < 16; i++) {
    if (i >= count) break;
    float p1 = stops[i].x;
    if (t <= p1) {
      float p0 = stops[i - 1].x;
      float f = p1 > p0 ? (t - p0) / (p1 - p0) : 1.0;
      return vec4(stops[i - 1].yzw + (stops[i].yzw - stops[i - 1].yzw) * f, 1.0);
    }
  }
  return vec4(stops[max(count - 1, 0)].yzw, 1.0);
}`,

  hsv: `
vec3 rgbToHsv(vec3 c) {
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  float d = mx - mn;
  float h = 0.0;
  if (d > 1e-6) {
    if (mx == c.r) h = ((c.g - c.b) / d) / 6.0;
    else if (mx == c.g) h = ((c.b - c.r) / d + 2.0) / 6.0;
    else h = ((c.r - c.g) / d + 4.0) / 6.0;
  }
  return vec3(fract(h), mx > 1e-6 ? d / mx : 0.0, mx);
}
float hk(float n, vec3 c) { float k = mod(n + c.x * 6.0, 6.0); return c.z - c.z * c.y * clamp01(min(k, 4.0 - k)); }
vec4 run(vec2 uv, ivec2 xy) {
  vec4 a = fetchW(t0, xy);
  vec3 c = rgbToHsv(a.rgb);
  vec3 n = vec3(fract(c.x + HUE), clamp01(c.y * SATURATION), max(0.0, c.z * VALUE));
  return vec4(hk(5.0, n), hk(3.0, n), hk(1.0, n), a.a);
}`,

  channel: `vec4 run(vec2 uv, ivec2 xy) {
  int c = ip(CHANNEL);
  vec4 a = fetchW(t0, xy);
  return v1(c < 4 ? a[c] : 0.2126 * a.r + 0.7152 * a.g + 0.0722 * a.b);
}`,

  transform: `vec4 run(vec2 uv, ivec2 xy) {
  vec2 s = vec2(FLIP > 0.0 ? 1.0 - uv.x : uv.x, uv.y);
  int rotate = ip(ROTATE);
  for (int k = 0; k < 4; k++) { if (k >= rotate) break; s = vec2(1.0 - s.y, s.x); }
  return sampleUV(t0, vec2(s.x * REPEAT + OFFSET_U, s.y * REPEAT + OFFSET_V));
}`,

  seamlessPass: `vec4 run(vec2 uv, ivec2 xy) {
  vec3 m = gridMean(t0).rgb;
  float t = AXIS == 0.0 ? uv.x : uv.y;
  float w = smoothe(1.0 - 2.0 * WIDTH, 1.0, abs(2.0 * t - 1.0));
  float norm = sqrt((1.0 - w) * (1.0 - w) + w * w);
  ivec2 s = textureSize(t0, 0);
  ivec2 b = AXIS == 0.0 ? xy + ivec2(s.x >> 1, 0) : xy + ivec2(0, s.y >> 1);
  return vec4(m + ((1.0 - w) * (fetchW(t0, xy).rgb - m) + w * (fetchW(t0, b).rgb - m)) / norm, 1.0);
}`,

  delight: `vec4 run(vec2 uv, ivec2 xy) {
  float f = gridMean(t1).r / max(fetchW(t1, xy).r, 0.02);
  vec3 a = fetchW(t0, xy).rgb;
  return vec4(a + (a * f - a) * STRENGTH, 1.0);
}`,

  pack: `
float packOne(sampler2D t, float c, ivec2 xy) {
  if (c > 4.0) return 1.0;
  vec4 a = fetchW(t, xy);
  int i = ip(c);
  return clamp01(i < 4 ? a[i] : 0.2126 * a.r + 0.7152 * a.g + 0.0722 * a.b);
}
vec4 run(vec2 uv, ivec2 xy) { return vec4(packOne(t0, C0, xy), packOne(t1, C1, xy), packOne(t2, C2, xy), packOne(t3, C3, xy)); }`,
}

const define = (kernel: KernelName | 'copy') => (kernel === 'copy' ? [] : PARAMS[kernel]).map((name, i) => `#define ${name.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()} p[${i}]`).join('\n')

export function fragmentSource(kernel: KernelName | 'copy') {
  return `${PRELUDE}${define(kernel)}\n${KERNELS[kernel]}\n${MAIN}`
}

export function createGpuEvaluator(renderer: THREE.WebGLRenderer): GpuEvaluator {
  const float = renderer.extensions.has('EXT_color_buffer_float')
  const type = float ? THREE.FloatType : THREE.HalfFloatType
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3))
  const mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>(geometry, [])
  mesh.frustumCulled = false
  const scene = new THREE.Scene()
  scene.add(mesh)
  const camera = new THREE.Camera()
  const materials = new Map<string, THREE.RawShaderMaterial>()
  const pool = new Map<number, THREE.WebGLRenderTarget[]>()
  const zeros = new Float32Array(16)
  const noStops = new Float32Array(64)
  let outputs: Record<(typeof OUTPUTS)[number], THREE.WebGLRenderTarget> | null = null
  let kept = new Map<string, THREE.WebGLRenderTarget>()
  let finals = new Map<string, THREE.WebGLRenderTarget>()

  const material = (kernel: KernelName | 'copy') => {
    let m = materials.get(kernel)
    if (!m) {
      m = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3, vertexShader: VERTEX, fragmentShader: fragmentSource(kernel),
        uniforms: { p: { value: zeros }, stops: { value: noStops }, t0: { value: null }, t1: { value: null }, t2: { value: null }, t3: { value: null }, size: { value: new THREE.Vector2() }, src: { value: new THREE.Vector2() } },
        depthTest: false, depthWrite: false, blending: THREE.NoBlending,
      })
      materials.set(kernel, m)
    }
    return m
  }

  const acquire = (res: number) => {
    const free = pool.get(res)
    const reused = free?.pop()
    if (reused) return reused
    return new THREE.WebGLRenderTarget(res, res, { type, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, depthBuffer: false })
  }
  const release = (target: THREE.WebGLRenderTarget) => {
    const list = pool.get(target.width) ?? []
    list.push(target)
    pool.set(target.width, list)
  }

  const draw = (kernel: KernelName | 'copy', target: THREE.WebGLRenderTarget, inputs: readonly (THREE.Texture | null)[], params: Float32Array = zeros, stops: Float32Array = noStops) => {
    const m = material(kernel)
    const u = m.uniforms
    u.p!.value = params
    u.stops!.value = stops
    for (let i = 0; i < 4; i++) u[`t${i}`]!.value = inputs[i] ?? null
    ;(u.size!.value as THREE.Vector2).set(target.width, target.height)
    const img = inputs[0]?.image as { width?: number; height?: number } | undefined
    ;(u.src!.value as THREE.Vector2).set(img?.width ?? 0, img?.height ?? 0)
    m.uniformsNeedUpdate = true
    mesh.material = m
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
  }

  const outputTarget = (res: number) => new THREE.WebGLRenderTarget(res, res, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, generateMipmaps: true, depthBuffer: false, anisotropy,
  })

  function evaluate(program: Program, images: ReadonlyMap<string, THREE.Texture> = new Map(), keep: readonly string[] = []): GpuResult {
    const res = program.res
    for (const target of kept.values()) release(target)
    kept = new Map()
    for (const [size, list] of pool) if (size !== res) { list.forEach(target => target.dispose()); pool.delete(size) }
    if (!outputs) outputs = { color: outputTarget(res), normal: outputTarget(res), orm: outputTarget(res), masks: outputTarget(res) }
    else if (outputs.color.width !== res) for (const name of OUTPUTS) outputs[name].setSize(res, res)
    finals = new Map()
    for (const name of OUTPUTS) if (!finals.has(program.outputs[name])) finals.set(program.outputs[name], outputs[name])
    const previous = renderer.getRenderTarget()
    const face = renderer.getActiveCubeFace()
    const level = renderer.getActiveMipmapLevel()
    const autoClear = renderer.autoClear
    renderer.autoClear = false
    const results = new Map<string, THREE.WebGLRenderTarget>()
    const active = new Set<THREE.WebGLRenderTarget>()
    const lastUse = new Map<string, number>()
    program.steps.forEach((step, index) => step.inputs.forEach(id => lastUse.set(id, index)))
    try {
      program.steps.forEach((step, index) => {
        const target = finals.get(step.id) ?? acquire(res)
        if (!finals.has(step.id)) active.add(target)
        let inputs: (THREE.Texture | null)[]
        if (step.kernel === 'image') {
          const texture = images.get(step.image!)
          if (!texture) throw new Error(`image "${step.image}" was not provided`)
          inputs = [texture]
        } else inputs = step.inputs.map(id => results.get(id)!.texture)
        draw(step.kernel, target, inputs, step.params, step.stops)
        results.set(step.id, target)
        if (keep.includes(step.id) && !finals.has(step.id)) kept.set(step.id, target)
        for (const id of new Set(step.inputs)) if (lastUse.get(id) === index && !finals.has(id) && !kept.has(id)) {
          const used = results.get(id)!
          release(used)
          active.delete(used)
          results.delete(id)
        }
      })
      for (const name of OUTPUTS) {
        const id = program.outputs[name]
        if (outputs[name] !== results.get(id)) draw('copy', outputs[name], [results.get(id)!.texture])
      }
    } finally {
      const retained = new Set(kept.values())
      for (const target of active) if (!retained.has(target)) release(target)
      renderer.setRenderTarget(previous, face, level)
      renderer.autoClear = autoClear
    }
    return { color: outputs.color.texture, normal: outputs.normal.texture, orm: outputs.orm.texture, masks: outputs.masks.texture, kept }
  }

  function readback(target: THREE.WebGLRenderTarget | string, x = 0, y = 0, width?: number, height?: number): Float32Array {
    const rt = typeof target === 'string' ? kept.get(target) ?? finals.get(target) : target
    if (!rt) throw new Error(`nothing to read back for "${String(target)}"`)
    const w = width ?? rt.width - x
    const h = height ?? rt.height - y
    const out = new Float32Array(w * h * 4)
    if (rt.texture.type === THREE.FloatType) { renderer.readRenderTargetPixels(rt, x, y, w, h, out); return out }
    const previous = renderer.getRenderTarget()
    const face = renderer.getActiveCubeFace()
    const level = renderer.getActiveMipmapLevel()
    const copy = acquire(rt.width)
    try {
      if (copy.width !== rt.width || copy.height !== rt.height) copy.setSize(rt.width, rt.height)
      draw('copy', copy, [rt.texture])
      if (type === THREE.FloatType) renderer.readRenderTargetPixels(copy, x, y, w, h, out)
      else {
        const half = new Uint16Array(w * h * 4)
        renderer.readRenderTargetPixels(copy, x, y, w, h, half)
        for (let i = 0; i < half.length; i++) out[i] = THREE.DataUtils.fromHalfFloat(half[i]!)
      }
    } finally {
      renderer.setRenderTarget(previous, face, level)
      release(copy)
    }
    return out
  }

  function dispose() {
    for (const list of pool.values()) list.forEach(target => target.dispose())
    pool.clear()
    for (const target of kept.values()) target.dispose()
    kept.clear()
    finals.clear()
    if (outputs) for (const name of OUTPUTS) outputs[name].dispose()
    outputs = null
    for (const m of materials.values()) m.dispose()
    materials.clear()
    geometry.dispose()
  }

  return { evaluate, readback, dispose }
}
