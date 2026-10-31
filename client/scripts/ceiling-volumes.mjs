import { Box3, Matrix4, Quaternion, Vector3 } from 'three';

const roundDown = value => Math.floor(value * 1000) / 1000;
const roundUp = value => Math.ceil(value * 1000) / 1000;
export function volumeFromBox(box) {
  const minX = roundDown(box.min.x), minZ = roundDown(box.min.z), bottomY = roundDown(box.min.y);
  // Exported cloth/ornament planes get a conservative 1 mm solid thickness.
  return { minX, maxX: Math.max(minX + .001, roundUp(box.max.x)), minZ, maxZ: Math.max(minZ + .001, roundUp(box.max.z)), bottomY, topY: Math.max(bottomY + .001, roundUp(box.max.y)) };
}
export function ceilingVolumesFromGlb(gltf) {
  const authored = gltf.nodes.find(node => node.extras?.ceilingVolumes)?.extras.ceilingVolumes;
  if (authored) return authored;
  const volumes = [];
  function visit(index, parent) {
    const node = gltf.nodes[index];
    const local = node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(
      new Vector3().fromArray(node.translation ?? [0, 0, 0]), new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]), new Vector3().fromArray(node.scale ?? [1, 1, 1]));
    const world = parent.clone().multiply(local);
    for (const primitive of gltf.meshes?.[node.mesh]?.primitives ?? []) {
      const accessor = gltf.accessors[primitive.attributes.POSITION];
      const box = new Box3(new Vector3().fromArray(accessor.min), new Vector3().fromArray(accessor.max)).applyMatrix4(world);
      if (box.min.y >= 1.8 && box.min.y <= 6.2) volumes.push(volumeFromBox(box));
    }
    for (const child of node.children ?? []) visit(child, world);
  }
  for (const index of gltf.scenes[gltf.scene ?? 0].nodes) visit(index, new Matrix4());
  return volumes;
}
export function placeVolumes(volumes, x, z) {
  return volumes.map(v => ({ ...v, minX: roundDown(v.minX + x), maxX: roundUp(v.maxX + x), minZ: roundDown(v.minZ + z), maxZ: roundUp(v.maxZ + z) }));
}

/** Remove containment and merge only boxes whose union is itself a box (no invented solid gaps). */
export function compactVolumes(input) {
  const volumes = input.filter((a, i) => !input.some((b, j) => i !== j && a.minX >= b.minX && a.maxX <= b.maxX && a.minZ >= b.minZ && a.maxZ <= b.maxZ && a.bottomY >= b.bottomY && a.topY <= b.topY && (i > j || a.minX > b.minX || a.maxX < b.maxX || a.minZ > b.minZ || a.maxZ < b.maxZ || a.bottomY > b.bottomY || a.topY < b.topY)));
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < volumes.length; i++) for (let j = i + 1; j < volumes.length; j++) {
      const a = volumes[i], b = volumes[j];
      for (const [lo, hi, rest] of [['minX','maxX',['minZ','maxZ','bottomY','topY']],['minZ','maxZ',['minX','maxX','bottomY','topY']],['bottomY','topY',['minX','maxX','minZ','maxZ']]]) {
        if (rest.every(key => a[key] === b[key]) && a[lo] <= b[hi] && b[lo] <= a[hi]) {
          volumes[i] = { ...a, [lo]: Math.min(a[lo], b[lo]), [hi]: Math.max(a[hi], b[hi]) }; volumes.splice(j, 1); changed = true; break outer;
        }
      }
    }
  }
  return volumes;
}

/** Split a volume at chunk seams so every owner's bounded data covers only its own cell. */
export function distributeVolumes(chunks, volumes, size, origin) {
  for (const chunk of chunks) {
    const minX = origin.x + chunk.x * size, minZ = origin.z + chunk.z * size;
    const clipped = volumes.filter(v => v.minX < minX + size && v.maxX > minX && v.minZ < minZ + size && v.maxZ > minZ)
      .map(v => ({ ...v, minX: Math.max(minX, v.minX), maxX: Math.min(minX + size, v.maxX), minZ: Math.max(minZ, v.minZ), maxZ: Math.min(minZ + size, v.maxZ) }));
    if (clipped.length) chunk.ceilingVolumes = compactVolumes([...(chunk.ceilingVolumes ?? []), ...clipped]);
    if ((chunk.ceilingVolumes?.length ?? 0) > 128) throw new Error(`Too many ceilings in ${chunk.id}`);
  }
}
