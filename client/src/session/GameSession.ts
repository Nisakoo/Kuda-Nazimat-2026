import type { EntityId, GameCommand, WorldEvent, WorldSnapshot } from '../core/types';

/** Shared contract for LocalSession and the future OnlineSession; no transport objects. */
export interface GameSession {
  readonly mode: 'local' | 'online';
  readonly playerId: EntityId | null;
  send(command: GameCommand): void;
  update(deltaSeconds: number): void;
  getSnapshot(): WorldSnapshot;
  subscribe(listener: (events: readonly WorldEvent[]) => void): () => void;
  dispose(): void;
}
