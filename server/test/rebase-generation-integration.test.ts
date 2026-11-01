import { afterEach, expect, it, vi } from 'vitest';
import { createNpcDialogueService } from '../src/npc/NpcDialogueService.ts';
import type { NpcResponder, PartialAnswer } from '../src/npc/NpcResponder.ts';
import { systemScheduler } from '../src/common/time.ts';
import { memoryLogger } from '../src/common/logger.ts';
import { memoryStores } from './memory.ts';
import { answerRequest } from './responderContract.ts';

const q = (id = 'p', requestId = 'r', connectionId = 'c') => ({ sessionId: 'test-session', authorize: () => true, connectionId, requestId,
  player: { accountId: 'a' + id, playerId: id, displayName: 'Игрок' }, npc: answerRequest().npc, question: 'Вопрос' });
afterEach(() => vi.useRealTimers());
function setup(responder: NpcResponder, timeoutMs = 30000) {
  const store = memoryStores(), logger = memoryLogger();
  const npc = createNpcDialogueService({ responder, dialogue: store.dialogue, logger, clock: { now: () => Date.now() }, scheduler: systemScheduler }, { maxConcurrent: 1, maxUnfinished: 4, timeoutMs });
  return { npc, store, logger };
}

it('shares the player and unfinished quotas with Babylon and retains cancelled physical work', async () => {
  vi.useFakeTimers(); let finish!: (v: { text: string }) => void;
  const responder: NpcResponder = { async start() {}, async stop() {}, answer: () => new Promise(resolve => { finish = resolve; }) };
  const { npc, store } = setup(responder); await npc.start();
  const first = npc.ask(q());
  const work = vi.fn(async () => 'Перевод');
  expect(await npc.generate('p', 'babel:session', work, { kind: 'chat' })).toEqual({ ok: false, reason: 'player-busy' });
  const queued = ['p2', 'p3', 'p4'].map(id => npc.generate(id, 'babel:' + id, work, { kind: 'chat' }));
  expect(npc.state()).toEqual({ running: 1, queued: 3, unfinished: 4 });
  expect(await npc.ask(q('p5'))).toEqual({ ok: false, reason: 'server-busy' });
  npc.cancel('c', 'r'); expect(await first).toEqual({ ok: false, reason: 'cancelled' });
  expect(npc.state()).toEqual({ running: 1, queued: 3, unfinished: 4 });
  await vi.advanceTimersByTimeAsync(2000); expect(work).not.toHaveBeenCalled();
  finish({ text: 'Поздний' }); await vi.advanceTimersByTimeAsync(0);
  expect((await Promise.all(queued)).every(result => result.ok)).toBe(true);
  expect(store.dialogue.history('p', 'n', 'test-session')).toEqual([]); expect(npc.state().unfinished).toBe(0);
  await npc.stop();
});

it('a failed NPC runtime clears queued NPC work but does not disable Babylon language work', async () => {
  let status: 'ready' | 'unavailable' = 'ready'; let fail!: (error: Error) => void;
  const responder: NpcResponder = { async start() {}, async stop() {}, status: () => status,
    answer: vi.fn(() => new Promise<{ text: string }>((_resolve, reject) => { fail = reject; })) };
  const { npc } = setup(responder); await npc.start();
  const first = npc.ask(q()); const queuedNpc = npc.ask(q('p2'));
  const babel = npc.generate('p3', 'babel:session', async () => 'Перевод', { kind: 'chat' });
  status = 'unavailable'; fail(new Error('private model path'));
  expect(await first).toEqual({ ok: false, reason: 'unavailable' });
  expect(await queuedNpc).toEqual({ ok: false, reason: 'unavailable' });
  expect(await babel).toEqual({ ok: true, text: 'Перевод' });
  expect(responder.answer).toHaveBeenCalledTimes(1); expect(npc.ready()).toBe(false);
  await npc.stop();
});

it('attempts only one recovery after failure, including repeated admissions, without replay', async () => {
  vi.useFakeTimers(); let starts = 0;
  const responder: NpcResponder = { async start() { starts++; throw new Error('private startup'); }, async stop() {},
    status: () => 'unavailable', answer: vi.fn(async () => ({ text: 'must not run' })) };
  const { npc, logger } = setup(responder); await npc.start();
  for (let i = 0; i < 3; i++) await npc.ask(q());
  await vi.advanceTimersByTimeAsync(2000); expect(starts).toBe(2);
  for (let i = 0; i < 3; i++) await npc.ask(q());
  await vi.advanceTimersByTimeAsync(30000); expect(starts).toBe(2);
  expect(responder.answer).not.toHaveBeenCalled(); expect(JSON.stringify(logger.records)).not.toContain('private');
  await npc.stop();
});

it('suppresses partials after settlement, and does not turn private diagnostics into wire text', async () => {
  let emit!: PartialAnswer;
  const responder: NpcResponder = { async start() {}, async stop() {},
    diagnostics: () => ({ stage: 'decoding', elapsedMs: 1, outputChunks: 1 }),
    async answer(_request, _signal, onPartial) { emit = onPartial!; return { text: 'Готово' }; } };
  const { npc } = setup(responder); await npc.start(); const partial = vi.fn();
  expect(await npc.ask(q(), partial)).toEqual({ ok: true, text: 'Готово' });
  emit('Поздний текст'); expect(partial).not.toHaveBeenCalled();
  await npc.stop();
});
