import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase, sqliteStores } from '../src/persistence/database.ts';
import { sqliteBabylon } from '../src/persistence/babylon.ts';
import { BabylonService } from '../src/babylon/BabylonService.ts';
import { testLanguagePort } from '../src/babylon/TestLanguagePort.ts';
import type { LanguagePort, BabylonLocation } from '../src/babylon/ports.ts';
import { createGenerationQueue } from '../src/npc/GenerationQueue.ts';
import { systemClock, systemScheduler } from '../src/common/time.ts';
import { silentLogger } from '../src/common/logger.ts';
import type { BabylonAction } from '../../shared/babylon/types.ts';
import { parseBabylonRequest, parseBabylonResult } from '../../shared/babylon/validate.ts';
import type { PlayerIdentity } from '../src/contracts.ts';

const dirs: string[] = [], dbs: DatabaseSync[] = [];
afterEach(() => { for (const db of dbs.splice(0)) { try { db.close(); } catch {} } for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture(language: LanguagePort = testLanguagePort) {
  const dir = mkdtempSync(join(tmpdir(), 'babel-')); dirs.push(dir);
  const path = join(dir, 'game.sqlite'); let db = openDatabase(path); dbs.push(db);
  const stores = sqliteStores(db), people = ['A', 'B', 'C', 'D'].map(name => stores.accounts.findOrCreate(name, name, 1));
  const positions = new Map<string, BabylonLocation>();
  const queue = createGenerationQueue({ clock: systemClock, scheduler: systemScheduler, logger: silentLogger }, { maxConcurrent: 1, maxUnfinished: 4, timeoutMs: 8000 });
  let ids = 0, requests = 0;
  const make = () => new BabylonService({ store: sqliteBabylon(db), language, generate: queue.generate, now: Date.now, id: () => `id${++ids}`, location: id => positions.get(id) ?? null });
  let service = make();
  return { people, positions, queue, get service() { return service; }, get db() { return db; },
    call: (player: PlayerIdentity, action: BabylonAction, requestId = `request${++requests}`) => service.handle(player, parseBabylonRequest({ v: 2, requestId, action }), player.playerId),
    restart() { db.close(); db = openDatabase(path); dbs.push(db); service = make(); },
  };
}
it('enrolls a fixed group, starts only when full, restores roles/languages and hides private dictionary data', async () => {
  const f = fixture(), [a, b, c] = f.people as [PlayerIdentity, PlayerIdentity, PlayerIdentity, PlayerIdentity];
  await f.call(a, { type: 'enroll', size: 2, native: 'ru', learning: 'en' });
  expect(f.service.state(a).party?.started).toBe(false);
  await expect(f.call(b, { type: 'enroll', size: 3, native: 'ru', learning: 'es' })).rejects.toMatchObject({ code: 'CONFLICT' });
  await f.call(b, { type: 'enroll', size: 2, native: 'ru', learning: 'es' });
  expect(f.service.state(a).party?.started).toBe(true); expect(f.service.state(b).goatGuide).toBeNull();
  expect(f.service.spawn(a.playerId)?.position.z).toBe(-26); expect(f.service.spawn(b.playerId)?.position.z).toBe(8);
  const saved = await f.call(a, { type: 'word-save', word: 'goat', translation: 'коза', note: '<img onerror=alert(1)>' }, 'word1');
  const word = saved.state.words[0]!;
  await expect(f.call(b, { type: 'word-delete', id: word.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(f.service.state(b).words).toEqual([]); expect(f.service.state(c).stones).toEqual([]);
  await f.call(a, { type: 'languages', native: 'es', learning: 'ru' });
  await f.call(a, { type: 'word-save', id: word.id, word: 'kid', translation: 'козлёнок', note: 'исправлено' });
  f.restart(); expect(f.service.state(a).party?.role).toBe(1);
  expect(f.service.state(a).words[0]).toMatchObject({ word: 'kid', native: 'ru', learning: 'en' });
  expect(f.service.state(a).profile).toEqual({ native: 'es', learning: 'ru' });
  await f.call(a, { type: 'word-delete', id: word.id }); expect(f.service.state(a).words).toEqual([]);
});
it('persists immutable group stones, deduplicates retries and rejects a changed request body', async () => {
  const f = fixture(), [a, b] = f.people as [PlayerIdentity, PlayerIdentity];
  for (const p of [a, b]) await f.call(p, { type: 'enroll', size: 2, native: 'ru', learning: 'en' });
  const action = { type: 'carve' as const, drawing: [[[1, 2], [3, 4]]] as const };
  await f.call(a, action, 'stone1'); await f.call(a, action, 'stone1');
  expect(f.service.state(b).stones).toHaveLength(1);
  await expect(f.call(a, { type: 'carve', drawing: [[[9, 9]]] }, 'stone1')).rejects.toMatchObject({ code: 'CONFLICT' });
  f.restart(); expect(f.service.state(b).stones[0]?.drawing).toEqual(action.drawing);
  for (let i = 0; i < 7; i++) await f.call(a, action);
  await expect(f.call(a, action)).rejects.toMatchObject({ code: 'INVALID' });
});
it('validates authoritative location and role, keeps wrong food, completes solo and persists inventory', async () => {
  const f = fixture(), a = f.people[0]!;
  await f.call(a, { type: 'enroll', size: 1, native: 'ru', learning: 'en' });
  const buy = { type: 'buy' as const, item: 'dates' as const, targetId: 'fruit-seller' };
  await expect(f.call(a, buy)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  f.positions.set(a.accountId, { mapId: 'market', position: { x: -4.5, y: 0, z: .5 } });
  await f.call(a, buy, 'buy1'); await f.call(a, buy, 'buy1'); expect(f.service.state(a).inventory.dates).toBe(1);
  for (const item of ['red-fruit', 'yellow-fruit'] as const) await f.call(a, { ...buy, item });
  f.positions.set(a.accountId, { mapId: 'market', position: { x: 4.6, y: 0, z: -.5 } });
  await f.call(a, { type: 'buy', item: 'water', targetId: 'potter' });
  f.positions.set(a.accountId, { mapId: 'market', position: { x: 4, y: 0, z: -32 } });
  await f.call(a, { type: 'feed', item: 'dates', targetId: 'black-goat' }); expect(f.service.state(a).inventory.dates).toBe(1);
  const feed = [['white-goat', 'dates', -5, -31], ['black-goat', 'red-fruit', 4, -32], ['spotted-goat', 'yellow-fruit', -4, -37], ['kid-goat', 'water', 4, -37]] as const;
  for (const [targetId, item, x, z] of feed) { f.positions.set(a.accountId, { mapId: 'market', position: { x, y: 0, z } }); await f.call(a, { type: 'feed', item, targetId }); }
  f.restart(); expect(f.service.state(a).party?.completed).toBe(true); expect(f.service.state(a).fed).toHaveLength(4); expect(f.service.state(a).inventory.dates).toBe(0);
});
it('translates per recipient, skips matching languages and fixes languages for an accepted request', async () => {
  let release!: () => void, started!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; });
  let calls = 0;
  const language: LanguagePort = { ...testLanguagePort, async translate(text, source, target, signal) { calls++; started(); await new Promise<void>(resolve => { release = resolve; }); return testLanguagePort.translate(text, source, target, signal); } };
  const f = fixture(language), [a, b, c] = f.people as [PlayerIdentity, PlayerIdentity, PlayerIdentity];
  await f.call(a, { type: 'enroll', size: 3, native: 'ru', learning: 'en' });
  await f.call(b, { type: 'enroll', size: 3, native: 'ru', learning: 'es' });
  await f.call(c, { type: 'enroll', size: 3, native: 'en', learning: 'ru' });
  const pending = f.call(a, { type: 'chat', text: 'Купи финики' }, 'chat1'); await began;
  expect(f.service.state(a).messages[0]?.status).toBe('translating'); expect(f.service.state(b).messages).toEqual([]);
  expect(f.service.state(c).messages[0]).toMatchObject({ text: 'Купи финики', translated: false });
  await f.call(b, { type: 'languages', native: 'ru', learning: 'en' }); release(); await pending;
  expect(f.service.state(b).messages[0]).toMatchObject({ text: 'Compra dátiles', language: 'es', translated: true });
  expect(calls).toBe(1); await f.call(a, { type: 'chat', text: 'Купи финики' }, 'chat1'); expect(calls).toBe(1);
  f.restart(); expect(f.service.state(b).messages).toHaveLength(1);
});
it('shows failed translation without source fallback and retries the same message without a duplicate', async () => {
  let fail = true;
  const f = fixture({ ...testLanguagePort, async translate(...args) { if (fail) throw new Error('offline'); return testLanguagePort.translate(...args); } });
  const [a, b] = f.people as [PlayerIdentity, PlayerIdentity];
  for (const p of [a, b]) await f.call(p, { type: 'enroll', size: 2, native: 'ru', learning: 'en' });
  await expect(f.call(a, { type: 'chat', text: 'Купи финики' }, 'retry')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  expect(f.service.state(b).messages).toEqual([]); expect(f.service.state(a).messages[0]?.status).toBe('error');
  fail = false; await f.call(a, { type: 'chat', text: 'Купи финики' }, 'retry');
  expect(f.service.state(b).messages).toHaveLength(1); expect(f.service.state(b).messages[0]?.text).toBe('Buy dates');
});
it('suggests a translation and answers private NPC dialogue in the selected language without granting items', async () => {
  const f = fixture(), a = f.people[0]!;
  await f.call(a, { type: 'enroll', size: 1, native: 'ru', learning: 'en' });
  expect((await f.call(a, { type: 'suggest', word: 'goat' })).suggestion).toBe('коза');
  f.positions.set(a.accountId, { mapId: 'market', position: { x: -3, y: 0, z: -26 } });
  await f.call(a, { type: 'npc', targetId: 'shepherd', text: 'Какой корм нужен?' });
  expect(f.service.state(a).replies[0]?.text).toContain('white goat');
  expect(f.service.state(f.people[1]!).replies).toEqual([]); expect(f.service.state(a).inventory.dates).toBe(0);
});
it('rejects unbounded, malformed and authoritative fields at the shared boundary', () => {
  for (const action of [{ type: 'languages', native: 'ru', learning: 'ru' }, { type: 'carve', drawing: [[[Infinity, 0]]] }, { type: 'carve', drawing: Array(65).fill([[0, 0]]) }, { type: 'buy', item: 'dates', targetId: 'fruit-seller', playerId: 'victim' }]) expect(() => parseBabylonRequest({ v: 2, requestId: 'r', action })).toThrow();
});

it('four roles share one FIFO with legacy NPC work, reject a second generation per player and preserve privacy', async () => {
  const f = fixture(), [a, b, c, d] = f.people as [PlayerIdentity, PlayerIdentity, PlayerIdentity, PlayerIdentity];
  for (const p of f.people) await f.call(p, { type: 'enroll', size: 4, native: 'ru', learning: 'en' });
  const order: string[] = []; let release!: () => void;
  const legacy = f.queue.generate(a.playerId, 'legacy', async () => { order.push('legacy'); await new Promise<void>(resolve => { release = resolve; }); return 'reply'; });
  const requests = [b, c, d].map(p => f.call(p, { type: 'suggest', word: 'goat' }).then(value => { order.push(p.playerId); return value; }));
  await expect(f.call(a, { type: 'suggest', word: 'goat' })).rejects.toMatchObject({ code: 'RATE_LIMIT' });
  expect(await f.queue.generate('fifth', 'fifth', async () => 'no')).toMatchObject({ ok: false, reason: 'server-busy' });
  release(); await legacy; await Promise.all(requests);
  expect(order).toEqual(['legacy', b.playerId, c.playerId, d.playerId]);
  f.positions.set(a.accountId, { mapId: 'market', position: { x: -4.5, y: 0, z: .5 } });
  await expect(f.call(a, { type: 'buy', item: 'dates', targetId: 'fruit-seller' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  f.positions.set(b.accountId, { mapId: 'market', position: { x: -3, y: 0, z: -26 } });
  await expect(f.call(b, { type: 'npc', targetId: 'shepherd', text: 'Список' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  for (const p of f.people) expect(parseBabylonResult({ v: 2, requestId: 'state', state: f.service.state(p) }).state.party?.role).toBe(f.people.indexOf(p) + 1);
});

it('rolls back both inventory and operation receipt when SQLite commit fails', async () => {
  const f = fixture(), a = f.people[0]!;
  await f.call(a, { type: 'enroll', size: 1, native: 'ru', learning: 'en' });
  f.positions.set(a.accountId, { mapId: 'market', position: { x: -4.5, y: 0, z: .5 } });
  f.db.exec("CREATE TRIGGER reject_receipt BEFORE INSERT ON babel_operations BEGIN SELECT RAISE(ABORT, 'fixture'); END");
  const buy = { type: 'buy' as const, item: 'dates' as const, targetId: 'fruit-seller' };
  await expect(f.call(a, buy, 'atomic')).rejects.toThrow('fixture');
  expect(f.service.state(a).inventory.dates).toBe(0);
  f.db.exec('DROP TRIGGER reject_receipt');
  await f.call(a, buy, 'atomic'); expect(f.service.state(a).inventory.dates).toBe(1);
});

it('bounds the dictionary, keeps editing possible at capacity and acknowledges the role spawn once', async () => {
  const f = fixture(), a = f.people[0]!;
  await f.call(a, { type: 'enroll', size: 1, native: 'ru', learning: 'en' });
  expect(f.service.spawn(a.playerId)?.force).toBe(true); f.service.entered(a.playerId); f.restart(); expect(f.service.spawn(a.playerId)?.force).toBe(false);
  for (let i = 0; i < 64; i++) await f.call(a, { type: 'word-save', word: `word${i}`, translation: 'слово', note: '' });
  await expect(f.call(a, { type: 'word-save', word: 'extra', translation: 'лишнее', note: '' })).rejects.toMatchObject({ code: 'INVALID' });
  const first = f.service.state(a).words[0]!;
  const result = await f.call(a, { type: 'word-save', id: first.id, word: 'changed', translation: 'правка', note: '' });
  expect(parseBabylonResult(result).state.words).toHaveLength(64);
  expect(() => parseBabylonResult({ ...result, state: { ...result.state, inventory: { ...result.state.inventory, dates: -1 } } })).toThrow();
});
