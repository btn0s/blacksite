import type {
  Assignment,
  BeliefTrack,
  Role,
  SelfState,
  SquadPlan,
  StrategicOrder,
  TacticalMap,
  TacticalNode,
  TeamId,
  Tick,
  Vec3,
  WatchSector,
} from '@blacksite/ai-schema';
import {
  distance,
  distanceToSegment,
  canTraverse,
  findPath,
  hasLineOfSight,
  isWalkable,
  tacticalPathCosts,
} from '@blacksite/ai-nav';
import { ReservationTable } from '@blacksite/ai-tactics';
export function chooseStrategicOrder(
  team: TeamId,
  tick: Tick,
  members: ReadonlyArray<SelfState>,
  shared: ReadonlyArray<BeliefTrack>,
  map: TacticalMap,
): StrategicOrder {
  const alive = members.filter((m) => m.alive),
    readiness =
      alive.reduce((s, m) => s + (m.health / 100) * Math.min(1, m.ammo / 10), 0) /
      Math.max(1, alive.length);
  const leader = alive[0]?.position ??
    map.spawns[team][0] ??
    map.objectives[0]?.position ?? { x: 0, y: 0, z: 0 };
  const objective = [...map.objectives].sort((a, b) => {
    const score = (o: typeof a) =>
      5 -
      distance(leader, o.position) * 0.04 -
      shared
        .filter((t) => t.possibleRegions.includes(o.regionId))
        .reduce((s, t) => s + t.confidence, 0) *
        0.3;
    return score(b) - score(a) || a.id.localeCompare(b.id);
  })[0];
  const retreat = readiness < 0.18 && alive.length > 0;
  return {
    id: `${team}:order:${Math.floor(tick / 120)}`,
    issuedAt: tick,
    objective: retreat
      ? { ...(map.spawns[team][0] ?? leader) }
      : { ...(objective?.position ?? leader) },
    objectiveId: objective?.id ?? 'rally',
    posture: retreat ? 'retreat' : shared.some((t) => t.confidence > 0.6) ? 'seize' : 'probe',
    risk: Math.max(0.2, Math.min(0.8, readiness)),
    team,
    tempo: readiness > 0.6 ? 0.8 : 0.45,
  };
}
export function allocateRoles(
  members: ReadonlyArray<SelfState>,
  previous: ReadonlyArray<Assignment> = [],
): Map<string, Role> {
  const ordered = [...members].sort((a, b) => a.id.localeCompare(b.id));
  const sorted = ordered.slice(0, 8);
  const roles: Array<Role> = [
    'point',
    'support',
    'flank',
    'overwatch',
    'leader',
    'rear',
    'medic',
    'reserve',
  ].slice(0, sorted.length) as Array<Role>;
  const n = sorted.length,
    total = 1 << n,
    cost = new Float64Array(total).fill(Infinity),
    parent = new Int32Array(total).fill(-1);
  cost[0] = 0;
  for (let mask = 0; mask < total; mask++) {
    let index = 0;
    for (let bits = mask; bits; bits &= bits - 1) {
      index++;
    }
    if (index >= n) {
      continue;
    }
    const member = sorted[index]!;
    for (let roleIndex = 0; roleIndex < n; roleIndex++) {
      if (mask & (1 << roleIndex)) {
        continue;
      }
      const role = roles[roleIndex]!;
      const fit =
        role === 'point' || role === 'flank'
          ? member.skill.movement * 2 + member.health / 100
          : role === 'support' || role === 'overwatch'
            ? member.skill.aimTracking + member.ammo / 25
            : member.skill.communication;
      const hysteresis = previous.find((p) => p.agentId === member.id)?.role === role ? -1.1 : 0;
      const value = cost[mask]! - fit + hysteresis;
      const next = mask | (1 << roleIndex);
      if (value < cost[next]!) {
        cost[next] = value;
        parent[next] = roleIndex;
      }
    }
  }
  const result = new Map<string, Role>();
  let mask = total - 1;
  for (let memberIndex = n - 1; memberIndex >= 0; memberIndex--) {
    const roleIndex = parent[mask]!;
    const role = roles[roleIndex];
    if (!role) {
      throw new Error('Role allocation did not produce a complete assignment');
    }
    result.set(sorted[memberIndex]!.id, role);
    mask ^= 1 << roleIndex;
  }
  for (const member of ordered.slice(8)) {
    result.set(member.id, 'reserve');
  }
  return result;
}
const regionTravelCache = new WeakMap<TacticalMap, Map<string, Map<string, number>>>();
function regionTravelCosts(map: TacticalMap): Map<string, Map<string, number>> {
  const cached = regionTravelCache.get(map);
  if (cached) {
    return cached;
  }
  const anchors = new Map(
    map.regions.map((region) => {
      const local = map.nodes.filter((node) => node.regionId === region.id);
      const node = [...(local.length ? local : map.nodes)].sort(
        (a, b) =>
          distance(a.position, region.center) - distance(b.position, region.center) ||
          a.id.localeCompare(b.id),
      )[0];
      return [region.id, node] as const;
    }),
  );
  const costs = new Map<string, Map<string, number>>();
  for (const region of map.regions) {
    const anchor = anchors.get(region.id),
      field = anchor ? tacticalPathCosts(map, anchor.position) : new Map<string, number>();
    costs.set(
      region.id,
      new Map(
        region.neighbors.map((id) => [
          id,
          Math.max(1, field.get(anchors.get(id)?.id ?? '') ?? Infinity),
        ]),
      ),
    );
  }
  regionTravelCache.set(map, costs);
  return costs;
}
export function selectApproachRoutes(
  map: TacticalMap,
  team: TeamId,
  objective: Vec3,
): {
  flank: Array<string>;
  primary: Array<string>;
} {
  const spawn = map.spawns[team][0];
  if (!spawn) {
    return { flank: [], primary: [] };
  }
  const start = [...map.regions].sort(
    (a, b) => distance(a.center, spawn) - distance(b.center, spawn) || a.id.localeCompare(b.id),
  )[0]?.id;
  const target =
    map.objectives.find((o) => distance(o.position, objective) < 0.1)?.regionId ??
    [...map.regions].sort(
      (a, b) =>
        distance(a.center, objective) - distance(b.center, objective) || a.id.localeCompare(b.id),
    )[0]?.id;
  if (!start || !target) {
    return { flank: [], primary: [] };
  }
  const regions = new Map(map.regions.map((r) => [r.id, r])),
    travel = regionTravelCosts(map);
  const route = (
    excluded?: string,
  ): {
    cost: number;
    nodes: Array<string>;
  } => {
    const costs = new Map<string, number>([[start, 0]]),
      previous = new Map<string, string>(),
      open = new Set([start]);
    while (open.size) {
      const current = [...open].sort(
        (a, b) => costs.get(a)! - costs.get(b)! || a.localeCompare(b),
      )[0]!;
      open.delete(current);
      if (current === target) {
        const nodes = [target];
        let cursor = target;
        while (previous.has(cursor)) {
          cursor = previous.get(cursor)!;
          nodes.unshift(cursor);
        }
        return { cost: costs.get(target)!, nodes };
      }
      for (const next of [...regions.get(current)!.neighbors].sort()) {
        if (!regions.has(next) || `${current}>${next}` === excluded) {
          continue;
        }
        const cost = costs.get(current)! + (travel.get(current)?.get(next) ?? Infinity);
        if (cost < (costs.get(next) ?? Infinity)) {
          costs.set(next, cost);
          previous.set(next, current);
          open.add(next);
        }
      }
    }
    return { cost: Infinity, nodes: [] };
  };
  const primary = route();
  const alternatives = primary.nodes
    .slice(0, -1)
    .map((id, i) => route(`${id}>${primary.nodes[i + 1]}`))
    .filter((r) => r.nodes.length > 0 && r.cost <= primary.cost * 2 + 10)
    .sort((a, b) => a.cost - b.cost || a.nodes.join('/').localeCompare(b.nodes.join('/')));
  return { flank: alternatives[0]?.nodes ?? primary.nodes, primary: primary.nodes };
}
const eye = (p: Vec3) => ({ ...p, y: p.y + 1.4 });

export class SquadCoordinator {
  private current?: SquadPlan;
  private supportWaitStarted?: Tick;
  private approaches = new Map<
    string,
    {
      index: number;
      key: string;
    }
  >();
  private entry?: {
    buddyId: string;
    changedAt: Tick;
    corner: Vec3;
    key: string;
    leadId: string;
    stageId: string;
    startedAt: Tick;
    state: 'waiting' | 'ready' | 'repair';
  };
  private completedEntries = new Map<string, Tick>();
  private memberAlive = new Map<string, boolean>();
  private casualtyCover?: {
    casualtyPosition: Vec3;
    ownerId?: string;
    radioExpiresAt?: Tick;
    sector: WatchSector;
    slotId?: string;
    targetCommitted: boolean;
  };
  constructor(readonly team: TeamId) {}
  update(
    tick: Tick,
    members: ReadonlyArray<SelfState>,
    shared: ReadonlyArray<BeliefTrack>,
    map: TacticalMap,
    suppliedOrder: StrategicOrder | undefined,
    reservations: ReservationTable,
  ): SquadPlan {
    if (members.some((m) => m.team !== this.team)) {
      throw new Error('Squad coordinator received another team’s private state');
    }
    const alive = [...members].filter((m) => m.alive).sort((a, b) => a.id.localeCompare(b.id));
    for (const member of members) {
      if (!member.alive) {
        reservations.releaseOwner(member.id);
      }
    }
    const order =
      suppliedOrder ??
      (this.current && tick - this.current.order.issuedAt < 120
        ? this.current.order
        : chooseStrategicOrder(this.team, tick, alive, shared, map));
    const casualties = members
      .filter((member) => !member.alive && this.memberAlive.get(member.id) === true)
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const member of members) {
      this.memberAlive.set(member.id, member.alive);
    }
    if (
      this.casualtyCover &&
      (tick >= this.casualtyCover.sector.expiresAt ||
        order.posture === 'retreat' ||
        alive.length < 2)
    ) {
      if (this.casualtyCover.ownerId && this.casualtyCover.slotId) {
        reservations.release(this.casualtyCover.slotId, this.casualtyCover.ownerId);
      }
      this.casualtyCover = undefined;
    }
    if (
      !this.casualtyCover &&
      casualties.length &&
      order.posture !== 'retreat' &&
      alive.length > 1
    ) {
      const casualty = casualties[0]!;
      const contact = shared
        .filter(
          (track) =>
            track.source === 'radio' &&
            track.classification === 'enemy' &&
            track.confidence > 0.4 &&
            track.lastObservedAt <= tick &&
            track.receivedAt <= tick &&
            track.expiresAt > tick &&
            track.provenance.length > 0 &&
            distance(casualty.position, track.meanPosition) < 32 &&
            hasLineOfSight(
              map,
              { ...casualty.position, y: casualty.position.y + 1.4 },
              track.meanPosition,
            ),
        )
        .sort(
          (a, b) =>
            b.lastObservedAt - a.lastObservedAt ||
            b.confidence - a.confidence ||
            a.id.localeCompare(b.id),
        )[0];
      this.casualtyCover = {
        casualtyPosition: { ...casualty.position },
        radioExpiresAt: contact?.expiresAt,
        sector: {
          casualtyId: casualty.id,
          expiresAt: tick + 240,
          id: `${this.team}:casualty:${casualty.id}:${tick}`,
          issuedAt: tick,
          lookAt: contact
            ? { ...contact.meanPosition }
            : { ...casualty.position, y: casualty.position.y + 1.4 },
          observationProvenance: contact ? [...contact.provenance] : [],
          source: contact ? 'radio' : 'team-status',
        },
        targetCommitted: false,
      };
    }
    const contacts = shared.filter(
      (t) => t.classification === 'enemy' && t.confidence > 0.4 && t.expiresAt > tick,
    );
    const oldAssignments = this.current?.assignments ?? [];
    const roles = allocateRoles(alive, oldAssignments),
      claimed = new Set<string>(),
      assignments: Array<Assignment> = [];
    const routes = selectApproachRoutes(map, this.team, order.objective);
    const objectiveCosts = tacticalPathCosts(map, order.objective);
    const stageByAgent = new Map<
      string,
      {
        final: boolean;
        position: Vec3;
        previousRegion?: string;
        regionId?: string;
      }
    >();
    for (const member of alive) {
      const route =
        roles.get(member.id) === 'flank' && order.posture !== 'retreat'
          ? routes.flank
          : routes.primary;
      const key = `${order.objectiveId}:${order.posture === 'retreat'}:${route.join('/')}`;
      let progress = this.approaches.get(member.id);
      if (!progress || progress.key !== key) {
        progress = { index: Math.min(1, route.length - 1), key };
        this.approaches.set(member.id, progress);
      }
      const currentRegion = [...map.nodes]
        .sort(
          (a, b) =>
            distance(member.position, a.position) - distance(member.position, b.position) ||
            a.id.localeCompare(b.id),
        )
        .find((node) => canTraverse(map, member.position, node.position, 0.25))?.regionId;
      if (progress.index < route.length - 1 && currentRegion === route[progress.index]) {
        progress.index++;
      }
      const regionId = route[progress.index],
        position =
          progress.index === route.length - 1
            ? order.objective
            : (map.regions.find((r) => r.id === regionId)?.center ?? order.objective);
      stageByAgent.set(member.id, {
        final: progress.index === route.length - 1,
        position,
        previousRegion: route[Math.max(0, progress.index - 1)],
        regionId,
      });
    }
    const point = alive.find((m) => roles.get(m.id) === 'point');
    const front = point
      ? stageByAgent.get(point.id)!
      : { final: true, position: order.objective, previousRegion: undefined, regionId: undefined };
    for (const member of alive) {
      const role = roles.get(member.id) ?? 'reserve',
        previous = oldAssignments.find((a) => a.agentId === member.id);
      const supporting = role === 'support' || role === 'overwatch';
      const stage = supporting ? front : stageByAgent.get(member.id)!;
      const travelCosts = tacticalPathCosts(map, member.position);
      const stageNodesExist = map.nodes.some(
        (n) => n.regionId === stage.regionId && Number.isFinite(travelCosts.get(n.id)),
      );
      const objectiveSlot =
        role === 'point' && stage.final && order.posture !== 'retreat'
          ? map.nodes.find(
              (n) =>
                n.kind === 'objective' &&
                distance(n.position, order.objective) < 1 &&
                Number.isFinite(travelCosts.get(n.id)) &&
                !claimed.has(n.id) &&
                reservations.available(n.id, member.id, tick),
            )
          : undefined;
      const candidates = map.nodes
        .filter(
          (n) =>
            (!objectiveSlot || n.id === objectiveSlot.id) &&
            !claimed.has(n.id) &&
            isWalkable(map, n.position) &&
            Number.isFinite(travelCosts.get(n.id)) &&
            reservations.available(n.id, member.id, tick) &&
            (!stageNodesExist ||
              n.regionId === stage.regionId ||
              (supporting && n.regionId === stage.previousRegion)),
        )
        .map((n) => {
          const travel = travelCosts.get(n.id)!,
            objectiveDistance = objectiveCosts.get(n.id) ?? distance(n.position, order.objective);
          const stageDistance = distance(n.position, stage.position);
          const coversApproach =
            distance(n.position, stage.position) < 24 &&
            hasLineOfSight(
              map,
              { ...n.position, y: n.position.y + 1.5 },
              { ...stage.position, y: stage.position.y + 1.2 },
            );
          const roleFit = supporting
            ? n.cover * 3 + (coversApproach ? 4 : -2) - Math.abs(stageDistance - 8) * 0.2
            : -stageDistance * 0.24 -
              objectiveDistance * 0.025 +
              (role === 'point' && n.kind === 'entry' ? 1 : 0);
          const observedFireSolution =
            supporting &&
            contacts.some(
              (t) =>
                distance(n.position, t.meanPosition) < 28 &&
                hasLineOfSight(map, { ...n.position, y: n.position.y + 1.5 }, t.meanPosition),
            )
              ? 4
              : 0;
          const spacing = assignments.reduce(
            (penalty, a) => penalty + Math.max(0, 3 - distance(a.position, n.position)) * 0.7,
            0,
          );
          const score =
            roleFit +
            observedFireSolution -
            travel * 0.11 -
            n.exposure * 0.5 -
            spacing +
            (previous?.slotId === n.id ? 1.8 : 0);
          return { node: n, score };
        })
        .sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id));
      const candidate = candidates[0];
      if (!candidate) {
        continue;
      }
      const node = candidate.node;
      if (previous && previous.slotId !== node.id) {
        reservations.release(previous.slotId, member.id);
      }
      if (!reservations.claim(node.id, member.id, tick, 60, 'slot')) {
        continue;
      }
      claimed.add(node.id);
      assignments.push({
        agentId: member.id,
        position: { ...node.position },
        ready: distance(member.position, node.position) < 2 && member.ammo > 0,
        role,
        score: candidate.score,
        slotId: node.id,
      });
    }
    const cohesion = this.coordinateEntry(tick, alive, assignments, map, order, reservations);
    const coverage = this.assignCasualtyCover(tick, alive, assignments, map, reservations);
    const supportReady =
      cohesion.ready ||
      assignments.some((a) => {
        const member = alive.find((m) => m.id === a.agentId)!;
        return (
          (a.role === 'support' || a.role === 'overwatch') &&
          a.ready &&
          member.ammo > 4 &&
          contacts.some((t) =>
            hasLineOfSight(
              map,
              { ...member.position, y: member.position.y + 1.5 },
              { ...t.meanPosition },
            ),
          )
        );
      });
    let kind: SquadPlan['kind'] =
      order.posture === 'retreat'
        ? 'fallback'
        : contacts.length
          ? alive.length > 2
            ? 'bound'
            : 'crossfire'
          : 'move';
    if (kind === 'bound' && !supportReady) {
      this.supportWaitStarted ??= tick;
    } else {
      this.supportWaitStarted = undefined;
    }
    const repaired =
      kind === 'bound' &&
      this.supportWaitStarted !== undefined &&
      tick - this.supportWaitStarted >= 90;
    if (repaired) {
      kind = 'crossfire';
    }
    if (cohesion.active) {
      kind = cohesion.repair ? 'fallback' : 'clear';
    }
    const changed =
      this.current?.kind !== kind ||
      this.current?.order.objectiveId !== order.objectiveId ||
      assignments.some(
        (a) => !oldAssignments.some((p) => p.agentId === a.agentId && p.slotId === a.slotId),
      );
    const createdAt = changed || !this.current ? tick : this.current.createdAt;
    const ready = assignments.length > 0 && assignments.every((a) => a.ready);
    const phase: SquadPlan['phase'] = !alive.length
      ? 'abort'
      : cohesion.active
        ? cohesion.ready
          ? 'execute'
          : 'prepare'
        : ready
          ? 'consolidate'
          : kind === 'bound' && !supportReady
            ? 'prepare'
            : 'execute';
    this.current = {
      assignments,
      constraints: [
        'exclusive-slots',
        'no-friendly-fire',
        'report-deviation',
        `primary-approach:${routes.primary.join('>')}`,
        `flank-approach:${routes.flank.join('>')}`,
        ...cohesion.constraints,
        ...coverage,
        ...(kind === 'bound' ? ['support-ready-before-exposure'] : []),
        ...(repaired ? ['support-timeout:repaired-to-crossfire'] : []),
      ],
      createdAt,
      expiresAt: tick + 120,
      id: changed || !this.current ? `${this.team}:maneuver:${tick}` : this.current.id,
      kind,
      order,
      phase,
      supportReady,
      team: this.team,
    };
    return structuredClone(this.current);
  }
  private assignCasualtyCover(
    tick: Tick,
    members: Array<SelfState>,
    assignments: Array<Assignment>,
    map: TacticalMap,
    reservations: ReservationTable,
  ): Array<string> {
    const cover = this.casualtyCover;
    if (!cover) {
      return [];
    }
    const candidates = members
      .flatMap((member) => {
        const assignment = assignments.find((a) => a.agentId === member.id);
        if (
          !assignment ||
          assignment.role === 'point' ||
          member.health <= 25 ||
          member.ammo < 3 ||
          member.reloadingUntil > tick ||
          (this.entry && (this.entry.leadId === member.id || this.entry.buddyId === member.id))
        ) {
          return [];
        }
        const costs = tacticalPathCosts(map, member.position);
        const roleFit =
          assignment.role === 'flank'
            ? 2
            : assignment.role === 'support' || assignment.role === 'overwatch'
              ? 1.5
              : 0;
        const publicSector: WatchSector = {
          ...cover.sector,
          lookAt: { ...cover.casualtyPosition, y: cover.casualtyPosition.y + 1.4 },
          observationProvenance: [],
          source: 'team-status',
        };
        const sectors =
          cover.targetCommitted || cover.sector.source === 'team-status'
            ? [cover.sector]
            : (cover.radioExpiresAt ?? 0) > tick
              ? [cover.sector, publicSector]
              : [publicSector];
        return sectors.flatMap((sector) =>
          map.nodes
            .filter(
              (node) =>
                node.kind !== 'entry' &&
                node.kind !== 'objective' &&
                node.cover >= 0.45 &&
                node.exposure <= 0.65 &&
                isWalkable(map, node.position) &&
                reservations.available(node.id, member.id, tick) &&
                !assignments.some((a) => a.agentId !== member.id && a.slotId === node.id) &&
                distance(node.position, cover.casualtyPosition) > 2 &&
                distance(node.position, sector.lookAt) > 3 &&
                hasLineOfSight(
                  map,
                  { ...node.position, y: node.position.y + 1.4 },
                  sector.lookAt,
                ) &&
                (costs.get(node.id) ?? Infinity) < (sector.expiresAt - tick) * 0.12 &&
                !members.some(
                  (friend) =>
                    friend.id !== member.id &&
                    (distance(friend.position, node.position) < 0.7 ||
                      (distance(friend.position, node.position) > 1.3 &&
                        distanceToSegment(node.position, friend.position, sector.lookAt) < 0.45)),
                ),
            )
            .map((node) => {
              const route = [member.position, ...findPath(map, member.position, node.position)];
              const first = route[1] ?? node.position,
                firstLength = Math.max(0.001, distance(first, member.position));
              const congestion = members.filter(
                (friend) =>
                  friend.id !== member.id &&
                  (distance(friend.position, member.position) > 1.3 ||
                    ((friend.position.x - member.position.x) * (first.x - member.position.x) +
                      (friend.position.z - member.position.z) * (first.z - member.position.z)) /
                      firstLength >
                      0.25) &&
                  route
                    .slice(1)
                    .some(
                      (point, index) =>
                        distanceToSegment(friend.position, route[index]!, point) < 0.8,
                    ),
              ).length;
              return {
                assignment,
                member,
                node,
                score:
                  roleFit +
                  node.cover * 3 -
                  node.exposure * 2 -
                  costs.get(node.id)! * 0.15 -
                  congestion * 2 -
                  (member.health < 40 ? 2 : 0) +
                  (sector.source === 'radio' ? 0.4 : 0) +
                  (cover.ownerId === member.id ? 3 : 0) +
                  (cover.slotId === node.id ? 1 : 0),
                sector,
              };
            }),
        );
      })
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.member.id.localeCompare(b.member.id) ||
          a.node.id.localeCompare(b.node.id),
      );
    const chosen = candidates[0];
    if (!chosen || !reservations.claim(chosen.node.id, chosen.member.id, tick, 60, 'slot')) {
      if (cover.ownerId && cover.slotId) {
        reservations.release(cover.slotId, cover.ownerId);
      }
      cover.ownerId = undefined;
      cover.slotId = undefined;
      return [`cover-sector:${cover.sector.casualtyId}:unavailable`];
    }
    if (
      cover.ownerId &&
      cover.slotId &&
      (cover.ownerId !== chosen.member.id || cover.slotId !== chosen.node.id)
    ) {
      reservations.release(cover.slotId, cover.ownerId);
    }
    if (chosen.assignment.slotId !== chosen.node.id) {
      reservations.release(chosen.assignment.slotId, chosen.member.id);
    }
    cover.ownerId = chosen.member.id;
    cover.slotId = chosen.node.id;
    cover.sector = chosen.sector;
    cover.targetCommitted = true;
    Object.assign(chosen.assignment, {
      position: { ...chosen.node.position },
      ready: distance(chosen.member.position, chosen.node.position) < 1.1,
      score: chosen.score,
      slotId: chosen.node.id,
      watchSector: structuredClone(cover.sector),
    });
    return [
      `cover-sector:${cover.sector.casualtyId}:${chosen.member.id}:${chosen.assignment.ready ? 'holding' : 'moving'}`,
    ];
  }
  private coordinateEntry(
    tick: Tick,
    members: Array<SelfState>,
    assignments: Array<Assignment>,
    map: TacticalMap,
    order: StrategicOrder,
    reservations: ReservationTable,
  ): {
    active: boolean;
    constraints: Array<string>;
    ready: boolean;
    repair: boolean;
  } {
    const idle = { active: false, constraints: [] as Array<string>, ready: false, repair: false };
    for (const [key, expiry] of this.completedEntries) {
      if (expiry < tick) {
        this.completedEntries.delete(key);
      }
    }
    const eligible = (member: SelfState) =>
      member.alive &&
      member.ammo >= 3 &&
      member.reloadingUntil <= tick &&
      member.health > 20 &&
      member.id !== this.casualtyCover?.ownerId;
    const nodeAvailable = (node: TacticalNode, id: string) =>
      isWalkable(map, node.position, 0.4) &&
      reservations.available(node.id, id, tick) &&
      !assignments.some((a) => a.agentId !== id && a.slotId === node.id);
    const outsideEntry = (node: TacticalNode) =>
      node.kind !== 'entry' &&
      !map.nodes.some(
        (other) => other.kind === 'entry' && distance(node.position, other.position) < 1.15,
      );
    const redirect = (id: string, node: TacticalNode | undefined): boolean => {
      const assignment = assignments.find((a) => a.agentId === id),
        member = members.find((m) => m.id === id);
      if (!assignment || !member || !node || !nodeAvailable(node, id)) {
        return false;
      }
      if (!reservations.claim(node.id, id, tick, 60, 'slot')) {
        return false;
      }
      if (assignment.slotId !== node.id) {
        reservations.release(assignment.slotId, id);
      }
      assignment.slotId = node.id;
      assignment.position = { ...node.position };
      assignment.ready = distance(member.position, node.position) < 0.9;
      return true;
    };
    const followNode = (follower: SelfState, target: Vec3): TacticalNode | undefined => {
      const path = findPath(map, follower.position, target);
      if (!path.length) {
        return undefined;
      }
      let remaining = 2,
        desired = target;
      const points = [follower.position, ...path];
      for (let i = points.length - 1; i > 0; i--) {
        const from = points[i - 1]!,
          to = points[i]!;
        const segment = distance(to, from);
        if (segment >= remaining) {
          desired = {
            x: to.x + ((from.x - to.x) * remaining) / segment,
            y: to.y + ((from.y - to.y) * remaining) / segment,
            z: to.z + ((from.z - to.z) * remaining) / segment,
          };
          break;
        }
        remaining -= segment;
        desired = from;
      }
      const costs = tacticalPathCosts(map, follower.position);
      return map.nodes
        .filter(
          (node) =>
            nodeAvailable(node, follower.id) &&
            outsideEntry(node) &&
            Number.isFinite(costs.get(node.id)) &&
            distance(node.position, desired) < 3 &&
            distance(node.position, target) < 6,
        )
        .sort(
          (a, b) =>
            distance(a.position, desired) - distance(b.position, desired) ||
            (costs.get(a.id)! - costs.get(b.id)!) * 0.05 ||
            a.id.localeCompare(b.id),
        )[0];
    };
    if (
      this.entry &&
      (order.posture === 'retreat' ||
        !members.some((m) => m.id === this.entry!.leadId) ||
        !members.some((m) => m.id === this.entry!.buddyId))
    ) {
      const id = this.entry.leadId;
      this.completedEntries.set(this.entry.key, tick + 60);
      this.entry = undefined;
      return { ...idle, constraints: [`regroup:${id}:replan:buddy-unavailable`] };
    }
    if (this.entry && this.entry.state === 'ready' && tick - this.entry.changedAt >= 90) {
      this.completedEntries.set(this.entry.key, tick + 150);
      this.entry = undefined;
    }
    if (!this.entry && order.posture !== 'retreat' && members.length > 1) {
      const candidates = assignments
        .flatMap((assignment) => {
          const lead = members.find((m) => m.id === assignment.agentId);
          if (!lead || !eligible(lead) || (this.approaches.get(lead.id)?.index ?? 0) < 2) {
            return [];
          }
          const path = findPath(map, lead.position, assignment.position);
          const corner = path[0],
            ahead = path[1];
          if (!corner || !ahead) {
            return [];
          }
          const range = distance(lead.position, corner);
          if (range > 8 || range < 2 || hasLineOfSight(map, eye(lead.position), eye(ahead))) {
            return [];
          }
          const key = `${lead.id}:${Math.round(corner.x * 2)}:${Math.round(corner.z * 2)}`;
          if (this.completedEntries.has(key)) {
            return [];
          }
          const sameRoute = this.approaches.get(lead.id)?.key;
          const buddies = members
            .filter(
              (friend) =>
                friend.id !== lead.id &&
                eligible(friend) &&
                this.approaches.get(friend.id)?.key === sameRoute,
            )
            .sort(
              (a, b) =>
                distance(a.position, lead.position) - distance(b.position, lead.position) ||
                a.id.localeCompare(b.id),
            );
          const buddy = buddies[0];
          if (!buddy) {
            return [];
          }
          if (
            distance(lead.position, buddy.position) <= 3.5 &&
            hasLineOfSight(map, eye(lead.position), eye(buddy.position))
          ) {
            return [];
          }
          const desired = {
            x: corner.x + ((lead.position.x - corner.x) * 3) / range,
            y: corner.y + ((lead.position.y - corner.y) * 3) / range,
            z: corner.z + ((lead.position.z - corner.z) * 3) / range,
          };
          const stage = map.nodes
            .filter(
              (node) =>
                nodeAvailable(node, lead.id) &&
                outsideEntry(node) &&
                distance(node.position, corner) >= 2.4 &&
                distance(node.position, corner) <= 6 &&
                distance(node.position, desired) < 2.8 &&
                canTraverse(map, lead.position, node.position, 0.4) &&
                canTraverse(map, node.position, corner, 0.4),
            )
            .sort(
              (a, b) =>
                distance(a.position, desired) - distance(b.position, desired) ||
                b.cover - a.cover ||
                a.id.localeCompare(b.id),
            )[0];
          return stage ? [{ buddy, corner, key, lead, range, stage }] : [];
        })
        .sort((a, b) => a.range - b.range || a.lead.id.localeCompare(b.lead.id));
      const selected = candidates[0];
      if (selected) {
        this.entry = {
          buddyId: selected.buddy.id,
          changedAt: tick,
          corner: { ...selected.corner },
          key: selected.key,
          leadId: selected.lead.id,
          stageId: selected.stage.id,
          startedAt: tick,
          state: 'waiting',
        };
      }
    }
    const contract = this.entry;
    if (!contract) {
      return idle;
    }
    const lead = members.find((m) => m.id === contract.leadId)!,
      buddy = members.find((m) => m.id === contract.buddyId)!;
    const pairReady =
      eligible(buddy) &&
      distance(lead.position, buddy.position) <= 3.5 &&
      hasLineOfSight(map, eye(lead.position), eye(buddy.position));
    if (contract.state !== 'ready' && pairReady) {
      contract.state = 'ready';
      contract.changedAt = tick;
    }
    if (contract.state === 'waiting' && tick - contract.startedAt >= 120) {
      const returnNode = followNode(lead, buddy.position);
      if (returnNode) {
        contract.stageId = returnNode.id;
      }
      contract.state = 'repair';
      contract.changedAt = tick;
    }
    const stage = map.nodes.find((node) => node.id === contract.stageId);
    if (contract.state !== 'ready') {
      redirect(lead.id, stage);
    }
    redirect(
      buddy.id,
      followNode(
        buddy,
        contract.state === 'ready' ? lead.position : (stage?.position ?? lead.position),
      ),
    );
    if (contract.state === 'ready') {
      for (const member of [...members].sort(
        (a, b) =>
          distance(a.position, contract.corner) - distance(b.position, contract.corner) ||
          a.id.localeCompare(b.id),
      )) {
        if (this.approaches.get(member.id)?.key !== this.approaches.get(lead.id)?.key) {
          continue;
        }
        const assignment = assignments.find((a) => a.agentId === member.id);
        if (!assignment) {
          continue;
        }
        const path = findPath(map, member.position, assignment.position);
        const corner = path[0],
          ahead = path[1];
        if (
          !corner ||
          !ahead ||
          distance(member.position, corner) > 6 ||
          hasLineOfSight(map, eye(member.position), eye(ahead))
        ) {
          continue;
        }
        const length = distance(corner, ahead);
        const preview = {
          x: corner.x + (ahead.x - corner.x) * Math.min(1, 1 / length),
          y: corner.y + (ahead.y - corner.y) * Math.min(1, 1 / length),
          z: corner.z + (ahead.z - corner.z) * Math.min(1, 1 / length),
        };
        const supported = members.some(
          (friend) =>
            friend.id !== member.id &&
            eligible(friend) &&
            distance(friend.position, preview) <= 4.5 &&
            hasLineOfSight(map, eye(friend.position), eye(preview)),
        );
        if (supported) {
          continue;
        }
        const safe = map.nodes
          .filter(
            (node) =>
              nodeAvailable(node, member.id) &&
              outsideEntry(node) &&
              distance(node.position, corner) < 4 &&
              canTraverse(map, member.position, node.position, 0.4) &&
              canTraverse(map, node.position, corner, 0.4) &&
              !hasLineOfSight(map, eye(node.position), eye(ahead)),
          )
          .sort(
            (a, b) =>
              distance(a.position, corner) - distance(b.position, corner) ||
              a.id.localeCompare(b.id),
          )[0];
        redirect(member.id, safe);
      }
    }
    if (contract.state === 'repair' && tick - contract.changedAt >= 120) {
      this.completedEntries.set(contract.key, tick + 120);
      this.entry = undefined;
      return { ...idle, constraints: [`regroup:${lead.id}:replan:partner-unreachable`] };
    }
    return {
      active: true,
      constraints: [
        contract.state === 'repair'
          ? `regroup:${lead.id}:replan:timeout`
          : `regroup:${lead.id}:${contract.state}:${buddy.id}`,
        `entry-buddy:${buddy.id}`,
        'buddy-ready-before-blind-entry',
      ],
      ready: contract.state === 'ready',
      repair: contract.state === 'repair',
    };
  }
}
