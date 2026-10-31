import { Box3, BufferGeometry, Mesh, Ray, Sphere, Vector3, Matrix4 } from 'three';
import type { Intersection, Object3D, Raycaster } from 'three';

interface Range { readonly start: number; readonly count: number; readonly bounds: Box3 }
interface Index { readonly positionVersion: number; readonly indexVersion: number; readonly ranges: readonly Range[] }

/** Bounds for contiguous triangle ranges; vertex/index buffers remain shared with the model. */
export class CameraRaycast {
  private readonly indices = new WeakMap<BufferGeometry, Index>();
  private readonly geometry = new BufferGeometry();
  private readonly proxy: Mesh = new Mesh(this.geometry, []);
  private readonly localRay = new Ray();
  private readonly inverse = new Matrix4();
  private readonly vertex = new Vector3();
  private readonly sphere = new Sphere();

  intersect(object: Object3D, ray: Raycaster, hits: Intersection[]): void {
    if (ray.layers.test(object.layers)) {
      if (object instanceof Mesh && object.raycast === Mesh.prototype.raycast &&
          !object.morphTargetInfluences?.length && (object.geometry.index?.count ?? object.geometry.attributes.position?.count ?? 0) >= 3072) {
        this.intersectMesh(object, ray, hits);
      } else object.raycast(ray, hits);
    }
    for (const child of object.children) this.intersect(child, ray, hits);
  }

  private intersectMesh(mesh: Mesh, ray: Raycaster, hits: Intersection[]): void {
    const source = mesh.geometry;
    const position = source.getAttribute('position');
    // GLB can use interleaved attributes; their version belongs to the shared buffer.
    const positionVersion = 'isInterleavedBufferAttribute' in position ? position.data.version : position.version;
    const indexVersion = source.index?.version ?? 0;
    let index = this.indices.get(source);
    if (!index || index.positionVersion !== positionVersion || index.indexVersion !== indexVersion) {
      const ranges: Range[] = [];
      const count = source.index?.count ?? position.count;
      for (let start = 0; start < count; start += 384) {
        const end = Math.min(count, start + 384);
        const bounds = new Box3();
        for (let i = start; i < end; i++) bounds.expandByPoint(this.vertex.fromBufferAttribute(position, source.index?.getX(i) ?? i));
        ranges.push({ start, count: end - start, bounds });
      }
      index = { positionVersion, indexVersion, ranges };
      this.indices.set(source, index);
    }
    this.localRay.copy(ray.ray).applyMatrix4(this.inverse.copy(mesh.matrixWorld).invert());
    this.proxy.matrixWorld.copy(mesh.matrixWorld);
    this.proxy.material = mesh.material;
    this.geometry.attributes = source.attributes;
    this.geometry.index = source.index;
    this.geometry.groups = source.groups;
    const firstHit = hits.length;
    try {
      for (const range of index.ranges) {
        if (!this.localRay.intersectsBox(range.bounds)) continue;
        const start = Math.max(range.start, source.drawRange.start);
        const end = Math.min(range.start + range.count, source.drawRange.start + source.drawRange.count);
        if (end <= start) continue;
        this.geometry.setDrawRange(start, end - start);
        this.geometry.boundingBox = range.bounds;
        this.geometry.boundingSphere = range.bounds.getBoundingSphere(this.sphere);
        this.proxy.raycast(ray, hits);
      }
      for (let i = firstHit; i < hits.length; i++) hits[i]!.object = mesh;
    } finally {
      // The scratch mesh must not retain a released model or its resource leases.
      this.geometry.attributes = {};
      this.geometry.index = null;
      this.geometry.groups = [];
      this.geometry.boundingBox = null;
      this.geometry.boundingSphere = null;
      this.proxy.material = [];
    }
  }
}
