import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import type { AppleState, HandResultMessage } from '../../../shared/world-life/types.ts';
import { handFailure, parseAppleState, parseWorldLifeServerMessage } from '../../../shared/world-life/validate.ts';
import type { WorldLifeStore } from '../game/worldLifePorts.ts';
import { transaction } from './database.ts';

export function sqliteWorldLife(db: DatabaseSync, now: () => number = Date.now): WorldLifeStore {
  const read = (): AppleState[] => db.prepare('SELECT * FROM world_apples ORDER BY id').all().map(row => parseAppleState(row.state === 'world'
    ? { id: row.id, mapId: row.map_id, state: 'world', position: { x: row.x, y: row.y, z: row.z } }
    : { id: row.id, mapId: row.map_id, state: 'held', holderId: row.holder_id }));
  return {
    initialize(definitions, restore) {
      return transaction(db, () => {
        const expected = new Set<string>(), added = new Set<string>();
        for (const definition of definitions) {
          const apples = definition.instances.filter(i => definition.templates.find(t => t.id === i.templateId)?.behavior === 'pickup');
          for (const apple of apples) {
            if (expected.has(apple.id)) throw new Error(`Duplicate durable apple id: ${apple.id}`);
            expected.add(apple.id);
            const existing = db.prepare('SELECT map_id FROM world_apples WHERE id = ?').get(apple.id);
            if (!existing) added.add(apple.id);
            if (existing && existing.map_id !== definition.mapId) throw new Error(`Apple home map changed: ${apple.id}`);
            db.prepare('INSERT OR IGNORE INTO world_apples (id,map_id,state,x,y,z) VALUES (?,?,\'world\',?,?,?)').run(apple.id, definition.mapId, apple.position.x, apple.position.y, apple.position.z);
          }
          const savedIds = db.prepare('SELECT id FROM world_apples WHERE map_id = ?').all(definition.mapId).map(row => String(row.id));
          if (savedIds.length !== apples.length || savedIds.some(id => !apples.some(a => a.id === id))) throw new Error(`Durable apple catalogue changed: ${definition.mapId}`);
        }
        const saved = read();
        if (saved.length !== expected.size || saved.some(a => !expected.has(a.id))) throw new Error('Durable apple catalogue removed or changed');
        if(!restore)return saved;
        // Preserve existing positions first; new authored items yield when they overlap an old save.
        const repaired=restore([...saved].sort((a,b)=>Number(added.has(a.id))-Number(added.has(b.id))));
        if(repaired.length!==saved.length||new Set(repaired.map(a=>a.id)).size!==saved.length)throw new Error('Invalid scene restoration');
        for(const item of repaired){
          const before=saved.find(a=>a.id===item.id);if(!before||before.mapId!==item.mapId||before.state!==item.state||before.state==='held'&&(item.state!=='held'||item.holderId!==before.holderId))throw new Error('Restoration changed item ownership');
          parseAppleState(item);
          if(item.state==='world')db.prepare('UPDATE world_apples SET x=?,y=?,z=? WHERE id=? AND state=\'world\'').run(item.position.x,item.position.y,item.position.z,item.id);
        }
        return repaired;
      });
    },
    resetApples(mapId, apples) {
      return transaction(db, () => {
        const update = db.prepare('UPDATE world_apples SET state = \'world\', x = ?, y = ?, z = ?, holder_id = NULL WHERE id = ? AND map_id = ?');
        for (const apple of apples) if (update.run(apple.position.x, apple.position.y, apple.position.z, apple.id, mapId).changes !== 1) throw new Error('Unknown durable apple');
        return read();
      });
    },
    execute(playerId, mapId, request, decide) {
      const fingerprint = createHash('sha256').update(JSON.stringify({ mapId, action: request.action, ...(request.action === 'pickup' && { targetId: request.targetId }) })).digest('hex');
      return transaction(db, () => {
        const apples = read();
        const receipt = db.prepare('SELECT fingerprint,result FROM world_hand_receipts WHERE player_id = ? AND request_id = ?').get(playerId, request.requestId);
        if (receipt) {
          const parsed = parseWorldLifeServerMessage(JSON.parse(String(receipt.result)));
          if (parsed.type !== 'hand-result') throw new Error('Invalid hand receipt');
          return { result: receipt.fingerprint === fingerprint ? parsed : handFailure(request.requestId, 'CONFLICT', 'Этот requestId уже использован для другого действия.'), apples, changed: false };
        }
        const result: HandResultMessage = decide(apples);
        if (result.ok) {
          const apple = result.apple;
          if (!apples.some(a => a.id === apple.id && a.mapId === apple.mapId)) throw new Error('Unknown durable apple');
          const changed = apple.state === 'held'
            ? db.prepare('UPDATE world_apples SET state = \'held\', x = NULL,y = NULL,z = NULL,holder_id = ? WHERE id = ?').run(apple.holderId, apple.id)
            : db.prepare('UPDATE world_apples SET state = \'world\', x = ?,y = ?,z = ?,holder_id = NULL WHERE id = ?').run(apple.position.x, apple.position.y, apple.position.z, apple.id);
          if (changed.changes !== 1) throw new Error('Apple update failed');
        }
        db.prepare('INSERT INTO world_hand_receipts VALUES (?,?,?,?,?)').run(playerId, request.requestId, fingerprint, JSON.stringify(result), now());
        return { result, apples: read(), changed: result.ok };
      });
    },
  };
}
