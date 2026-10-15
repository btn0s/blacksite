import { runInNewContext } from 'node:vm';
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import RAPIER from "@dimforge/rapier3d-compat";
import { createDestructibleBoxes } from "../../packages/destruction-authoring/src/boxes";
import { DestructionSimulation } from "../../packages/destruction-physics/src/index";
import { startServer } from "../../packages/destruction-server/src/index";
import { topologyChecksum } from "../../packages/destruction-graph/src/index";
import {
  FragmentState,
  BondState,
  MAX_CANNONBALLS,
  MAX_EXPLOSIVES,
  MAX_FRACTURE_GENERATION,
  MAX_SECONDARY_DEFINITION_BYTES,
  MAX_SECONDARY_FRAGMENTS,
  MAX_SECONDARY_ID_SPAN,
  SIMULATION_VERSION,
} from "../../packages/destruction-domain/src/index";
import {
  commandFromIntent,
  decodeSnapshot,
  encodeSnapshot,
  LIMITS,
  parseReplay,
  PROTOCOL_VERSION,
  ProtocolError,
  QUATERNION_COMPONENT_ERROR,
  serializeReplay,
  SnapshotReceiver,
  verifySnapshot,
} from "../../packages/destruction-network/src/index";
import type {
  DestructibleManifest,
  ReplayLog,
  SimulationFrame,
  SecondaryFragmentDef,
} from "../../packages/destruction-domain/src/index";

function fixture(count = 3): {
  manifest: DestructibleManifest;
  frame: SimulationFrame;
} {
  const manifest: DestructibleManifest = {
    schemaVersion: 1,
    scenario: "wall",
    name: "Codec fixture",
    assetHash: "test-v1",
    coordinateSystem: "Y_UP_RH",
    materials: [],
    regions: [],
    fragments: Array.from({ length: count }, (_, i) => ({
      id: i * 10 + 1,
      position: [i, 1, 0],
      size: [1, 1, 1],
      mass: 100,
      material: 0,
      region: 0,
      anchored: i === 0,
      aggregate: 0,
    })),
    bonds: Array.from({ length: count - 1 }, (_, i) => ({
      id: i * 10 + 2,
      a: i * 10 + 1,
      b: (i + 1) * 10 + 1,
      normal: [1, 0, 0],
      area: 1,
      strength: 1,
    })),
  };
  const transforms = new Float32Array(count * 8);
  const states = new Uint8Array(count);
  const bondStates = new Uint8Array(count - 1);
  for (let i = 0; i < count; i++)
    transforms.set([i, 1, 0, 0, 0, 0, 1, 0], i * 8);
  const checksum = topologyChecksum(
    manifest,
    bondStates,
    states.map(() => 1),
  );
  return {
    manifest,
    frame: {
      type: "frame",
      tick: 4,
      transforms,
      states,
      bondStates,
      events: [],
      stats: {
        tick: 4,
        checksum,
        brokenBonds: 0,
        totalBonds: count - 1,
        activeBodies: 0,
        sleepingBodies: 0,
        settledBodies: 0,
        supportedFragments: count,
        detachedFragments: 0,
        physicsMs: 0,
        structuralMs: 0,
        workerMs: 0,
        commands: 0,
        droppedFrames: 0,
      },
    },
  };
}

describe("bounded binary snapshots", () => {
  it("round trips topology and quantizes seeded positions/quaternions within documented bounds", () => {
    const { frame, manifest } = fixture(512);
    let seed = 0x12345678;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    for (let i = 0; i < frame.states.length; i++) {
      const q = Array.from({ length: 4 }, () => random() * 2 - 1);
      const length = Math.hypot(...q);
      frame.transforms.set(
        [
          random() * 4096 - 2048,
          random() * 4096 - 2048,
          random() * 4096 - 2048,
          ...q.map((n) => n / length),
          random(),
        ],
        i * 8,
      );
    }
    const encoded = encodeSnapshot(frame);
    const decoded = decodeSnapshot(encoded, { fragments: 512, bonds: 511 });
    expect(decoded.checksum).toBe(frame.stats.checksum);
    expect(verifySnapshot(decoded, manifest)).toBe(true);
    for (let i = 0; i < frame.transforms.length; i++) {
      const axis = i % 8;
      const tolerance =
        axis < 3 ? 0.00063 : axis < 7 ? QUATERNION_COMPONENT_ERROR : 0.000008;
      expect(
        Math.abs(decoded.transforms[i] - frame.transforms[i]),
      ).toBeLessThanOrEqual(tolerance);
    }
    // Decoder also accepts a subarray without confusing its backing-buffer offset.
    const padded = new Uint8Array(encoded.byteLength + 7);
    padded.set(new Uint8Array(encoded), 7);
    expect(decodeSnapshot(padded.subarray(7)).transforms).toEqual(
      decoded.transforms,
    );
  });

  it("decodes cross-realm buffers without trusting a spoofed brand", () => {
    const packet = encodeSnapshot(fixture().frame);
    const foreign = runInNewContext('new Uint8Array(bytes).buffer', { bytes: [...new Uint8Array(packet)] });
    expect(decodeSnapshot(foreign).tick).toBe(fixture().frame.tick);
    expect(() => decodeSnapshot({ [Symbol.toStringTag]: 'ArrayBuffer', byteLength: 128 } as ArrayBuffer)).toThrow(ProtocolError);
  });

  it("rejects truncated/trailing payloads, oversized counts, unknown flags and corrupt scalar fields", () => {
    const { frame } = fixture();
    const original = encodeSnapshot(frame);
    expect(() => decodeSnapshot(original.slice(0, -1))).toThrow(ProtocolError);
    expect(() =>
      decodeSnapshot(new Uint8Array(original.byteLength + 1)),
    ).toThrow(ProtocolError);
    for (const [index, corrupt] of [
      (view: DataView) => view.setUint32(12, LIMITS.fragments + 1, true),
      (view: DataView) => view.setUint8(4, 255),
      (view: DataView) => view.setUint8(5, 8),
      (view: DataView) => view.setUint32(28, 1, true),
      (view: DataView) => view.setInt32(32, 2_048_001, true),
      (view: DataView) => view.setInt16(50, 0, true),
      (view: DataView) => view.setUint8(54, FragmentState.Hidden + 1),
      (view: DataView) => view.setUint8(original.byteLength - 1, 9),
    ].entries()) {
      const copy = original.slice(0);
      corrupt(new DataView(copy));
      expect(() => decodeSnapshot(copy), `mutation ${index}`).toThrow(ProtocolError);
    }
    expect(() => decodeSnapshot(original, { fragments: 4, bonds: 2 })).toThrow(
      /manifest/,
    );
    frame.transforms[0] = Infinity;
    expect(() => encodeSnapshot(frame)).toThrow(/Position/);
  });

  it("detects topology corruption, drops reordered snapshots, and applies repairs idempotently", () => {
    const { frame, manifest } = fixture();
    const receiver = new SnapshotReceiver();
    const first = encodeSnapshot(frame);
    expect(receiver.accept(first, manifest)).toBe(true);
    expect(receiver.accept(first, manifest)).toBe(false);
    frame.tick = 3;
    expect(receiver.accept(encodeSnapshot(frame), manifest)).toBe(false);
    frame.tick = 4;
    expect(receiver.needsRepair({ tick: 4, checksum: "00000000" })).toBe(true);
    const corrupted = new Uint8Array(first.slice(0));
    corrupted[32 + frame.states.length * 24] = 3;
    expect(receiver.accept(corrupted, manifest)).toBe(false);
    expect(receiver.rejected).toBe(1);
    const repair = encodeSnapshot(frame, true);
    expect(receiver.accept(repair, manifest)).toBe(true);
    expect(receiver.accept(repair, manifest)).toBe(true);
    expect(receiver.current?.transforms).toEqual(
      decodeSnapshot(first).transforms,
    );
    expect(
      receiver.needsRepair({ tick: 4, checksum: frame.stats.checksum }),
    ).toBe(false);
  });

  it("recovers after seeded loss and reordering with a complete repair keyframe", () => {
    const { frame, manifest } = fixture(20);
    const receiver = new SnapshotReceiver();
    const packets: ArrayBuffer[] = [];
    for (let tick = 1; tick <= 100; tick++) {
      frame.tick = tick;
      frame.bondStates.fill(0);
      frame.bondStates.fill(3, 0, Math.min(19, Math.floor(tick / 6)));
      frame.stats.checksum = topologyChecksum(
        manifest,
        frame.bondStates,
        frame.states.map(() => 1),
      );
      packets.push(encodeSnapshot(frame));
    }
    for (let i = 0; i < packets.length - 1; i += 2) {
      if (i % 20 === 0) continue; // 10% paired loss, then reverse delivery of each adjacent pair.
      receiver.accept(packets[i + 1], manifest);
      receiver.accept(packets[i], manifest);
    }
    expect(receiver.accept(encodeSnapshot(frame, true), manifest)).toBe(true);
    expect(receiver.current?.tick).toBe(100);
    expect(receiver.current?.checksum).toBe(frame.stats.checksum);
  });
});

function cube(id: number, rootId: number, parentId = rootId, generation = 1): SecondaryFragmentDef {
  return {
    id,
    parentId,
    rootId,
    generation,
    position: [1, 1, 0],
    size: [0.5, 0.5, 0.5],
    mass: 50,
    material: 0,
    region: 0,
    aggregate: 0,
    anchored: false,
    shape: {
      vertices: [
        [-0.25, -0.25, -0.25],
        [0.25, -0.25, -0.25],
        [0.25, 0.25, -0.25],
        [-0.25, 0.25, -0.25],
        [-0.25, -0.25, 0.25],
        [0.25, -0.25, 0.25],
        [0.25, 0.25, 0.25],
        [-0.25, 0.25, 0.25],
      ],
      faces: [
        [0, 3, 2, 1],
        [4, 5, 6, 7],
        [0, 1, 5, 4],
        [3, 7, 6, 2],
        [0, 4, 7, 3],
        [1, 2, 6, 5],
      ].map((vertices, i) => ({
        vertices,
        surface: i === 0 ? "fracture" : "exterior",
      })),
      volume: 0.125,
      inertia: [50 / 24, 50 / 24, 50 / 24, 0, 0, 0],
    },
  };
}

function definitionBytes(fragment: SecondaryFragmentDef) {
  return new TextEncoder().encode(JSON.stringify(fragment)).byteLength;
}

/**
 * A valid convex n-gon prism with full-precision coordinates (the largest hull shape the wire
 * accepts), padded with an extra field to exactly MAX_SECONDARY_DEFINITION_BYTES.
 */
function maxDefinition(id: number, rootId: number): SecondaryFragmentDef & { pad: string } {
  for (let n = 32; n >= 3; n--) {
    const radius = 0.123456789,
      height = 0.0987654321,
      phase = 0.3141592653589793,
      mass = 1.23456789;
    const ring = (y: number) =>
      Array.from({ length: n }, (_, i) => {
        const angle = phase + (i * 2 * Math.PI) / n;
        return [radius * Math.cos(angle), y, radius * Math.sin(angle)];
      });
    const vertices = [...ring(-height / 2), ...ring(height / 2)];
    const faces = [
      { vertices: Array.from({ length: n }, (_, i) => i), surface: "fracture" },
      { vertices: Array.from({ length: n }, (_, i) => 2 * n - 1 - i), surface: "exterior" },
      ...Array.from({ length: n }, (_, i) => ({
        vertices: [i, n + i, n + ((i + 1) % n), (i + 1) % n],
        surface: i % 2 ? "fracture" : "exterior",
      })),
    ] as NonNullable<SecondaryFragmentDef["shape"]>["faces"];
    const lateral = (mass * (3 * radius * radius + height * height)) / 12;
    const definition = {
      id,
      parentId: rootId,
      rootId,
      generation: 1,
      position: [1.000123456789, 1.000987654321, -0.000123456789],
      size: [2 * radius, height, 2 * radius],
      mass,
      material: 0,
      region: 0,
      aggregate: 0,
      anchored: false,
      shape: {
        vertices,
        faces,
        volume: height * (n / 2) * radius * radius * Math.sin((2 * Math.PI) / n),
        inertia: [lateral, (mass * radius * radius) / 2, lateral, 0, 0, 0],
      },
      pad: "",
    } as SecondaryFragmentDef & { pad: string };
    const missing = MAX_SECONDARY_DEFINITION_BYTES - definitionBytes(definition);
    if (missing >= 0) {
      definition.pad = "x".repeat(missing);
      return definition;
    }
  }
  throw new Error("no prism fits the definition bound");
}

function supportOf(frame: SimulationFrame, manifest: DestructibleManifest) {
  const supported = frame.states.map((state) => (state === FragmentState.Supported ? 1 : 0));
  frame.secondary?.fragments.forEach((fragment, slot) => {
    if (frame.secondary!.states[slot] === FragmentState.Supported) {
      supported[manifest.fragments.findIndex((f) => f.id === fragment.rootId)] = 1;
    }
  });
  return supported;
}

function secondaryFixture() {
  const result = fixture();
  const { frame, manifest } = result;
  const root = manifest.fragments[1].id;
  frame.states[1] = FragmentState.Retired;
  frame.bondStates.fill(3);
  frame.secondary = {
    revision: 1,
    fragments: [cube(22, root), cube(23, root)],
    transforms: new Float32Array([
      1.1234, 2.1, 0, 0, 0, 0, 1, 0.2, -1.56, 1, 0, 0, 0, 0, 1, 0.8,
    ]),
    states: new Uint8Array([FragmentState.Dynamic, FragmentState.Sleeping]),
  };
  frame.stats.checksum = topologyChecksum(manifest, frame.bondStates, supportOf(frame, manifest));
  return result;
}

/**
 * Live-only hierarchy rooted at manifest fragment 11 (first secondary id 22). Ids 22 and 24 were
 * re-fractured and are no longer in the frame; ids are sparse but strictly ascending.
 */
function hierarchyFixture() {
  const result = secondaryFixture();
  const { frame, manifest } = result;
  const root = manifest.fragments[1].id;
  frame.secondary = {
    revision: 7,
    fragments: [
      cube(23, root),
      cube(25, root, 22, 2),
      cube(26, root, 24, 3),
      cube(27, root, 24, 3),
      cube(40, root, 22, 2),
    ],
    states: new Uint8Array([
      FragmentState.Supported,
      FragmentState.Dynamic,
      FragmentState.Supported,
      FragmentState.Dynamic,
      FragmentState.Settled,
    ]),
    transforms: new Float32Array(Array.from({ length: 5 }, () => [1, 2, 0, 0, 0, 0, 1, 0.2]).flat()),
  };
  frame.stats.checksum = topologyChecksum(manifest, frame.bondStates, supportOf(frame, manifest));
  return result;
}

function secondaryOffset(packet: ArrayBuffer) {
  const view = new DataView(packet);
  return (
    32 +
    view.getUint32(12, true) * 24 +
    view.getUint32(16, true) +
    view.getUint32(28, true) * 56
  );
}

/** Mutate wire JSON without passing it through the encoder's own validation. */
function corruptSecondaryDefinitions(
  packet: ArrayBuffer,
  change: (defs: SecondaryFragmentDef[]) => void,
) {
  const view = new DataView(packet),
    offset = secondaryOffset(packet),
    length = view.getUint32(offset + 8, true);
  const defs = JSON.parse(
    new TextDecoder().decode(new Uint8Array(packet, offset + 12, length)),
  );
  change(defs);
  const metadata = new TextEncoder().encode(JSON.stringify(defs));
  const tail = new Uint8Array(packet, offset + 12 + length);
  const out = new Uint8Array(offset + 12 + metadata.length + tail.length);
  out.set(new Uint8Array(packet, 0, offset + 12));
  out.set(metadata, offset + 12);
  out.set(tail, offset + 12 + metadata.length);
  const header = new DataView(out.buffer);
  header.setUint32(24, out.length, true);
  header.setUint32(offset + 8, metadata.length, true);
  return out.buffer;
}

/** A v3 packet as an older server wrote it: generation-1 children without rootId, states 1..3. */
function legacyV3Packet(frame: SimulationFrame) {
  const packet = corruptSecondaryDefinitions(encodeSnapshot(frame), (defs) => {
    for (const def of defs) delete (def as { rootId?: number }).rootId;
  });
  new DataView(packet).setUint8(4, 3);
  return packet;
}

/** Rejected either structurally on decode (ProtocolError) or by manifest verification. */
function rejected(packet: ArrayBuffer, manifest: DestructibleManifest) {
  try {
    return !new SnapshotReceiver().accept(packet, manifest);
  } catch (error) {
    if (error instanceof ProtocolError) return true;
    throw error;
  }
}

describe("secondary snapshot channel", () => {
  it("round trips shape-free cuboid retirement definitions", () => {
    const { frame, manifest } = secondaryFixture();
    for (const child of frame.secondary!.fragments) delete child.shape;
    const decoded = decodeSnapshot(encodeSnapshot(frame));
    expect(decoded.secondary!.fragments).toEqual(frame.secondary!.fragments);
    expect(verifySnapshot(decoded, manifest)).toBe(true);
    frame.secondary!.fragments[0]!.shape = null as never;
    expect(() => encodeSnapshot(frame)).toThrow(/volume or inertia/);
  });
  it("round trips revised bonds after an authored cover exposes a child", async () => {
    await RAPIER.init();
    const manifest = createDestructibleBoxes([
      { id: "cover", min: [-8.5, 0, 2], max: [-5, 1.5, 2.5], material: 0, anchored: true },
    ], { id: "network-refinement" }).manifest;
    const sim = await DestructionSimulation.create(manifest);
    try {
      let frame = sim.step();
      expect(verifySnapshot(decodeSnapshot(encodeSnapshot(frame)), manifest)).toBe(true);
      for (let shot = 0; shot < 8 && !frame.secondary?.fragments.length; shot++) {
        const ray = new RAPIER.Ray({ x: -6.7, y: 0.35, z: 5 }, { x: 0, y: 0, z: -1 });
        const hit = sim.world.castRay(ray, 10, true, undefined, undefined, undefined, undefined,
          (collider) => sim.fragmentForCollider(collider.handle) !== undefined);
        expect(hit).not.toBeNull();
        const point = ray.pointAt(hit!.timeOfImpact);
        expect(sim.recordImpact({ colliderHandle: hit!.collider.handle, direction: [0, 0, -1],
          energy: 2019, impulse: [0, 0, -5.6485], position: [point.x, point.y, point.z] })).not.toBeNull();
        frame = sim.step();
      }
      expect(frame.secondary?.fragments.length).toBeGreaterThan(0);
      expect(frame.bondRevision).toBeGreaterThan(0);
      expect(frame.bonds?.length).toBeGreaterThan(manifest.bonds.length);
      const packet = encodeSnapshot(frame);
      const decoded = decodeSnapshot(packet);
      expect(decoded.bonds).toEqual(frame.bonds);
      expect(decoded.bondStates).toEqual(frame.bondStates);
      expect(decoded.topologySupported).toEqual(frame.topologySupported);
      expect(verifySnapshot(decoded, manifest)).toBe(true);
      expect(new SnapshotReceiver().accept(packet, manifest)).toBe(true);
    } finally {
      sim.dispose();
    }
  });
  it("round trips a live-only hierarchy with sparse ascending ids and root lineage across generations", () => {
    const { frame, manifest } = hierarchyFixture();
    const snapshot = decodeSnapshot(encodeSnapshot(frame, true));
    expect(snapshot.secondary?.fragments).toEqual(frame.secondary!.fragments);
    expect(snapshot.secondary?.fragments.map((f) => f.rootId)).toEqual([11, 11, 11, 11, 11]);
    expect(snapshot.secondary?.states).toEqual(frame.secondary!.states);
    expect(snapshot.secondary?.revision).toBe(7);
    expect(verifySnapshot(snapshot, manifest)).toBe(true);
    expect(new SnapshotReceiver().accept(encodeSnapshot(frame), manifest)).toBe(true);
  });

  it("counts a Supported live child as support for its retired root in the topology checksum", () => {
    const { frame, manifest } = hierarchyFixture();
    const supportedChecksum = frame.stats.checksum;
    expect(
      topologyChecksum(manifest, frame.bondStates, new Uint8Array([1, 0, 1])),
    ).not.toBe(supportedChecksum);
    frame.secondary!.states[0] = FragmentState.Dynamic;
    frame.secondary!.states[2] = FragmentState.Dynamic;
    expect(verifySnapshot(decodeSnapshot(encodeSnapshot(frame)), manifest)).toBe(false);
    frame.stats.checksum = topologyChecksum(manifest, frame.bondStates, new Uint8Array([1, 0, 1]));
    expect(verifySnapshot(decodeSnapshot(encodeSnapshot(frame)), manifest)).toBe(true);
    frame.secondary!.states[4] = FragmentState.Supported;
    expect(verifySnapshot(decodeSnapshot(encodeSnapshot(frame)), manifest)).toBe(false);
  });

  it("rejects out-of-order and duplicate ids on the wire and in verification", () => {
    const { frame, manifest } = hierarchyFixture();
    const packet = encodeSnapshot(frame);
    for (const mutate of [
      (defs: SecondaryFragmentDef[]) => defs.reverse(),
      (defs: SecondaryFragmentDef[]) => [defs[1], defs[2]] = [defs[2], defs[1]],
      (defs: SecondaryFragmentDef[]) => { defs[2].id = defs[1].id; },
    ]) {
      expect(() => decodeSnapshot(corruptSecondaryDefinitions(packet, mutate))).toThrow(/unordered/);
      const snapshot = decodeSnapshot(packet);
      mutate(snapshot.secondary!.fragments);
      expect(verifySnapshot(snapshot, manifest)).toBe(false);
    }
    const unsorted = hierarchyFixture().frame;
    unsorted.secondary!.fragments.reverse();
    expect(() => encodeSnapshot(unsorted)).toThrow(/unordered/);
  });

  it("rejects secondary ids outside [firstId, firstId + MAX_SECONDARY_ID_SPAN)", () => {
    const { frame, manifest } = hierarchyFixture();
    const firstId = 22;
    const accepts = (id: number) => {
      const snapshot = decodeSnapshot(encodeSnapshot(frame));
      snapshot.secondary!.fragments[4].id = id;
      return verifySnapshot(snapshot, manifest);
    };
    expect(accepts(firstId + MAX_SECONDARY_ID_SPAN - 1)).toBe(true);
    expect(accepts(firstId + MAX_SECONDARY_ID_SPAN)).toBe(false);
    expect(accepts(Number.MAX_SAFE_INTEGER)).toBe(false);
    const low = decodeSnapshot(encodeSnapshot(secondaryFixture().frame));
    low.secondary!.fragments[0].id = 21;
    expect(verifySnapshot(low, secondaryFixture().manifest)).toBe(false);
    const fresh = decodeSnapshot(encodeSnapshot(secondaryFixture().frame));
    expect(fresh.secondary!.fragments[0].id).toBe(firstId);
    expect(verifySnapshot(fresh, secondaryFixture().manifest)).toBe(true);
  });

  it("enforces generation, parent and root lineage rules", () => {
    const { frame, manifest } = hierarchyFixture();
    const packet = encodeSnapshot(frame);
    const cases: Array<[string, (defs: SecondaryFragmentDef[]) => void]> = [
      ["gen1 parent differs from root", (defs) => Object.assign(defs[0], { parentId: 1 })],
      ["gen1 parent is a secondary id", (defs) => Object.assign(defs[0], { parentId: 22 })],
      ["gen2 parent equals root", (defs) => Object.assign(defs[1], { parentId: 11 })],
      ["gen2 parent present in frame", (defs) => Object.assign(defs[1], { parentId: 23 })],
      ["gen3 parent present in frame", (defs) => Object.assign(defs[3], { parentId: 26 })],
      ["parent equals id", (defs) => Object.assign(defs[1], { parentId: 25 })],
      ["parent after id", (defs) => Object.assign(defs[1], { parentId: 30 })],
      ["gen2 parent below firstId", (defs) => Object.assign(defs[1], { parentId: 5 })],
      ["generation zero", (defs) => Object.assign(defs[1], { generation: 0 })],
      ["generation above cap", (defs) => Object.assign(defs[1], { generation: MAX_FRACTURE_GENERATION + 1 })],
      ["missing rootId", (defs) => { delete (defs[1] as { rootId?: number }).rootId; }],
      ["root not a manifest fragment", (defs) => Object.assign(defs[1], { rootId: 999 })],
      ["root is a live primary", (defs) => Object.assign(defs[1], { rootId: 21 })],
      ["gen1 root is a live primary", (defs) => Object.assign(defs[0], { parentId: 21, rootId: 21 })],
      ["root is a secondary id", (defs) => Object.assign(defs[2], { rootId: 23 })],
      ["material differs from root", (defs) => { defs[2].material = 2; }],
      ["region differs from root", (defs) => { defs[2].region = 3; }],
    ];
    for (const [name, mutate] of cases) {
      expect([name, rejected(corruptSecondaryDefinitions(packet, mutate), manifest)]).toEqual([name, true]);
      const snapshot = decodeSnapshot(packet);
      mutate(snapshot.secondary!.fragments);
      expect([name, verifySnapshot(snapshot, manifest)]).toEqual([name, false]);
    }
    expect(MAX_FRACTURE_GENERATION).toBe(8);
    const deep = hierarchyFixture();
    Object.assign(deep.frame.secondary!.fragments[4], { generation: MAX_FRACTURE_GENERATION });
    expect(verifySnapshot(decodeSnapshot(encodeSnapshot(deep.frame)), deep.manifest)).toBe(true);
  });

  it("accepts a Retired root without live children and round trips an empty secondary section", () => {
    const { frame, manifest } = secondaryFixture();
    frame.secondary = {
      revision: 9,
      fragments: [],
      states: new Uint8Array(0),
      transforms: new Float32Array(0),
    };
    frame.stats.checksum = topologyChecksum(manifest, frame.bondStates, supportOf(frame, manifest));
    const packet = encodeSnapshot(frame);
    const snapshot = decodeSnapshot(packet);
    expect(snapshot.states[1]).toBe(FragmentState.Retired);
    expect(snapshot.secondary).toEqual({
      fragments: [],
      revision: 9,
      states: new Uint8Array(0),
      transforms: new Float32Array(0),
    });
    expect(verifySnapshot(snapshot, manifest)).toBe(true);
    expect(new SnapshotReceiver().accept(packet, manifest)).toBe(true);
    const partial = hierarchyFixture();
    partial.frame.states[2] = FragmentState.Retired;
    partial.frame.stats.checksum = topologyChecksum(
      partial.manifest,
      partial.frame.bondStates,
      supportOf(partial.frame, partial.manifest),
    );
    expect(verifySnapshot(decodeSnapshot(encodeSnapshot(partial.frame)), partial.manifest)).toBe(true);
    const absent = decodeSnapshot(packet);
    absent.secondary = undefined;
    expect(verifySnapshot(absent, manifest)).toBe(true);
  });

  it("bounds the live child count", () => {
    const { frame, manifest } = hierarchyFixture();
    const tooMany = decodeSnapshot(encodeSnapshot(frame));
    tooMany.secondary!.fragments = Array.from({ length: LIMITS.secondaryFragments + 1 }, (_, i) => cube(22 + i, 11));
    tooMany.secondary!.states = new Uint8Array(LIMITS.secondaryFragments + 1).fill(FragmentState.Dynamic);
    expect(verifySnapshot(tooMany, manifest)).toBe(false);
    frame.secondary!.fragments = tooMany.secondary!.fragments;
    frame.secondary!.states = tooMany.secondary!.states;
    frame.secondary!.transforms = new Float32Array((LIMITS.secondaryFragments + 1) * 8);
    expect(() => encodeSnapshot(frame)).toThrow(/limit/);
  });

  it("derives byte caps from the per-definition bound and keeps the server consistent", () => {
    expect(LIMITS.secondaryFragments).toBe(MAX_SECONDARY_FRAGMENTS);
    expect(MAX_SECONDARY_FRAGMENTS).toBe(4096);
    const worstObservedDefinitionBytes = 2607;
    expect(MAX_SECONDARY_DEFINITION_BYTES).toBeGreaterThanOrEqual(worstObservedDefinitionBytes * 1.25);
    expect(LIMITS.secondaryDefinitionBytes).toBe(
      MAX_SECONDARY_FRAGMENTS * (MAX_SECONDARY_DEFINITION_BYTES + 1) + 1,
    );
    const worstPrimaryBytes =
      32 + LIMITS.fragments * 24 + LIMITS.bonds + (MAX_EXPLOSIVES + MAX_CANNONBALLS) * 56;
    expect(LIMITS.packetBytes).toBeGreaterThanOrEqual(
      worstPrimaryBytes + 12 + LIMITS.secondaryDefinitionBytes + MAX_SECONDARY_FRAGMENTS * 24,
    );
  });

  it("encodes, decodes and verifies MAX_SECONDARY_FRAGMENTS definitions of exactly the per-definition bound", () => {
    const { frame, manifest } = secondaryFixture();
    frame.secondary!.fragments = Array.from({ length: MAX_SECONDARY_FRAGMENTS }, (_, i) =>
      maxDefinition(22 + i * 3, 11),
    );
    for (const fragment of frame.secondary!.fragments)
      expect(definitionBytes(fragment)).toBe(MAX_SECONDARY_DEFINITION_BYTES);
    frame.secondary!.states = new Uint8Array(MAX_SECONDARY_FRAGMENTS).fill(FragmentState.Settled);
    frame.secondary!.transforms = new Float32Array(
      Array.from({ length: MAX_SECONDARY_FRAGMENTS }, (_, i) => [i * 0.01, 1, 0, 0, 0, 0, 1, 0]).flat(),
    );
    const packet = encodeSnapshot(frame);
    const view = new DataView(packet);
    expect(view.getUint32(secondaryOffset(packet) + 8, true)).toBe(LIMITS.secondaryDefinitionBytes);
    expect(new TextDecoder().decode(new Uint8Array(packet, secondaryOffset(packet) + 12, LIMITS.secondaryDefinitionBytes))).toBe(
      JSON.stringify(frame.secondary!.fragments),
    );
    expect(packet.byteLength).toBeLessThanOrEqual(LIMITS.packetBytes);
    const snapshot = decodeSnapshot(packet);
    expect(snapshot.secondary!.fragments).toHaveLength(MAX_SECONDARY_FRAGMENTS);
    expect(snapshot.secondary!.fragments).toEqual(frame.secondary!.fragments);
    expect(verifySnapshot(snapshot, manifest)).toBe(true);
    expect(new SnapshotReceiver().accept(packet, manifest)).toBe(true);
  }, 30_000);

  it("rejects a single definition over the per-definition byte bound on encode and decode", () => {
    const { frame } = secondaryFixture();
    const oversize = maxDefinition(22, 11);
    oversize.pad += "x";
    expect(definitionBytes(oversize)).toBe(MAX_SECONDARY_DEFINITION_BYTES + 1);
    frame.secondary!.fragments[0] = oversize;
    expect(() => encodeSnapshot(frame)).toThrow(/definition byte limit/);
    frame.secondary!.fragments[0] = maxDefinition(22, 11);
    const packet = encodeSnapshot(frame);
    expect(decodeSnapshot(packet).secondary!.fragments[0]).toEqual(frame.secondary!.fragments[0]);
    const damaged = corruptSecondaryDefinitions(packet, (defs) => {
      (defs[0] as SecondaryFragmentDef & { pad: string }).pad += "x";
    });
    expect(new DataView(damaged).getUint32(secondaryOffset(damaged) + 8, true)).toBeLessThan(
      LIMITS.secondaryDefinitionBytes,
    );
    expect(() => decodeSnapshot(damaged)).toThrow(/definition byte limit/);
  });

  it("round trips child definitions, poses and retired parents in complete spectator keyframes", () => {
    const { frame, manifest } = secondaryFixture();
    const packet = encodeSnapshot(frame, true),
      snapshot = decodeSnapshot(packet);
    expect(snapshot.secondary?.fragments).toEqual(frame.secondary!.fragments);
    expect(snapshot.secondary?.revision).toBe(1);
    expect(snapshot.secondary?.states).toEqual(new Uint8Array([1, 2]));
    expect(snapshot.states[1]).toBe(4);
    frame.secondary!.transforms.forEach((n, i) =>
      expect(snapshot.secondary!.transforms[i]).toBeCloseTo(n, 3),
    );
    expect(verifySnapshot(snapshot, manifest)).toBe(true);
    const receiver = new SnapshotReceiver();
    expect(receiver.accept(packet, manifest)).toBe(true);
    expect(receiver.current?.secondary?.fragments).toHaveLength(2);
    expect(receiver.accept(packet, manifest)).toBe(true); // repeated complete repair
    const padded = new Uint8Array(packet.byteLength + 9);
    padded.set(new Uint8Array(packet), 9);
    expect(decodeSnapshot(padded.subarray(9)).secondary).toEqual(
      snapshot.secondary,
    );
  });

  it("still decodes v1 and v2 packets, including v2 ordnance", () => {
    for (const version of [1, 2]) {
      const { frame } = fixture();
      if (version === 2)
        frame.ordnance = [
          {
            type: "explosive",
            id: 7,
            source: 1,
            radius: 0.2,
            position: [0, 1, 0],
            rotation: [0, 0, 0, 1],
          },
        ];
      const current = encodeSnapshot(frame),
        packet = current.slice(0, secondaryOffset(current)),
        view = new DataView(packet);
      view.setUint8(4, version);
      view.setUint32(24, packet.byteLength, true);
      const snapshot = decodeSnapshot(packet);
      expect(snapshot.secondary).toBeUndefined();
      expect(snapshot.states).toEqual(frame.states);
      expect(snapshot.ordnance).toHaveLength(version === 2 ? 1 : 0);
    }
  });

  it("decodes v3 debris snapshots by synthesizing rootId from the generation-1 parent", () => {
    const { frame, manifest } = secondaryFixture();
    const packet = legacyV3Packet(frame);
    const snapshot = decodeSnapshot(packet);
    expect(snapshot.secondary!.fragments.map((f) => [f.id, f.parentId, f.rootId, f.generation])).toEqual([
      [22, 11, 11, 1],
      [23, 11, 11, 1],
    ]);
    expect(verifySnapshot(snapshot, manifest)).toBe(true);
    const deeper = corruptSecondaryDefinitions(packet, (defs) => {
      Object.assign(defs[1], { generation: 2, parentId: 22 });
    });
    expect(() => decodeSnapshot(deeper)).toThrow(/snapshot version/);
    const explicitRoot = corruptSecondaryDefinitions(packet, (defs) => {
      Object.assign(defs[0], { rootId: 11 });
    });
    expect(() => decodeSnapshot(explicitRoot)).toThrow(/snapshot version/);
    const supportedState = packet.slice(0);
    new DataView(supportedState).setUint8(supportedState.byteLength - 24 + 22, FragmentState.Supported);
    expect(() => decodeSnapshot(supportedState)).toThrow(/fragment state/);
    const unrooted = encodeSnapshot(frame);
    new DataView(unrooted).setUint8(4, 3);
    expect(() => decodeSnapshot(unrooted)).toThrow(/snapshot version/);
  });

  it("accepts Supported secondary states but rejects Retired (4) secondary states in v4", () => {
    const { frame, manifest } = hierarchyFixture();
    const packet = encodeSnapshot(frame);
    const view = new DataView(packet);
    const firstState = packet.byteLength - frame.secondary!.states.length * 24 + 22;
    expect(view.getUint8(firstState)).toBe(FragmentState.Supported);
    expect(verifySnapshot(decodeSnapshot(packet), manifest)).toBe(true);
    const retired = packet.slice(0);
    new DataView(retired).setUint8(firstState, FragmentState.Retired);
    expect(() => decodeSnapshot(retired)).toThrow(/fragment state/);
    frame.secondary!.states[1] = FragmentState.Retired;
    expect(() => encodeSnapshot(frame)).toThrow(/fragment state/);
    const snapshot = decodeSnapshot(packet);
    snapshot.secondary!.states[1] = FragmentState.Retired;
    expect(verifySnapshot(snapshot, manifest)).toBe(false);
  });

  it("rejects unknown roots, authored ID collisions, and child definitions for live roots", () => {
    const { frame, manifest } = secondaryFixture();
    const packet = encodeSnapshot(frame);
    for (const mutate of [
      (defs: SecondaryFragmentDef[]) => {
        Object.assign(defs[0], { parentId: 999, rootId: 999 });
      },
      (defs: SecondaryFragmentDef[]) => {
        defs[0].id = manifest.fragments[0].id;
      },
      (defs: SecondaryFragmentDef[]) => {
        Object.assign(defs[0], { parentId: manifest.fragments[0].id, rootId: manifest.fragments[0].id });
      },
      (defs: SecondaryFragmentDef[]) => {
        defs[0].material = 2;
      },
    ])
      expect(rejected(corruptSecondaryDefinitions(packet, mutate), manifest)).toBe(true);
    const snapshot = decodeSnapshot(packet);
    snapshot.secondary = undefined;
    expect(verifySnapshot(snapshot, manifest)).toBe(true);
    frame.secondary = undefined;
    expect(verifySnapshot(decodeSnapshot(encodeSnapshot(frame)), manifest)).toBe(true);
  });

  it("rejects malformed convex geometry, duplicate IDs, volume and inertia corruption on the wire", () => {
    const packet = encodeSnapshot(secondaryFixture().frame);
    const mutations: ((defs: SecondaryFragmentDef[]) => void)[] = [
      (defs) => { Object.assign(defs[0], { generation: 0 }); },
      (defs) => { Object.assign(defs[0], { generation: MAX_FRACTURE_GENERATION + 1 }); },
      (defs) => { Object.assign(defs[0], { generation: 1.5 }); },
      (defs) => {
        defs[1].id = defs[0].id;
      },
      (defs) => {
        defs[0].shape!.vertices[0][0] = Infinity;
      },
      (defs) => {
        defs[0].size[0] = 0;
      },
      (defs) => {
        defs[0].mass = -1;
      },
      (defs) => {
        defs[0].shape!.vertices = Array.from({ length: 65 }, () => [0, 0, 0]);
      },
      (defs) => {
        defs[0].shape!.faces[0].vertices[0] = 500;
      },
      (defs) => {
        defs[0].shape!.faces[0].vertices.reverse();
      },
      (defs) => {
        defs[0].shape!.faces.pop();
      },
      (defs) => {
        defs[0].shape!.volume = 0.1;
      },
      (defs) => {
        defs[0].shape!.inertia[0] = -1;
      },
      (defs) => {
        defs[0].shape!.inertia[3] = 100;
      },
      (defs) => {
        defs[0].shape!.vertices.forEach((vertex) => {
          vertex[0] += 0.1;
        });
      },
    ];
    for (const mutate of mutations)
      expect(() =>
        decodeSnapshot(corruptSecondaryDefinitions(packet, mutate)),
      ).toThrow(ProtocolError);
  });

  it("rejects truncation, byte/count limit violations, invalid child states and malformed JSON", () => {
    const packet = encodeSnapshot(secondaryFixture().frame),
      offset = secondaryOffset(packet);
    expect(() => decodeSnapshot(packet.slice(0, -1))).toThrow(ProtocolError);
    for (const [index, mutate] of [
      (view: DataView) =>
        view.setUint32(offset + 4, LIMITS.secondaryFragments + 1, true),
      (view: DataView) =>
        view.setUint32(offset + 8, LIMITS.secondaryDefinitionBytes + 1, true),
      (view: DataView) => view.setUint32(offset + 4, 1, true),
      (view: DataView) => view.setUint8(offset + 12, 255),
      (view: DataView) => view.setUint8(packet.byteLength - 2, 5),
      (view: DataView) => view.setUint8(packet.byteLength - 2, 4),
      (view: DataView) => view.setUint8(packet.byteLength - 1, 1),
      (view: DataView) => view.setUint8(54, FragmentState.Hidden + 1),
      (view: DataView) => view.setUint8(32 + 3 * 24, BondState.Compliant + 1),
    ].entries()) {
      const damaged = packet.slice(0);
      mutate(new DataView(damaged));
      expect(() => decodeSnapshot(damaged), `mutation ${index}`).toThrow(ProtocolError);
    }
    expect(() =>
      decodeSnapshot(
        corruptSecondaryDefinitions(packet, (defs) => {
          Object.assign(defs[0], {
            padding: "x".repeat(LIMITS.secondaryDefinitionBytes),
          });
        }),
      ),
    ).toThrow(/byte limit/);
    const { frame } = secondaryFixture();
    frame.secondary!.states[0] = 5;
    expect(() => encodeSnapshot(frame)).toThrow(/state/);
  });

  it("accepts COM-centered asymmetric convex children whose AABB is not centered on the COM", () => {
    const { frame } = secondaryFixture();
    const child = frame.secondary!.fragments[0];
    child.size = [1, 1, 1];
    child.shape = {
      vertices: [
        [-0.25, -0.25, -0.25],
        [0.75, -0.25, -0.25],
        [-0.25, 0.75, -0.25],
        [-0.25, -0.25, 0.75],
      ],
      faces: [
        [0, 2, 1],
        [0, 1, 3],
        [0, 3, 2],
        [1, 2, 3],
      ].map((vertices) => ({ vertices, surface: "fracture" })),
      volume: 1 / 6,
      inertia: [3.75, 3.75, 3.75, 0.625, 0.625, 0.625],
    };
    expect(
      decodeSnapshot(encodeSnapshot(frame)).secondary!.fragments[0].shape,
    ).toEqual(child.shape);
  });
});

describe("replay and input authority", () => {
  const command = {
    type: "explosion" as const,
    id: 1,
    tick: 20,
    source: 1,
    position: [0, 1, 0] as [number, number, number],
    direction: [0, 1, 0] as [number, number, number],
    radius: 3,
    strength: 2,
  };
  const replay: ReplayLog = {
    version: 1,
    simulationVersion: SIMULATION_VERSION,
    scenario: "wall",
    assetHash: "test-v1",
    commands: [command],
    endTick: 100,
  };
  it("round trips a portable replay without accepting duplicate or out-of-bounds commands", () => {
    expect(parseReplay(serializeReplay(replay), "test-v1")).toEqual(replay);
    expect(() => parseReplay(serializeReplay(replay), "wrong")).toThrow(
      /hash mismatch/,
    );
    for (const invalid of [
      { ...replay, commands: [command, command] },
      { ...replay, commands: [{ ...command, position: [1e40, 0, 0] }] },
      { ...replay, commands: [{ ...command, radius: -1 }] },
      { ...replay, endTick: 10 },
      { ...replay, endTick: LIMITS.endTick + 1 },
      { ...replay, scenario: "missing" },
      { ...replay, commands: [null] },
      { ...replay, version: 99 },
    ])
      expect(() => parseReplay(JSON.stringify(invalid))).toThrow(ProtocolError);
    expect(() => parseReplay("{")).toThrow(/JSON/);
    expect(() =>
      parseReplay(JSON.stringify({ ...replay, endTick: 216_001 })),
    ).toThrow(/duration/);
    expect(() =>
      parseReplay(
        JSON.stringify({
          ...replay,
          commands: Array.from({ length: 10_001 }, (_, id) => ({
            ...command,
            id,
          })),
        }),
      ),
    ).toThrow(/limit/);
  });
  it("rejects removed player-weight recordings instead of silently changing their result", () => {
    for (const simulationVersion of [undefined, "rigid-bond-secondary-1", "rigid-bond-secondary-1-physics-operations-1", "rigid-bond-impact-hierarchy-1", "rigid-bond-impact-hierarchy-1-physics-operations-1", "rigid-bond-impact-hierarchy-2", "rigid-bond-impact-hierarchy-2-physics-operations-1", "rigid-bond-budgeted-3", "rigid-bond-budgeted-3-physics-operations-1", "rigid-bond-budgeted-4", "rigid-bond-budgeted-4-physics-operations-1"]) {
      expect(() => parseReplay(JSON.stringify({ ...replay, simulationVersion }))).toThrow(/simulation version/);
    }
    expect(() =>
      parseReplay(
        JSON.stringify({
          ...replay,
          simulationVersion: "rigid-bond-equilibrium-1",
        }),
      ),
    ).toThrow(/simulation version/);
    expect(() =>
      parseReplay(
        JSON.stringify({
          ...replay,
          simulationVersion: `${SIMULATION_VERSION}+player-loads-1`,
        }),
      ),
    ).toThrow(/simulation version/);
    expect(() =>
      parseReplay(JSON.stringify({ ...replay, playerLoads: [{ tick: 1 }] })),
    ).toThrow(/Player-weight recordings/);
  });
  it("preserves authoritative impact impulses when exporting and parsing replay commands", () => {
    const impact: ReplayLog = {
      ...replay,
      commands: [{
        ...command,
        type: "pointImpact",
        fragmentId: 22,
        impulse: [1.25, -0.5, 2.75],
      }],
    };
    expect(parseReplay(serializeReplay(impact))).toEqual(impact);
  });
  it("overrides client damage, identity and tick and rejects stale IDs/nonfinite vectors", () => {
    const accepted = commandFromIntent(
      { ...command, strength: 99999, radius: 99999, source: 99, tick: 0 },
      { tick: 51, source: 7, lastId: 0 },
    );
    expect(accepted).toMatchObject({
      radius: 3.2,
      strength: 2.8,
      tick: 51,
      source: 7,
    });
    expect(() =>
      commandFromIntent(command, { tick: 51, source: 7, lastId: 1 }),
    ).toThrow(/increase/);
    expect(() =>
      commandFromIntent(
        { ...command, direction: [NaN, 0, 0] },
        { tick: 51, source: 7, lastId: 0 },
      ),
    ).toThrow(/direction/);
  });
});

type Received = {
  binary: boolean;
  payload: Record<string, unknown> | Uint8Array;
};
class Inbox {
  queue: Received[] = [];
  listeners = new Set<() => void>();
  constructor(readonly socket: WebSocket) {
    socket.on("message", (data, binary) => {
      this.queue.push({
        binary,
        payload: binary
          ? new Uint8Array(data as Buffer)
          : JSON.parse(data.toString()),
      });
      for (const notify of this.listeners) notify();
    });
  }
  async next(predicate: (message: Received) => boolean): Promise<Received> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.listeners.delete(check);
        reject(new Error("Timed out waiting for WebSocket message"));
      }, 3000);
      const check = () => {
        const index = this.queue.findIndex(predicate);
        if (index === -1) return;
        clearTimeout(timeout);
        this.listeners.delete(check);
        resolve(this.queue.splice(index, 1)[0]);
      };
      this.listeners.add(check);
      check();
    });
  }
  json(type: string) {
    return this.next(
      (message) =>
        !message.binary &&
        (message.payload as Record<string, unknown>).type === type,
    );
  }
  send(value: unknown) {
    this.socket.send(JSON.stringify(value));
  }
}

describe("optional authoritative WebSocket service", () => {
  it("validates handshake, grants late join complete state, enforces damage policy, and repairs", async () => {
    const server = await startServer({
      port: 0,
      autoTick: false,
      scenario: "cantilever",
    });
    const first = new Inbox(new WebSocket(`ws://127.0.0.1:${server.port}`));
    const second = new Inbox(new WebSocket(`ws://127.0.0.1:${server.port}`));
    try {
      await first.json("welcome");
      first.send({
        type: "hello",
        protocol: PROTOCOL_VERSION,
        assetHash: server.manifest.assetHash,
      });
      await first.json("init");
      const initial = await first.next((message) => message.binary);
      expect(
        verifySnapshot(
          decodeSnapshot(initial.payload as Uint8Array),
          server.manifest,
        ),
      ).toBe(true);
      first.send({
        type: "command",
        command: {
          type: "explosion",
          id: 1,
          position: [-4, 2, 0],
          strength: 999,
          radius: 999,
        },
      });
      const ack = (await first.json("ack")).payload as {
        command: { strength: number; radius: number; tick: number };
      };
      expect(ack.command).toMatchObject({
        strength: 2.8,
        radius: 3.2,
        tick: 1,
      });
      for (let i = 0; i < 4; i++) server.step();
      const running = decodeSnapshot(
        (await first.next((message) => message.binary)).payload as Uint8Array,
      );
      expect(running.tick).toBe(4);
      await second.json("welcome");
      second.send({
        type: "hello",
        protocol: PROTOCOL_VERSION,
        assetHash: server.manifest.assetHash,
      });
      await second.json("init");
      const late = decodeSnapshot(
        (await second.next((message) => message.binary)).payload as Uint8Array,
      );
      expect(late.tick).toBe(4);
      expect(late.repair).toBe(true);
      expect(late.checksum).toBe(running.checksum);
      expect(verifySnapshot(late, server.manifest)).toBe(true);
      second.send({ type: "repair" });
      await second.json("repair");
      expect(
        decodeSnapshot(
          (await second.next((message) => message.binary))
            .payload as Uint8Array,
        ).checksum,
      ).toBe(running.checksum);
      second.send({ type: "repair" });
      expect((await second.json("error")).payload).toMatchObject({
        message: "Repair rate limit",
      });
      const response = await fetch(`http://127.0.0.1:${server.port}/replay`);
      const log = parseReplay(await response.text(), server.manifest.assetHash);
      expect(log.commands).toHaveLength(1);
      expect(log.endTick).toBe(4);
      first.send({
        type: "command",
        command: { type: "explosion", id: 1, position: [0, 0, 0] },
      });
      expect((await first.json("error")).payload).toMatchObject({
        message: "Command ID must increase",
      });
    } finally {
      first.socket.terminate();
      second.socket.terminate();
      await server.close();
    }
  }, 10000);

  it("rejects content mismatch before sending manifest or accepting damage", async () => {
    const server = await startServer({
      port: 0,
      autoTick: false,
      scenario: "cantilever",
    });
    const client = new Inbox(new WebSocket(`ws://127.0.0.1:${server.port}`));
    try {
      await client.json("welcome");
      client.send({
        type: "hello",
        protocol: PROTOCOL_VERSION,
        assetHash: "wrong",
      });
      expect((await client.json("error")).payload).toMatchObject({
        message: "Protocol or content hash mismatch",
      });
      expect(server.replay().commands).toHaveLength(0);
    } finally {
      client.socket.terminate();
      await server.close();
    }
  });

  it("caps command bursts and rejects oversized incoming messages", async () => {
    const server = await startServer({
      port: 0,
      autoTick: false,
      scenario: "cantilever",
    });
    const client = new Inbox(new WebSocket(`ws://127.0.0.1:${server.port}`));
    try {
      await client.json("welcome");
      client.send({
        type: "hello",
        protocol: PROTOCOL_VERSION,
        assetHash: server.manifest.assetHash,
      });
      await client.json("init");
      for (let id = 1; id <= 13; id++)
        client.send({
          type: "command",
          command: { type: "explosion", id, position: [-4, 2, 0] },
        });
      expect((await client.json("error")).payload).toMatchObject({
        message: "Command rate limit",
      });
      server.step();
      expect(server.replay().commands).toHaveLength(12);
      const closed = new Promise<number>((resolve) =>
        client.socket.once("close", (code) => resolve(code)),
      );
      client.send({ payload: "x".repeat(5000) });
      expect(await closed).toBe(1009);
    } finally {
      client.socket.terminate();
      await server.close();
    }
  });
});
