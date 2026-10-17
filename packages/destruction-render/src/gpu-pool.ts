import { BatchedMesh, DataTexture, FloatType, Matrix4, RGBAFormat, Sphere, type Color, type Material, type Vector4 } from 'three';

/** One GPU matrix texture, shared by every primary and runtime draw. Slot zero is a tombstone. */
export class GPUTransformPool {
  readonly matrices: DataTexture;
  readonly colors: DataTexture;
  readonly generationBySlot: Uint32Array;
  readonly slots = new Map<string, number>();
  revision = 0;
  private readonly free: number[];
  private readonly matrixDirty = new Set<number>();
  private readonly colorDirty = new Set<number>();

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 2) throw new Error('GPU transform capacity must exceed one');
    const matrixWidth = Math.ceil(Math.sqrt(capacity * 4) / 4) * 4;
    this.matrices = new DataTexture(new Float32Array(matrixWidth * Math.ceil(capacity * 4 / matrixWidth) * 4), matrixWidth, Math.ceil(capacity * 4 / matrixWidth), RGBAFormat, FloatType);
    const colorWidth = Math.ceil(Math.sqrt(capacity));
    const colors = new Float32Array(colorWidth * Math.ceil(capacity / colorWidth) * 4).fill(1);
    colors.fill(0, 0, 4);
    this.colors = new DataTexture(colors, colorWidth, Math.ceil(capacity / colorWidth), RGBAFormat, FloatType);
    this.matrices.name = 'cascade-global-transforms';
    this.colors.name = 'cascade-global-instance-colors';
    this.matrices.needsUpdate = this.colors.needsUpdate = true;
    for (const texture of [this.matrices, this.colors]) {
      texture.userData.fullUpload = true;
      texture.onUpdate = () => { texture.userData.fullUpload = false; };
    }
    this.generationBySlot = new Uint32Array(capacity);
    this.free = Array.from({ length: capacity - 1 }, (_, index) => capacity - 1 - index);
  }

  /** Release keys that are gone, then claim slots for new keys. Kept keys never move. */
  synchronize(keys: ReadonlySet<string>): boolean {
    let changed = false;
    for (const [key, slot] of this.slots) {
      if (keys.has(key)) continue;
      this.slots.delete(key);
      (this.matrices.image.data as Float32Array).fill(0, slot * 16, slot * 16 + 16);
      this.generationBySlot[slot]++;
      this.matrixDirty.add(slot);
      this.free.push(slot);
      changed = true;
    }
    for (const key of keys) {
      if (this.slots.has(key)) continue;
      const slot = this.free.pop();
      if (slot === undefined) throw new Error('GPU transform pool capacity exceeded');
      this.slots.set(key, slot);
      (this.colors.image.data as Float32Array).fill(1, slot * 4, slot * 4 + 4);
      this.colorDirty.add(slot);
      changed = true;
    }
    if (changed) this.revision++;
    return changed;
  }

  write(slot: number, matrix: Matrix4): void {
    if (!slot) return;
    const data = this.matrices.image.data as Float32Array, offset = slot * 16;
    let changed = false;
    for (let i = 0; i < 16; i++) {
      const value = Math.fround(matrix.elements[i]!);
      if (data[offset + i] !== value) { data[offset + i] = value; changed = true; }
    }
    if (changed) this.matrixDirty.add(slot);
  }

  writeColor(slot: number, color: Color | Vector4): void {
    if (!slot) return;
    const data = this.colors.image.data as Float32Array, offset = slot * 4;
    const value = color as Color & Vector4;
    const components = value.isColor ? [value.r, value.g, value.b, 1] : [value.x, value.y, value.z, value.w];
    let changed = false;
    for (let i = 0; i < 4; i++) {
      const component = Math.fround(components[i]!);
      if (data[offset + i] !== component) { data[offset + i] = component; changed = true; }
    }
    if (changed) this.colorDirty.add(slot);
  }

  flush(): void {
    // Three's texture update ranges are component offsets and must not cross rows.
    uploadRows(this.matrices, this.matrixDirty, 16);
    uploadRows(this.colors, this.colorDirty, 4);
    this.matrixDirty.clear(); this.colorDirty.clear();
  }

  dispose(): void { this.matrices.dispose(); this.colors.dispose(); this.slots.clear(); }
}

function uploadRows(texture: DataTexture, dirty: ReadonlySet<number>, components: number): void {
  if (!dirty.size) return;
  const rowComponents = texture.image.width * 4, rows = texture.image.height;
  const first = new Int32Array(rows).fill(-1), last = new Int32Array(rows);
  let touched = 0;
  for (const slot of dirty) {
    const start = slot * components, row = Math.floor(start / rowComponents);
    if (first[row] === -1) { first[row] = start; last[row] = start + components; touched++; }
    else { if (start < first[row]!) first[row] = start; if (start + components > last[row]!) last[row] = start + components; }
  }
  if (texture.userData.fullUpload || touched * 2 > rows) {
    texture.clearUpdateRanges();
    texture.userData.fullUpload = true;
  } else for (let row = 0; row < rows; row++) if (first[row] !== -1) texture.addUpdateRange(first[row]!, last[row]! - first[row]!);
  texture.needsUpdate = true;
}

type BatchStorage = {
  _matricesTexture: DataTexture; _colorsTexture: DataTexture | null;
  _indirectTexture: DataTexture; _visibilityChanged: boolean; _multiDrawCount: number;
};

/** Geometry stays material-local; GPU draw indirection addresses the shared transform pool. */
export class PooledBatchedMesh extends BatchedMesh {
  private localMatrices: DataTexture;
  private readonly globalSlots: number[] = [];
  private readonly storage: BatchStorage;
  constructor(readonly pool: GPUTransformPool, instances: number, vertices: number, material: Material) {
    super(instances, vertices, 0, material);
    // These batches bypass frustum culling. Give scene sorting a fixed center so it
    // never triggers an aggregate computeBoundingSphere; raycasts use per-geometry bounds.
    this.boundingSphere = new Sphere();
    this.boundingSphere.radius = Infinity;
    this.storage = this as unknown as BatchStorage;
    this.localMatrices = this.storage._matricesTexture;
    this.storage._matricesTexture = pool.matrices;
    this.storage._colorsTexture = pool.colors;
  }

  bind(instance: number, slot: number): void {
    if (this.globalSlots[instance] === slot) return;
    this.globalSlots[instance] = slot;
    this.storage._visibilityChanged = true;
  }

  override addInstance(geometryId: number): number {
    // addInstance initializes by local ID; keep that write out of other actors' shared slots.
    this.storage._matricesTexture = this.localMatrices;
    this.storage._colorsTexture = null;
    try { return super.addInstance(geometryId); }
    finally { this.storage._matricesTexture = this.pool.matrices; this.storage._colorsTexture = this.pool.colors; }
  }

  override setInstanceCount(count: number): void {
    // Three resizes and disposes its matrix/color textures here. Only the local
    // scratch matrix texture belongs to this batch; the shared pool must survive.
    this.storage._matricesTexture = this.localMatrices;
    this.storage._colorsTexture = null;
    try {
      super.setInstanceCount(count);
      this.globalSlots.length = Math.min(this.globalSlots.length, count);
      this.storage._visibilityChanged = true;
    } finally {
      this.localMatrices = this.storage._matricesTexture;
      this.storage._matricesTexture = this.pool.matrices;
      this.storage._colorsTexture = this.pool.colors;
    }
  }

  override setMatrixAt(instance: number, matrix: Matrix4): this { this.pool.write(this.globalSlots[instance] ?? 0, matrix); return this; }
  override getMatrixAt(instance: number, target: Matrix4): Matrix4 { return target.fromArray(this.pool.matrices.image.data as Float32Array, (this.globalSlots[instance] ?? 0) * 16); }
  override setColorAt(instance: number, color: Color | Vector4): this { this.pool.writeColor(this.globalSlots[instance] ?? 0, color); return this; }
  override getColorAt<T extends Color | Vector4>(instance: number, target: T): T { return target.fromArray(this.pool.colors.image.data as Float32Array, (this.globalSlots[instance] ?? 0) * 4) as T; }

  override onBeforeRender(...args: Parameters<BatchedMesh['onBeforeRender']>): void {
    const rebuild = this.storage._visibilityChanged || this.perObjectFrustumCulled || this.sortObjects;
    super.onBeforeRender(...args);
    if (!rebuild) return; // Cached draw IDs already address the global texture.
    const indirect = this.storage._indirectTexture.image.data as Uint32Array;
    for (let i = 0; i < this.storage._multiDrawCount; i++) indirect[i] = this.globalSlots[indirect[i]!] ?? 0;
    this.storage._indirectTexture.needsUpdate = true;
  }

  override dispose(): void {
    this.storage._matricesTexture = this.localMatrices;
    this.storage._colorsTexture = null;
    super.dispose();
  }
}
