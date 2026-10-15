import { describe, expect, it } from 'vitest';
import type { DestructibleManifest, ScenarioId } from '../../packages/destruction-domain/src';
import { createOrganicScenario, createScenario, hashManifest } from '../../packages/destruction-testkit/src';
import { hashOrganicManifest } from '../../packages/destruction-testkit/src/organic';

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).reverse().map(([key, entry]) => [key, reverseObjectKeys(entry)]));
}

const currentIdentities: Array<[ScenarioId, string]> = [
  ['building', 'cascade-v1-c5905694'],
  ['wall', 'cascade-v1-6efbda51'],
  ['cantilever', 'cascade-v1-7ab33fb5'],
  ['bridge', 'cascade-v1-2e0dc889'],
  ['complex', 'cascade-v1-9caff9da'],
];

describe('manifest identity compatibility', () => {
  it.each(currentIdentities)('preserves current %s identity after deep object key reordering', (scenario, expected) => {
    const { assetHash, ...content } = createScenario(scenario);
    expect(assetHash).toBe(expected);
    const reordered = reverseObjectKeys(content) as Omit<DestructibleManifest, 'assetHash'>;
    const hash = scenario === 'complex' ? hashOrganicManifest : hashManifest;
    expect(hash(reordered)).toBe(expected);
    expect(hash(content)).toBe(expected);
  });

  it('retains the original organic identity while including shape, section, and material changes', () => {
    const { assetHash, ...content } = createOrganicScenario('building');
    expect(assetHash).toBe('cascade-v1-f4545d13');
    const reordered = reverseObjectKeys(content) as Omit<DestructibleManifest, 'assetHash'>;
    expect(hashOrganicManifest(reordered)).toBe(assetHash);
    const changedShape = structuredClone(reordered);
    changedShape.fragments[0]!.shape!.volume += 0.001;
    expect(hashOrganicManifest(changedShape)).not.toBe(assetHash);
    const changedSection = structuredClone(reordered);
    changedSection.bonds[0]!.section!.inertia1 += 0.001;
    expect(hashOrganicManifest(changedSection)).not.toBe(assetHash);
    const changedMaterial = structuredClone(reordered);
    changedMaterial.materials[0]!.density += 1;
    expect(hashOrganicManifest(changedMaterial)).not.toBe(assetHash);
  });
});
