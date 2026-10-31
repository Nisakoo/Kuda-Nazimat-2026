import type { PlayerIdentity } from '../contracts.ts';
export interface AccountStore { findOrCreate(name: string, nameKey: string, now: number): PlayerIdentity }
export interface StoredSession { readonly tokenHash: string; readonly accountId: string; readonly createdAt: number; readonly expiresAt: number }
export interface SessionStore {
  create(session: StoredSession): void;
  find(tokenHash: string): { readonly identity: PlayerIdentity; readonly expiresAt: number } | null;
  prune(before: number): void;
}
