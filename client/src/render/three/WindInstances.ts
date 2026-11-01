import { DynamicDrawUsage, InstancedMesh, Matrix4, Mesh, Sphere, Vector3 } from 'three';
import type { Object3D } from 'three';

interface Batch { readonly mesh: InstancedMesh; readonly sources: readonly Mesh[]; readonly paths: readonly (readonly Object3D[])[] }

/** Repeated wind surfaces retain their pivots; only their GPU submissions are combined. */
export class WindInstances {
  private readonly batches: Batch[] = [];
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
      mesh.userData.cameraIgnore = true;
      for (const node of sources) node.visible = false;
      const paths = sources.map(source => {
        const path: Object3D[] = [];
        for (let node: Object3D | null = source; node && node !== root; node = node.parent) path.unshift(node);
        return path;
      });
      // Bound arbitrary rotations around each first mutable pivot, rather than
      // around the model origin: a root-centred sphere submits distant batches.
      // Authored translations/scales on wind paths remain fixed.
      source.geometry.computeBoundingSphere();
      const geometrySphere = source.geometry.boundingSphere!;
      const bounds = new Sphere(new Vector3(), -1);
      const sphere = new Sphere();
      const prefix = new Matrix4();
      for (const path of paths) {
        const firstMutable = path.findIndex(node => node.matrixAutoUpdate);
        const pivot = firstMutable < 0 ? path.length - 1 : firstMutable;
        let reach = geometrySphere.center.length() + geometrySphere.radius;
        for (let i = path.length - 1; i >= pivot; i--) {
          const node = path[i]!;
          reach *= Math.max(Math.abs(node.scale.x), Math.abs(node.scale.y), Math.abs(node.scale.z));
          if (i > pivot) reach += node.position.length();
        }
        prefix.identity();
        for (let i = 0; i < pivot; i++) prefix.multiply(path[i]!.matrix);
        sphere.center.copy(path[pivot]!.position).applyMatrix4(prefix);
        const m = prefix.elements;
        const shear = Math.abs(m[0]!*m[4]!+m[1]!*m[5]!+m[2]!*m[6]!)
          + Math.abs(m[0]!*m[8]!+m[1]!*m[9]!+m[2]!*m[10]!)
          + Math.abs(m[4]!*m[8]!+m[5]!*m[9]!+m[6]!*m[10]!);
        const stretch = shear < 1e-10 ? prefix.getMaxScaleOnAxis()
          : Math.hypot(m[0]!,m[1]!,m[2]!,m[4]!,m[5]!,m[6]!,m[8]!,m[9]!,m[10]!);
        sphere.radius = reach * stretch;
        bounds.union(sphere);
      }
      mesh.boundingSphere = bounds;
      root.add(mesh); this.batches.push({ mesh, sources, paths });
    }
    this.update();
  }

  update(): void {
    if (!this.batches.length) return;
    for (const { mesh, sources, paths } of this.batches) {
      sources.forEach((node, index) => {
        this.matrix.identity();
        for (const part of paths[index]!) {
          if (part.matrixAutoUpdate) part.updateMatrix();
          this.matrix.multiply(part.matrix);
        }
        let visible = true;
        for (let parent = node.parent; parent && parent !== this.root; parent = parent.parent) visible &&= parent.visible;
        if (!visible) this.matrix.makeScale(0, 0, 0);
        mesh.setMatrixAt(index, this.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const { mesh, sources } of this.batches.splice(0)) {
      mesh.removeFromParent(); mesh.dispose();
      for (const node of sources) node.visible = true;
    }
  }
}
