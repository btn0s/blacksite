import { BufferGeometry, Color, DynamicDrawUsage, Float32BufferAttribute, LineBasicMaterial, LineSegments, Matrix4, Vector3 } from 'three';
import { FragmentState, TRANSFORM_STRIDE, type DestructibleManifest, type SimulationFrame } from '../../destruction-domain/src/index';
import { GPUTransformPool } from './gpu-pool';

export class ConnectionOverlay {
  readonly object: LineSegments;
  private readonly geometry = new BufferGeometry();
  private readonly material = new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false });
  private readonly indices: Map<number, number>;
  private capacity = 0;
  private readonly matrix = new Matrix4();
  private readonly point = new Vector3();
  private readonly color = new Color();

  constructor(private readonly manifest: DestructibleManifest, private readonly pool: GPUTransformPool) {
    this.indices = new Map(manifest.fragments.map((fragment, index) => [fragment.id, index]));
    this.object = new LineSegments(this.geometry, this.material);
    this.object.name = 'cascade-show-connections';
    this.object.frustumCulled = false; this.object.renderOrder = 5; this.object.visible = false;
  }

  update(frame?: SimulationFrame | null): void {
    if (!this.object.visible) return;
    const bonds = frame?.bonds ?? this.manifest.bonds;
    if (bonds.length > this.capacity) {
      this.capacity = Math.max(16, 2 ** Math.ceil(Math.log2(bonds.length)));
      this.geometry.setAttribute('position', new Float32BufferAttribute(this.capacity * 6, 3).setUsage(DynamicDrawUsage));
      this.geometry.setAttribute('color', new Float32BufferAttribute(this.capacity * 6, 3).setUsage(DynamicDrawUsage));
    }
    const positions = this.geometry.getAttribute('position'), colors = this.geometry.getAttribute('color');
    let count = 0;
    for (let i = 0; i < bonds.length; i++) {
      const bond = bonds[i]!, a = this.indices.get(bond.a), b = this.indices.get(bond.b);
      if (a === undefined) continue;
      const state = frame?.bondStates[i] ?? 0;
      if (!this.nodePosition(a, frame)) continue;
      positions.setXYZ(count * 2, this.point.x, this.point.y, this.point.z);
      if (b !== undefined) {
        if (!this.nodePosition(b, frame)) continue;
      } else this.point.fromArray(bond.centroid ?? bond.section?.point ?? this.manifest.fragments[a]!.position);
      positions.setXYZ(count * 2 + 1, this.point.x, this.point.y, this.point.z);
      if (state === 3) this.color.set('#f14c45');
      else if (state === 4) this.color.set('#f3bb47');
      else if (state === 1 || state === 2) this.color.set('#ed875b');
      else this.color.set(b === undefined ? '#689dff' : '#54dbaf');
      colors.setXYZ(count * 2, this.color.r, this.color.g, this.color.b);
      colors.setXYZ(count * 2 + 1, this.color.r, this.color.g, this.color.b);
      count++;
    }
    this.geometry.setDrawRange(0, count * 2);
    positions.needsUpdate = colors.needsUpdate = true;
  }

  private nodePosition(index: number, frame?: SimulationFrame | null): boolean {
    const fragment = this.manifest.fragments[index]!;
    let ancestor: number | undefined = index;
    while (ancestor !== undefined) {
      const slot = this.pool.slots.get(`primary:${ancestor}`);
      if (slot !== undefined) {
        const owner = this.manifest.fragments[ancestor]!;
        this.matrix.fromArray(this.pool.matrices.image.data as Float32Array, slot * 16);
        this.point.set(fragment.position[0] - owner.position[0], fragment.position[1] - owner.position[1], fragment.position[2] - owner.position[2]).applyMatrix4(this.matrix);
        return true;
      }
      ancestor = this.indices.get(this.manifest.fragments[ancestor]!.parent ?? -1);
    }
    if (frame && frame.states[index] === FragmentState.Retired) return false;
    if (frame) this.point.fromArray(frame.transforms, index * TRANSFORM_STRIDE);
    else this.point.fromArray(fragment.position);
    return true;
  }

  dispose(): void { this.geometry.dispose(); this.material.dispose(); }
}
