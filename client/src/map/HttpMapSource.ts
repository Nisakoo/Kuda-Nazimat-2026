import { AssetManager, HttpAssetSource } from './AssetManager';
import type { HttpAccess } from './AssetManager';
import type { MapBootstrap, WorldManifest, ChunkEntry, ChunkData, MapSource } from './types';
import type { WorldBudget } from './WorldBudget';
import { parseManifest, parseChunk } from '../../../shared/map/manifest.ts';
export { parseManifest } from '../../../shared/map/manifest.ts';

export class HttpMapSource implements MapSource {
  private readonly assets: AssetManager;
  private index: WorldManifest | null = null;
  private readonly source: HttpAssetSource;
  constructor(readonly bootstrap: MapBootstrap, private readonly budget: WorldBudget, root: string, access?: HttpAccess) {
    this.source = new HttpAssetSource(root, access);
    this.assets = new AssetManager(this.source, budget, (url) => {
      if (url === this.source.resolve(bootstrap.manifestUrl)) return { bytes: bootstrap.manifestBytes, memory: Math.max(131072, bootstrap.manifestBytes * 16) };
      for (const entry of this.index?.chunks ?? []) {
        if (url === this.source.resolve(entry.url)) return { bytes: entry.bytes, memory: Math.max(131072, entry.bytes * 16) };
        if (url === this.source.resolve(entry.collisionUrl)) return { bytes: entry.collisionBytes, memory: Math.max(131072, entry.collisionBytes * 3) };
      }
      return undefined;
    });
  }
  get budgetEpoch(): number { return this.budget.epoch; }
  private manifestLease: { release(): void } | null = null;
  async manifest(signal: AbortSignal): Promise<WorldManifest> {
    const lease = await this.assets.acquire(this.bootstrap.manifestUrl, signal);
    try { this.index = parseManifest(JSON.parse(new TextDecoder().decode(lease.value)), this.bootstrap); this.manifestLease?.release(); this.manifestLease = lease; return this.index; }
    catch (error) { lease.release(); throw error; }
  }
  async chunk(entry: ChunkEntry, signal: AbortSignal): Promise<ChunkData> {
    const resources = [
      { key: this.source.resolve(entry.url), bytes: entry.bytes, memory: Math.max(131072, entry.bytes * 16) },
      { key: this.source.resolve(entry.collisionUrl), bytes: entry.collisionBytes, memory: Math.max(131072, entry.collisionBytes * 3) },
      ...entry.assets.map((id) => {
        const path = this.index?.models[id];
        const size = path ? this.index?.assets[`assets/models/${path}`] : undefined;
        if (!path || !size) throw new Error('Unknown chunk model');
        return { key: this.source.resolve(`assets/models/${path}`), ...size };
      }),
    ];
    const reservation = this.budget.reserveAll(resources);
    const json = await this.assets.acquire(entry.url, signal).catch((error: unknown) => { reservation.release(); throw error; });
    try {
      const { objects } = parseChunk(JSON.parse(new TextDecoder().decode(json.value)), entry);
      const collision = await this.assets.acquire(entry.collisionUrl, signal);
      if (collision.value.byteLength !== this.index!.collisionResolution ** 2) { collision.release(); throw new Error('Invalid collision data'); }
      let active = true;
      return { entry, visual: { id: entry.id, objects }, collision: new Uint8Array(collision.value), release: () => { if (active) { active = false; json.release(); collision.release(); reservation.release(); } } };
    } catch (error) { json.release(); reservation.release(); throw error; }
  }
  dispose(): void { this.manifestLease?.release(); this.manifestLease = null; this.assets.dispose(); this.index = null; }
}
