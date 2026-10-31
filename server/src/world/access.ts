import type { ChunkCell } from '../../../shared/map/walkability.ts';
import type { Vector3 } from '../../../shared/world/types.ts';
import type { GameMap } from './GameMap.ts';

/** How a world file is used by a map; one file (a shared model or collision) may serve several maps. */
export type FileUse =
  | { readonly mapId: string; readonly kind: 'manifest' | 'model' }
  | { readonly mapId: string; readonly kind: 'chunk'; readonly cell: ChunkCell }
  | { readonly mapId: string; readonly kind: 'collision'; readonly cells: readonly ChunkCell[] };

export interface WorldFile {
  readonly path: string;
  readonly absolutePath: string;
  readonly bytes: number;
  readonly contentType: string;
  readonly uses: readonly FileUse[];
}

/** Authoritative location of an active player, provided by the game module. */
export interface PlayerLocation { readonly mapId: string; readonly position: Vector3 }
export type PlayerLocator = (accountId: string) => PlayerLocation | null;

const near = (a: ChunkCell, b: ChunkCell, radius: number): boolean => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z)) <= radius;

/** SERVER-WORLD-006: manifest/models for the player's map, chunks and their collisions only around the player. */
export function canAccess(file: WorldFile, location: PlayerLocation | null, maps: ReadonlyMap<string, GameMap>, radius: number): boolean {
  if (!location) return false;
  const map = maps.get(location.mapId);
  if (!map) return false;
  const here = map.cellAt(location.position.x, location.position.z);
  return file.uses.some((use) => {
    if (use.mapId !== location.mapId) return false;
    switch (use.kind) {
      case 'manifest': case 'model': return true;
      case 'chunk': return near(use.cell, here, radius);
      case 'collision': return use.cells.some((cell) => near(cell, here, radius));
    }
  });
}
