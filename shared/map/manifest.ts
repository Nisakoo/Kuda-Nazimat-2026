import type { Vector3 } from '../world/types.ts';

/** Format of prepared static world data (MAP), parsed identically by client and server. */
export interface AssetSize { readonly bytes: number; readonly memory: number }
export interface MapBootstrap { readonly manifestUrl: string; readonly worldBytes: number; readonly manifestBytes: number; readonly assets: Readonly<Record<string, AssetSize>> }
export interface ChunkEntry {
  readonly id: string; readonly x: number; readonly z: number; readonly region: string;
  readonly url: string; readonly bytes: number; readonly collisionUrl: string; readonly collisionBytes: number;
  readonly assets: readonly string[];
}
export interface WorldManifest {
  readonly mapId: string; readonly version: number; readonly worldBytes: number;
  readonly chunkSize: number; readonly spawn: Vector3; readonly origin: { readonly x: number; readonly z: number };
  readonly collisionResolution: number; readonly chunks: readonly ChunkEntry[];
  readonly models: Readonly<Record<string, string>>; readonly assets: Readonly<Record<string, AssetSize>>;
}
export interface ChunkObject { readonly id: string; readonly assetId: string; readonly transform: { readonly position: Vector3; readonly rotationY: number }; readonly animation: string }
export interface ChunkPayload { readonly id: string; readonly objects: readonly ChunkObject[] }

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid map object');
  return value as Record<string, unknown>;
}
function integer(value: unknown, min = 0): number { if (!Number.isSafeInteger(value) || (value as number) < min) throw new Error('Invalid map integer'); return value as number; }
function text(value: unknown): string { if (typeof value !== 'string' || !value || value.length > 512) throw new Error('Invalid map text'); return value; }
function vector(value: unknown): Vector3 { const v = object(value); if (![v.x, v.y, v.z].every((n) => typeof n === 'number' && Number.isFinite(n))) throw new Error('Invalid map position'); return { x: v.x as number, y: v.y as number, z: v.z as number }; }

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

/** Bootstrap a server derives from its own manifest; the client later checks the manifest against it. */
export function selfBootstrap(raw: unknown, manifestUrl: string, manifestBytes: number): MapBootstrap {
  const value = object(raw);
  const assets: Record<string, AssetSize> = {};
  for (const [url, item] of Object.entries(object(value.assets))) { const size = object(item); assets[url] = { bytes: integer(size.bytes, 1), memory: integer(size.memory, 1) }; }
  return { manifestUrl, worldBytes: integer(value.worldBytes, 1), manifestBytes, assets };
}

export function parseChunk(raw: unknown, entry: ChunkEntry): ChunkPayload {
  const value = object(raw);
  if (value.id !== entry.id || !Array.isArray(value.objects) || value.objects.length > 4096) throw new Error('Invalid chunk payload');
  const ids = new Set<string>();
  const objects = value.objects.map((item): ChunkObject => {
    const entity = object(item); const transform = object(entity.transform); const position = vector(transform.position);
    if (typeof transform.rotationY !== 'number' || !Number.isFinite(transform.rotationY)) throw new Error('Invalid rotation');
    const id = text(entity.id); if (ids.has(id)) throw new Error('Duplicate chunk object'); ids.add(id);
    const assetId = text(entity.assetId);
    if (!entry.assets.includes(assetId)) throw new Error('Undeclared chunk asset');
    return { id, assetId, transform: { position, rotationY: transform.rotationY }, animation: typeof entity.animation === 'string' ? entity.animation : 'idle' };
  });
  return { id: entry.id, objects };
}
