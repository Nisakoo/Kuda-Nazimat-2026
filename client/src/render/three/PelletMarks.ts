import { DynamicDrawUsage, InstancedMesh, Matrix4, Sphere } from 'three';
import type { BufferGeometry, Material, Object3D, Scene } from 'three';
import type { BudgetLease, WorldBudget } from '../../map/WorldBudget';

interface Mark { readonly owner: Object3D; readonly matrix: Matrix4; age: number }
interface Batch { readonly mesh: InstancedMesh; readonly capacity: number }
let nextStore = 0;

/** Shares the original geometry/material; each surface owns its compact local batch. */
export class PelletMarks {
  private readonly marks: Mark[] = [];
  private readonly batches = new Map<Object3D, Batch>();
  private readonly reservation: BudgetLease;
  private disposed = false;
  static readonly reserveBytes = 256 * 1024;
  constructor(private readonly scene: Scene, private readonly geometry: BufferGeometry, private readonly material: Material, budget: WorldBudget) {
    // Includes CPU/GPU matrix capacity, transient growth and bounded JS bookkeeping.
    this.reservation = budget.reserve(`render:pellet-batches:${++nextStore}`, 0, PelletMarks.reserveBytes);
  }
  get count(): number { return this.marks.length; }
  get stats() {
    const capacities = [...this.batches.values()].reduce((sum, batch) => sum + batch.capacity, 0);
    return { marks: this.count, owners: this.batches.size, capacity: capacities, matrixBytes: capacities * 64 };
  }
  add(owner: Object3D, matrix: Matrix4): void {
    if (this.disposed) return;
    const dirty = new Set<Object3D>([owner]);
    if (this.marks.length === 96) dirty.add(this.marks.shift()!.owner);
    this.marks.push({ owner, matrix: matrix.clone(), age: 0 });
    for (const changed of dirty) this.rebuild(changed);
  }
  step(delta: number): void {
    const dirty = new Set<Object3D>();
    const connected = new Map<Object3D, boolean>();
    for (let index = this.marks.length - 1; index >= 0; index--) {
      const mark = this.marks[index]!; mark.age += delta;
      if (!connected.has(mark.owner)) {
        let root: Object3D = mark.owner;
        while (root.parent) root = root.parent;
        connected.set(mark.owner, root === this.scene);
      }
      if (mark.age > 30 || !connected.get(mark.owner)) { this.marks.splice(index, 1); dirty.add(mark.owner); }
    }
    for (const owner of dirty) this.rebuild(owner);
  }
  private rebuild(owner: Object3D): void {
    const marks = this.marks.filter(mark => mark.owner === owner);
    let batch = this.batches.get(owner);
    if (!marks.length) { if (batch) { batch.mesh.removeFromParent(); batch.mesh.dispose(); this.batches.delete(owner); } return; }
    if (!batch || batch.capacity < marks.length || batch.capacity >= marks.length * 2) {
      const capacity = Math.min(96, 2 ** Math.ceil(Math.log2(marks.length)));
      const mesh = new InstancedMesh(this.geometry, this.material, capacity);
      mesh.name = 'pellet-batch'; mesh.userData.cameraIgnore = true;
      mesh.raycast = () => {};
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      const old = batch;
      batch = { mesh, capacity }; this.batches.set(owner, batch); owner.add(mesh);
      if (old) { old.mesh.removeFromParent(); old.mesh.dispose(); }
    }
    batch.mesh.count = marks.length;
    marks.forEach((mark, index) => batch.mesh.setMatrixAt(index, mark.matrix));
    batch.mesh.instanceMatrix.needsUpdate = true;
    this.geometry.computeBoundingSphere();
    const bounds = new Sphere(); bounds.makeEmpty();
    const point = new Sphere();
    for (const mark of marks) {
      point.center.copy(this.geometry.boundingSphere!.center).applyMatrix4(mark.matrix);
      const e = mark.matrix.elements;
      // Frobenius norm bounds affine shear as well as nonuniform scaling.
      point.radius = this.geometry.boundingSphere!.radius * Math.hypot(e[0]!, e[1]!, e[2]!, e[4]!, e[5]!, e[6]!, e[8]!, e[9]!, e[10]!);
      bounds.union(point);
    }
    // Three's world-sphere transform uses maximum column length. Cover a sheared
    // owner conservatively too; this remains a surface-local, bounded group.
    bounds.radius *= Math.sqrt(3);
    batch.mesh.boundingSphere = bounds;
    batch.mesh.updateMatrixWorld(true);
  }
  clear(): void {
    for (const { mesh } of this.batches.values()) { mesh.removeFromParent(); mesh.dispose(); }
    this.batches.clear(); this.marks.length = 0;
  }
  dispose(): void { if (!this.disposed) { this.clear(); this.reservation.release(); this.disposed = true; } }
}
