import {
  calculateMeshBounds,
  createFindNearestPolyResult,
  createNavMesh,
  createGetClosestPointOnPolyResult,
  DEFAULT_QUERY_FILTER,
  findNearestPoly,
  findPath as findNavPath,
  findRandomPoint,
  FindPathResultFlags,
  getClosestPointOnPoly,
  isValidNodeRef,
  raycast,
} from 'navcat';
import type { Box3, NavMesh, NodeRef, Vec3 } from 'navcat';
import { floodFillNavMesh, generateTiledNavMesh } from 'navcat/blocks';

export type NavigationPoint = readonly [number, number, number];
export type NavigationGeometry = {
  readonly indices: ArrayLike<number>;
  readonly positions: ArrayLike<number>;
};
export type NavigationBuildOptions = {
  cellHeight?: number;
  cellSize?: number;
  climb?: number;
  height?: number;
  radius?: number;
  slope?: number;
  tileSize?: number;
};
export type NavigationProjection = {
  island: number;
  nodeRef: number;
  position: NavigationPoint;
};
export type NavigationSample = {
  island: number;
  neighbors: Array<number>;
  node: number;
  point: NavigationPoint;
};
export interface NavigationMesh {
  readonly bounds: readonly [number, number, number, number, number, number];
  canTraverse(from: NavigationPoint, to: NavigationPoint, clearance?: number): boolean;
  dispose(): void;
  hasLineOfSight(from: NavigationPoint, to: NavigationPoint): boolean;
  isWalkable(point: NavigationPoint, clearance?: number): boolean;
  readonly navMesh: NavMesh;
  readonly options: Readonly<Required<NavigationBuildOptions>>;
  path(from: NavigationPoint, to: NavigationPoint): Array<NavigationPoint>;
  project(point: NavigationPoint): NavigationProjection | null;
  randomPoint(random: () => number): NavigationPoint | null;
  rebuild(geometry: NavigationGeometry): void;
  readonly revision: number;
  samplePoints(): Array<NavigationSample>;
}

type Triangle = {
  a: Vec3;
  edgeA: Vec3;
  edgeB: Vec3;
  max: Vec3;
  min: Vec3;
};

const DEFAULT_OPTIONS: Required<NavigationBuildOptions> = {
  cellHeight: 0.1,
  cellSize: 0.175,
  climb: 0.3,
  height: 1.8,
  radius: 0.35,
  slope: 45,
  tileSize: 7,
};
const copyPoint = (point: NavigationPoint): Vec3 => [point[0], point[1], point[2]];
const finitePoint = (point: NavigationPoint) => point.every(Number.isFinite);
const length = (a: NavigationPoint, b: NavigationPoint) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const cross = (a: NavigationPoint, b: NavigationPoint): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: NavigationPoint, b: NavigationPoint) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function cloneGeometry(geometry: NavigationGeometry) {
  if (
    geometry.positions.length < 9 ||
    geometry.positions.length % 3 !== 0 ||
    geometry.indices.length < 3 ||
    geometry.indices.length % 3 !== 0
  ) {
    throw new Error('Navigation geometry requires indexed triangles');
  }
  const positions = Float64Array.from(geometry.positions);
  if (!positions.every(Number.isFinite)) {
    throw new Error('Navigation positions must be finite');
  }
  const indices = Uint32Array.from(geometry.indices);
  for (let index = 0; index < geometry.indices.length; index++) {
    const vertex = geometry.indices[index];
    if (
      typeof vertex !== 'number' ||
      !Number.isSafeInteger(vertex) ||
      vertex < 0 ||
      vertex >= positions.length / 3
    ) {
      throw new Error('Navigation indices must reference existing vertices');
    }
  }
  return { indices, positions };
}

function buildOptions(input: NavigationBuildOptions): Required<NavigationBuildOptions> {
  const options = { ...DEFAULT_OPTIONS, ...input };
  for (const [name, value] of Object.entries(options)) {
    if (!Number.isFinite(value) || (value <= 0 && name !== 'climb')) {
      throw new Error(`Invalid navigation build option: ${name}`);
    }
  }
  if (
    options.climb < 0 ||
    options.climb >= options.height ||
    options.slope >= 90 ||
    options.tileSize < options.cellSize * 4
  ) {
    throw new Error('Navigation build dimensions are inconsistent');
  }
  return Object.freeze(options);
}

function build(
  geometry: ReturnType<typeof cloneGeometry>,
  options: Required<NavigationBuildOptions>,
) {
  const walkableRadiusVoxels = Math.ceil(options.radius / options.cellSize);
  const bounds: Box3 = [0, 0, 0, 0, 0, 0];
  calculateMeshBounds(bounds, geometry.positions, geometry.indices);
  if (bounds[3] <= bounds[0] || bounds[5] <= bounds[2]) {
    throw new Error('Navigation geometry has no horizontal area');
  }
  const { navMesh } = generateTiledNavMesh(geometry, {
    borderSize: walkableRadiusVoxels + 3,
    cellHeight: options.cellHeight,
    cellSize: options.cellSize,
    detailSampleDistance: options.cellSize * 6,
    detailSampleMaxError: options.cellHeight,
    maxEdgeLength: 12,
    maxSimplificationError: 1.3,
    maxVerticesPerPoly: 5,
    mergeRegionArea: 20,
    minRegionArea: 8,
    tileSizeVoxels: Math.round(options.tileSize / options.cellSize),
    tileSizeWorld: options.tileSize,
    walkableClimbVoxels: Math.ceil(options.climb / options.cellHeight),
    walkableClimbWorld: options.climb,
    walkableHeightVoxels: Math.ceil(options.height / options.cellHeight),
    walkableHeightWorld: options.height,
    walkableRadiusVoxels,
    walkableRadiusWorld: options.radius,
    walkableSlopeAngleDegrees: options.slope,
  });
  const triangles: Array<Triangle> = [];
  const vertex = (index: number): Vec3 => [
    geometry.positions[index * 3]!,
    geometry.positions[index * 3 + 1]!,
    geometry.positions[index * 3 + 2]!,
  ];
  for (let index = 0; index < geometry.indices.length; index += 3) {
    const a = vertex(geometry.indices[index]!);
    const b = vertex(geometry.indices[index + 1]!);
    const c = vertex(geometry.indices[index + 2]!);
    triangles.push({
      a,
      edgeA: [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
      edgeB: [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
      max: [Math.max(a[0], b[0], c[0]), Math.max(a[1], b[1], c[1]), Math.max(a[2], b[2], c[2])],
      min: [Math.min(a[0], b[0], c[0]), Math.min(a[1], b[1], c[1]), Math.min(a[2], b[2], c[2])],
    });
  }
  return { bounds, navMesh, triangles };
}

export function buildNavigationMesh(
  geometry: NavigationGeometry,
  input: NavigationBuildOptions = {},
): NavigationMesh {
  const options = buildOptions(input);
  let content = build(cloneGeometry(geometry), options);
  let revision = 0;
  let disposed = false;
  const islands = new Map<NodeRef, number>();
  let nextIsland = 0;
  const queryExtents: Vec3 = [
    Math.max(1, options.radius * 2),
    Math.max(2, options.height),
    Math.max(1, options.radius * 2),
  ];
  const nearest = createFindNearestPolyResult();
  const endpoint = createGetClosestPointOnPolyResult();
  const assertActive = () => {
    if (disposed) {
      throw new Error('Navigation mesh has been disposed');
    }
  };
  const islandOf = (nodeRef: NodeRef) => {
    const known = islands.get(nodeRef);
    if (known !== undefined) {
      return known;
    }
    const island = nextIsland++;
    for (const reachable of floodFillNavMesh(content.navMesh, [nodeRef]).reachable) {
      islands.set(reachable, island);
    }
    return island;
  };
  const project = (point: NavigationPoint): NavigationProjection | null => {
    assertActive();
    if (!finitePoint(point)) {
      return null;
    }
    findNearestPoly(nearest, content.navMesh, copyPoint(point), queryExtents, DEFAULT_QUERY_FILTER);
    return nearest.success
      ? {
          island: islandOf(nearest.nodeRef),
          nodeRef: nearest.nodeRef,
          position: copyPoint(nearest.position),
        }
      : null;
  };
  const surface = (point: NavigationPoint) => {
    const candidate = project(point);
    return candidate &&
      Math.hypot(candidate.position[0] - point[0], candidate.position[2] - point[2]) <=
        options.cellSize + 0.05 &&
      Math.abs(candidate.position[1] - point[1]) <=
        Math.max(options.climb + options.cellHeight, 0.85)
      ? candidate
      : null;
  };
  const isWalkable = (point: NavigationPoint, clearance = options.radius) => {
    const from = surface(point);
    if (!from || !Number.isFinite(clearance) || clearance < 0) {
      return false;
    }
    const extra = Math.max(0, clearance - options.radius);
    if (extra < 0.01) {
      return true;
    }
    const offsets: ReadonlyArray<readonly [number, number]> = [
      [extra, 0],
      [-extra, 0],
      [0, extra],
      [0, -extra],
    ];
    return offsets.every(([x, z]) => {
      const to = surface([point[0] + x, point[1], point[2] + z]);
      return (
        to &&
        from.island === to.island &&
        raycast(
          content.navMesh,
          from.nodeRef,
          copyPoint(from.position),
          copyPoint(to.position),
          DEFAULT_QUERY_FILTER,
        ).t >= 1
      );
    });
  };
  return {
    get bounds() {
      return [...content.bounds] as Box3;
    },
    canTraverse: (from, to, clearance = options.radius) => {
      const start = surface(from);
      const end = surface(to);
      if (!start || !end || start.island !== end.island || !isWalkable(to, clearance)) {
        return false;
      }
      const result = raycast(
        content.navMesh,
        start.nodeRef,
        copyPoint(start.position),
        copyPoint(end.position),
        DEFAULT_QUERY_FILTER,
      );
      const last = result.path.at(-1);
      if (result.t < 1 || last === undefined) {
        return false;
      }
      getClosestPointOnPoly(endpoint, content.navMesh, last, copyPoint(end.position));
      return endpoint.success && length(endpoint.position, end.position) <= options.cellSize + 0.05;
    },
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      islands.clear();
      content = { bounds: content.bounds, navMesh: createNavMesh(), triangles: [] };
    },
    hasLineOfSight: (from, to) => {
      assertActive();
      if (!finitePoint(from) || !finitePoint(to)) {
        return false;
      }
      const delta: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
      const min = from.map((value, axis) => Math.min(value, to[axis]!));
      const max = from.map((value, axis) => Math.max(value, to[axis]!));
      for (const triangle of content.triangles) {
        if (
          triangle.min.some((value, axis) => value > max[axis]!) ||
          triangle.max.some((value, axis) => value < min[axis]!)
        ) {
          continue;
        }
        const perpendicular = cross(delta, triangle.edgeB);
        const determinant = dot(triangle.edgeA, perpendicular);
        if (Math.abs(determinant) < 1e-10) {
          continue;
        }
        const relative: Vec3 = [
          from[0] - triangle.a[0],
          from[1] - triangle.a[1],
          from[2] - triangle.a[2],
        ];
        const u = dot(relative, perpendicular) / determinant;
        if (u < 0 || u > 1) {
          continue;
        }
        const tangent = cross(relative, triangle.edgeA);
        const v = dot(delta, tangent) / determinant;
        if (v < 0 || u + v > 1) {
          continue;
        }
        const t = dot(triangle.edgeB, tangent) / determinant;
        if (t > 1e-6 && t < 1 - 1e-6) {
          return false;
        }
      }
      return true;
    },
    isWalkable,
    get navMesh() {
      assertActive();
      return content.navMesh;
    },
    options,
    path: (from, to) => {
      const start = project(from);
      const end = project(to);
      if (!start || !end || start.island !== end.island) {
        return [];
      }
      const result = findNavPath(
        content.navMesh,
        copyPoint(start.position),
        copyPoint(end.position),
        queryExtents,
        DEFAULT_QUERY_FILTER,
      );
      if (!result.success || (result.flags & FindPathResultFlags.COMPLETE_PATH) === 0) {
        return [];
      }
      return result.path
        .filter((point) => point.nodeRef === null || isValidNodeRef(content.navMesh, point.nodeRef))
        .map((point) => copyPoint(point.position));
    },
    project,
    randomPoint: (random) => {
      assertActive();
      const sample = findRandomPoint(content.navMesh, DEFAULT_QUERY_FILTER, () => {
        const value = random();
        if (!Number.isFinite(value) || value < 0 || value >= 1) {
          throw new Error('Navigation random source must return a finite value in [0, 1)');
        }
        return value;
      });
      return sample.success ? copyPoint(sample.position) : null;
    },
    rebuild: (nextGeometry) => {
      assertActive();
      const next = build(cloneGeometry(nextGeometry), options);
      content = next;
      islands.clear();
      nextIsland = 0;
      revision++;
    },
    get revision() {
      return revision;
    },
    samplePoints: () => {
      assertActive();
      const samples: Array<NavigationSample> = [];
      const tiles = Object.values(content.navMesh.tiles).sort(
        (a, b) => a.tileX - b.tileX || a.tileY - b.tileY || a.tileLayer - b.tileLayer,
      );
      for (const tile of tiles) {
        for (let index = 0; index < tile.polys.length; index++) {
          const polygon = tile.polys[index]!;
          const nodeIndex = tile.polyNodes[index];
          const node = nodeIndex === undefined ? undefined : content.navMesh.nodes[nodeIndex];
          if (!node?.allocated || !polygon.flags || polygon.vertices.length === 0) {
            continue;
          }
          const point: Vec3 = [0, 0, 0];
          for (const vertex of polygon.vertices) {
            for (const axis of [0, 1, 2] as const) {
              point[axis] += tile.vertices[vertex * 3 + axis]! / polygon.vertices.length;
            }
          }
          getClosestPointOnPoly(endpoint, content.navMesh, node.ref, point);
          const neighbors = node.links
            .map((index) => content.navMesh.links[index])
            .flatMap((link) =>
              link?.allocated && isValidNodeRef(content.navMesh, link.toNodeRef)
                ? [link.toNodeRef]
                : [],
            )
            .sort((a, b) => a - b);
          samples.push({
            island: islandOf(node.ref),
            neighbors,
            node: node.ref,
            point: endpoint.success ? copyPoint(endpoint.position) : point,
          });
        }
      }
      return samples;
    },
  };
}
