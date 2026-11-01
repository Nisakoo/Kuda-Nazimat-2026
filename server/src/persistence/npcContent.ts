import type { DatabaseSync } from 'node:sqlite';
import type { NpcChange, NpcRecord, NpcStore } from '../content/ports.ts';
import { transaction } from './database.ts';

const KEEP_CHANGES = 10_000;

/** CONTENT-001/010 in SQLite; the definition keeps the npcs.json shape as JSON. */
export function sqliteNpcStore(db: DatabaseSync): NpcStore {
  return {
    all: () => db.prepare('SELECT definition, state, revision, updated_at AS updatedAt, updated_by AS updatedBy FROM npcs ORDER BY rowid').all()
      .map((row) => ({ definition: JSON.parse(String(row.definition)), state: row.state, revision: Number(row.revision), updatedAt: Number(row.updatedAt), updatedBy: String(row.updatedBy) }) as NpcRecord),
    save(record, change) {
      transaction(db, () => {
        db.prepare(`INSERT INTO npcs (id, map_id, state, revision, definition, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET state = excluded.state, revision = excluded.revision, definition = excluded.definition, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
          .run(record.definition.id, record.definition.mapId, record.state, record.revision, JSON.stringify(record.definition), record.updatedAt, record.updatedBy);
        db.prepare('INSERT INTO npc_changes (npc_id, at, action, actor_id, actor_name, ip, revision, changes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(change.npcId, change.at, change.action, change.actorId, change.actorName, change.ip, change.revision, JSON.stringify(change.changes));
        db.prepare('DELETE FROM npc_changes WHERE id <= (SELECT max(id) FROM npc_changes) - ?').run(KEEP_CHANGES);
      });
    },
    changes: (npcId, limit) => (npcId === null
      ? db.prepare('SELECT * FROM npc_changes ORDER BY id DESC LIMIT ?').all(limit)
      : db.prepare('SELECT * FROM npc_changes WHERE npc_id = ? ORDER BY id DESC LIMIT ?').all(npcId, limit))
      .map((row): NpcChange => ({ npcId: String(row.npc_id), at: Number(row.at), action: row.action as NpcChange['action'], actorId: row.actor_id === null ? null : String(row.actor_id), actorName: String(row.actor_name), ip: row.ip === null ? null : String(row.ip), revision: Number(row.revision), changes: JSON.parse(String(row.changes)) })),
  };
}
