import { Group } from 'three';
import type { Scene } from 'three';
import type { VisualChunk } from '../RenderAdapter';
import type { GltfLibrary, ModelInstance } from './GltfLibrary';
import { abortError } from '../../shared/AsyncLeaseCache';
import { VisualWind } from './VisualWind';
import type { WorldLifeDefinition } from '../../../../shared/world-life/types.ts';

interface ChunkState { readonly controller: AbortController; readonly root: Group; readonly models: ModelInstance[]; readonly winds: VisualWind[]; ready: boolean }

export class VisualChunks {
  private symbolsVisible = true;
  setBuildingSymbols(visible: boolean): void {
    this.symbolsVisible = visible;
    for (const state of this.chunks.values()) for (const model of state.models) {
      const symbols = model.root.getObjectByName('babel-symbols');
      if (symbols) symbols.visible = visible;
    }
  }
  private readonly chunks = new Map<string, ChunkState>();
  constructor(private readonly scene: Scene, private readonly library: GltfLibrary) {}
  get ids(): readonly string[] { return [...this.chunks.keys()]; }
  get readyIds(): readonly string[] { return [...this.chunks].filter(([,state])=>state.ready).map(([id])=>id); }

  async load(chunk: VisualChunk): Promise<void> {
    if (new Set(chunk.objects.map((object) => object.id)).size !== chunk.objects.length) throw new Error('Duplicate visual object');
    this.unload(chunk.id);
    const state: ChunkState = { controller: new AbortController(), root: new Group(), models: [], winds: [], ready: false };
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
        const symbols = model.root.getObjectByName('babel-symbols');
        if (symbols) symbols.visible = this.symbolsVisible;
        state.models.push(model);
        model.animate(object.animation ?? 'idle', 0);
        root.userData.animation = object.animation ?? 'idle';
        state.root.add(root);
        state.winds.push(new VisualWind(model.root, chunk.id === '0_0' && object.assetId === 'market'));
      }));
      if (this.chunks.get(chunk.id) === state) state.ready = true;
    } catch (error) {
      if (this.chunks.get(chunk.id) === state) this.unload(chunk.id);
      throw error;
    }
  }

  animate(delta: number, timeMs = 0, wind?: WorldLifeDefinition['wind']): void {
    for (const state of this.chunks.values()) {
      state.models.forEach((model, index) => model.animate(String(state.root.children[index]?.userData.animation ?? 'idle'), delta));
      for (const flexible of state.winds) flexible.animate(timeMs, wind);
    }
  }

  unload(id: string): void {
    const state = this.chunks.get(id);
    if (!state) return;
    this.chunks.delete(id);
    state.controller.abort();
    for (const wind of state.winds) wind.dispose();
    for (const model of state.models) model.dispose();
    state.root.removeFromParent();
  }
  dispose(): void { for (const id of [...this.chunks.keys()]) this.unload(id); }
}
