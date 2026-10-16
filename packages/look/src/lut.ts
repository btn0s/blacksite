import type { Data3DTexture } from 'three';
import { LUTCubeLoader } from 'three/addons/loaders/LUTCubeLoader.js';

export interface LoadedLut {
  readonly texture: Data3DTexture;
  readonly size: number;
}

const cache = new Map<string, Promise<LoadedLut>>();

export function loadLut(url: string): Promise<LoadedLut> {
  const cached = cache.get(url);
  if (cached) return cached;
  const loading = new LUTCubeLoader().loadAsync(url).then(result => ({ texture: result.texture3D, size: result.size }));
  loading.catch(() => cache.delete(url));
  cache.set(url, loading);
  return loading;
}

export function parseLut(text: string): LoadedLut {
  const result = new LUTCubeLoader().parse(text);
  return { texture: result.texture3D, size: result.size };
}
