import { describe, expect, it } from "vitest";
import {
  BatchedMesh,
  BufferGeometry,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Raycaster,
  Vector3,
} from "three";
import type { FragmentDef, Vec3 } from "../../packages/destruction-domain/src";
import { fragmentSurfaceGeometry } from "../../packages/destruction-render/src/surfaces";
import { createOrganicScenario } from "../../packages/destruction-testkit/src/organic";

/** A 2×2×1 box cut along x = 0.2y, with exact complementary convex cells. */
function complementaryPair(): FragmentDef[] {
  const offset: Vec3 = [3.25, 4, -1.75];
  return [
    {
      id: 87,
      outline: [
        [-1, -1],
        [-0.2, -1],
        [0.2, 1],
        [-1, 1],
      ],
      center: [-37 / 75, 1 / 15, 0],
      fractureEdge: 1,
    },
    {
      id: 13,
      outline: [
        [-0.2, -1],
        [1, -1],
        [1, 1],
        [0.2, 1],
      ],
      center: [37 / 75, -1 / 15, 0],
      fractureEdge: 3,
    },
  ].map(({ id, outline, center, fractureEdge }) => {
    const position: Vec3 = [
      offset[0] + center[0],
      offset[1] + center[1],
      offset[2],
    ];
    const vertices: Vec3[] = [-0.5, 0.5].flatMap((z) =>
      outline.map(([x, y]): Vec3 => [x - center[0], y - center[1], z]),
    );
    return {
      id,
      position,
      size: [1.2, 2, 1],
      mass: 2,
      material: 0,
      region: 0,
      anchored: false,
      aggregate: 0,
      shape: {
        vertices,
        volume: 2,
        inertia: [1, 1, 1, 0, 0, 0],
        faces: [
          { vertices: [3, 2, 1, 0], surface: "exterior" },
          { vertices: [4, 5, 6, 7], surface: "exterior" },
          ...outline.map((_, i) => ({
            vertices: [i, (i + 1) % 4, ((i + 1) % 4) + 4, i + 4],
            surface:
              i === fractureEdge
                ? ("fracture" as const)
                : ("exterior" as const),
          })),
        ],
      },
    };
  });
}

function triangleMeasures(geometry: BufferGeometry) {
  const positions = geometry.getAttribute("position");
  let area = 0,
    volume = 0;
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3();
  for (let index = 0; index < positions.count; index += 3) {
    a.fromBufferAttribute(positions, index);
    b.fromBufferAttribute(positions, index + 1);
    c.fromBufferAttribute(positions, index + 2);
    volume += a.dot(new Vector3().crossVectors(b, c)) / 6;
    area +=
      new Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).length() /
      2;
  }
  return { area, volume };
}

const key = (values: number[]) =>
  values.map((value) => value.toFixed(5)).join(",");

describe("organic fragment render geometry", () => {
  it("preserves complementary volumes and shared fracture planes without shrinking or box scaling", () => {
    const pair = complementaryPair();
    const sharedVertices: Set<string>[] = [];
    let exteriorArea = 0,
      combinedVolume = 0;
    for (const fragment of pair) {
      const exterior = fragmentSurfaceGeometry(fragment, "exterior")!;
      const fracture = fragmentSurfaceGeometry(fragment, "fracture")!;
      try {
        const outside = triangleMeasures(exterior),
          inside = triangleMeasures(fracture);
        exteriorArea += outside.area;
        combinedVolume += outside.volume + inside.volume;
        expect(outside.volume + inside.volume).toBeCloseTo(2, 6);
        expect(inside.area).toBeCloseTo(2 * Math.sqrt(1.04), 6);
        const positions = fracture.getAttribute("position");
        sharedVertices.push(
          new Set(
            Array.from({ length: positions.count }, (_, i) =>
              key(
                new Vector3()
                  .fromBufferAttribute(positions, i)
                  .add(new Vector3(...fragment.position))
                  .toArray(),
              ),
            ),
          ),
        );
        const boundsOnlyChanged = fragmentSurfaceGeometry(
          { ...fragment, size: [37, 59, 61] },
          "exterior",
        )!;
        expect(boundsOnlyChanged.getAttribute("position").array).toEqual(
          exterior.getAttribute("position").array,
        );
        boundsOnlyChanged.dispose();
      } finally {
        exterior.dispose();
        fracture.dispose();
      }
    }
    expect(exteriorArea).toBeCloseTo(16, 6);
    expect(combinedVolume).toBeCloseTo(4, 6);
    expect(sharedVertices[0].size).toBe(4);
    expect(sharedVertices[0]).toEqual(sharedVertices[1]);
  });

  it("keeps exterior UV phase continuous in authored meters across an oblique fragment seam", () => {
    const maps = complementaryPair().map((fragment) => {
      const geometry = fragmentSurfaceGeometry(fragment, "exterior")!;
      const result = new Map<string, [number, number]>();
      try {
        const positions = geometry.getAttribute("position"),
          normals = geometry.getAttribute("normal"),
          uv = geometry.getAttribute("uv");
        for (let i = 0; i < positions.count; i++) {
          const point = new Vector3()
            .fromBufferAttribute(positions, i)
            .add(new Vector3(...fragment.position));
          const normal = new Vector3().fromBufferAttribute(normals, i);
          result.set(key([...point.toArray(), ...normal.toArray()]), [
            uv.getX(i),
            uv.getY(i),
          ]);
          // Front/back faces use absolute world XY, including the authored offset.
          if (Math.abs(normal.z) > 0.99) {
            expect(uv.getX(i)).toBeCloseTo(point.x, 6);
            expect(uv.getY(i)).toBeCloseTo(point.y, 6);
          }
        }
      } finally {
        geometry.dispose();
      }
      return result;
    });
    let matched = 0;
    for (const [pointAndNormal, uv] of maps[0]) {
      const other = maps[1].get(pointAndNormal);
      if (!other) continue;
      matched++;
      expect(uv[0]).toBeCloseTo(other[0], 6);
      expect(uv[1]).toBeCloseTo(other[1], 6);
    }
    expect(matched).toBe(8);
  });

  it("separates interior faces and emits outward, nondegenerate triangles with matching normals", () => {
    for (const fragment of complementaryPair()) {
      for (const surface of ["exterior", "fracture"] as const) {
        const geometry = fragmentSurfaceGeometry(fragment, surface)!;
        try {
          const positions = geometry.getAttribute("position"),
            normals = geometry.getAttribute("normal");
          expect(geometry.index).toBeNull();
          expect(positions.count).toBe(surface === "exterior" ? 30 : 6);
          for (let i = 0; i < positions.count; i += 3) {
            const a = new Vector3().fromBufferAttribute(positions, i),
              b = new Vector3().fromBufferAttribute(positions, i + 1),
              c = new Vector3().fromBufferAttribute(positions, i + 2);
            const winding = new Vector3().crossVectors(
              b.clone().sub(a),
              c.clone().sub(a),
            );
            expect(winding.length()).toBeGreaterThan(0.1);
            winding.normalize();
            const centroid = a.clone().add(b).add(c).divideScalar(3);
            expect(winding.dot(centroid)).toBeGreaterThan(0);
            for (let j = i; j < i + 3; j++) {
              const normal = new Vector3().fromBufferAttribute(normals, j);
              expect(normal.length()).toBeCloseTo(1, 6);
              expect(normal.dot(winding)).toBeCloseTo(1, 6);
              expect(Math.abs(normal.x) > 0.9 && Math.abs(normal.y) > 0.1).toBe(
                surface === "fracture",
              );
            }
          }
        } finally {
          geometry.dispose();
        }
      }
    }
  });

  it("retains physical-size legacy boxes without inventing fracture interiors", () => {
    const fragment = {
      ...complementaryPair()[0],
      shape: undefined,
      size: [2, 3, 4] as Vec3,
    };
    expect(fragmentSurfaceGeometry(fragment, "fracture")).toBeNull();
    const geometry = fragmentSurfaceGeometry(fragment, "exterior")!;
    try {
      geometry.computeBoundingBox();
      expect(geometry.boundingBox!.getSize(new Vector3()).toArray()).toEqual([
        2, 3, 4,
      ]);
      expect(triangleMeasures(geometry).volume).toBeCloseTo(24, 6);
    } finally {
      geometry.dispose();
    }
  });

  it("raycasts irregular hulls through actual BatchedMesh batchId ownership, including moved fracture faces", () => {
    const fragments = complementaryPair(),
      owners = [1, 0];
    const geometries = owners.map(
      (index) => fragmentSurfaceGeometry(fragments[index], "exterior")!,
    );
    const material = new MeshBasicMaterial();
    const batch = new BatchedMesh(
      2,
      geometries.reduce((sum, g) => sum + g.getAttribute("position").count, 0),
      0,
      material,
    );
    try {
      geometries.forEach((geometry, slot) => {
        expect(batch.addInstance(batch.addGeometry(geometry))).toBe(slot);
        batch.setMatrixAt(
          slot,
          new Matrix4().makeTranslation(...fragments[owners[slot]].position),
        );
      });
      batch.position.set(8, 2, -3);
      batch.rotation.set(0.1, 0.37, -0.1);
      batch.updateMatrixWorld(true);
      for (const [y, owner] of [
        [0.8, 0],
        [-0.8, 1],
      ]) {
        // The same x lies inside opposite cells at the two y values. Bounds-only
        // picking would overlap; the slanted polygon must choose the actual cell.
        const origin = new Vector3(3.3, 4 + y, 2.25).applyMatrix4(
          batch.matrixWorld,
        );
        const direction = new Vector3(0, 0, -1).transformDirection(
          batch.matrixWorld,
        );
        const hit = new Raycaster(origin, direction).intersectObject(
          batch,
          false,
        )[0];
        expect(hit).toBeDefined();
        expect(hit.object).toBe(batch);
        expect(hit.instanceId).toBeUndefined();
        expect(owners[hit.batchId!]).toBe(owner);
        expect(fragments[owners[hit.batchId!]].id).toBe(owner === 0 ? 87 : 13);
        expect(hit.distance).toBeCloseTo(3.5, 5);
      }
    } finally {
      batch.dispose();
      material.dispose();
      geometries.forEach((g) => g.dispose());
    }

    const fracture = fragmentSurfaceGeometry(fragments[0], "fracture")!;
    const fractureMaterial = new MeshBasicMaterial();
    const moved = new BatchedMesh(
      1,
      fracture.getAttribute("position").count,
      0,
      fractureMaterial,
    );
    try {
      const slot = moved.addInstance(moved.addGeometry(fracture));
      const rotation = new Quaternion().setFromAxisAngle(
        new Vector3(0, 0, 1),
        0.8,
      );
      const transform = new Matrix4().compose(
        new Vector3(9, 3, -2),
        rotation,
        new Vector3(1, 1, 1),
      );
      moved.setMatrixAt(slot, transform);
      moved.updateMatrixWorld(true);
      const normal = new Vector3(1, -0.2, 0).normalize();
      const localCenter = new Vector3(37 / 75, -1 / 15, 0);
      const origin = localCenter
        .clone()
        .addScaledVector(normal, 2)
        .applyMatrix4(transform);
      const direction = normal.clone().negate().transformDirection(transform);
      const hit = new Raycaster(origin, direction).intersectObject(
        moved,
        false,
      )[0];
      expect(hit.batchId).toBe(slot);
      expect(
        hit.point.distanceTo(localCenter.applyMatrix4(transform)),
      ).toBeLessThan(1e-6);
      expect(
        hit.face!.normal.clone().transformDirection(transform).dot(direction),
      ).toBeCloseTo(-1, 6);
    } finally {
      moved.dispose();
      fracture.dispose();
      fractureMaterial.dispose();
    }
  });

  it("renders the authored organic building hulls with their exact volumes and finite surface attributes", () => {
    const manifest = createOrganicScenario("building");
    expect(manifest.fragments.length).toBeGreaterThan(100);
    let interiors = 0;
    for (const fragment of manifest.fragments) {
      expect(fragment.shape).toBeDefined();
      let volume = 0;
      for (const surface of ["exterior", "fracture"] as const) {
        const geometry = fragmentSurfaceGeometry(fragment, surface);
        if (!geometry) continue;
        try {
          if (surface === "fracture") interiors++;
          const positions = geometry.getAttribute("position"),
            normals = geometry.getAttribute("normal");
          for (const attribute of Object.values(geometry.attributes))
            expect(Array.from(attribute.array).every(Number.isFinite)).toBe(
              true,
            );
          for (let i = 0; i < positions.count; i += 3) {
            const point = new Vector3().fromBufferAttribute(positions, i);
            const normal = new Vector3().fromBufferAttribute(normals, i);
            expect(normal.length()).toBeCloseTo(1, 5);
            expect(point.dot(normal)).toBeGreaterThan(0);
          }
          volume += triangleMeasures(geometry).volume;
        } finally {
          geometry.dispose();
        }
      }
      expect(Math.abs(volume - fragment.shape!.volume)).toBeLessThan(
        1e-5 * fragment.shape!.volume,
      );
    }
    expect(interiors).toBeGreaterThan(manifest.fragments.length / 2);
  });
});
