import type { ServerMessage } from '../../../shared/protocol/types.ts';
import type { Vector3 } from '../../../shared/world/types.ts';

export interface SavedPosition { readonly mapId: string; readonly position: Vector3; readonly rotationY: number }
export interface PlayerStore {
  load(playerId: string): SavedPosition | null;
  save(players: readonly (SavedPosition & { readonly id: string })[]): void;
}

/** One client connection as seen by the game; implemented by the realtime adapter. */
export interface Channel {
  readonly id: string;
  send(message: ServerMessage): void;
  /** Ends the connection with a server-originated UNAUTHORIZED error (takeover, logout, expiry). */
  close(reason: string): void;
}

export interface PlayerIdentity { readonly accountId: string; readonly playerId: string; readonly displayName: string }
