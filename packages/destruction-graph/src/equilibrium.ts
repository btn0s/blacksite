import {
  BondState,
  type BondDef,
  type DestructibleManifest,
  type FragmentDef,
  type MaterialDef,
  type Vec3,
} from '../../destruction-domain/src/index';

export interface BondSection {
  area: number;
  armA: Vec3;
  armB: Vec3;
  inertia1: number;
  inertia2: number;
  length: number;
  normal: Vec3;
  point: Vec3;
  polarInertia: number;
  sectionModulus1: number;
  sectionModulus2: number;
  tangent1: Vec3;
  tangent2: Vec3;
  torsionModulus: number;
}

export interface BondActions {
  forceX: Float64Array;
  forceY: Float64Array;
  forceZ: Float64Array;
  momentX: Float64Array;
  momentY: Float64Array;
  momentZ: Float64Array;
}

export interface EquilibriumResult extends BondActions {
  converged: boolean;
  displacement: Float64Array;
  iterations: number;
  residual: number;
  residualVector: Float64Array;
}

export interface EquilibriumOptions {
  clamped?: Uint8Array;
  groups?: Int32Array;
  loadRevision?: number;
  masses?: ArrayLike<number>;
  maxIterations?: number;
  rhs?: Float64Array;
  tolerance?: number;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const finiteVector = (value: unknown): value is Vec3 =>
  Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);

function worldEndpoint(bond: BondDef, a: FragmentDef): FragmentDef {
  const point = bond.centroid ?? bond.section?.point ?? a.position.map((value, axis) => value + bond.normal[axis]! * a.size[axis]! / 2) as Vec3;
  return { ...a, id: -1, position: point.map((value, axis) => 2 * value - a.position[axis]!) as Vec3 };
}

function sectionFor(bond: BondDef, a: FragmentDef, b: FragmentDef): BondSection {
  const normalLength = Math.hypot(...bond.normal);
  if (!(normalLength > 0) || !(bond.area > 0)) {
    throw new Error(`Invalid section for bond ${bond.id}`);
  }
  const normal = bond.normal.map((v) => v / normalLength) as Vec3;
  if (dot(normal, sub(b.position, a.position)) < 0) {
    for (let axis = 0; axis < 3; axis++) {
      normal[axis]! *= -1;
    }
  }
  if (bond.section) {
    const authored = bond.section;
    const basis: [Vec3, Vec3] = [authored.tangent1, authored.tangent2];
    if (
      !finiteVector(authored.point) ||
      basis.some(
        (tangent) =>
          !finiteVector(tangent) ||
          Math.abs(Math.hypot(...tangent) - 1) > 1e-5 ||
          Math.abs(dot(tangent, normal)) > 1e-5,
      ) ||
      Math.abs(dot(basis[0]!, basis[1]!)) > 1e-5 ||
      [
        authored.inertia1,
        authored.inertia2,
        authored.polarInertia,
        authored.sectionModulus1,
        authored.sectionModulus2,
        authored.torsionModulus,
      ].some((value) => !Number.isFinite(value) || value <= 0)
    ) {
      throw new Error(`Invalid authored section for bond ${bond.id}`);
    }
    return {
      ...authored,
      area: bond.area,
      armA: sub(authored.point, a.position),
      armB: sub(authored.point, b.position),
      length: Math.max(1e-4, Math.abs(dot(sub(b.position, a.position), normal))),
      normal,
      point: [...authored.point],
      tangent1: [...authored.tangent1],
      tangent2: [...authored.tangent2],
    };
  }
  let faceAxis = 0,
    tangentAxis = 0;
  for (let axis = 1; axis < 3; axis++) {
    if (Math.abs(normal[axis]!) > Math.abs(normal[faceAxis]!)) {
      faceAxis = axis;
    }
    if (Math.abs(normal[axis]!) < Math.abs(normal[tangentAxis]!)) {
      tangentAxis = axis;
    }
  }
  const tangent1: Vec3 = [0, 0, 0];
  tangent1[tangentAxis] = 1;
  const projection = dot(tangent1, normal);
  for (let axis = 0; axis < 3; axis++) {
    tangent1[axis]! -= projection * normal[axis]!;
  }
  const tangentLength = Math.hypot(...tangent1);
  for (let axis = 0; axis < 3; axis++) {
    tangent1[axis]! /= tangentLength;
  }
  const tangent2 = cross(normal, tangent1);
  const overlap: Vec3 = [0, 0, 0],
    point: Vec3 = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    const lo = Math.max(
      a.position[axis]! - a.size[axis]! / 2,
      b.position[axis]! - b.size[axis]! / 2,
    );
    const hi = Math.min(
      a.position[axis]! + a.size[axis]! / 2,
      b.position[axis]! + b.size[axis]! / 2,
    );
    overlap[axis] = Math.max(0, hi - lo);
    point[axis] = (hi + lo) / 2;
  }
  const sign = normal[faceAxis]! >= 0 ? 1 : -1;
  point[faceAxis] =
    (a.position[faceAxis]! +
      (sign * a.size[faceAxis]!) / 2 +
      b.position[faceAxis]! -
      (sign * b.size[faceAxis]!) / 2) /
    2;
  overlap[faceAxis] = 0;
  let width =
    Math.abs(tangent1[0]) * overlap[0] +
    Math.abs(tangent1[1]) * overlap[1] +
    Math.abs(tangent1[2]) * overlap[2];
  let height =
    Math.abs(tangent2[0]) * overlap[0] +
    Math.abs(tangent2[1]) * overlap[1] +
    Math.abs(tangent2[2]) * overlap[2];
  if (width <= 1e-9 || height <= 1e-9) {
    width = height = Math.sqrt(bond.area);
  }
  const scale = Math.sqrt(bond.area / (width * height));
  width *= scale;
  height *= scale;
  const inertia1 = (bond.area * height * height) / 12;
  const inertia2 = (bond.area * width * width) / 12;
  return {
    area: bond.area,
    armA: sub(point, a.position),
    armB: sub(point, b.position),
    inertia1,
    inertia2,
    length: Math.max(1e-4, Math.abs(dot(sub(b.position, a.position), normal))),
    normal,
    point,
    polarInertia: inertia1 + inertia2,
    sectionModulus1: (2 * inertia1) / height,
    sectionModulus2: (2 * inertia2) / width,
    tangent1,
    tangent2,
    torsionModulus: (inertia1 + inertia2) / (Math.hypot(width, height) / 2),
  };
}

export function getBondSection(manifest: DestructibleManifest, bond: BondDef, indices?: ReadonlyMap<number, number>): BondSection {
  const find = (id: number) => indices
    ? manifest.fragments[indices.get(id) ?? -1]
    : manifest.fragments.find((fragment) => fragment.id === id);
  const a = find(bond.a);
  const b = bond.b === -1 && a ? worldEndpoint(bond, a) : find(bond.b);
  if (!a || !b) {
    throw new Error(`Invalid endpoints for bond ${bond.id}`);
  }
  return sectionFor(bond, a, b);
}

function principalMatrix(
  target: Float64Array,
  offset: number,
  section: BondSection,
  normal: number,
  tangent1: number,
  tangent2: number,
): void {
  const basis = [section.normal, section.tangent1, section.tangent2];
  const values = [normal, tangent1, tangent2];
  const row = [0, 1, 2, 0, 0, 1],
    col = [0, 1, 2, 1, 2, 2];
  for (let j = 0; j < 6; j++) {
    let value = 0;
    for (let k = 0; k < 3; k++) {
      value += values[k]! * basis[k]![row[j]!]! * basis[k]![col[j]!]!;
    }
    target[offset + j] = value;
  }
}

function elasticity(material: MaterialDef | undefined): [number, number] {
  const elastic = material as
    | (MaterialDef & { poissonRatio?: number; youngModulus?: number })
    | undefined;
  const young = elastic?.youngModulus ?? 12e9;
  const poisson = elastic?.poissonRatio ?? 0.2;
  if (
    !(young > 0) ||
    !Number.isFinite(young) ||
    !Number.isFinite(poisson) ||
    poisson <= -1 ||
    poisson >= 0.5
  ) {
    throw new Error('Invalid elastic material properties');
  }
  return [young, young / (2 * (1 + poisson))];
}

export class EquilibriumSolver {
  readonly sections: Array<BondSection>;
  private readonly a: Uint32Array;
  private readonly b: Uint32Array;
  private readonly fragmentOrder: Array<number>;
  private readonly bondOrder: Array<number>;
  private readonly baseStiffness: Float64Array;
  private readonly stiffness: Float64Array;
  private readonly diagonalContributions: Float64Array;
  private readonly stiffnessScale: Float64Array;
  private readonly active: Uint8Array;
  private readonly free: Uint8Array;
  private readonly previousStates: Uint8Array;
  private readonly previousDamage: Float32Array;
  private readonly previousSupported: Uint8Array;
  private readonly previousClamped: Uint8Array;
  private readonly blocks: Float64Array;
  private readonly rhs: Float64Array;
  private readonly r: Float64Array;
  private readonly z: Float64Array;
  private readonly p: Float64Array;
  private readonly q: Float64Array;
  private readonly result: EquilibriumResult;
  private initialized = false;
  private krylovReady = false;
  private krylovRz = 0;
  private previousLoadRevision: number | undefined;
  private explicitRhs = false;
  private readonly previousGroups: Int32Array;
  private readonly groupReady: Uint8Array;
  private readonly groupRz: Float64Array;

  constructor(readonly manifest: DestructibleManifest) {
    const n = manifest.fragments.length,
      m = manifest.bonds.length,
      dofs = n * 6;
    this.a = new Uint32Array(m);
    this.b = new Uint32Array(m);
    this.sections = new Array(m);
    this.fragmentOrder = manifest.fragments
      .map((_, i) => i)
      .sort((a, b) => manifest.fragments[a]!.id - manifest.fragments[b]!.id);
    this.bondOrder = manifest.bonds
      .map((_, i) => i)
      .sort((a, b) => manifest.bonds[a]!.id - manifest.bonds[b]!.id);
    const indices = new Map(manifest.fragments.map((fragment, i) => [fragment.id, i]));
    const materials = new Map(manifest.materials.map((material) => [material.id, material]));
    this.baseStiffness = new Float64Array(m * 12);
    this.stiffness = new Float64Array(m * 12);
    this.diagonalContributions = new Float64Array(m * 42);
    this.stiffnessScale = new Float64Array(m);
    this.active = new Uint8Array(m);
    this.free = new Uint8Array(n);
    this.previousStates = new Uint8Array(m);
    this.previousDamage = new Float32Array(m);
    this.previousSupported = new Uint8Array(n);
    this.previousClamped = new Uint8Array(n);
    this.previousGroups = new Int32Array(n).fill(-1);
    this.groupReady = new Uint8Array(n);
    this.groupRz = new Float64Array(n);
    this.blocks = new Float64Array(n * 36);
    this.rhs = new Float64Array(dofs);
    this.r = new Float64Array(dofs);
    this.z = new Float64Array(dofs);
    this.p = new Float64Array(dofs);
    this.q = new Float64Array(dofs);
    this.result = {
      converged: false,
      displacement: new Float64Array(dofs),
      forceX: new Float64Array(m),
      forceY: new Float64Array(m),
      forceZ: new Float64Array(m),
      iterations: 0,
      momentX: new Float64Array(m),
      momentY: new Float64Array(m),
      momentZ: new Float64Array(m),
      residual: 0,
      residualVector: this.q,
    };
    for (const i of this.bondOrder) {
      const bond = manifest.bonds[i]!,
        a = indices.get(bond.a),
        b = bond.b === -1 ? a : indices.get(bond.b);
      if (a === undefined || b === undefined || (a === b && bond.b !== -1)) {
        throw new Error(`Invalid endpoints for bond ${bond.id}`);
      }
      this.a[i] = a;
      this.b[i] = b;
      const fa = manifest.fragments[a]!,
        fb = bond.b === -1 ? worldEndpoint(bond, fa) : manifest.fragments[b]!;
      const section = (this.sections[i] = sectionFor(bond, fa, fb));
      const [ea, ga] = elasticity(materials.get(fa.material));
      const [eb, gb] = elasticity(materials.get(fb.material));
      const e = 2 / (1 / ea + 1 / eb),
        g = 2 / (1 / ga + 1 / gb);
      principalMatrix(
        this.baseStiffness,
        i * 12,
        section,
        (e * section.area) / section.length,
        (g * section.area) / section.length,
        (g * section.area) / section.length,
      );
      principalMatrix(
        this.baseStiffness,
        i * 12 + 6,
        section,
        (g * section.polarInertia) / section.length,
        (e * section.inertia1) / section.length,
        (e * section.inertia2) / section.length,
      );
      this.cacheDiagonalContributions(i);
    }
  }

  solve(
    bondStates: Uint8Array,
    damage: Float32Array,
    supported: Uint8Array,
    options: EquilibriumOptions = {},
  ): EquilibriumResult {
    const n = this.free.length,
      m = this.active.length;
    if (
      bondStates.length !== m ||
      damage.length !== m ||
      supported.length !== n ||
      (options.rhs !== undefined && options.rhs.length !== n * 6) ||
      (options.clamped !== undefined && options.clamped.length !== n) ||
      (options.groups !== undefined && options.groups.length !== n) ||
      (options.masses !== undefined && options.masses.length !== n)
    ) {
      throw new Error('Invalid equilibrium buffer length');
    }
    if (options.groups?.some((group) => group < -1 || group >= n)) {
      throw new Error('Invalid equilibrium component key');
    }
    const maxIterations = options.maxIterations ?? 768,
      tolerance = options.tolerance ?? 1e-6;
    if (
      !Number.isInteger(maxIterations) ||
      maxIterations < 0 ||
      !(tolerance > 0) ||
      !Number.isFinite(tolerance)
    ) {
      throw new Error('Invalid equilibrium solve options');
    }
    let changed = !this.initialized;
    const dirtyGroups = options.groups ? new Uint8Array(n) : null;
    const dirtyNode = (node: number) => {
      if (!options.groups || !dirtyGroups) {
        return;
      }
      const current = options.groups[node]!,
        previous = this.previousGroups[node]!;
      if (current >= 0) {
        dirtyGroups[current] = 1;
      }
      if (previous >= 0) {
        dirtyGroups[previous] = 1;
      }
    };
    for (const i of this.bondOrder) {
      if (
        !this.initialized ||
        bondStates[i]! !== this.previousStates[i]! ||
        damage[i]! !== this.previousDamage[i]!
      ) {
        dirtyNode(this.a[i]!);
        dirtyNode(this.b[i]!);
      }
      if (bondStates[i]! !== this.previousStates[i]!) {
        changed = true;
      }
      if (damage[i]! !== this.previousDamage[i]!) {
        changed = true;
      }
    }
    for (const i of this.fragmentOrder) {
      if (supported[i]! !== this.previousSupported[i]!) {
        changed = true;
      }
    }
    for (const i of this.fragmentOrder) {
      const clamped = options.clamped?.[i] ?? (this.manifest.fragments[i]!.anchored ? 1 : 0);
      if (clamped !== this.previousClamped[i]!) {
        changed = true;
      }
      if (options.groups) {
        if (
          !this.initialized ||
          supported[i]! !== this.previousSupported[i]! ||
          clamped !== this.previousClamped[i]! ||
          options.groups[i]! !== this.previousGroups[i]!
        ) {
          dirtyNode(i);
        }
        if (options.rhs && supported[i]! && !clamped) {
          for (let j = i * 6; j < i * 6 + 6; j++) {
            if (options.rhs[j]! !== this.rhs[j]!) {
              dirtyNode(i);
            }
          }
        }
      }
    }
    const matrixChanged = changed;
    if (
      Boolean(options.rhs) !== this.explicitRhs ||
      options.loadRevision !== this.previousLoadRevision
    ) {
      changed = true;
    }
    if (options.rhs && options.loadRevision === undefined) {
      for (const node of this.fragmentOrder) {
        if (
          !supported[node]! ||
          (options.clamped?.[node] ?? this.manifest.fragments[node]!.anchored)
        ) {
          continue;
        }
        for (let j = node * 6; j < node * 6 + 6; j++) {
          if (options.rhs[j]! !== this.rhs[j]!) {
            changed = true;
          }
        }
      }
    }
    if (!options.groups && !changed && this.result.residual <= tolerance) {
      this.result.iterations = 0;
      this.result.converged = true;
      return this.result;
    }
    const x = this.result.displacement;
    if (changed) {
      this.previousStates.set(bondStates);
      this.previousDamage.set(damage);
      this.previousSupported.set(supported);
      this.previousLoadRevision = options.loadRevision;
      this.explicitRhs = Boolean(options.rhs);
      this.rhs.fill(0);
      for (const i of this.fragmentOrder) {
        const clamped = options.clamped?.[i] ?? (this.manifest.fragments[i]!.anchored ? 1 : 0);
        this.previousClamped[i] = clamped;
        this.free[i] = supported[i]! && !clamped ? 1 : 0;
        if (this.free[i]) {
          if (options.rhs) {
            this.rhs.set(options.rhs.subarray(i * 6, i * 6 + 6), i * 6);
          } else {
            this.rhs[i * 6 + 1] = -(options.masses?.[i] ?? this.manifest.fragments[i]!.mass) * 9.81;
          }
        } else {
          x.fill(0, i * 6, i * 6 + 6);
        }
      }
      if (matrixChanged) {
        for (const i of this.bondOrder) {
          this.active[i] =
            this.manifest.bonds[i]!.b !== -1 && bondStates[i]! !== BondState.Broken && supported[this.a[i]!]! && supported[this.b[i]!]!
              ? 1
              : 0;
          const scale = this.active[i]
            ? Math.max(0.02, (1 - Math.min(1, Math.max(0, damage[i]!))) ** 2)
            : 0;
          this.stiffnessScale[i] = scale;
          for (let j = i * 12; j < i * 12 + 12; j++) {
            this.stiffness[j] = this.baseStiffness[j]! * scale;
          }
        }
        this.buildPreconditioner();
      }
      this.initialized = true;
    }
    if (options.groups && dirtyGroups) {
      this.previousGroups.set(options.groups);
      return this.solveComponents(options.groups, dirtyGroups, maxIterations, tolerance);
    }
    const norm = Math.sqrt(this.inner(this.rhs, this.rhs));
    if (norm === 0) {
      x.fill(0);
      this.apply(x, this.q, true);
      this.krylovReady = false;
      this.krylovRz = 0;
      this.result.iterations = 0;
      this.result.residual = 0;
      this.result.converged = true;
      return this.result;
    }
    if (changed || !this.krylovReady) {
      this.apply(x, this.q);
      for (let i = 0; i < x.length; i++) {
        this.r[i] = this.rhs[i]! - this.q[i]!;
      }
      this.precondition(this.r, this.z);
      this.p.set(this.z);
      this.krylovRz = this.inner(this.r, this.z);
    }
    let residual = norm ? Math.sqrt(this.inner(this.r, this.r)) / norm : 0;
    let rz = this.krylovRz,
      iterations = 0;
    while (residual > tolerance && iterations < maxIterations) {
      this.apply(this.p, this.q);
      const pq = this.inner(this.p, this.q);
      if (!(pq > 0) || !Number.isFinite(pq) || !Number.isFinite(rz)) {
        break;
      }
      const alpha = rz / pq;
      for (let i = 0; i < x.length; i++) {
        x[i]! += alpha * this.p[i]!;
        this.r[i]! -= alpha * this.q[i]!;
      }
      iterations++;
      residual = Math.sqrt(this.inner(this.r, this.r)) / norm;
      if (residual <= tolerance) {
        break;
      }
      this.precondition(this.r, this.z);
      const next = this.inner(this.r, this.z),
        beta = next / rz;
      for (let i = 0; i < x.length; i++) {
        this.p[i] = this.z[i]! + beta * this.p[i]!;
      }
      rz = next;
    }
    this.krylovRz = rz;
    this.krylovReady = residual > tolerance && iterations === maxIterations;
    this.apply(x, this.q, true);
    for (let i = 0; i < x.length; i++) {
      this.q[i] = this.rhs[i]! - this.q[i]!;
    }
    residual = norm ? Math.sqrt(this.inner(this.q, this.q)) / norm : 0;
    this.result.iterations = iterations;
    this.result.residual = residual;
    this.result.converged = residual <= tolerance;
    return this.result;
  }

  private solveComponents(
    groups: Int32Array,
    dirty: Uint8Array,
    maxIterations: number,
    tolerance: number,
  ): EquilibriumResult {
    const n = this.free.length,
      x = this.result.displacement;
    const norm2 = new Float64Array(n),
      rr = new Float64Array(n),
      rz = new Float64Array(n),
      pq = new Float64Array(n),
      alpha = new Float64Array(n);
    const present = new Uint8Array(n),
      active = new Uint8Array(n),
      keys: Array<number> = [];
    for (const node of this.fragmentOrder) {
      const key = groups[node]!;
      if (!this.free[node]! || key < 0) {
        this.p.fill(0, node * 6, node * 6 + 6);
        continue;
      }
      if (!present[key]!) {
        present[key] = 1;
        keys.push(key);
      }
      for (let j = node * 6; j < node * 6 + 6; j++) {
        norm2[key]! += this.rhs[j]! * this.rhs[j]!;
      }
    }
    for (const node of this.fragmentOrder) {
      if (this.free[node]! && groups[node]! >= 0 && norm2[groups[node]!]! === 0) {
        x.fill(0, node * 6, node * 6 + 6);
      }
    }
    this.apply(x, this.q);
    for (const node of this.fragmentOrder) {
      const key = groups[node]!;
      if (!this.free[node]! || key < 0) {
        this.r.fill(0, node * 6, node * 6 + 6);
        continue;
      }
      if (dirty[key]! || !this.groupReady[key]!) {
        for (let j = node * 6; j < node * 6 + 6; j++) {
          this.r[j] = this.rhs[j]! - this.q[j]!;
        }
      }
    }
    this.precondition(this.r, this.z);
    this.componentDot(this.r, this.r, groups, rr);
    this.componentDot(this.r, this.z, groups, rz);
    for (const key of keys) {
      active[key] = norm2[key]! > 0 && Math.sqrt(rr[key]! / norm2[key]!) > tolerance ? 1 : 0;
      if (dirty[key]! || !this.groupReady[key]!) {
        this.groupRz[key] = rz[key]!;
      }
    }
    for (const node of this.fragmentOrder) {
      const key = groups[node]!;
      if (!this.free[node]! || key < 0) {
        continue;
      }
      for (let j = node * 6; j < node * 6 + 6; j++) {
        if (!active[key]!) {
          this.p[j] = 0;
        } else if (dirty[key]! || !this.groupReady[key]!) {
          this.p[j] = this.z[j]!;
        }
      }
    }
    let iterations = 0;
    while (iterations < maxIterations && keys.some((key) => active[key]!)) {
      this.apply(this.p, this.q);
      this.componentDot(this.p, this.q, groups, pq);
      for (const key of keys) {
        if (active[key]!) {
          if (
            !(pq[key]! > 0) ||
            !Number.isFinite(pq[key]!) ||
            !Number.isFinite(this.groupRz[key]!)
          ) {
            active[key] = 0;
            this.groupReady[key] = 0;
          } else {
            alpha[key] = this.groupRz[key]! / pq[key]!;
          }
        }
      }
      for (const node of this.fragmentOrder) {
        const key = groups[node]!;
        if (!this.free[node]! || key < 0 || !active[key]!) {
          continue;
        }
        for (let j = node * 6; j < node * 6 + 6; j++) {
          x[j]! += alpha[key]! * this.p[j]!;
          this.r[j]! -= alpha[key]! * this.q[j]!;
        }
      }
      iterations++;
      this.componentDot(this.r, this.r, groups, rr);
      this.precondition(this.r, this.z);
      this.componentDot(this.r, this.z, groups, rz);
      for (const key of keys) {
        if (active[key]! && Math.sqrt(rr[key]! / norm2[key]!) <= tolerance) {
          active[key] = 0;
        }
      }
      for (const node of this.fragmentOrder) {
        const key = groups[node]!;
        if (!this.free[node]! || key < 0) {
          continue;
        }
        for (let j = node * 6; j < node * 6 + 6; j++) {
          this.p[j] = active[key]! ? this.z[j]! + (rz[key]! / this.groupRz[key]!) * this.p[j]! : 0;
        }
      }
      for (const key of keys) {
        this.groupRz[key] = rz[key]!;
        this.groupReady[key] = active[key]!;
      }
    }
    this.apply(x, this.q, true);
    for (let i = 0; i < x.length; i++) {
      this.q[i] = this.rhs[i]! - this.q[i]!;
    }
    this.componentDot(this.q, this.q, groups, rr);
    let residual = 0;
    for (const key of keys) {
      residual = Math.max(
        residual,
        norm2[key]! ? Math.sqrt(rr[key]! / norm2[key]) : Math.sqrt(rr[key]!),
      );
    }
    this.result.iterations = iterations;
    this.result.residual = residual;
    this.result.converged = residual <= tolerance;
    return this.result;
  }

  private componentDot(
    a: Float64Array,
    b: Float64Array,
    groups: Int32Array,
    result: Float64Array,
  ): void {
    result.fill(0);
    for (const node of this.fragmentOrder) {
      const key = groups[node]!;
      if (!this.free[node]! || key < 0) {
        continue;
      }
      for (let j = node * 6; j < node * 6 + 6; j++) {
        result[key]! += a[j]! * b[j]!;
      }
    }
  }

  private inner(a: Float64Array, b: Float64Array): number {
    let sum = 0;
    for (const i of this.fragmentOrder) {
      if (this.free[i]!) {
        for (let j = i * 6; j < i * 6 + 6; j++) {
          sum += a[j]! * b[j]!;
        }
      }
    }
    return sum;
  }

  sample(displacement: Float64Array, nodalActions: Float64Array, bonds: BondActions): void {
    if (
      displacement.length !== this.free.length * 6 ||
      nodalActions.length !== displacement.length ||
      [bonds.forceX, bonds.forceY, bonds.forceZ, bonds.momentX, bonds.momentY, bonds.momentZ].some(
        (buffer) => buffer.length !== this.active.length,
      )
    ) {
      throw new Error('Invalid equilibrium sample buffer length');
    }
    this.apply(displacement, nodalActions, true, bonds);
  }

  private apply(
    x: Float64Array,
    out: Float64Array,
    collect = false,
    actions: BondActions = this.result,
  ): void {
    out.fill(0);
    if (collect) {
      actions.forceX.fill(0);
      actions.forceY.fill(0);
      actions.forceZ.fill(0);
      actions.momentX.fill(0);
      actions.momentY.fill(0);
      actions.momentZ.fill(0);
    }
    const k = this.stiffness;
    for (const i of this.bondOrder) {
      if (!this.active[i]!) {
        continue;
      }
      const a = this.a[i]! * 6,
        b = this.b[i]! * 6,
        s = this.sections[i]!,
        ra = s.armA,
        rb = s.armB,
        o = i * 12;
      const dx =
        x[b]! +
        x[b + 4]! * rb[2] -
        x[b + 5]! * rb[1] -
        x[a]! -
        x[a + 4]! * ra[2] +
        x[a + 5]! * ra[1];
      const dy =
        x[b + 1]! +
        x[b + 5]! * rb[0] -
        x[b + 3]! * rb[2] -
        x[a + 1]! -
        x[a + 5]! * ra[0] +
        x[a + 3]! * ra[2];
      const dz =
        x[b + 2]! +
        x[b + 3]! * rb[1] -
        x[b + 4]! * rb[0] -
        x[a + 2]! -
        x[a + 3]! * ra[1] +
        x[a + 4]! * ra[0];
      const rx = x[b + 3]! - x[a + 3]!,
        ry = x[b + 4]! - x[a + 4]!,
        rz = x[b + 5]! - x[a + 5]!;
      const fx = k[o]! * dx + k[o + 3]! * dy + k[o + 4]! * dz;
      const fy = k[o + 3]! * dx + k[o + 1]! * dy + k[o + 5]! * dz;
      const fz = k[o + 4]! * dx + k[o + 5]! * dy + k[o + 2]! * dz;
      const mx = k[o + 6]! * rx + k[o + 9]! * ry + k[o + 10]! * rz;
      const my = k[o + 9]! * rx + k[o + 7]! * ry + k[o + 11]! * rz;
      const mz = k[o + 10]! * rx + k[o + 11]! * ry + k[o + 8]! * rz;
      if (this.free[this.a[i]!]!) {
        out[a]! -= fx;
        out[a + 1]! -= fy;
        out[a + 2]! -= fz;
        out[a + 3]! -= mx + ra[1] * fz - ra[2] * fy;
        out[a + 4]! -= my + ra[2] * fx - ra[0] * fz;
        out[a + 5]! -= mz + ra[0] * fy - ra[1] * fx;
      }
      if (this.free[this.b[i]!]!) {
        out[b]! += fx;
        out[b + 1]! += fy;
        out[b + 2]! += fz;
        out[b + 3]! += mx + rb[1] * fz - rb[2] * fy;
        out[b + 4]! += my + rb[2] * fx - rb[0] * fz;
        out[b + 5]! += mz + rb[0] * fy - rb[1] * fx;
      }
      if (collect) {
        actions.forceX[i] = fx;
        actions.forceY[i] = fy;
        actions.forceZ[i] = fz;
        actions.momentX[i] = mx;
        actions.momentY[i] = my;
        actions.momentZ[i] = mz;
      }
    }
  }

  private cacheDiagonalContributions(i: number): void {
    const k = this.baseStiffness,
      o = i * 12;
    const translation = [
      [k[o]!, k[o + 3]!, k[o + 4]!],
      [k[o + 3]!, k[o + 1]!, k[o + 5]!],
      [k[o + 4]!, k[o + 5]!, k[o + 2]!],
    ];
    const rotation = [
      [k[o + 6]!, k[o + 9]!, k[o + 10]!],
      [k[o + 9]!, k[o + 7]!, k[o + 11]!],
      [k[o + 10]!, k[o + 11]!, k[o + 8]!],
    ];
    for (let end = 0; end < 2; end++) {
      const r = end === 0 ? this.sections[i]!.armA : this.sections[i]!.armB;
      const jacobian = [
        [1, 0, 0, 0, r[2], -r[1]],
        [0, 1, 0, -r[2], 0, r[0]],
        [0, 0, 1, r[1], -r[0], 0],
      ];
      let slot = i * 42 + end * 21;
      for (let row = 0; row < 6; row++) {
        for (let col = 0; col <= row; col++) {
          let value = row >= 3 && col >= 3 ? rotation[row - 3]![col - 3]! : 0;
          for (let a = 0; a < 3; a++) {
            for (let b = 0; b < 3; b++) {
              value += jacobian[a]![row]! * translation[a]![b]! * jacobian[b]![col]!;
            }
          }
          this.diagonalContributions[slot++] = value;
        }
      }
    }
  }

  private buildPreconditioner(): void {
    this.blocks.fill(0);
    const blocks = this.blocks,
      contributions = this.diagonalContributions;
    for (const i of this.bondOrder) {
      if (!this.active[i]!) {
        continue;
      }
      const scale = this.stiffnessScale[i]!;
      for (let end = 0; end < 2; end++) {
        const node = end === 0 ? this.a[i]! : this.b[i]!;
        if (!this.free[node]!) {
          continue;
        }
        let slot = i * 42 + end * 21;
        for (let row = 0; row < 6; row++) {
          for (let col = 0; col <= row; col++) {
            blocks[node * 36 + row * 6 + col]! += contributions[slot++]! * scale;
          }
        }
      }
    }
    for (const node of this.fragmentOrder) {
      if (!this.free[node]!) {
        continue;
      }
      const o = node * 36;
      for (let row = 0; row < 6; row++) {
        for (let col = 0; col <= row; col++) {
          let value = blocks[o + row * 6 + col]!;
          for (let j = 0; j < col; j++) {
            value -= blocks[o + row * 6 + j]! * blocks[o + col * 6 + j]!;
          }
          blocks[o + row * 6 + col] =
            row === col ? Math.sqrt(Math.max(value, 1e-18)) : value / blocks[o + col * 6 + col]!;
        }
      }
    }
  }

  private precondition(r: Float64Array, z: Float64Array): void {
    z.fill(0);
    for (const node of this.fragmentOrder) {
      if (!this.free[node]!) {
        continue;
      }
      const o = node * 36,
        p = node * 6;
      for (let row = 0; row < 6; row++) {
        let value = r[p + row]!;
        for (let col = 0; col < row; col++) {
          value -= this.blocks[o + row * 6 + col]! * z[p + col]!;
        }
        z[p + row] = value / this.blocks[o + row * 6 + row]!;
      }
      for (let row = 5; row >= 0; row--) {
        let value = z[p + row]!;
        for (let col = row + 1; col < 6; col++) {
          value -= this.blocks[o + col * 6 + row]! * z[p + col]!;
        }
        z[p + row] = value / this.blocks[o + row * 6 + row]!;
      }
    }
  }
}
