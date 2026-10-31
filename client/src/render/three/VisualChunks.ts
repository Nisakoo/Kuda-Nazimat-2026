import { Group } from 'three';
import type { Scene } from 'three';
import type { VisualChunk } from '../RenderAdapter';
import type { GltfLibrary, ModelInstance } from './GltfLibrary';
import { abortError } from '../../shared/AsyncLeaseCache';

interface ChunkState { readonly controller: AbortController; readonly root: Group; readonly models: ModelInstance[] }

export class VisualChunks {
  private readonly chunks = new Map<string, ChunkState>();
  constructor(private readonly scene: Scene, private readonly library: GltfLibrary) {}
  get ids(): readonly string[] { return [...this.chunks.keys()]; }

  async load(chunk: VisualChunk): Promise<void> {
    if (new Set(chunk.objects.map((object) => object.id)).size !== chunk.objects.length) throw new Error('Duplicate visual object');
    this.unload(chunk.id);
    const state: ChunkState = { controller: new AbortController(), root: new Group(), models: [] };
    state.root.name = `chunk:${chunk.id}`;
    this.chunks.set(chunk.id, state);
    this.scene.add(state.root);
    try {
      await Promise.all(chunk.objects.map(async (object) => {
        const model = await this.library.instantiate(object.assetId, state.controller.signal);
        if (this.chunks.get(chunk.id) !== state || state.controller.signal.aborted) { model.dispose(); throw abortError(); }
        const root = new Group();
        root.name = object.id;
        root.position.set(object.transform.position.x, object.transform.position.y, object.transform.position.z);
        root.rotation.y = object.transform.rotationY;
        root.add(model.root);
        state.models.push(model);
        model.animate(object.animation ?? 'idle', 0);
        root.userData.animation = object.animation ?? 'idle';
        state.root.add(root);
      }));
    } catch (error) {
      if (this.chunks.get(chunk.id) === state) this.unload(chunk.id);
      throw error;
    }
  }

  animate(delta: number): void {
    for (const state of this.chunks.values()) state.models.forEach((model, index) => model.animate(String(state.root.children[index]?.userData.animation ?? 'idle'), delta));
  }

  unload(id: string): void {
    const state = this.chunks.get(id);
    if (!state) return;
    this.chunks.delete(id);
    state.controller.abort();
    for (const model of state.models) model.dispose();
    state.root.removeFromParent();
  }
  dispose(): void { for (const id of [...this.chunks.keys()]) this.unload(id); }
}
