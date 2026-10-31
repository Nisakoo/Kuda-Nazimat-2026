import type { WorldDescriptor } from '../../../shared/protocol/types.ts';
import type { WorldManifest } from '../../../shared/map/manifest.ts';
import { chunkCellOf, footprintCells, isWalkable } from '../../../shared/map/walkability.ts';
import type { ChunkCell } from '../../../shared/map/walkability.ts';
import type { Vector3 } from '../../../shared/world/types.ts';

const cellKey = (cell: ChunkCell): string => `${cell.x}:${cell.z}`;

/** Static, validated map: collisions, chunk grid and the bootstrap sent in `joined`. */
export class GameMap {
  readonly id: string;
  readonly manifest: WorldManifest;
  readonly bootstrap: WorldDescriptor;
  private readonly collisions: ReadonlyMap<string, Uint8Array>;
  private readonly chunkIds: ReadonlyMap<string, string>;
  private readonly chunkCells: ReadonlyMap<string, ChunkCell>;

  constructor(manifest: WorldManifest, bootstrap: WorldDescriptor, collisionByChunkId: ReadonlyMap<string, Uint8Array>) {
    this.id = manifest.mapId;
    this.manifest = manifest;
    this.bootstrap = bootstrap;
    const collisions = new Map<string, Uint8Array>();
    const ids = new Map<string, string>();
    const cells = new Map<string, ChunkCell>();
    for (const entry of manifest.chunks) {
      const cell = { x: entry.x, z: entry.z };
      const data = collisionByChunkId.get(entry.id);
      if (!data) throw new Error(`Нет коллизий для чанка ${entry.id}`);
      collisions.set(cellKey(cell), data);
      ids.set(cellKey(cell), entry.id);
      cells.set(entry.id, cell);
    }
    this.collisions = collisions; this.chunkIds = ids; this.chunkCells = cells;
  }

  get spawn(): Vector3 { return this.manifest.spawn; }

  isWalkable(x: number, z: number): boolean {
    return isWalkable(this.manifest, (cell) => this.collisions.get(cellKey(cell)), x, z);
  }

  cellAt(x: number, z: number): ChunkCell { return chunkCellOf(this.manifest, x, z); }

  /** Chunk IDs under the four footprint probes, or null when a probe leaves the map. */
  footprintChunkIds(x: number, z: number): string[] | null {
    const ids: string[] = [];
    for (const cell of footprintCells(this.manifest, x, z)) {
      const id = this.chunkIds.get(cellKey(cell));
      if (!id) return null;
      if (!ids.includes(id)) ids.push(id);
    }
    return ids;
  }

  hasChunk(id: string): boolean { return this.chunkCells.has(id); }
  chunkCell(id: string): ChunkCell | undefined { return this.chunkCells.get(id); }
}
