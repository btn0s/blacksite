export const RAYLEIGH = [5.802e-3, 13.558e-3, 33.1e-3] as const
export const OZONE = [0.65e-3, 1.881e-3, 0.085e-3] as const
export const RAYLEIGH_HEIGHT = 8
export const MIE_HEIGHT = 1.2
export const GROUND_RADIUS = 6360
export const TOP_RADIUS = 6460
export const OZONE_TIP = 25
export const OZONE_WIDTH = 15

export const wgsl = (values: readonly number[]) => `vec3f(${values.map(value => value.toExponential()).join(', ')})`
