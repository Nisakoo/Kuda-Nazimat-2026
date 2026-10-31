import { isWalkable, isPathWalkable, footprintCells } from '../../../shared/map/walkability.ts';
import { ceilingsNear } from '../../../shared/map/ceilings.ts';
import type { CeilingVolume } from '../../../shared/map/manifest.ts';
import type { Vector3 } from '../core/types';
import type { VisualChunk } from '../render/RenderAdapter';
import type { ChunkData, ChunkEntry, MapSource, WorldManifest } from './types';
import { BudgetExhausted } from './WorldBudget';

export interface ChunkView { loadChunk(chunk: VisualChunk): Promise<void>; unloadChunk(id: string): void }
interface State { readonly entry: ChunkEntry; readonly controller: AbortController; status: 'loading' | 'ready' | 'error' | 'deferred'; data?: ChunkData; error?: string; deferredEpoch?: number }

export class ChunkManager {
  private manifestValue: WorldManifest | null = null;
  private readonly states = new Map<string, State>();
  private readonly cells = new Map<string, ChunkEntry>();
  private readonly controller = new AbortController();
  private desired: ChunkEntry[] = [];
  private loading = 0;
  private disposed = false;
  private position: Vector3 | null = null;
  private radius = 1;
  private epoch = 0;
  private budgetEpoch = 0;
  private plannedRadius = -1;
  private readonly evictions = new Set<string>();
  private readonly heldPrefetches = new Set<string>();
  constructor(private readonly source: MapSource, private readonly view: ChunkView, private readonly concurrency = 2) {}
  get manifest(): WorldManifest | null { return this.manifestValue; }
  get preparedChunks(): readonly string[] { return [...this.states.values()].filter((state) => state.status === 'ready').map((state) => state.entry.id); }
  get stats() { return { ready: [...this.states.values()].filter((state) => state.status === 'ready').length, loading: this.loading, deferred: [...this.states.values()].filter((state) => state.status === 'deferred').length, errors: [...this.states.values()].flatMap((state) => state.error ? [state.error] : []) }; }

  async start(position?: Vector3, prepare: (manifest: WorldManifest) => void = () => {}): Promise<WorldManifest> {
    const manifest = await this.source.manifest(this.controller.signal);
    if (this.disposed) throw new Error('Map disposed');
    this.manifestValue = manifest;
    for (const entry of manifest.chunks) this.cells.set(`${entry.x},${entry.z}`, entry);
    prepare(manifest);
    this.plan(position ?? manifest.spawn);
    return manifest;
  }

  setRadius(radius: number): void { if (!Number.isSafeInteger(radius) || radius < 0 || radius > 2) throw new Error('Invalid chunk radius'); this.radius = radius; if (this.position) this.plan(this.position); }
  plan(position: Vector3): void {
    const manifest = this.manifestValue;
    if (!manifest || this.disposed) return;
    const budgetChanged = this.budgetEpoch !== this.source.budgetEpoch;
    if (!budgetChanged && this.plannedRadius === this.radius && this.position?.x === position.x && this.position.z === position.z) return;
    this.position = { ...position };
    this.plannedRadius = this.radius;
    this.budgetEpoch = this.source.budgetEpoch;
    const x = Math.floor((position.x - manifest.origin.x) / manifest.chunkSize);
    const z = Math.floor((position.z - manifest.origin.z) / manifest.chunkSize);
    const previous = this.desired;
    const candidates: { entry: ChunkEntry; distance: number }[] = [];
    const radius = Math.max(1, this.radius);
    for (let cx = x - radius; cx <= x + radius; cx++) for (let cz = z - radius; cz <= z + radius; cz++) {
      const entry = this.cells.get(`${cx},${cz}`);
      if (!entry) continue;
      const dx = Math.max(manifest.origin.x + cx * manifest.chunkSize - position.x, position.x - manifest.origin.x - (cx + 1) * manifest.chunkSize, 0);
      const dz = Math.max(manifest.origin.z + cz * manifest.chunkSize - position.z, position.z - manifest.origin.z - (cz + 1) * manifest.chunkSize, 0);
      const distance = Math.hypot(dx, dz);
      if (this.radius > 0 || distance < 2) candidates.push({ entry, distance });
    }
    this.desired = candidates.sort((a, b) => a.distance - b.distance).map(({ entry }) => entry);
    const priorityChanged = previous.length !== this.desired.length || previous.some((entry, index) => entry !== this.desired[index]);
    if (budgetChanged) this.evictions.clear();
    if (priorityChanged) { this.evictions.clear(); this.heldPrefetches.clear(); }
    if (budgetChanged || priorityChanged) {
      for (const [id, state] of this.states) if (state.status === 'deferred' && !this.heldPrefetches.has(id) && (priorityChanged || state.deferredEpoch !== this.budgetEpoch)) this.states.delete(id);
    }
    const wanted = new Set(this.desired.map((entry) => entry.id));
    for (const [id] of this.states) if (!wanted.has(id)) this.unload(id);
    this.pump();
  }

  private pump(): void {
    if (this.disposed) return;
    for (const entry of this.desired) {
      if (this.loading >= this.concurrency) break;
      if (this.states.get(entry.id)?.status === 'deferred' && !this.heldPrefetches.has(entry.id)) {
        // A lower-priority load may have completed after this request was deferred.
        const rank = this.desired.indexOf(entry);
        const victim = this.desired.slice(rank + 1).reverse().find((item) => this.states.get(item.id)?.status === 'ready' && !this.containsPlayer(item) && !this.evictions.has(JSON.stringify([entry.id, item.id])));
        if (victim) {
          this.evictions.add(JSON.stringify([entry.id, victim.id]));
          this.unload(victim.id);
          // Do not immediately reload an evicted prefetch and evict it again if
          // the preferred resource cannot fit even after releasing this victim.
          this.states.set(victim.id, { entry: victim, controller: new AbortController(), status: 'deferred', deferredEpoch: this.source.budgetEpoch });
          this.heldPrefetches.add(victim.id);
          this.states.delete(entry.id);
        }
      }
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
        this.releaseData(state);
        if (state.status === 'deferred') state.deferredEpoch = this.source.budgetEpoch;
      }).finally(() => {
        if (epoch === this.epoch) this.loading--;
        this.pump();
      });
    }
    if (this.loading === 0 && this.heldPrefetches.size) {
      // Refill what still fits after the priority attempt settles. Remember failed
      // eviction pairs so an intrinsically oversized request cannot cause churn.
      for (const id of this.heldPrefetches) if (this.states.get(id)?.status === 'deferred') this.states.delete(id);
      this.heldPrefetches.clear();
      this.pump();
    }
  }

  private containsPlayer(entry: ChunkEntry): boolean {
    return !!this.position && !!this.manifestValue && footprintCells(this.manifestValue, this.position.x, this.position.z)
      .some(({ x, z }) => entry.x === x && entry.z === z);
  }

  private stateAt(x: number, z: number): State | undefined {
    const entry = this.cells.get(`${x},${z}`);
    return entry ? this.states.get(entry.id) : undefined;
  }

  private releaseData(state: State): void {
    const budgetWasCurrent = this.budgetEpoch === this.source.budgetEpoch;
    this.view.unloadChunk(state.entry.id);
    state.data?.release(); delete state.data;
    // Own synchronous releases already participate in pump's eviction/refill
    // round. A later release by another owner must permit a fresh round instead.
    if (budgetWasCurrent) this.budgetEpoch = this.source.budgetEpoch;
  }

  canWalk(position: Vector3): boolean {
    const manifest = this.manifestValue;
    if (!manifest) return false;
    return isWalkable(manifest, ({ x, z }) => {
      const state = this.stateAt(x, z);
      return state?.status === 'ready' ? state.data?.collision : undefined;
    }, position.x, position.z);
  }
  canTraverse(from: Vector3, to: Vector3): boolean {
    const manifest = this.manifestValue;
    return !!manifest && isPathWalkable(manifest, ({ x, z }) => {
      const state = this.stateAt(x, z);
      return state?.status === 'ready' ? state.data?.collision : undefined;
    }, from, to);
  }
  ceilingsFor(from: Vector3, to: Vector3): readonly CeilingVolume[] {
    return this.manifestValue ? ceilingsNear(this.manifestValue, ({ x, z }) => this.cells.get(`${x},${z}`)?.ceilingVolumes, from, to) : [];
  }
  isPrepared(position: Vector3): boolean {
    const manifest = this.manifestValue;
    return !!manifest && footprintCells(manifest, position.x, position.z).every(({ x, z }) =>
      this.stateAt(x, z)?.status === 'ready');
  }
  region(position: Vector3): string {
    const manifest = this.manifestValue;
    if (!manifest) return '';
    const x = Math.floor((position.x - manifest.origin.x) / manifest.chunkSize);
    const z = Math.floor((position.z - manifest.origin.z) / manifest.chunkSize);
    return this.cells.get(`${x},${z}`)?.region ?? '';
  }
  retry(): void { this.evictions.clear(); this.heldPrefetches.clear(); for (const [id, state] of this.states) if (state.status === 'error' || state.status === 'deferred') this.unload(id); this.pump(); }
  private unload(id: string): void {
    const state = this.states.get(id);
    if (!state) return;
    this.states.delete(id);
    state.controller.abort();
    this.releaseData(state);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.epoch++;
    this.controller.abort();
    for (const [id] of this.states) this.unload(id);
    this.source.dispose();
    this.manifestValue = null;
    this.cells.clear();
    this.evictions.clear(); this.heldPrefetches.clear();
    this.loading = 0;
  }
}
