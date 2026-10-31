import type { WorldDescriptor } from '../../../shared/protocol/types.ts';
import type { WorldManifest, CeilingVolume } from '../../../shared/map/manifest.ts';
import { ceilingsNear } from '../../../shared/map/ceilings.ts';
import { surfaceHeight } from '../../../shared/map/manifest.ts';
import { chunkCellOf, footprintCells, isWalkable, isPathWalkable } from '../../../shared/map/walkability.ts';
import type { ChunkCell } from '../../../shared/map/walkability.ts';
import type { Vector3 } from '../../../shared/world/types.ts';
import { isBodyClear } from '../../../shared/movement/simulation.ts';

const cellKey = (cell: ChunkCell): string => `${cell.x}:${cell.z}`;

/** Static, validated map: collisions, chunk grid and the bootstrap sent in `joined`. */
export class GameMap {
  readonly id: string;
  readonly manifest: WorldManifest;
  readonly bootstrap: WorldDescriptor;
  private readonly collisions: ReadonlyMap<string, Uint8Array>;
  private readonly chunkIds: ReadonlyMap<string, string>;
  private readonly chunkCells: ReadonlyMap<string, ChunkCell>;
  private readonly ceilings = new Map<string, readonly CeilingVolume[]>();

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
      if (entry.ceilingVolumes) this.ceilings.set(cellKey(cell), entry.ceilingVolumes);
    }
    this.collisions = collisions; this.chunkIds = ids; this.chunkCells = cells;
  }

  get spawn(): Vector3 { return this.manifest.spawn; }
  heightAt(x: number, z: number): number { return surfaceHeight(this.manifest.heightSurfaces, x, z); }
  ceilingsFor(from: Vector3, to: Vector3): readonly CeilingVolume[] { return ceilingsNear(this.manifest, cell => this.ceilings.get(cellKey(cell)), from, to); }
  isSafeSupport(x: number, z: number): boolean {
    const position = { x, y: this.heightAt(x, z), z };
    return this.isWalkable(x, z) && isBodyClear(position, this.ceilingsFor(position, position));
  }

  isWalkable(x: number, z: number): boolean {
    return isWalkable(this.manifest, (cell) => this.collisions.get(cellKey(cell)), x, z);
  }

  canTraverse(from: Vector3, to: Vector3, prepared?: ReadonlySet<string>): boolean {
    return isPathWalkable(this.manifest, (cell) => {
      const key = cellKey(cell); const id = this.chunkIds.get(key);
      return id && (!prepared || prepared.has(id)) ? this.collisions.get(key) : undefined;
    }, from, to);
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
