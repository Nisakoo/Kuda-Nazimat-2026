import type { DatabaseSync } from 'node:sqlite';
import type { BabylonStore, Profile, Party, Operation } from '../babylon/ports.ts';
import { transaction } from './database.ts';

export function sqliteBabylon(db: DatabaseSync): BabylonStore {
  const profile = db.prepare('SELECT state FROM babel_profiles WHERE player_id = ?');
  const party = db.prepare('SELECT state FROM babel_parties WHERE id = ?');
  const operation = db.prepare('SELECT state FROM babel_operations WHERE player_id = ? AND request_id = ?');
  const parse = <T>(row: Record<string, unknown> | undefined): T | null => row ? JSON.parse(String(row.state)) as T : null;
  return {
    transaction: action => transaction(db, action),
    profile(id) {
      const value = parse<Profile>(profile.get(id));
      if (value) value.words = value.words.map(word => ({ ...word, learned: word.learned ?? false, example: word.example ?? '', exampleTranslation: word.exampleTranslation ?? '' }));
      return value;
    },
    party: id => parse<Party>(party.get(id)),
    openParty: () => parse<Party>(db.prepare("SELECT state FROM babel_parties WHERE json_extract(state, '$.startedAt') IS NULL ORDER BY rowid LIMIT 1").get()),
    saveProfile(id, value) { db.prepare('INSERT INTO babel_profiles VALUES (?, ?, ?) ON CONFLICT(player_id) DO UPDATE SET party_id=excluded.party_id,state=excluded.state').run(id, value.groupId, JSON.stringify(value)); },
    saveParty(value) { db.prepare('INSERT INTO babel_parties VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET state=excluded.state').run(value.id, JSON.stringify(value)); },
    deleteParty(id) { db.prepare('DELETE FROM babel_parties WHERE id = ?').run(id); },
    operation: (id, requestId) => parse<Operation>(operation.get(id, requestId)),
    saveOperation(id, requestId, value) { db.prepare('INSERT INTO babel_operations VALUES (?, ?, ?) ON CONFLICT(player_id,request_id) DO UPDATE SET state=excluded.state').run(id, requestId, JSON.stringify(value)); },
    interrupt() {
      transaction(db, () => {
        db.exec("UPDATE babel_operations SET state=json_set(state, '$.status', 'failed') WHERE json_extract(state, '$.status')='pending'");
        for (const row of db.prepare('SELECT state FROM babel_parties').all()) {
          const value = parse<Party>(row)!; let changed = false;
          for (const message of value.messages) for (const delivery of Object.values(message.deliveries)) {
            if (delivery.status === 'sent' || delivery.status === 'translating') { delivery.status = 'error'; delivery.error = 'Сервер перезапущен. Повторите отправку.'; changed = true; }
          }
          if (changed) db.prepare('UPDATE babel_parties SET state=? WHERE id=?').run(JSON.stringify(value), value.id);
        }
      });
    },
  };
}
