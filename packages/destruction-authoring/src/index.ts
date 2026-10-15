import type { DestructibleManifest } from '../../destruction-domain/src/index';

export interface ValidationIssue {
  message: string;
  path: string;
}
export interface ValidationResult {
  errors: Array<ValidationIssue>;
  stats: {
    anchors: number;
    bonds: number;
    fragments: number;
    mass: number;
    regions: number;
  };
  valid: boolean;
  warnings: Array<ValidationIssue>;
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const positive = (value: unknown): value is number => finite(value) && value > 0;
const id = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const vector = (value: unknown): value is [number, number, number] =>
  Array.isArray(value) && value.length === 3 && value.every(finite);
const dot = (a: Array<number>, b: Array<number>) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const subtract = (a: Array<number>, b: Array<number>) => a.map((value, axis) => value - b[axis]!);
const cross = (a: Array<number>, b: Array<number>) => [
  a[1]! * b[2]! - a[2]! * b[1]!,
  a[2]! * b[0]! - a[0]! * b[2]!,
  a[0]! * b[1]! - a[1]! * b[0]!,
];

function validateShape(
  shape: unknown,
  path: string,
  size: unknown,
  error: (path: string, message: string) => void,
): Array<[number, number, number]> | undefined {
  if (!record(shape)) {
    error(path, 'Expected a convex shape object');
    return;
  }
  if (!positive(shape.volume)) {
    error(`${path}.volume`, 'Expected positive finite volume');
  }
  if (!Array.isArray(shape.inertia) || shape.inertia.length !== 6 || !shape.inertia.every(finite)) {
    error(`${path}.inertia`, 'Expected six finite inertia tensor entries');
  } else {
    const [xx, yy, zz, xy, xz, yz] = shape.inertia as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const determinant =
      xx * yy * zz + 2 * xy * xz * yz - xx * yz * yz - yy * xz * xz - zz * xy * xy;
    if (!(xx > 0 && xx * yy - xy * xy > 0 && determinant > 0)) {
      error(`${path}.inertia`, 'Inertia tensor must be positive definite');
    }
  }
  if (
    !Array.isArray(shape.vertices) ||
    shape.vertices.length < 4 ||
    shape.vertices.length > 256 ||
    !shape.vertices.every(vector)
  ) {
    error(`${path}.vertices`, 'Expected 4–256 finite three-component convex hull vertices');
    return;
  }
  const vertices = shape.vertices;
  if (
    vector(size) &&
    vertices.some((vertex) =>
      vertex.some((value, axis) => Math.abs(value) > size[axis]! / 2 + 1e-6),
    )
  ) {
    error(`${path}.vertices`, 'Vertices must fit inside the conservative fragment size');
  }
  if (!Array.isArray(shape.faces) || shape.faces.length < 4 || shape.faces.length > 512) {
    error(`${path}.faces`, 'Expected 4–512 outward-wound convex polygon faces');
    return vertices;
  }
  const edges = new Map<string, { count: number; orientation: number }>();
  let volume = 0,
    first = [0, 0, 0];
  const scale = Math.max(1, ...vertices.flat().map(Math.abs));
  shape.faces.forEach((face, index) => {
    const facePath = `${path}.faces[${index}]`;
    if (
      !record(face) ||
      !Array.isArray(face.vertices) ||
      face.vertices.length < 3 ||
      face.vertices.length > 64 ||
      face.vertices.some((vertex) => !id(vertex) || vertex >= vertices.length) ||
      new Set(face.vertices).size !== face.vertices.length
    ) {
      error(facePath, 'Expected a polygon with 3–64 distinct valid vertex indices');
      return;
    }
    if (face.surface !== 'exterior' && face.surface !== 'fracture') {
      error(`${facePath}.surface`, 'Expected exterior or fracture');
    }
    const indices = face.vertices as Array<number>;
    const points = indices.map((vertex) => vertices[vertex]!);
    let normal = [0, 0, 0];
    for (let triangle = 1; triangle + 1 < points.length; triangle++) {
      const n = cross(
        subtract(points[triangle]!, points[0]!),
        subtract(points[triangle + 1]!, points[0]!),
      );
      normal = normal.map((value, axis) => value + n[axis]!);
      const tetra = dot(points[0]!, cross(points[triangle]!, points[triangle + 1]!)) / 6;
      volume += tetra;
      first = first.map(
        (value, axis) =>
          value +
          (tetra * (points[0]![axis]! + points[triangle]![axis]! + points[triangle + 1]![axis]!)) /
            4,
      );
    }
    const magnitude = Math.hypot(...normal);
    if (!(magnitude > 1e-12)) {
      error(facePath, 'Face must have nonzero area');
    } else {
      normal = normal.map((value) => value / magnitude);
      if (
        points.some((point) => Math.abs(dot(normal, subtract(point, points[0]!))) > 1e-6 * scale)
      ) {
        error(facePath, 'Face must be planar');
      }
      if (vertices.some((point) => dot(normal, subtract(point, points[0]!)) > 1e-6 * scale)) {
        error(facePath, 'Faces must be outward-wound and bound a convex volume');
      }
    }
    indices.forEach((a, edge) => {
      const b = indices[(edge + 1) % indices.length]!,
        key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      const previous = edges.get(key) ?? { count: 0, orientation: 0 };
      edges.set(key, {
        count: previous.count + 1,
        orientation: previous.orientation + (a < b ? 1 : -1),
      });
    });
  });
  if ([...edges.values()].some((edge) => edge.count !== 2 || edge.orientation !== 0)) {
    error(`${path}.faces`, 'Faces must form a closed, consistently wound manifold');
  }
  if (
    positive(shape.volume) &&
    Math.abs(volume - shape.volume) > Math.max(1e-7, shape.volume * 1e-5)
  ) {
    error(`${path}.volume`, 'Volume must match the closed hull');
  }
  if (volume > 0 && Math.hypot(...first) / volume > 1e-5 * scale) {
    error(`${path}.vertices`, 'Convex geometry must be centered at its center of mass');
  }
  return vertices;
}

export function validateManifest(
  input: unknown,
  options: { requireSupported?: boolean } = {},
): ValidationResult {
  const errors: Array<ValidationIssue> = [],
    warnings: Array<ValidationIssue> = [];
  const stats = { anchors: 0, bonds: 0, fragments: 0, mass: 0, regions: 0 };
  const error = (path: string, message: string) => errors.push({ message, path });
  const finish = () => ({
    errors,
    stats,
    valid: errors.length === 0,
    warnings,
  });
  if (!record(input)) {
    error('$', 'Manifest must be an object');
    return finish();
  }
  if (input.schemaVersion !== 1) {
    error('schemaVersion', 'Only schema version 1 is supported');
  }
  if (input.coordinateSystem !== 'Y_UP_RH') {
    error('coordinateSystem', 'Expected Y_UP_RH');
  }
  if (
    typeof input.assetHash !== 'string' ||
    !input.assetHash.trim() ||
    input.assetHash.length > 128
  ) {
    error('assetHash', 'A content hash of 1–128 characters is required');
  }
  if (typeof input.name !== 'string' || !input.name.trim()) {
    error('name', 'A non-empty name is required');
  }
  if (!['building', 'wall', 'cantilever', 'bridge', 'complex'].includes(String(input.scenario))) {
    error('scenario', 'Unknown scenario');
  }
  if (input.level !== undefined) {
    const level = input.level;
    if (!record(level)) {
      error('level', 'Expected a level definition');
    } else {
      if (!record(level.spawn) || !vector(level.spawn.position) || !finite(level.spawn.yaw)) {
        error('level.spawn', 'Expected a finite feet position and yaw');
      }
      if (!record(level.camera) || !vector(level.camera.position) || !vector(level.camera.target)) {
        error('level.camera', 'Expected a finite overview position and target');
      }
      if (!Array.isArray(level.boxes) || level.boxes.length > 4096) {
        error('level.boxes', 'Expected up to 4,096 context boxes');
      } else {
        const names = new Set<string>();
        level.boxes.forEach((box: unknown, index: number) => {
          const path = `level.boxes[${index}]`;
          if (!record(box)) {
            error(path, 'Expected a box');
            return;
          }
          if (typeof box.id !== 'string' || !box.id || names.has(box.id)) {
            error(`${path}.id`, 'Expected a unique nonempty ID');
          } else {
            names.add(box.id);
          }
          if (!vector(box.position) || !vector(box.size) || !box.size.every(positive)) {
            error(path, 'Expected finite position and positive size');
          }
          if (
            box.rotation !== undefined &&
            (!Array.isArray(box.rotation) ||
              box.rotation.length !== 4 ||
              !box.rotation.every(finite) ||
              Math.abs(Math.hypot(...box.rotation) - 1) > 1e-5)
          ) {
            error(`${path}.rotation`, 'Expected a unit xyzw quaternion');
          }
          if (
            box.color !== undefined &&
            (typeof box.color !== 'string' || !box.color.trim() || box.color.length > 128)
          ) {
            error(`${path}.color`, 'Expected a nonempty color string up to 128 characters');
          }
          if (typeof box.collidable !== 'boolean') {
            error(`${path}.collidable`, 'Expected a boolean');
          }
          if (
            !['boardConcrete', 'concrete', 'metal', 'paint', 'asphalt', 'glass'].includes(
              String(box.material),
            )
          ) {
            error(`${path}.material`, 'Unknown context material');
          }
        });
      }
      for (const kind of ['signs', 'lights'] as const) {
        const entries = level[kind];
        if (entries === undefined) {
          continue;
        }
        if (!Array.isArray(entries) || entries.length > 256) {
          error(`level.${kind}`, 'Expected up to 256 items');
          continue;
        }
        entries.forEach((entry: unknown, index: number) => {
          const path = `level.${kind}[${index}]`;
          if (!record(entry) || !vector(entry.position)) {
            error(path, 'Expected finite position');
            return;
          }
          if (
            kind === 'signs' &&
            (typeof entry.text !== 'string' ||
              !entry.text.trim() ||
              entry.text.length > 512 ||
              !positive(entry.width) ||
              !positive(entry.height) ||
              (entry.rotation !== undefined && !vector(entry.rotation)))
          ) {
            error(path, 'Expected text, positive size, and optional Euler rotation');
          }
          for (const key of ['color', 'background']) {
            if (
              entry[key] !== undefined &&
              (typeof entry[key] !== 'string' || !entry[key].trim() || entry[key].length > 128)
            ) {
              error(`${path}.${key}`, 'Expected a nonempty color string up to 128 characters');
            }
          }
          if (
            kind === 'lights' &&
            (typeof entry.color !== 'string' ||
              !positive(entry.distance) ||
              !positive(entry.intensity))
          ) {
            error(path, 'Expected light color, positive distance and intensity');
          }
        });
      }
    }
  }
  for (const key of ['fragments', 'bonds', 'materials', 'regions']) {
    if (!Array.isArray(input[key])) {
      error(key, 'Expected an array');
    }
  }
  if (errors.some((issue) => ['fragments', 'bonds', 'materials', 'regions'].includes(issue.path))) {
    return finish();
  }
  const fragments = input.fragments as Array<unknown>,
    bonds = input.bonds as Array<unknown>,
    materials = input.materials as Array<unknown>,
    regions = input.regions as Array<unknown>;
  stats.fragments = fragments.length;
  stats.bonds = bonds.length;
  stats.regions = regions.length;
  if (fragments.length === 0 || fragments.length > 50_000) {
    error('fragments', 'Fragment count must be between 1 and 50,000');
  }
  if (bonds.length > 500_000) {
    error('bonds', 'Bond count exceeds 500,000');
  }
  if (!materials.length || materials.length > 256) {
    error('materials', 'Material count must be between 1 and 256');
  }
  if (!regions.length || regions.length > 4096) {
    error('regions', 'Region count must be between 1 and 4,096');
  }
  if (
    fragments.length > 50_000 ||
    bonds.length > 500_000 ||
    materials.length > 256 ||
    regions.length > 4096
  ) {
    return finish();
  }
  function collect(values: Array<unknown>, key: string): Map<number, Record<string, unknown>> {
    const found = new Map<number, Record<string, unknown>>();
    values.forEach((value, index) => {
      if (!record(value)) {
        error(`${key}[${index}]`, 'Expected an object');
        return;
      }
      if (!id(value.id)) {
        error(`${key}[${index}].id`, 'Expected a nonnegative safe integer');
      } else if (found.has(value.id)) {
        error(`${key}[${index}].id`, `Duplicate ID ${value.id}`);
      } else {
        found.set(value.id, value);
      }
    });
    return found;
  }
  const fragmentMap = collect(fragments, 'fragments'),
    materialMap = collect(materials, 'materials'),
    regionMap = collect(regions, 'regions');
  collect(bonds, 'bonds');
  materials.forEach((material, index) => {
    if (!record(material)) {
      return;
    }
    const path = `materials[${index}]`;
    if (typeof material.name !== 'string' || !material.name.trim()) {
      error(`${path}.name`, 'Expected a material name');
    }
    if (typeof material.color !== 'string' || !/^#[\da-f]{6}$/i.test(material.color)) {
      error(`${path}.color`, 'Expected a six-digit hexadecimal color');
    }
    for (const key of ['density', 'strength']) {
      if (!positive(material[key])) {
        error(`${path}.${key}`, 'Expected a positive finite value');
      }
    }
    for (const key of ['minDamageThreshold', 'maxDamageThreshold']) {
      if (material[key] !== undefined && (!finite(material[key]) || material[key] < 0 || material[key] > 1)) error(`${path}.${key}`, 'Expected normalized damage threshold in [0, 1]');
    }
    if (material.health !== undefined && !positive(material.health)) error(`${path}.health`, 'Expected positive chunk health');
    if (finite(material.minDamageThreshold) && finite(material.maxDamageThreshold) && material.minDamageThreshold > material.maxDamageThreshold) error(path, 'Minimum damage threshold exceeds maximum');
    for (const key of ['brittleness', 'friction']) {
      if (!finite(material[key]) || material[key] < 0 || material[key] > 1) {
        error(`${path}.${key}`, 'Expected a finite value in [0, 1]');
      }
    }
    if (
      material.youngModulus !== undefined &&
      (!finite(material.youngModulus) ||
        material.youngModulus < 1e3 ||
        material.youngModulus > 1e13)
    ) {
      error(`${path}.youngModulus`, "Expected Young's modulus in [1e3, 1e13] Pa");
    }
    if (
      material.poissonRatio !== undefined &&
      (!finite(material.poissonRatio) || material.poissonRatio < 0 || material.poissonRatio > 0.49)
    ) {
      error(`${path}.poissonRatio`, 'Expected a finite Poisson ratio in [0, 0.49]');
    }
    for (const key of [
      'tensionStrength',
      'compressionStrength',
      'shearStrength',
      'bendingStrength',
    ]) {
      if (material[key] !== undefined && (!positive(material[key]) || material[key] > 1e13)) {
        error(`${path}.${key}`, 'Expected a finite stress strength in (0, 1e13] Pa');
      }
    }
  });
  regions.forEach((region, index) => {
    if (!record(region)) {
      return;
    }
    const path = `regions[${index}]`;
    if (typeof region.name !== 'string' || !region.name.trim()) {
      error(`${path}.name`, 'Expected a region name');
    }
    if (!vector(region.min) || !vector(region.max)) {
      error(path, 'Bounds must be finite three-component vectors');
    } else if (region.min.some((value, axis) => value >= (region.max as Array<number>)[axis]!)) {
      error(path, 'Each minimum must be less than its maximum');
    }
  });
  fragments.forEach((fragment, index) => {
    if (!record(fragment)) {
      return;
    }
    const path = `fragments[${index}]`;
    if (!vector(fragment.position)) {
      error(`${path}.position`, 'Expected a finite three-component vector');
    }
    if (!vector(fragment.size) || fragment.size.some((value) => value <= 0)) {
      error(`${path}.size`, 'All dimensions must be positive and finite');
    }
    if (!positive(fragment.mass)) {
      error(`${path}.mass`, 'Mass must be positive and finite');
    } else {
      if (fragment.support !== false) stats.mass += fragment.mass;
    }
    if (!id(fragment.material) || !materialMap.has(fragment.material)) {
      error(`${path}.material`, 'Unknown material ID');
    }
    if (!id(fragment.region) || !regionMap.has(fragment.region)) {
      error(`${path}.region`, 'Unknown region ID');
    }
    if (!id(fragment.aggregate)) {
      error(`${path}.aggregate`, 'Expected a nonnegative aggregate ID');
    }
    if (fragment.parent !== undefined && fragment.parent !== -1 && (!id(fragment.parent) || !fragmentMap.has(fragment.parent))) {
      error(`${path}.parent`, 'Unknown parent chunk ID');
    }
    if (fragment.depth !== undefined && (!id(fragment.depth) || fragment.depth > 64)) {
      error(`${path}.depth`, 'Expected hierarchy depth in [0, 64]');
    }
    if (fragment.support !== undefined && typeof fragment.support !== 'boolean') {
      error(`${path}.support`, 'Expected a support flag');
    }
    if (typeof fragment.anchored !== 'boolean') {
      error(`${path}.anchored`, 'Expected a boolean');
    }
    if (fragment.anchored === true) {
      stats.anchors++;
    }
    const shapeVertices =
      fragment.shape === undefined
        ? undefined
        : validateShape(fragment.shape, `${path}.shape`, fragment.size, error);
    const region = id(fragment.region) ? regionMap.get(fragment.region) : undefined;
    if (
      vector(fragment.position) &&
      vector(fragment.size) &&
      region &&
      vector(region.min) &&
      vector(region.max)
    ) {
      const position = fragment.position,
        size = fragment.size,
        min = region.min,
        max = region.max;
      if (
        shapeVertices
          ? shapeVertices.some((vertex) =>
              vertex.some(
                (value, axis) =>
                  position[axis]! + value < min[axis]! - 0.001 ||
                  position[axis]! + value > max[axis]! + 0.001,
              ),
            )
          : position.some(
              (p, axis) =>
                p - size[axis]! / 2 < min[axis]! - 0.001 ||
                p + size[axis]! / 2 > max[axis]! + 0.001,
            )
      ) {
        error(`${path}.region`, 'Fragment bounds lie outside its region');
      }
    }
  });
  const adjacency = new Map<number, Array<number>>();
  for (const fragmentId of fragmentMap.keys()) {
    adjacency.set(fragmentId, []);
  }
  const pairs = new Set<string>();
  bonds.forEach((bond, index) => {
    if (!record(bond)) {
      return;
    }
    const path = `bonds[${index}]`;
    if (!id(bond.a) || !fragmentMap.has(bond.a)) {
      error(`${path}.a`, 'Unknown fragment ID');
    }
    if (bond.b !== -1 && (!id(bond.b) || !fragmentMap.has(bond.b))) {
      error(`${path}.b`, 'Unknown fragment ID');
    }
    if (input.supportDepth !== undefined && [bond.a, bond.b].some((endpoint) => endpoint !== -1 && fragmentMap.get(endpoint as number)?.support !== true)) {
      error(path, 'Bonds must join support chunks');
    }
    if (bond.b === -1 && id(bond.a)) stats.anchors++;
    if (bond.a === bond.b) {
      error(path, 'A bond cannot connect a fragment to itself');
    }
    if (!positive(bond.area)) {
      error(`${path}.area`, 'Contact area must be positive and finite');
    } else if (bond.area < 0.001) {
      warnings.push({
        message: 'Tiny contact area may produce unstable material behavior',
        path: `${path}.area`,
      });
    }
    if (!positive(bond.strength)) {
      error(`${path}.strength`, 'Strength must be positive and finite');
    }
    if (!vector(bond.normal) || Math.abs(Math.hypot(...bond.normal) - 1) > 0.01) {
      error(`${path}.normal`, 'Expected a finite unit vector');
    }
    if (bond.section !== undefined) {
      if (!record(bond.section)) {
        error(`${path}.section`, 'Expected an authored polygon section');
      } else {
        const section = bond.section;
        if (!vector(section.point)) {
          error(`${path}.section.point`, 'Expected a finite section centroid');
        }
        for (const key of ['tangent1', 'tangent2']) {
          if (!vector(section[key]) || Math.abs(Math.hypot(...section[key]) - 1) > 1e-5) {
            error(`${path}.section.${key}`, 'Expected a finite unit tangent');
          }
        }
        if (
          vector(section.tangent1) &&
          vector(section.tangent2) &&
          vector(bond.normal) &&
          (Math.abs(dot(section.tangent1, section.tangent2)) > 1e-5 ||
            Math.abs(dot(section.tangent1, bond.normal)) > 1e-5 ||
            Math.abs(dot(section.tangent2, bond.normal)) > 1e-5 ||
            dot(cross(section.tangent1, section.tangent2), bond.normal) < 0.99999)
        ) {
          error(`${path}.section`, 'Section axes must form an orthonormal right-handed frame');
        }
        for (const key of [
          'inertia1',
          'inertia2',
          'polarInertia',
          'sectionModulus1',
          'sectionModulus2',
          'torsionModulus',
        ]) {
          if (!positive(section[key])) {
            error(`${path}.section.${key}`, 'Expected a positive finite section property');
          }
        }
        if (
          positive(section.polarInertia) &&
          positive(section.inertia1) &&
          positive(section.inertia2) &&
          Math.abs(section.polarInertia - section.inertia1 - section.inertia2) >
            section.polarInertia * 1e-5
        ) {
          error(
            `${path}.section.polarInertia`,
            'Polar inertia must equal the sum of principal area moments',
          );
        }
      }
    }
    if (id(bond.a) && id(bond.b) && fragmentMap.has(bond.a) && fragmentMap.has(bond.b)) {
      const pair = `${Math.min(bond.a, bond.b)}:${Math.max(bond.a, bond.b)}`;
      if (pairs.has(pair)) {
        error(path, 'Duplicate endpoint pair');
      }
      pairs.add(pair);
      adjacency.get(bond.a)!.push(bond.b);
      adjacency.get(bond.b)!.push(bond.a);
    }
  });
  if (options.requireSupported !== false && !stats.anchors) {
    error('fragments', 'At least one world support anchor is required');
  }
  const reached = new Set<number>(),
    queue: Array<number> = [];
  for (const [fragmentId, fragment] of fragmentMap) {
    if (fragment.anchored === true || bonds.some((bond) => record(bond) && bond.a === fragmentId && bond.b === -1)) {
      reached.add(fragmentId);
      queue.push(fragmentId);
    }
  }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    for (const neighbor of adjacency.get(queue[cursor]!) ?? []) {
      if (!reached.has(neighbor)) {
        reached.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  const supportCount = [...fragmentMap.values()].filter((fragment) => fragment.support !== false).length;
  if (options.requireSupported !== false && reached.size < supportCount) {
    error('bonds', `${supportCount - reached.size} support chunks have no path to a support anchor`);
  }
  if (input.supportDepth !== undefined) {
    const parents = new Set([...fragmentMap.values()].map((fragment) => fragment.parent));
    for (const [fragmentId, fragment] of fragmentMap) {
      const chain = new Set<number>();
      let current: Record<string, unknown> | undefined = fragment, coverage = 0;
      while (current) {
        if (chain.has(current.id as number)) { error(`fragments.${fragmentId}.parent`, 'Chunk hierarchy has a cycle'); break; }
        chain.add(current.id as number);
        if (current.support === true) coverage++;
        const parent = fragmentMap.get(current.parent as number);
        if (parent && current.depth !== (parent.depth as number) + 1) error(`fragments.${fragmentId}.depth`, 'Depth must follow parent depth');
        current = parent;
      }
      const leaf = !parents.has(fragmentId);
      if (leaf && coverage !== 1) error(`fragments.${fragmentId}.support`, 'Every leaf needs exactly one support ancestor');
    }
  }
  return finish();
}

export function assertManifest(
  input: unknown,
  options: { requireSupported?: boolean } = {},
): asserts input is DestructibleManifest {
  const result = validateManifest(input, options);
  if (!result.valid) {
    throw new Error(
      `Invalid destructible manifest: ${result.errors.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`,
    );
  }
}
