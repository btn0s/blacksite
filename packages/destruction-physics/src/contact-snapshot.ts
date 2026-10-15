import type RAPIER from "@dimforge/rapier3d-compat";

/** The manifold reads used by Cascade's contact and bearing passes. */
export type ContactManifold = Pick<
  RAPIER.TempContactManifold,
  | "normal"
  | "numContacts"
  | "contactImpulse"
  | "contactDist"
  | "localContactPoint1"
  | "localContactPoint2"
  | "numSolverContacts"
  | "solverContactPoint"
>;

type ContactVisitor = (manifold: ContactManifold, flipped: boolean) => void;
type ContactSnapshotObserver = (
  first: RAPIER.Collider,
  second: RAPIER.Collider,
  visit: ContactVisitor,
) => ContactVisitor;
const snapshotObservers = new WeakMap<RAPIER.World, ContactSnapshotObserver>();

/** Benchmark instrumentation for the snapshot path; legacy queries use world.contactPair. */
export function observeContactSnapshots(world: RAPIER.World, observer: ContactSnapshotObserver): () => void {
  snapshotObservers.set(world, observer);
  return () => {
    if (snapshotObservers.get(world) === observer) snapshotObservers.delete(world);
  };
}

type SnapshotNarrowPhase = RAPIER.NarrowPhase & {
  contactPairSolverContactCount?: (first: number, second: number) => number;
  contactPairSnapshot?: (first: number, second: number) => Float32Array;
};

/** A read-only view of one manifold in an owned native-order F32 snapshot. */
class SnapshotContactManifold implements ContactManifold {
  private readonly contacts: number;
  private readonly solverContacts: number;
  private readonly contactOffset: number;
  private readonly solverOffset: number;
  readonly nextOffset: number;

  constructor(private readonly values: Float32Array, private readonly offset: number) {
    this.contacts = values[offset + 3]!;
    this.solverContacts = values[offset + 4]!;
    this.contactOffset = offset + 5;
    this.solverOffset = this.contactOffset + this.contacts * 8;
    this.nextOffset = this.solverOffset + this.solverContacts * 3;
  }

  private vector(offset: number): RAPIER.Vector {
    return {
      x: this.values[offset]!,
      y: this.values[offset + 1]!,
      z: this.values[offset + 2]!,
    };
  }

  normal(): RAPIER.Vector { return this.vector(this.offset); }
  numContacts(): number { return this.contacts; }
  numSolverContacts(): number { return this.solverContacts; }
  contactImpulse(i: number): number { return this.values[this.contactOffset + i * 8]!; }
  contactDist(i: number): number { return this.values[this.contactOffset + i * 8 + 7]!; }
  localContactPoint1(i: number): RAPIER.Vector | null {
    return i >= 0 && i < this.contacts ? this.vector(this.contactOffset + i * 8 + 1) : null;
  }
  localContactPoint2(i: number): RAPIER.Vector | null {
    return i >= 0 && i < this.contacts ? this.vector(this.contactOffset + i * 8 + 4) : null;
  }
  solverContactPoint(i: number): RAPIER.Vector { return this.vector(this.solverOffset + i * 3); }
}

/** Take a fresh snapshot for each call; older attached hosts retain the native callback path. */
export function forEachContactManifold(
  world: RAPIER.World,
  first: RAPIER.Collider,
  second: RAPIER.Collider,
  visit: ContactVisitor,
): void {
  const narrowPhase = world.narrowPhase as SnapshotNarrowPhase;
  if (typeof narrowPhase.contactPairSnapshot !== "function") {
    world.contactPair(first, second, visit);
    return;
  }
  const observer = snapshotObservers.get(world);
  const callback = observer ? observer(first, second, visit) : visit;
  const values = narrowPhase.contactPairSnapshot(first.handle, second.handle);
  if (values.length === 0) return;
  const flipped = values[0] !== 0, count = values[1]!;
  let offset = 2;
  for (let i = 0; i < count; i++) {
    const manifold = new SnapshotContactManifold(values, offset);
    callback(manifold, flipped);
    offset = manifold.nextOffset;
  }
}

/** Count the same solver rows without constructing pair or manifold wrappers. */
export function contactPairSolverContactCount(world: RAPIER.World, first: number, second: number): number {
  const narrowPhase = world.narrowPhase as SnapshotNarrowPhase;
  if (typeof narrowPhase.contactPairSolverContactCount === "function")
    return narrowPhase.contactPairSolverContactCount(first, second);
  let count = 0;
  narrowPhase.contactPair(first, second, (manifold) => { count += manifold.numSolverContacts(); });
  return count;
}
