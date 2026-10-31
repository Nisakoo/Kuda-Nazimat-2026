import type { Vector3 } from '../core/types';
import type { VisualChunk } from '../render/RenderAdapter';
import type { AssetSize } from './AssetManager';

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
export interface ChunkData { readonly visual: VisualChunk; readonly collision: Uint8Array; readonly entry: ChunkEntry; release(): void }
export interface MapSource {
  readonly bootstrap: MapBootstrap;
  readonly budgetEpoch: number;
  manifest(signal: AbortSignal): Promise<WorldManifest>;
  chunk(entry: ChunkEntry, signal: AbortSignal): Promise<ChunkData>;
  dispose(): void;
}
