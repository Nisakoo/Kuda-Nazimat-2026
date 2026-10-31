import type { CeilingVolume, WorldManifest } from './manifest.ts';
import { chunkCellOf, FOOTPRINT_HALF } from './walkability.ts';
import type { ChunkCell, PointXZ } from './walkability.ts';

/** Manifest data only. The caller supplies its existing spatial index; no new cache or IO. */
export function ceilingsNear(manifest: Pick<WorldManifest, 'origin' | 'chunkSize' | 'ceilingVolumes'>, lookup: (cell: ChunkCell) => readonly CeilingVolume[] | undefined, from: PointXZ, to: PointXZ): readonly CeilingVolume[] {
  const min = chunkCellOf(manifest, Math.min(from.x, to.x) - FOOTPRINT_HALF, Math.min(from.z, to.z) - FOOTPRINT_HALF);
  const max = chunkCellOf(manifest, Math.max(from.x, to.x) + FOOTPRINT_HALF, Math.max(from.z, to.z) + FOOTPRINT_HALF);
  const volumes = [...manifest.ceilingVolumes ?? []];
  for (let z = min.z; z <= max.z; z++) for (let x = min.x; x <= max.x; x++) volumes.push(...lookup({ x, z }) ?? []);
  return volumes;
}
