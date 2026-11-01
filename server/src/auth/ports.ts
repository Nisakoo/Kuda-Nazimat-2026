import type { PlayerIdentity } from '../contracts.ts';

/** Fixed scrypt-v1 parameters belong to the service, not to caller-controlled data. */
export interface PasswordCredential {
  readonly salt: string;
  readonly passwordHash: string;
}
export interface AuthAccount {
  readonly identity: PlayerIdentity;
  /** null identifies a legacy/demo guest, never a password account. */
  readonly credential: PasswordCredential | null;
}
export interface AccountStore {
  findOrCreate(name: string, nameKey: string, now: number): PlayerIdentity;
  findByName(nameKey: string): AuthAccount | null;
  /** Atomically inserts account, player with NULL avatar, and credential; null on occupied name. */
  createPassword(name: string, nameKey: string, now: number, credential: PasswordCredential): PlayerIdentity | null;
  /** True only for a password account whose persisted player avatar is NULL. */
  requiresAvatar(accountId: string): boolean;
}
export interface StoredSession { readonly tokenHash: string; readonly accountId: string; readonly createdAt: number; readonly expiresAt: number }
export interface SessionStore {
  create(session: StoredSession): void;
  find(tokenHash: string): { readonly identity: PlayerIdentity; readonly expiresAt: number } | null;
  revoke(tokenHash: string): void;
  prune(before: number): void;
}
