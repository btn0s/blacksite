import { AGENT_RADIUS, type RuntimeWorld, type Vec3 } from './index';
const fail = (path: string, reason: string): never => {
  throw new Error(`Invalid runtime world: ${path} ${reason}`);
};
const object = (value: unknown, path: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(path, 'must be an object');
  }
  return value as Record<string, unknown>;
};
const number = (value: unknown, path: string, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    return fail(path, `must be finite in [${min}, ${max}]`);
  }
  return value;
};
const integer = (value: unknown, path: string, min: number, max: number): number => {
  const result = number(value, path, min, max);
  if (!Number.isInteger(result)) {
    return fail(path, 'must be an integer');
  }
  return result;
};
const text = (value: unknown, path: string, max = 128): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    return fail(path, `must be a nonempty string of at most${max} characters`);
  }
  return value;
};
const list = (value: unknown, path: string, min: number, max: number): Array<unknown> => {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    return fail(path, `must contain ${min}–${max} items`);
  }
  return value;
};
function serializable(value: unknown, ancestors = new Set<object>()): void {
  if (
    value === undefined ||
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return;
  }
  if (typeof value !== 'object' || !value) {
    fail('payload', 'must contain only serializable JSON data');
  }
  const record = value as object;
  if (ancestors.has(record)) {
    fail('payload', 'must not contain cycles');
  }
  const prototype = Object.getPrototypeOf(record);
  if (!Array.isArray(record) && prototype !== Object.prototype && prototype !== null) {
    fail('payload', 'must contain plain objects');
  }
  if (Object.getOwnPropertySymbols(record).length) {
    fail('payload', 'must not contain symbol keys');
  }
  ancestors.add(record);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(record))) {
    if (descriptor.get || descriptor.set) {
      fail('payload', 'must not contain accessors');
    }
    if (Array.isArray(record) && key === 'length') {
      continue;
    }
    serializable(descriptor.value, ancestors);
  }
  ancestors.delete(record);
}
export function validateRuntimeWorld(
  value: unknown,
  agentsPerTeam: number,
  externalAuthority = false,
): RuntimeWorld {
  integer(agentsPerTeam, 'agentsPerTeam', 1, 8);
  serializable(value);
  const world = object(value, 'world'),
    map = object(world.map, 'map');
  text(map.id, 'map.id');
  text(map.version, 'map.version');
  text(map.name, 'map.name', 256);
  const width = number(map.width, 'map.width', 4, 2048),
    depth = number(map.depth, 'map.depth', 4, 2048);
  const position = (value: unknown, path: string, clearance = 0): Vec3 => {
    const point = object(value, path);
    const x = number(point.x, `${path}.x`, -width / 2 + clearance, width / 2 - clearance);
    const z = number(point.z, `${path}.z`, -depth / 2 + clearance, depth / 2 - clearance);
    const y = number(
      point.y,
      `${path}.y`,
      externalAuthority ? -2048 : 0,
      externalAuthority ? 2048 : 0,
    );
    return { x, y, z };
  };
  const unique = (items: Array<unknown>, path: string): Map<string, Record<string, unknown>> => {
    const result = new Map<string, Record<string, unknown>>();
    for (const value of items) {
      const item = object(value, path),
        id = text(item.id, `${path}.id`);
      if (result.has(id)) {
        fail(path, `contains duplicate id ${id}`);
      }
      result.set(id, item);
    }
    return result;
  };
  const obstacles = unique(list(map.obstacles, 'map.obstacles', 0, 2048), 'obstacles');
  for (const [id, obstacle] of obstacles) {
    number(obstacle.x, `obstacle ${id}.x`, -width / 2, width / 2);
    number(obstacle.z, `obstacle ${id}.z`, -depth / 2, depth / 2);
    number(obstacle.width, `obstacle ${id}.width`, 0.001, width);
    number(obstacle.depth, `obstacle ${id}.depth`, 0.001, depth);
    number(obstacle.height, `obstacle ${id}.height`, 0.001, 100);
  }
  const traversable = (point: Vec3, path: string) => {
    if (externalAuthority) {
      return;
    }
    for (const obstacle of obstacles.values()) {
      if (
        Math.abs(point.x - Number(obstacle.x)) < Number(obstacle.width) / 2 + AGENT_RADIUS &&
        Math.abs(point.z - Number(obstacle.z)) < Number(obstacle.depth) / 2 + AGENT_RADIUS
      ) {
        fail(path, 'overlaps a solid obstacle');
      }
    }
  };
  const regions = unique(
    list(map.regions, 'map.regions', 1, externalAuthority ? 2048 : 256),
    'regions',
  );
  const nodes = unique(list(map.nodes, 'map.nodes', 1, 2048), 'nodes');
  const references = (value: unknown, path: string, available: Map<string, unknown>) => {
    const seen = new Set<string>();
    for (const ref of list(value, path, 0, available.size)) {
      const id = text(ref, path);
      if (!available.has(id) || seen.has(id)) {
        fail(path, `contains unknown or duplicate reference ${id}`);
      }
      seen.add(id);
    }
  };
  for (const [id, region] of regions) {
    text(region.name, `region ${id}.name`, 256);
    position(region.center, `region ${id}.center`);
    references(region.neighbors, `region ${id}.neighbors`, regions);
  }
  const kinds = new Set(['cover', 'entry', 'overwatch', 'objective', 'rally', 'search']);
  for (const [id, node] of nodes) {
    const point = position(node.position, `node ${id}.position`, AGENT_RADIUS);
    traversable(point, `node ${id}`);
    if (!regions.has(text(node.regionId, `node ${id}.regionId`))) {
      fail(`node ${id}`, 'references an unknown region');
    }
    if (!kinds.has(String(node.kind))) {
      fail(`node ${id}.kind`, 'is unknown');
    }
    number(node.cover, `node ${id}.cover`, 0, 1);
    number(node.exposure, `node ${id}.exposure`, 0, 1);
    integer(node.capacity, `node ${id}.capacity`, 1, 8);
    references(node.neighbors, `node ${id}.neighbors`, nodes);
  }
  const objectives = unique(list(map.objectives, 'map.objectives', 1, 64), 'objectives');
  for (const [id, objective] of objectives) {
    const point = position(objective.position, `objective ${id}.position`, AGENT_RADIUS);
    traversable(point, `objective ${id}`);
    if (!regions.has(text(objective.regionId, `objective ${id}.regionId`))) {
      fail(`objective ${id}`, 'references an unknown region');
    }
  }
  const spawns = object(map.spawns, 'map.spawns'),
    positions: Array<Vec3> = [],
    agentIds = new Set<string>();
  for (const team of ['alpha', 'bravo'] as const) {
    const starts = list(
      spawns[team],
      `spawns.${team}`,
      externalAuthority ? 0 : agentsPerTeam,
      externalAuthority ? 1024 : agentsPerTeam,
    );
    for (let index = 0; index < starts.length; index++) {
      const id = `${team}-${index + 1}`,
        point = position(starts[index], `spawn ${id}`, AGENT_RADIUS);
      traversable(point, `spawn ${id}`);
      if (
        !externalAuthority &&
        positions.some(
          (other) => Math.hypot(other.x - point.x, other.z - point.z) < AGENT_RADIUS * 2,
        )
      ) {
        fail(`spawn ${id}`, 'overlaps another agent');
      }
      positions.push(point);
      agentIds.add(id);
    }
  }
  if (world.rules !== undefined) {
    const rules = object(world.rules, 'rules');
    if (rules.damage !== undefined) {
      number(rules.damage, 'rules.damage', 1, 100);
    }
    if (rules.spread !== undefined) {
      number(rules.spread, 'rules.spread', 0, 0.5);
    }
    if (rules.suppressedSpread !== undefined) {
      number(rules.suppressedSpread, 'rules.suppressedSpread', 0, 0.5);
    }
  }
  if (world.initialAmmo !== undefined) {
    integer(world.initialAmmo, 'initialAmmo', 0, 24);
  }
  if (world.initialHealth !== undefined) {
    for (const [id, health] of Object.entries(object(world.initialHealth, 'initialHealth'))) {
      if (!agentIds.has(id)) {
        fail('initialHealth', `references unknown agent ${id}`);
      }
      number(health, `initialHealth.${id}`, 0, 100);
    }
  }
  return structuredClone(value) as RuntimeWorld;
}
