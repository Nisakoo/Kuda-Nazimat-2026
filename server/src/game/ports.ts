import type { ServerMessage } from '../../../shared/protocol/types.ts';

/** One client connection as seen by the game; implemented by the realtime adapter. */
export interface Channel {
  readonly id: string;
  readonly sessionKey?: string;
  send(message: ServerMessage): void;
  /** OBS-010: median heartbeat RTT of the last minute, null before the first sample. */
  rttMs?(): number | null;
  /** Ends the connection with a server-originated UNAUTHORIZED error (takeover, expiry, shutdown). */
  close(reason: string): void;
}
