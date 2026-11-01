import type { PlayerIdentity } from '../contracts.ts';

export interface AccountRecord {
  readonly identity: PlayerIdentity;
  /** `scrypt$…` (AUTH-008) or null for a passwordless development/test account. */
  readonly passwordHash: string | null;
  readonly mustChangePassword: boolean;
  readonly tempPasswordExpiresAt: number | null;
  readonly lastLoginAt: number | null;
}
export interface AccountStore {
  /** Passwordless login (AUTH-001 guest/dev): one name key — one account and player. */
  findOrCreate(name: string, nameKey: string, now: number): PlayerIdentity;
  find(nameKey: string): AccountRecord | null;
  /** Throws NameTakenError when the key exists. */
  create(name: string, nameKey: string, passwordHash: string, now: number): PlayerIdentity;
  setPassword(accountId: string, passwordHash: string, options: { mustChange: boolean; tempExpiresAt: number | null }, now: number): void;
  list(now: number): readonly { name: string; hasPassword: boolean; mustChangePassword: boolean; activeSessions: number; lastLoginAt: number | null }[];
}
export class NameTakenError extends Error {}

export interface StoredSession {
  readonly tokenHash: string; readonly accountId: string; readonly createdAt: number; readonly expiresAt: number;
  /** Public id for logs and the operator (AUTH-002); generated when omitted. */
  readonly id?: string; readonly ip?: string;
}
export type RevokeReason = 'logout' | 'password-changed' | 'password-reset' | 'operator' | 'limit';
export interface SessionStore {
  create(session: StoredSession): void;
  find(tokenHash: string): { readonly identity: PlayerIdentity; readonly expiresAt: number; readonly sessionId: string; readonly revokedAt: number | null } | null;
  /** Revokes the given session or every active session of an account; returns token hashes that were active. */
  revoke(target: { tokenHash: string } | { accountId: string }, reason: RevokeReason, now: number): string[];
  /** Keeps at most `max` active sessions of the account, revoking the oldest with reason `limit`. */
  enforceLimit(accountId: string, max: number, now: number): string[];
  /** Deletes sessions that expired or were revoked before `before`. */
  prune(before: number): void;
}
