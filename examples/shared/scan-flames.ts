import { BufferAttribute, BufferGeometry, Group, InstancedMesh, Matrix4, Vector3, type Camera } from 'three'
import type { Material } from 'three/webgpu'

export type ScanFlameGeometry = { position: number[]; normal: number[]; uv: number[]; index: number[] }
export type ScanFlameGroup = { geometry: ScanFlameGeometry; material: Material; matrices: Matrix4[] }

function createGeometry(source: ScanFlameGeometry) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(source.position), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(source.normal), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(source.uv), 2))
  geometry.setIndex(new BufferAttribute(new Uint32Array(source.index), 1))
  return geometry
}

export class ScanFlames {
  readonly object = new Group()
  private readonly groups: { mesh: InstancedMesh; bases: Matrix4[]; inverses: Matrix4[] }[] = []
  private readonly geometries = new Map<ScanFlameGeometry, BufferGeometry>()
  private readonly eye = new Vector3()
  private readonly local = new Vector3()
  private readonly turn = new Matrix4()
  private readonly placed = new Matrix4()

  constructor(groups: readonly ScanFlameGroup[]) {
    this.object.name = 'Scan flames'
    for (const group of groups) {
      if (!this.geometries.has(group.geometry)) this.geometries.set(group.geometry, createGeometry(group.geometry))
      const mesh = new InstancedMesh(this.geometries.get(group.geometry)!, group.material, group.matrices.length)
      mesh.name = group.material.name
      mesh.userData.material = group.material
      group.matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix))
      this.groups.push({ mesh, bases: group.matrices, inverses: group.matrices.map(matrix => matrix.clone().invert()) })
      this.object.add(mesh)
    }
  }

  update(camera: Camera) {
    camera.getWorldPosition(this.eye)
    for (const { mesh, bases, inverses } of this.groups) {
      for (let index = 0; index < bases.length; index++) {
        this.local.copy(this.eye).applyMatrix4(inverses[index]!)
        this.turn.makeRotationY(Math.atan2(this.local.x, this.local.z))
        mesh.setMatrixAt(index, this.placed.multiplyMatrices(bases[index]!, this.turn))
      }
      mesh.instanceMatrix.needsUpdate = true
    }
  }

  dispose() {
    for (const { mesh } of this.groups) mesh.dispose()
    for (const geometry of this.geometries.values()) geometry.dispose()
    this.object.clear()
  }
}
