import type { BeliefTrack, Observation, SquadMessage, Tick } from '@blacksite/ai-schema';
import { TICK_RATE } from '@blacksite/ai-schema';
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const finitePosition = (o: Observation) =>
  [
    o.position.x,
    o.position.y,
    o.position.z,
    o.confidence,
    o.uncertainty,
    o.observedAt,
    o.receivedAt,
    o.expiresAt,
    ...(o.velocity ? [o.velocity.x, o.velocity.y, o.velocity.z] : []),
  ].every(Number.isFinite);
export class BeliefStore {
  private tracks = new Map<string, BeliefTrack>();
  private seen = new Map<string, Tick>();
  private _version = 0;
  constructor(readonly observerId: string) {}
  get version() {
    return this._version;
  }
  integrate(observations: ReadonlyArray<Observation>, tick: Tick): void {
    this.advance(tick);
    for (const o of [...observations].sort(
      (a, b) => a.observedAt - b.observedAt || a.id.localeCompare(b.id),
    )) {
      if (
        o.observerId !== this.observerId ||
        !finitePosition(o) ||
        o.uncertainty < 0 ||
        o.observedAt > o.receivedAt ||
        o.receivedAt > tick ||
        o.expiresAt <= tick ||
        this.seen.has(o.id)
      ) {
        continue;
      }
      const root = o.parentId ?? o.id;
      if (this.seen.has(root)) {
        this.seen.set(o.id, o.expiresAt);
        continue;
      }
      this.seen.set(o.id, o.expiresAt);
      this.seen.set(root, o.expiresAt);
      const key = o.subjectId ? `subject:${o.subjectId}` : `region:${o.regionId ?? o.id}`;
      const prior = this.tracks.get(key);
      if (prior && o.observedAt < prior.lastObservedAt) {
        continue;
      }
      const age = (tick - o.observedAt) / TICK_RATE;
      const confidence = clamp(o.confidence) * Math.exp(-age * 0.12);
      const uncertainty = Math.max(0.08, o.uncertainty + age * 1.7);
      const gain = prior
        ? Math.min(0.85, confidence / Math.max(0.01, confidence + prior.confidence))
        : 1;
      const precise = o.source === 'vision' && confidence > 0.55;
      const blend = precise ? 1 : gain;
      const p = prior?.meanPosition ?? o.position;
      const position = {
        x: p.x + (o.position.x - p.x) * blend,
        y: p.y + (o.position.y - p.y) * blend,
        z: p.z + (o.position.z - p.z) * blend,
      };
      const variance = uncertainty * uncertainty;
      this.tracks.set(key, {
        classification:
          o.classification === 'unknown' && prior ? prior.classification : o.classification,
        confidence: Math.max(confidence, prior ? prior.confidence * 0.98 : 0),
        covariance: [variance, 0, 0, variance, 0, variance],
        expiresAt: o.expiresAt,
        firstObservedAt: prior?.firstObservedAt ?? o.observedAt,
        id: key,
        lastObservedAt: o.observedAt,
        lastUpdatedAt: tick,
        meanPosition: position,
        meanVelocity: precise && o.velocity ? { ...o.velocity } : { x: 0, y: 0, z: 0 },
        possibleRegions: [
          ...new Set([...(prior?.possibleRegions ?? []), ...(o.regionId ? [o.regionId] : [])]),
        ],
        provenance: [...new Set([...(prior?.provenance ?? []), root, o.id])].slice(-16),
        provenanceId: o.id,
        receivedAt: o.receivedAt,
        source: o.source,
        subjectId: o.subjectId,
        uncertaintyRadius: uncertainty,
      });
      this._version++;
    }
  }
  advance(tick: Tick): void {
    for (const [id, track] of this.tracks) {
      if (tick <= track.lastUpdatedAt) {
        continue;
      }
      if (track.expiresAt <= tick) {
        this.tracks.delete(id);
        this._version++;
        continue;
      }
      const dt = (tick - track.lastUpdatedAt) / TICK_RATE;
      const elapsed = (tick - track.lastObservedAt) / TICK_RATE;
      const prediction = Math.min(dt, Math.max(0, 0.7 - Math.max(0, elapsed - dt)));
      track.meanPosition = {
        x: track.meanPosition.x + track.meanVelocity.x * prediction,
        y: track.meanPosition.y,
        z: track.meanPosition.z + track.meanVelocity.z * prediction,
      };
      track.confidence *= Math.exp(-dt * 0.12);
      track.uncertaintyRadius += dt * 1.7;
      const v = track.uncertaintyRadius ** 2;
      track.covariance = [v, 0, 0, v, 0, v];
      track.lastUpdatedAt = tick;
      this._version++;
    }
    for (const [id, expiry] of this.seen) {
      if (expiry < tick - TICK_RATE * 60) {
        this.seen.delete(id);
      }
    }
  }
  snapshot(): Array<BeliefTrack> {
    return [...this.tracks.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((t) => ({
        ...t,
        covariance: [...t.covariance],
        meanPosition: { ...t.meanPosition },
        meanVelocity: { ...t.meanVelocity },
        possibleRegions: [...t.possibleRegions],
        provenance: [...t.provenance],
      }));
  }
}
export type RadioOptions = {
  bandwidthTicks?: number;
  latencyTicks: number;
  lossRate?: number;
  maxQueue?: number;
};
export class RadioNetwork {
  private queue: Array<SquadMessage> = [];
  private nextFree = new Map<string, number>();
  private seen = new Set<string>();
  constructor(readonly options: RadioOptions) {}
  get pendingCount() {
    return this.queue.length;
  }
  send(message: SquadMessage, tick: Tick, random: number): boolean {
    if (
      this.seen.has(message.id) ||
      !Number.isFinite(random) ||
      message.sentAt > tick ||
      message.expiresAt <= tick
    ) {
      return false;
    }
    this.seen.add(message.id);
    if (random < (this.options.lossRate ?? 0.04)) {
      return false;
    }
    const maxQueue = this.options.maxQueue ?? 64;
    if (this.queue.length >= maxQueue) {
      const least = this.queue.reduce((a, b) => (a.urgency <= b.urgency ? a : b));
      if (least.urgency >= message.urgency) {
        return false;
      }
      this.queue = this.queue.filter((m) => m.id !== least.id);
    }
    const start = Math.max(tick, this.nextFree.get(message.team) ?? tick);
    const deliverAt = start + Math.max(1, this.options.latencyTicks);
    if (deliverAt >= message.expiresAt) {
      return false;
    }
    this.nextFree.set(message.team, start + Math.max(1, this.options.bandwidthTicks ?? 3));
    this.queue.push({ ...structuredClone(message), deliverAt, sentAt: tick });
    return true;
  }
  deliver(tick: Tick): Array<SquadMessage> {
    const ready = this.queue
      .filter((m) => m.deliverAt <= tick && m.expiresAt > tick)
      .sort(
        (a, b) => a.deliverAt - b.deliverAt || b.urgency - a.urgency || a.id.localeCompare(b.id),
      );
    this.queue = this.queue.filter((m) => m.deliverAt > tick && m.expiresAt > tick);
    return ready;
  }
}
