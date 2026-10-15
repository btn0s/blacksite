import { VERSIONS, type AgentCommand, type DecisionSnapshot, type PolicyMeta } from '@blacksite/ai-schema';

export type ConsentRecord = { participantId: string; approved: boolean; expiresAt: string; datasetVersion: string };
export type TraceRow = { participantId: string; matchId: string; mapVersion: string; patchVersion: string; features: number[]; command: AgentCommand; featureSchemaVersion: string };
export const FEATURE_NAMES = ['health', 'ammo', 'suppression', 'speed', 'view.sin', 'view.cos', 'contact.distance', 'contact.angle.sin', 'contact.angle.cos', 'contact.confidence', 'contact.uncertainty', 'contact.age', 'goal.dx', 'goal.dz', 'friend.distance', 'maneuver.supportReady'] as const;

/** Accepts only the exact observation snapshot available to the runtime actor. */
export function extractFeatures(snapshot: DecisionSnapshot): number[] {
  const { self } = snapshot;
  const tracks = snapshot.beliefs.filter(t => t.classification === 'enemy' && t.confidence >= .1 && t.expiresAt >= snapshot.tick)
    .slice().sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id));
  const target = tracks[0];
  const dx = target ? target.meanPosition.x - self.position.x : 0;
  const dz = target ? target.meanPosition.z - self.position.z : 0;
  const angle = Math.atan2(dx, dz) - self.yaw;
  const destination = snapshot.assignment?.position ?? snapshot.order?.objective ?? self.position;
  const nearestFriend = snapshot.friends.filter(f => f.id !== self.id && f.alive).reduce((min, f) => Math.min(min, Math.hypot(f.position.x - self.position.x, f.position.z - self.position.z)), 50);
  return [self.health / 100, self.ammo / 30, self.suppression, Math.hypot(self.velocity.x, self.velocity.z) / 5,
    Math.sin(self.yaw), Math.cos(self.yaw), Math.hypot(dx, dz) / 50, target ? Math.sin(angle) : 0, target ? Math.cos(angle) : 0,
    target?.confidence ?? 0, Math.min(1, (target?.uncertaintyRadius ?? 50) / 50), Math.min(1, (target ? snapshot.tick - target.lastObservedAt : 300) / 300),
    (destination.x - self.position.x) / 50, (destination.z - self.position.z) / 50, nearestFriend / 50, snapshot.maneuver?.supportReady ? 1 : 0];
}

export function captureConsentedTrace(consent: ConsentRecord, snapshot: DecisionSnapshot, command: AgentCommand, matchId: string, now: Date): TraceRow {
  if (!consent.approved || !Number.isFinite(Date.parse(consent.expiresAt)) || Date.parse(consent.expiresAt) <= now.getTime()) throw new Error('No current participant consent');
  if (command.source !== 'human') throw new Error('Human imitation datasets must not silently contain bot labels');
  if (command.agentId !== snapshot.self.id || command.tick !== snapshot.tick) throw new Error('Trace observation and command must refer to the same participant and tick');
  const features = extractFeatures(snapshot);
  if (!features.every(Number.isFinite)) throw new Error('Non-finite training features');
  return { participantId: consent.participantId, matchId, mapVersion: snapshot.map.version, patchVersion: VERSIONS.simulation,
    features, command: structuredClone(command), featureSchemaVersion: VERSIONS.featureSchema };
}

export type SplitManifest = Record<'train' | 'validation' | 'test', { participants: string[]; matches: string[]; maps: string[] }>;
export function assertNoDatasetLeakage(manifest: SplitManifest): void {
  for (const axis of ['participants', 'matches', 'maps'] as const) {
    const seen = new Set<string>();
    for (const split of ['train', 'validation', 'test'] as const) for (const value of manifest[split][axis]) {
      if (seen.has(value)) throw new Error(`${axis} leakage: ${value}`); seen.add(value);
    }
  }
}

/** Wilson interval. Chance inclusion alone is NOT an equivalence or power test. */
export function identificationInterval(correct: number, total: number): { accuracy: number; lower: number; upper: number; includesChance: boolean } {
  if (!Number.isInteger(total) || !Number.isInteger(correct) || total < 1 || correct < 0 || correct > total) throw new Error('Invalid identification counts');
  const z = 1.959963984540054, p = correct / total, z2 = z * z;
  const center = (p + z2 / (2 * total)) / (1 + z2 / total);
  const radius = z * Math.sqrt(p * (1 - p) / total + z2 / (4 * total * total)) / (1 + z2 / total);
  return { accuracy: p, lower: center - radius, upper: center + radius, includesChance: center - radius <= .5 && center + radius >= .5 };
}
export type StudyCondition = 'opponent' | 'teammate' | 'replay';
export function evaluateIdentification(results: Record<StudyCondition, { correct: number; total: number }>) {
  return Object.fromEntries(Object.entries(results).map(([condition, counts]) => [condition, identificationInterval(counts.correct, counts.total)]));
}
export type ModelManifest = PolicyMeta & { artifactSha256: string; approvedCohorts: string[]; approvedMaps: string[]; inferenceBudgetMs: number; consentDatasetVersion: string; signature: string };
