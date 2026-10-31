import { AssetManager, HttpAssetSource } from './AssetManager';
import type { AssetSize, HttpAccess } from './AssetManager';
import type { MapBootstrap, WorldManifest, ChunkEntry, ChunkData, MapSource } from './types';
import type { WorldBudget } from './WorldBudget';
import type { VisualChunk } from '../render/RenderAdapter';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid map object');
  return value as Record<string, unknown>;
}
function integer(value: unknown, min = 0): number { if (!Number.isSafeInteger(value) || (value as number) < min) throw new Error('Invalid map integer'); return value as number; }
function text(value: unknown): string { if (typeof value !== 'string' || !value || value.length > 512) throw new Error('Invalid map text'); return value; }
function vector(value: unknown) { const v = object(value); if (![v.x, v.y, v.z].every((n) => typeof n === 'number' && Number.isFinite(n))) throw new Error('Invalid map position'); return { x: v.x as number, y: v.y as number, z: v.z as number }; }

export function parseManifest(raw: unknown, bootstrap: MapBootstrap): WorldManifest {
  const value = object(raw);
  if (value.version !== 1 || value.worldBytes !== bootstrap.worldBytes) throw new Error('Unsupported map or size mismatch');
  if (!Array.isArray(value.chunks) || value.chunks.length > 10_000) throw new Error('Invalid chunk index');
  const chunks: ChunkEntry[] = value.chunks.map((rawEntry) => {
    const entry = object(rawEntry);
    if (!Array.isArray(entry.assets) || entry.assets.some((id) => typeof id !== 'string')) throw new Error('Invalid chunk asset references');
    return { id: text(entry.id), x: integer(entry.x, -100_000), z: integer(entry.z, -100_000), region: text(entry.region), url: text(entry.url), bytes: integer(entry.bytes, 1), collisionUrl: text(entry.collisionUrl), collisionBytes: integer(entry.collisionBytes, 1), assets: entry.assets as string[] };
  });
  if (new Set(chunks.map((entry) => entry.id)).size !== chunks.length || new Set(chunks.map((entry) => `${entry.x}:${entry.z}`)).size !== chunks.length) throw new Error('Duplicate chunk');
  const models: Record<string, string> = {};
  for (const [id, path] of Object.entries(object(value.models))) models[id] = text(path);
  const assets: Record<string, AssetSize> = {};
  for (const [url, item] of Object.entries(object(value.assets))) {
    const size = object(item); const bytes = integer(size.bytes, 1); const memory = integer(size.memory, bytes);
    if (bootstrap.assets[url]?.bytes !== bytes || bootstrap.assets[url]?.memory !== memory) throw new Error('Untrusted resource metadata');
    assets[url] = { bytes, memory };
  }
  for (const path of Object.values(models)) if (!assets[`assets/models/${path}`]) throw new Error('Missing model metadata');
  for (const chunk of chunks) if (chunk.assets.length > 128 || chunk.assets.some((id) => !models[id])) throw new Error('Unknown chunk asset');
  if (integer(value.collisionResolution, 1) > 512 || integer(value.chunkSize, 1) > 1024) throw new Error('Map dimensions exceed client limits');
  const origin = object(value.origin);
  return { mapId: text(value.mapId), version: 1, worldBytes: bootstrap.worldBytes, chunkSize: integer(value.chunkSize, 1), collisionResolution: integer(value.collisionResolution, 1), spawn: vector(value.spawn), origin: { x: integer(origin.x, -100_000), z: integer(origin.z, -100_000) }, chunks, models, assets };
}

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
      const raw = object(JSON.parse(new TextDecoder().decode(json.value)));
      if (raw.id !== entry.id || !Array.isArray(raw.objects) || raw.objects.length > 4096) throw new Error('Invalid chunk payload');
      const ids = new Set<string>();
      const objects: VisualChunk['objects'] = raw.objects.map((item) => {
        const value = object(item); const transform = object(value.transform); const position = vector(transform.position);
        if (typeof transform.rotationY !== 'number' || !Number.isFinite(transform.rotationY)) throw new Error('Invalid rotation');
        const id = text(value.id); if (ids.has(id)) throw new Error('Duplicate chunk object'); ids.add(id);
        const assetId = text(value.assetId);
        if (!entry.assets.includes(assetId)) throw new Error('Undeclared chunk asset');
        return { id, assetId, transform: { position, rotationY: transform.rotationY }, animation: typeof value.animation === 'string' ? value.animation : 'idle' };
      });
      const collision = await this.assets.acquire(entry.collisionUrl, signal);
      if (collision.value.byteLength !== this.index!.collisionResolution ** 2) { collision.release(); throw new Error('Invalid collision data'); }
      let active = true;
      return { entry, visual: { id: entry.id, objects }, collision: new Uint8Array(collision.value), release: () => { if (active) { active = false; json.release(); collision.release(); reservation.release(); } } };
    } catch (error) { json.release(); reservation.release(); throw error; }
  }
  dispose(): void { this.manifestLease?.release(); this.manifestLease = null; this.assets.dispose(); this.index = null; }
}
