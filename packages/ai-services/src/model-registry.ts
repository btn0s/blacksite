import { Context, Data, Effect, Layer } from 'effect';
import { VERSIONS, type PolicyResult } from '@blacksite/ai-schema';
export type ModelDescriptor = Readonly<{
  cohorts: ReadonlyArray<string>;
  featureCount: number;
  featureSchemaVersion: string;
  maps: ReadonlyArray<string>;
  maxBytes: number;
  sha256: string;
  version: string;
}>;
export type VerifiedModel = {
  artifact: ArrayBuffer;
  descriptor: ModelDescriptor;
};
export class ModelError extends Data.TaggedError('ModelError')<{
  reason: string;
}> {
  get message() {
    return this.reason;
  }
}
export function signedModelPayload(descriptor: ModelDescriptor): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    JSON.stringify({
      cohorts: [...descriptor.cohorts].sort(),
      featureCount: descriptor.featureCount,
      featureSchemaVersion: descriptor.featureSchemaVersion,
      maps: [...descriptor.maps].sort(),
      maxBytes: descriptor.maxBytes,
      sha256: descriptor.sha256,
      version: descriptor.version,
    }),
  );
}
export class ModelRegistryService extends Context.Tag('@ce/ModelRegistry')<
  ModelRegistryService,
  {
    install: (
      descriptor: ModelDescriptor,
      artifact: ArrayBuffer,
      signature: Uint8Array<ArrayBuffer>,
    ) => Effect.Effect<void, ModelError>;
    load: (
      version: string,
      map: string,
      cohort: string,
    ) => Effect.Effect<VerifiedModel, ModelError>;
  }
>() {}
export const signedModelRegistryLayer = (trustedKey: CryptoKey) =>
  Layer.sync(ModelRegistryService, () => {
    const models = new Map<string, VerifiedModel>();
    return {
      install: (
        input: ModelDescriptor,
        inputArtifact: ArrayBuffer,
        inputSignature: Uint8Array<ArrayBuffer>,
      ) =>
        Effect.tryPromise({
          catch: (error) =>
            new ModelError({ reason: error instanceof Error ? error.message : String(error) }),
          try: async () => {
            const descriptor = structuredClone(input),
              artifact = inputArtifact.slice(0),
              signature = Uint8Array.from(inputSignature);
            if (
              descriptor.featureSchemaVersion !== VERSIONS.featureSchema ||
              !descriptor.version ||
              descriptor.featureCount < 1 ||
              !Number.isInteger(descriptor.featureCount)
            ) {
              throw new Error('Incompatible model schema');
            }
            if (
              !Number.isSafeInteger(descriptor.maxBytes) ||
              descriptor.maxBytes <= 0 ||
              artifact.byteLength === 0 ||
              artifact.byteLength > Math.min(descriptor.maxBytes, 64 * 1024 * 1024)
            ) {
              throw new Error('Invalid artifact size');
            }
            const digest = await crypto.subtle.digest('SHA-256', artifact);
            const sha256 = [...new Uint8Array(digest)]
              .map((b) => b.toString(16).padStart(2, '0'))
              .join('');
            if (sha256 !== descriptor.sha256) {
              throw new Error('Artifact checksum mismatch');
            }
            if (
              !(await crypto.subtle.verify(
                'Ed25519',
                trustedKey,
                signature,
                signedModelPayload(descriptor),
              ))
            ) {
              throw new Error('Untrusted model signature');
            }
            const existing = models.get(descriptor.version);
            if (existing && JSON.stringify(existing.descriptor) !== JSON.stringify(descriptor)) {
              throw new Error('Model versions are immutable');
            }
            models.set(descriptor.version, { artifact, descriptor: Object.freeze(descriptor) });
          },
        }),
      load: (version: string, map: string, cohort: string) =>
        Effect.try({
          catch: (error) =>
            new ModelError({ reason: error instanceof Error ? error.message : String(error) }),
          try: () => {
            const model = models.get(version);
            if (!model) {
              throw new Error('Model unavailable; use deterministic fallback');
            }
            if (
              !model.descriptor.maps.includes(map) ||
              !model.descriptor.cohorts.includes(cohort)
            ) {
              throw new Error('Out-of-distribution map or cohort');
            }
            return {
              artifact: model.artifact.slice(0),
              descriptor: structuredClone(model.descriptor),
            };
          },
        }),
    };
  });
export class PolicyInferenceService extends Context.Tag('@ce/PolicyInference')<
  PolicyInferenceService,
  {
    infer: (features: Float32Array, signal: AbortSignal) => Promise<PolicyResult<Array<number>>>;
  }
>() {}
export function inferWithDeadline(features: Float32Array, budgetMs: number) {
  return Effect.gen(function* () {
    const service = yield* PolicyInferenceService;
    if (!features.every(Number.isFinite) || !Number.isFinite(budgetMs) || budgetMs <= 0) {
      return yield* Effect.fail(new ModelError({ reason: 'Invalid inference request' }));
    }
    return yield* Effect.tryPromise({
      catch: () => new ModelError({ reason: 'Inference failed' }),
      try: (signal) => service.infer(features.slice(), signal),
    }).pipe(
      Effect.timeoutFail({
        duration: budgetMs,
        onTimeout: () => new ModelError({ reason: 'Inference deadline exceeded' }),
      }),
    );
  });
}
