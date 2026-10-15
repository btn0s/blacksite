import type { WeaponDefinition } from './types';

/** Original example tuning, using the ALS rifle, pistol and bow visual assets. */
export const ALS_WEAPONS: readonly WeaponDefinition[] = [
  {
    id: 'rifle', label: 'Rifle', fireMode: 'auto', roundsPerSecond: 10,
    magazineSize: 30, initialReserve: 180, reloadSeconds: 2.1, equipSeconds: 0.22,
    damage: 24, range: 250, spreadRadians: 0.0035,
    recoil: { pitchMin: 0.006, pitchMax: 0.009, yawMax: 0.0025 },
    ballistics: { kind: 'hitscan' },
  },
  {
    id: 'pistol', label: 'Pistol', fireMode: 'semi', roundsPerSecond: 5,
    magazineSize: 12, initialReserve: 72, reloadSeconds: 1.35, equipSeconds: 0.18,
    damage: 38, range: 150, spreadRadians: 0.002,
    recoil: { pitchMin: 0.011, pitchMax: 0.015, yawMax: 0.003 },
    ballistics: { kind: 'hitscan' },
  },
  {
    id: 'bow', label: 'Bow', fireMode: 'semi', roundsPerSecond: 1.1,
    magazineSize: 1, initialReserve: 30, reloadSeconds: 0.7, equipSeconds: 0.25,
    damage: 80, range: 180, spreadRadians: 0.0005,
    recoil: { pitchMin: 0.002, pitchMax: 0.003, yawMax: 0.0005 },
    ballistics: { kind: 'projectile', speed: 55, gravity: { x: 0, y: -9.81, z: 0 }, radius: 0.015, lifetimeSeconds: 6 },
  },
];
