import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Camera, DirectionalLight, HemisphereLight, Scene } from 'three';
import type { BakeOptions } from './bake';
import type { Atmosphere } from './atmosphere';
import { createLook } from './look';
import type { Look as LookHandle } from './look';
import type { PresetName } from './presets';
import { autoQuality } from './quality';
import type { QualityTier } from './quality';

export interface LookProps {
  readonly atmosphere?: Atmosphere | PresetName;
  readonly quality?: QualityTier;
  readonly sky?: boolean;
  readonly environment?: boolean;
  readonly fog?: boolean;
  readonly sun?: DirectionalLight | null;
  readonly fill?: HemisphereLight | null;
  readonly bake?: BakeOptions | null;
  readonly aberration?: number;
  readonly overlay?: { readonly scene: Scene; readonly camera: Camera } | null;
  readonly onReady?: (look: LookHandle | null) => void;
}

export function Look({ atmosphere = 'zone', quality, sky = true, environment = false, fog = true, sun = null, fill = null, bake = null, aberration = 0, overlay = null, onReady }: LookProps) {
  const gl = useThree(state => state.gl);
  const scene = useThree(state => state.scene);
  const camera = useThree(state => state.camera);
  const width = useThree(state => state.size.width);
  const height = useThree(state => state.size.height);
  const dpr = useThree(state => state.viewport.dpr);
  const auto = useMemo(() => autoQuality(), []);
  const tier = quality ?? auto;
  const latest = useRef({ atmosphere, tier });
  latest.current = { atmosphere, tier };
  const [look, setLook] = useState<LookHandle | null>(null);

  useLayoutEffect(() => {
    const created = createLook(gl, scene, camera, { atmosphere: latest.current.atmosphere, quality: latest.current.tier, sky, environment, fog, sun, fill, bake });
    setLook(created);
    return () => {
      setLook(null);
      created.dispose();
    };
  }, [gl, scene, camera, sky, environment, fog, sun, fill, bake]);

  useLayoutEffect(() => {
    look?.setSize(width, height);
  }, [look, width, height, dpr]);

  useEffect(() => {
    look?.setAtmosphere(atmosphere);
  }, [look, atmosphere]);

  useEffect(() => {
    look?.setQuality(tier);
  }, [look, tier]);

  useEffect(() => {
    look?.setAberration(aberration);
  }, [look, aberration]);

  const overlayScene = overlay?.scene;
  const overlayCamera = overlay?.camera;
  useEffect(() => {
    if (!look || !overlayScene || !overlayCamera) return;
    return look.addOverlay(overlayScene, overlayCamera);
  }, [look, overlayScene, overlayCamera]);

  useEffect(() => {
    onReady?.(look);
  }, [look, onReady]);

  useFrame((_, dt) => {
    if (look) look.render(dt);
    else gl.render(scene, camera);
  }, 1);

  return null;
}
