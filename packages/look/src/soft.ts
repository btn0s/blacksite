import { Pass } from 'postprocessing';
import {
  DynamicDrawUsage, Float32BufferAttribute, InstancedBufferGeometry, InstancedInterleavedBuffer, InterleavedBufferAttribute,
  Mesh, NormalBlending, Scene, ShaderMaterial, UniformsLib, UniformsUtils, Vector3, Vector4,
  type Camera, type Light, type Object3D, type PerspectiveCamera, type Texture, type WebGLRenderer, type WebGLRenderTarget,
} from 'three';

const SOFT_LAYER = 30;
const STRIDE = 24;

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
  float envelope = life > 0.0 ? smoothstep( 0.0, 0.08, t ) * pow( 1.0 - t, 1.5 ) : 1.0;
  float radius = 0.5 * shape.x * ( 1.0 + shape.y * mix( t, 0.5, still ) );
  vec4 mvPosition = modelViewMatrix * vec4( center, 1.0 );
  vec4 worldPosition = modelMatrix * vec4( center, 1.0 );
  vec2 flow = ( modelViewMatrix * vec4( current, 0.0 ) ).xy;
  float speed = length( flow );
  vec2 axis = speed > 1e-4 ? flow / speed : vec2( 1.0, 0.0 );
  vec2 offset = axis * position.x * ( radius + 0.5 * drift.y * speed ) + vec2( - axis.y, axis.x ) * position.y * radius;
  vCorner = position.xy;
  vTint = tint.rgb;
  vAlpha = shape.z * envelope * fade;
  vGlow = tint.w * envelope * fade;
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
      softAdd( light, direct, lean );
    }
    #pragma unroll_loop_end
  #endif
  #if NUM_SUN_LIGHTS > 0
    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_SUN_LIGHTS; i ++ ) {
      getSunLightInfo( sunLights[ i ], light );
      softAdd( light, direct, lean );
    }
    #pragma unroll_loop_end
  #endif
  #if NUM_POINT_LIGHTS > 0
    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
      getPointLightInfo( pointLights[ i ], mvPosition.xyz, light );
      softAdd( light, direct, lean );
    }
    #pragma unroll_loop_end
  #endif
  #if NUM_SPOT_LIGHTS > 0
    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
      getSpotLightInfo( spotLights[ i ], mvPosition.xyz, light );
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
  vSky = sky;
  vGround = ground;
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
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
  #endif
  gl_FragColor = vec4( mix( lit, fogColor, fogFactor ) * alpha + vTint * glow * ( 1.0 - fogFactor ), alpha );
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
}

export interface SoftParticlesOptions {
  readonly capacity?: number;
  readonly softness?: number;
  readonly scatter?: number;
}

export class SoftParticles extends Mesh<InstancedBufferGeometry, ShaderMaterial> {
  readonly capacity: number;
  private readonly data: Float32Array;
  private readonly buffer: InstancedInterleavedBuffer;
  private cursor = 0;
  private dirtyFrom = Infinity;
  private dirtyTo = -1;

  constructor({ capacity = 256, softness = 1, scatter = 0.8 }: SoftParticlesOptions = {}) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('SoftParticles capacity must be a positive integer');
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const data = new Float32Array(capacity * STRIDE);
    const buffer = new InstancedInterleavedBuffer(data, STRIDE).setUsage(DynamicDrawUsage);
    (['spawn', 'velocity', 'force', 'shape', 'tint', 'drift'] as const).forEach((name, index) => geometry.setAttribute(name, new InterleavedBufferAttribute(buffer, 4, index * 4)));
    geometry.instanceCount = 0;
    const material = new ShaderMaterial({
      name: 'look-soft-particles',
      uniforms: {
        ...UniformsUtils.merge([UniformsLib.lights, UniformsLib.fog, {
          time: { value: 0 },
          still: { value: 0 },
          wrapCenter: { value: new Vector3() },
          wrapSize: { value: new Vector3() },
          softness: { value: softness },
          scatter: { value: scatter },
        }]),
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
    this.frustumCulled = false;
    this.receiveShadow = true;
    this.layers.set(SOFT_LAYER);
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
    d[o + 20] = particle.flutter ?? 0; d[o + 21] = particle.stretch ?? 0; d[o + 22] = 0; d[o + 23] = 0;
    this.dirtyFrom = Math.min(this.dirtyFrom, slot);
    this.dirtyTo = Math.max(this.dirtyTo, slot);
    this.cursor = (slot + 1) % this.capacity;
    this.geometry.instanceCount = Math.min(this.capacity, this.geometry.instanceCount + 1);
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
  }

  override onBeforeRender(): void {
    if (this.dirtyTo < this.dirtyFrom) return;
    this.buffer.clearUpdateRanges();
    this.buffer.addUpdateRange(this.dirtyFrom * STRIDE, (this.dirtyTo - this.dirtyFrom + 1) * STRIDE);
    this.buffer.needsUpdate = true;
    this.dirtyFrom = Infinity;
    this.dirtyTo = -1;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
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
