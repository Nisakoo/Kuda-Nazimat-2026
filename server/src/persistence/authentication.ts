import type { DatabaseSync } from 'node:sqlite';
import type { AccountStore, AuthAccount, SessionStore } from '../auth/ports.ts';
import type { PlayerIdentity } from '../contracts.ts';
import { randomId } from '../common/ids.ts';

/** Kept separate from the avatar adapter so both changes can be composed safely. */
export function sqliteAuthStores(db: DatabaseSync): { accounts: AccountStore; sessions: SessionStore } {
  function atomic<T>(action: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try { const result = action(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const find = db.prepare(`SELECT a.id AS accountId, p.id AS playerId, a.name AS displayName,
    c.salt, c.password_hash AS passwordHash FROM accounts a JOIN players p ON p.account_id = a.id
    LEFT JOIN account_credentials c ON c.account_id = a.id WHERE a.name_key = ?`);
  function findByName(nameKey: string): AuthAccount | null {
    const row = find.get(nameKey);
    if (!row) return null;
    return {
      identity: { accountId: String(row.accountId), playerId: String(row.playerId), displayName: String(row.displayName) },
      credential: row.salt === null ? null : { salt: String(row.salt), passwordHash: String(row.passwordHash) },
    };
  }
  function insert(name: string, nameKey: string, now: number): PlayerIdentity {
    const accountId = randomId('a'); const playerId = randomId('p');
    db.prepare('INSERT INTO accounts (id, name, name_key, created_at) VALUES (?, ?, ?, ?)').run(accountId, name, nameKey, now);
    db.prepare('INSERT INTO players (id, account_id, updated_at, avatar_id) VALUES (?, ?, ?, NULL)').run(playerId, accountId, now);
    return { accountId, playerId, displayName: name };
  }
  const accounts: AccountStore = {
    findByName,
    findOrCreate(name, key, now) {
      return atomic(() => {
        const found = findByName(key);
        // Defend the legacy persistence entry point too; never downgrade a password account.
        if (found?.credential) throw new Error('Password account requires password authentication');
        return found?.identity ?? insert(name, key, now);
      });
    },
    createPassword(name, key, now, credential) {
      return atomic(() => {
        if (findByName(key)) return null;
        const identity = insert(name, key, now);
        db.prepare('INSERT INTO account_credentials (account_id, salt, password_hash) VALUES (?, ?, ?)').run(identity.accountId, credential.salt, credential.passwordHash);
        return identity;
      });
    },
    requiresAvatar(accountId) {
      return !!db.prepare(`SELECT 1 FROM account_credentials c JOIN players p ON p.account_id = c.account_id
        WHERE c.account_id = ? AND p.avatar_id IS NULL`).get(accountId);
    },
  };
  const sessions: SessionStore = {
    create(s) { db.prepare('INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(s.tokenHash, s.accountId, s.createdAt, s.expiresAt); },
    find(hash) {
      const row = db.prepare(`SELECT a.id AS accountId, p.id AS playerId, a.name AS displayName, s.expires_at AS expiresAt
        FROM sessions s JOIN accounts a ON a.id = s.account_id JOIN players p ON p.account_id = a.id WHERE s.token_hash = ?`).get(hash);
      return row ? { identity: { accountId: String(row.accountId), playerId: String(row.playerId), displayName: String(row.displayName) }, expiresAt: Number(row.expiresAt) } : null;
    },
    revoke(hash) { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash); },
    prune(before) { db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(before); },
  };
  return { accounts, sessions };
}
