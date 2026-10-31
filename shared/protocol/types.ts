import type { Direction, Entity, WorldSnapshot } from '../world/types.ts';

export const PROTOCOL_VERSION = 1 as const;
export const LIMITS = { packetBytes: 262144, entities: 256, pending: 32, chat: 500, question: 240, answer: 4000, inputHz: 20, requestMs: 10000 } as const;
export type ConnectionStatus = 'unauthorized' | 'connecting' | 'connected' | 'lost' | 'error' | 'disconnected';
export type ErrorCode = 'UNAUTHORIZED' | 'VERSION' | 'INVALID' | 'FORBIDDEN' | 'RATE_LIMIT' | 'NOT_READY' | 'UNAVAILABLE';
export const ERROR_CODES: readonly ErrorCode[] = ['UNAUTHORIZED', 'VERSION', 'INVALID', 'FORBIDDEN', 'RATE_LIMIT', 'NOT_READY', 'UNAVAILABLE'];
/** requestId of server-originated errors that answer no client request (PROTO-008). */
export const SERVER_REQUEST_ID = 'server';
export interface ServerSession { readonly token: string; readonly expiresAt: number }
export interface WorldDescriptor {
  readonly manifestUrl: string;
  readonly worldBytes: number;
  readonly manifestBytes: number;
  readonly assets: Readonly<Record<string, { readonly bytes: number; readonly memory: number }>>;
}
interface Request { readonly v: 1; readonly requestId: string }
export type ClientMessage = Request & (
  | { readonly type: 'join'; readonly mapId: string }
  | { readonly type: 'input'; readonly sequence: number; readonly direction: Direction; readonly preparedChunks: readonly string[] }
  | { readonly type: 'interact'; readonly targetId: string }
  | { readonly type: 'npc-question'; readonly targetId: string; readonly text: string }
  | { readonly type: 'chat-send'; readonly text: string }
  | { readonly type: 'resync'; readonly revision: number }
);
export type ServerMessage =
  | (Request & { readonly type: 'joined'; readonly playerId: string; readonly revision: number; readonly snapshot: WorldSnapshot; readonly world: WorldDescriptor })
  | { readonly v: 1; readonly type: 'snapshot'; readonly revision: number; readonly snapshot: WorldSnapshot }
  | { readonly v: 1; readonly type: 'delta'; readonly revision: number; readonly baseRevision: number; readonly tick: number; readonly upsert: readonly Entity[]; readonly remove: readonly string[] }
  | (Request & { readonly type: 'interacted'; readonly targetId: string })
  | (Request & { readonly type: 'npc-answer'; readonly targetId: string; readonly text: string })
  | (Request & { readonly type: 'chat'; readonly messageId: string; readonly playerId: string; readonly name: string; readonly text: string })
  | (Request & { readonly type: 'error'; readonly code: ErrorCode; readonly message: string });
export interface NetworkState { readonly status: ConnectionStatus; readonly error: string | null }
