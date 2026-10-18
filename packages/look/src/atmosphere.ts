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

export type ToneCurve = 'shoulder' | 'filmic';

export interface GradeSpec {
  readonly lut: string | null;
  readonly vignette: number;
  readonly split: number;
  readonly aberration: number;
  readonly grain: number;
  readonly curve?: ToneCurve;
  readonly saturation?: number;
  readonly bloom?: number;
  readonly tint?: Rgb;
  readonly adapt?: AdaptSpec;
  readonly lift?: number;
  readonly clarity?: number;
  readonly sharpen?: number;
}

export interface AdaptSpec {
  readonly key: number;
  readonly strength: number;
  readonly min: number;
  readonly max: number;
  readonly rate?: number;
}

export interface HeightFogSpec {
  readonly density: number;
  readonly base: number;
  readonly falloff: number;
  readonly tint: Rgb;
}

export interface CloudSpec {
  readonly coverage: number;
  readonly altitude: number;
  readonly density: number;
  readonly scale: number;
  readonly wind: number;
}

export interface PhysicalSkySpec {
  readonly rayleigh: number;
  readonly mie: number;
  readonly mieAnisotropy: number;
  readonly ozone: number;
  readonly illuminance: number;
  readonly elevation: number;
  readonly aerial: number;
  readonly sky?: number;
  readonly clear?: number;
  readonly disk: number;
  readonly heightFog: HeightFogSpec | null;
  readonly clouds: CloudSpec | null;
}

export interface Atmosphere {
  readonly exposure: number;
  readonly fog: FogSpec;
  readonly sky: SkySpec;
  readonly sun: SunSpec;
  readonly fill: FillSpec;
  readonly grade: GradeSpec;
  readonly physical?: PhysicalSkySpec;
}

export function normalize([x, y, z]: Rgb): Rgb {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

export function isExpFog(fog: FogSpec): fog is ExpFogSpec {
  return 'density' in fog;
}
