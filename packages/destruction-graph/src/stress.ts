import type { MaterialDef, Vec3 } from '../../destruction-domain/src/index';
import type { BondSection } from './equilibrium';

export interface Strengths {
  bending: number;
  compression: number;
  shear: number;
  tension: number;
}
export interface BondUtilization {
  bending: number;
  combined: number;
  compression: number;
  shear: number;
  tension: number;
  torsion: number;
}
export function materialStrengths(material: MaterialDef): Strengths {
  return {
    bending: material.bendingStrength ?? 4e6,
    compression: material.compressionStrength ?? 25e6,
    shear: material.shearStrength ?? 2e6,
    tension: material.tensionStrength ?? 2.4e6,
  };
}
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export function bondUtilization(
  section: BondSection,
  force: Vec3,
  moment: Vec3,
  strengths: Strengths,
): BondUtilization {
  const axial = dot(force, section.normal) / section.area;
  const tension = Math.max(0, axial) / strengths.tension;
  const compression = Math.max(0, -axial) / strengths.compression;
  const shear =
    Math.hypot(dot(force, section.tangent1), dot(force, section.tangent2)) /
    section.area /
    strengths.shear;
  const bending =
    (Math.abs(dot(moment, section.tangent1)) / section.sectionModulus1 +
      Math.abs(dot(moment, section.tangent2)) / section.sectionModulus2) /
    strengths.bending;
  const torsion = Math.abs(dot(moment, section.normal)) / section.torsionModulus / strengths.shear;
  return {
    bending,
    combined: tension + compression + bending + Math.hypot(shear, torsion),
    compression,
    shear,
    tension,
    torsion,
  };
}
