import { DEFAULT_QUERY_FILTER } from 'navcat';
import { crowd, pathCorridor } from 'navcat/blocks';
import type { NavigationMesh, NavigationPoint } from './navigation';

export type NavigationCrowdAgent = {
  controlled?: boolean;
  id: string;
  maxSpeed: number;
  position: NavigationPoint;
  preferredVelocity: NavigationPoint;
  velocity: NavigationPoint;
};
export interface NavigationCrowd {
  dispose(): void;
  update(
    agents: ReadonlyArray<NavigationCrowdAgent>,
    deltaSeconds: number,
  ): Map<string, NavigationPoint>;
}

const copy = (point: NavigationPoint): [number, number, number] => [point[0], point[1], point[2]];
const magnitude = (point: NavigationPoint) => Math.hypot(point[0], point[1], point[2]);
const boundedVelocity = (velocity: NavigationPoint, maxSpeed: number): NavigationPoint => {
  if (!velocity.every(Number.isFinite) || !Number.isFinite(maxSpeed) || maxSpeed < 0) {
    return [0, 0, 0];
  }
  const speed = magnitude(velocity);
  const scale = speed > maxSpeed && speed > 0 ? maxSpeed / speed : 1;
  return [velocity[0] * scale, velocity[1] * scale, velocity[2] * scale];
};

export function createNavigationCrowd(navigation: NavigationMesh): NavigationCrowd {
  let state = crowd.create(navigation.options.radius);
  let revision = navigation.revision;
  let disposed = false;
  const members = new Map<string, string>();
  state.maxIterationsPerUpdate = 600;
  state.maxIterationsPerAgent = 200;
  state.quickSearchIterations = 20;
  const remove = (id: string) => {
    const key = members.get(id);
    if (key !== undefined) {
      crowd.removeAgent(state, key);
      members.delete(id);
    }
  };
  return {
    dispose: () => {
      if (disposed) {
        return;
      }
      for (const id of members.keys()) {
        remove(id);
      }
      disposed = true;
    },
    update: (inputs, deltaSeconds) => {
      if (disposed) {
        throw new Error('Navigation crowd has been disposed');
      }
      if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0 || deltaSeconds > 0.1) {
        throw new Error('Navigation crowd requires a fixed step in (0, 0.1] seconds');
      }
      if (navigation.revision !== revision) {
        state = crowd.create(navigation.options.radius);
        members.clear();
        revision = navigation.revision;
      }
      const agents = [...inputs];
      const active = new Set<string>();
      for (const input of agents) {
        if (!input.id || active.has(input.id)) {
          throw new Error('Navigation crowd requires unique nonempty agent identifiers');
        }
        active.add(input.id);
      }
      for (const id of members.keys()) {
        if (!active.has(id)) {
          remove(id);
        }
      }
      const preferred = new Map<string, NavigationPoint>();
      for (const input of agents) {
        const targetVelocity = boundedVelocity(input.preferredVelocity, input.maxSpeed);
        preferred.set(input.id, targetVelocity);
        const placement = navigation.project(input.position);
        if (!placement || !input.velocity.every(Number.isFinite)) {
          remove(input.id);
          continue;
        }
        let key = members.get(input.id);
        let agent = key === undefined ? undefined : state.agents[key];
        if (
          agent &&
          !pathCorridor.movePosition(
            agent.corridor,
            copy(placement.position),
            navigation.navMesh,
            DEFAULT_QUERY_FILTER,
          )
        ) {
          remove(input.id);
          key = undefined;
          agent = undefined;
        }
        if (!agent) {
          key = crowd.addAgent(state, navigation.navMesh, copy(placement.position), {
            autoTraverseOffMeshConnections: false,
            collisionQueryRange: navigation.options.radius * 12,
            height: navigation.options.height,
            maxAcceleration: 18,
            maxSpeed: Number.isFinite(input.maxSpeed) && input.maxSpeed >= 0 ? input.maxSpeed : 0,
            pathOptimizationRange: navigation.options.radius * 30,
            queryFilter: DEFAULT_QUERY_FILTER,
            radius: navigation.options.radius,
            separationWeight: 1.5,
            updateFlags:
              crowd.CrowdUpdateFlags.ANTICIPATE_TURNS |
              crowd.CrowdUpdateFlags.OBSTACLE_AVOIDANCE |
              crowd.CrowdUpdateFlags.SEPARATION,
          });
          members.set(input.id, key);
          agent = state.agents[key];
        }
        if (!agent || key === undefined) {
          remove(input.id);
          continue;
        }
        agent.position = copy(placement.position);
        agent.velocity = copy(boundedVelocity(input.velocity, input.maxSpeed));
        agent.maxSpeed =
          Number.isFinite(input.maxSpeed) && input.maxSpeed >= 0 ? input.maxSpeed : 0;
        agent.separationWeight = magnitude(targetVelocity) > 0.001 && !input.controlled ? 1.5 : 0;
        agent.updateFlags = input.controlled
          ? 0
          : crowd.CrowdUpdateFlags.ANTICIPATE_TURNS |
            crowd.CrowdUpdateFlags.OBSTACLE_AVOIDANCE |
            crowd.CrowdUpdateFlags.SEPARATION;
        crowd.requestMoveVelocity(state, key, copy(targetVelocity));
      }
      crowd.update(state, navigation.navMesh, deltaSeconds);
      const velocities = new Map<string, NavigationPoint>();
      for (const input of agents) {
        const requested = preferred.get(input.id)!;
        if (input.controlled) {
          velocities.set(input.id, copy(requested));
          continue;
        }
        const key = members.get(input.id);
        const agent = key === undefined ? undefined : state.agents[key];
        if (!agent || magnitude(requested) <= 0.001 || agent.state !== crowd.AgentState.WALKING) {
          velocities.set(input.id, [0, 0, 0]);
          continue;
        }
        const velocity = boundedVelocity(agent.newVelocity, input.maxSpeed);
        const destination: NavigationPoint = [
          input.position[0] + velocity[0] * deltaSeconds,
          input.position[1] + velocity[1] * deltaSeconds,
          input.position[2] + velocity[2] * deltaSeconds,
        ];
        velocities.set(
          input.id,
          navigation.canTraverse(input.position, destination) ? copy(velocity) : [0, 0, 0],
        );
      }
      return velocities;
    },
  };
}
