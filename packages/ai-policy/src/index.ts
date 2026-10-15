import type { PolicyResult, Tick } from '@blacksite/ai-schema';
export type PolicyGateContext<A> = {
  expiresAtTick: Tick;
  fallback(): A;
  featureSchemaVersion: string;
  legal(action: A): boolean;
  maxUncertainty?: number;
  minConfidence?: number;
  modelVersion: string;
  outOfDistribution?: boolean;
  requestedAtTick: Tick;
  resultSnapshotVersion: number;
  snapshotVersion: number;
  tick: Tick;
};
export type PolicyGateResult<A> = {
  accepted: boolean;
  action: A;
  fallbackReason?: string;
  model?: PolicyResult<A>;
};
function allFinite(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (value === null || typeof value !== 'object') {
    return true;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);
  return Object.values(value).every((v) => allFinite(v, seen));
}
export function gatePolicy<A>(
  result: PolicyResult<A> | undefined,
  context: PolicyGateContext<A>,
): PolicyGateResult<A> {
  let reason: string | undefined;
  if (!result) {
    reason = 'model-unavailable';
  } else if (context.tick < context.requestedAtTick || context.tick >= context.expiresAtTick) {
    reason = 'deadline';
  } else if (context.snapshotVersion !== context.resultSnapshotVersion) {
    reason = 'stale-snapshot';
  } else if (
    result.modelVersion !== context.modelVersion ||
    result.featureSchemaVersion !== context.featureSchemaVersion
  ) {
    reason = 'version-mismatch';
  } else if (!allFinite(result)) {
    reason = 'non-finite-output';
  } else if (
    result.confidence < 0 ||
    result.confidence > 1 ||
    result.epistemicUncertainty < 0 ||
    result.epistemicUncertainty > 1
  ) {
    reason = 'out-of-range';
  } else if (context.outOfDistribution) {
    reason = 'out-of-distribution';
  } else if (
    result.epistemicUncertainty > (context.maxUncertainty ?? 0.25) ||
    result.confidence < (context.minConfidence ?? 0.65)
  ) {
    reason = 'uncertain';
  } else {
    try {
      if (!context.legal(result.action)) {
        reason = 'constraint-violation';
      }
    } catch {
      reason = 'invalid-output';
    }
  }
  if (reason) {
    const action = context.fallback();
    if (!allFinite(action) || !context.legal(action)) {
      throw new Error(`Unsafe symbolic fallback after ${reason}`);
    }
    return { accepted: false, action, fallbackReason: reason };
  }
  return { accepted: true, action: result!.action, model: result };
}
export type ModelManifest = {
  cohort: string;
  featureSchemaVersion: string;
  immutable: true;
  maps: Array<string>;
  sha256: string;
  version: string;
};
export interface PolicyAdapter<A> {
  dispose(): void;
  infer(features: Readonly<Float32Array>, tick: Tick): Promise<PolicyResult<A>>;
  readonly manifest: ModelManifest;
}
