import { expect, test } from 'vitest';
import { Effect, ManagedRuntime } from 'effect';
import { ModelRegistryService, signedModelRegistryLayer, signedModelPayload, type ModelDescriptor } from '../packages/ai-services/src/model-registry';
import { VERSIONS } from '@blacksite/ai-schema';

test('model registry rejects tampering, unsigned artifacts, and unapproved map/cohort', async () => {
  const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const artifact = new Uint8Array([1, 2, 3, 4]).buffer;
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', artifact))].map(b => b.toString(16).padStart(2, '0')).join('');
  const descriptor: ModelDescriptor = { version: 'test-model-1', featureSchemaVersion: VERSIONS.featureSchema, sha256, maps: ['test-map'], cohorts: ['test-cohort'], featureCount: 16, maxBytes: 100 };
  const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', keys.privateKey, signedModelPayload(descriptor)));
  const runtime = ManagedRuntime.make(signedModelRegistryLayer(keys.publicKey));
  try {
    await runtime.runPromise(Effect.flatMap(ModelRegistryService, registry => registry.install(descriptor, artifact, signature)));
    const loaded = await runtime.runPromise(Effect.flatMap(ModelRegistryService, registry => registry.load(descriptor.version, 'test-map', 'test-cohort')));
    expect(new Uint8Array(loaded.artifact)).toEqual(new Uint8Array(artifact));
    await expect(runtime.runPromise(Effect.flatMap(ModelRegistryService, r => r.install(descriptor, new Uint8Array([8]).buffer, signature)))).rejects.toThrow('checksum');
    await expect(runtime.runPromise(Effect.flatMap(ModelRegistryService, r => r.install(descriptor, artifact, new Uint8Array(64))))).rejects.toThrow('signature');
    await expect(runtime.runPromise(Effect.flatMap(ModelRegistryService, r => r.load(descriptor.version, 'unseen-map', 'test-cohort')))).rejects.toThrow('Out-of-distribution');
  } finally { await runtime.dispose(); }
});
