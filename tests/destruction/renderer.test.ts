import { BatchedMesh, Matrix4, MeshBasicMaterial, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createDestructibleBoxes } from '../../packages/destruction-authoring/src/boxes';
import { FragmentState, type DestructibleManifest, type SimulationFrame } from '../../packages/destruction-domain/src';
import { fractureFragment } from '../../packages/destruction-physics/src/fracture';
import { DestructionRenderer } from '../../packages/destruction-render/src';

function fixture() {
  return createDestructibleBoxes([
    { id: 'wall', min: [3, 0, -1], max: [5, 1, 0], material: 0, anchored: true },
  ], { id: 'render-wall', cellSize: 1 }).manifest;
}

function frameFor(manifest: DestructibleManifest, tick = 1): SimulationFrame {
  return {
    type: 'frame', tick,
    transforms: new Float32Array(manifest.fragments.flatMap(fragment => [...fragment.position, 0, 0, 0, 1, 0])),
    states: new Uint8Array(manifest.fragments.length),
    bondStates: new Uint8Array(manifest.bonds.length), events: [],
    stats: {
      tick, brokenBonds: 0, totalBonds: manifest.bonds.length, activeBodies: 0,
      sleepingBodies: 0, settledBodies: 0, supportedFragments: manifest.fragments.length,
      detachedFragments: 0, physicsMs: 0, structuralMs: 0, workerMs: 0,
      checksum: '00000000', commands: 0, droppedFrames: 0,
    },
  };
}

function primary(renderer: DestructionRenderer) {
  return renderer.group.children.filter((child): child is BatchedMesh => child instanceof BatchedMesh && child.name === 'cascade-fragments');
}

describe('drop-in destruction renderer', () => {
  it('renders shallow intact chunks and exposes a demoted leaf without moving its rest pose', () => {
    const manifest = fixture();
    const exterior = new MeshBasicMaterial();
    const fracture = new MeshBasicMaterial();
    const renderer = new DestructionRenderer(manifest, { materialFor: (_, surface) => surface === 'exterior' ? exterior : fracture });
    try {
      const meshes = primary(renderer);
      expect(meshes).toHaveLength(2);
      const outside = meshes.find(mesh => mesh.material === exterior)!;
      const inside = meshes.find(mesh => mesh.material === fracture)!;
      const edge = renderer.group.children.find(child => child.name === 'cascade-damaged-edges') as BatchedMesh;
      expect(edge).toBeDefined();
      const exteriorSlot = (id: number) => (outside.userData.fragmentIds as number[]).indexOf(id);
      const interiorSlot = (id: number) => (inside.userData.fragmentIds as number[]).indexOf(id);
      const transform = new Matrix4();
      for (const fragment of manifest.fragments) {
        const slot = exteriorSlot(fragment.id);
        expect(outside.getVisibleAt(slot)).toBe(fragment.parent === undefined || fragment.parent === -1);
        if (outside.getVisibleAt(slot)) {
          outside.getMatrixAt(slot, transform);
          expect(new Vector3().setFromMatrixPosition(transform).distanceTo(new Vector3(...fragment.position))).toBeLessThan(1e-6);
        }
      }
      const leafIndex = manifest.fragments.findIndex(fragment => fragment.depth === 2);
      const leaf = manifest.fragments[leafIndex]!;
      let frame = frameFor(manifest);
      frame.states.fill(FragmentState.Hidden);
      frame.states[leafIndex] = FragmentState.Supported;
      renderer.update(frame);
      expect(outside.getVisibleAt(exteriorSlot(leaf.id))).toBe(true);
      expect(inside.getVisibleAt(interiorSlot(leaf.id))).toBe(false);
      frame = { ...frame, tick: 2, transforms: frame.transforms.slice(), states: frame.states.slice() };
      frame.transforms[leafIndex * 8 + 7] = 1;
      renderer.update(frame);
      expect(inside.getVisibleAt(interiorSlot(leaf.id))).toBe(true);
      expect(edge.getVisibleAt((edge.userData.fragmentIds as number[]).indexOf(leaf.id))).toBe(true);
      frame = { ...frame, tick: 3, states: frame.states.slice() };
      frame.states[leafIndex] = FragmentState.Retired;
      renderer.update(frame);
      expect(outside.getVisibleAt(exteriorSlot(leaf.id))).toBe(false);
      expect(inside.getVisibleAt(interiorSlot(leaf.id))).toBe(false);
      renderer.update();
      expect(outside.getVisibleAt(exteriorSlot(manifest.fragments.find(fragment => fragment.depth === 0)!.id))).toBe(true);
      expect(primary(renderer)).toEqual(meshes);
    } finally {
      renderer.dispose();
      exterior.dispose();
      fracture.dispose();
    }
  });

  it('interpolates dynamic poses and replaces retired geometry with physical child meshes', () => {
    const manifest = fixture();
    const renderer = new DestructionRenderer(manifest);
    try {
      const previous = frameFor(manifest, 1);
      const current = frameFor(manifest, 2);
      current.states[0] = FragmentState.Dynamic;
      current.transforms[0] = previous.transforms[0]! + 4;
      renderer.update(current, previous, 0.25);
      const mesh = primary(renderer)[0]!;
      const transform = new Matrix4();
      mesh.getMatrixAt(0, transform);
      expect(new Vector3().setFromMatrixPosition(transform).x).toBeCloseTo(previous.transforms[0]! + 1, 5);
      const parent = manifest.fragments[0]!;
      const children = fractureFragment(parent, 10).map((child, index) => ({ ...child, id: 100 + index, parentId: parent.id, rootId: parent.id, generation: 1 }));
      expect(children.length).toBeGreaterThan(1);
      current.states[0] = FragmentState.Retired;
      current.secondary = {
        revision: 1, fragments: children,
        states: new Uint8Array(children.length).fill(FragmentState.Dynamic),
        transforms: new Float32Array(children.flatMap((_, index) => [index, 2, 0, 0, 0, 0, 1, 1])),
      };
      renderer.update(current, previous, 1);
      expect(mesh.getVisibleAt(0)).toBe(false);
      const secondary = renderer.group.getObjectByName('secondary-fragments')!;
      expect(secondary.children.length).toBeGreaterThan(0);
      const childIds = new Set(secondary.children.flatMap(child => child.userData.fragmentIds as number[]));
      expect(childIds).toEqual(new Set(children.map(child => child.id)));
      renderer.update();
      expect(secondary.children).toHaveLength(0);
      expect(mesh.getVisibleAt(0)).toBe(true);
    } finally {
      renderer.dispose();
    }
  });

  it('exposes a demoted neighbour interface when its runtime cell bond is retired', () => {
    const manifest = createDestructibleBoxes([
      { id: 'pair', min: [0, 0, -1], max: [2, 1, 0], material: 0, anchored: true },
      { id: 'far', min: [10, 0, -1], max: [12, 1, 0], material: 0, anchored: true },
    ], { id: 'render-pair', cellSize: 1 }).manifest;
    const leaves = manifest.fragments.map((fragment, index) => ({ fragment, index })).filter(({ fragment }) => fragment.depth === 2);
    expect(leaves).toHaveLength(4);
    const near = leaves.filter(({ fragment }) => fragment.position[0] < 5).sort((a, b) => a.fragment.position[0] - b.fragment.position[0]);
    const far = leaves.filter(({ fragment }) => fragment.position[0] > 5);
    const [left, middle] = near;
    const exterior = new MeshBasicMaterial();
    const fracture = new MeshBasicMaterial();
    const renderer = new DestructionRenderer(manifest, { materialFor: (_, surface) => surface === 'exterior' ? exterior : fracture });
    try {
      const inside = primary(renderer).find(mesh => mesh.material === fracture)!;
      const slotOf = (id: number) => (inside.userData.fragmentIds as number[]).indexOf(id);
      let frame = frameFor(manifest);
      frame.states.fill(FragmentState.Hidden);
      for (const { index } of leaves) frame.states[index] = FragmentState.Supported;
      frame.bonds = [...manifest.bonds, { id: 99, a: left!.fragment.id, b: middle!.fragment.id, normal: [1, 0, 0], area: 1, strength: 1 }];
      frame.bondStates = new Uint8Array(frame.bonds.length);
      frame.bondRevision = 1;
      frame.transforms.set([1.5, 0.75, -0.5], middle!.index * 8);
      renderer.update(frame);
      for (const { fragment } of leaves) expect(inside.getVisibleAt(slotOf(fragment.id))).toBe(false);
      frame = { ...frame, tick: 2, states: frame.states.slice() };
      frame.states[left!.index] = FragmentState.Retired;
      renderer.update(frame);
      expect(inside.getVisibleAt(slotOf(left!.fragment.id))).toBe(false);
      expect(inside.getVisibleAt(slotOf(middle!.fragment.id))).toBe(true);
      for (const { fragment } of far) expect(inside.getVisibleAt(slotOf(fragment.id))).toBe(false);
      const transform = new Matrix4();
      inside.getMatrixAt(slotOf(middle!.fragment.id), transform);
      expect(new Vector3().setFromMatrixPosition(transform).toArray()).toEqual([1.5, 0.75, -0.5]);
      frame = { ...frame, tick: 3, states: frame.states.slice() };
      frame.states[left!.index] = FragmentState.Supported;
      renderer.update(frame);
      expect(inside.getVisibleAt(slotOf(middle!.fragment.id))).toBe(false);
    } finally {
      renderer.dispose();
      exterior.dispose();
      fracture.dispose();
    }
  });

  it('disposes generated resources once while preserving borrowed materials', () => {
    const borrowed = new MeshBasicMaterial();
    const borrowedDispose = vi.spyOn(borrowed, 'dispose');
    const renderer = new DestructionRenderer(fixture(), { materialFor: (_, surface) => surface === 'exterior' ? borrowed : undefined });
    const batches = primary(renderer);
    const geometries = batches.map(mesh => vi.spyOn(mesh.geometry, 'dispose'));
    const generated = batches.find(mesh => mesh.material !== borrowed)!.material;
    if (Array.isArray(generated)) throw new Error('Expected a single material batch');
    const generatedDispose = vi.spyOn(generated, 'dispose');
    renderer.dispose();
    renderer.dispose();
    expect(renderer.group.children).toHaveLength(0);
    for (const dispose of geometries) expect(dispose).toHaveBeenCalledTimes(1);
    expect(generatedDispose).toHaveBeenCalledTimes(1);
    expect(borrowedDispose).not.toHaveBeenCalled();
    expect(() => renderer.update()).toThrow('disposed');
    borrowed.dispose();
  });
});
