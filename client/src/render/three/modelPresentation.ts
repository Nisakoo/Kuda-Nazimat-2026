import { Box3, Mesh, PropertyBinding, Vector3, Object3D } from 'three';
import type { AnimationClip } from 'three';
import type { GraphicsQuality } from '../GraphicsQuality';

/** Only streamed scenery is frozen; entity/hand/cat transforms stay mutable. */
export function freezeStaticTransforms(root: Object3D, clips: readonly AnimationClip[]): void {
  const animated = new Set<Object3D>();
  for (const clip of clips) for (const track of clip.tracks) {
    const binding = PropertyBinding.parseTrackName(track.name);
    const node = PropertyBinding.findNode(root, binding.nodeName);
    if (node instanceof Object3D) animated.add(node);
  }
  root.traverse(node => {
    if (animated.has(node) || /^wind-(leaf|grass|cloth|sign)-/.test(node.name) || 'isBone' in node) return;
    node.updateMatrix();
    node.matrixAutoUpdate = false;
  });
}

export function configureShadows(root: Object3D, quality: GraphicsQuality, assetId: string): void {
  root.updateMatrixWorld(true);
  const box = new Box3(), size = new Vector3();
  const character = /avatar|player|merchant|shepherd|goat|cat|bird/.test(assetId);
  root.traverse(node => {
    if (!(node instanceof Mesh)) return;
    node.receiveShadow = quality !== 'low';
    if (quality === 'high') { node.castShadow = true; return; }
    if (quality === 'low') { node.castShadow = false; return; }
    let actor = character, flexible = false;
    for (let parent: Object3D | null = node; parent; parent = parent.parent) {
      actor ||= /seller|merchant|shepherd|potter|visitor|goat|kid/.test(parent.name);
      flexible ||= /^wind-/.test(parent.name);
      if (parent === root) break;
    }
    node.geometry.computeBoundingBox();
    box.copy(node.geometry.boundingBox!).applyMatrix4(node.matrixWorld).getSize(size);
    // Keep silhouettes and architecture, omit grass, leaves and small props.
    node.castShadow = actor || (!flexible && size.y >= .25 && Math.max(size.x, size.y, size.z) >= 1);
  });
}
