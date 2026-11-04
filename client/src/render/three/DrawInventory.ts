import type { Material, Mesh, Object3D, Scene } from 'three';

export interface DrawGroup {
  readonly pass: 'main' | 'shadow'; readonly path: readonly string[];
  readonly geometry: string | null; readonly material: string; readonly sourceMaterials: readonly string[];
  readonly materialType: string; readonly meshType: string; readonly vertices: number;
  readonly instances: number;
  readonly castShadow: boolean; readonly receiveShadow: boolean; readonly layers: number;
  readonly mutableAncestors: readonly string[]; readonly visible: boolean; calls: number;
}

/** A single opt-in frame. Restores author callbacks even if rendering throws. */
export class DrawInventory {
  private readonly restore: (() => void)[] = [];
  private readonly groups = new Map<string, DrawGroup>();
  private overflow = false;
  constructor(scene: Scene) {
    scene.traverse(node => {
      if (!['Mesh', 'SkinnedMesh', 'InstancedMesh', 'Sprite', 'Line', 'Points'].includes(node.type)) return;
      const before = node.onBeforeRender, shadow = node.onBeforeShadow;
      node.onBeforeRender = (...args) => { this.record('main', node, args[4]); before.apply(node, args); };
      node.onBeforeShadow = (...args) => { this.record('shadow', node, args[5]); shadow.apply(node, args); };
      this.restore.push(() => { node.onBeforeRender = before; node.onBeforeShadow = shadow; });
    });
  }
  private record(pass: 'main' | 'shadow', node: Object3D, material: Material): void {
    const key = `${pass}:${node.id}:${material.id}`;
    const previous = this.groups.get(key);
    if (previous) { previous.calls++; return; }
    if (this.groups.size >= 16384) { this.overflow = true; return; }
    const mesh = node as Mesh;
    const chain: Object3D[] = [];
    for (let parent: Object3D | null = node; parent && !('isScene' in parent); parent = parent.parent) chain.unshift(parent);
    this.groups.set(key, { pass, path: chain.map(item => item.name || item.type), geometry: mesh.geometry?.uuid ?? null,
      material: material.uuid, sourceMaterials: (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).filter(Boolean).map(item => item.uuid),
      materialType: material.type, meshType: node.type, vertices: mesh.geometry?.attributes.position?.count ?? 0,
      instances: 'isInstancedMesh' in mesh ? (mesh as import('three').InstancedMesh).count : 1,
      castShadow: node.castShadow, receiveShadow: node.receiveShadow, layers: node.layers.mask,
      mutableAncestors: chain.filter(item => item.matrixAutoUpdate).map(item => item.name || item.type), visible: node.visible, calls: 1 });
  }
  finish() {
    for (const restore of this.restore) restore(); this.restore.length = 0;
    return { groups: [...this.groups.values()], overflow: this.overflow };
  }
}
