import { afterEach, expect, it, vi } from 'vitest';
import { PASTURE_ORIGIN } from '../../shared/city/catalogue.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAuthService } from '../src/auth/AuthService.ts';
import { openDatabase, sqliteStores, transaction } from '../src/persistence/database.ts';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations, loadMigrations } from '../src/persistence/migrate.ts';
import { createHash } from 'node:crypto';
import { sqliteBabylon } from '../src/persistence/babylon.ts';
import { createNpcDialogueService } from '../src/npc/NpcDialogueService.ts';
import { BabylonService } from '../src/babylon/BabylonService.ts';
import { testLanguagePort } from '../src/babylon/TestLanguagePort.ts';
import type { LanguagePort, NpcSessionScope } from '../src/babylon/ports.ts';
import type { PlayerIdentity } from '../src/contracts.ts';
import type { BabylonAction } from '../../shared/babylon/types.ts';
import { parseBabylonRequest } from '../../shared/babylon/validate.ts';
import { silentLogger } from '../src/common/logger.ts';
import { systemScheduler } from '../src/common/time.ts';
import { answerRequest } from './responderContract.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
interface Caller { identity: PlayerIdentity; scope: NpcSessionScope; token: string }
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'npc-session-')), path = join(root, 'game.sqlite');
  let db = openDatabase(path), stores = sqliteStores(db), now = 1000, ids = 0;
  const clock = { now: () => now };
  let auth = createAuthService({ ...stores, clock, ttlMs: 10000 });
  const answer = vi.fn(async (q: Parameters<import('../src/npc/NpcResponder.ts').NpcResponder['answer']>[0]) => ({ text: 'answer:' + q.question }));
  const language: LanguagePort = { ...testLanguagePort, answer: vi.fn(async (_npc, question) => 'babel:' + question) };
  const makeNpc = () => createNpcDialogueService({ responder: { async start() {}, async stop() {}, answer }, dialogue: stores.dialogue, clock, scheduler: systemScheduler, logger: silentLogger }, { maxConcurrent: 1, maxUnfinished: 4, timeoutMs: 8000 });
  let npc = makeNpc(); await npc.start();
  let location = { mapId: 'market', position: { x: 4.6, y: 0, z: -.5 } };
  const makeBabel = () => new BabylonService({ store: sqliteBabylon(db), language, generate: npc.generate, now: clock.now, monotonicNow: () => performance.now(), id: () => `id${++ids}`, location: () => location });
  let babel = makeBabel();
  const login = async (name: string): Promise<Caller> => {
    const { token } = await auth.guest(name), verified = await auth.verify(token);
    if (!verified.ok || !verified.sessionId) throw new Error('Missing fixture AUTH');
    const sessionId = verified.sessionId, identity = verified.identity;
    return { token, identity, scope: { sessionId, isActive: () => auth.isActive(sessionId, identity.playerId) } };
  };
  const first = await login('First'), second = await login('First'), other = await login('Other');
  const call = (c: Caller, action: BabylonAction, requestId = `r${++ids}`, authorize = async () => true) => babel.handle(c.identity, parseBabylonRequest({ v: 2, requestId, action }), 'babel:' + c.scope.sessionId, authorize, c.scope);
  const ask = (c: Caller, question: string, npcId = 'n') => npc.ask({ sessionId: c.scope.sessionId, authorize: c.scope.isActive, connectionId: c.scope.sessionId, requestId: `r${++ids}`, player: c.identity, npc: { ...answerRequest().npc, id: npcId }, question });
  cleanups.push(async () => { await npc.stop(); db.close(); rmSync(root, { recursive: true, force: true }); });
  return { first, second, other, login, call, ask, answer, language, get db() { return db; }, get stores() { return stores; }, get auth() { return auth; }, get babel() { return babel; }, get npc() { return npc; },
    advance(ms: number) { now += ms; }, move(x: number, z: number) { location = { mapId: 'market', position: { x, y: 0, z } }; },
    async restart() { await npc.stop(); db.close(); db = openDatabase(path); stores = sqliteStores(db); auth = createAuthService({ ...stores, clock, ttlMs: 10000 }); npc = makeNpc(); await npc.start(); babel = makeBabel(); },
  };
}

it('ordinary history isolates AUTH/player/NPC before retrieval and survives restart with the same valid session', async () => {
  const f = await fixture();
  await f.ask(f.first, 'private'); await f.ask(f.second, 'second'); await f.ask(f.other, 'other'); await f.ask(f.first, 'different-npc', 'n2');
  expect(f.answer.mock.calls.map(([q]) => q.history)).toEqual([[], [], [], []]);
  await f.restart(); await f.ask(f.first, 'return');
  expect(f.answer.mock.lastCall![0].history).toEqual([{ question: 'private', answer: 'answer:private' }]);
  await f.ask(await f.login('First'), 'new-login'); expect(f.answer.mock.lastCall![0].history).toEqual([]);
  expect(f.stores.dialogue.history(f.first.identity.playerId, 'n', '')).toEqual([]);
});

it('BABEL polling and saved replay use caller scope while preserving account game data and same-session restart', async () => {
  const f = await fixture();
  await f.call(f.first, { type: 'enroll', size: 1, native: 'ru', learning: 'en' });
  await f.call(f.first, { type: 'word-save', word: 'water', translation: 'вода', note: '' }, 'word');
  await f.call(f.first, { type: 'buy', targetId: 'potter', item: 'water' });
  await f.call(f.first, { type: 'npc', targetId: 'potter', text: 'private' }, 'npc-old');
  expect((await f.call(f.second, { type: 'state' })).state.replies).toEqual([]);
  const replay = await f.call(f.second, { type: 'word-save', word: 'water', translation: 'вода', note: '' }, 'word');
  expect(replay.state.replies).toEqual([]); expect(replay.state.words).toHaveLength(1); expect(replay.state.inventory.water).toBe(1);
  expect(replay.state.profile).toEqual({ native: 'ru', learning: 'en' }); expect(replay.state.party?.completed).toBe(false);
  await expect(f.call(f.second, { type: 'npc', targetId: 'potter', text: 'private' }, 'npc-old')).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(f.language.answer).toHaveBeenCalledTimes(1);
  await f.restart();
  expect((await f.call(f.first, { type: 'npc', targetId: 'potter', text: 'private' }, 'npc-old')).state.replies).toHaveLength(1);
  expect(f.language.answer).toHaveBeenCalledTimes(1);
  await f.call(f.second, { type: 'npc', targetId: 'potter', text: 'second' });
  expect(vi.mocked(f.language.answer).mock.lastCall![3]).toEqual([]);
  await f.call(f.first, { type: 'npc', targetId: 'potter', text: 'return' });
  expect(vi.mocked(f.language.answer).mock.lastCall![3].map(r => r.question)).toEqual(['private']);
});

it('shared pending non-NPC operation rebuilds each session snapshot and rechecks each caller authorization', async () => {
  const f = await fixture(); await f.call(f.first, { type: 'enroll', size: 1, native: 'ru', learning: 'en' });
  await f.call(f.first, { type: 'npc', targetId: 'potter', text: 'first-secret' });
  await f.call(f.second, { type: 'npc', targetId: 'potter', text: 'second-secret' });
  const started = deferred<void>(), translated = deferred<string>();
  f.language.translate = vi.fn(async () => { started.resolve(); return translated.promise; });
  const one = f.call(f.first, { type: 'suggest', word: 'water' }, 'shared'); await started.promise;
  const authorize = vi.fn(async () => true);
  const two = f.call(f.second, { type: 'suggest', word: 'water' }, 'shared', authorize);
  let allowed = true;
  const denied = f.call(f.second, { type: 'suggest', word: 'water' }, 'shared', async () => allowed);
  const failure = expect(denied).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  allowed = false; translated.resolve('вода');
  expect((await one).state.replies.map(r => r.question)).toEqual(['first-secret']);
  expect((await two).state.replies.map(r => r.question)).toEqual(['second-secret']);
  await failure; expect(authorize).toHaveBeenCalledOnce(); expect(f.language.translate).toHaveBeenCalledOnce();
  const replay = await f.call(f.second, { type: 'suggest', word: 'water' }, 'shared');
  expect(replay.state.replies.map(r => r.question)).toEqual(['second-secret']); expect(f.language.translate).toHaveBeenCalledOnce();
});

it.each(['control', 'distance', 'expiry'] as const)('queued BABEL NPC rechecks %s before calling LanguagePort', async loss => {
  const f = await fixture(); await f.call(f.first, { type: 'enroll', size: 1, native: 'ru', learning: 'en' });
  const held = deferred<string>(); const running = f.npc.generate(f.other.identity.playerId, 'blocker', async () => held.promise);
  let allowed = true;
  const pending = f.call(f.first, { type: 'npc', targetId: 'potter', text: 'queued' }, 'queued', async () => allowed);
  const rejected = expect(pending).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  if (loss === 'control') allowed = false;
  if (loss === 'distance') f.move(100, 100);
  if (loss === 'expiry') f.advance(10001);
  held.resolve('done'); await running; await rejected;
  expect(f.language.answer).not.toHaveBeenCalled(); expect(f.db.prepare('SELECT count(*) AS n FROM babel_npc_dialogue').get()!.n).toBe(0);
});

it.each(['logout', 'expiry'] as const)('late results cannot commit or appear after AUTH %s', async reason => {
  const f = await fixture(); await f.call(f.first, { type: 'enroll', size: 1, native: 'ru', learning: 'en' });
  const held = deferred<string>(), started = deferred<void>();
  f.language.answer = vi.fn(async () => { started.resolve(); return held.promise; });
  const pending = f.call(f.first, { type: 'npc', targetId: 'potter', text: 'late' });
  const failure = expect(pending).rejects.toMatchObject({ code: 'UNAVAILABLE' }); await started.promise;
  if (reason === 'logout') f.auth.logout(f.first.token); else f.advance(10001);
  held.resolve('must not persist'); await failure;
  await expect(f.call(f.first, { type: 'state' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  const fresh = await f.login('First'); expect((await f.call(fresh, { type: 'state' })).state.replies).toEqual([]);
  const calls = f.answer.mock.calls.length; expect((await f.ask(f.first, 'invalid')).ok).toBe(false); expect(f.answer.mock.calls).toHaveLength(calls);
  expect(f.db.prepare('SELECT count(*) AS n FROM babel_npc_dialogue').get()!.n).toBe(0);
});

it('NPC completed replay and delivery recheck range after caller authorization, without changing state polling', async () => {
  const f = await fixture(); await f.call(f.first, { type: 'enroll', size: 1, native: 'ru', learning: 'en' });
  const action = { type: 'npc' as const, targetId: 'potter', text: 'private' };
  await f.call(f.first, action, 'completed'); f.move(100, 100);
  expect((await f.call(f.first, { type: 'state' })).state.replies).toHaveLength(1);
  await expect(f.call(f.first, action, 'completed')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  f.move(4.6, -.5);
  await expect(f.call(f.first, action, 'completed', async () => { f.move(100, 100); return true; })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(f.language.answer).toHaveBeenCalledTimes(1);
});

it('queued NPC role loss prevents LanguagePort execution', async () => {
  const f = await fixture();
  await f.call(f.first, { type: 'enroll', size: 2, native: 'ru', learning: 'en' });
  await f.call(f.other, { type: 'enroll', size: 2, native: 'ru', learning: 'en' }); f.move(-3, PASTURE_ORIGIN.z + 6);
  const held = deferred<string>(), running = f.npc.generate(f.other.identity.playerId, 'blocker', async () => held.promise);
  const pending = f.call(f.first, { type: 'npc', targetId: 'shepherd', text: 'queued' });
  const failure = expect(pending).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  const store = sqliteBabylon(f.db), profile = store.profile(f.first.identity.playerId)!, party = store.party(profile.groupId!)!;
  party.members.find(m => m.id === f.first.identity.playerId)!.role = 2; store.saveParty(party);
  held.resolve('done'); await running; await failure; expect(f.language.answer).not.toHaveBeenCalled();
});

it('temporary inherited rolling windows stay aggregate across repeated AUTH sessions, not per-session quotas', async () => {
  const f = await fixture(), pid = f.first.identity.playerId;
  await f.call(f.first, { type: 'enroll', size: 1, native: 'ru', learning: 'en' });
  // Unknown-provenance data remains inaccessible, but later writes can retire it under the inherited rolling rule.
  f.db.prepare('INSERT INTO npc_dialogue (player_id, npc_id, question, answer, created_at) VALUES (?, ?, ?, ?, ?)').run(pid, 'n', 'legacy', 'legacy', 0);
  const store = sqliteBabylon(f.db), p = store.profile(pid)!;
  p.replies = Array.from({ length: 50 }, (_, i) => ({ id: `old${i}`, npcId: 'potter', question: 'legacy', text: 'legacy', language: 'en' as const })); store.saveProfile(pid, p);
  for (let i = 0; i < 55; i++) {
    const sessionId = `scope${i}`;
    f.stores.dialogue.append(pid, 'n', `q${i}`, 'a', i + 1, sessionId);
    store.transaction(() => store.appendNpcReply(pid, sessionId, { id: `new${i}`, npcId: i % 2 ? 'potter' : 'shepherd', question: 'q', text: 'a', language: 'en' }));
    expect(Number(f.db.prepare('SELECT count(*) AS n FROM npc_dialogue WHERE player_id = ? AND npc_id = ?').get(pid, 'n')!.n)).toBeLessThanOrEqual(50);
    const scoped = Number(f.db.prepare('SELECT count(*) AS n FROM babel_npc_dialogue WHERE player_id = ?').get(pid)!.n);
    expect(scoped + store.profile(pid)!.replies.length).toBeLessThanOrEqual(50);
  }
  expect(f.stores.dialogue.history(pid, 'n', 'scope0')).toEqual([]);
  expect(f.stores.dialogue.history(pid, 'n', 'scope54')).toHaveLength(1);
  expect(store.npcReplies(pid, 'scope0')).toEqual([]); expect(store.npcReplies(pid, 'scope54')).toHaveLength(1);
  expect(store.profile(pid)!.native).toBe('ru');
});

it('migration preserves legacy data without guessing AUTH ownership, and legacy NPC replay fails closed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'npc-legacy-')), path = join(root, 'old.sqlite');
  const old = new DatabaseSync(path); old.exec('PRAGMA foreign_keys = ON');
  const migrations = loadMigrations();
  // The historical NPC branch used version 3 for auth, before main renumbered it to 7.
  transaction(old, () => applyMigrations(old, [...migrations.slice(0, 2), { version: 3, sql: migrations[6]!.sql }], 1));
  const before = sqliteStores(old), identity = before.accounts.findOrCreate('Legacy', 'legacy', 1);
  old.prepare('INSERT INTO npc_dialogue (player_id, npc_id, question, answer, created_at) VALUES (?, ?, ?, ?, ?)').run(identity.playerId, 'n', 'legacy-question', 'legacy-answer', 1);
  const make = (db: DatabaseSync) => new BabylonService({ store: sqliteBabylon(db), language: testLanguagePort, generate: async () => ({ ok: false, reason: 'unavailable' }), now: () => 1000, monotonicNow: () => performance.now(), id: () => 'group', location: () => ({ mapId: 'market', position: { x: 4.6, y: 0, z: -.5 } }) });
  await make(old).handle(identity, parseBabylonRequest({ v: 2, requestId: 'enroll', action: { type: 'enroll', size: 1, native: 'ru', learning: 'en' } }), 'legacy');
  const legacyStore = sqliteBabylon(old), profile = legacyStore.profile(identity.playerId)!;
  profile.replies.push({ id: 'old-npc', npcId: 'potter', question: 'old-private', text: 'old-private-answer', language: 'en' });
  legacyStore.saveProfile(identity.playerId, profile);
  const action = { type: 'npc', targetId: 'potter', text: 'old-private' };
  legacyStore.saveOperation(identity.playerId, 'old-npc', { fingerprint: createHash('sha256').update(JSON.stringify(action)).digest('hex'), status: 'complete' });
  old.close();
  const db = openDatabase(path);
  try {
    const stores = sqliteStores(db), auth = createAuthService({ ...stores, clock: { now: () => 1000 }, ttlMs: 10000 });
    const session = await auth.guest('Legacy'), verified = await auth.verify(session.token);
    if (!verified.ok || !verified.sessionId) throw new Error('AUTH');
    const scope = { sessionId: verified.sessionId, isActive: () => auth.isActive(verified.sessionId!, identity.playerId) };
    expect(db.prepare('SELECT session_id, question, answer FROM npc_dialogue').get()).toEqual({ session_id: null, question: 'legacy-question', answer: 'legacy-answer' });
    expect(stores.dialogue.history(identity.playerId, 'n', scope.sessionId)).toEqual([]);
    expect(sqliteBabylon(db).profile(identity.playerId)!.replies[0]!.text).toBe('old-private-answer');
    expect(sqliteBabylon(db).operation(identity.playerId, 'old-npc')!.status).toBe('complete');
    const service = make(db);
    expect(service.state(identity, scope).replies).toEqual([]);
    await expect(service.handle(identity, parseBabylonRequest({ v: 2, requestId: 'old-npc', action }), 'new', undefined, scope)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(service.state(identity, scope).profile).toEqual({ native: 'ru', learning: 'en' });
    stores.sessions.prune(100000); // AUTH row removal must not fail on new history references.
    expect(scope.isActive()).toBe(false);
    expect(() => service.state(identity, scope)).toThrow();
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});
