import type { DecisionSnapshot, Reservation, TacticalCandidate, Tick } from '@blacksite/ai-schema';
import { distance, distanceToSegment, tacticalPathCosts, isWalkable } from '@blacksite/ai-nav';
export class ReservationTable {
  private leases = new Map<string, Reservation>();
  private deferred = new Map<string, Tick>();
  claim(
    resourceId: string,
    ownerId: string,
    tick: Tick,
    leaseTicks = 30,
    kind: Reservation['kind'] = 'slot',
  ): boolean {
    this.expire(tick);
    if (!resourceId || !ownerId || !Number.isFinite(leaseTicks) || leaseTicks <= 0) {
      return false;
    }
    const current = this.leases.get(resourceId);
    if (!this.eligible(resourceId, ownerId, tick) || (current && current.ownerId !== ownerId)) {
      return false;
    }
    this.leases.set(resourceId, { expiresAt: tick + leaseTicks, kind, ownerId, resourceId });
    return true;
  }
  eligible(resourceId: string, ownerId: string, tick: Tick): boolean {
    return (this.deferred.get(`${resourceId}\0${ownerId}`) ?? -Infinity) <= tick;
  }
  defer(resourceId: string, ownerId: string, tick: Tick, cooldownTicks: number): void {
    this.release(resourceId, ownerId);
    this.deferred.set(`${resourceId}\0${ownerId}`, tick + cooldownTicks);
  }
  available(resourceId: string, ownerId: string, tick: Tick): boolean {
    const current = this.leases.get(resourceId);
    return (
      this.eligible(resourceId, ownerId, tick) &&
      (!current || current.expiresAt <= tick || current.ownerId === ownerId)
    );
  }
  release(resourceId: string, ownerId: string): void {
    if (this.leases.get(resourceId)?.ownerId === ownerId) {
      this.leases.delete(resourceId);
    }
  }
  releaseOwner(ownerId: string): void {
    for (const [id, lease] of this.leases) {
      if (lease.ownerId === ownerId) {
        this.leases.delete(id);
      }
    }
  }
  expire(tick: Tick): void {
    for (const [id, lease] of this.leases) {
      if (lease.expiresAt <= tick) {
        this.leases.delete(id);
      }
    }
    for (const [id, expiry] of this.deferred) {
      if (expiry <= tick) {
        this.deferred.delete(id);
      }
    }
  }
  snapshot(): Array<Reservation> {
    return [...this.leases.values()]
      .sort((a, b) => a.resourceId.localeCompare(b.resourceId))
      .map((r) => ({ ...r }));
  }
}
export function scorePositions(
  snapshot: DecisionSnapshot,
  reservations: ReservationTable,
): Array<TacticalCandidate> {
  const { assignment, beliefs, map, order, self, tick } = snapshot;
  const pathCosts = tacticalPathCosts(map, self.position);
  const contacts = beliefs.filter(
    (t) => t.classification === 'enemy' && t.confidence > 0.2 && t.expiresAt > tick,
  );
  return map.nodes
    .map<TacticalCandidate>((node) => {
      const base = { id: `slot:${node.id}`, nodeId: node.id, position: { ...node.position } };
      let rejectReason: string | undefined;
      if (!isWalkable(map, node.position)) {
        rejectReason = 'not-traversable';
      } else if (!reservations.available(node.id, self.id, tick)) {
        rejectReason = 'reserved';
      } else if (
        snapshot.friends.some(
          (f) => f.id !== self.id && f.alive && distance(f.position, node.position) < 0.65,
        )
      ) {
        rejectReason = 'friendly-occupied';
      } else if (
        contacts.some((t) =>
          snapshot.friends.some(
            (f) =>
              f.id !== self.id &&
              f.alive &&
              distanceToSegment(node.position, f.position, t.meanPosition) < 0.45 &&
              distance(f.position, node.position) > 1.3,
          ),
        )
      ) {
        rejectReason = 'friendly-firing-lane';
      }
      if (rejectReason) {
        return { ...base, applicable: false, rejectReason };
      }
      const travel = pathCosts.get(node.id) ?? Infinity;
      if (!Number.isFinite(travel)) {
        return { ...base, applicable: false, rejectReason: 'unreachable' };
      }
      const threat = contacts.reduce(
        (sum, t) => sum + t.confidence / (1 + distance(t.meanPosition, node.position) * 0.13),
        0,
      );
      const terms = {
        commitment: assignment
          ? node.id === assignment.slotId
            ? 4
            : -distance(node.position, assignment.position) * 0.15
          : 0,
        congestion:
          -snapshot.friends.filter(
            (f) => f.id !== self.id && distance(f.position, node.position) < 3,
          ).length * 0.4,
        cover: node.cover * 3,
        exposure: -node.exposure * (1 + threat) * 2,
        fireQuality: contacts.length
          ? Math.max(0, 1 - Math.abs(distance(contacts[0]!.meanPosition, node.position) - 14) / 24)
          : 0,
        objective: order ? 5 / (1 + distance(node.position, order.objective) * 0.08) : 0,
        travel: -travel * 0.09,
        uncertainty:
          node.kind === 'search'
            ? contacts.reduce((s, t) => s + t.uncertaintyRadius * 0.025, 0)
            : 0,
      };
      return {
        ...base,
        applicable: true,
        score: Object.values(terms).reduce((a, b) => a + b, 0),
        terms,
      };
    })
    .sort(
      (a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || a.nodeId.localeCompare(b.nodeId),
    );
}
