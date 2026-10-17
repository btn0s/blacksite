import { expect, it } from 'vitest';
import { GPUTransformPool } from '../../packages/destruction-render/src/gpu-pool';

it('keeps the slot and generation of every kept key when others leave or join', () => {
  const pool = new GPUTransformPool(16);
  try {
    const keys = Array.from({ length: 10 }, (_, i) => `primary:${i}`);
    pool.synchronize(new Set(keys));
    const before = new Map(keys.map(key => [key, pool.slots.get(key)!]));
    const generations = keys.map(key => pool.generationBySlot[before.get(key)!]);
    pool.synchronize(new Set([...keys.slice(2), 'secondary:a', 'secondary:b']));
    for (const [index, key] of keys.entries()) {
      if (index < 2) expect(pool.slots.has(key)).toBe(false);
      else {
        expect(pool.slots.get(key)).toBe(before.get(key));
        expect(pool.generationBySlot[before.get(key)!]).toBe(generations[index]);
      }
    }
    expect(new Set(pool.slots.values()).size).toBe(pool.slots.size);
    expect(() => pool.synchronize(new Set(Array.from({ length: 16 }, (_, i) => `x:${i}`)))).toThrow('capacity');
  } finally { pool.dispose(); }
});
