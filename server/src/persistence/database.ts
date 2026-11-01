import { isToolId } from '../../../shared/equipment/validate.ts';
import { isAvatarId } from '../../../shared/avatar/validate.ts';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomId } from '../common/ids.ts';
import { NameTakenError, type AccountStore, type SessionStore } from '../auth/ports.ts';
import type { DialogueStore } from '../npc/ports.ts';
import type { AvatarStore, EquipmentStore, PlayerIdentity, PlayerStore } from '../contracts.ts';
import { applyApplicationMigrations } from './migrate.ts';

export function transaction<T>(db: DatabaseSync, action: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const value = action(); db.exec('COMMIT'); return value; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function openDatabase(path: string, now = Date.now()): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 1000');
    transaction(db, () => applyApplicationMigrations(db, now));
    return db;
  } catch (error) { db.close(); throw new Error(`Не удалось открыть БД ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
}
/** Called after each store operation: timing and failures for OBS (db.slow, db.transaction.failed). */
export type DatabaseObserver = (operation: string, durationMs: number, error?: unknown) => void;

export function sqliteStores(db: DatabaseSync, now: () => number = Date.now, observe: DatabaseObserver = () => {}): {
  accounts: AccountStore; sessions: SessionStore; players: PlayerStore; avatars: AvatarStore; equipment: EquipmentStore; dialogue: DialogueStore;
} {
  const timed = <T>(operation: string, action: () => T): T => {
    const began = performance.now();
    try { const value = action(); observe(operation, performance.now() - began); return value; }
    catch (error) { observe(operation, performance.now() - began, error); throw error; }
  };
  const optional = (value: unknown): number | null => value === null || value === undefined ? null : Number(value);
  const findAccount = db.prepare('SELECT a.id AS accountId, p.id AS playerId, a.name AS displayName FROM accounts a JOIN players p ON p.account_id = a.id WHERE name_key = ?');
  const insertAccount = (name: string, nameKey: string, passwordHash: string | null, time: number): PlayerIdentity => {
    const accountId = randomId('a'); const playerId = randomId('p');
    db.prepare('INSERT INTO accounts (id, name, name_key, created_at, password_hash, password_set_at) VALUES (?, ?, ?, ?, ?, ?)').run(accountId, name, nameKey, time, passwordHash, passwordHash ? time : null);
    db.prepare('INSERT INTO players (id, account_id, updated_at) VALUES (?, ?, ?)').run(playerId, accountId, time);
    return { accountId, playerId, displayName: name };
  };
  const accounts: AccountStore = {
    requiresAvatar(accountId) {
      return !!db.prepare('SELECT 1 FROM accounts a JOIN players p ON p.account_id = a.id WHERE a.id = ? AND a.password_hash IS NOT NULL AND p.avatar_id IS NULL').get(accountId);
    },
    findOrCreate(name, nameKey, time) {
      return timed('accounts.findOrCreate', () => transaction(db, () => (findAccount.get(nameKey) as unknown as PlayerIdentity | undefined) ?? insertAccount(name, nameKey, null, time)));
    },
    find(nameKey) {
      const row = timed('accounts.find', () => db.prepare(`SELECT a.id AS accountId, p.id AS playerId, a.name AS displayName, a.password_hash AS hash, a.must_change_password AS must,
        a.temp_password_expires_at AS tempExpires, a.role AS role, (SELECT max(created_at) FROM sessions s WHERE s.account_id = a.id) AS lastLogin
        FROM accounts a JOIN players p ON p.account_id = a.id WHERE name_key = ?`).get(nameKey));
      if (!row) return null;
      return {
        identity: { accountId: String(row.accountId), playerId: String(row.playerId), displayName: String(row.displayName) },
        passwordHash: row.hash === null ? null : String(row.hash), mustChangePassword: Number(row.must) === 1,
        tempPasswordExpiresAt: optional(row.tempExpires), lastLoginAt: optional(row.lastLogin), role: row.role === 'admin' ? 'admin' : 'player',
      };
    },
    create(name, nameKey, passwordHash, time) {
      return timed('accounts.create', () => transaction(db, () => {
        if (findAccount.get(nameKey)) throw new NameTakenError(nameKey);
        return insertAccount(name, nameKey, passwordHash, time);
      }));
    },
    setPassword(accountId, passwordHash, options, time) {
      timed('accounts.setPassword', () => db.prepare('UPDATE accounts SET password_hash = ?, password_set_at = ?, must_change_password = ?, temp_password_expires_at = ? WHERE id = ?')
        .run(passwordHash, time, options.mustChange ? 1 : 0, options.tempExpiresAt, accountId));
    },
    setRole(accountId, role) { timed('accounts.setRole', () => db.prepare('UPDATE accounts SET role = ? WHERE id = ?').run(role, accountId)); },
    list(time) {
      return timed('accounts.list', () => db.prepare(`SELECT a.name AS name, a.role AS role, a.password_hash IS NOT NULL AS hasPassword, a.must_change_password AS must,
        (SELECT count(*) FROM sessions s WHERE s.account_id = a.id AND s.revoked_at IS NULL AND s.expires_at > ?) AS active,
        (SELECT max(created_at) FROM sessions s WHERE s.account_id = a.id) AS lastLogin FROM accounts a ORDER BY a.name_key`).all(time))
        .map((row) => ({ name: String(row.name), role: row.role === 'admin' ? 'admin' as const : 'player' as const, hasPassword: Number(row.hasPassword) === 1, mustChangePassword: Number(row.must) === 1, activeSessions: Number(row.active), lastLoginAt: optional(row.lastLogin) }));
    },
  };
  const revokeAll = (hashes: string[], reason: string, time: number): string[] => {
    const update = db.prepare('UPDATE sessions SET revoked_at = ?, revoke_reason = ? WHERE token_hash = ?');
    for (const hash of hashes) update.run(time, reason, hash);
    return hashes;
  };
  const sessions: SessionStore = {
    isActive(sessionId, playerId, time) {
      return !!timed('sessions.isActive', () => db.prepare("SELECT 1 FROM sessions s JOIN players p ON p.account_id = s.account_id WHERE s.id = ? AND p.id = ? AND s.scope = 'game' AND s.revoked_at IS NULL AND s.expires_at > ?").get(sessionId, playerId, time));
    },
    create(s) {
      timed('sessions.create', () => db.prepare('INSERT INTO sessions (token_hash, account_id, created_at, expires_at, id, created_ip, scope) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(s.tokenHash, s.accountId, s.createdAt, s.expiresAt, s.id ?? randomId('s'), s.ip ?? null, s.scope ?? 'game'));
    },
    find(hash) {
      const row = timed('sessions.find', () => db.prepare('SELECT a.id AS accountId, p.id AS playerId, a.name AS displayName, s.expires_at AS expiresAt, s.id AS sessionId, s.revoked_at AS revokedAt, s.scope AS scope, a.role AS role FROM sessions s JOIN accounts a ON a.id = s.account_id JOIN players p ON p.account_id = a.id WHERE token_hash = ?').get(hash));
      return row ? { identity: { accountId: String(row.accountId), playerId: String(row.playerId), displayName: String(row.displayName) }, expiresAt: Number(row.expiresAt), sessionId: String(row.sessionId), revokedAt: optional(row.revokedAt), scope: row.scope === 'admin' ? 'admin' : 'game', role: row.role === 'admin' ? 'admin' : 'player' } : null;
    },
    revoke(target, reason, time) {
      return timed('sessions.revoke', () => transaction(db, () => {
        const rows = 'tokenHash' in target
          ? db.prepare('SELECT token_hash AS hash FROM sessions WHERE revoked_at IS NULL AND token_hash = ?').all(target.tokenHash)
          : target.scope
            ? db.prepare('SELECT token_hash AS hash FROM sessions WHERE revoked_at IS NULL AND account_id = ? AND expires_at > ? AND scope = ?').all(target.accountId, time, target.scope)
            : db.prepare('SELECT token_hash AS hash FROM sessions WHERE revoked_at IS NULL AND account_id = ? AND expires_at > ?').all(target.accountId, time);
        return revokeAll(rows.map((row) => String(row.hash)), reason, time);
      }));
    },
    enforceLimit(accountId, max, time, scope = 'game') {
      return timed('sessions.enforceLimit', () => transaction(db, () => revokeAll(db.prepare('SELECT token_hash AS hash FROM sessions WHERE account_id = ? AND revoked_at IS NULL AND expires_at > ? AND scope = ? ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?')
        .all(accountId, time, scope, max).map((row) => String(row.hash)), 'limit', time)));
    },
    prune(before) { timed('sessions.prune', () => db.prepare('DELETE FROM sessions WHERE expires_at < ? OR revoked_at < ?').run(before, before)); },
  };
  const players: PlayerStore = {
    load(id) {
      const row = timed('players.load', () => db.prepare('SELECT map_id, x, y, z, rotation_y FROM players WHERE id = ?').get(id));
      return !row || row.map_id === null ? null : { mapId: String(row.map_id), position: { x: Number(row.x), y: Number(row.y), z: Number(row.z) }, rotationY: Number(row.rotation_y) };
    },
    save(players) {
      timed('players.save', () => transaction(db, () => {
        const statement = db.prepare('UPDATE players SET map_id = ?, x = ?, y = ?, z = ?, rotation_y = ?, updated_at = ? WHERE id = ?');
        for (const p of players) {
          if (!p.mapId || ![p.position.x, p.position.y, p.position.z, p.rotationY].every(Number.isFinite)) throw new Error('Неверная позиция');
          if (statement.run(p.mapId, p.position.x, p.position.y, p.position.z, p.rotationY, now(), p.id).changes !== 1) throw new Error('Игрок не найден');
        }
      }));
    },
  };
  const avatars: AvatarStore = {
    load(id) {
      const row = db.prepare('SELECT avatar_id FROM players WHERE id = ?').get(id);
      if (!row || (row.avatar_id !== null && !isAvatarId(row.avatar_id))) throw new Error('Игрок или облик не найден');
      return row.avatar_id as import('../../../shared/avatar/types.ts').AvatarId | null;
    },
    save(id, avatarId) {
      if (!isAvatarId(avatarId) || db.prepare('UPDATE players SET avatar_id = ? WHERE id = ?').run(avatarId, id).changes !== 1) throw new Error('Игрок или облик не найден');
    },
  };
  const equipment: EquipmentStore = {
    load(id) {
      const row = db.prepare('SELECT equipped_tool FROM players WHERE id = ?').get(id);
      if (!row || (row.equipped_tool !== null && !isToolId(row.equipped_tool))) throw new Error('Игрок или инструмент не найден');
      return row.equipped_tool as import('../../../shared/equipment/types.ts').ToolId | null;
    },
    save(id, tool) {
      if ((tool !== null && !isToolId(tool)) || db.prepare('UPDATE players SET equipped_tool = ? WHERE id = ?').run(tool, id).changes !== 1) throw new Error('Игрок или инструмент не найден');
    },
  };
  const dialogue: DialogueStore = {
    history(playerId, npcId, sessionId) {
      if (!sessionId) return [];
      return timed('dialogue.history', () => db.prepare('SELECT question, answer FROM npc_dialogue WHERE player_id = ? AND npc_id = ? AND session_id = ? ORDER BY created_at DESC, id DESC LIMIT 6').all(playerId, npcId, sessionId).reverse() as unknown as { question: string; answer: string }[]);
    },
    append(playerId, npcId, question, answer, time, sessionId) {
      if (!sessionId) throw new Error('Missing AUTH scope');
      timed('dialogue.append', () => transaction(db, () => {
        db.prepare('INSERT INTO npc_dialogue (player_id, npc_id, question, answer, created_at, session_id) VALUES (?, ?, ?, ?, ?, ?)').run(playerId, npcId, question, answer, time, sessionId);
        // Keep the inherited aggregate rolling window, including legacy rows, across AUTH sessions.
        db.prepare('DELETE FROM npc_dialogue WHERE player_id = ? AND npc_id = ? AND id NOT IN (SELECT id FROM npc_dialogue WHERE player_id = ? AND npc_id = ? ORDER BY created_at DESC, id DESC LIMIT 50)').run(playerId, npcId, playerId, npcId);
      }));
    },
  };
  return { accounts, sessions, players, avatars, equipment, dialogue };
}
