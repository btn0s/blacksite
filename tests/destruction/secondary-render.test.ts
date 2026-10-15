import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BatchedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Raycaster,
  Vector3,
} from "three";
import {
  FragmentState,
  type FragmentDef,
  type SecondaryFragmentDef,
  type SecondaryFractureFrame,
  type SimulationFrame,
} from "../../packages/destruction-domain/src";
import { fractureFragment } from "../../packages/destruction-physics/src/fracture";
import { SecondaryFragmentRenderer } from "../../packages/destruction-render/src/secondary";
import { fragmentEdgeGeometry, fragmentSurfaceGeometry } from "../../packages/destruction-render/src/surfaces";
import {
  PresentationWorld,
  Fragment,
  Transform,
  Integrity,
  RenderSlot,
} from "../../packages/destruction-ecs/src";
import { createScenario } from "../../packages/destruction-testkit/src";

const parent: FragmentDef = {
  id: 12,
  position: [3, 4, 5],
  size: [1, 1, 1],
  mass: 2400,
  material: 0,
  region: 0,
  aggregate: 0,
  anchored: false,
};
function pieces(): SecondaryFractureFrame {
  const fragments = fractureFragment(parent, 123).map((child, i) => ({
    ...child,
    id: 100 + i,
    parentId: parent.id,
    rootId: parent.id,
    generation: 1,
    position: child.position.map((n, axis) => n + parent.position[axis]) as [
      number,
      number,
      number,
    ],
  }));
  return {
    revision: 1,
    fragments,
    states: new Uint8Array(fragments.length).fill(FragmentState.Dynamic),
    transforms: new Float32Array(
      fragments.flatMap((_, i) => [i * 10, 2, 0, 0, 0, 0, 1, 1]),
    ),
  };
}

const shapes = [123, 5, 77].flatMap((seed) => fractureFragment(parent, seed));

/** Live-only frame: one piece per id (ascending), each placed at x = id * 10 so raycasts can target it. */
function live(ids: number[], revision: number, x = (id: number) => id * 10): SecondaryFractureFrame {
  const fragments: SecondaryFragmentDef[] = ids.map((id) => ({
    ...structuredClone(shapes[id % shapes.length]),
    id,
    parentId: parent.id,
    rootId: parent.id,
    generation: 1,
  }));
  return {
    revision,
    fragments,
    states: new Uint8Array(ids.length).fill(FragmentState.Dynamic),
    transforms: new Float32Array(ids.flatMap((id) => [x(id), 2, 0, 0, 0, 0, 1, 1])),
  };
}

function range(from: number, count: number) {
  return Array.from({ length: count }, (_, i) => from + i);
}

function surfaceCount(frame: SecondaryFractureFrame, ids: number[]) {
  let total = 0;
  for (const fragment of frame.fragments) {
    if (!ids.includes(fragment.id)) continue;
    for (const surface of ["exterior", "fracture"] as const) {
      const geometry = fragmentSurfaceGeometry(fragment, surface);
      if (geometry) {
        total++;
        geometry.dispose();
      }
    }
    const edge = fragmentEdgeGeometry(fragment);
    if (edge) {
      total++;
      edge.dispose();
    }
  }
  return total;
}

function batches(renderer: SecondaryFragmentRenderer) {
  return renderer.group.children as BatchedMesh[];
}

function instanceOf(renderer: SecondaryFragmentRenderer, id: number) {
  for (const mesh of batches(renderer)) {
    const instance = (mesh.userData.fragmentIds as number[]).indexOf(id);
    if (instance !== -1) return { instance, mesh };
  }
  return undefined;
}

function xOf(renderer: SecondaryFragmentRenderer, id: number) {
  const found = instanceOf(renderer, id)!;
  const matrix = new Matrix4();
  found.mesh.getMatrixAt(found.instance, matrix);
  return new Vector3().setFromMatrixPosition(matrix).x;
}

function rayDownAt(renderer: SecondaryFragmentRenderer, x: number) {
  renderer.group.updateMatrixWorld(true);
  const hit = new Raycaster(new Vector3(x, 50, 0), new Vector3(0, -1, 0)).intersectObject(
    renderer.group,
    true,
  )[0];
  return hit ? (hit.object.userData.fragmentIds as number[])[hit.batchId!] : undefined;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("physical secondary fragment presentation", () => {
  it("batches new surfaces, raycasts stable child IDs, interpolates only matching children, and clears on reset", () => {
    const exterior = new MeshBasicMaterial(),
      fracture = new MeshBasicMaterial();
    const renderer = new SecondaryFragmentRenderer((_, surface) =>
      surface === "exterior" ? exterior : fracture,
    );
    try {
      const frame = pieces();
      frame.states[0] = FragmentState.Supported;
      expect(frame.fragments.length).toBeGreaterThanOrEqual(2);
      renderer.update(frame, undefined, 1);
      expect(renderer.group.children).toHaveLength(3);
      const oldMeshes = [...renderer.group.children];
      renderer.group.updateMatrixWorld(true);
      const geometry = fragmentSurfaceGeometry(frame.fragments[0], "fracture")!;
      try {
        const p = geometry.getAttribute("position"),
          n = geometry.getAttribute("normal");
        const centroid = new Vector3()
          .fromBufferAttribute(p, 0)
          .add(new Vector3().fromBufferAttribute(p, 1))
          .add(new Vector3().fromBufferAttribute(p, 2))
          .divideScalar(3)
          .add(new Vector3(0, 2, 0));
        const normal = new Vector3().fromBufferAttribute(n, 0);
        const hit = new Raycaster(
          centroid.clone().addScaledVector(normal, 0.01),
          normal.clone().negate(),
        ).intersectObject(renderer.group, true)[0];
        expect(hit).toBeDefined();
        expect(hit.object.userData.fragmentIds[hit.batchId!]).toBe(100);
        expect(hit.distance).toBeCloseTo(0.01, 5);
      } finally {
        geometry.dispose();
      }
      const next = { ...frame, transforms: frame.transforms.slice() };
      next.transforms[0] = 2;
      renderer.update(next, frame, 0.5);
      expect(renderer.group.children).toEqual(oldMeshes); // No per-snapshot allocation.
      const transform = new Matrix4();
      (renderer.group.children[0] as BatchedMesh).getMatrixAt(0, transform);
      expect(new Vector3().setFromMatrixPosition(transform).toArray()).toEqual([
        1, 2, 0,
      ]);
      const wrongPrevious = {
        ...frame,
        fragments: frame.fragments.map((f) => ({ ...f, id: f.id + 1 })),
      };
      renderer.update(next, wrongPrevious, 0.5);
      (renderer.group.children[0] as BatchedMesh).getMatrixAt(0, transform);
      expect(new Vector3().setFromMatrixPosition(transform).x).toBe(2);
      let disposed = 0;
      oldMeshes.forEach((mesh) =>
        (mesh as BatchedMesh).geometry.addEventListener(
          "dispose",
          () => disposed++,
        ),
      );
      renderer.update(undefined, frame, 1);
      expect(renderer.group.children).toHaveLength(0);
      expect(disposed).toBe(3);
      renderer.update(frame, undefined, 1);
      expect(renderer.group.children).toHaveLength(3);
    } finally {
      renderer.dispose();
      exterior.dispose();
      fracture.dispose();
    }
  });

  it("replaces a re-fractured piece with live descendants while keeping defensive Retired hiding", () => {
    const material = new MeshBasicMaterial();
    const renderer = new SecondaryFragmentRenderer(() => material);
    try {
      const previous = pieces();
      renderer.update(previous, undefined, 1);
      const mesh = renderer.group.children[0] as BatchedMesh;
      const first = previous.fragments[0];
      const count = previous.fragments.length;
      const frame: SecondaryFractureFrame = {
        revision: previous.revision + 2,
        fragments: [
          ...previous.fragments.slice(1),
          { ...structuredClone(first), id: 100 + count, parentId: first.id, generation: 2 },
          { ...structuredClone(first), id: 102 + count, parentId: 101 + count, generation: 3 },
        ],
        states: new Uint8Array([
          ...previous.states.slice(1),
          FragmentState.Supported,
          FragmentState.Dynamic,
        ]),
        transforms: new Float32Array([
          ...previous.transforms.slice(8),
          60, 2, 0, 0, 0, 0, 1, 0,
          70, 2, 0, 0, 0, 0, 1, 0,
        ]),
      };
      renderer.update(frame, previous, 0.5);
      expect(renderer.group.children[0]).toBe(mesh);
      const ids = mesh.userData.fragmentIds as number[];
      expect(ids).not.toContain(first.id);
      expect(mesh.getVisibleAt(ids.indexOf(100 + count))).toBe(true);
      expect(mesh.getVisibleAt(ids.indexOf(102 + count))).toBe(true);
      expect(xOf(renderer, 100 + count)).toBe(60);
      const retired = { ...frame, states: frame.states.slice() };
      retired.states[count - 1] = FragmentState.Retired;
      renderer.update(retired, frame, 1);
      expect(renderer.group.children[0]).toBe(mesh);
      expect(mesh.getVisibleAt(ids.indexOf(100 + count))).toBe(false);
      expect(mesh.getVisibleAt(ids.indexOf(102 + count))).toBe(true);
    } finally {
      renderer.dispose();
      material.dispose();
    }
  });

  it("adds and removes pieces incrementally with O(changed) geometry work", () => {
    const material = new MeshBasicMaterial();
    const renderer = new SecondaryFragmentRenderer(() => material);
    const added = vi.spyOn(BatchedMesh.prototype, "addGeometry");
    const deleted = vi.spyOn(BatchedMesh.prototype, "deleteGeometry");
    try {
      const initial = live(range(100, 64), 1);
      renderer.update(initial, undefined, 1);
      expect(added).toHaveBeenCalledTimes(surfaceCount(initial, range(100, 64)));
      const meshes = [...renderer.group.children];
      let ids = range(100, 64);
      for (let step = 0; step < 6; step++) {
        added.mockClear();
        deleted.mockClear();
        const removed = ids.slice(0, 2);
        const fresh = range(200 + step * 3, 3);
        ids = [...ids.slice(2), ...fresh];
        const next = live(ids, 2 + step);
        renderer.update(next, undefined, 1);
        expect(added).toHaveBeenCalledTimes(surfaceCount(next, fresh));
        expect(deleted).toHaveBeenCalledTimes(surfaceCount(live(removed, 0), removed));
        expect(renderer.group.children).toEqual(meshes);
        const rendered = new Set(
          batches(renderer).flatMap((mesh) => (mesh.userData.fragmentIds as number[]).filter((id) => id >= 0)),
        );
        expect(rendered).toEqual(new Set(ids));
        for (const id of removed) expect(rendered.has(id)).toBe(false);
      }
      added.mockClear();
      const same = live(ids, 8);
      renderer.update(same, undefined, 1);
      renderer.update(same, same, 0.5);
      expect(added).not.toHaveBeenCalled();
    } finally {
      renderer.dispose();
      material.dispose();
    }
  });

  it("pairs previous and current poses by id across a removal instead of snapping", () => {
    const material = new MeshBasicMaterial();
    const renderer = new SecondaryFragmentRenderer(() => material);
    try {
      const previous = live([100, 101, 102, 103], 1);
      renderer.update(previous, undefined, 1);
      const current = live([100, 102, 103, 104], 2, (id) => id * 10 + 4);
      renderer.update(current, previous, 0.5);
      expect(xOf(renderer, 100)).toBeCloseTo(1002, 4);
      expect(xOf(renderer, 102)).toBeCloseTo(1022, 4);
      expect(xOf(renderer, 103)).toBeCloseTo(1032, 4);
      expect(xOf(renderer, 104)).toBeCloseTo(1044, 4);
      const reordered = live([99, 102, 104], 3);
      renderer.update(reordered, current, 0.25);
      expect(xOf(renderer, 99)).toBeCloseTo(990, 4);
      expect(xOf(renderer, 102)).toBeCloseTo(1024 - 0.25 * 4, 4);
      expect(xOf(renderer, 104)).toBeCloseTo(1044 - 0.25 * 4, 4);
    } finally {
      renderer.dispose();
      material.dispose();
    }
  });

  it("keeps raycast id mapping correct after removals and instance reuse", () => {
    const material = new MeshBasicMaterial();
    const renderer = new SecondaryFragmentRenderer(() => material);
    try {
      renderer.update(live(range(100, 8), 1), undefined, 1);
      for (const id of range(100, 8)) expect(rayDownAt(renderer, id * 10)).toBe(id);
      renderer.update(live([101, 103, 105, 107], 2), undefined, 1);
      for (const id of [100, 102, 104, 106]) expect(rayDownAt(renderer, id * 10)).toBeUndefined();
      for (const id of [101, 103, 105, 107]) expect(rayDownAt(renderer, id * 10)).toBe(id);
      renderer.update(live([101, 103, 105, 107, 300, 301, 302], 3), undefined, 1);
      for (const id of [101, 103, 105, 107, 300, 301, 302]) expect(rayDownAt(renderer, id * 10)).toBe(id);
      expect(rayDownAt(renderer, 1000)).toBeUndefined();
    } finally {
      renderer.dispose();
      material.dispose();
    }
  });

  it("grows batch storage with headroom while retaining existing geometry", () => {
    const material = new MeshBasicMaterial();
    const renderer = new SecondaryFragmentRenderer(() => material);
    try {
      renderer.update(live(range(100, 4), 1), undefined, 1);
      const small = batches(renderer)[0];
      const capacity = small.maxInstanceCount;
      const grown = range(100, capacity + 4);
      renderer.update(live(grown, 2), undefined, 1);
      const large = batches(renderer)[0];
      expect(large).toBe(small);
      expect(renderer.stats.secondaryBatchGrowths).toBeGreaterThan(0);
      expect(large.maxInstanceCount).toBeGreaterThanOrEqual(2 * grown.length);
      for (const id of [100, 100 + capacity + 3]) expect(rayDownAt(renderer, id * 10)).toBe(id);
      const added = vi.spyOn(BatchedMesh.prototype, "addGeometry");
      const churn = [...range(110, capacity - 6), ...range(400, 8)];
      renderer.update(live(churn, 3), undefined, 1);
      expect(batches(renderer)[0]).toBe(large);
      expect(added).toHaveBeenCalledTimes(surfaceCount(live(churn, 3), range(400, 8)));
    } finally {
      renderer.dispose();
      material.dispose();
    }
  });

  it("compacts vertex storage instead of rebuilding when deleted geometry left enough room", () => {
    const material = new MeshBasicMaterial();
    const renderer = new SecondaryFragmentRenderer(() => material);
    try {
      renderer.update(live(range(100, 24), 1), undefined, 1);
      const mesh = batches(renderer)[0];
      const optimize = vi.spyOn(mesh, "optimize");
      let revision = 2;
      let ids = range(100, 24);
      for (let wave = 0; wave < 20; wave++) {
        ids = [...ids.slice(4), ...range(1000 + wave * 4, 4)];
        renderer.update(live(ids, revision++), undefined, 1);
        expect(batches(renderer)[0]).toBe(mesh);
      }
      expect(optimize).toHaveBeenCalled();
      for (const id of ids) expect(rayDownAt(renderer, id * 10)).toBe(id);
    } finally {
      renderer.dispose();
      material.dispose();
    }
  });

  it("carries original meter UV phase through subdivision and an arbitrary physical rotation", () => {
    const frame = pieces();
    for (const child of frame.fragments) {
      const geometry = fragmentSurfaceGeometry(child, "exterior");
      if (!geometry) continue;
      try {
        const p = geometry.getAttribute("position"),
          n = geometry.getAttribute("normal"),
          uv = geometry.getAttribute("uv");
        for (let i = 0; i < p.count; i++) {
          const rest = new Vector3()
            .fromBufferAttribute(p, i)
            .add(new Vector3(...child.position));
          const normal = new Vector3().fromBufferAttribute(n, i);
          const expected =
            Math.abs(normal.y) > 0.9
              ? [rest.x, -rest.z]
              : Math.abs(normal.x) > 0.9
                ? [rest.z, rest.y]
                : [rest.x, rest.y];
          expect(uv.getX(i)).toBeCloseTo(expected[0], 5);
          expect(uv.getY(i)).toBeCloseTo(expected[1], 5);
        }
      } finally {
        geometry.dispose();
      }
    }
    const mat = new MeshBasicMaterial(),
      renderer = new SecondaryFragmentRenderer(() => mat);
    try {
      const q = new Quaternion().setFromAxisAngle(
        new Vector3(1, 2, 3).normalize(),
        1.2,
      );
      frame.transforms.set(q.toArray(), 3);
      renderer.update(frame, undefined, 1);
      const matrix = new Matrix4();
      (renderer.group.children[0] as BatchedMesh).getMatrixAt(0, matrix);
      expect(
        new Quaternion().setFromRotationMatrix(matrix).angleTo(q),
      ).toBeLessThan(0.001);
    } finally {
      renderer.dispose();
      mat.dispose();
    }
  });

  it("keeps generated pieces addressable in the portable presentation mirror and removes them on reset", () => {
    const manifest = createScenario("wall"),
      world = new PresentationWorld(manifest);
    const secondary = pieces();
    const frame: SimulationFrame = {
      type: "frame",
      tick: 1,
      transforms: new Float32Array(
        manifest.fragments.flatMap((f) => [...f.position, 0, 0, 0, 1, 0]),
      ),
      states: new Uint8Array(manifest.fragments.length),
      bondStates: new Uint8Array(manifest.bonds.length),
      secondary,
      events: [],
      stats: {
        tick: 1,
        brokenBonds: 0,
        totalBonds: manifest.bonds.length,
        activeBodies: 0,
        sleepingBodies: 0,
        settledBodies: 0,
        supportedFragments: 0,
        detachedFragments: 0,
        physicsMs: 0,
        structuralMs: 0,
        workerMs: 0,
        checksum: "00000000",
        commands: 0,
        droppedFrames: 0,
      },
    };
    try {
      world.accept(frame);
      expect(world.secondaryEntities.size).toBe(secondary.fragments.length);
      const child = world.secondaryEntities.get(100)!;
      expect(child.get(Fragment)?.generation).toBe(1);
      expect(child.get(Transform)?.py).toBe(2);
      expect(child.get(Integrity)?.state).toBe(FragmentState.Dynamic);
      expect(child.get(RenderSlot)?.slot).toBe(0);
      const second = world.secondaryEntities.get(101)!;
      expect(second.get(RenderSlot)?.slot).toBe(1);
      const next = pieces();
      next.revision = 2;
      next.fragments.shift();
      next.fragments.push({ ...structuredClone(secondary.fragments[0]), id: 200, parentId: 100, generation: 2 });
      next.fragments.push({ ...structuredClone(secondary.fragments[0]), id: 201, parentId: 150, generation: 3 });
      next.states = new Uint8Array([...next.states.slice(1), FragmentState.Supported, FragmentState.Settled]);
      next.transforms = new Float32Array([...next.transforms.slice(8), 0, 2, 0, 0, 0, 0, 1, 0, 0, 3, 0, 0, 0, 0, 1, 0]);
      world.accept({ ...frame, secondary: next });
      expect(world.secondaryEntities.has(100)).toBe(false);
      expect(world.secondaryEntities.get(101)).toBe(second);
      expect(second.get(RenderSlot)?.slot).toBe(0);
      next.fragments.forEach((fragment, slot) =>
        expect(world.secondaryEntities.get(fragment.id)?.get(RenderSlot)?.slot).toBe(slot),
      );
      expect(world.secondaryEntities.get(200)?.get(Fragment)?.generation).toBe(2);
      expect(world.secondaryEntities.get(201)?.get(Fragment)?.generation).toBe(3);
      expect(world.secondaryEntities.get(200)?.get(Integrity)?.state).toBe(FragmentState.Supported);
      expect(world.secondaryEntities.get(201)?.get(Transform)?.py).toBe(3);
      world.accept({ ...frame, secondary: undefined });
      expect(world.secondaryEntities.size).toBe(0);
    } finally {
      world.dispose();
    }
  });
});
