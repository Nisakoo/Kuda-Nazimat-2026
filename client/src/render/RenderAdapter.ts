import type { EntityId, Transform, WorldSnapshot } from '../core/types';

export interface CameraView { readonly yaw: number; readonly pitch: number; readonly distance: number }
export interface VisualChunk {
  readonly id: string;
  readonly objects: readonly { readonly id: string; readonly assetId: string; readonly transform: Transform; readonly animation?: string }[];
}
export interface RenderDiagnostics {
  readonly chunks: readonly string[];
  readonly entities: readonly string[];
  readonly models: number;
  readonly instances: number;
  readonly queued: number;
  readonly geometries: number;
  readonly textures: number;
  readonly pending: number;
  readonly errors: readonly string[];
}

/** No engine objects cross the rendering boundary. */
export interface RenderAdapter {
  mount(container: HTMLElement): void;
  resize(width: number, height: number, pixelRatio: number): void;
  syncWorld(previous: WorldSnapshot, current: WorldSnapshot, playerId: EntityId | null): void;
  setCamera(view: CameraView): void;
  registerModels(models: Readonly<Record<string, string>>): void;
  loadChunk(chunk: VisualChunk): Promise<void>;
  unloadChunk(id: string): void;
  getDiagnostics(): RenderDiagnostics;
  retryFailedModels(): void;
  render(elapsedSeconds: number, alpha: number): void;
  dispose(): void;
}
