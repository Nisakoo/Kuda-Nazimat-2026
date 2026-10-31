import type { ServerMessage } from '../../../shared/protocol/types.ts';

/** One client connection as seen by the game; implemented by the realtime adapter. */
export interface Channel {
  readonly id: string;
  readonly sessionKey?: string;
  send(message: ServerMessage): void;
  /** Ends the connection with a server-originated UNAUTHORIZED error (takeover, expiry, shutdown). */
  close(reason: string): void;
}
