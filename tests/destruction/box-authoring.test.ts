import { expect, it, vi } from 'vitest';
import { createDestructibleBoxes, DESTRUCTION_MATERIALS } from '../../packages/destruction-authoring/src/boxes';
import { validateManifest } from '../../packages/destruction-authoring/src/index';

it('authors stable convex fragments and source IDs independent of input order', () => {
  const boxes = [
    { id: 'wood', min: [0, 0, 0] as [number, number, number], max: [1.4, 2, .4] as [number, number, number], material: 5, anchored: true },
    { id: 'steel', min: [2, 0, 0] as [number, number, number], max: [3, 2, .3] as [number, number, number], material: 6, anchored: true },
  ];
  const first = createDestructibleBoxes(boxes, { id: 'cover' });
  const second = createDestructibleBoxes([...boxes].reverse(), { id: 'cover' });
  expect(first).toEqual(second);
  expect(validateManifest(first.manifest).valid).toBe(true);
  expect(first.manifest.fragments.filter(fragment => fragment.depth === 2).every(fragment => fragment.shape)).toBe(true);
  expect(new Set(first.fragmentSource.values())).toEqual(new Set(['steel', 'wood']));
  expect(first.manifest.fragments.some(fragment => !fragment.anchored)).toBe(true);
  expect(DESTRUCTION_MATERIALS.find(material => material.id === 6)?.name).toBe('Structural steel');
});

it('bounds default authoring while preserving explicit resolution and unsupported physics', () => {
  const box = { id: 'floating', min: [0, 3, 0] as [number, number, number], max: [8, 4, 8] as [number, number, number], material: 0 };
  const { manifest } = createDestructibleBoxes([box], { id: 'bounded', maxFragments: 16 });
  expect(manifest.fragments.filter(fragment => fragment.depth === 2).length).toBeLessThanOrEqual(16);
  expect(manifest.fragments.every(fragment => !fragment.anchored)).toBe(true);
  expect(validateManifest(manifest, { requireSupported: false }).valid).toBe(true);
  expect(() => createDestructibleBoxes([box], { id: 'too-fine', cellSize: .5, maxFragments: 16 })).toThrow(/exceeds/);
  expect(() => createDestructibleBoxes([box, box], { id: 'duplicate' })).toThrow(/duplicate/);
});

it('keeps fragment identities and manifest hashes identical across locale collation orders', () => {
  const english = new Intl.Collator('en');
  const swedish = new Intl.Collator('sv');
  expect(Math.sign(english.compare('ä', 'z'))).not.toBe(Math.sign(swedish.compare('ä', 'z')));
  const boxes = ['ä', 'z', 'Å'].map((id, index) => ({
    id, min: [index * 2, 0, 0] as [number, number, number],
    max: [index * 2 + 1, 1, 1] as [number, number, number], material: 0,
  }));
  const compare = vi.spyOn(String.prototype, 'localeCompare');
  let first: ReturnType<typeof createDestructibleBoxes>;
  let second: ReturnType<typeof createDestructibleBoxes>;
  try {
    compare.mockImplementation(function (this: string, other: string) { return english.compare(this, other); });
    first = createDestructibleBoxes(boxes, { id: 'locale-stable', cellSize: 1 });
    compare.mockImplementation(function (this: string, other: string) { return swedish.compare(this, other); });
    second = createDestructibleBoxes([...boxes].reverse(), { id: 'locale-stable', cellSize: 1 });
  } finally {
    compare.mockRestore();
  }
  expect(first).toEqual(second);
  expect([...new Set(first.fragmentSource.values())]).toEqual(['z', 'Å', 'ä']);
});
