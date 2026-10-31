import { isWalkable, footprintCells } from '../../../shared/map/walkability.ts';
import type { Vector3 } from '../core/types';
import type { VisualChunk } from '../render/RenderAdapter';
import type { ChunkData, ChunkEntry, MapSource, WorldManifest } from './types';
import { BudgetExhausted } from './WorldBudget';

export interface ChunkView { loadChunk(chunk: VisualChunk): Promise<void>; unloadChunk(id: string): void }
interface State { readonly entry: ChunkEntry; readonly controller: AbortController; status: 'loading' | 'ready' | 'error' | 'deferred'; data?: ChunkData; error?: string }

export class ChunkManager {
  private manifestValue: WorldManifest | null = null;
  private readonly states = new Map<string, State>();
  private readonly controller = new AbortController();
  private desired: ChunkEntry[] = [];
  private loading = 0;
  private disposed = false;
  private position: Vector3 | null = null;
  private radius = 1;
  private epoch = 0;
  private budgetEpoch = 0;
  constructor(private readonly source: MapSource, private readonly view: ChunkView, private readonly concurrency = 2) {}
  get manifest(): WorldManifest | null { return this.manifestValue; }
  get preparedChunks(): readonly string[] { return [...this.states.values()].filter((state) => state.status === 'ready').map((state) => state.entry.id); }
  get stats() { return { ready: [...this.states.values()].filter((state) => state.status === 'ready').length, loading: this.loading, deferred: [...this.states.values()].filter((state) => state.status === 'deferred').length, errors: [...this.states.values()].flatMap((state) => state.error ? [state.error] : []) }; }

  async start(position?: Vector3, prepare: (manifest: WorldManifest) => void = () => {}): Promise<WorldManifest> {
    const manifest = await this.source.manifest(this.controller.signal);
    if (this.disposed) throw new Error('Map disposed');
    this.manifestValue = manifest;
    prepare(manifest);
    this.plan(position ?? manifest.spawn);
    return manifest;
  }

  setRadius(radius: number): void { if (!Number.isSafeInteger(radius) || radius < 0 || radius > 2) throw new Error('Invalid chunk radius'); this.radius = radius; if (this.position) this.plan(this.position); }
  plan(position: Vector3): void {
    const manifest = this.manifestValue;
    if (!manifest || this.disposed) return;
    this.position = { ...position };
    if (this.budgetEpoch !== this.source.budgetEpoch) {
      this.budgetEpoch = this.source.budgetEpoch;
      for (const [id, state] of this.states) if (state.status === 'deferred') this.states.delete(id);
    }
    const x = Math.floor((position.x - manifest.origin.x) / manifest.chunkSize);
    const z = Math.floor((position.z - manifest.origin.z) / manifest.chunkSize);
    this.desired = manifest.chunks.filter((entry) => {
      if (Math.abs(entry.x - x) <= this.radius && Math.abs(entry.z - z) <= this.radius) return true;
      if (this.radius !== 0 || Math.abs(entry.x - x) > 1 || Math.abs(entry.z - z) > 1) return false;
      const minX = manifest.origin.x + entry.x * manifest.chunkSize;
      const minZ = manifest.origin.z + entry.z * manifest.chunkSize;
      const distanceX = Math.max(minX - position.x, position.x - minX - manifest.chunkSize, 0);
      const distanceZ = Math.max(minZ - position.z, position.z - minZ - manifest.chunkSize, 0);
      return Math.hypot(distanceX, distanceZ) < 2;
    })
      .sort((a, b) => {
        const distance = (entry: ChunkEntry) => Math.hypot(
          Math.max(manifest.origin.x + entry.x * manifest.chunkSize - position.x, position.x - manifest.origin.x - (entry.x + 1) * manifest.chunkSize, 0),
          Math.max(manifest.origin.z + entry.z * manifest.chunkSize - position.z, position.z - manifest.origin.z - (entry.z + 1) * manifest.chunkSize, 0),
        );
        return distance(a) - distance(b);
      });
    const wanted = new Set(this.desired.map((entry) => entry.id));
    for (const [id] of this.states) if (!wanted.has(id)) this.unload(id);
    this.pump();
  }

  private pump(): void {
    if (this.disposed) return;
    for (const entry of this.desired) {
      if (this.loading >= this.concurrency) break;
      if (this.states.has(entry.id)) continue;
      const state: State = { entry, controller: new AbortController(), status: 'loading' };
      const epoch = this.epoch;
      this.states.set(entry.id, state);
      this.loading++;
      void this.source.chunk(entry, state.controller.signal).then(async (data) => {
        if (this.disposed || this.states.get(entry.id) !== state || state.controller.signal.aborted) { data.release(); return; }
        state.data = data;
        await this.view.loadChunk(data.visual);
        if (this.states.get(entry.id) !== state || state.controller.signal.aborted) return;
        state.status = 'ready';
      }).catch((error: unknown) => {
        if (this.states.get(entry.id) !== state || this.disposed) return;
        state.status = error instanceof BudgetExhausted ? 'deferred' : 'error';
        if (state.status === 'error') state.error = error instanceof Error ? error.message : 'Chunk load failed';
        this.view.unloadChunk(entry.id);
        state.data?.release(); delete state.data;
        if (state.status === 'deferred') {
          // Prefer an approaching transition to a farther prepared prefetch.
          const rank = this.desired.findIndex((item) => item.id === entry.id);
          const victim = [...this.desired].reverse().find((item) => {
            if (this.desired.indexOf(item) <= rank || this.states.get(item.id)?.status !== 'ready' || !this.position || !this.manifestValue) return false;
            const { origin, chunkSize } = this.manifestValue;
            return this.position.x + 0.25 < origin.x + item.x * chunkSize || this.position.x - 0.25 >= origin.x + (item.x + 1) * chunkSize || this.position.z + 0.25 < origin.z + item.z * chunkSize || this.position.z - 0.25 >= origin.z + (item.z + 1) * chunkSize;
          });
          if (victim) { this.unload(victim.id); this.states.delete(entry.id); }
        }
      }).finally(() => {
        if (epoch === this.epoch) this.loading--;
        this.pump();
      });
    }
  }

  canWalk(position: Vector3): boolean {
    const manifest = this.manifestValue;
    if (!manifest) return false;
    return isWalkable(manifest, ({ x, z }) => {
      const state = [...this.states.values()].find((item) => item.entry.x === x && item.entry.z === z);
      return state?.status === 'ready' ? state.data?.collision : undefined;
    }, position.x, position.z);
  }
  isPrepared(position: Vector3): boolean {
    const manifest = this.manifestValue;
    return !!manifest && footprintCells(manifest, position.x, position.z).every(({ x, z }) =>
      [...this.states.values()].some((state) => state.entry.x === x && state.entry.z === z && state.status === 'ready'));
  }
  region(position: Vector3): string {
    const manifest = this.manifestValue;
    if (!manifest) return '';
    const x = Math.floor((position.x - manifest.origin.x) / manifest.chunkSize);
    const z = Math.floor((position.z - manifest.origin.z) / manifest.chunkSize);
    return manifest.chunks.find((entry) => entry.x === x && entry.z === z)?.region ?? '';
  }
  retry(): void { for (const [id, state] of this.states) if (state.status === 'error' || state.status === 'deferred') this.unload(id); this.pump(); }
  private unload(id: string): void {
    const state = this.states.get(id);
    if (!state) return;
    this.states.delete(id);
    state.controller.abort();
    this.view.unloadChunk(id);
    state.data?.release();
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.epoch++;
    this.controller.abort();
    for (const [id] of this.states) this.unload(id);
    this.source.dispose();
    this.manifestValue = null;
    this.loading = 0;
  }
}
