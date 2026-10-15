import { expect, test } from 'vitest';
import { checkBoundaries } from '../scripts/check-boundaries';
import { isCommand, isConfig, parseRequest } from '@blacksite/ai-worker';
import { DEFAULT_CONFIG } from '@blacksite/ai-schema';
import { identificationInterval, assertNoDatasetLeakage } from '@blacksite/training';

test('cognition and presentation cannot import simulation authority', async () => {
  expect(await checkBoundaries()).toEqual([]);
});
test('worker boundary rejects poison, invalid config, and unbounded workload', () => {
  expect(isConfig(DEFAULT_CONFIG)).toBe(true);
  expect(isConfig({ ...DEFAULT_CONFIG, agentsPerTeam: 100 })).toBe(false);
  expect(isConfig({ ...DEFAULT_CONFIG, seed: NaN })).toBe(false);
  expect(isCommand({ move: { x: NaN, y: 0 } })).toBe(false);
  expect(() => parseRequest({ type: 'step', count: 1e9 })).toThrow();
  expect(() => parseRequest({ type: 'play', speed: Infinity })).toThrow();
  expect(() => parseRequest(null)).toThrow();
});
test('identification reports interval uncertainty rather than inventing validation', () => {
  expect(identificationInterval(50, 100).includesChance).toBe(true);
  expect(identificationInterval(90, 100).includesChance).toBe(false);
  expect(identificationInterval(0, 1).upper).toBeGreaterThan(.5);
  expect(() => identificationInterval(1, 0)).toThrow();
});
test('training partitions reject reused participant, match, and map identities', () => {
  const valid = { train: { participants: ['a'], matches: ['a'], maps: ['a'] }, validation: { participants: ['b'], matches: ['b'], maps: ['b'] }, test: { participants: ['c'], matches: ['c'], maps: ['c'] } };
  expect(() => assertNoDatasetLeakage(valid)).not.toThrow();
  for (const axis of ['participants', 'matches', 'maps'] as const) {
    const invalid = structuredClone(valid); invalid.test[axis].push('a');
    expect(() => assertNoDatasetLeakage(invalid)).toThrow(/leakage/);
  }
});
