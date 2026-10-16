export type Rgb = readonly [number, number, number];

export type LinearFogSpec = { readonly color: Rgb; readonly near: number; readonly far: number };
export type ExpFogSpec = { readonly color: Rgb; readonly density: number };
export type FogSpec = LinearFogSpec | ExpFogSpec;

export interface SkySpec {
  readonly zenith: Rgb;
  readonly horizon: Rgb;
  readonly ground: Rgb;
  readonly overcast: number;
}

export interface SunSpec {
  readonly color: Rgb;
  readonly direction: Rgb;
  readonly strength: number;
}

export interface FillSpec {
  readonly sky: Rgb;
  readonly ground: Rgb;
  readonly strength: number;
}

export interface GradeSpec {
  readonly lut: string | null;
  readonly vignette: number;
  readonly split: number;
  readonly aberration: number;
  readonly grain: number;
}

export interface Atmosphere {
  readonly exposure: number;
  readonly fog: FogSpec;
  readonly sky: SkySpec;
  readonly sun: SunSpec;
  readonly fill: FillSpec;
  readonly grade: GradeSpec;
}

export function normalize([x, y, z]: Rgb): Rgb {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

export function isExpFog(fog: FogSpec): fog is ExpFogSpec {
  return 'density' in fog;
}
