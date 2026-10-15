import COMPAT from '@dimforge/rapier3d-compat';

export type RapierModule = typeof COMPAT;
export type RapierFlavour = 'compat' | 'simd';

/** Smallest module that uses a v128 instruction; validates only where WASM SIMD is supported. */
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15,
  253, 98, 11,
]);

function hasSimd(): boolean {
  try {
    return typeof WebAssembly === 'object' && WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}

function isNode(): boolean {
  return typeof process === 'object' && Boolean(process.versions?.node);
}

/**
 * Which Rapier build owned worlds use. The SIMD build is the default in browsers and workers when
 * the engine supports WASM SIMD; node (tests, replays, benchmarks) stays on the scalar build so a
 * recorded replay reproduces there. CASCADE_RAPIER=compat|simd overrides either.
 */
export function preferredFlavour(): RapierFlavour {
  const forced = isNode() ? process.env.CASCADE_RAPIER : undefined;
  if (forced === 'compat') {
    return 'compat';
  }
  if (forced === 'simd') {
    return hasSimd() ? 'simd' : 'compat';
  }
  return !isNode() && hasSimd() ? 'simd' : 'compat';
}

export let flavour: RapierFlavour = 'compat';

/**
 * The SIMD build rounds differently from the scalar build, so a replay is only bit-identical on
 * the build that recorded it. Replay versions carry this suffix to say which one that was.
 */
export const flavourSuffix = (): string => (flavour === 'simd' ? '-simd' : '');
let loaded: Promise<RapierModule> | undefined;

/** Loads and initializes the preferred build once, falling back to the scalar build on failure. */
export function loadRapier(): Promise<RapierModule> {
  loaded ??= (async () => {
    if (preferredFlavour() === 'simd') {
      try {
        const module = (await import('@dimforge/rapier3d-simd-compat')) as unknown as {
          default: RapierModule;
        };
        await module.default.init();
        flavour = 'simd';
        return module.default;
      } catch {
        // Fall through to the scalar build.
      }
    }
    await COMPAT.init();
    flavour = 'compat';
    return COMPAT;
  })();
  return loaded;
}
