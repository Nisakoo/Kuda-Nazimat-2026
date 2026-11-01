import { Box3, BufferGeometry, Mesh, Ray, Sphere, Vector3, Matrix4, Object3D, Line } from 'three';
import type { Intersection, Raycaster } from 'three';

interface Range { readonly start: number; readonly count: number; readonly bounds: Box3 }
interface Index { readonly positionVersion: number; readonly indexVersion: number; readonly ranges: readonly Range[] }
interface Bounds { readonly own: Box3; readonly tree: Box3; readonly matrix: Matrix4; geometry: BufferGeometry | null; version: number; bounded: boolean }

/** Bounds for contiguous triangle ranges; vertex/index buffers remain shared with the model. */
export class CameraRaycast {
  private readonly bounds = new WeakMap<Object3D, Bounds>();
  private readonly boundsVersions = new WeakMap<BufferGeometry, { position: unknown; version: number }>();
  private readonly indices = new WeakMap<BufferGeometry, Index>();
  private readonly geometry = new BufferGeometry();
  private readonly proxy: Mesh = new Mesh(this.geometry, []);
  private readonly localRay = new Ray();
  private readonly inverse = new Matrix4();
  private readonly vertex = new Vector3();
  private readonly sphere = new Sphere();

  /** One bottom-up broad phase for all five probes. Static world boxes are reused.
   * Unknown/custom raycasters remain unbounded; invisible source meshes still count. */
  prepare(object: Object3D, lineThreshold = 1): Box3 | null {
    let state = this.bounds.get(object);
    if (!state) {
      state = { own: new Box3(), tree: new Box3(), matrix: new Matrix4(), geometry: null, version: -1, bounded: true };
      this.bounds.set(object, state);
    }
    state.tree.makeEmpty(); state.bounded = true;
    if (object.userData.cameraIgnore === true) return state.tree;
    const plainMesh = object instanceof Mesh && object.raycast === Mesh.prototype.raycast && !object.morphTargetInfluences?.length;
    const plainLine = object instanceof Line && object.raycast === Line.prototype.raycast;
    if (plainMesh || plainLine) {
      const geometry = (object as Mesh | Line).geometry;
      const position = geometry.getAttribute('position');
      const version = position ? 'isInterleavedBufferAttribute' in position ? position.data.version : position.version : -1;
      const cached = this.boundsVersions.get(geometry);
      const changed = !cached || cached.position !== position || cached.version !== version;
      if (changed || !geometry.boundingBox) {
        geometry.computeBoundingBox();
        this.boundsVersions.set(geometry, { position, version });
      }
      if (changed || state.geometry !== geometry || state.version !== version || !state.matrix.equals(object.matrixWorld)) {
        state.own.copy(geometry.boundingBox!).applyMatrix4(object.matrixWorld);
        state.geometry = geometry; state.version = version; state.matrix.copy(object.matrixWorld);
      }
      state.tree.copy(state.own);
      if (plainLine) {
        // Line.raycast divides its local tolerance by local (not world) scale.
        // Frobenius norm bounds world stretch, including parent scale/shear.
        const m = object.matrixWorld.elements;
        const stretch = Math.hypot(m[0]!, m[1]!, m[2]!, m[4]!, m[5]!, m[6]!, m[8]!, m[9]!, m[10]!);
        const scale = Math.abs((object.scale.x + object.scale.y + object.scale.z) / 3);
        if (scale > 0) state.tree.expandByScalar(lineThreshold * stretch / scale); else state.bounded = false;
      }
    } else if (object.raycast !== Object3D.prototype.raycast) state.bounded = false;
    for (const child of object.children) {
      const bounds = this.prepare(child, lineThreshold);
      if (bounds) state.tree.union(bounds); else state.bounded = false;
    }
    return state.bounded ? state.tree : null;
  }

  intersect(object: Object3D, ray: Raycaster, hits: Intersection[]): void {
    if (object.userData.cameraIgnore === true) return;
    const state = this.bounds.get(object);
    if (state?.bounded && (state.tree.isEmpty() || state.tree.distanceToPoint(ray.ray.origin) > ray.far || !ray.ray.intersectsBox(state.tree))) return;
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
