import type { BondSection } from './equilibrium';
import type { Strengths } from './stress';
import { BondState } from '../../destruction-domain/src/index';

/**
 * Support-path load model: a cheap, deterministic and always-converged estimate of the load
 * every bond carries, used to drive structural failure. It replaces the budgeted elastic solve as
 * the failure driver, which cannot converge at building scale.
 *
 * Every fragment contributes its net applied force (weight, contact reactions and the inertial
 * term of a rigid detached body, from `buildStructuralLoads`). Each fragment gets a potential:
 * its resistance distance to the nearest support, where a bond's resistance is its length over
 * its remaining section area, so thin slivers are expensive to route through. Loads are
 * propagated from the leaves towards the supports in order of decreasing potential. A fragment
 * hands its accumulated load to every intact neighbour at lower potential, in proportion to the
 * bond's conductance times the potential drop, which is the share a resistive network would
 * carry. Each bond is checked once, from its higher side, against axial (tension or
 * compression) and shear capacity, with friction on compressed joints. Bending is deliberately
 * not estimated: a lever arm times the carried load over-reports cantilevers for any
 * statically indeterminate structure, and the loads that bring a building down are axial and
 * shear overloads.
 *
 * Work is O((fragments + bonds) log fragments) in the components solved. Ties are broken by
 * fragment index and supports are id-ordered, so results never depend on Map iteration or
 * wall-clock time.
 */
export const SUPPORT_PATH_POLICY = Object.freeze({
  /**
   * Damage added per second per unit of overload (utilization − 1). At 60/s a bond at u = 2 breaks
   * in a tick and one at u = 1.1 takes about ten ticks to crack through.
   */
  damagePerSecond: 60,
  /** Bonds whose raw demand is at least this stay on the re-check list as they accumulate damage. */
  candidateUtilization: 0.35,
  /**
   * Friction coefficient of a compressed joint: shear capacity grows by this share of the
   * compressive normal stress, so a column of obliquely cut cells is not failed by its own weight.
   */
  jointFriction: 1,
  /**
   * The path model concentrates load through the cheapest route and cannot redistribute plastically,
   * so it over-reports the demand of a standing frame. Demand is divided by this margin; dynamic
   * landings and unsupported weight overshoot it by orders of magnitude.
   */
  capacityMargin: 2,
  /** Shear stiffness of a joint relative to its axial stiffness, for routing vertical load. */
  shearStiffness: 0.1,
  /** A contact is a support only if it pushes up with at least this share of the fragment's weight. */
  supportWeightShare: 0.1,
});

export interface SupportPathStats {
  components: number;
  maxUtilization: number;
  overloadedBonds: number;
}

export interface SupportPathGeometry {
  anchored: Uint8Array;
  bondIndices: Uint32Array;
  damage: Float32Array;
  endpointsA: Uint32Array;
  endpointsB: Uint32Array;
  /** Fragment centres in the manifest frame, three numbers per fragment. */
  positions: Float64Array;
  rowOffsets: Uint32Array;
  sections: ReadonlyArray<BondSection>;
  states: Uint8Array;
  strengths: ReadonlyArray<Strengths>;
}

export class SupportPathModel {
  /** Raw combined utilization of each bond from the last solve (damage not yet applied). */
  readonly demand: Float64Array;
  /** Magnitude of the load each bond carries (N), from the last solve. */
  readonly load: Float64Array;
  private readonly potential: Float64Array;
  private readonly force: Float64Array;
  private readonly order: Uint32Array;
  private readonly heap: Uint32Array;
  private readonly slot: Int32Array;
  private heapSize = 0;

  constructor(
    private readonly geometry: SupportPathGeometry,
    fragments: number,
    bonds: number,
  ) {
    this.demand = new Float64Array(bonds);
    this.load = new Float64Array(bonds);
    this.potential = new Float64Array(fragments).fill(Infinity);
    this.heap = new Uint32Array(fragments);
    this.slot = new Int32Array(fragments).fill(-1);
    this.force = new Float64Array(fragments * 3);
    this.order = new Uint32Array(fragments);
  }

  clear(): void {
    this.demand.fill(0);
    this.load.fill(0);
  }

  /**
   * Propagate `rhs` (six numbers per fragment, force first) from `members` to `supports`.
   * Supports must be in ascending fragment-id order. Returns false when there is no load.
   */
  solve(
    members: ReadonlyArray<number>,
    supports: ReadonlyArray<number>,
    rhs: Float64Array,
  ): boolean {
    const g = this.geometry;
    const { potential, force, order } = this;
    let total = 0;
    for (const i of members) {
      potential[i] = Infinity;
      this.slot[i] = -1;
      const fx = rhs[i * 6]!,
        fy = rhs[i * 6 + 1]!,
        fz = rhs[i * 6 + 2]!;
      force[i * 3] = fx;
      force[i * 3 + 1] = fy;
      force[i * 3 + 2] = fz;
      total += Math.abs(fx) + Math.abs(fy) + Math.abs(fz);
    }
    if (!(total > 1e-6) || !supports.length) {
      return false;
    }
    // Dijkstra over resistance: potential of every fragment, in non-decreasing order.
    this.heapSize = 0;
    for (const i of supports) {
      potential[i] = 0;
      this.push(i);
    }
    let reached = 0;
    while (this.heapSize) {
      const a = this.pop();
      order[reached++] = a;
      for (let slot = g.rowOffsets[a]!; slot < g.rowOffsets[a + 1]!; slot++) {
        const bond = g.bondIndices[slot]!;
        if ((g.states[bond]! === BondState.Broken || g.states[bond]! === BondState.Compliant)) {
          continue;
        }
        const b = g.endpointsA[bond]! === a ? g.endpointsB[bond]! : g.endpointsA[bond]!;
        const next = potential[a]! + this.resistance(bond);
        if (next < potential[b]!) {
          potential[b] = next;
          if (this.slot[b]! < 0) {
            this.push(b);
          } else {
            this.up(this.slot[b]!);
          }
        }
      }
    }
    for (let cursor = reached - 1; cursor >= 0; cursor--) {
      const i = order[cursor]!;
      const level = potential[i]!;
      if (level === 0) {
        continue;
      }
      const qx = force[i * 3]!,
        qy = force[i * 3 + 1]!,
        qz = force[i * 3 + 2]!;
      const magnitude = Math.hypot(qx, qy, qz);
      if (!(magnitude > 0)) {
        continue;
      }
      let weights = 0;
      for (let slot = g.rowOffsets[i]!; slot < g.rowOffsets[i + 1]!; slot++) {
        const bond = g.bondIndices[slot]!;
        if ((g.states[bond]! === BondState.Broken || g.states[bond]! === BondState.Compliant)) {
          continue;
        }
        const other = g.endpointsA[bond]! === i ? g.endpointsB[bond]! : g.endpointsA[bond]!;
        if (potential[other]! < level) {
          weights += (level - potential[other]!) / this.resistance(bond);
        }
      }
      if (!(weights > 0)) {
        continue;
      }
      for (let slot = g.rowOffsets[i]!; slot < g.rowOffsets[i + 1]!; slot++) {
        const bond = g.bondIndices[slot]!;
        if ((g.states[bond]! === BondState.Broken || g.states[bond]! === BondState.Compliant)) {
          continue;
        }
        const parent = g.endpointsA[bond]! === i ? g.endpointsB[bond]! : g.endpointsA[bond]!;
        if (!(potential[parent]! < level)) {
          continue;
        }
        const share = (level - potential[parent]!) / this.resistance(bond) / weights;
        const fx = qx * share,
          fy = qy * share,
          fz = qz * share;
        // Utilization treats positive axial force along the a→b normal as tension. A load
        // pushing the child towards its parent is compression, so orient it accordingly.
        const sign = g.endpointsA[bond]! === i ? -1 : 1;
        const u = this.utilization(bond, sign * fx, sign * fy, sign * fz);
        this.demand[bond] = u / SUPPORT_PATH_POLICY.capacityMargin;
        this.load[bond] = magnitude * share;
        force[parent * 3] = force[parent * 3]! + fx;
        force[parent * 3 + 1] = force[parent * 3 + 1]! + fy;
        force[parent * 3 + 2] = force[parent * 3 + 2]! + fz;
      }
    }
    // World bonds are load-carrying interfaces, not an unbreakable node property.
    // Their clamped endpoint has accumulated the reactions from all routed members.
    for (const node of supports) {
      const world: Array<number> = [];
      let area = 0;
      for (let slot = g.rowOffsets[node]!; slot < g.rowOffsets[node + 1]!; slot++) {
        const bond = g.bondIndices[slot]!;
        if (g.endpointsA[bond] === g.endpointsB[bond] && g.states[bond] !== BondState.Broken && g.states[bond] !== BondState.Compliant) {
          world.push(bond); area += g.sections[bond]!.area;
        }
      }
      for (const bond of world) {
        const share = g.sections[bond]!.area / area;
        const fx = -force[node * 3]! * share, fy = -force[node * 3 + 1]! * share, fz = -force[node * 3 + 2]! * share;
        this.demand[bond] = this.utilization(bond, fx, fy, fz) / SUPPORT_PATH_POLICY.capacityMargin;
        this.load[bond] = Math.hypot(fx, fy, fz);
      }
    }
    return true;
  }

  /**
   * Resistance of a bond to vertical load: length over remaining section, with the joint's
   * stiffness blending from axial (normal vertical) to shear (normal horizontal).
   */
  private resistance(bond: number): number {
    const g = this.geometry;
    const remaining = Math.max(1e-6, 1 - g.damage[bond]! * 0.6);
    const section = g.sections[bond]!;
    const vertical = section.normal[1] * section.normal[1];
    const stiffness = vertical + SUPPORT_PATH_POLICY.shearStiffness * (1 - vertical);
    return section.length / (section.area * remaining * stiffness);
  }

  private less(a: number, b: number): boolean {
    const pa = this.potential[a]!,
      pb = this.potential[b]!;
    return pa < pb || (pa === pb && a < b);
  }

  private push(node: number): void {
    this.heap[this.heapSize] = node;
    this.slot[node] = this.heapSize;
    this.up(this.heapSize++);
  }

  private pop(): number {
    const top = this.heap[0]!;
    const last = this.heap[--this.heapSize]!;
    this.slot[top] = -1;
    if (this.heapSize) {
      this.heap[0] = last;
      this.slot[last] = 0;
      this.down(0);
    }
    return top;
  }

  private up(index: number): void {
    const node = this.heap[index]!;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      const other = this.heap[parent]!;
      if (!this.less(node, other)) {
        break;
      }
      this.heap[index] = other;
      this.slot[other] = index;
      index = parent;
    }
    this.heap[index] = node;
    this.slot[node] = index;
  }

  private down(index: number): void {
    const node = this.heap[index]!;
    for (;;) {
      let child = index * 2 + 1;
      if (child >= this.heapSize) {
        break;
      }
      if (child + 1 < this.heapSize && this.less(this.heap[child + 1]!, this.heap[child]!)) {
        child++;
      }
      if (!this.less(this.heap[child]!, node)) {
        break;
      }
      this.heap[index] = this.heap[child]!;
      this.slot[this.heap[index]!] = index;
      index = child;
    }
    this.heap[index] = node;
    this.slot[node] = index;
  }

  private utilization(bond: number, fx: number, fy: number, fz: number): number {
    const section = this.geometry.sections[bond]!,
      limits = this.geometry.strengths[bond]!;
    const [nx, ny, nz] = section.normal,
      [ax, ay, az] = section.tangent1,
      [bx, by, bz] = section.tangent2;
    const axial = (fx * nx + fy * ny + fz * nz) / section.area;
    const tension = Math.max(0, axial) / limits.tension;
    const compression = Math.max(0, -axial) / limits.compression;
    const shear =
      Math.hypot(fx * ax + fy * ay + fz * az, fx * bx + fy * by + fz * bz) / section.area;
    const capacity = limits.shear + SUPPORT_PATH_POLICY.jointFriction * Math.max(0, -axial);
    return tension + compression + shear / capacity;
  }
}
