import type { Object3D } from 'three';

const cache = new WeakMap<Object3D, Map<string, Object3D | undefined>>();

/** Per-frame name lookups on immutable model clones; avoids a full traverse per call.
 * Only for roots whose named descendants are never replaced after instantiation. */
export function namedNode(root: Object3D, name: string): Object3D | undefined {
  let names = cache.get(root);
  if (!names) { names = new Map(); cache.set(root, names); }
  if (names.has(name)) return names.get(name);
  const node = root.getObjectByName(name);
  names.set(name, node);
  return node;
}
