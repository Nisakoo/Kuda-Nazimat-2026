import { BufferGeometry, Matrix4, Mesh, PropertyBinding, Object3D } from 'three';
import type { AnimationClip, Material } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Subtrees the runtime addresses by name (visibility toggles, wind pivots) must stay separate objects. */
const KEEP = /^(wind-|babel-symbols$)/;

function attributeKey(geometry: BufferGeometry): string {
  const parts = Object.keys(geometry.attributes).sort().map(name => {
    const attribute = geometry.getAttribute(name);
    const array = 'isInterleavedBufferAttribute' in attribute ? attribute.data.array : attribute.array;
    return `${name}:${attribute.itemSize}:${attribute.normalized}:${array.constructor.name}`;
  });
  return `${parts.join(',')}|${geometry.index ? 'i' : 'n'}`;
}

/**
 * The frame a static mesh can be merged into: its nearest animated ancestor, or the model root.
 * Null when the mesh itself moves, is hidden, is addressed by name at runtime or is not a plain mesh.
 */
function anchorOf(mesh: Mesh, root: Object3D, animated: ReadonlySet<Object3D>): Object3D | null {
  // A mesh with children would take its subtree along when replaced; leave such parents alone.
  if (mesh.type !== 'Mesh' || !mesh.visible || mesh.children.length || Array.isArray(mesh.material) || mesh.morphTargetInfluences?.length || animated.has(mesh)) return null;
  const geometry = mesh.geometry;
  if (Object.keys(geometry.morphAttributes).length || geometry.groups.length || geometry.drawRange.start !== 0 || geometry.drawRange.count !== Infinity) return null;
  if (mesh.userData.cameraIgnore === true || mesh.renderOrder !== 0 || !mesh.frustumCulled) return null;
  let anchor: Object3D | null = null;
  for (let node: Object3D | null = mesh; node && node !== root; node = node.parent) {
    if (KEEP.test(node.name) || !node.visible) return null;
    if (node !== mesh && animated.has(node)) { anchor ??= node; }
  }
  // Wind/name checks must cover the whole path to the root even above an animated anchor.
  return anchor ?? root;
}

/**
 * Collapses static meshes that share an anchor frame, material, shadow flags and vertex layout into one
 * draw per group. Meshes under an animated node merge in that node's local space, so clips still move them.
 * Runs once per model template, after shadow configuration, so instances share the merged geometry.
 * Returns the number of draw calls removed per instance.
 */
export function mergeStaticMeshes(root: Object3D, clips: readonly AnimationClip[]): number {
  const animated = new Set<Object3D>();
  for (const clip of clips) for (const track of clip.tracks) {
    const node = PropertyBinding.findNode(root, PropertyBinding.parseTrackName(track.name).nodeName);
    if (node instanceof Object3D) animated.add(node);
  }
  root.updateMatrixWorld(true);
  const groups = new Map<string, { anchor: Object3D; meshes: Mesh[] }>();
  root.traverse(node => {
    if (!(node instanceof Mesh)) return;
    const anchor = anchorOf(node, root, animated);
    if (!anchor) return;
    const material = node.material as Material;
    const key = `${anchor.uuid}|${material.uuid}|${node.castShadow}|${node.receiveShadow}|${node.layers.mask}|${attributeKey(node.geometry)}`;
    const group = groups.get(key) ?? { anchor, meshes: [] }; group.meshes.push(node); groups.set(key, group);
  });
  let removed = 0;
  let index = 0;
  for (const { anchor, meshes } of groups.values()) {
    if (meshes.length < 2) continue;
    const toAnchor = new Matrix4().copy(anchor.matrixWorld).invert();
    const relative = meshes.map(mesh => new Matrix4().multiplyMatrices(toAnchor, mesh.matrixWorld));
    // Mirrored transforms flip winding; keep those meshes as authored instead of rewriting indices.
    const kept = meshes.filter((_, i) => relative[i]!.determinant() > 0);
    if (kept.length < 2) continue;
    const parts = kept.map(mesh => {
      const part = new BufferGeometry();
      // clone() also de-interleaves views into tight arrays, which mergeGeometries requires.
      for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) part.setAttribute(name, attribute.clone());
      if (mesh.geometry.index) part.setIndex(mesh.geometry.index.clone());
      part.applyMatrix4(relative[meshes.indexOf(mesh)]!);
      return part;
    });
    const geometry = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (!geometry) continue;
    const first = kept[0]!;
    const merged = new Mesh(geometry, first.material);
    merged.name = `static-merge-${index++}`;
    merged.castShadow = first.castShadow; merged.receiveShadow = first.receiveShadow; merged.layers.mask = first.layers.mask;
    for (const mesh of kept) mesh.removeFromParent();
    anchor.add(merged);
    removed += kept.length - 1;
  }
  return removed;
}
