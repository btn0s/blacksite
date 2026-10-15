import type { DecisionSnapshot, WatchSector } from '@blacksite/ai-schema';
export function assignmentWatch(snapshot: DecisionSnapshot): WatchSector | undefined {
  const { assignment, self, tick } = snapshot,
    watch = assignment?.watchSector;
  if (
    !watch ||
    !self.alive ||
    assignment?.agentId !== self.id ||
    !watch.id ||
    !Number.isSafeInteger(watch.issuedAt) ||
    !Number.isSafeInteger(watch.expiresAt) ||
    watch.issuedAt > tick ||
    watch.expiresAt <= tick ||
    watch.expiresAt <= watch.issuedAt ||
    !Object.values(watch.lookAt).every(Number.isFinite) ||
    Math.abs(watch.lookAt.x) > snapshot.map.width / 2 ||
    Math.abs(watch.lookAt.z) > snapshot.map.depth / 2 ||
    !snapshot.friends.some(
      (friend) => friend.id === watch.casualtyId && friend.team === self.team && !friend.alive,
    ) ||
    !watch.observationProvenance.every((id) => typeof id === 'string' && id.length > 0) ||
    (watch.source === 'radio'
      ? watch.observationProvenance.length === 0
      : watch.source !== 'team-status' || watch.observationProvenance.length !== 0)
  ) {
    return undefined;
  }
  return watch;
}
