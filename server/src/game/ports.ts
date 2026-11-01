import type { ServerMessage } from '../../../shared/protocol/types.ts';
import type { Vector3 } from '../../../shared/world/types.ts';
export interface PlacedPlayer { readonly id: string; readonly name: string; readonly mapId: string; readonly position: Vector3; readonly rotationY: number }
import type { WorldLifeServerMessage } from '../../../shared/world-life/types.ts';

/** One client connection as seen by the game; implemented by the realtime adapter. */
export interface Channel {
  readonly id: string;
  readonly sessionKey?: string;
  send(message: ServerMessage): void;
  sendLife?(message: WorldLifeServerMessage, volatile?: boolean): void;
  /** Ends the connection with a server-originated UNAUTHORIZED error (takeover, expiry, shutdown). */
  close(reason: string): void;
}
