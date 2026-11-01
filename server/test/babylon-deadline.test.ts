import { afterEach, expect, it, vi } from 'vitest';
import { PASTURE_ORIGIN } from '../../shared/city/catalogue.ts';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase, sqliteStores } from '../src/persistence/database.ts';
import { sqliteBabylon } from '../src/persistence/babylon.ts';
import { BabylonService } from '../src/babylon/BabylonService.ts';
import type { Generate, LanguagePort } from '../src/babylon/ports.ts';
import { testLanguagePort } from '../src/babylon/TestLanguagePort.ts';
import { createGenerationQueue } from '../src/npc/GenerationQueue.ts';
import type { TimerHandle } from '../src/common/time.ts';
import { memoryLogger } from '../src/common/logger.ts';
import type { BabylonAction } from '../../shared/babylon/types.ts';
import { parseBabylonRequest } from '../../shared/babylon/validate.ts';

const dbs: DatabaseSync[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

async function fixture() {
  const db = openDatabase(':memory:'); dbs.push(db);
  const accounts = sqliteStores(db).accounts;
  const [sender, recipient] = ['Sender', 'Recipient'].map(name => accounts.findOrCreate(name, name.toLowerCase(), 1));
  if (!sender || !recipient) throw new Error('Missing fixture identities');
  const state = { wall: 100000, mono: 0 };
  const timers = new Map<TimerHandle, () => void>();
  const logger = memoryLogger();
  const queue = createGenerationQueue({ clock: { now: () => state.wall, monotonicNow: () => state.mono },
    scheduler: { setTimeout(callback) { const handle = {} as TimerHandle; timers.set(handle, callback); return handle; }, clearTimeout(handle) { timers.delete(handle); } }, logger,
  }, { maxConcurrent: 1, maxUnfinished: 4, timeoutMs: 1000 });
  // No timer callback is delivered. Only explicit clock checks can reject a late commit.
  const translated = deferred<string>(), translationStarted = deferred<void>();
  const cleanup = deferred<void>();
  const language: LanguagePort = { ...testLanguagePort,
    async translate() { translationStarted.resolve(); return translated.promise; },
    async answer() { translationStarted.resolve(); return translated.promise; },
  };
  let signal!: AbortSignal;
  // Simulate a runtime that needs physical cleanup after its work rejects. The real queue owns the slot throughout.
  const generate: Generate = (playerId, connectionId, work, options) => queue.generate(playerId, connectionId, async (abort, deadline, budget) => {
    signal = abort;
    try { return await work(abort, deadline, budget); }
    finally { await cleanup.promise; }
  }, options);
  const store = sqliteBabylon(db); let ids = 0;
  const service = new BabylonService({ store, language, generate, now: () => state.wall, monotonicNow: () => state.mono, id: () => `id${++ids}`,
    location: () => ({ mapId: 'market', position: { x: -3, y: 0, z: PASTURE_ORIGIN.z + 6 } }),
  });
  for (const [index, person] of [sender, recipient].entries()) await service.handle(person,
    parseBabylonRequest({ v: 2, requestId: `enroll${index}`, action: { type: 'enroll', size: 2, native: 'ru', learning: 'en' } }), 'enroll');
  const call = (action: BabylonAction, authorize?: () => Promise<boolean>) => service.handle(sender,
    parseBabylonRequest({ v: 2, requestId: 'late', action }), 'babel:sender', authorize, { sessionId: 'test-session', isActive: () => true });
  return { db, sender, recipient, state, timers, logger, queue, service, store, call, translated, translationStarted, cleanup, language, signal: () => signal };
}

const actions: BabylonAction[] = [
  { type: 'chat', text: 'Купи финики' },
  { type: 'suggest', word: 'goat' },
  { type: 'npc', targetId: 'shepherd', text: 'Какой корм нужен?' },
];
for (const action of actions) it.each(['translation', 'authorization'] as const)(`${action.type}: rejects a late %s after wall rollback before any terminal commit`, async phase => {
  const f = await fixture();
  const authorizationStarted = deferred<void>(), authorized = deferred<boolean>();
  let authorizationChecks = 0;
  const authorize = vi.fn(async () => {
    if (++authorizationChecks === 1) return true; // Dispatch check must not consume the terminal-authorization fixture.
    authorizationStarted.resolve();
    return phase === 'authorization' ? authorized.promise : true;
  });
  const pending = f.call(action, authorize);
  const rejected = expect(pending).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  await f.translationStarted.promise;
  expect(f.queue.state()).toEqual({ queued: 0, running: 1, unfinished: 1 });
  if (phase === 'translation') {
    f.state.wall -= 60000; f.state.mono = 1000;
    f.translated.resolve('Translated fixture answer');
  } else {
    f.state.mono = 900; f.state.wall += 900;
    f.translated.resolve('Translated fixture answer');
    await authorizationStarted.promise;
    // Translation was in budget, but authorization consumed the final 100 ms while the wall clock rolled back.
    expect(f.store.operation(f.sender.playerId, 'late')?.status).toBe('pending');
    f.state.wall -= 60000; f.state.mono = 1000;
    authorized.resolve(true);
  }
  await rejected;
  expect(authorize).toHaveBeenCalledTimes(2);
  expect(f.signal().aborted).toBe(true);
  expect(f.store.operation(f.sender.playerId, 'late')).toMatchObject({ status: 'failed' });
  expect(f.store.operation(f.sender.playerId, 'late')?.suggestion).toBeUndefined();
  expect(f.service.state(f.recipient).messages).toEqual([]);
  expect(f.service.state(f.sender).replies).toEqual([]);
  expect(f.service.state(f.recipient).replies).toEqual([]);
  expect(f.db.prepare('SELECT count(*) AS n FROM npc_dialogue').get()!.n).toBe(0);
  if (action.type === 'chat') expect(f.service.state(f.sender).messages[0]?.status).toBe('error');
  expect(f.logger.records.some(record => record.event === 'npc.request.completed')).toBe(false);
  // A player-facing timeout is not proof of physical stop.
  expect(f.queue.state()).toEqual({ queued: 0, running: 1, unfinished: 1 });
  expect(await f.queue.generate(f.sender.playerId, 'retry', async () => 'must not run')).toEqual({ ok: false, reason: 'player-busy' });
  const nextWork = vi.fn(async () => 'next');
  const next = f.queue.generate(f.recipient.playerId, 'other', nextWork);
  expect(nextWork).not.toHaveBeenCalled();
  f.cleanup.resolve(); expect(await next).toEqual({ ok: true, text: 'next' });
  await flush(); expect(f.queue.state().unfinished).toBe(0); expect(f.timers.size).toBe(0);
  expect(f.store.operation(f.sender.playerId, 'late')?.status).toBe('failed');
  expect(f.service.state(f.recipient).messages).toEqual([]); expect(f.service.state(f.sender).replies).toEqual([]);
  f.queue.stop();
});

for (const action of actions) it(`BABEL ${action.type}: admission authorization cannot restore time after monotonic expiry`, async () => {
  const f = await fixture(), allowed = deferred<boolean>();
  const translate = vi.spyOn(f.language, 'translate'), answer = vi.spyOn(f.language, 'answer');
  const pending = f.call(action, async () => allowed.promise);
  const rejected = expect(pending).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  await flush(); f.state.mono = 1000; f.state.wall -= 60000; allowed.resolve(true);
  await rejected; expect(f.signal().aborted).toBe(true);
  expect(translate).not.toHaveBeenCalled(); expect(answer).not.toHaveBeenCalled();
  expect(f.queue.state().unfinished).toBe(1);
  f.cleanup.resolve(); await flush(); expect(f.queue.state().unfinished).toBe(0);
  f.queue.stop();
});

for (const phase of ['dispatch', 'terminal'] as const) it(`no-translation chat keeps a monotonic budget across ${phase} authorization without an LLM slot`, async () => {
  const f = await fixture(), authorized = deferred<boolean>(), entered = deferred<void>();
  const profile = f.store.profile(f.sender.playerId)!, party = f.store.party(profile.groupId!)!;
  party.size = 1; party.members = party.members.filter(m => m.id === f.sender.playerId); f.store.saveParty(party);
  const translate = vi.spyOn(f.language, 'translate'); let checks = 0;
  const pending = f.call({ type: 'chat', text: 'solo' }, async () => {
    if (phase === 'terminal' && ++checks === 1) return true;
    entered.resolve(); return authorized.promise;
  });
  const rejected = expect(pending).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  await entered.promise; expect(f.queue.state().unfinished).toBe(0);
  f.state.mono = 8000; f.state.wall -= 60000; authorized.resolve(true);
  await rejected; expect(translate).not.toHaveBeenCalled();
  expect(f.store.operation(f.sender.playerId, 'late')?.status).not.toBe('complete');
  expect(f.queue.state().unfinished).toBe(0); f.queue.stop();
});
