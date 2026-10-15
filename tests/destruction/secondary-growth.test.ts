import { BatchedMesh, BoxGeometry, Color, Matrix4, MeshBasicMaterial } from 'three';
import { expect, it, vi } from 'vitest';
import { FragmentState, type SecondaryFractureFrame } from '../../packages/destruction-domain/src';
import { GPUTransformPool, PooledBatchedMesh } from '../../packages/destruction-render/src/gpu-pool';
import { SecondaryFragmentRenderer } from '../../packages/destruction-render/src/secondary';

function frame(count: number, revision: number): SecondaryFractureFrame {
  return {
    revision,
    fragments: Array.from({ length: count }, (_, id) => ({ id: id + 100, parentId: 0, rootId: 0, generation: 1,
      mass: 1, aggregate: 0, anchored: false, material: 0, region: 0, position: [0, 0, 0], size: [1, 1, 1] })),
    states: new Uint8Array(count).fill(FragmentState.Dynamic),
    transforms: new Float32Array(Array.from({ length: count }, (_, i) => [i, 2, 0, 0, 0, 0, 1, 1]).flat()),
  };
}

it('grows a pooled batch without disposing or modifying shared transform/color textures', () => {
  const pool = new GPUTransformPool(32), material = new MeshBasicMaterial();
  const mesh = new PooledBatchedMesh(pool, 2, 128, material);
  const box = new BoxGeometry().toNonIndexed();
  try {
    const instance = mesh.addInstance(mesh.addGeometry(box));
    mesh.bind(instance, 7);
    pool.write(7, new Matrix4().makeTranslation(11, 12, 13));
    pool.writeColor(7, new Color('red'));
    const matrices = Array.from(pool.matrices.image.data!), colors = Array.from(pool.colors.image.data!);
    const matrixDispose = vi.fn(), colorDispose = vi.fn();
    pool.matrices.addEventListener('dispose', matrixDispose);
    pool.colors.addEventListener('dispose', colorDispose);
    mesh.setInstanceCount(32);
    expect(matrixDispose.mock.calls.length).toBe(0);
    expect(colorDispose.mock.calls.length).toBe(0);
    expect(Array.from(pool.matrices.image.data!)).toEqual(matrices);
    expect(Array.from(pool.colors.image.data!)).toEqual(colors);
    expect(mesh.getMatrixAt(instance, new Matrix4()).elements.slice(12, 15)).toEqual([11, 12, 13]);
    const added = mesh.addInstance(mesh.addGeometry(box));
    mesh.bind(added, 9);
    mesh.setMatrixAt(added, new Matrix4().makeTranslation(21, 22, 23));
    expect(mesh.getMatrixAt(instance, new Matrix4()).elements.slice(12, 15)).toEqual([11, 12, 13]);
    expect(mesh.getMatrixAt(added, new Matrix4()).elements.slice(12, 15)).toEqual([21, 22, 23]);
    mesh.dispose();
    expect(matrixDispose.mock.calls.length).toBe(0);
    expect(colorDispose.mock.calls.length).toBe(0);
  } finally { box.dispose(); pool.dispose(); material.dispose(); }
});

it('keeps existing debris surfaces and instance IDs when capacity grows', () => {
  const material = new MeshBasicMaterial();
  const renderer = new SecondaryFragmentRenderer(() => material);
  try {
    renderer.update(frame(32, 1), undefined, 1);
    const mesh = renderer.group.children[0] as BatchedMesh;
    const nextCount = mesh.maxInstanceCount + 1;
    const add = vi.spyOn(BatchedMesh.prototype, 'addGeometry');
    const dispose = vi.spyOn(BatchedMesh.prototype, 'dispose');
    try {
      renderer.update(frame(nextCount, 2), undefined, 1);
      expect(add.mock.calls.length).toBe(nextCount - 32);
      expect(dispose.mock.calls.length).toBe(0);
      expect(renderer.group.children[0]).toBe(mesh);
      expect(mesh.userData.fragmentIds.slice(0, 32)).toEqual(Array.from({ length: 32 }, (_, i) => i + 100));
      expect(mesh.getMatrixAt(17, new Matrix4()).elements.slice(12, 15)).toEqual([17, 2, 0]);
    } finally { add.mockRestore(); dispose.mockRestore(); }
  } finally { renderer.dispose(); material.dispose(); }
});
