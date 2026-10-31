import type { WorldManifest } from './manifest.ts';

export const FOOTPRINT_HALF = 0.25;
const PROBES = [-FOOTPRINT_HALF, FOOTPRINT_HALF] as const;

export interface ChunkCell { readonly x: number; readonly z: number }
/** Looks up the collision bitmap of a ready chunk by grid cell; undefined means "not available". */
export type CollisionLookup = (cell: ChunkCell) => Uint8Array | undefined;

export function chunkCellOf(manifest: Pick<WorldManifest, 'origin' | 'chunkSize'>, x: number, z: number): ChunkCell {
  return { x: Math.floor((x - manifest.origin.x) / manifest.chunkSize), z: Math.floor((z - manifest.origin.z) / manifest.chunkSize) };
}

/** Grid cells touched by the four footprint probes around (x, z). */
export function footprintCells(manifest: Pick<WorldManifest, 'origin' | 'chunkSize'>, x: number, z: number): ChunkCell[] {
  const cells: ChunkCell[] = [];
  for (const dx of PROBES) for (const dz of PROBES) cells.push(chunkCellOf(manifest, x + dx, z + dz));
  return cells;
}

/** True when every cell under the entire footprint is available and empty. */
export function isWalkable(manifest: Pick<WorldManifest, 'origin' | 'chunkSize' | 'collisionResolution'>, collision: CollisionLookup, x: number, z: number): boolean {
  return isPathWalkable(manifest, collision, { x, z }, { x, z });
}

export interface PointXZ { readonly x: number; readonly z: number }
export interface Rectangle { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number }

/** Exact segment against a half-open rectangle. A valid contact can move away or tangent. */
export function intersectsRectangle(from: PointXZ, to: PointXZ, rect: Rectangle): boolean {
  let entry = 0; let exit = 1;
  for (const [a, b, min, max] of [[from.x, to.x, rect.minX, rect.maxX], [from.z, to.z, rect.minZ, rect.maxZ]] as const) {
    const delta = b - a;
    if (delta === 0) { if (a < min || a >= max) return false; }
    else { const t1 = (min - a) / delta; const t2 = (max - a) / delta; entry = Math.max(entry, Math.min(t1, t2)); exit = Math.min(exit, Math.max(t1, t2)); }
  }
  if (entry < exit) return true;
  if (entry > exit) return false;
  const x = from.x + (to.x - from.x) * entry; const z = from.z + (to.z - from.z) * entry;
  return x >= rect.minX && x < rect.maxX && z >= rect.minZ && z < rect.maxZ;
}

/** Swept square footprint; checks thin cells between endpoints and between footprint corners. */
export function isPathWalkable(manifest: Pick<WorldManifest, 'origin' | 'chunkSize' | 'collisionResolution'>, collision: CollisionLookup, from: PointXZ, to: PointXZ): boolean {
  if (![from.x, from.z, to.x, to.z].every(Number.isFinite)) return false;
  const { origin, chunkSize, collisionResolution: resolution } = manifest;
  const size = chunkSize / resolution;
  const minX = Math.floor((Math.min(from.x, to.x) - FOOTPRINT_HALF - origin.x) / size);
  const maxX = Math.floor((Math.max(from.x, to.x) + FOOTPRINT_HALF - origin.x) / size);
  const minZ = Math.floor((Math.min(from.z, to.z) - FOOTPRINT_HALF - origin.z) / size);
  const maxZ = Math.floor((Math.max(from.z, to.z) + FOOTPRINT_HALF - origin.z) / size);
  // Fail closed on an invalid/unbounded trace; ordinary simulation traces are a few cells long.
  if ((maxX - minX + 1) * (maxZ - minZ + 1) > 262144) return false;
  let lastKey = ''; let data: Uint8Array | undefined;
  for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
    const cx = Math.floor(x / resolution); const cz = Math.floor(z / resolution);
    const key = `${cx}:${cz}`;
    if (key !== lastKey) { data = collision({ x: cx, z: cz }); lastKey = key; }
    if (data?.[(z - cz * resolution) * resolution + x - cx * resolution] === 0) continue;
    if (intersectsRectangle(from, to, {
      minX: origin.x + x * size - FOOTPRINT_HALF, maxX: origin.x + (x + 1) * size + FOOTPRINT_HALF,
      minZ: origin.z + z * size - FOOTPRINT_HALF, maxZ: origin.z + (z + 1) * size + FOOTPRINT_HALF,
    })) return false;
  }
  return true;
}
