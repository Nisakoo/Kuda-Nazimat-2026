import type { ClientMessage, NetworkState, ServerMessage, ServerSession } from '../../../shared/protocol/types.ts';
import type { WorldLifeClientMessage, WorldLifeServerMessage } from '../../../shared/world-life/types.ts';

export interface Clock {
  now(): number;
  set(callback: () => void, milliseconds: number): number;
  clear(id: number): void;
}
export type AccessContext = { readonly kind: 'server'; readonly session: ServerSession } | { readonly kind: 'mock' };
export interface NetworkAdapter {
  readonly state: NetworkState;
  connect(context?: AccessContext): void;
  disconnect(): void;
  send(message: ClientMessage): boolean;
  sendWorldLife(message: WorldLifeClientMessage): boolean;
  subscribe(listener: (message: ServerMessage) => void): () => void;
  subscribeWorldLife(listener: (message: WorldLifeServerMessage) => void): () => void;
  subscribeState(listener: (state: NetworkState) => void): () => void;
  dispose(): void;
}
