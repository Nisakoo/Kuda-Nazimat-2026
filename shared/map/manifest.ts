import type { Vector3 } from '../world/types.ts';
import type { WorldLifeDefinition } from '../world-life/types.ts';
import { parseWorldLifeDefinition } from '../world-life/validate.ts';

/** Format of prepared static world data (MAP), parsed identically by client and server. */
export interface AssetSize { readonly bytes: number; readonly memory: number }
export interface MapBootstrap { readonly manifestUrl: string; readonly worldBytes: number; readonly manifestBytes: number; readonly assets: Readonly<Record<string, AssetSize>> }
export interface ChunkEntry {
  readonly ceilingVolumes?: readonly CeilingVolume[];
  readonly id: string; readonly x: number; readonly z: number; readonly region: string;
  readonly url: string; readonly bytes: number; readonly collisionUrl: string; readonly collisionBytes: number;
  readonly assets: readonly string[];
}
export interface WorldManifest {
  readonly worldLife?: WorldLifeDefinition;
  readonly ceilingVolumes?: readonly CeilingVolume[];
  readonly heightSurfaces?: readonly HeightSurface[];
  readonly mapId: string; readonly version: number; readonly worldBytes: number;
  readonly chunkSize: number; readonly spawn: Vector3; readonly origin: { readonly x: number; readonly z: number };
  readonly collisionResolution: number; readonly chunks: readonly ChunkEntry[];
  readonly models: Readonly<Record<string, string>>; readonly assets: Readonly<Record<string, AssetSize>>;
}
/** Bounded linear ramps along Z, including level landings. No overlapping floors. */
export interface HeightSurface { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number; readonly startY: number; readonly endY: number }
export interface CeilingVolume { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number; readonly bottomY: number; readonly topY: number }
export function surfaceHeight(surfaces: readonly HeightSurface[] | undefined, x: number, z: number): number {
  const surface = surfaces?.find((s) => x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ);
  return surface ? surface.startY + (surface.endY - surface.startY) * (z - surface.minZ) / (surface.maxZ - surface.minZ) : 0;
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
function parseCeilings(value: unknown): CeilingVolume[] {
  if (!Array.isArray(value) || value.length > 128) throw new Error('Invalid ceiling volumes');
  return value.map((rawVolume) => {
    const volume = object(rawVolume);
    const fields = ['minX', 'maxX', 'minZ', 'maxZ', 'bottomY', 'topY'];
    if (Object.keys(volume).length !== fields.length || fields.some((key) => typeof volume[key] !== 'number' || !Number.isFinite(volume[key]) || Math.abs(volume[key] as number) > 100000)) throw new Error('Invalid ceiling coordinates');
    const result = Object.fromEntries(fields.map((key) => [key, volume[key]])) as unknown as CeilingVolume;
    if (result.minX >= result.maxX || result.minZ >= result.maxZ || result.bottomY >= result.topY) throw new Error('Invalid ceiling dimensions');
    return result;
  });
}

export function parseManifest(raw: unknown, bootstrap: MapBootstrap): WorldManifest {
  const value = object(raw);
  if (value.version !== 1 || value.worldBytes !== bootstrap.worldBytes) throw new Error('Unsupported map or size mismatch');
  if (!Array.isArray(value.chunks) || value.chunks.length > 10_000) throw new Error('Invalid chunk index');
  const chunks: ChunkEntry[] = value.chunks.map((rawEntry) => {
    const entry = object(rawEntry);
    if (!Array.isArray(entry.assets) || entry.assets.some((id) => typeof id !== 'string')) throw new Error('Invalid chunk asset references');
    return { id: text(entry.id), x: integer(entry.x, -100_000), z: integer(entry.z, -100_000), region: text(entry.region), url: text(entry.url), bytes: integer(entry.bytes, 1), collisionUrl: text(entry.collisionUrl), collisionBytes: integer(entry.collisionBytes, 1), assets: entry.assets as string[], ...(entry.ceilingVolumes !== undefined && { ceilingVolumes: parseCeilings(entry.ceilingVolumes) }) };
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
  let heightSurfaces: HeightSurface[] | undefined;
  if (value.heightSurfaces !== undefined) {
    if (!Array.isArray(value.heightSurfaces) || value.heightSurfaces.length > 128) throw new Error('Invalid height surfaces');
    heightSurfaces = value.heightSurfaces.map((raw) => {
      const s = object(raw);
      const fields = ['minX', 'maxX', 'minZ', 'maxZ', 'startY', 'endY'] as const;
      if (fields.some((key) => typeof s[key] !== 'number' || !Number.isFinite(s[key]) || Math.abs(s[key] as number) > 100_000)) throw new Error('Invalid height surface');
      const result = Object.fromEntries(fields.map((key) => [key, s[key]])) as unknown as HeightSurface;
      if (result.minX >= result.maxX || result.minZ >= result.maxZ || Math.abs(result.startY - result.endY) / (result.maxZ - result.minZ) > 1) throw new Error('Invalid ramp dimensions');
      return result;
    });
    for (let i = 0; i < heightSurfaces.length; i++) for (const b of heightSurfaces.slice(i + 1)) {
      const a = heightSurfaces[i]!;
      if (a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ) throw new Error('Overlapping height surfaces');
    }
  }
  const ceilingVolumes = value.ceilingVolumes === undefined ? undefined : parseCeilings(value.ceilingVolumes);
  for (const chunk of chunks) for (const volume of chunk.ceilingVolumes ?? []) {
    const minX = (origin.x as number) + chunk.x * (value.chunkSize as number); const minZ = (origin.z as number) + chunk.z * (value.chunkSize as number);
    if (volume.minX < minX || volume.maxX > minX + (value.chunkSize as number) || volume.minZ < minZ || volume.maxZ > minZ + (value.chunkSize as number)) throw new Error('Ceiling outside owning chunk');
  }
  return { ...(value.worldLife !== undefined && { worldLife: parseWorldLifeDefinition(value.worldLife, models, text(value.mapId)) }), mapId: text(value.mapId), version: 1, worldBytes: bootstrap.worldBytes, chunkSize: integer(value.chunkSize, 1), collisionResolution: integer(value.collisionResolution, 1), spawn: vector(value.spawn), origin: { x: integer(origin.x, -100_000), z: integer(origin.z, -100_000) }, chunks, models, assets, ...(heightSurfaces && { heightSurfaces }), ...(ceilingVolumes && { ceilingVolumes }) };
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
