import type { EntityId, GameCommand, WorldEvent, WorldSnapshot } from '../core/types';
import type { Vector3 } from '../core/types';

/** Shared contract for LocalSession and the future OnlineSession; no transport objects. */
export interface GameSession {
  readonly mode: 'local' | 'online';
  readonly playerId: EntityId | null;
  send(command: GameCommand): void;
  update(deltaSeconds: number): void;
  getSnapshot(): WorldSnapshot;
  setMovementGuard(guard: (position: Vector3) => boolean, path?: (from: Vector3, to: Vector3) => boolean): void;
  subscribe(listener: (events: readonly WorldEvent[]) => void): () => void;
  dispose(): void;
}
