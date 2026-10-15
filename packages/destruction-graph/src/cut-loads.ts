import { BondState, type DestructibleManifest, type Vec3 } from '../../destruction-domain/src/index';

export interface CutBondLoad {
  bond: number;
  force: Vec3;
  moment: Vec3;
}

export class CutBondEquilibrium {
  readonly exact: Uint8Array;
  private readonly discovery: Int32Array;
  private readonly low: Int32Array;
  private readonly parent: Int32Array;
  private readonly parentBond: Int32Array;
  private readonly anchors: Uint32Array;
  private readonly cursor: Uint32Array;
  private readonly loadAtNode: Int32Array;
  private readonly subtree: Float64Array;
  private readonly fragmentOrder: Array<number>;
  private postorder: Array<number> = [];
  private loads: Array<CutBondLoad & { node: number; sign: number }> = [];

  constructor(
    private readonly manifest: DestructibleManifest,
    private readonly endpointsA: Uint32Array,
    private readonly endpointsB: Uint32Array,
    private readonly rowOffsets: Uint32Array,
    private readonly bondIndices: Uint32Array,
    private readonly masses: ArrayLike<number> = manifest.fragments.map(
      (fragment) => fragment.mass,
    ),
    private readonly worldSupported?: Uint8Array,
  ) {
    const n = manifest.fragments.length;
    if (masses.length !== n) {
      throw new Error('Invalid cut-bond mass buffer length');
    }
    this.exact = new Uint8Array(manifest.bonds.length);
    this.discovery = new Int32Array(n);
    this.low = new Int32Array(n);
    this.parent = new Int32Array(n);
    this.parentBond = new Int32Array(n);
    this.anchors = new Uint32Array(n);
    this.cursor = new Uint32Array(n);
    this.loadAtNode = new Int32Array(n);
    this.subtree = new Float64Array(n * 6);
    this.fragmentOrder = manifest.fragments
      .map((_, i) => i)
      .sort((a, b) => manifest.fragments[a]!.id - manifest.fragments[b]!.id);
  }

  rebuild(states: Uint8Array, supported: Uint8Array): void {
    this.exact.fill(0);
    this.discovery.fill(-1);
    this.parent.fill(-1);
    this.parentBond.fill(-1);
    this.loadAtNode.fill(-1);
    this.postorder = [];
    this.loads = [];
    let sequence = 0;
    const discover = (node: number) => {
      this.discovery[node] = this.low[node] = sequence++;
      this.anchors[node] = this.worldSupported?.[node] ?? (this.manifest.fragments[node]!.anchored ? 1 : 0);
      this.cursor[node] = this.rowOffsets[node]!;
    };
    for (const root of this.fragmentOrder) {
      if (
        !supported[root]! ||
        !(this.worldSupported?.[root] ?? this.manifest.fragments[root]!.anchored) ||
        this.discovery[root]! >= 0
      ) {
        continue;
      }
      discover(root);
      const stack = [root];
      while (stack.length) {
        const node = stack.at(-1)!;
        if (this.cursor[node]! < this.rowOffsets[node + 1]!) {
          const bond = this.bondIndices[this.cursor[node]!++]!;
          if (states[bond]! === BondState.Broken || bond === this.parentBond[node]!) {
            continue;
          }
          const other =
            this.endpointsA[bond]! === node ? this.endpointsB[bond]! : this.endpointsA[bond]!;
          if (!supported[other]!) {
            continue;
          }
          if (this.discovery[other]! < 0) {
            this.parent[other] = node;
            this.parentBond[other] = bond;
            discover(other);
            stack.push(other);
          } else {
            this.low[node] = Math.min(this.low[node]!, this.discovery[other]!);
          }
          continue;
        }
        stack.pop();
        this.postorder.push(node);
        const parent = this.parent[node]!;
        if (parent < 0) {
          continue;
        }
        const bond = this.parentBond[node]!;
        this.anchors[parent]! += this.anchors[node]!;
        this.low[parent] = Math.min(this.low[parent]!, this.low[node]!);
        if (
          this.low[node]! > this.discovery[parent]! &&
          this.anchors[node]! === 0 &&
          this.manifest.bonds[bond]!.section
        ) {
          this.exact[bond] = 1;
          this.loadAtNode[node] = this.loads.length;
          this.loads.push({
            bond,
            force: [0, 0, 0],
            moment: [0, 0, 0],
            node,
            sign: this.endpointsA[bond]! === node ? -1 : 1,
          });
        }
      }
    }
  }

  sample(rhs?: Float64Array): ReadonlyArray<CutBondLoad> {
    if (rhs && rhs.length !== this.subtree.length) {
      throw new Error('Invalid cut-bond load buffer');
    }
    this.subtree.fill(0);
    for (const node of this.postorder) {
      const fragment = this.manifest.fragments[node]!,
        o = node * 6;
      const fx = rhs?.[o] ?? 0,
        fy = rhs ? rhs[o + 1]! : -this.masses[node]! * 9.81,
        fz = rhs?.[o + 2] ?? 0;
      const [x, y, z] = fragment.position;
      this.subtree[o] = fx;
      this.subtree[o + 1] = fy;
      this.subtree[o + 2] = fz;
      this.subtree[o + 3] = (rhs?.[o + 3] ?? 0) + y * fz - z * fy;
      this.subtree[o + 4] = (rhs?.[o + 4] ?? 0) + z * fx - x * fz;
      this.subtree[o + 5] = (rhs?.[o + 5] ?? 0) + x * fy - y * fx;
    }
    for (const node of this.postorder) {
      const o = node * 6,
        loadIndex = this.loadAtNode[node]!;
      if (loadIndex >= 0) {
        const load = this.loads[loadIndex]!,
          [x, y, z] = this.manifest.bonds[load.bond]!.section!.point;
        const fx = this.subtree[o]!,
          fy = this.subtree[o + 1]!,
          fz = this.subtree[o + 2]!;
        load.force[0] = load.sign * fx;
        load.force[1] = load.sign * fy;
        load.force[2] = load.sign * fz;
        load.moment[0] = load.sign * (this.subtree[o + 3]! - y * fz + z * fy);
        load.moment[1] = load.sign * (this.subtree[o + 4]! - z * fx + x * fz);
        load.moment[2] = load.sign * (this.subtree[o + 5]! - x * fy + y * fx);
      }
      const parent = this.parent[node]!;
      if (parent >= 0) {
        for (let axis = 0; axis < 6; axis++) {
          this.subtree[parent * 6 + axis]! += this.subtree[o + axis]!;
        }
      }
    }
    return this.loads;
  }
}
