import { Group } from 'three';
import type { Scene } from 'three';
import type { VisualChunk } from '../RenderAdapter';
import type { GltfLibrary, ModelInstance } from './GltfLibrary';
import { abortError } from '../../shared/AsyncLeaseCache';
import { VisualWind } from './VisualWind';
import type { WorldLifeDefinition } from '../../../../shared/world-life/types.ts';

interface ChunkState { readonly controller: AbortController; readonly root: Group; readonly models: ModelInstance[]; readonly animations: string[]; readonly winds: VisualWind[]; readonly x: number; readonly z: number; loaded: boolean; progress: number }

export class VisualChunks {
  private symbolsVisible = true;
  private revealed = false;
  private readonly reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  reveal(): void { this.revealed = true; }
  get appearing(): number { let count = 0; for (const state of this.chunks.values()) if (state.progress < 1) count++; return count; }
  setBuildingSymbols(visible: boolean): void {
    this.symbolsVisible = visible;
    for (const state of this.chunks.values()) for (const model of state.models) {
      const symbols = model.root.getObjectByName('babel-symbols');
      if (symbols) symbols.visible = visible;
    }
  }
  private readonly chunks = new Map<string, ChunkState>();
  constructor(private readonly scene: Scene, private readonly library: GltfLibrary, private readonly farWindInterval = 0) {}
  get ids(): readonly string[] { return [...this.chunks.keys()]; }
  private ready: readonly string[] | null = null;
  /** Stable array identity until the ready set changes, so per-frame consumers can cache derived sets. */
  get readyIds(): readonly string[] {
    this.ready ??= [...this.chunks].filter(([,state])=>state.loaded).map(([id])=>id);
    return this.ready;
  }
  private readonly roots: Group[] = [];
  /** Chunk roots for camera probes; maintained on load/unload instead of filtering scene children per frame. */
  get obstacles(): readonly Group[] { return this.roots; }

  async load(chunk: VisualChunk): Promise<void> {
    if (new Set(chunk.objects.map((object) => object.id)).size !== chunk.objects.length) throw new Error('Duplicate visual object');
    this.unload(chunk.id);
    const [x, z] = chunk.id.split('_').map(Number);
    const state: ChunkState = { controller: new AbortController(), root: new Group(), models: [], animations: [], winds: [], x: x ?? NaN, z: z ?? NaN, loaded: false, progress: 0 };
    state.root.visible = false;
    state.root.position.y = this.reduced ? 0 : -3;
    state.root.name = `chunk:${chunk.id}`;
    this.chunks.set(chunk.id, state);
    this.scene.add(state.root); this.roots.push(state.root);
    try {
      await Promise.all(chunk.objects.map(async (object) => {
        const model = await this.library.instantiate(object.assetId, state.controller.signal, true);
        if (this.chunks.get(chunk.id) !== state || state.controller.signal.aborted) { model.dispose(); throw abortError(); }
        const root = new Group();
        root.name = object.id;
        root.position.set(object.transform.position.x, object.transform.position.y, object.transform.position.z);
        root.rotation.y = object.transform.rotationY;
        root.add(model.root);
        root.updateMatrix(); root.matrixAutoUpdate = false;
        const symbols = model.root.getObjectByName('babel-symbols');
        if (symbols) symbols.visible = this.symbolsVisible;
        state.models.push(model); state.animations.push(object.animation ?? 'idle');
        model.animate(object.animation ?? 'idle', 0);
        root.userData.animation = object.animation ?? 'idle';
        state.root.add(root);
        state.winds.push(new VisualWind(model.root, chunk.id === '0_0' && object.assetId === 'market'));
      }));
      state.loaded = true; this.ready = null;
    } catch (error) {
      if (this.chunks.get(chunk.id) === state) this.unload(chunk.id);
      throw error;
    }
  }

  animate(delta: number, timeMs = 0, wind?: WorldLifeDefinition['wind'], viewer?: { x: number; z: number }): void {
    for (const state of this.chunks.values()) {
      if (this.revealed && state.loaded) {
        state.root.visible = true;
        state.progress = Math.min(1, state.progress + delta / (this.reduced ? .1 : .6));
        if (state.root.matrixAutoUpdate) {
          state.root.position.y = this.reduced || state.progress === 1 ? 0 : -3 * Math.pow(1 - state.progress, 3);
          if (state.progress === 1) { state.root.updateMatrix(); state.root.matrixAutoUpdate = false; }
        }
      }
      for (let index = 0; index < state.models.length; index++) state.models[index]!.animate(state.animations[index]!, delta);
      const distant = viewer && Number.isFinite(state.x) && Number.isFinite(state.z) && Math.hypot(state.x * 32 - viewer.x, state.z * 32 - viewer.z) > 48;
      for (const flexible of state.winds) flexible.animate(timeMs, wind, distant ? this.farWindInterval : 0);
    }
  }

  unload(id: string): void {
    const state = this.chunks.get(id);
    if (!state) return;
    this.chunks.delete(id); this.ready = null;
    const root = this.roots.indexOf(state.root); if (root >= 0) this.roots.splice(root, 1);
    state.controller.abort();
    for (const wind of state.winds) wind.dispose();
    for (const model of state.models) model.dispose();
    state.root.removeFromParent();
  }
  dispose(): void { for (const id of [...this.chunks.keys()]) this.unload(id); }
}
