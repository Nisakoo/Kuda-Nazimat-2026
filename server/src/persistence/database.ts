import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { sqliteAuthStores } from './authentication.ts';
import type { AccountStore, SessionStore } from '../auth/ports.ts';
import type { DialogueStore } from '../npc/ports.ts';
import type { AvatarStore, EquipmentStore, PlayerStore } from '../contracts.ts';
import { isToolId } from '../../../shared/equipment/validate.ts';
import { isAvatarId } from '../../../shared/avatar/validate.ts';
import { applyMigrations, loadMigrations } from './migrate.ts';

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
    const migrations = loadMigrations();
    transaction(db, () => applyMigrations(db, migrations, now));
    return db;
  } catch (error) { db.close(); throw new Error(`Не удалось открыть БД ${path}`, { cause: error }); }
}
export function sqliteStores(db: DatabaseSync, now: () => number = Date.now): {
  accounts: AccountStore; sessions: SessionStore; players: PlayerStore; avatars: AvatarStore; equipment: EquipmentStore; dialogue: DialogueStore;
} {
  const { accounts, sessions } = sqliteAuthStores(db);
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
  return { accounts, sessions, players, avatars, equipment, dialogue };
}
