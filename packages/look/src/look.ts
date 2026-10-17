import { N8AOPostPass } from 'n8ao';
import { BloomEffect, EffectComposer, EffectPass, RenderPass } from 'postprocessing';
import { Color, Fog, FogExp2, HalfFloatType, NoToneMapping, Vector2 } from 'three';
import type { Camera, DirectionalLight, HemisphereLight, Scene, WebGLRenderer, WebGLRenderTarget } from 'three';
import { isExpFog } from './atmosphere';
import type { Atmosphere } from './atmosphere';
import { AerialEffect } from './aerial';
import { GradeEffect } from './grade';
import { loadLut } from './lut';
import { atmosphereOf } from './presets';
import type { PresetName } from './presets';
import { QUALITY, autoQuality } from './quality';
import type { QualityTier } from './quality';
import { bakePhysicalEnvironment, createPhysicalSky } from './physical';
import type { PhysicalSky } from './physical';
import { bakeSkyEnvironment, createSky } from './sky';
import type { Sky } from './sky';
import { SoftPass } from './soft';

export const POST_TUNING = {
  ao: { intensity: 1.8, radius: 0.35 },
  bloom: { intensity: 0.8, threshold: 1.35, smoothing: 0.2, radius: 0.45 },
} as const;

export interface LookOptions {
  readonly atmosphere?: Atmosphere | PresetName;
  readonly quality?: QualityTier;
  readonly sky?: boolean;
  readonly environment?: boolean;
  readonly fog?: boolean;
  readonly sun?: DirectionalLight | null;
  readonly fill?: HemisphereLight | null;
}

export interface Look {
  readonly composer: EffectComposer;
  readonly grade: GradeEffect;
  readonly sky: Sky | null;
  readonly atmosphere: Atmosphere;
  readonly quality: QualityTier;
  render(dt?: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setAtmosphere(next: Atmosphere | PresetName): void;
  setQuality(next: QualityTier): void;
  setAberration(extra: number): void;
  addOverlay(scene: Scene, camera: Camera): () => void;
  dispose(): void;
}

export function createLook(renderer: WebGLRenderer, scene: Scene, camera: Camera, options: LookOptions = {}): Look {
  let atmosphere = atmosphereOf(options.atmosphere ?? 'zone');
  let quality = options.quality ?? autoQuality();
  let extraAberration = 0;
  let disposed = false;
  let lutUrl: string | null = null;
  let environment: WebGLRenderTarget | null = null;
  const useFog = options.fog ?? true;
  const previous = { toneMapping: renderer.toneMapping, background: scene.background, environment: scene.environment, fog: scene.fog };

  renderer.toneMapping = NoToneMapping;
  const composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: QUALITY[quality].multisampling });
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new SoftPass(scene, camera));

  const size = renderer.getDrawingBufferSize(new Vector2());
  const ao = new N8AOPostPass(scene, camera, size.x || 1, size.y || 1);
  ao.configuration.depthAwareUpsampling = true;
  ao.configuration.gammaCorrection = false;
  ao.configuration.aoRadius = POST_TUNING.ao.radius;
  ao.configuration.intensity = POST_TUNING.ao.intensity;
  composer.addPass(ao);

  const physical: PhysicalSky | null = atmosphere.physical && options.sky !== false ? createPhysicalSky(renderer, atmosphere, QUALITY[quality].atmosphere) : null;
  const aerial = physical ? new AerialEffect(camera, physical.luts) : null;
  if (aerial) composer.addPass(new EffectPass(camera, aerial));

  const bloom = new BloomEffect({
    intensity: POST_TUNING.bloom.intensity,
    luminanceThreshold: POST_TUNING.bloom.threshold,
    luminanceSmoothing: POST_TUNING.bloom.smoothing,
    radius: POST_TUNING.bloom.radius,
    mipmapBlur: true,
  });
  const bloomPass = new EffectPass(camera, bloom);
  composer.addPass(bloomPass);

  const grade = new GradeEffect();
  composer.addPass(new EffectPass(camera, grade));

  const sky = options.sky === false ? null : physical ?? createSky(atmosphere);
  if (sky) scene.add(sky.mesh);

  const applyQuality = () => {
    const settings = QUALITY[quality];
    if (composer.multisampling !== settings.multisampling) composer.multisampling = settings.multisampling;
    ao.enabled = settings.ao !== false;
    if (settings.ao) {
      if (ao.configuration.halfRes !== settings.ao.halfRes) ao.configuration.halfRes = settings.ao.halfRes;
      if (ao.configuration.aoSamples !== settings.ao.samples) ao.configuration.aoSamples = settings.ao.samples;
      if (ao.configuration.denoiseIterations !== settings.ao.denoise) ao.configuration.denoiseIterations = settings.ao.denoise;
    }
    bloomPass.enabled = settings.bloom !== false;
    if (settings.bloom) bloom.mipmapBlurPass.levels = settings.bloom.levels;
    grade.setFeatures({ aberration: settings.aberration, grain: settings.grain });
    physical?.configure(settings.atmosphere);
    aerial?.setEdges(settings.atmosphere.edges);
  };

  const applyLut = (url: string | null) => {
    if (url === lutUrl) return;
    lutUrl = url;
    if (url === null) {
      grade.setLut(null);
      return;
    }
    loadLut(url).then(
      loaded => {
        if (!disposed && lutUrl === url) grade.setLut(loaded.texture, loaded.size);
      },
      () => {
        if (!disposed && lutUrl === url) grade.setLut(null);
      },
    );
  };

  const applyAtmosphere = () => {
    const { fog, sun, fill } = atmosphere;
    if (useFog && aerial && atmosphere.physical) {
      scene.fog = null;
    } else if (useFog) {
      if (isExpFog(fog)) {
        if (scene.fog instanceof FogExp2) scene.fog.density = fog.density;
        else scene.fog = new FogExp2(0, fog.density);
      } else if (scene.fog instanceof Fog) {
        scene.fog.near = fog.near;
        scene.fog.far = fog.far;
      } else {
        scene.fog = new Fog(0, fog.near, fog.far);
      }
      scene.fog!.color.setRGB(...fog.color);
    }
    if (sky) sky.update(atmosphere);
    else scene.background = new Color().setRGB(...fog.color);
    if (options.environment) {
      environment?.dispose();
      environment = physical && atmosphere.physical ? bakePhysicalEnvironment(renderer, physical) : bakeSkyEnvironment(renderer, atmosphere);
      scene.environment = environment.texture;
    }
    if (options.sun) {
      options.sun.color.setRGB(...sun.color);
      options.sun.intensity = sun.strength;
      options.sun.position.set(...sun.direction).multiplyScalar(40).add(options.sun.target.position);
    }
    if (options.fill) {
      options.fill.color.setRGB(...fill.sky);
      options.fill.groundColor.setRGB(...fill.ground);
      options.fill.intensity = fill.strength;
    }
    aerial?.setAtmosphere(atmosphere);
    bloom.intensity = atmosphere.grade.bloom ?? POST_TUNING.bloom.intensity;
    grade.exposure = atmosphere.exposure;
    grade.setGrade(atmosphere.grade);
    grade.aberration = atmosphere.grade.aberration + extraAberration;
    applyLut(atmosphere.grade.lut);
  };

  applyQuality();
  applyAtmosphere();

  return {
    composer,
    grade,
    sky,
    get atmosphere() {
      return atmosphere;
    },
    get quality() {
      return quality;
    },
    render(dt) {
      if (physical) {
        if (options.sun) physical.luts.track(options.sun);
        physical.tick(dt ?? 0);
      }
      composer.render(dt);
    },
    setSize(width, height, updateStyle) {
      composer.setSize(width, height, updateStyle);
    },
    setAtmosphere(next) {
      const resolved = atmosphereOf(next);
      if (resolved === atmosphere) return;
      atmosphere = resolved;
      applyAtmosphere();
    },
    setQuality(next) {
      if (next === quality) return;
      quality = next;
      applyQuality();
    },
    setAberration(extra) {
      extraAberration = extra;
      grade.aberration = atmosphere.grade.aberration + extra;
    },
    addOverlay(overlayScene, overlayCamera) {
      const pass = new RenderPass(overlayScene, overlayCamera);
      pass.clearPass.color = false;
      pass.clearPass.depth = true;
      pass.ignoreBackground = true;
      composer.addPass(pass, composer.passes.indexOf(bloomPass));
      return () => {
        if (disposed || !composer.passes.includes(pass)) return;
        composer.removePass(pass);
        pass.dispose();
      };
    },
    dispose() {
      disposed = true;
      sky?.dispose();
      environment?.dispose();
      composer.dispose();
      renderer.toneMapping = previous.toneMapping;
      scene.background = previous.background;
      scene.environment = previous.environment;
      scene.fog = previous.fog;
    },
  };
}
