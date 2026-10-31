import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomId } from '../common/ids.ts';
import type { AccountStore, SessionStore } from '../auth/ports.ts';
import type { DialogueStore } from '../npc/ports.ts';
import type { PlayerIdentity, PlayerStore } from '../contracts.ts';

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
    transaction(db, () => {
      db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
      const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
      if (versions.some((row) => row.version !== 1)) throw new Error('Неизвестная версия БД');
      if (!versions.length) {
        db.exec(readFileSync(new URL('./migrations/001.sql', import.meta.url), 'utf8'));
        db.prepare('INSERT INTO schema_migrations VALUES (1, ?)').run(now);
      }
    });
    return db;
  } catch (error) { db.close(); throw new Error(`Не удалось открыть БД ${path}`, { cause: error }); }
}
export function sqliteStores(db: DatabaseSync, now: () => number = Date.now): {
  accounts: AccountStore; sessions: SessionStore; players: PlayerStore; dialogue: DialogueStore;
} {
  const findAccount = db.prepare('SELECT a.id AS accountId, p.id AS playerId, a.name AS displayName FROM accounts a JOIN players p ON p.account_id = a.id WHERE name_key = ?');
  const accounts: AccountStore = {
    findOrCreate(name, nameKey, time) {
      return transaction(db, () => {
        const found = findAccount.get(nameKey);
        if (found) return found as unknown as PlayerIdentity;
        const accountId = randomId('a'); const playerId = randomId('p');
        db.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?)').run(accountId, name, nameKey, time);
        db.prepare('INSERT INTO players (id, account_id, updated_at) VALUES (?, ?, ?)').run(playerId, accountId, time);
        return { accountId, playerId, displayName: name };
      });
    },
  };
  const sessions: SessionStore = {
    create(s) { db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run(s.tokenHash, s.accountId, s.createdAt, s.expiresAt); },
    find(hash) {
      const row = db.prepare('SELECT a.id AS accountId, p.id AS playerId, a.name AS displayName, s.expires_at AS expiresAt FROM sessions s JOIN accounts a ON a.id = s.account_id JOIN players p ON p.account_id = a.id WHERE token_hash = ?').get(hash);
      return row ? { identity: { accountId: String(row.accountId), playerId: String(row.playerId), displayName: String(row.displayName) }, expiresAt: Number(row.expiresAt) } : null;
    },
    prune(before) { db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(before); },
  };
  const players: PlayerStore = {
    load(id) {
      const row = db.prepare('SELECT map_id, x, y, z, rotation_y FROM players WHERE id = ?').get(id);
      return !row || row.map_id === null ? null : { mapId: String(row.map_id), position: { x: Number(row.x), y: Number(row.y), z: Number(row.z) }, rotationY: Number(row.rotation_y) };
    },
    save(players) {
      transaction(db, () => {
        const statement = db.prepare('UPDATE players SET map_id = ?, x = ?, y = ?, z = ?, rotation_y = ?, updated_at = ? WHERE id = ?');
        for (const p of players) {
          if (!p.mapId || ![p.position.x, p.position.y, p.position.z, p.rotationY].every(Number.isFinite)) throw new Error('Неверная позиция');
          if (statement.run(p.mapId, p.position.x, p.position.y, p.position.z, p.rotationY, now(), p.id).changes !== 1) throw new Error('Игрок не найден');
        }
      });
    },
  };
  const dialogue: DialogueStore = {
    history(playerId, npcId) {
      return db.prepare('SELECT question, answer FROM npc_dialogue WHERE player_id = ? AND npc_id = ? ORDER BY created_at DESC, id DESC LIMIT 6').all(playerId, npcId).reverse() as unknown as { question: string; answer: string }[];
    },
    append(playerId, npcId, question, answer, time) {
      transaction(db, () => {
        db.prepare('INSERT INTO npc_dialogue (player_id, npc_id, question, answer, created_at) VALUES (?, ?, ?, ?, ?)').run(playerId, npcId, question, answer, time);
        db.prepare('DELETE FROM npc_dialogue WHERE player_id = ? AND npc_id = ? AND id NOT IN (SELECT id FROM npc_dialogue WHERE player_id = ? AND npc_id = ? ORDER BY created_at DESC, id DESC LIMIT 50)').run(playerId, npcId, playerId, npcId);
      });
    },
  };
  return { accounts, sessions, players, dialogue };
}
