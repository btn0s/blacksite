import { BondState, type DamageProgramDescriptor } from '../packages/destruction-domain/src/index';
import type { DestructionSimulation } from '../packages/destruction-physics/src/index';
import { chunkDamageFalloff } from '../packages/destruction-graph/src/shaders';

/** Capture A6 before B2 or Rapier changes the result of the single-charge audit. */
export function auditMaximumCharge(sim: DestructionSimulation, expected: DamageProgramDescriptor) {
  const graph = sim.graph;
  const apply = graph.applyFracture.bind(graph);
  let report: object | undefined;
  graph.applyFracture = (commands, positions) => {
    if (!commands.programs.some((program) => program.damage === expected.damage)) return apply(commands, positions);
    const initialActive = graph.activeChunks.slice();
    const initialHealth = graph.chunkHealth.slice();
    const initialBonds = graph.manifest.bonds.length;
    const result = apply(commands, positions);
    const chunks = graph.manifest.fragments.map((fragment, index) => ({
      index, id: fragment.id, parent: fragment.parent, depth: fragment.depth, element: fragment.element,
      core: chunkDamageFalloff(expected, fragment, fragment.position) === 1,
      activeBefore: !!initialActive[index], activeAfter: !!graph.activeChunks[index],
      healthBefore: initialHealth[index], healthAfter: graph.chunkHealth[index],
    }));
    const members = chunks.filter((chunk) => chunk.activeBefore && chunk.core && chunk.depth === 1);
    const demoted = new Set(result.demoted.map((change) => change.parent));
    const children = chunks.filter((chunk) => demoted.has(graph.parents[chunk.index]!));
    const coreBonds = graph.manifest.bonds.map((bond, index) => {
      const point = bond.centroid ?? bond.section?.point;
      return { index, id: bond.id, a: bond.a, b: bond.b, inherited: bond.parentBond,
        core: !!point && Math.hypot(...point.map((value, axis) => value - expected.position[axis]!)) <= expected.minRadius,
        created: index >= initialBonds, state: graph.states[index], damage: graph.damage[index] };
    }).filter((bond) => bond.core);
    const outside = new Set(children.filter((chunk) => !chunk.core).map((chunk) => chunk.id));
    const exteriorBonds = graph.manifest.bonds.map((bond, index) => ({ bond, index }))
      .filter(({ bond, index }) => index >= initialBonds && outside.has(bond.a) && outside.has(bond.b))
      .map(({ bond, index }) => ({ index, id: bond.id, a: bond.a, b: bond.b, state: graph.states[index], damage: graph.damage[index] }));
    report = {
      expected, descriptors: commands.programs,
      membersInCore: members.length, deadMembersInCore: members.filter((chunk) => chunk.healthAfter === 0).length,
      newCellsInCore: children.filter((chunk) => chunk.core).length,
      deadNewCellsInCore: children.filter((chunk) => chunk.core && chunk.healthAfter === 0).length,
      newCellsOutsideCore: children.filter((chunk) => !chunk.core).length,
      deadNewCellsOutsideCore: children.filter((chunk) => !chunk.core && chunk.healthAfter === 0).length,
      bondsInCore: coreBonds.length, brokenBondsInCore: coreBonds.filter((bond) => bond.state === BondState.Broken).length,
      exteriorCellBonds: exteriorBonds.length, brokenExteriorCellBonds: exteriorBonds.filter((bond) => bond.state === BondState.Broken).length,
      members, children, coreBonds, exteriorBonds, demotions: result.demoted,
    };
    return result;
  };
  return () => report;
}
