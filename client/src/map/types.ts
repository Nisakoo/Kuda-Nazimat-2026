import type { VisualChunk } from '../render/RenderAdapter';
import type { MapBootstrap, ChunkEntry, WorldManifest } from '../../../shared/map/manifest.ts';
export type { MapBootstrap, ChunkEntry, WorldManifest } from '../../../shared/map/manifest.ts';

export interface ChunkData { readonly visual: VisualChunk; readonly collision: Uint8Array; readonly entry: ChunkEntry; release(): void }
export interface MapSource {
  readonly bootstrap: MapBootstrap;
  readonly budgetEpoch: number;
  manifest(signal: AbortSignal): Promise<WorldManifest>;
  chunk(entry: ChunkEntry, signal: AbortSignal): Promise<ChunkData>;
  dispose(): void;
}
