import { BatchedMesh, Matrix4, MeshBasicMaterial } from 'three';
import { expect, it, vi } from 'vitest';
import { BondState, FragmentState, type DestructibleManifest, type SimulationFrame } from '../../packages/destruction-domain/src';
import { ExposedFractureEdges } from '../../packages/destruction-render/src/edges';
import { GPUTransformPool } from '../../packages/destruction-render/src/gpu-pool';

function fixture(count = 128) {
  const manifest: DestructibleManifest = {
    assetHash: 'edge-test', coordinateSystem: 'Y_UP_RH', name: 'edge-test', scenario: 'wall', schemaVersion: 1,
    materials: [], regions: [],
    fragments: Array.from({ length: count }, (_, id) => ({ id, aggregate: id, anchored: false, mass: 1, material: 0, region: 0, position: [id * 2, 0, 0], size: [1, 1, 1] })),
    bonds: Array.from({ length: count }, (_, id) => ({ id, a: id, b: -1, area: 1, strength: 1, normal: [1, 0, 0] })),
  };
  const frame: SimulationFrame = {
    type: 'frame', tick: 1, states: new Uint8Array(count).fill(FragmentState.Dynamic),
    transforms: new Float32Array(count * 8), bondStates: new Uint8Array(count).fill(BondState.Broken), events: [],
    stats: { tick: 1, brokenBonds: count, totalBonds: count, activeBodies: count, sleepingBodies: 0, settledBodies: 0, supportedFragments: 0, detachedFragments: count, physicsMs: 0, structuralMs: 0, workerMs: 0, checksum: '', commands: 0, droppedFrames: 0 },
  };
  const pool = new GPUTransformPool(count + 2);
  pool.synchronize(new Map(manifest.fragments.map((_, i) => [String(i), [`primary:${i}`]])));
  const material = new MeshBasicMaterial();
  const edges = new ExposedFractureEdges(manifest, pool, () => material);
  return { manifest, frame, pool, edges, dispose: () => { edges.dispose(); pool.dispose(); material.dispose(); } };
}

it('keeps unchanged edge geometry and batches when one of many exposed faces disappears or returns', () => {
  const f = fixture();
  try {
    f.edges.update(f.frame);
    const original = [...f.edges.group.children];
    const add = vi.spyOn(BatchedMesh.prototype, 'addGeometry');
    const dispose = vi.spyOn(BatchedMesh.prototype, 'dispose');
    try {
      f.frame.tick++;
      f.frame.bondStates[0] = BondState.Intact;
      f.edges.update(f.frame);
      expect(f.edges.stats.edgeFaces).toBe(127);
      expect(add).not.toHaveBeenCalled();
      expect(dispose).not.toHaveBeenCalled();
      expect(f.edges.group.children).toEqual(original);
      f.frame.tick++;
      f.frame.bondStates[0] = BondState.Broken;
      f.edges.update(f.frame);
      expect(add).toHaveBeenCalledTimes(1);
      expect(f.edges.stats.edgeFaces).toBe(128);
      expect(f.edges.group.children).toEqual(original);
    } finally { add.mockRestore(); dispose.mockRestore(); }
  } finally { f.dispose(); }
});

it('updates a changed section with the same bond ID, rebinds pool slots, and clears/restores at the same tick', () => {
  const f = fixture(8);
  try {
    f.edges.update(f.frame);
    const add = vi.spyOn(BatchedMesh.prototype, 'addGeometry');
    try {
      f.frame.bonds = structuredClone(f.manifest.bonds);
      f.frame.bonds[0]!.area = .25;
      f.frame.bondRevision = 1;
      f.frame.tick++;
      f.edges.update(f.frame);
      expect(add).toHaveBeenCalledTimes(1);
      // Changing pool ownership must update existing draws without reconstructing geometry.
      f.pool.synchronize(new Map([['all', Array.from({ length: 8 }, (_, i) => `primary:${7 - i}`)]]));
      for (let i = 0; i < 8; i++) f.pool.write(f.pool.slots.get(`primary:${i}`)!, new Matrix4().makeTranslation(i + 100, 0, 0));
      f.edges.update(f.frame);
      const mesh = f.edges.group.children[0] as BatchedMesh;
      const positions = Array.from({ length: 8 }, (_, i) => mesh.getMatrixAt(i, new Matrix4()).elements[12]).sort((a, b) => a - b);
      expect(positions).toEqual(Array.from({ length: 8 }, (_, i) => i + 100));
      expect(add).toHaveBeenCalledTimes(1);
      f.edges.update();
      expect(f.edges.group.children).toHaveLength(0);
      f.edges.update(f.frame);
      expect(f.edges.stats.edgeFaces).toBe(8);
      expect(f.edges.group.children.length).toBeGreaterThan(0);
    } finally { add.mockRestore(); }
  } finally { f.dispose(); }
});

it('grows without discarding existing batches and releases batches when no faces remain', () => {
  const f = fixture(128);
  try {
    f.frame.bondStates.fill(BondState.Intact, 4);
    f.edges.update(f.frame);
    const original = f.edges.group.children[0];
    f.frame.tick++;
    f.frame.bondStates.fill(BondState.Broken);
    f.edges.update(f.frame);
    expect(f.edges.stats.edgeFaces).toBe(128);
    expect(f.edges.group.children).toContain(original);
    expect(f.edges.stats.edgeGeometryBuilds).toBe(128);
    f.frame.tick++;
    f.frame.bondStates.fill(BondState.Intact);
    f.edges.update(f.frame);
    expect(f.edges.stats.edgeFaces).toBe(0);
    expect(f.edges.group.children).toHaveLength(0);
  } finally { f.dispose(); }
});

it('reuses and compacts freed buffer storage through repeated changes without growing batch count', () => {
  const f = fixture(64);
  const optimize = vi.spyOn(BatchedMesh.prototype, 'optimize');
  try {
    f.frame.bondStates.fill(BondState.Intact, 32);
    f.edges.update(f.frame);
    const original = f.edges.group.children[0];
    for (let i = 0; i < 80; i++) {
      f.frame.tick++;
      f.frame.bondStates[i % 64] = BondState.Intact;
      f.frame.bondStates[(i + 32) % 64] = BondState.Broken;
      f.edges.update(f.frame);
      expect(f.edges.stats.edgeFaces).toBe(32);
      expect(f.edges.group.children).toHaveLength(1);
      expect(f.edges.group.children[0]).toBe(original);
      expect(f.edges.stats.edgeFacesAddedThisUpdate).toBe(1);
      expect(f.edges.stats.edgeFacesRemovedThisUpdate).toBe(1);
    }
    expect(optimize.mock.calls.length).toBeGreaterThan(0);
    expect(f.edges.stats.edgeGeometryBuilds).toBe(112);
  } finally { optimize.mockRestore(); f.dispose(); }
});
