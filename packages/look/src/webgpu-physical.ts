import { CubeCamera, CubeRenderTarget, HalfFloatType, LinearFilter, NodeMaterial, PMREMGenerator, QuadMesh, RenderTarget, Scene, Vector2, Vector3, Vector4 } from 'three/webgpu'
import type { Camera, Node, WebGPURenderer } from 'three/webgpu'
import { cameraPosition, positionWorldDirection, sampler, screenUV, texture, uniform, wgslFn } from 'three/tsl'
import { LightProbeGenerator } from 'three/addons/lights/LightProbeGenerator.js'
import type { Atmosphere } from './atmosphere'
import { QUALITY, type QualityTier } from './quality'

const CORE = `
fn atRaySphere(origin: vec3f, direction: vec3f, radius: f32) -> vec2f {
  let b = dot(origin, direction);
  let c = dot(origin, origin) - radius * radius;
  let d = b * b - c;
  if (d < 0.0) { return vec2f(-1.0); }
  let s = sqrt(d);
  return vec2f(-b - s, -b + s);
}
fn atRho(r: f32) -> f32 { return sqrt(max(0.0, (r - 6360.0) * (r + 6360.0))); }
fn atRayleigh(h: f32, medium: vec4f) -> vec3f {
  return vec3f(5.802e-3, 13.558e-3, 33.1e-3) * medium.x * exp(-max(h, 0.0) / 8.0);
}
fn atMie(h: f32, medium: vec4f) -> f32 { return 3.996e-3 * medium.y * exp(-max(h, 0.0) / 1.2); }
fn atExtinction(h: f32, medium: vec4f) -> vec3f {
  let height = max(h, 0.0);
  return atRayleigh(height, medium) + vec3f(4.4e-3 * medium.y * exp(-height / 1.2)) + vec3f(0.65e-3, 1.881e-3, 0.085e-3) * medium.z * max(0.0, 1.0 - abs(height - 25.0) / 15.0);
}
fn atTransmittanceUv(r: f32, mu: f32) -> vec2f {
  let top = sqrt(6460.0 * 6460.0 - 6360.0 * 6360.0);
  let rho = atRho(r);
  let d = max(0.0, -r * mu + sqrt(max(r * r * (mu * mu - 1.0) + 6460.0 * 6460.0, 0.0)));
  let dMin = 6460.0 - r;
  let dMax = rho + top;
  return vec2f((d - dMin) / (dMax - dMin), rho / top);
}
fn atToSub(u: f32, size: f32) -> f32 { return (u + 0.5 / size) * (size / (size + 1.0)); }
fn atFromSub(u: f32, size: f32) -> f32 { return (u - 0.5 / size) * (size / (size - 1.0)); }
fn atPhaseRayleigh(c: f32) -> f32 { return 3.0 / (16.0 * 3.141592653589793) * (1.0 + c * c); }
fn atPhaseMie(c: f32, g: f32) -> f32 {
  let g2 = g * g;
  return 3.0 / (8.0 * 3.141592653589793) * ((1.0 - g2) * (1.0 + c * c)) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}
fn atPhaseHg(c: f32, g: f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / (4.0 * 3.141592653589793 * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}
fn atSunHidden(r: f32, mu: f32) -> bool { return mu < -atRho(r) / r; }
fn atTransmittance(lut: texture_2d<f32>, lutSampler: sampler, r: f32, mu: f32) -> vec3f {
  return textureSampleLevel(lut, lutSampler, atTransmittanceUv(r, mu), 0.0).rgb;
}
fn atSkyUv(direction: vec3f, medium: vec4f, sun: vec4f, size: vec2f) -> vec2f {
  let r = 6360.0 + medium.w;
  let cosBeta = atRho(r) / r;
  let beta = acos(clamp(cosBeta, -1.0, 1.0));
  let zenithHorizon = 3.141592653589793 - beta;
  let vz = clamp(direction.y, -1.0, 1.0);
  var v: f32;
  if (vz >= -cosBeta) { v = (1.0 - sqrt(max(1.0 - acos(vz) / zenithHorizon, 0.0))) * 0.5; }
  else { v = sqrt(max((acos(vz) - zenithHorizon) / beta, 0.0)) * 0.5 + 0.5; }
  let dl = length(direction.xz);
  let sl = length(sun.xz);
  var lv = 1.0;
  if (dl > 1e-5 && sl > 1e-5) { lv = clamp(dot(direction.xz, sun.xz) / (dl * sl), -1.0, 1.0); }
  return vec2f(atToSub(sqrt(max(0.5 - lv * 0.5, 0.0)), size.x), atToSub(v, size.y));
}
fn atSky(lut: texture_2d<f32>, lutSampler: sampler, direction: vec3f, medium: vec4f, sun: vec4f, size: vec2f) -> vec3f {
  return textureSampleLevel(lut, lutSampler, atSkyUv(direction, medium, sun, size), 0.0).rgb * sun.w;
}
`

const transmittanceNode = wgslFn(`
fn atmosphereTransmittance(uv: vec2f, medium: vec4f) -> vec4f {
  let top = sqrt(6460.0 * 6460.0 - 6360.0 * 6360.0);
  let rho = top * uv.y;
  let r = sqrt(rho * rho + 6360.0 * 6360.0);
  let dMin = 6460.0 - r;
  let dMax = rho + top;
  let d = dMin + uv.x * (dMax - dMin);
  var mu = 1.0;
  if (d > 0.0) { mu = clamp((top * top - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0); }
  let origin = vec3f(0.0, r, 0.0);
  let direction = vec3f(sqrt(max(0.0, 1.0 - mu * mu)), mu, 0.0);
  let span = atRaySphere(origin, direction, 6460.0).y;
  let dt = span / 40.0;
  var depth = vec3f(0.0);
  for (var i = 0; i < 40; i++) {
    let p = origin + direction * ((f32(i) + 0.5) * dt);
    depth += atExtinction(length(p) - 6360.0, medium) * dt;
  }
  return vec4f(exp(-depth), 1.0);
}
${CORE}`)

const multipleNode = wgslFn(`
fn atmosphereMultiple(uvIn: vec2f, medium: vec4f, transmittance: texture_2d<f32>, transSampler: sampler) -> vec4f {
  let uv = vec2f(atFromSub(uvIn.x, 32.0), atFromSub(uvIn.y, 32.0));
  let cosSun = uv.x * 2.0 - 1.0;
  let r = 6360.0 + max(uv.y * 100.0, 0.01);
  let origin = vec3f(0.0, r, 0.0);
  let sun = vec3f(sqrt(max(0.0, 1.0 - cosSun * cosSun)), cosSun, 0.0);
  var total = vec3f(0.0);
  var transfer = vec3f(0.0);
  for (var a = 0; a < 8; a++) {
    for (var b = 0; b < 8; b++) {
      let theta = acos(1.0 - 2.0 * (f32(b) + 0.5) / 8.0);
      let phi = 2.0 * 3.141592653589793 * (f32(a) + 0.5) / 8.0;
      let direction = vec3f(sin(theta) * cos(phi), cos(theta), sin(theta) * sin(phi));
      var span = atRaySphere(origin, direction, 6460.0).y;
      let ground = atRaySphere(origin, direction, 6360.0).x;
      let hitsGround = ground > 0.0;
      if (hitsGround) { span = ground; }
      let dt = span / 20.0;
      var throughput = vec3f(1.0);
      var light = vec3f(0.0);
      var scatterSum = vec3f(0.0);
      for (var s = 0; s < 20; s++) {
        let p = origin + direction * ((f32(s) + 0.5) * dt);
        let pr = length(p);
        let h = pr - 6360.0;
        let extinction = max(atExtinction(h, medium), vec3f(1e-9));
        let scattering = atRayleigh(h, medium) + vec3f(atMie(h, medium));
        let step = exp(-extinction * dt);
        let mu = dot(p, sun) / pr;
        var sunT = vec3f(0.0);
        if (!atSunHidden(pr, mu)) { sunT = atTransmittance(transmittance, transSampler, pr, mu); }
        let source = scattering * sunT / (4.0 * 3.141592653589793);
        light += throughput * (source - source * step) / extinction;
        scatterSum += throughput * (scattering - scattering * step) / extinction;
        throughput *= step;
      }
      if (hitsGround) {
        let normal = normalize(origin + direction * span);
        let mu = dot(normal, sun);
        light += throughput * atTransmittance(transmittance, transSampler, 6360.0, mu) * max(mu, 0.0) * 0.3 / 3.141592653589793;
      }
      total += light;
      transfer += scatterSum;
    }
  }
  return vec4f((total / 64.0) / (vec3f(1.0) - transfer / 64.0), 1.0);
}
${CORE}`)

function makeSkyView(steps: number) {
  return wgslFn(`
fn atmosphereView(uvIn: vec2f, medium: vec4f, sunValue: vec4f, size: vec2f, mieG: f32, transmittance: texture_2d<f32>, transSampler: sampler, multi: texture_2d<f32>, multiSampler: sampler) -> vec4f {
  let uv = vec2f(atFromSub(uvIn.x, size.x), atFromSub(uvIn.y, size.y));
  let r = 6360.0 + medium.w;
  let cosBeta = atRho(r) / r;
  let beta = acos(clamp(cosBeta, -1.0, 1.0));
  let zenithHorizon = 3.141592653589793 - beta;
  var zenith: f32;
  if (uv.y < 0.5) { let c = 1.0 - 2.0 * uv.y; zenith = zenithHorizon * (1.0 - c * c); }
  else { let c = uv.y * 2.0 - 1.0; zenith = zenithHorizon + beta * c * c; }
  let lv = -(uv.x * uv.x * 2.0 - 1.0);
  let direction = vec3f(sin(zenith) * lv, cos(zenith), sin(zenith) * sqrt(max(0.0, 1.0 - lv * lv)));
  let sunMu = normalize(sunValue.xyz).y;
  let sun = vec3f(sqrt(max(0.0, 1.0 - sunMu * sunMu)), sunMu, 0.0);
  let origin = vec3f(0.0, r, 0.0);
  var span = atRaySphere(origin, direction, 6460.0).y;
  let ground = atRaySphere(origin, direction, 6360.0).x;
  if (ground > 0.0) { span = ground; }
  let c = dot(direction, sun);
  let phaseR = atPhaseRayleigh(c);
  let phaseM = atPhaseMie(c, mieG);
  var light = vec3f(0.0);
  var throughput = vec3f(1.0);
  var previous = 0.0;
  for (var i = 0; i < ${steps}; i++) {
    let f = (f32(i) + 1.0) / ${steps}.0;
    let next = span * f * f;
    let dt = next - previous;
    let p = origin + direction * (previous + dt * 0.3);
    previous = next;
    let pr = length(p);
    let h = pr - 6360.0;
    let extinction = max(atExtinction(h, medium), vec3f(1e-9));
    let mu = dot(p, sun) / pr;
    var sunT = vec3f(0.0);
    if (!atSunHidden(pr, mu)) { sunT = atTransmittance(transmittance, transSampler, pr, mu); }
    let msUv = vec2f(atToSub(mu * 0.5 + 0.5, 32.0), atToSub(clamp(h / 100.0, 0.0, 1.0), 32.0));
    let multiple = textureSampleLevel(multi, multiSampler, msUv, 0.0).rgb;
    let rayleigh = atRayleigh(h, medium);
    let mie = atMie(h, medium);
    let source = sunT * (rayleigh * phaseR + vec3f(mie * phaseM)) + multiple * (rayleigh + vec3f(mie));
    let step = exp(-extinction * dt);
    light += throughput * (source - source * step) / extinction;
    throughput *= step;
  }
  return vec4f(light, 1.0);
}
${CORE}`)
}

const CLOUDS = `
fn cloudHash(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn cloudGradient(cell: vec2f) -> vec2f {
  let i = vec2i(cell);
  let h = cloudHash(bitcast<u32>(i.x) * 1664525u + cloudHash(bitcast<u32>(i.y) + 1013904223u));
  let a = f32(h) * (6.28318530718 / 4294967296.0);
  return vec2f(cos(a), sin(a));
}
fn cloudNoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * f * (f * (f * 6.0 - vec2f(15.0)) + vec2f(10.0));
  let a = dot(cloudGradient(i), f);
  let b = dot(cloudGradient(i + vec2f(1.0, 0.0)), f - vec2f(1.0, 0.0));
  let c = dot(cloudGradient(i + vec2f(0.0, 1.0)), f - vec2f(0.0, 1.0));
  let d = dot(cloudGradient(i + vec2f(1.0, 1.0)), f - vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn cloudFbm(p: vec2f, footprint: f32, octaves: i32) -> f32 {
  var sum = 0.0;
  var amplitude = 0.5;
  var frequency = 1.0;
  var q = p;
  for (var i = 0; i < octaves; i++) {
    var n = cloudNoise(q);
    if (i >= 1) { n = mix(n, abs(n) * 2.0 - 0.38, 0.3); }
    sum += amplitude * n * (1.0 - smoothstep(0.18, 0.45, footprint * frequency));
    q = mat2x2f(0.8, 0.6, -0.6, 0.8) * q * 2.03 + vec2f(13.1, 7.7);
    frequency *= 2.03;
    amplitude *= 0.56;
  }
  return sum;
}
fn cloudEdge(q: vec2f, footprint: f32, octaves: i32, clouds: vec4f, cloudTime: f32) -> f32 {
  var p = q * 0.38 * clouds.w + vec2f(cloudTime * 0.004, cloudTime * 0.0012);
  p += vec2f(cloudNoise(p * 0.3 + vec2f(1.7, 9.2)), cloudNoise(p * 0.3 + vec2f(8.3, 2.8))) * 0.5;
  let base = cloudFbm(p, footprint * 0.65 * clouds.w, octaves) * 1.3 + 0.5;
  return base + cloudNoise(q * 0.05 * clouds.w + vec2f(3.1, 1.3)) * 0.7 - (1.0 - clouds.x);
}
fn cloudSoft(footprint: f32, clouds: vec4f) -> f32 { return 0.62 + min(footprint * 0.65 * clouds.w, 1.0) * 0.3; }
fn cloudAmount(q: vec2f, footprint: f32, octaves: i32, clouds: vec4f, cloudTime: f32) -> f32 {
  return clamp(cloudEdge(q, footprint, octaves, clouds, cloudTime) / cloudSoft(footprint, clouds), 0.0, 1.0);
}
`

function makeSky(octaves: number, shadowSteps: number) {
  return wgslFn(`
fn atmosphereSky(viewIn: vec3f, eye: vec3f, medium: vec4f, sun: vec4f, size: vec2f, skyGain: f32, disk: f32, clouds: vec4f, cloudTime: f32, transmittance: texture_2d<f32>, transSampler: sampler, skyView: texture_2d<f32>, viewSampler: sampler) -> vec4f {
  let view = normalize(viewIn);
  let pixel = max(length(fwidth(view)), 1e-5);
  let direction = normalize(vec3f(view.x, max(view.y, 0.0005), view.z));
  var colour = atSky(skyView, viewSampler, direction, medium, sun, size) * skyGain;
  var visible = 1.0;
  if (clouds.x > 0.0) {
    let origin = vec3f(0.0, 6360.0 + medium.w, 0.0);
    let t = atRaySphere(origin, direction, 6360.0 + clouds.y).y;
    let p = origin + direction * t;
    let up = p / length(p);
    let mu = max(dot(up, direction), 0.03);
    let along = direction.xz / max(length(direction.xz), 1e-4);
    let q = p.xz - along * dot(p.xz, along) * (1.0 - mix(0.45, 1.0, smoothstep(0.04, 0.35, mu))) + eye.xz * 0.001;
    let footprint = t * pixel / mu;
    let edge = cloudEdge(q, footprint, ${octaves}, clouds, cloudTime);
    let aa = fwidth(edge);
    let fade = 1.0 - smoothstep(26.0, 52.0, t);
    let d = clamp(edge / cloudSoft(footprint, clouds), 0.0, 1.0) * fade;
    if (d > 0.002) {
      let toward = sun.xz / max(length(sun.xz), 1e-4);
      let s1 = cloudAmount(q + toward * 0.08, footprint, ${octaves - 1}, clouds, cloudTime) * fade;
      let s2 = ${shadowSteps > 1 ? `cloudAmount(q + toward * 0.25, footprint, ${octaves - 2}, clouds, cloudTime) * fade` : 's1'};
      let s3 = ${shadowSteps > 2 ? `cloudAmount(q + toward * 0.6, footprint, ${octaves - 3}, clouds, cloudTime) * fade` : 's2'};
      let tau = d * clouds.z / mu;
      let alpha = 1.0 - exp(-tau);
      let shadow = exp(-(d * 0.5 + s1 * 0.6 + s2 + s3 * 0.7) * clouds.z * 0.55);
      let sunlight = atTransmittance(transmittance, transSampler, 6360.0 + clouds.y, dot(up, sun.xyz)) * sun.w;
      let c = dot(direction, sun.xyz);
      let phase = mix(atPhaseHg(c, 0.75), atPhaseHg(c, -0.2), 0.25);
      let forward = smoothstep(-0.2, 0.7, c);
      var single = sunlight * shadow * phase * mix(alpha * 0.55, tau * exp(-tau) * 2.2, forward) * 3.0;
      let rim = smoothstep(0.0, 1.0, clamp((d - s1) * 1.2, 0.0, 1.0));
      let side = 1.0 - smoothstep(0.05, 0.45, mu);
      let rise = clamp((d - cloudAmount(q + along * 0.12, footprint, ${octaves - 1}, clouds, cloudTime) * fade) * 3.0 + 0.5, 0.0, 1.0);
      single *= mix(1.0, (0.75 + 0.6 * rim) * mix(0.8, 1.2, rise), side * 0.6);
      let multiple = sunlight * (0.06 + 0.08 * rim + 0.04 * rise * side) * mix(1.0, shadow, 0.5) * alpha * (0.25 + 0.75 * smoothstep(-0.3, 0.9, c));
      let ambient = (atSky(skyView, viewSampler, normalize(vec3f(direction.x, 0.03, direction.z)), medium, sun, size) * 0.26 + atSky(skyView, viewSampler, vec3f(0.0, 1.0, 0.0), medium, sun, size) * 0.42) * skyGain * alpha * (1.0 - 0.35 * d) * mix(1.0, mix(0.9, 1.1, rise), side);
      let amount = smoothstep(0.0, aa * 1.5 + 1e-6, edge) * exp(-t * 0.02);
      let cloud = vec4f(single + multiple + ambient, alpha) * amount;
      colour = colour * (1.0 - cloud.a) + cloud.rgb;
      visible = 1.0 - cloud.a;
    }
  }
  if (disk > 0.0) {
    let radius = 0.004675 * max(disk, 0.5);
    let angle = sqrt(max(2.0 * (1.0 - dot(view, sun.xyz)), 0.0));
    let edge = 1.0 - smoothstep(radius - pixel, radius + pixel, angle);
    let x = min(angle / radius, 1.0);
    let limb = vec3f(1.0) - vec3f(0.397, 0.503, 0.652) * (1.0 - sqrt(max(1.0 - x * x, 0.0)));
    colour += sun.w * 40.0 * limb * edge * atTransmittance(transmittance, transSampler, 6360.0 + medium.w, max(view.y, -0.01)) * visible;
  }
  return vec4f(colour, 1.0);
}
${CORE}
${CLOUDS}`)
}

const aerialNode = wgslFn(`
fn atmosphereAerial(color: vec4f, uv: vec2f, depth: f32, projectionInverse: mat4x4f, cameraWorld: mat4x4f, reversed: f32, medium: vec4f, sun: vec4f, size: vec2f, aerial: f32, clearDistance: f32, fog: vec4f, fogTint: vec3f, transmittance: texture_2d<f32>, transSampler: sampler, skyView: texture_2d<f32>, viewSampler: sampler) -> vec4f {
  if ((reversed < 0.5 && depth >= 1.0) || (reversed > 0.5 && depth <= 0.0)) { return color; }
  let projected = projectionInverse * vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, depth, 1.0);
  let point = projected.xyz / projected.w;
  let span = length(point);
  let direction = normalize((cameraWorld * vec4f(point, 0.0)).xyz);
  let y0 = cameraWorld[3].y;
  let y1 = y0 + direction.y * span;
  let km = span * 0.001;
  let h0 = max(y0 * 0.001 + medium.w, 0.0);
  let h1 = max(y1 * 0.001 + medium.w, 0.0);
  let tauAir = (vec3f(5.802e-3, 13.558e-3, 33.1e-3) * medium.x * atLayer(h0, h1, km, 8.0) + vec3f(4.4e-3 * medium.y * atLayer(h0, h1, km, 1.2))) * aerial;
  var tauFog = 0.0;
  if (fog.x > 0.0) { tauFog = fog.x * atLayer(max(y0 - fog.y, 0.0), max(y1 - fog.y, 0.0), span, fog.z); }
  let tau = (tauAir + vec3f(tauFog)) * clamp(1.0 - clearDistance / max(span, 1.0), 0.0, 1.0);
  let transmission = exp(-tau);
  let horizon = normalize(vec3f(direction.x, max(direction.y, 0.0), direction.z));
  let air = atSky(skyView, viewSampler, horizon, medium, sun, size);
  var fogColor = air;
  if (fog.x > 0.0) {
    let sunlight = atTransmittance(transmittance, transSampler, 6360.0 + medium.w, sun.y) * sun.w * atPhaseHg(dot(direction, sun.xyz), 0.55);
    fogColor = fogTint * (atSky(skyView, viewSampler, vec3f(0.0, 1.0, 0.0), medium, sun, size) * 0.55 + air * 0.45 + sunlight);
  }
  let weight = vec3f(tauFog) / max(tauAir + vec3f(tauFog), vec3f(1e-6));
  let inscatter = mix(air, fogColor, weight) * (vec3f(1.0) - transmission);
  return vec4f(color.rgb * transmission + inscatter, color.a);
}
fn atLayer(h0: f32, h1: f32, span: f32, scale: f32) -> f32 {
  let a = exp(-h0 / scale);
  let b = exp(-h1 / scale);
  let dh = h1 - h0;
  if (abs(dh) < 1e-3 * scale) { return span * 0.5 * (a + b); }
  return span * scale * (a - b) / dh;
}
${CORE}`)

export async function createWebGPUAtmosphere(renderer: WebGPURenderer, atmosphere: Atmosphere, quality: QualityTier) {
  const spec = atmosphere.physical
  if (!spec) throw new Error('The WebGPU atmosphere requires a physical sky definition')
  const settings = QUALITY[quality].atmosphere
  const medium = uniform(new Vector4(spec.rayleigh, spec.mie, spec.ozone, Math.max(spec.elevation, 1) * 0.001))
  const direction = new Vector3(...atmosphere.sun.direction).normalize()
  const sun = uniform(new Vector4(direction.x, direction.y, direction.z, spec.illuminance))
  const size = uniform(new Vector2(...settings.view))
  const skyGain = uniform(spec.sky ?? 1)
  const disk = uniform(spec.disk)
  const clouds = uniform(new Vector4(spec.clouds?.coverage ?? 0, spec.clouds?.altitude ?? 2.2, spec.clouds?.density ?? 1, spec.clouds?.scale ?? 1))
  const cloudTime = uniform(0)
  const targets = [[256, 64], [32, 32], settings.view].map(([width, height]) => new RenderTarget(width, height, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false, generateMipmaps: false }))
  const [transmittance, multiple, view] = targets
  transmittance.texture.name = 'Atmosphere.transmittance'
  multiple.texture.name = 'Atmosphere.multiple'
  view.texture.name = 'Atmosphere.skyView'
  const transTexture = texture(transmittance.texture)
  const multiTexture = texture(multiple.texture)
  const viewTexture = texture(view.texture)
  const shared = { medium, sun, size, transmittance: transTexture, transSampler: sampler(transTexture), skyView: viewTexture, viewSampler: sampler(viewTexture) }
  const material = new NodeMaterial({ depthTest: false, depthWrite: false })
  const quad = new QuadMesh(material)
  const previous = renderer.getRenderTarget()
  const draws = [
    transmittanceNode({ uv: screenUV, medium }),
    multipleNode({ uvIn: screenUV, medium, transmittance: transTexture, transSampler: sampler(transTexture) }),
    makeSkyView(settings.steps)({ uvIn: screenUV, medium, sunValue: sun, size, mieG: uniform(spec.mieAnisotropy), transmittance: transTexture, transSampler: sampler(transTexture), multi: multiTexture, multiSampler: sampler(multiTexture) }),
  ]
  for (let index = 0; index < draws.length; index++) {
    material.fragmentNode = draws[index]
    material.needsUpdate = true
    quad.name = targets[index].texture.name
    renderer.setRenderTarget(targets[index])
    quad.render(renderer)
  }
  renderer.setRenderTarget(previous)
  material.dispose()
  const makeBackground = (includeDisk: boolean) => makeSky(settings.octaves, settings.shadow)({ viewIn: positionWorldDirection, eye: cameraPosition, ...shared, skyGain: includeDisk ? skyGain : uniform(1), disk: includeDisk ? disk : uniform(0), clouds, cloudTime })
  const backgroundNode = makeBackground(true)
  const environmentScene = new Scene()
  environmentScene.backgroundNode = makeBackground(false)
  const cube = new CubeRenderTarget(quality === 'low' ? 128 : 256, { type: HalfFloatType })
  const cubeCamera = new CubeCamera(1, 2000, cube)
  cubeCamera.update(renderer, environmentScene)
  const pmrem = new PMREMGenerator(renderer)
  const environment = pmrem.fromCubemap(cube.texture)
  const probe = await LightProbeGenerator.fromCubeRenderTarget(renderer, cube)
  const up = probe.sh.getIrradianceAt(new Vector3(0, 1, 0), new Vector3())
  const irradiance = Math.max(1e-6, up.x * 0.2126 + up.y * 0.7152 + up.z * 0.0722)
  cube.dispose()
  pmrem.dispose()
  return {
    backgroundNode,
    environment,
    irradiance,
    aerial(color: Node<'vec4'>, depth: Node<'float'>, camera: Camera) {
      const fog = spec.heightFog
      return aerialNode({ color, uv: screenUV, depth, projectionInverse: uniform(camera.projectionMatrixInverse), cameraWorld: uniform(camera.matrixWorld), reversed: uniform(camera.reversedDepth ? 1 : 0), ...shared, aerial: uniform(spec.aerial), clearDistance: uniform(spec.clear ?? 0), fog: uniform(new Vector4(fog?.density ?? 0, fog?.base ?? 0, Math.max(fog?.falloff ?? 1, 1), 0)), fogTint: uniform(new Vector3(...(fog?.tint ?? [1, 1, 1] as const))) }) as Node<'vec4'>
    },
    tick(dt: number) { cloudTime.value += dt * (spec.clouds?.wind ?? 0) },
    dispose() { for (const target of targets) target.dispose(); environment.dispose() },
  }
}
