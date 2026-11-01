import { DynamicDrawUsage, InstancedMesh, Matrix4, Mesh } from 'three';
import type { Object3D } from 'three';

interface Batch { readonly mesh: InstancedMesh; readonly sources: readonly Mesh[] }

/** Repeated wind surfaces retain their pivots; only their GPU submissions are combined. */
export class WindInstances {
  private readonly batches: Batch[] = [];
  private readonly inverse = new Matrix4();
  private readonly matrix = new Matrix4();

  constructor(private readonly root: Object3D) {
    const groups = new Map<string, Mesh[]>();
    root.traverse(node => {
      if (!(node instanceof Mesh) || node.type !== 'Mesh' || !node.visible || !/^wind-(leaf|grass|cloth|sign)-/.test(node.name)
        || Array.isArray(node.material) || node.material.transparent || node.morphTargetInfluences?.length) return;
      const key = `${node.geometry.uuid}:${node.material.uuid}:${node.castShadow}:${node.receiveShadow}:${node.layers.mask}`;
      const sources = groups.get(key) ?? []; sources.push(node); groups.set(key, sources);
    });
    let instances = 0;
    for (const sources of groups.values()) {
      // At most 64 KiB of matrices per model, within its conservative model reservation.
      if (sources.length < 2 || instances + sources.length > 1024) continue;
      instances += sources.length;
      const source = sources[0]!;
      const mesh = new InstancedMesh(source.geometry, source.material, sources.length);
      mesh.name = 'instanced-wind';
      mesh.castShadow = source.castShadow; mesh.receiveShadow = source.receiveShadow;
      mesh.layers.mask = source.layers.mask;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      // CameraRaycast still tests the original animated surfaces, including invisible meshes.
      mesh.raycast = () => {};
      for (const node of sources) node.visible = false;
      root.add(mesh); this.batches.push({ mesh, sources });
    }
    this.update();
  }

  update(): void {
    if (!this.batches.length) return;
    this.root.updateWorldMatrix(true, true);
    this.inverse.copy(this.root.matrixWorld).invert();
    for (const { mesh, sources } of this.batches) {
      sources.forEach((node, index) => {
        this.matrix.multiplyMatrices(this.inverse, node.matrixWorld);
        let visible = true;
        for (let parent = node.parent; parent && parent !== this.root; parent = parent.parent) visible &&= parent.visible;
        if (!visible) this.matrix.makeScale(0, 0, 0);
        mesh.setMatrixAt(index, this.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }

  dispose(): void {
    for (const { mesh, sources } of this.batches.splice(0)) {
      mesh.removeFromParent(); mesh.dispose();
      for (const node of sources) node.visible = true;
    }
  }
}
