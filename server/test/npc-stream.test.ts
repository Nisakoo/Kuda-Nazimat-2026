import { afterEach, expect, it, vi } from 'vitest';
import { PartialThrottle } from '../src/realtime/PartialThrottle.ts';
import { createNpcDialogueService } from '../src/npc/NpcDialogueService.ts';
import { scripted } from '../src/npc/adapters/scripted.ts';
import { systemClock, systemScheduler } from '../src/common/time.ts';
import { silentLogger } from '../src/common/logger.ts';
import type { NpcQuestion } from '../src/contracts.ts';
import type { NpcResponder, PartialAnswer } from '../src/npc/NpcResponder.ts';
import { memoryStores } from './memory.ts';
import { answerRequest } from './responderContract.ts';

const deps = { clock: systemClock, scheduler: systemScheduler };
afterEach(() => vi.useRealTimers());
const question = (requestId = 'r', connectionId = 'c'): NpcQuestion => ({ sessionId: 'test-session', authorize: () => true, connectionId, requestId, player: { accountId: 'a', playerId: 'p', displayName: 'Аня' }, npc: answerRequest().npc, question: 'Расскажи' });

it('throttle sends the newest text at most once per interval, skips repeats and stops cleanly (PROTO-007)', async () => {
  vi.useFakeTimers(); const sent: [number, string][] = [];
  const throttle = new PartialThrottle(systemScheduler, 100, (seq, text) => sent.push([seq, text]));
  throttle.push('a'); throttle.push('ab'); throttle.push('abc');
  expect(sent).toEqual([[1, 'a']]);
  await vi.advanceTimersByTimeAsync(100); expect(sent).toEqual([[1, 'a'], [2, 'abc']]);
  throttle.push('abc'); await vi.advanceTimersByTimeAsync(300); expect(sent).toHaveLength(2);
  throttle.push('abcd'); throttle.stop(); throttle.push('abcde'); await vi.advanceTimersByTimeAsync(300);
  expect(sent).toEqual([[1, 'a'], [2, 'abc'], [3, 'abcd']]);
});

it('scripted streams growing prefixes before the final text and nothing after abort', async () => {
  vi.useFakeTimers(); const responder = scripted({ delayMs: 400 }, deps); await responder.start();
  const partials: string[] = [];
  const answer = responder.answer(answerRequest(), new AbortController().signal, (text) => partials.push(text));
  await vi.advanceTimersByTimeAsync(400); const { text } = await answer;
  expect(partials).toHaveLength(3);
  for (const [i, partial] of partials.entries()) { expect(text.startsWith(partial)).toBe(true); if (i) expect(partial.length).toBeGreaterThan(partials[i - 1]!.length); }
  const controller = new AbortController(); const late: string[] = [];
  const aborted = responder.answer(answerRequest(), controller.signal, (t) => late.push(t)); const rejected = expect(aborted).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(150); controller.abort(); await vi.advanceTimersByTimeAsync(400); await rejected;
  expect(late).toHaveLength(1); await responder.stop();
});

it('service normalizes partials, silences them after cancel, cancels one question and uses the stream deadline', async () => {
  vi.useFakeTimers(); let emit!: PartialAnswer; let finish!: (v: { text: string }) => void; let deadline = 0;
  const responder: NpcResponder = { async start() {}, async stop() {}, answer: (request, _signal, onPartial) => { deadline = request.deadlineAt; emit = onPartial!; return new Promise((resolve) => { finish = resolve; }); } };
  const stores = memoryStores();
  const npc = createNpcDialogueService({ ...deps, responder, dialogue: stores.dialogue, logger: silentLogger }, { maxConcurrent: 1, maxUnfinished: 4, timeoutMs: 8000, streamTimeoutMs: 30000 });
  await npc.start(); const partials: string[] = [];
  const started = Date.now(); const pending = npc.ask(question(), (text) => partials.push(text));
  await vi.advanceTimersByTimeAsync(0); expect(deadline - started).toBe(30000);
  emit(' Первая\x07 часть '); emit('   '); expect(partials).toEqual(['Первая часть']);
  await vi.advanceTimersByTimeAsync(9000); emit('Ещё жив'); expect(partials).toHaveLength(2);
  npc.cancel('c', 'other'); npc.cancel('other', 'r'); emit('Всё ещё'); expect(partials).toHaveLength(3);
  npc.cancel('c', 'r'); expect(await pending).toEqual({ ok: false, reason: 'cancelled' });
  emit('Поздно'); finish({ text: 'Поздно' }); await vi.advanceTimersByTimeAsync(0);
  expect(partials).toHaveLength(3); expect(stores.dialogue.history('p', 'n', 'test-session')).toHaveLength(0);
  // The cancelled question no longer holds the player's slot; an unstreamed one keeps the short deadline.
  const asked = Date.now(); const next = npc.ask(question('next')); await vi.advanceTimersByTimeAsync(0);
  expect(deadline - asked).toBe(8000); await npc.stop(); expect(await next).toEqual({ ok: false, reason: 'cancelled' });
});
