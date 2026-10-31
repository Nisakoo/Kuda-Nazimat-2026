import type { EntityId, WorldSnapshot } from '../core/types';

export interface CameraView { readonly yaw: number; readonly pitch: number; readonly distance: number }

/** No engine objects cross the rendering boundary. */
export interface RenderAdapter {
  mount(container: HTMLElement): void;
  resize(width: number, height: number, pixelRatio: number): void;
  syncWorld(previous: WorldSnapshot, current: WorldSnapshot, playerId: EntityId | null): void;
  setCamera(view: CameraView): void;
  render(elapsedSeconds: number, alpha: number): void;
  dispose(): void;
}
