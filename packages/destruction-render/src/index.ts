import { InstancedMesh, Matrix4 } from 'three';
export class TransformPool {
  readonly ownerBySlot: Int32Array;
  readonly generationBySlot: Uint32Array;
  private free: Array<number>;
  private low = Infinity;
  private high = -1;
  constructor(
    readonly mesh: InstancedMesh,
    readonly capacity: number,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('Transform pool capacity must be a positive integer');
    }
    this.ownerBySlot = new Int32Array(capacity).fill(-1);
    this.generationBySlot = new Uint32Array(capacity);
    this.free = Array.from({ length: capacity }, (_, i) => capacity - 1 - i);
  }
  allocate(owner: number) {
    if (this.ownerBySlot.includes(owner)) {
      throw new Error('Owner already has a slot');
    }
    const slot = this.free.pop();
    if (slot === undefined) {
      throw new Error('Transform pool capacity exceeded');
    }
    this.ownerBySlot[slot] = owner;
    return { generation: this.generationBySlot[slot]!, slot };
  }
  release(slot: number, generation: number) {
    if (
      !Number.isInteger(slot) ||
      slot < 0 ||
      slot >= this.capacity ||
      this.ownerBySlot[slot] === -1 ||
      this.generationBySlot[slot] !== generation
    ) {
      return false;
    }
    this.ownerBySlot[slot] = -1;
    this.generationBySlot[slot] = this.generationBySlot[slot]! + 1;
    this.mesh.setMatrixAt(slot, new Matrix4().makeScale(0, 0, 0));
    this.low = Math.min(this.low, slot);
    this.high = Math.max(this.high, slot);
    this.free.push(slot);
    return true;
  }
  write(slot: number, matrix: Matrix4) {
    if (
      !Number.isInteger(slot) ||
      slot < 0 ||
      slot >= this.capacity ||
      this.ownerBySlot[slot] === -1
    ) {
      throw new Error('Unowned slot');
    }
    this.mesh.setMatrixAt(slot, matrix);
    this.low = Math.min(this.low, slot);
    this.high = Math.max(this.high, slot);
  }
  flushDirtyRanges() {
    if (this.high < 0) {
      return;
    }
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(this.low * 16, (this.high - this.low + 1) * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.low = Infinity;
    this.high = -1;
  }
}

export { DestructionRenderer, type DestructionRendererOptions } from './renderer';
export { SecondaryFragmentRenderer } from './secondary';
export { fragmentEdgeGeometry, fragmentSurfaceGeometry, type FragmentSurface } from './surfaces';

export { GPUTransformPool } from './gpu-pool';
