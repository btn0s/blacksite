import {
  clamp,
  type FragmentDef,
  type MaterialDef,
  type Vec3,
} from "../../destruction-domain/src/index";
import {
  fractureFragment,
  fractureFragmentAtImpact,
  subdivideFragment,
} from "./fracture";

/** Inspectable geometric output of the subsupport damage shader; generation never changes actors. */
export interface ImpactSubgraphFractureCommand {
  type: "impact";
  chunkId: number;
  healthDelta: number;
  partition: NonNullable<ReturnType<typeof fractureFragmentAtImpact>>;
}
export interface SecondarySubgraphFractureCommand {
  type: "radial" | "refine";
  chunkId: number;
  healthDelta: number;
  children: Array<FragmentDef>;
}

function normalizedDamage(material: MaterialDef, damage: number): number {
  const value = damage / (material.health ?? 1);
  return value > (material.minDamageThreshold ?? 0.02)
    ? Math.min(value, material.maxDamageThreshold ?? 1)
    : 0;
}

/** Blast's subgraph shader seam, retaining Cascade's existing crater and chip geometry. */
export function generateImpactSubgraphFracture(
  fragment: FragmentDef,
  material: MaterialDef,
  strength: number,
  point: Vec3,
  direction: Vec3,
  seed: number,
): ImpactSubgraphFractureCommand | undefined {
  const healthDelta = normalizedDamage(material, strength);
  if (!(healthDelta > 0)) return;
  const partition = fractureFragmentAtImpact(
    fragment,
    point,
    direction,
    clamp((strength * 0.22) / Math.sqrt(material.strength), 0.035, 0.18),
    clamp((strength * 0.2) / Math.sqrt(material.strength), 0.025, 0.16),
    seed,
  );
  return partition
    ? { type: "impact", chunkId: fragment.id, healthDelta, partition }
    : undefined;
}

/** Radial/landing subgraph output for a free single-chunk actor, with unchanged geometric cuts. */
export function generateSecondarySubgraphFracture(
  fragment: FragmentDef,
  material: MaterialDef,
  damage: number,
  seed: number,
  maxSize?: number,
): SecondarySubgraphFractureCommand {
  const healthDelta = normalizedDamage(material, damage);
  return {
    type: maxSize === undefined ? "radial" : "refine",
    chunkId: fragment.id,
    healthDelta,
    children:
      healthDelta > 0
        ? maxSize === undefined
          ? fractureFragment(fragment, seed)
          : subdivideFragment(fragment, maxSize)
        : [],
  };
}
