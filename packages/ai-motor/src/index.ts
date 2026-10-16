import type {
  AgentCommand,
  BeliefTrack,
  DecisionSnapshot,
  MotorGoal,
  SelfState,
  Vec3,
} from '@blacksite/ai-schema';
import { AGENT_RADIUS, Buttons, DT, TICK_RATE } from '@blacksite/ai-schema';
import { ReservationTable } from '@blacksite/ai-tactics';
import { assignmentWatch } from '@blacksite/ai-planning';
import {
  distance,
  distanceToSegment,
  canTraverse,
  hasLineOfSight,
  hasSuppressionLane,
  isWalkable,
  navigationClearance,
} from '@blacksite/ai-nav';
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const eyeHeight = (self: SelfState) =>
  self.stance === 'prone' ? 0.35 : self.stance === 'crouch' ? 0.93 : 1.5;
function rememberedThreat(snapshot: DecisionSnapshot): BeliefTrack | undefined {
  let selected: BeliefTrack | undefined;
  for (const track of snapshot.beliefs) {
    const age = snapshot.tick - track.lastObservedAt;
    if (
      track.classification !== 'enemy' ||
      track.confidence < 0.4 ||
      !track.provenance.length ||
      track.receivedAt > snapshot.tick ||
      track.expiresAt <= snapshot.tick ||
      age < 0 ||
      age > 90
    ) {
      continue;
    }
    if (
      !selected ||
      track.lastObservedAt > selected.lastObservedAt ||
      (track.lastObservedAt === selected.lastObservedAt &&
        (track.confidence > selected.confidence ||
          (track.confidence === selected.confidence && track.id.localeCompare(selected.id) < 0)))
    ) {
      selected = track;
    }
  }
  return selected;
}
export function friendlyFireBlocked(
  from: Vec3,
  direction: Vec3,
  range: number,
  friends: ReadonlyArray<SelfState>,
  selfId: string,
  horizonSeconds = 0.15,
): boolean {
  const end = {
    x: from.x + direction.x * range,
    y: from.y + direction.y * range,
    z: from.z + direction.z * range,
  };
  return friends.some((friend) => {
    if (friend.id === selfId || !friend.alive) {
      return false;
    }
    const ahead =
      (friend.position.x - from.x) * direction.x + (friend.position.z - from.z) * direction.z;
    if (ahead <= 0 || ahead >= range + 0.6) {
      return false;
    }
    const moved = {
      x: friend.position.x + friend.velocity.x * horizonSeconds,
      y: friend.position.y,
      z: friend.position.z + friend.velocity.z * horizonSeconds,
    };
    const expansion = 0.48 + Math.hypot(friend.velocity.x, friend.velocity.z) * horizonSeconds;
    const rayHeight = from.y + direction.y * ahead;
    return (
      rayHeight >= friend.position.y - 0.2 &&
      rayHeight <= friend.position.y + 1.9 &&
      (distanceToSegment(friend.position, from, end) <= expansion ||
        distanceToSegment(moved, from, end) <= expansion)
    );
  });
}
type PortalTraffic = {
  owns: boolean;
  resourceId: string;
  waitingPoint?: Vec3;
};
function establishingWatch(snapshot: DecisionSnapshot, goal: MotorGoal): boolean {
  const watch = assignmentWatch(snapshot);
  return (
    !!watch &&
    goal.watchSector?.id === watch.id &&
    !!goal.destination &&
    !!snapshot.assignment &&
    distance(goal.destination, snapshot.assignment.position) < 0.01
  );
}
function portalTraffic(
  snapshot: DecisionSnapshot,
  goal: MotorGoal,
  path: ReadonlyArray<Vec3>,
  reservations: ReservationTable,
): PortalTraffic | undefined {
  const { map, self } = snapshot;
  const mover =
    snapshot.assignment?.role !== 'support' && snapshot.assignment?.role !== 'overwatch';
  if (
    !goal.destination ||
    goal.speed <= 0 ||
    (snapshot.maneuver?.kind === 'bound' &&
      !snapshot.maneuver.supportReady &&
      mover &&
      !establishingWatch(snapshot, goal) &&
      snapshot.danger < 0.9)
  ) {
    return undefined;
  }
  const corridor = [self.position, ...path, goal.destination];
  const portals = map.nodes.filter(
    (node) =>
      node.kind === 'entry' &&
      distance(self.position, node.position) < 5 &&
      corridor.slice(1).some((end, i) => distanceToSegment(node.position, corridor[i]!, end) < 0.6),
  );
  for (const node of portals.sort(
    (a, b) =>
      distance(self.position, a.position) - distance(self.position, b.position) ||
      a.id.localeCompare(b.id),
  )) {
    const clear = (dx: number, dz: number) =>
      isWalkable(
        map,
        { x: node.position.x + dx, y: node.position.y, z: node.position.z + dz },
        AGENT_RADIUS,
      );
    const axis =
      !clear(0, 0.95) && !clear(0, -0.95) && clear(0.95, 0) && clear(-0.95, 0)
        ? 'x'
        : !clear(0.95, 0) && !clear(-0.95, 0) && clear(0, 0.95) && clear(0, -0.95)
          ? 'z'
          : undefined;
    if (!axis) {
      continue;
    }
    const lateral = axis === 'x' ? 'z' : 'x';
    const targetDelta = goal.destination[axis] - node.position[axis];
    const direction =
      Math.sign(
        Math.abs(targetDelta) > 0.4 ? targetDelta : node.position[axis] - self.position[axis],
      ) || 1;
    if ((self.position[axis] - node.position[axis]) * direction > 1.7) {
      continue;
    }
    const resourceId = `portal:${node.id}`;
    const owner = reservations
      .snapshot()
      .find((lease) => lease.resourceId === resourceId && lease.expiresAt > snapshot.tick)?.ownerId;
    const priority = (id: string) => {
      const role = snapshot.maneuver?.assignments.find((a) => a.agentId === id)?.role;
      return role === 'point'
        ? 0
        : role === 'leader'
          ? 1
          : role === 'flank'
            ? 2
            : role === 'support'
              ? 3
              : role === 'overwatch'
                ? 4
                : 5;
    };
    const contenders = [self, ...snapshot.friends]
      .filter((friend) => {
        const assignment = snapshot.maneuver?.assignments.find((a) => a.agentId === friend.id);
        const destination = friend.id === self.id ? goal.destination : assignment?.position;
        const along = (friend.position[axis] - node.position[axis]) * direction;
        const readyToMove =
          friend.id === self.id || (destination && distance(friend.position, destination) > 1.1);
        return (
          friend.alive &&
          readyToMove &&
          reservations.eligible(resourceId, friend.id, snapshot.tick) &&
          distance(friend.position, node.position) < 5 &&
          along < 1.7 &&
          destination &&
          (destination[axis] - node.position[axis]) * direction >= -0.65
        );
      })
      .sort((a, b) => priority(a.id) - priority(b.id) || a.id.localeCompare(b.id));
    if (
      (owner === self.id || (!owner && contenders[0]?.id === self.id)) &&
      reservations.claim(resourceId, self.id, snapshot.tick, 8, 'portal')
    ) {
      return { owns: true, resourceId };
    }
    const followers = [self, ...snapshot.friends]
      .filter(
        (friend) =>
          friend.alive && friend.id !== owner && distance(friend.position, node.position) < 6,
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    const index = Math.max(
      0,
      followers.findIndex((friend) => friend.id === self.id),
    );
    const waitingPoints: Array<Vec3> = [];
    const ownerState = [self, ...snapshot.friends].find((friend) => friend.id === owner);
    const next = contenders.find((friend) => friend.id !== owner);
    if (
      ownerState &&
      next?.id === self.id &&
      (ownerState.position[axis] - self.position[axis]) * direction > AGENT_RADIUS * 2 + 0.1
    ) {
      const along = (ownerState.position[axis] - node.position[axis]) * direction;
      waitingPoints.push({
        ...node.position,
        [axis]: node.position[axis] + direction * Math.min(0.8, along - (AGENT_RADIUS * 2 + 0.4)),
      });
    }
    for (let offset = 0; offset < 4; offset++) {
      const slot = index + offset;
      waitingPoints.push({
        ...node.position,
        [axis]: node.position[axis] - direction * (2.8 + Math.floor(slot / 2) * 0.9),
        [lateral]: node.position[lateral] + (slot % 2 ? -1 : 1) * (1 + Math.floor(slot / 4) * 0.35),
      });
    }
    const waitingPoint = waitingPoints.find(
      (point) =>
        isWalkable(map, point, 0.4) &&
        canTraverse(map, self.position, point, AGENT_RADIUS) &&
        snapshot.friends.every(
          (friend) => !friend.alive || distance(point, friend.position) > AGENT_RADIUS * 2 + 0.1,
        ),
    );
    return { owns: false, resourceId, waitingPoint };
  }
  return undefined;
}
export class MotorController {
  private yawVelocity = 0;
  private pitchVelocity = 0;
  private moveX = 0;
  private moveZ = 0;
  private targetId?: string;
  private acquiredAt = 0;
  private sequence = 0;
  private pathKey = '';
  private pathIndex = 0;
  private phase: number;
  private activePortal?: string;
  private portalProgressAt = 0;
  private portalProgressPosition?: Vec3;
  constructor(
    readonly agentId: string,
    readonly reservations = new ReservationTable(),
  ) {
    this.phase = [...agentId].reduce((s, c) => Math.imul(s, 31) + c.charCodeAt(0), 17) >>> 0;
  }
  dispose(): void {
    if (this.activePortal) {
      this.reservations.release(this.activePortal, this.agentId);
    }
    this.activePortal = undefined;
  }
  step(
    snapshot: DecisionSnapshot,
    goal: MotorGoal,
    path: ReadonlyArray<Vec3> = [],
  ): {
    attention: Vec3;
    command: AgentCommand;
    fireGate: string;
  } {
    const { self, tick } = snapshot,
      skill = self.skill;
    const eye = { ...self.position, y: self.position.y + eyeHeight(self) };
    const clearance = navigationClearance(snapshot.map, self.position);
    const pathKey = path
      .map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`)
      .join('|');
    if (pathKey !== this.pathKey) {
      this.pathKey = pathKey;
      this.pathIndex = 0;
    }
    while (
      clearance >= 0.4 &&
      this.pathIndex + 1 < path.length &&
      canTraverse(snapshot.map, self.position, path[this.pathIndex + 1]!, clearance)
    ) {
      this.pathIndex++;
    }
    const directDestination =
      goal.destination && canTraverse(snapshot.map, self.position, goal.destination, clearance)
        ? goal.destination
        : undefined;
    const waypoint = path[this.pathIndex] ?? directDestination;
    const liveWatch = assignmentWatch(snapshot);
    const watch = liveWatch && goal.watchSector?.id === liveWatch.id ? liveWatch : undefined;
    const actionTrack = snapshot.beliefs.find((track) => track.id === goal.targetTrackId);
    const freshTarget =
      actionTrack &&
      actionTrack.classification === 'enemy' &&
      actionTrack.confidence >= 0.4 &&
      actionTrack.provenance.length > 0 &&
      actionTrack.receivedAt <= tick &&
      actionTrack.expiresAt > tick &&
      actionTrack.lastObservedAt <= tick &&
      tick - actionTrack.lastObservedAt <= 18;
    const attendingTarget = !!goal.targetTrackId && (!watch || !!freshTarget);
    const focusedTarget = attendingTarget ? goal.targetTrackId : undefined;
    if (this.targetId !== focusedTarget) {
      this.targetId = focusedTarget;
      this.acquiredAt = tick;
    }
    const memory = attendingTarget || watch ? undefined : rememberedThreat(snapshot);
    const lookPoint = attendingTarget
      ? goal.lookAt
      : watch
        ? watch.lookAt
        : memory
          ? { ...memory.meanPosition, y: Math.max(0.2, memory.meanPosition.y - 0.22) }
          : (waypoint ?? goal.lookAt);
    const attention = lookPoint
      ? { ...lookPoint, y: attendingTarget || watch || memory ? lookPoint.y : eye.y }
      : {
          x: self.position.x + Math.sin(self.yaw) * 8,
          y: eye.y,
          z: self.position.z + Math.cos(self.yaw) * 8,
        };
    const horizontal = Math.hypot(attention.x - eye.x, attention.z - eye.z);
    const intendedYaw = Math.atan2(attention.x - eye.x, attention.z - eye.z);
    const stress = 1 + self.suppression * (1 - skill.composure) * 2;
    const error =
      Math.sin((tick / TICK_RATE) * 2.7 + (this.phase % 47)) *
      (1 - skill.aimTracking) *
      0.016 *
      stress;
    const desiredYaw = intendedYaw + (attendingTarget ? error : 0);
    const desiredPitch = Math.atan2(attention.y - eye.y, Math.max(0.01, horizontal));
    const reactionTicks = Math.ceil((0.12 + (1 - skill.reaction) * 0.28) * TICK_RATE);
    const acquiring = attendingTarget && tick - this.acquiredAt < reactionTicks;
    const maxSpeed = 2.5 + skill.aimAcquisition * 4,
      acceleration = 14 + skill.aimAcquisition * 30;
    const gain = 5 + skill.aimTracking * 8;
    const targetYawVelocity = acquiring
      ? 0
      : clamp(wrapAngle(desiredYaw - self.yaw) * gain, -maxSpeed, maxSpeed);
    const targetPitchVelocity = acquiring
      ? 0
      : clamp((desiredPitch - self.pitch) * gain, -maxSpeed * 0.6, maxSpeed * 0.6);
    this.yawVelocity += clamp(
      targetYawVelocity - this.yawVelocity,
      -acceleration * DT,
      acceleration * DT,
    );
    this.pitchVelocity += clamp(
      targetPitchVelocity - this.pitchVelocity,
      -acceleration * DT,
      acceleration * DT,
    );
    const lookDelta = {
      pitch: clamp(this.pitchVelocity * DT, -0.18, 0.18),
      yaw: clamp(this.yawVelocity * DT, -0.24, 0.24),
    };
    const nextYaw = self.yaw + lookDelta.yaw,
      nextPitch = self.pitch + lookDelta.pitch;
    let desiredX = 0,
      desiredZ = 0;
    if (waypoint && goal.speed > 0) {
      const d = distance(self.position, waypoint);
      const intermediate = this.pathIndex < path.length - 1;
      if (
        d > (intermediate ? 0.04 : 0.45) &&
        canTraverse(snapshot.map, self.position, waypoint, clearance)
      ) {
        const speed = goal.speed * (intermediate ? Math.min(1, d / 0.35) : 1);
        desiredX = ((waypoint.x - self.position.x) / d) * speed;
        desiredZ = ((waypoint.z - self.position.z) / d) * speed;
      }
    }
    if (this.activePortal) {
      if (
        !this.portalProgressPosition ||
        distance(self.position, this.portalProgressPosition) > 0.2
      ) {
        this.portalProgressAt = tick;
        this.portalProgressPosition = { ...self.position };
      } else if (tick - this.portalProgressAt >= 45) {
        this.reservations.defer(this.activePortal, self.id, tick, 30);
        this.activePortal = undefined;
      }
    }
    let traffic = portalTraffic(snapshot, goal, path, this.reservations);
    const occupiedPortal =
      this.activePortal &&
      snapshot.map.nodes.find((node) => `portal:${node.id}` === this.activePortal);
    if (
      !traffic &&
      occupiedPortal &&
      distance(self.position, occupiedPortal.position) < 1.7 &&
      self.alive &&
      this.reservations.claim(this.activePortal!, self.id, tick, 8, 'portal')
    ) {
      traffic = { owns: true, resourceId: this.activePortal! };
    }
    if (this.activePortal && this.activePortal !== traffic?.resourceId) {
      this.reservations.release(this.activePortal, self.id);
    }
    if (traffic?.owns && this.activePortal !== traffic.resourceId) {
      this.portalProgressAt = tick;
      this.portalProgressPosition = { ...self.position };
    }
    this.activePortal = traffic?.owns ? traffic.resourceId : undefined;
    if (traffic && !traffic.owns) {
      const waiting = traffic.waitingPoint;
      if (
        waiting &&
        canTraverse(snapshot.map, self.position, waiting, AGENT_RADIUS) &&
        distance(self.position, waiting) > 0.15
      ) {
        const d = distance(self.position, waiting),
          speed = Math.min(goal.speed, d * 1.6);
        desiredX = ((waiting.x - self.position.x) / d) * speed;
        desiredZ = ((waiting.z - self.position.z) / d) * speed;
      } else {
        desiredX = 0;
        desiredZ = 0;
      }
    }
    for (const friend of traffic || goal.speed <= 0 ? [] : snapshot.friends) {
      if (
        friend.id === self.id ||
        !friend.alive ||
        Math.abs(friend.position.y - self.position.y) > 1.2
      ) {
        continue;
      }
      const dx = self.position.x - friend.position.x,
        dz = self.position.z - friend.position.z,
        d = Math.hypot(dx, dz);
      if (d > 0.01 && d < 1.5) {
        const urgency = self.id.localeCompare(friend.id) > 0 ? 0.8 : 0.3;
        desiredX += (dx / d) * (1.5 - d) * urgency;
        desiredZ += (dz / d) * (1.5 - d) * urgency;
      }
    }
    const length = Math.hypot(desiredX, desiredZ);
    if (length > 1) {
      desiredX /= length;
      desiredZ /= length;
    }
    const probe = {
      x: self.position.x + desiredX * 0.65,
      y: self.position.y,
      z: self.position.z + desiredZ * 0.65,
    };
    if (
      !isWalkable(snapshot.map, probe, clearance) ||
      !canTraverse(snapshot.map, self.position, probe, clearance)
    ) {
      const xSafe =
        isWalkable(snapshot.map, { ...self.position, x: probe.x }, clearance) &&
        canTraverse(snapshot.map, self.position, { ...self.position, x: probe.x }, clearance);
      const zSafe =
        isWalkable(snapshot.map, { ...self.position, z: probe.z }, clearance) &&
        canTraverse(snapshot.map, self.position, { ...self.position, z: probe.z }, clearance);
      if (xSafe && !zSafe) {
        desiredZ = 0;
      } else if (zSafe && !xSafe) {
        desiredX = 0;
      } else {
        desiredX = 0;
        desiredZ = 0;
      }
    }
    const mover =
      snapshot.assignment?.role !== 'support' && snapshot.assignment?.role !== 'overwatch';
    if (
      snapshot.maneuver?.kind === 'bound' &&
      !snapshot.maneuver.supportReady &&
      mover &&
      !establishingWatch(snapshot, goal) &&
      snapshot.danger < 0.9
    ) {
      desiredX = 0;
      desiredZ = 0;
    }
    const change = (4 + skill.movement * 5) * DT;
    this.moveX += clamp(desiredX - this.moveX, -change, change);
    this.moveZ += clamp(desiredZ - this.moveZ, -change, change);
    const yawError = Math.abs(wrapAngle(intendedYaw - nextYaw));
    const pitchError = Math.abs(desiredPitch - nextPitch);
    const dir = {
      x: Math.sin(nextYaw) * Math.cos(nextPitch),
      y: Math.sin(nextPitch),
      z: Math.cos(nextYaw) * Math.cos(nextPitch),
    };
    let fireGate = 'no-fire-intent';
    let buttons = goal.reload ? Buttons.reload : 0;
    if (attendingTarget) {
      buttons += Buttons.aim;
    }
    if (goal.fire && goal.suppress) {
      const track = snapshot.beliefs.find((t) => t.id === goal.targetTrackId);
      if (!self.alive) {
        fireGate = 'not-alive';
      } else if (self.ammo <= 0 || self.reloadingUntil > tick) {
        fireGate = 'weapon-unavailable';
      } else if (!attendingTarget) {
        fireGate = 'target-not-attended';
      } else if (
        !track ||
        track.classification !== 'enemy' ||
        track.provenance.length === 0 ||
        track.confidence < 0.3
      ) {
        fireGate = 'unconfirmed-target';
      } else if (track.expiresAt <= tick || tick - track.lastObservedAt > 150) {
        fireGate = 'stale-observation';
      } else if (yawError > 0.05 || pitchError > 0.06) {
        fireGate = 'motor-settling';
      } else if (!hasSuppressionLane(snapshot.map, eye, attention)) {
        fireGate = 'occluded';
      } else if (
        friendlyFireBlocked(eye, dir, Math.max(1, horizontal + 1), snapshot.friends, self.id)
      ) {
        fireGate = 'friendly-swept-volume';
      } else if ((tick + (this.phase % 23)) % 30 > 9) {
        fireGate = 'burst-recovery';
      } else {
        buttons += Buttons.fire;
        fireGate = 'suppressing';
      }
    } else if (goal.fire) {
      const track = snapshot.beliefs.find((t) => t.id === goal.targetTrackId);
      if (!self.alive) {
        fireGate = 'not-alive';
      } else if (self.ammo <= 0 || self.reloadingUntil > tick) {
        fireGate = 'weapon-unavailable';
      } else if (!attendingTarget) {
        fireGate = 'target-not-attended';
      } else if (
        !track ||
        track.classification !== 'enemy' ||
        track.provenance.length === 0 ||
        track.confidence < 0.55 ||
        goal.targetConfidence < 0.55
      ) {
        fireGate = 'unconfirmed-target';
      } else if (
        track.expiresAt <= tick ||
        track.receivedAt > tick ||
        track.lastObservedAt > tick ||
        tick - track.lastObservedAt > 18
      ) {
        fireGate = 'stale-observation';
      } else if (acquiring) {
        fireGate = 'acquisition-latency';
      } else if (yawError > 0.022 + (1 - skill.aimAcquisition) * 0.015 || pitchError > 0.04) {
        fireGate = 'motor-settling';
      } else if (!hasLineOfSight(snapshot.map, eye, attention)) {
        fireGate = 'occluded';
      } else if (
        friendlyFireBlocked(eye, dir, Math.max(1, horizontal + 1), snapshot.friends, self.id)
      ) {
        fireGate = 'friendly-swept-volume';
      } else if ((tick + (this.phase % 17)) % 18 > 11) {
        fireGate = 'burst-recovery';
      } else {
        buttons += Buttons.fire;
        fireGate = 'clear';
      }
    }
    const command: AgentCommand = {
      agentId: self.id,
      buttons: self.alive ? buttons : 0,
      lookDelta,
      move: { x: self.alive ? this.moveX : 0, y: self.alive ? this.moveZ : 0 },
      source: 'ai',
      sourceSequence: ++this.sequence,
      stance: goal.stance,
      tick,
    };
    return { attention: { ...attention }, command, fireGate };
  }
}
