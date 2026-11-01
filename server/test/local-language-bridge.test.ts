import { afterEach, expect, it, vi } from 'vitest';
import { openDatabase, sqliteStores } from '../src/persistence/database.ts';
import { sqliteBabylon } from '../src/persistence/babylon.ts';
import { createAuthService } from '../src/auth/AuthService.ts';
import { createNpcDialogueService } from '../src/npc/NpcDialogueService.ts';
import type { NpcAnswerRequest, LocalTranslationRequest, NpcResponder } from '../src/npc/NpcResponder.ts';
import { BabylonService } from '../src/babylon/BabylonService.ts';
import { createLanguagePort } from '../src/babylon/adapters.ts';
import { parseConfig } from '../src/app/config.ts';
import { parseBabylonRequest } from '../../shared/babylon/validate.ts';
import type { BabylonAction } from '../../shared/babylon/types.ts';
import type { TimerHandle } from '../src/common/time.ts';
import { silentLogger } from '../src/common/logger.ts';
import { NPCS, localNpcPromptProfile } from '../src/babylon/content.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

async function fixture() {
  const db = openDatabase(':memory:'), stores = sqliteStores(db);
  const state = { wall: 100000, mono: 0, healthy: false };
  const clock = { now: () => state.wall, monotonicNow: () => state.mono };
  const timers = new Map<TimerHandle, { callback(): void; ms: number }>();
  const scheduler = {
    setTimeout(callback: () => void, ms: number) { const handle = {} as TimerHandle; timers.set(handle, { callback, ms }); return handle; },
    clearTimeout(handle: TimerHandle) { timers.delete(handle); },
  };
  const responder = {
    start: vi.fn(async () => { state.healthy = true; }), stop: vi.fn(async () => { state.healthy = false; }),
    status: () => state.healthy ? 'ready' as const : 'unavailable' as const,
    answer: vi.fn(async (q: NpcAnswerRequest, _signal: AbortSignal) => ({ text: `${q.locale}:${q.question}` })),
    translate: vi.fn(async (q: LocalTranslationRequest, _signal: AbortSignal) => ({ text: `${q.target}:${q.text}` })),
  } satisfies NpcResponder;
  const npc = createNpcDialogueService({ responder, dialogue: stores.dialogue, clock, scheduler, logger: silentLogger }, { maxConcurrent: 1, maxUnfinished: 4, timeoutMs: 1000 });
  await npc.start();
  const language = createLanguagePort('local', {}, { responder, ready: npc.ready, observeRuntimeFailure: npc.observeRuntimeFailure });
  const store = sqliteBabylon(db); let ids = 0;
  let location = { mapId: 'market', position: { x: 4.6, y: 0, z: -.5 } };
  const babel = new BabylonService({ store, language, generate: npc.generate, now: clock.now, monotonicNow: clock.monotonicNow, id: () => `b${++ids}`, location: () => location });
  const auth = createAuthService({ ...stores, clock, ttlMs: 10000, passwordless: true });
  const login = async (name: string) => {
    const { token } = await auth.guest(name), verified = await auth.verify(token);
    if (!verified.ok || !verified.sessionId) throw new Error('Missing AUTH');
    const { identity, sessionId } = verified;
    return { identity, scope: { sessionId, isActive: () => auth.isActive(sessionId, identity.playerId) } };
  };
  const people = await Promise.all(['Sender', 'English', 'Spanish'].map(login));
  type Caller = (typeof people)[number];
  const call = (person: Caller, action: BabylonAction, authorize = async () => true, requestId = `r${++ids}`) => babel.handle(person.identity,
    parseBabylonRequest({ v: 2, requestId, action }), 'babel:' + person.scope.sessionId, authorize, person.scope);
  for (const [i, person] of people.entries()) await call(person, { type: 'enroll', size: 3, native: 'ru', learning: i === 2 ? 'es' : 'en' });
  cleanups.push(async () => { await npc.stop(); db.close(); });
  return { db, stores, auth, state, responder, npc, language, store, babel, people, call, login, timers,
    move() { location = { mapId: 'market', position: { x: 100, y: 0, z: 100 } }; },
  };
}

it('borrows answer/translation from one responder, fixes learning language and projects only scoped history', async () => {
  const f = await fixture(), person = f.people[0]!;
  expect(f.language.start).toBeUndefined(); expect(f.language.stop).toBeUndefined();
  await f.call(person, { type: 'npc', targetId: 'potter', text: 'first' });
  await f.call(person, { type: 'languages', native: 'ru', learning: 'es' });
  const reply = await f.call(person, { type: 'npc', targetId: 'potter', text: 'second' });
  expect(reply.state.replies.at(-1)).toMatchObject({ language: 'es', text: 'es:second' });
  expect(f.responder.answer.mock.calls[1]![0]).toMatchObject({ locale: 'es', playerId: person.identity.playerId, playerName: person.identity.displayName, history: [{ question: 'first', answer: 'en:first' }] });
  const newLogin = await f.login('Sender');
  await f.call(newLogin, { type: 'npc', targetId: 'potter', text: 'new session' });
  expect(f.responder.answer.mock.calls[2]![0].history).toEqual([]);
  await f.call(person, { type: 'suggest', word: 'water' });
  const translation = f.responder.translate.mock.calls[0]![0];
  expect(translation).toMatchObject({ text: 'water', source: 'es', target: 'ru' });
  expect(Object.keys(translation).sort()).toEqual(['deadlineAt', 'requestKey', 'source', 'target', 'text']);
  expect(f.responder.start).toHaveBeenCalledTimes(1); expect(f.responder.stop).not.toHaveBeenCalled();
  await f.npc.stop(); expect(f.responder.stop).toHaveBeenCalledTimes(1);
});

it.each(['en', 'es'] as const)('projects only the public %s role for every NPC', async language => {
  const f = await fixture();
  const expected = {
    'fruit-seller': language === 'en' ? ['fruit', 'dates'] : ['fruta', 'dátiles'],
    'fabric-seller': language === 'en' ? ['cloth', 'patterns'] : ['telas', 'diseños'],
    potter: language === 'en' ? ['clay', 'water'] : ['barro', 'agua'],
    shepherd: language === 'en' ? ['shepherd', 'goats'] : ['pastor', 'cabras'],
  };
  const before = structuredClone(NPCS);
  const person = f.people[0]!;
  const context = { sessionId: person.scope.sessionId, player: person.identity, requestId: 'profile', requestKey: 'profile',
    budget: { expired: () => false, deadlineAt: () => 101000 }, isActive: () => true, authorize: async () => true };
  for (const [id, words] of Object.entries(expected)) {
    // Even extra caller fields are not passed to the model.
    const npc = { ...NPCS[id]!, privateGuide: 'secret goat guide', extra: 'private' };
    await f.language.answer(npc, 'hello', language, [], new AbortController().signal, context);
    const projected = f.responder.answer.mock.lastCall![0].npc;
    expect(projected).toEqual(localNpcPromptProfile(id, language));
    expect(projected).not.toBe(npc);
    expect(Object.keys(projected).sort()).toEqual(['greeting', 'id', 'name', 'persona', 'topic']);
    const text = JSON.stringify(projected).toLowerCase();
    for (const word of words) expect(text).toContain(word);
    expect(text).not.toMatch(/secret|guide|private|белая|white goat|cabra blanca|researcher|student/);
    expect(projected.persona).toMatch(language === 'en' ? /^I am / : /^Soy /);
    const otherRoles = language === 'en'
      ? { 'fruit-seller': ['fabric seller', 'potter', 'shepherd'], 'fabric-seller': ['fruit seller', 'potter', 'shepherd'], potter: ['fruit seller', 'fabric seller', 'shepherd'], shepherd: ['fruit seller', 'fabric seller', 'potter'] }
      : { 'fruit-seller': ['vendedora de telas', 'alfarero', 'pastor'], 'fabric-seller': ['vendedor de fruta', 'alfarero', 'pastor'], potter: ['vendedor de fruta', 'vendedora de telas', 'pastor'], shepherd: ['vendedor de fruta', 'vendedora de telas', 'alfarero'] };
    for (const role of otherRoles[id as keyof typeof otherRoles]) expect(text).not.toContain(role);
  }
  for (const [id, canonical] of Object.entries(NPCS).filter(([id]) => !(id in expected))) {
    await f.language.answer({ ...canonical, name: 'Untrusted replacement' }, 'hello', language, [], new AbortController().signal, context);
    const projected = f.responder.answer.mock.lastCall![0].npc;
    expect(projected).toMatchObject({ id, name: canonical.name, topic: canonical.topic, persona: canonical.persona });
    expect(Object.keys(projected).sort()).toEqual(['greeting', 'id', 'name', 'persona', 'topic']);
    expect(f.responder.answer.mock.lastCall![0].locale).toBe(language);
  }
  expect(NPCS).toEqual(before);
  expect(() => localNpcPromptProfile('unknown', language)).toThrow('Unknown Babylon NPC');
});

it.each(['en', 'es'] as const)('rejects a Russian NPC reply for %s without saving, retrying, or changing account data', async language => {
  const f = await fixture(), person = f.people[0]!;
  if (language === 'es') await f.call(person, { type: 'languages', native: 'ru', learning: 'es' });
  // Preserve an earlier turn and account data; a failed request must not reset either.
  await f.call(person, { type: 'npc', targetId: 'potter', text: 'earlier' });
  const history = f.store.npcReplies(person.identity.playerId, person.scope.sessionId);
  const profile = structuredClone(f.store.profile(person.identity.playerId));
  const party = structuredClone(f.store.party(profile!.groupId!));
  f.responder.answer.mockClear();
  f.responder.answer.mockResolvedValueOnce({ text: 'Здравствуйте! Я гончар, и я работаю с глиной.' });
  await expect(f.call(person, { type: 'npc', targetId: 'potter', text: 'question' })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  expect(f.responder.answer).toHaveBeenCalledTimes(1);
  expect(f.store.npcReplies(person.identity.playerId, person.scope.sessionId)).toEqual(history);
  expect(f.store.profile(person.identity.playerId)).toEqual(profile);
  expect(f.store.party(profile!.groupId!)).toEqual(party);
  expect(f.babel.state(person.identity, person.scope).replies).toEqual(history);
});

it('accepts Latin answers with Cyrillic names and leaves Russian translation alone', async () => {
  const f = await fixture(), person = f.people[0]!;
  f.responder.answer.mockResolvedValueOnce({ text: 'María and Иван ask about agua.' });
  const result = await f.call(person, { type: 'npc', targetId: 'potter', text: 'hello' });
  expect(result.state.replies.at(-1)?.text).toBe('María and Иван ask about agua.');
  await f.call(person, { type: 'languages', native: 'ru', learning: 'es' });
  f.responder.answer.mockResolvedValueOnce({ text: '¡Hola, María! Tengo agua en una jarra.' });
  expect((await f.call(person, { type: 'npc', targetId: 'potter', text: 'hola' })).state.replies.at(-1)?.text).toBe('¡Hola, María! Tengo agua en una jarra.');
  f.responder.translate.mockResolvedValueOnce({ text: 'вода' });
  expect((await f.call(person, { type: 'suggest', word: 'water' })).suggestion).toBe('вода');
});

it('holds one physical reservation across sequential languages and rejects mixed ordinary/BABEL admission', async () => {
  const f = await fixture(), person = f.people[0]!, held = deferred<{ text: string }>(), entered = deferred<void>();
  f.responder.translate.mockImplementationOnce(async () => { entered.resolve(); return held.promise; });
  const pending = f.call(person, { type: 'chat', text: 'private message' });
  await entered.promise;
  expect(f.npc.state()).toEqual({ queued: 0, running: 1, unfinished: 1 });
  expect(await f.npc.ask({ sessionId: person.scope.sessionId, authorize: person.scope.isActive, connectionId: 'ordinary', requestId: 'ordinary', player: person.identity, npc: NPCS.potter!, question: 'busy' })).toEqual({ ok: false, reason: 'player-busy' });
  held.resolve({ text: 'en:message' }); await pending;
  expect(f.responder.translate.mock.calls.map(([q]) => q.target)).toEqual(['en', 'es']);
  expect(f.npc.state().unfinished).toBe(0); expect(f.responder.answer).not.toHaveBeenCalled();
});

it('keeps the original monotonic budget through sequential translations and a wall rollback', async () => {
  const f = await fixture();
  f.responder.translate.mockImplementationOnce(async () => { f.state.mono = 600; f.state.wall -= 60000; return { text: 'first' }; });
  f.responder.translate.mockImplementationOnce(async () => { f.state.mono = 1000; return { text: 'late' }; });
  await expect(f.call(f.people[0]!, { type: 'chat', text: 'message' })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  expect(f.responder.translate.mock.calls.map(([q]) => q.deadlineAt)).toEqual([101000, 40400]);
  for (const person of f.people.slice(1)) expect(f.babel.state(person.identity, person.scope).messages).toEqual([]);
  expect(f.responder.translate).toHaveBeenCalledTimes(2);
});

it('does not reset the deadline after borrowed authorization awaits', async () => {
  const f = await fixture(), allowed = deferred<boolean>(), entered = deferred<void>(); let checks = 0;
  const pending = f.call(f.people[0]!, { type: 'suggest', word: 'water' }, async () => {
    if (++checks === 1) return true;
    entered.resolve(); return allowed.promise;
  });
  const failure = expect(pending).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  await entered.promise; f.state.mono = 1000; f.state.wall -= 60000; allowed.resolve(true);
  await failure; expect(f.responder.translate).not.toHaveBeenCalled();
});

it.each(['auth', 'range'] as const)('checks %s loss after authorization and before NPC dispatch', async loss => {
  const f = await fixture(), entered = deferred<void>(), allowed = deferred<boolean>(); let checks = 0;
  const pending = f.call(f.people[0]!, { type: 'npc', targetId: 'potter', text: 'private' }, async () => {
    if (++checks === 1) return true;
    entered.resolve(); return allowed.promise;
  });
  const failure = expect(pending).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  await entered.promise; if (loss === 'range') f.move(); allowed.resolve(loss !== 'auth');
  await failure; expect(f.responder.answer).not.toHaveBeenCalled();
});

it('stops sequential translations on access loss without delivering an earlier target', async () => {
  const f = await fixture(); let allowed = true;
  f.responder.translate.mockImplementationOnce(async () => { allowed = false; return { text: 'first' }; });
  await expect(f.call(f.people[0]!, { type: 'chat', text: 'message' }, async () => allowed)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  expect(f.responder.translate).toHaveBeenCalledTimes(1);
  for (const person of f.people.slice(1)) expect(f.babel.state(person.identity, person.scope).messages).toEqual([]);
});

it('reports borrowed runtime failure, recovers once through NPC service, and never replays failed work', async () => {
  const f = await fixture();
  f.responder.translate.mockImplementationOnce(async () => { f.state.healthy = false; throw new Error('worker stopped'); });
  await expect(f.call(f.people[0]!, { type: 'suggest', word: 'water' })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  await flush(); expect(f.language.ready!()).toBe(false); expect(f.npc.ready()).toBe(false);
  const independent = createLanguagePort('test', {});
  expect(await independent.translate('goat', 'en', 'ru', new AbortController().signal)).toBe('коза');
  const recovery = [...f.timers.values()].find(t => t.ms === 2000); expect(recovery).toBeDefined();
  recovery!.callback(); await flush();
  expect(f.language.ready!()).toBe(true); expect(f.responder.start).toHaveBeenCalledTimes(2);
  expect(f.responder.translate).toHaveBeenCalledTimes(1);
  const reply = await f.call(f.people[0]!, { type: 'npc', targetId: 'potter', text: 'new request' });
  expect(reply.state.replies.at(-1)?.text).toBe('en:new request');
});

it('rejects explicit unsupported configuration and never substitutes a test adapter', () => {
  expect(() => createLanguagePort('local', {})).toThrow('existing NPC runtime');
  const responder: NpcResponder = { async start() {}, async stop() {}, async answer() { return { text: 'scripted' }; } };
  const runtime = { responder, ready: () => true, observeRuntimeFailure() {} };
  expect(() => createLanguagePort('local', {}, runtime)).toThrow('translation-capable');
  expect(() => createLanguagePort('local', { model: 'second' }, runtime)).toThrow('language.options.model');
  expect(() => createLanguagePort('unknown', {}, runtime)).toThrow('language.adapter');
  // Launcher BACKEND/MODEL selection runs after parsing; capability validation belongs to composition.
  const pendingSelection = parseConfig({ language: { adapter: 'local' } }, '/tmp/config.json');
  expect(pendingSelection.language.adapter).toBe('local'); expect(pendingSelection.npc.adapter).toBe('scripted');
  expect(() => parseConfig({ language: { adapter: 'local', options: { model: 'second' } } }, '/tmp/config.json')).toThrow('language.options.model');
  expect(parseConfig({ language: { adapter: 'local' }, npc: { adapter: 'ollama' } }, '/tmp/config.json').language.adapter).toBe('local');
  expect(parseConfig({}, '/tmp/config.json').language.adapter).toBe('test');
  expect(createLanguagePort('test', {}, runtime).mode).toBe('test');
});
