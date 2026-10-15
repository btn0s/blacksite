import type {
  Observation,
  SelfState,
  SimEvent,
  Stance,
  TacticalMap,
  Vec3,
} from '@blacksite/ai-schema';
import { clamp, distance, lineClear, quantize, randomAt, wrapAngle } from './math';
const eyeHeight = (stance: Stance) =>
  stance === 'stand' ? 1.5 : stance === 'crouch' ? 0.93 : 0.35;
export type ObservationLineOfSightContext = {
  kind: 'vision' | 'sound';
  observerId: string;
  subjectId?: string;
};
export type ObservationGeneratorOptions = {
  lineOfSight?: (
    from: Readonly<Vec3>,
    to: Readonly<Vec3>,
    context: ObservationLineOfSightContext,
  ) => boolean;
  map: Readonly<TacticalMap>;
  seed: number;
};
type ShotEvidence = Pick<SimEvent, 'id' | 'tick' | 'agentId'>;
export class ObservationGenerator {
  private readonly recognition = new Map<string, number>();
  private readonly observationLedger = new Map<string, Observation>();
  private observationTick = -1;
  private cachedObservations = new Map<string, Array<Observation>>();
  private pendingSounds: Array<{
    event: ShotEvidence;
    sourcePosition: Vec3;
  }> = [];
  private pendingDamage = new Map<
    string,
    Array<{
      attacker: Vec3;
      tick: number;
    }>
  >();
  private disposed = false;
  constructor(private readonly options: ObservationGeneratorOptions) {}
  recordShot(event: ShotEvidence, sourcePosition: Readonly<Vec3>): void {
    this.assertActive();
    this.pendingSounds.push({ event: { ...event }, sourcePosition: { ...sourcePosition } });
  }
  recordDamage(observerId: string, attackerPosition: Readonly<Vec3>, tick: number): void {
    this.assertActive();
    const damage = this.pendingDamage.get(observerId) ?? [];
    damage.push({ attacker: { ...attackerPosition }, tick });
    this.pendingDamage.set(observerId, damage);
  }
  observation(id: string): Observation | undefined {
    this.assertActive();
    const evidence = this.observationLedger.get(id);
    return evidence && structuredClone(evidence);
  }
  generate(tick: number, states: ReadonlyArray<SelfState>): Map<string, Array<Observation>> {
    this.assertActive();
    if (!Number.isInteger(tick) || tick < 0 || tick < this.observationTick) {
      throw new Error('Observation ticks must be nonnegative and monotonic');
    }
    if (this.observationTick === tick) {
      return structuredClone(this.cachedObservations);
    }
    const result = new Map<string, Array<Observation>>();
    for (const observer of states) {
      const evidence: Array<Observation> = [];
      result.set(observer.id, evidence);
      if (!observer.alive) {
        continue;
      }
      const eye = { ...observer.position, y: observer.position.y + eyeHeight(observer.stance) };
      for (const subject of states) {
        if (!subject.alive || subject.team === observer.team) {
          continue;
        }
        const key = `${observer.id}/${subject.id}`;
        const range = Math.hypot(
          observer.position.x - subject.position.x,
          observer.position.y - subject.position.y,
          observer.position.z - subject.position.z,
        );
        const angle = Math.abs(
          wrapAngle(
            Math.atan2(subject.position.x - eye.x, subject.position.z - eye.z) - observer.yaw,
          ),
        );
        const target = { ...subject.position, y: subject.position.y + eyeHeight(subject.stance) };
        const pitchAngle = Math.abs(
          Math.atan2(target.y - eye.y, distance(eye, target)) - observer.pitch,
        );
        const visible =
          range <= 37 &&
          angle <= Math.PI * 0.43 &&
          pitchAngle <= Math.PI * 0.33 &&
          this.lineOfSight(eye, target, {
            kind: 'vision',
            observerId: observer.id,
            subjectId: subject.id,
          });
        const previous = this.recognition.get(key) ?? 0;
        const attentionWeight = angle < 0.42 ? 1 : 0.5;
        const confidence = visible
          ? Math.min(
              1,
              previous +
                (0.18 + observer.skill.perception * 0.2) *
                  attentionWeight *
                  clamp(1.1 - range / 65, 0.35, 1),
            )
          : Math.max(0, previous - 0.16);
        this.recognition.set(key, confidence);
        if (!visible || confidence < 0.4) {
          continue;
        }
        const uncertainty = 0.12 + (1 - confidence) * 1.25 + range * 0.006;
        const noise = (dimension: number) =>
          (randomAt(this.options.seed, key, tick, dimension) - 0.5) * uncertainty;
        const observation: Observation = {
          classification: confidence >= 0.63 ? 'enemy' : 'unknown',
          confidence: quantize(confidence),
          expiresAt: tick + 150,
          id: `vision:${tick}:${observer.id}:${subject.id}`,
          observedAt: tick,
          observerId: observer.id,
          position: {
            x: quantize(subject.position.x + noise(0)),
            y: target.y,
            z: quantize(subject.position.z + noise(1)),
          },
          receivedAt: tick,
          regionId: this.closestRegion(subject.position),
          source: 'vision',
          subjectId: confidence >= 0.63 ? subject.id : undefined,
          uncertainty,
          velocity:
            confidence >= 0.8
              ? {
                  x: quantize(subject.velocity.x + noise(2) * 0.2),
                  y: quantize(subject.velocity.y),
                  z: quantize(subject.velocity.z + noise(3) * 0.2),
                }
              : undefined,
        };
        evidence.push(observation);
      }
      for (const { event, sourcePosition } of this.pendingSounds) {
        if (event.agentId === observer.id || event.tick > tick) {
          continue;
        }
        const range = distance(observer.position, sourcePosition);
        if (range > 32) {
          continue;
        }
        const clear = this.lineOfSight(
          eye,
          { ...sourcePosition, y: sourcePosition.y + 1.4 },
          { kind: 'sound', observerId: observer.id, subjectId: event.agentId },
        );
        const uncertainty = 2 + range * 0.12 + (clear ? 0 : 3);
        const bearing =
          Math.atan2(sourcePosition.x - eye.x, sourcePosition.z - eye.z) +
          (randomAt(this.options.seed, observer.id, event.tick, event.id.length) - 0.5) * 0.55;
        const perceivedRange = Math.max(
          2,
          range +
            (randomAt(this.options.seed, event.id + observer.id, event.tick) - 0.5) *
              uncertainty *
              2,
        );
        const observedPosition = {
          x: quantize(eye.x + Math.sin(bearing) * perceivedRange),
          y: observer.position.y + 1.3,
          z: quantize(eye.z + Math.cos(bearing) * perceivedRange),
        };
        evidence.push({
          classification: 'unknown',
          confidence: clear ? 0.48 : 0.3,
          expiresAt: tick + 90,
          id: `sound:${event.id}:${observer.id}`,
          observedAt: event.tick,
          observerId: observer.id,
          position: observedPosition,
          receivedAt: tick,
          regionId: this.closestRegion(observedPosition),
          source: 'sound',
          uncertainty,
        });
      }
      for (const damage of this.pendingDamage.get(observer.id) ?? []) {
        if (damage.tick > tick) {
          continue;
        }
        const angle =
          Math.atan2(damage.attacker.x - eye.x, damage.attacker.z - eye.z) +
          (randomAt(this.options.seed, observer.id + ':damage', damage.tick) - 0.5) * 0.7;
        evidence.push({
          classification: 'unknown',
          confidence: 0.55,
          expiresAt: tick + 90,
          id: `damage:${damage.tick}:${observer.id}`,
          observedAt: damage.tick,
          observerId: observer.id,
          position: {
            x: eye.x + Math.sin(angle) * 12,
            y: observer.position.y + 1.4,
            z: eye.z + Math.cos(angle) * 12,
          },
          receivedAt: tick,
          source: 'damage',
          uncertainty: 6,
        });
      }
      for (const observation of evidence) {
        this.observationLedger.set(observation.id, structuredClone(observation));
      }
    }
    this.pendingSounds = this.pendingSounds.filter((sound) => sound.event.tick > tick);
    for (const [id, damage] of this.pendingDamage) {
      const future = damage.filter((event) => event.tick > tick);
      if (future.length) {
        this.pendingDamage.set(id, future);
      } else {
        this.pendingDamage.delete(id);
      }
    }
    for (const [id, evidence] of this.observationLedger) {
      if (evidence.expiresAt < tick - 300) {
        this.observationLedger.delete(id);
      }
    }
    this.observationTick = tick;
    this.cachedObservations = structuredClone(result);
    return result;
  }
  dispose(): void {
    this.disposed = true;
    this.recognition.clear();
    this.observationLedger.clear();
    this.cachedObservations.clear();
    this.pendingSounds = [];
    this.pendingDamage.clear();
  }
  private lineOfSight(from: Vec3, to: Vec3, context: ObservationLineOfSightContext): boolean {
    return this.options.lineOfSight
      ? this.options.lineOfSight(from, to, context)
      : lineClear(this.options.map, from, to);
  }
  private closestRegion(point: Vec3): string {
    return (
      [...this.options.map.regions].sort(
        (a, b) => distance(a.center, point) - distance(b.center, point),
      )[0]?.id ?? 'unknown'
    );
  }
  private assertActive(): void {
    if (this.disposed) {
      throw new Error('Observation generator is disposed');
    }
  }
}
