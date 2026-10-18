import { Pass } from 'postprocessing';
import {
  ClampToEdgeWrapping, Data3DTexture, DataTexture, DynamicDrawUsage, Float32BufferAttribute, FloatType, InstancedBufferGeometry, InstancedInterleavedBuffer,
  InterleavedBufferAttribute, LinearFilter, Matrix4, Mesh, NearestFilter, NormalBlending, RGBAFormat, RedFormat, Scene, ShaderMaterial, UniformsLib,
  UniformsUtils, UnsignedByteType, Vector3, Vector4,
  type Camera, type Light, type Object3D, type PerspectiveCamera, type Texture, type WebGLRenderer, type WebGLRenderTarget,
} from 'three';

const SOFT_LAYER = 30;
const STRIDE = 24;
const SAMPLES = 64;
const CELLS = 16;

const frame = {
  softDepth: { value: null as Texture | null },
  softView: { value: new Vector4(1, 1, 0.1, 1000) },
};

const vertexShader = `
#include <common>
#include <fog_pars_vertex>
#include <lights_pars_begin>
#include <shadowmap_pars_vertex>
attribute vec4 spawn;
attribute vec4 velocity;
attribute vec4 force;
attribute vec4 shape;
attribute vec4 tint;
attribute vec4 drift;
uniform float time;
uniform float still;
uniform vec3 wrapCenter;
uniform vec3 wrapSize;
uniform sampler2D curves;
uniform sampler3D volumeMap;
uniform mat4 volumeMatrix;
uniform float volumeDensity;
uniform float volumeReach;
varying vec2 vCorner;
varying vec3 vTint;
varying float vAlpha;
varying float vGlow;
varying float vSeed;
varying float vRadius;
varying float vDistance;
varying vec3 vDirect;
varying vec3 vLean;
varying vec3 vSky;
varying vec3 vGround;
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  #ifdef SHADOWMAP_TYPE_PCF
    uniform sampler2DShadow directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
    float softShadow( sampler2DShadow map, vec4 coord, float bias, float intensity ) {
      coord.xyz /= coord.w;
      coord.z += bias;
      if ( coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || coord.z > 1.0 ) return 1.0;
      return mix( 1.0, texture( map, coord.xyz ), intensity );
    }
  #else
    uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
    float softShadow( sampler2D map, vec4 coord, float bias, float intensity ) {
      coord.xyz /= coord.w;
      #ifdef USE_REVERSED_DEPTH_BUFFER
        coord.z -= bias;
      #else
        coord.z += bias;
      #endif
      if ( coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || coord.z > 1.0 ) return 1.0;
      float depth = texture( map, coord.xy ).r;
      #ifdef USE_REVERSED_DEPTH_BUFFER
        return mix( 1.0, step( depth, coord.z ), intensity );
      #else
        return mix( 1.0, step( coord.z, depth ), intensity );
      #endif
    }
  #endif
#endif
float softTransmit( vec3 from, vec3 dir, float reach ) {
  if ( volumeDensity <= 0.0 || reach <= 0.0 ) return 1.0;
  reach = min( reach, volumeReach );
  vec3 a = ( volumeMatrix * vec4( from, 1.0 ) ).xyz;
  vec3 d = ( volumeMatrix * vec4( from + dir * reach, 1.0 ) ).xyz - a;
  vec3 inv = 1.0 / mix( d, vec3( 1e-6 ), step( abs( d ), vec3( 1e-6 ) ) );
  vec3 t0 = - a * inv;
  vec3 t1 = ( 1.0 - a ) * inv;
  vec3 lo = min( t0, t1 );
  vec3 hi = max( t0, t1 );
  float s0 = max( max( max( lo.x, lo.y ), lo.z ), 0.0 );
  float s1 = min( min( min( hi.x, hi.y ), hi.z ), 1.0 );
  if ( s1 <= s0 ) return 1.0;
  float sum = 0.0;
  for ( int i = 0; i < 6; i ++ ) sum += texture( volumeMap, a + d * mix( s0, s1, ( float( i ) + 0.5 ) / 6.0 ) ).r;
  return exp( - sum * volumeDensity * reach * ( s1 - s0 ) / 6.0 );
}
void softAdd( const in IncidentLight light, inout vec3 direct, inout vec3 lean ) {
  direct += light.color;
  lean += light.direction * dot( light.color, vec3( 0.2126, 0.7152, 0.0722 ) );
}
void main() {
  float age = time - spawn.w;
  float life = velocity.w;
  float t = life > 0.0 ? age / life : 0.0;
  if ( age < 0.0 || t >= 1.0 ) {
    gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
    return;
  }
  float k = force.w;
  float motion = 1.0 - still;
  float f = k > 1e-3 ? ( 1.0 - exp( - k * age ) ) / k : age;
  float g = k > 1e-3 ? ( age - f ) / k : 0.5 * age * age;
  vec3 center = spawn.xyz + ( velocity.xyz * f + force.xyz * g ) * motion;
  center.xz += drift.x * vec2( sin( time * 0.7 + shape.w * 6.2831853 ), cos( time * 0.5 + shape.w * 10.7 ) ) * motion;
  vec3 current = ( velocity.xyz * exp( - k * age ) + force.xyz * f ) * motion;
  float fade = 1.0;
  if ( wrapSize.x + wrapSize.y + wrapSize.z > 0.0 ) {
    vec3 axes = step( 1e-3, wrapSize );
    vec3 span = max( wrapSize, vec3( 1e-3 ) );
    vec3 local = mod( center - wrapCenter + 0.5 * span, span );
    center = mix( center, wrapCenter - 0.5 * span + local, axes );
    vec3 edge = mix( vec3( 1.0 ), clamp( min( local, span - local ) / ( 0.12 * span ), 0.0, 1.0 ), axes );
    fade = edge.x * edge.y * edge.z;
  }
  vec4 shade = vec4( 1.0 );
  float cover = 1.0;
  if ( life > 0.0 ) {
    float u = clamp( t, 0.0, 1.0 ) * float( SOFT_SAMPLES - 1 );
    int i0 = int( u );
    int i1 = min( i0 + 1, SOFT_SAMPLES - 1 );
    int row = int( drift.z + 0.5 ) * 2;
    shade = mix( texelFetch( curves, ivec2( i0, row ), 0 ), texelFetch( curves, ivec2( i1, row ), 0 ), u - float( i0 ) );
    cover = mix( texelFetch( curves, ivec2( i0, row + 1 ), 0 ).r, texelFetch( curves, ivec2( i1, row + 1 ), 0 ).r, u - float( i0 ) );
  }
  float radius = 0.5 * shape.x * ( 1.0 + shape.y * mix( t, 0.5, still ) );
  vec4 mvPosition = modelViewMatrix * vec4( center, 1.0 );
  vec4 worldPosition = modelMatrix * vec4( center, 1.0 );
  vec2 flow = ( modelViewMatrix * vec4( current, 0.0 ) ).xy;
  float speed = length( flow );
  vec2 axis = speed > 1e-4 ? flow / speed : vec2( 1.0, 0.0 );
  vec2 offset = axis * position.x * ( radius + 0.5 * drift.y * speed ) + vec2( - axis.y, axis.x ) * position.y * radius;
  vCorner = position.xy;
  vTint = tint.rgb * shade.rgb;
  vAlpha = shape.z * cover * fade;
  vGlow = tint.w * shade.a * fade;
  vSeed = shape.w;
  vRadius = radius;
  vDistance = - mvPosition.z;
  vec3 up = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
  vec3 direct = vec3( 0.0 );
  vec3 lean = vec3( 0.0 );
  vec3 sky = getAmbientLightIrradiance( ambientLightColor );
  vec3 ground = sky;
  #if defined( USE_LIGHT_PROBES )
    sky += getLightProbeIrradiance( lightProbe, up );
    ground += getLightProbeIrradiance( lightProbe, - up );
  #endif
  IncidentLight light;
  #if NUM_DIR_LIGHTS > 0
    #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
      DirectionalLightShadow directionalLightShadow;
    #endif
    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
      getDirectionalLightInfo( directionalLights[ i ], light );
      #if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
        directionalLightShadow = directionalLightShadows[ i ];
        light.color *= receiveShadow ? softShadow( directionalShadowMap[ i ], directionalShadowMatrix[ i ] * worldPosition, directionalLightShadow.shadowBias, directionalLightShadow.shadowIntensity ) : 1.0;
      #endif
      light.color *= softTransmit( mvPosition.xyz + light.direction * radius, light.direction, volumeReach );
      softAdd( light, direct, lean );
    }
    #pragma unroll_loop_end
  #endif
  #if NUM_SUN_LIGHTS > 0
    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_SUN_LIGHTS; i ++ ) {
      getSunLightInfo( sunLights[ i ], light );
      light.color *= softTransmit( mvPosition.xyz + light.direction * radius, light.direction, volumeReach );
      softAdd( light, direct, lean );
    }
    #pragma unroll_loop_end
  #endif
  #if NUM_POINT_LIGHTS > 0
    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
      getPointLightInfo( pointLights[ i ], mvPosition.xyz, light );
      light.color *= softTransmit( mvPosition.xyz + light.direction * radius, light.direction, length( pointLights[ i ].position - mvPosition.xyz ) - radius );
      softAdd( light, direct, lean );
    }
    #pragma unroll_loop_end
  #endif
  #if NUM_SPOT_LIGHTS > 0
    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
      getSpotLightInfo( spotLights[ i ], mvPosition.xyz, light );
      light.color *= softTransmit( mvPosition.xyz + light.direction * radius, light.direction, length( spotLights[ i ].position - mvPosition.xyz ) - radius );
      softAdd( light, direct, lean );
    }
    #pragma unroll_loop_end
  #endif
  #if NUM_HEMI_LIGHTS > 0
    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
      sky += getHemisphereLightIrradiance( hemisphereLights[ i ], up );
      ground += getHemisphereLightIrradiance( hemisphereLights[ i ], - up );
    }
    #pragma unroll_loop_end
  #endif
  vDirect = direct;
  vLean = lean;
  vSky = sky * softTransmit( mvPosition.xyz + up * radius, up, volumeReach );
  vGround = ground * softTransmit( mvPosition.xyz - up * radius, - up, volumeReach );
  mvPosition.xy += offset;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const fragmentShader = `
#include <common>
#include <packing>
#include <fog_pars_fragment>
uniform sampler2D softDepth;
uniform vec4 softView;
uniform float softness;
uniform float scatter;
varying vec2 vCorner;
varying vec3 vTint;
varying float vAlpha;
varying float vGlow;
varying float vSeed;
varying float vRadius;
varying float vDistance;
varying vec3 vDirect;
varying vec3 vLean;
varying vec3 vSky;
varying vec3 vGround;
float softNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  vec4 h = fract( sin( vec4( dot( i, vec2( 127.1, 311.7 ) ), dot( i + vec2( 1.0, 0.0 ), vec2( 127.1, 311.7 ) ), dot( i + vec2( 0.0, 1.0 ), vec2( 127.1, 311.7 ) ), dot( i + vec2( 1.0, 1.0 ), vec2( 127.1, 311.7 ) ) ) ) * 43758.5453 );
  return mix( mix( h.x, h.y, f.x ), mix( h.z, h.w, f.x ), f.y );
}
void main() {
  vec2 c = vCorner;
  float r2 = dot( c, c );
  if ( r2 >= 1.0 ) discard;
  float angle = vSeed * 6.2831853;
  vec2 q = mat2( cos( angle ), - sin( angle ), sin( angle ), cos( angle ) ) * c;
  float density = softNoise( q * 2.3 + vSeed * 31.0 ) * 0.62 + softNoise( q * 5.1 - vSeed * 17.0 ) * 0.38;
  float h = sqrt( 1.0 - r2 );
  float body = smoothstep( 0.0, 0.75, h * ( 0.45 + density ) - 0.2 );
  float scene = - perspectiveDepthToViewZ( texture2D( softDepth, gl_FragCoord.xy / softView.xy ).x, softView.z, softView.w );
  float contact = clamp( ( scene - vDistance ) / max( vRadius * softness, 1e-3 ), 0.0, 1.0 );
  float near = clamp( ( vDistance - softView.z ) / max( vRadius * 2.0, 1e-3 ), 0.0, 1.0 );
  float fade = body * contact * near;
  float alpha = vAlpha * fade;
  float glow = vGlow * fade;
  if ( alpha + glow < 0.002 ) discard;
  vec3 n = normalize( vec3( c, h ) );
  vec3 up = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
  vec3 lean = dot( vLean, vLean ) > 1e-10 ? normalize( vLean ) : up;
  float wrapped = max( 0.0, ( dot( n, lean ) + 0.6 ) / 1.6 );
  float forward = pow( max( 0.0, - lean.z ), 4.0 );
  vec3 light = mix( vGround, vSky, dot( n, up ) * 0.5 + 0.5 ) + vDirect * wrapped * ( 1.0 + scatter * forward );
  vec3 lit = vTint * ( 0.85 + 0.3 * density ) * RECIPROCAL_PI * light;
  float fogFactor = 0.0;
  vec3 fogged = lit;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    fogged = mix( lit, fogColor, fogFactor );
  #endif
  gl_FragColor = vec4( fogged * alpha + vTint * glow * ( 1.0 - fogFactor ), alpha );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

type Xyz = { readonly x: number; readonly y: number; readonly z: number };
type Rgb = { readonly r: number; readonly g: number; readonly b: number };

export interface SoftParticle {
  readonly position: Xyz;
  readonly velocity?: Xyz;
  readonly acceleration?: Xyz;
  readonly drag?: number;
  readonly life: number;
  readonly delay?: number;
  readonly size: number;
  readonly grow?: number;
  readonly opacity?: number;
  readonly tint: Rgb;
  readonly glow?: number;
  readonly flutter?: number;
  readonly stretch?: number;
  readonly seed?: number;
  readonly curve?: number;
}

export interface SoftKey {
  readonly at: number;
  readonly color?: Rgb;
  readonly glow?: number;
  readonly opacity?: number;
}

export interface SoftParticlesOptions {
  readonly capacity?: number;
  readonly softness?: number;
  readonly scatter?: number;
}

function envelope(t: number): number {
  const rise = Math.min(1, t / 0.08);
  return rise * rise * (3 - 2 * rise) * Math.pow(1 - t, 1.5);
}

export class SoftParticles extends Mesh<InstancedBufferGeometry, ShaderMaterial> {
  readonly capacity: number;
  private readonly data: Float32Array;
  private readonly buffer: InstancedInterleavedBuffer;
  private cursor = 0;
  private dirtyFrom = Infinity;
  private dirtyTo = -1;
  private curveData = new Float32Array(0);
  private curveMap: DataTexture | null = null;
  private readonly points: Float32Array;
  private readonly grid = new Float32Array(CELLS ** 3);
  private readonly spare = new Float32Array(CELLS ** 3);
  private readonly cells: Uint8Array;
  private readonly volume: Data3DTexture;
  private readonly bounds = new Matrix4();
  private readonly inverse = new Matrix4();
  private settled = NaN;

  constructor({ capacity = 256, softness = 1, scatter = 0.8 }: SoftParticlesOptions = {}) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('SoftParticles capacity must be a positive integer');
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const data = new Float32Array(capacity * STRIDE);
    const buffer = new InstancedInterleavedBuffer(data, STRIDE).setUsage(DynamicDrawUsage);
    (['spawn', 'velocity', 'force', 'shape', 'tint', 'drift'] as const).forEach((name, index) => geometry.setAttribute(name, new InterleavedBufferAttribute(buffer, 4, index * 4)));
    geometry.instanceCount = 0;
    const cells = new Uint8Array(CELLS ** 3);
    const volume = new Data3DTexture(cells, CELLS, CELLS, CELLS);
    volume.format = RedFormat;
    volume.type = UnsignedByteType;
    volume.minFilter = volume.magFilter = LinearFilter;
    volume.wrapS = volume.wrapT = volume.wrapR = ClampToEdgeWrapping;
    volume.unpackAlignment = 1;
    volume.needsUpdate = true;
    const material = new ShaderMaterial({
      name: 'look-soft-particles',
      defines: { SOFT_SAMPLES: SAMPLES },
      uniforms: {
        ...UniformsUtils.merge([UniformsLib.lights, UniformsLib.fog, {
          time: { value: 0 },
          still: { value: 0 },
          wrapCenter: { value: new Vector3() },
          wrapSize: { value: new Vector3() },
          softness: { value: softness },
          scatter: { value: scatter },
          volumeMatrix: { value: new Matrix4() },
          volumeDensity: { value: 0 },
          volumeReach: { value: 0 },
        }]),
        curves: { value: null },
        volumeMap: { value: volume },
        ...frame,
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      premultipliedAlpha: true,
      lights: true,
      fog: true,
    });
    super(geometry, material);
    this.name = 'soft-particles';
    this.capacity = capacity;
    this.data = data;
    this.buffer = buffer;
    this.cells = cells;
    this.volume = volume;
    this.points = new Float32Array(capacity * 5);
    this.frustumCulled = false;
    this.receiveShadow = true;
    this.layers.set(SOFT_LAYER);
    this.curve([]);
  }

  get time(): number {
    return this.material.uniforms.time!.value;
  }

  get still(): boolean {
    return this.material.uniforms.still!.value === 1;
  }

  set still(value: boolean) {
    this.material.uniforms.still!.value = value ? 1 : 0;
  }

  curve(keys: readonly SoftKey[]): number {
    const index = this.curveData.length / (SAMPLES * 8);
    const rows = new Float32Array(this.curveData.length + SAMPLES * 8);
    rows.set(this.curveData);
    const tracks = [0, 1, 2, 3, 4].map(channel => keys
      .map(key => ({ at: key.at, value: channel < 3 ? key.color && [key.color.r, key.color.g, key.color.b][channel] : channel === 3 ? key.glow : key.opacity }))
      .filter((key): key is { at: number; value: number } => key.value !== undefined)
      .sort((a, b) => a.at - b.at));
    for (let sample = 0; sample < SAMPLES; sample++) {
      const t = sample / (SAMPLES - 1);
      const o = (index * 2 * SAMPLES + sample) * 4;
      tracks.forEach((track, channel) => {
        let result = channel < 3 ? 1 : envelope(t);
        if (track.length) {
          const next = track.findIndex(key => key.at >= t);
          const b = track[next < 0 ? track.length - 1 : next]!;
          const a = track[next <= 0 ? (next < 0 ? track.length - 1 : 0) : next - 1]!;
          result = b.at > a.at ? a.value + (b.value - a.value) * (t - a.at) / (b.at - a.at) : b.value;
        }
        rows[channel < 4 ? o + channel : o + SAMPLES * 4] = result;
      });
    }
    this.curveData = rows;
    this.curveMap?.dispose();
    this.curveMap = new DataTexture(rows, SAMPLES, rows.length / (SAMPLES * 4), RGBAFormat, FloatType);
    this.curveMap.minFilter = this.curveMap.magFilter = NearestFilter;
    this.curveMap.needsUpdate = true;
    this.material.uniforms.curves!.value = this.curveMap;
    return index;
  }

  advance(dt: number): void {
    this.material.uniforms.time!.value += dt;
  }

  emit(particle: SoftParticle): void {
    const slot = this.cursor;
    const o = slot * STRIDE;
    const d = this.data;
    const { position, velocity, acceleration, tint } = particle;
    d[o] = position.x; d[o + 1] = position.y; d[o + 2] = position.z; d[o + 3] = this.time + (particle.delay ?? 0);
    d[o + 4] = velocity?.x ?? 0; d[o + 5] = velocity?.y ?? 0; d[o + 6] = velocity?.z ?? 0; d[o + 7] = particle.life;
    d[o + 8] = acceleration?.x ?? 0; d[o + 9] = acceleration?.y ?? 0; d[o + 10] = acceleration?.z ?? 0; d[o + 11] = particle.drag ?? 0;
    d[o + 12] = particle.size; d[o + 13] = particle.grow ?? 0; d[o + 14] = particle.opacity ?? 0; d[o + 15] = particle.seed ?? Math.random();
    d[o + 16] = tint.r; d[o + 17] = tint.g; d[o + 18] = tint.b; d[o + 19] = particle.glow ?? 0;
    d[o + 20] = particle.flutter ?? 0; d[o + 21] = particle.stretch ?? 0; d[o + 22] = particle.curve ?? 0; d[o + 23] = 0;
    this.dirtyFrom = Math.min(this.dirtyFrom, slot);
    this.dirtyTo = Math.max(this.dirtyTo, slot);
    this.cursor = (slot + 1) % this.capacity;
    this.geometry.instanceCount = Math.min(this.capacity, this.geometry.instanceCount + 1);
    this.settled = NaN;
  }

  wrap(center: Xyz | null, size?: Xyz): void {
    const uniforms = this.material.uniforms;
    if (!center || !size) {
      uniforms.wrapSize!.value.set(0, 0, 0);
      return;
    }
    uniforms.wrapCenter!.value.set(center.x, center.y, center.z);
    uniforms.wrapSize!.value.set(size.x, size.y, size.z);
  }

  reset(): void {
    this.cursor = 0;
    this.geometry.instanceCount = 0;
    this.dirtyFrom = Infinity;
    this.dirtyTo = -1;
    this.settled = NaN;
  }

  override onBeforeRender(_renderer: WebGLRenderer, _scene: Scene, camera: Camera): void {
    if (this.dirtyTo >= this.dirtyFrom) {
      this.buffer.clearUpdateRanges();
      this.buffer.addUpdateRange(this.dirtyFrom * STRIDE, (this.dirtyTo - this.dirtyFrom + 1) * STRIDE);
      this.buffer.needsUpdate = true;
      this.dirtyFrom = Infinity;
      this.dirtyTo = -1;
    }
    if (this.settled !== this.time) this.settle();
    this.material.uniforms.volumeMatrix!.value.copy(this.bounds).multiply(this.inverse.copy(this.matrixWorld).invert()).multiply(camera.matrixWorld);
  }

  private opacityAt(curve: number, t: number): number {
    const u = Math.min(1, Math.max(0, t)) * (SAMPLES - 1);
    const i = Math.min(SAMPLES - 2, Math.floor(u));
    const o = ((curve * 2 + 1) * SAMPLES + i) * 4;
    return this.curveData[o]! + (this.curveData[o + 4]! - this.curveData[o]!) * (u - i);
  }

  private settle(): void {
    this.settled = this.time;
    const uniforms = this.material.uniforms;
    const d = this.data;
    const p = this.points;
    const time = this.time;
    const still = this.still;
    const motion = still ? 0 : 1;
    const span = uniforms.wrapSize!.value as Vector3;
    const middle = uniforms.wrapCenter!.value as Vector3;
    const wrapping = span.x + span.y + span.z > 0;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    let count = 0;
    let total = 0;
    for (let slot = 0; slot < this.geometry.instanceCount; slot++) {
      const o = slot * STRIDE;
      const age = time - d[o + 3]!;
      const life = d[o + 7]!;
      const t = life > 0 ? age / life : 0;
      let cover = d[o + 14]!;
      if (age < 0 || t >= 1 || cover <= 0) continue;
      if (life > 0) cover *= this.opacityAt(Math.round(d[o + 22]!), t);
      const k = d[o + 11]!;
      const f = k > 1e-3 ? (1 - Math.exp(-k * age)) / k : age;
      const g = k > 1e-3 ? (age - f) / k : 0.5 * age * age;
      const radius = 0.5 * d[o + 12]! * (1 + d[o + 13]! * (still ? 0.5 : t));
      for (let axis = 0; axis < 3; axis++) {
        let at = d[o + axis]! + (d[o + 4 + axis]! * f + d[o + 8 + axis]! * g) * motion;
        const size = span.getComponent(axis);
        if (wrapping && size > 1e-3) {
          const local = (((at - middle.getComponent(axis) + 0.5 * size) % size) + size) % size;
          at = middle.getComponent(axis) - 0.5 * size + local;
          cover *= Math.min(1, Math.min(local, size - local) / (0.12 * size));
        }
        p[count * 5 + axis] = at;
      }
      if (cover < 0.01) continue;
      p[count * 5 + 3] = radius;
      p[count * 5 + 4] = -Math.log(1 - Math.min(cover, 0.95)) * (2 / 3) * Math.PI * radius * radius;
      for (let axis = 0; axis < 3; axis++) {
        lo[axis] = Math.min(lo[axis]!, p[count * 5 + axis]! - radius);
        hi[axis] = Math.max(hi[axis]!, p[count * 5 + axis]! + radius);
      }
      total += p[count * 5 + 4]!;
      count++;
    }
    const thin = total / Math.max(1e-6, Math.min((hi[0]! - lo[0]!) * (hi[1]! - lo[1]!), (hi[1]! - lo[1]!) * (hi[2]! - lo[2]!), (hi[0]! - lo[0]!) * (hi[2]! - lo[2]!))) < 0.01;
    if (count === 0 || thin) {
      uniforms.volumeDensity!.value = 0;
      return;
    }
    const cx = Math.max(hi[0]! - lo[0]!, 1e-3) / (CELLS - 2);
    const cy = Math.max(hi[1]! - lo[1]!, 1e-3) / (CELLS - 2);
    const cz = Math.max(hi[2]! - lo[2]!, 1e-3) / (CELLS - 2);
    const ox = lo[0]! - cx, oy = lo[1]! - cy, oz = lo[2]! - cz;
    const grid = this.grid;
    grid.fill(0);
    for (let index = 0; index < count; index++) {
      const ux = (p[index * 5]! - ox) / cx - 0.5, uy = (p[index * 5 + 1]! - oy) / cy - 0.5, uz = (p[index * 5 + 2]! - oz) / cz - 0.5;
      const bx = Math.min(CELLS - 2, Math.max(0, Math.floor(ux))), by = Math.min(CELLS - 2, Math.max(0, Math.floor(uy))), bz = Math.min(CELLS - 2, Math.max(0, Math.floor(uz)));
      const wx = Math.min(1, Math.max(0, ux - bx)), wy = Math.min(1, Math.max(0, uy - by)), wz = Math.min(1, Math.max(0, uz - bz));
      const mass = p[index * 5 + 4]!;
      for (let corner = 0; corner < 8; corner++) {
        const x = corner & 1, y = (corner >> 1) & 1, z = corner >> 2;
        grid[(bz + z) * CELLS * CELLS + (by + y) * CELLS + bx + x] += mass * (x ? wx : 1 - wx) * (y ? wy : 1 - wy) * (z ? wz : 1 - wz);
      }
    }
    for (let pass = 0; pass < 2; pass++) for (let axis = 0; axis < 3; axis++) this.blur(axis);
    const volume = cx * cy * cz;
    let peak = 0;
    for (let index = 0; index < grid.length; index++) peak = Math.max(peak, grid[index]!);
    for (let index = 0; index < grid.length; index++) this.cells[index] = Math.round((255 * grid[index]!) / Math.max(peak, 1e-9));
    this.volume.needsUpdate = true;
    uniforms.volumeDensity!.value = peak / volume;
    uniforms.volumeReach!.value = Math.hypot(cx, cy, cz) * CELLS;
    this.bounds.makeScale(1 / (cx * CELLS), 1 / (cy * CELLS), 1 / (cz * CELLS)).multiply(this.inverse.makeTranslation(-ox, -oy, -oz));
  }

  private blur(axis: number): void {
    const from = this.grid;
    const to = this.spare;
    const step = axis === 0 ? 1 : axis === 1 ? CELLS : CELLS * CELLS;
    for (let index = 0; index < from.length; index++) {
      const at = Math.floor(index / step) % CELLS;
      to[index] = 0.5 * from[index]! + (at > 0 ? 0.25 * from[index - step]! : 0) + (at < CELLS - 1 ? 0.25 * from[index + step]! : 0);
    }
    from.set(to);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.curveMap?.dispose();
    this.volume.dispose();
  }
}

export class SoftPass extends Pass {
  private depth: Texture | null = null;
  private readonly view = new Scene();

  constructor(scene: Scene, camera: Camera) {
    super('SoftPass', scene, camera);
    this.needsSwap = false;
    this.needsDepthTexture = true;
    this.view.matrixWorldAutoUpdate = false;
  }

  override setDepthTexture(depthTexture: Texture): void {
    this.depth = depthTexture;
  }

  override render(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget): void {
    if (!this.depth) return;
    const camera = this.camera as PerspectiveCamera;
    const found = this.view.children;
    let particles = 0;
    this.scene.traverseVisible((object: Object3D) => {
      if (object instanceof SoftParticles) {
        found.push(object);
        particles++;
      } else if ((object as Light).isLight && object.layers.test(camera.layers)) {
        found.push(object);
      }
    });
    if (particles > 0) {
      this.view.fog = this.scene.fog;
      frame.softDepth.value = this.depth;
      frame.softView.value.set(inputBuffer.width, inputBuffer.height, camera.near, camera.far);
      const mask = camera.layers.mask;
      const { autoUpdate, needsUpdate } = renderer.shadowMap;
      camera.layers.enable(SOFT_LAYER);
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = false;
      renderer.setRenderTarget(this.renderToScreen ? null : inputBuffer);
      renderer.render(this.view, camera);
      camera.layers.mask = mask;
      renderer.shadowMap.autoUpdate = autoUpdate;
      renderer.shadowMap.needsUpdate = needsUpdate;
    }
    found.length = 0;
  }
}
