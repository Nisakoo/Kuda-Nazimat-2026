import type { WorldManifest } from './manifest.ts';

/** Footprint probes of the client movement guard (ChunkManager.canWalk). */
const PROBES = [-0.25, 0.25] as const;

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

/** True when every probe lands on an available chunk and a zero collision byte. */
export function isWalkable(manifest: Pick<WorldManifest, 'origin' | 'chunkSize' | 'collisionResolution'>, collision: CollisionLookup, x: number, z: number): boolean {
  const { origin, chunkSize, collisionResolution: resolution } = manifest;
  for (const dx of PROBES) for (const dz of PROBES) {
    const px = x + dx; const pz = z + dz;
    const cell = chunkCellOf(manifest, px, pz);
    const data = collision(cell);
    if (!data) return false;
    const cx = Math.floor((px - origin.x - cell.x * chunkSize) / chunkSize * resolution);
    const cz = Math.floor((pz - origin.z - cell.z * chunkSize) / chunkSize * resolution);
    if (data[cz * resolution + cx] !== 0) return false;
  }
  return true;
}
