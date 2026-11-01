import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseEquipmentState } from '../../shared/equipment/validate.ts';
import { parseServerMessage } from '../../shared/protocol/validate.ts';
import type { ServerMessage } from '../../shared/protocol/types.ts';
import { loadMigrations, applyMigrations } from '../src/persistence/migrate.ts';
import { openDatabase, sqliteStores, transaction } from '../src/persistence/database.ts';
import { loadWorld } from '../src/world/loader.ts';
import { World } from '../src/game/World.ts';
import { GameService } from '../src/game/GameService.ts';
import { systemClock, systemScheduler } from '../src/common/time.ts';
import { silentLogger } from '../src/common/logger.ts';
import type { Channel } from '../src/game/ports.ts';
import { makeWorld } from './a-helpers.ts';

it('strictly validates equipment HTTP and snapshot shapes', () => {
  expect(parseEquipmentState({ tool: 'bag' })).toEqual({ tool: 'bag' });
  expect(parseEquipmentState({ tool: null })).toEqual({ tool: null });
  for (const value of [{}, { tool: 'apple' }, { tool: 'jug', playerId: 'p' }, { tool: 1 }, null, []]) expect(() => parseEquipmentState(value)).toThrow();
  const packet = (equipment: unknown) => ({ v: 3, type: 'delta', revision: 1, baseRevision: 0, tick: 1, upsert: [{ id: 'p', equipment }], remove: [] });
  expect(parseServerMessage(packet({ tool: 'jug' }))).toMatchObject({ upsert: [{ equipment: { tool: 'jug' } }] });
  for (const equipment of [{ tool: null }, { tool: 'apple' }, { tool: 'bag', id: 'x' }, {}, 'bag']) expect(() => parseServerMessage(packet(equipment))).toThrow();
});

it('migrates old players, persists and clears the single slot, and enforces the SQL constraint', () => {
  const dir = mkdtempSync(join(tmpdir(), 'equipment-')); const path = join(dir, 'game.sqlite');
  try {
    const old = new DatabaseSync(path); old.exec('PRAGMA foreign_keys = ON');
    transaction(old, () => applyMigrations(old, loadMigrations().slice(0, 4), 1));
    old.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?)').run('a', 'Player', 'player', 1);
    old.prepare('INSERT INTO players (id, account_id, updated_at) VALUES (?, ?, ?)').run('p', 'a', 1);
    old.close();
    let db = openDatabase(path); let store = sqliteStores(db).equipment;
    expect(store.load('p')).toBeNull(); store.save('p', 'bag'); store.save('p', 'jug'); db.close();
    db = openDatabase(path); store = sqliteStores(db).equipment;
    expect(store.load('p')).toBe('jug');
    expect(() => db.prepare('UPDATE players SET equipped_tool = ? WHERE id = ?').run('apple', 'p')).toThrow();
    expect(() => store.save('missing', 'bag')).toThrow();
    store.save('p', null); expect(store.load('p')).toBeNull(); db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('broadcasts equipment and removal through AOI and restores the saved slot after rejoin', async () => {
  const loaded = await loadWorld(await makeWorld([])); const world = new World(loaded.maps, loaded.npcs);
  const values = new Map<string, 'bag' | 'jug' | null>([['p', 'bag']]);
  const equipment = { load: (id: string) => values.get(id) ?? null, save: (id: string, tool: 'bag' | 'jug' | null) => { values.set(id, tool); } };
  const game = new GameService(world, { load: () => null, save() {} }, systemClock, systemScheduler, { maxPlayers: 4, disconnectGraceMs: 50, broadcastEvery: 1 }, silentLogger, undefined, equipment);
  const out: ServerMessage[] = [];
  const channel = (id: string): Channel => ({ id, send(message) { out.push(message); }, close() {} });
  const a = channel('a'), b = channel('b');
  game.attach({ accountId: 'a', playerId: 'p', displayName: 'Player' }, a);
  const initial = game.join(a, 'test'); if (!initial.ok) throw new Error();
  expect(initial.message('join')).toMatchObject({ snapshot: { entities: [expect.objectContaining({ equipment: { tool: 'bag' } })] } });
  game.attach({ accountId: 'b', playerId: 'q', displayName: 'Peer' }, b); game.join(b, 'test');
  equipment.save('p', 'jug'); game.setEquipment('p', 'jug'); game.tick(.05);
  expect(out.filter(p => p.type === 'delta' && p.upsert.some(e => e.id === 'p' && e.equipment?.tool === 'jug'))).toHaveLength(2);
  out.length = 0; equipment.save('p', null); game.setEquipment('p', null); game.tick(.05);
  const changes = out.filter(p => p.type === 'delta' && p.upsert.some(e => e.id === 'p' && !e.equipment)); expect(changes).toHaveLength(2);
  for (const message of changes) expect(() => parseServerMessage(message)).not.toThrow();
  equipment.save('p', 'jug'); world.remove('p');
  const c = channel('c'); game.attach({ accountId: 'a', playerId: 'p', displayName: 'Player' }, c);
  const restored = game.join(c, 'test'); if (!restored.ok) throw new Error();
  expect(restored.message('join')).toMatchObject({ snapshot: { entities: [expect.objectContaining({ id: 'p', equipment: { tool: 'jug' } }), expect.anything()] } });
  game.shutdown('test');
});
