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
function fixture(language: LanguagePort = testLanguagePort, withPeerLocation = true) {
  const dir = mkdtempSync(join(tmpdir(), 'babel-')); dirs.push(dir);
  const path = join(dir, 'game.sqlite'); let db = openDatabase(path); dbs.push(db);
  const stores = sqliteStores(db), people = ['A', 'B', 'C', 'D'].map(name => stores.accounts.findOrCreate(name, name, 1));
  const positions = new Map<string, BabylonLocation>();
  const peerPositions = new Map<string, BabylonLocation>(), peerQueries: string[] = [];
  const queue = createGenerationQueue({ clock: systemClock, scheduler: systemScheduler, logger: silentLogger }, { maxConcurrent: 1, maxUnfinished: 4, timeoutMs: 8000 });
  let ids = 0, requests = 0;
  const make = () => new BabylonService({ store: sqliteBabylon(db), language, generate: queue.generate, now: Date.now, monotonicNow: () => performance.now(), id: () => `id${++ids}`, location: id => positions.get(id) ?? null, ...(withPeerLocation ? { peerLocation: (playerId: string) => { peerQueries.push(playerId); return peerPositions.get(playerId) ?? null; } } : {}) });
  let service = make();
  return { people, positions, peerPositions, peerQueries, queue, get service() { return service; }, get db() { return db; },
    call: (player: PlayerIdentity, action: BabylonAction, requestId = `request${++requests}`) => service.handle(player, parseBabylonRequest({ v: 2, requestId, action }), player.playerId, undefined, { sessionId: 'test-session', isActive: () => true }),
    restart() { db.close(); db = openDatabase(path); dbs.push(db); service = make(); },
  };
}
it('exposes only current task peers and queries no nonmember or self coordinates', async () => {
  const f = fixture(), [a, b, c, d] = f.people as [PlayerIdentity, PlayerIdentity, PlayerIdentity, PlayerIdentity];
  for (const person of f.people) f.peerPositions.set(person.playerId, { mapId: 'market', position: { x: 1000, y: 50, z: -500 } });
  expect(f.service.state(a).partyPositions).toEqual([]); expect(f.peerQueries).toEqual([]);
  for (const person of f.people) await f.call(person, { type: 'enroll', size: 2, native: 'ru', learning: 'en' });
  f.peerQueries.length = 0;
  const state = f.service.state(a);
  expect(state.partyPositions).toEqual([{ id: b.playerId, name: b.displayName, x: 1000, z: -500 }]);
  expect(f.peerQueries).toEqual([b.playerId]);
  expect(f.service.state(c).partyPositions).toEqual([{ id: d.playerId, name: d.displayName, x: 1000, z: -500 }]);
  expect(f.service.state(b).goatGuide).toBeNull();
  f.peerPositions.set(b.playerId, { mapId: 'market', position: { x: 800, y: 0, z: -600 } });
  expect((await f.call(a, { type: 'state' })).state.partyPositions[0]).toMatchObject({ x: 800, z: -600 });
  f.peerPositions.delete(b.playerId);
  expect(f.service.state(a).partyPositions).toEqual([]);
});

it('bounds party positions and omits absent, non-market or invalid locations without fallback', async () => {
  const f = fixture(), [a, b, c, d] = f.people as [PlayerIdentity, PlayerIdentity, PlayerIdentity, PlayerIdentity];
  for (const person of f.people) await f.call(person, { type: 'enroll', size: 4, native: 'ru', learning: 'en' });
  for (const person of f.people) f.peerPositions.set(person.playerId, { mapId: 'market', position: { x: 10, y: 0, z: 20 } });
  expect(f.service.state(a).partyPositions).toHaveLength(3);
  f.peerPositions.set(b.playerId, { mapId: 'demo', position: { x: 1, y: 0, z: 2 } });
  f.peerPositions.set(c.playerId, { mapId: 'market', position: { x: Infinity, y: 0, z: 2 } });
  f.peerPositions.set(d.playerId, { mapId: 'market', position: { x: 1, y: 0, z: 1_000_001 } });
  // The own/account location cannot be used as a substitute for a missing peer.
  f.positions.set(a.accountId, { mapId: 'market', position: { x: 99, y: 0, z: 99 } });
  expect(f.service.state(a).partyPositions).toEqual([]);
  const optional = fixture(testLanguagePort, false);
  for (const person of optional.people) await optional.call(person, { type: 'enroll', size: 4, native: 'ru', learning: 'en' });
  expect(optional.service.state(optional.people[0]!).partyPositions).toEqual([]);
});

it('strictly validates bounded party positions, membership, uniqueness and finite coordinates', async () => {
  const f = fixture(), [a, b] = f.people as [PlayerIdentity, PlayerIdentity];
  const before = f.service.state(a);
  const peer = { id: b.playerId, name: b.displayName, x: 0, z: -30 };
  const parse = (state: unknown) => parseBabylonResult({ v: 2, requestId: 'r', state });
  expect(() => parse({ ...before, partyPositions: [peer] })).toThrow();
  for (const person of [a, b]) await f.call(person, { type: 'enroll', size: 2, native: 'ru', learning: 'en' });
  const state = f.service.state(a);
  expect(parse({ ...state, partyPositions: [peer] }).state.partyPositions).toEqual([peer]);
  for (const partyPositions of [
    undefined, null, {}, [peer, peer], Array(5).fill(peer),
    [{ ...peer, id: a.playerId, name: a.displayName }], [{ ...peer, id: 'outsider' }],
    [{ ...peer, name: 'forged' }], [{ ...peer, x: NaN }], [{ ...peer, x: Infinity }],
    [{ ...peer, x: 1_000_001 }], [{ ...peer, z: '0' }], [{ ...peer, y: 0 }],
    [{ ...peer, mapId: 'market' }], [{ ...peer, accountId: 'secret' }],
  ]) expect(() => parse({ ...state, partyPositions })).toThrow();
  expect(() => parse({ ...state, party: null, partyPositions: [peer] })).toThrow();
});

it('enrolls a fixed group, starts only when full, restores roles/languages and hides private dictionary data', async () => {
  const f = fixture(), [a, b, c] = f.people as [PlayerIdentity, PlayerIdentity, PlayerIdentity, PlayerIdentity];
  await f.call(a, { type: 'enroll', size: 2, native: 'ru', learning: 'en' });
  expect(f.service.state(a).party?.started).toBe(false); expect(f.service.state(a).taskTarget).toBeNull();
  await expect(f.call(b, { type: 'enroll', size: 3, native: 'ru', learning: 'es' })).rejects.toMatchObject({ code: 'CONFLICT' });
  await f.call(b, { type: 'enroll', size: 2, native: 'ru', learning: 'es' });
  expect(f.service.state(a).party?.started).toBe(true); expect(f.service.state(b).goatGuide).toBeNull();
  expect(f.service.spawn(a.playerId)?.position.z).toBe(-58); expect(f.service.spawn(b.playerId)?.position.z).toBe(8);
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
it('upgrades legacy dictionary entries without data loss and persists private examples and learned receipts', async () => {
  const f = fixture(), [a, b] = f.people as [PlayerIdentity, PlayerIdentity];
  for (const p of [a, b]) await f.call(p, { type: 'enroll', size: 2, native: 'ru', learning: 'en' });
  const saved = await f.call(a, { type: 'word-save', word: 'goat', translation: 'коза', note: 'note' });
  const id = saved.state.words[0]!.id;
  const row = f.db.prepare('SELECT state FROM babel_profiles WHERE player_id = ?').get(a.playerId)!;
  const legacy = JSON.parse(String(row.state));
  delete legacy.words[0].learned; delete legacy.words[0].example; delete legacy.words[0].exampleTranslation;
  f.db.prepare('UPDATE babel_profiles SET state = ? WHERE player_id = ?').run(JSON.stringify(legacy), a.playerId);
  f.restart();
  expect(f.service.state(a).words[0]).toMatchObject({ id, word: 'goat', translation: 'коза', note: 'note', learned: false, example: '', exampleTranslation: '' });
  await f.call(a, { type: 'word-save', id, word: 'goat', translation: 'коза', note: 'note', example: 'A goat', exampleTranslation: 'Коза' });
  await f.call(a, { type: 'word-learn', id, learned: true }, 'learn-once');
  await f.call(a, { type: 'word-save', id, word: 'kid', translation: 'козлёнок', note: 'edited' });
  f.restart();
  expect(f.service.state(a).words[0]).toMatchObject({ word: 'kid', note: 'edited', learned: true, example: 'A goat', exampleTranslation: 'Коза' });
  await f.call(a, { type: 'word-learn', id, learned: true }, 'learn-once');
  await expect(f.call(a, { type: 'word-learn', id, learned: false }, 'learn-once')).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(f.call(b, { type: 'word-learn', id, learned: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(f.service.state(b).words).toEqual([]);
  f.db.exec("CREATE TRIGGER reject_learn_receipt BEFORE INSERT ON babel_operations BEGIN SELECT RAISE(ABORT, 'fixture'); END");
  await expect(f.call(a, { type: 'word-learn', id, learned: false }, 'rollback-learn')).rejects.toThrow('fixture');
  expect(f.service.state(a).words[0]!.learned).toBe(true);
  f.db.exec('DROP TRIGGER reject_learn_receipt');
  await f.call(a, { type: 'word-learn', id, learned: false }, 'rollback-learn');
  expect(f.service.state(a).words[0]!.learned).toBe(false);
  await f.call(a, { type: 'word-save', id, word: 'kid', translation: 'козлёнок', note: '', example: '', exampleTranslation: '' });
  expect(f.service.state(a).words[0]).toMatchObject({ example: '', exampleTranslation: '' });
});

it('rejects item coercion rather than returning a non-string ItemId', () => {
  for (const type of ['buy', 'feed']) {
    for (const item of [['dates'], ['water'], {}, null, 42, true]) expect(() => parseBabylonRequest({ v: 2, requestId: 'strict-item', action: { type, item, targetId: 'target' } })).toThrow();
    expect(parseBabylonRequest({ v: 2, requestId: 'strict-item', action: { type, item: 'dates', targetId: 'target' } }).action).toEqual({ type, item: 'dates', targetId: 'target' });
  }
});

it('validates dictionary additions and serves prepared titles in the learning language', async () => {
  for (const action of [
    { type: 'word-learn', id: 'x', learned: 1 }, { type: 'word-learn', id: 'x', learned: true, playerId: 'x' },
    { type: 'word-save', word: 'x', translation: 'y', note: '', example: 'x'.repeat(501) },
    { type: 'word-save', word: 'x', translation: 'y', note: '', exampleTranslation: 1 },
  ]) expect(() => parseBabylonRequest({ v: 2, requestId: 'r', action })).toThrow();
  const f = fixture(), a = f.people[0]!;
  expect(f.service.state(a).taskTitle).toBe(''); expect(f.service.state(a).taskTarget).toBeNull();
  await f.call(a, { type: 'enroll', size: 1, native: 'ru', learning: 'en' });
  expect(f.service.state(a).taskTitle).toBe('The Shepherd’s Goats'); expect(f.service.state(a).taskTarget).toEqual({ x: 0, z: -34 });
  await f.call(a, { type: 'languages', native: 'ru', learning: 'es' });
  expect(f.service.state(a).taskTitle).toBe('Las cabras del pastor');
  await f.call(a, { type: 'languages', native: 'en', learning: 'ru' });
  const state = f.service.state(a); expect(state.taskTitle).toBe('Козы пастуха'); expect(state.fed).toHaveLength(0);
  expect(parseBabylonResult({ v: 2, requestId: 'r', state }).state.taskTitle).toBe('Козы пастуха');
  expect(() => parseBabylonResult({ v: 2, requestId: 'r', state: { ...state, taskTitle: null } })).toThrow();
  for (const taskTarget of [{ x: 1e7, z: 0 }, { x: 0, z: NaN }, { x: 0, z: 0, mapId: 'market' }]) expect(() => parseBabylonResult({ v: 2, requestId: 'r', state: { ...state, taskTarget } })).toThrow();
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
  f.positions.set(a.accountId, { mapId: 'market', position: { x: 4, y: 0, z: -64 } });
  await f.call(a, { type: 'feed', item: 'dates', targetId: 'black-goat' }); expect(f.service.state(a).inventory.dates).toBe(1);
  const feed = [['white-goat', 'dates', -5, -63], ['black-goat', 'red-fruit', 4, -64], ['spotted-goat', 'yellow-fruit', -4, -69], ['kid-goat', 'water', 4, -69]] as const;
  for (const [targetId, item, x, z] of feed) { f.positions.set(a.accountId, { mapId: 'market', position: { x, y: 0, z } }); await f.call(a, { type: 'feed', item, targetId }); }
  f.restart(); expect(f.service.state(a).party?.completed).toBe(true); expect(f.service.state(a).taskTarget).toBeNull(); expect(f.service.state(a).fed).toHaveLength(4); expect(f.service.state(a).inventory.dates).toBe(0);
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
  f.positions.set(a.accountId, { mapId: 'market', position: { x: -3, y: 0, z: -58 } });
  await f.call(a, { type: 'npc', targetId: 'shepherd', text: 'Какой корм нужен?' });
  expect(f.service.state(a, { sessionId: 'test-session', isActive: () => true }).replies[0]?.text).toContain('white goat');
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
  f.positions.set(b.accountId, { mapId: 'market', position: { x: -3, y: 0, z: -58 } });
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

it('persists hub preferences before enrollment and separates create from join without losing progress', async () => {
  const f = fixture(), [a, b] = f.people as [PlayerIdentity, PlayerIdentity];
  await expect(f.call(a, { type: 'create', size: 2 })).rejects.toThrow('профиле');
  await f.call(a, { type: 'languages', native: 'ru', learning: 'es' });
  expect(f.service.enrolled(a.playerId)).toBe(false);
  f.restart();
  expect(f.service.state(a).profile).toEqual({ native: 'ru', learning: 'es' });
  expect(f.service.state(a).party).toBeNull();
  await expect(f.call(a, { type: 'join' })).rejects.toThrow('Нет игры');
  const created = await f.call(a, { type: 'create', size: 2 }, 'create-once');
  expect((await f.call(a, { type: 'create', size: 2 }, 'create-once')).state.party?.id).toBe(created.state.party?.id);
  await f.call(b, { type: 'languages', native: 'ru', learning: 'en' });
  const joined = await f.call(b, { type: 'join' });
  expect(joined.state.party).toMatchObject({ id: created.state.party?.id, size: 2, count: 2 });
  await expect(f.call(a, { type: 'create', size: 1 })).rejects.toThrow('уже есть игра');
  expect((await f.call(a, { type: 'join' })).state.party?.count).toBe(2);
  f.restart();
  expect(f.service.state(a).party?.id).toBe(created.state.party?.id);
});

it('creates an independent solo beside a foreign waiting group and durably deduplicates it', async () => {
  const f = fixture(), [a, b, c] = f.people as [PlayerIdentity, PlayerIdentity, PlayerIdentity];
  for (const person of [a, b, c]) await f.call(person, { type: 'languages', native: 'ru', learning: 'en' });
  const waiting = (await f.call(a, { type: 'create', size: 3 })).state.party!;
  const foreign = sqliteBabylon(f.db).party(waiting.id);
  const action = { type: 'create' as const, size: 1 as const };
  const solo = (await f.call(b, action, 'independent-solo')).state;
  expect(solo.party).toMatchObject({ size: 1, count: 1, started: true });
  expect(solo.party!.id).not.toBe(waiting.id);
  expect(solo.availableParty).toEqual({ size: 3, count: 1 });
  expect(sqliteBabylon(f.db).party(waiting.id)).toEqual(foreign);
  f.restart();
  expect((await f.call(b, action, 'independent-solo')).state.party!.id).toBe(solo.party!.id);
  expect(sqliteBabylon(f.db).party(waiting.id)).toEqual(foreign);
  expect(f.db.prepare('SELECT count(*) AS n FROM babel_parties').get()!.n).toBe(2);
  expect((await f.call(c, { type: 'join' })).state.party).toMatchObject({ id: waiting.id, count: 2, started: false });
});

it.each([1, 2] as const)('replaces an own shared waiting group with size %s without losing remaining members or progress', async size => {
  const f = fixture(), [a, b] = f.people as [PlayerIdentity, PlayerIdentity];
  for (const person of [a, b]) await f.call(person, { type: 'languages', native: 'ru', learning: 'en' });
  const waiting = (await f.call(a, { type: 'create', size: 3 })).state.party!;
  await f.call(b, { type: 'join' });
  for (const person of [a, b]) await f.call(person, { type: 'word-save', word: 'goat', translation: 'коза', note: person.displayName });
  const old = sqliteBabylon(f.db).party(waiting.id)!;
  const action = { type: 'create' as const, size, replacePartyId: waiting.id };
  const solo = (await f.call(a, action, 'leave-waiting')).state;
  expect(solo.party).toMatchObject({ size, count: 1, started: size === 1 });
  expect(solo.words[0]).toMatchObject({ word: 'goat', note: a.displayName });
  f.restart();
  expect((await f.call(a, action, 'leave-waiting')).state.party!.id).toBe(solo.party!.id);
  const remaining = f.service.state(b);
  expect(remaining.party).toMatchObject({ id: waiting.id, size: 3, count: 1, role: 2, started: false });
  expect(remaining.words[0]).toMatchObject({ word: 'goat', note: b.displayName });
  expect(sqliteBabylon(f.db).party(waiting.id)).toEqual({ ...old, members: old.members.filter(member => member.id === b.playerId), inventory: { [b.playerId]: old.inventory[b.playerId] } });
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});

it.each([{ replacing: false, size: 1 }, { replacing: true, size: 1 }, { replacing: false, size: 3 }, { replacing: true, size: 3 }] as const)('rolls back independent creation and permits durable retry (replacement=$replacing,size=$size)', async ({ replacing, size }) => {
  const f = fixture(), [a, b] = f.people as [PlayerIdentity, PlayerIdentity];
  for (const person of [a, b]) await f.call(person, { type: 'languages', native: 'ru', learning: 'en' });
  await f.call(a, { type: 'create', size: 3 });
  const previous = replacing ? (await f.call(b, { type: 'create', size: 1 })).state.party! : null;
  const profiles = f.db.prepare('SELECT * FROM babel_profiles ORDER BY player_id').all();
  const parties = f.db.prepare('SELECT * FROM babel_parties ORDER BY id').all();
  const action = { type: 'create' as const, size, ...(previous ? { replacePartyId: previous.id } : {}) };
  f.db.exec("CREATE TRIGGER reject_solo BEFORE INSERT ON babel_operations BEGIN SELECT RAISE(ABORT, 'solo commit failed'); END");
  await expect(f.call(b, action, 'solo-rollback')).rejects.toThrow('solo commit failed');
  expect(f.db.prepare('SELECT * FROM babel_profiles ORDER BY player_id').all()).toEqual(profiles);
  expect(f.db.prepare('SELECT * FROM babel_parties ORDER BY id').all()).toEqual(parties);
  f.db.exec('DROP TRIGGER reject_solo');
  f.restart();
  const solo = (await f.call(b, action, 'solo-rollback')).state.party!;
  expect(solo).toMatchObject({ size, started: size === 1 });
  f.restart();
  expect((await f.call(b, action, 'solo-rollback')).state.party!.id).toBe(solo.id);
  expect(f.db.prepare('SELECT count(*) AS n FROM babel_parties').get()!.n).toBe(2);
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});

it('lists independent waiting groups, rejects ambiguous enrollment and joins only the selected group', async () => {
  const f = fixture(), [a, b, c, d] = f.people as [PlayerIdentity, PlayerIdentity, PlayerIdentity, PlayerIdentity];
  for (const person of f.people) await f.call(person, { type: 'languages', native: 'ru', learning: 'en' });
  const first = (await f.call(a, { type: 'create', size: 3 })).state.party!;
  const second = (await f.call(b, { type: 'create', size: 2 })).state.party!;
  const initial = f.service.state(c);
  expect(initial.availableParty).toBeNull();
  expect(initial.availableParties).toEqual([
    { id: second.id, hostName: b.displayName, size: 2, count: 1 },
    { id: first.id, hostName: a.displayName, size: 3, count: 1 },
  ]);
  expect(parseBabylonResult({ v: 2, requestId: 'available', state: initial }).state.availableParties).toEqual(initial.availableParties);
  await expect(f.call(c, { type: 'join' })).rejects.toMatchObject({ code: 'CONFLICT', message: 'Выберите группу для подключения.' });
  await expect(f.call(c, { type: 'enroll', size: 3, native: 'ru', learning: 'en' })).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(f.service.state(c).party).toBeNull();
  expect((await f.call(a, { type: 'join' })).state.party!.id).toBe(first.id);
  await expect(f.call(a, { type: 'join', partyId: second.id })).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(f.service.state(a).party!.id).toBe(first.id);
  const action = { type: 'join' as const, partyId: second.id };
  expect((await f.call(c, action, 'selected-join')).state.party).toMatchObject({ id: second.id, role: 2, started: true });
  f.restart();
  expect((await f.call(c, action, 'selected-join')).state.party!.id).toBe(second.id);
  await expect(f.call(c, { type: 'join', partyId: first.id }, 'selected-join')).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(f.call(d, action)).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(f.call(d, { type: 'join', partyId: 'missing-party' })).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(f.service.state(d).party).toBeNull();
  expect((await f.call(d, { type: 'join' })).state.party).toMatchObject({ id: first.id, size: 3, count: 2, role: 2 });
  expect(f.service.state(b).party!.members.map(member => member.id)).toEqual([b.playerId, c.playerId]);
});

it('bounds available groups and rejects malformed or ambiguous discovery packets', async () => {
  const f = fixture(), a = f.people[0]!;
  await f.call(a, { type: 'enroll', size: 2, native: 'ru', learning: 'en' });
  const initial = f.service.state(a), candidate = initial.availableParties[0]!;
  const parse = (availableParties: unknown, availableParty: unknown = null) => parseBabylonResult({ v: 2, requestId: 'validate', state: { ...initial, availableParties, availableParty } });
  for (const available of [undefined, null, {}, [candidate, candidate], Array(65).fill(candidate), [{ ...candidate, id: '' }], [{ ...candidate, hostName: '' }], [{ ...candidate, size: 1 }], [{ ...candidate, count: 0 }], [{ ...candidate, count: 2 }], [{ ...candidate, password: 'secret' }]]) expect(() => parse(available)).toThrow();
  expect(() => parse([candidate])).toThrow();
  expect(() => parse([], initial.availableParty)).toThrow();
  for (const partyId of ['', null, 7, 'bad id']) expect(() => parseBabylonRequest({ v: 2, requestId: 'join', action: { type: 'join', partyId } })).toThrow();
  const store = sqliteBabylon(f.db), original = store.party(candidate.id)!;
  for (let index = 0; index < 70; index++) store.saveParty({ ...original, id: `waiting-${index}` });
  const bounded = f.service.state(a);
  expect(bounded.availableParties).toHaveLength(64);
  expect(bounded.availableParties[0]!.id).toBe('waiting-69');
  expect(bounded.availableParties.at(-1)!.id).toBe('waiting-6');
  expect(bounded.availableParty).toBeNull();
  expect(bounded.availablePartiesTruncated).toBe(true);
  expect(parseBabylonResult({ v: 2, requestId: 'bounded', state: bounded }).state.availableParties).toHaveLength(64);
});

it('atomically replaces solo with multiplayer and back, preserving personal words and deduplicating retries', async () => {
  const f = fixture(), a = f.people[0]!;
  const initial = await f.call(a, { type: 'enroll', size: 1, native: 'ru', learning: 'es' });
  const oldId = initial.state.party!.id;
  await f.call(a, { type: 'word-save', word: 'goat', translation: 'коза', note: 'личное' });
  f.positions.set(a.accountId, { mapId: 'market', position: { x: -4.5, y: 0, z: .5 } });
  await f.call(a, { type: 'buy', item: 'dates', targetId: 'fruit-seller' });
  const action = { type: 'create' as const, size: 2 as const, replacePartyId: oldId };
  const next = await f.call(a, action, 'replace-once');
  expect(next.state.party).toMatchObject({ size: 2, count: 1, started: false });
  expect(next.state.party!.id).not.toBe(oldId);
  expect(next.state.profile).toEqual(initial.state.profile);
  expect(next.state.words[0]).toMatchObject({ word: 'goat', note: 'личное' });
  expect(next.state.inventory.dates).toBe(0);
  expect(sqliteBabylon(f.db).party(oldId)).toBeNull();
  f.restart();
  expect((await f.call(a, action, 'replace-once')).state.party!.id).toBe(next.state.party!.id);
  await expect(f.call(a, action)).rejects.toMatchObject({ code: 'CONFLICT' });
  const solo = await f.call(a, { type: 'create', size: 1, replacePartyId: next.state.party!.id });
  expect(solo.state.party).toMatchObject({ size: 1, started: true });
  expect(sqliteBabylon(f.db).party(next.state.party!.id)).toBeNull();
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  expect(f.service.spawn(a.playerId)?.force).toBe(true);
});

it('keeps the old game on a stale confirmation or failed SQLite commit and permits independent multiplayer replacement', async () => {
  const f = fixture(), [a, b] = f.people as [PlayerIdentity, PlayerIdentity];
  const initial = await f.call(a, { type: 'enroll', size: 1, native: 'ru', learning: 'en' });
  const oldId = initial.state.party!.id;
  await expect(f.call(a, { type: 'create', size: 2, replacePartyId: 'foreign-id' })).rejects.toMatchObject({ code: 'CONFLICT' });
  f.db.exec("CREATE TRIGGER reject_replace BEFORE INSERT ON babel_operations BEGIN SELECT RAISE(ABORT, 'replacement failed'); END");
  const action = { type: 'create' as const, size: 2 as const, replacePartyId: oldId };
  await expect(f.call(a, action)).rejects.toThrow('replacement failed');
  f.db.exec('DROP TRIGGER reject_replace');
  expect(f.service.state(a).party!.id).toBe(oldId);
  expect(f.db.prepare('SELECT count(*) AS n FROM babel_parties').get()!.n).toBe(1);
  const waiting = await f.call(b, { type: 'enroll', size: 2, native: 'ru', learning: 'en' });
  expect((await f.call(a, action)).state.party).toMatchObject({ size: 2, started: false });
  expect(f.service.state(a).party!.id).not.toBe(oldId);
  expect(f.service.state(b).party!.id).toBe(waiting.state.party!.id);
  expect(() => parseBabylonRequest({ v: 2, requestId: 'invalid', action: { ...action, replacePartyId: true } })).toThrow();
});

it('replacing a shared game preserves the remaining player and their stored progress', async () => {
  const f = fixture(), [a, b] = f.people as [PlayerIdentity, PlayerIdentity];
  for (const person of [a, b]) await f.call(person, { type: 'enroll', size: 2, native: 'ru', learning: 'en' });
  const old = f.service.state(b);
  f.positions.set(b.accountId, { mapId: 'market', position: { x: -4.5, y: 0, z: .5 } });
  await f.call(b, { type: 'buy', item: 'dates', targetId: 'fruit-seller' });
  await f.call(a, { type: 'create', size: 1, replacePartyId: old.party!.id });
  f.restart();
  expect(f.service.state(b).party).toMatchObject({ id: old.party!.id, count: 1, role: 2, started: true });
  expect(f.service.state(b).inventory.dates).toBe(1);
  expect(f.service.state(b).party!.members.map(member => member.id)).toEqual([b.playerId]);
});

it('ignores an NPC answer that finishes after replacing its game', async () => {
  let release!: (answer: string) => void, started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const language = { ...testLanguagePort, answer: () => { started(); return new Promise<string>(resolve => { release = resolve; }); } };
  const f = fixture(language), a = f.people[0]!;
  const initial = await f.call(a, { type: 'enroll', size: 1, native: 'ru', learning: 'en' });
  f.positions.set(a.accountId, { mapId: 'market', position: { x: -4.5, y: 0, z: .5 } });
  const pending = f.call(a, { type: 'npc', targetId: 'fruit-seller', text: 'Hello' }).then(() => null, error => error);
  await entered;
  await f.call(a, { type: 'create', size: 1, replacePartyId: initial.state.party!.id });
  release('old answer');
  expect(await pending).toBeInstanceOf(Error);
  expect(f.service.state(a, { sessionId: 'test-session', isActive: () => true }).replies).toEqual([]);
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
