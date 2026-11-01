import { afterEach, expect, it, vi } from 'vitest';
import { createNpcDialogueService, normalizeAnswer } from '../src/npc/NpcDialogueService.ts';
import { scripted } from '../src/npc/adapters/scripted.ts';
import { systemClock, systemScheduler, type Clock, type Scheduler, type TimerHandle } from '../src/common/time.ts';
import { silentLogger } from '../src/common/logger.ts';
import type { NpcQuestion } from '../src/contracts.ts';
import type { NpcAnswerRequest, NpcResponder } from '../src/npc/NpcResponder.ts';
import { memoryStores } from './memory.ts';
import { responderContract, answerRequest } from './responderContract.ts';
// Legacy wall-only fake clock stays deterministic under Vitest timers.
const deps = { clock: { now: systemClock.now }, scheduler: systemScheduler };
responderContract('scripted', () => scripted({ delayMs: 10 }, deps));
afterEach(() => vi.useRealTimers());
function question(id = '1', requestId = 'r'): NpcQuestion { return { connectionId: `c${id}`, requestId, player: { accountId: `a${id}`, playerId: `p${id}`, displayName: 'Аня' }, npc: answerRequest().npc, question: 'Расскажи' }; }
function service(responder: NpcResponder, options = { maxConcurrent: 1, maxUnfinished: 4, timeoutMs: 30000 }, time: { clock: Clock; scheduler: Scheduler } = deps) {
  const stores = memoryStores(); const errors: unknown[] = [];
  const npc = createNpcDialogueService({ ...time, responder, dialogue: stores.dialogue, logger: { ...silentLogger, error: (message, fields) => errors.push({ message, fields }) } }, options);
  return { npc, stores, errors };
}
function heldDeadlineFixture() {
  const state = { wall: 100000, mono: 0 };
  const timers = new Map<TimerHandle, { callback: () => void; ms: number }>();
  const time = {
    clock: { now: () => state.wall, monotonicNow: () => state.mono },
    scheduler: {
      setTimeout(callback: () => void, ms: number) {
        const handle = {} as TimerHandle; timers.set(handle, { callback, ms }); return handle;
      },
      clearTimeout(handle: TimerHandle) { timers.delete(handle); },
    },
  };
  const calls: { request: NpcAnswerRequest; signal: AbortSignal; finish(value: { text: string }): void }[] = [];
  const responder: NpcResponder = { async start() {}, async stop() {},
    answer: (request, signal) => new Promise(resolve => calls.push({ request, signal, finish: resolve })),
  };
  // These timers are deliberately never delivered. Only clock checks can reject late work.
  return { ...service(responder, { maxConcurrent: 1, maxUnfinished: 4, timeoutMs: 30000 }, time), state, calls, timers };
}
it.each([false, true])('preserves only 10 s after a 20 s queue wait, with rollback=%s and held timers', async (rollback) => {
  const { npc, stores, state, calls, timers } = heldDeadlineFixture(); await npc.start();
  const first = npc.ask(question('1')); const second = npc.ask(question('2'));
  expect([...timers.values()].map(timer => timer.ms)).toEqual([30000, 30000]);
  state.mono = 20000; state.wall += rollback ? -60000 : 20000;
  calls[0]!.finish({ text: 'Первый' }); expect(await first).toEqual({ ok: true, text: 'Первый' });
  expect(calls).toHaveLength(2); expect(calls[1]!.request.deadlineAt - state.wall).toBe(10000);
  state.mono = 29999; state.wall += 9999;
  calls[1]!.finish({ text: 'Второй' }); expect(await second).toEqual({ ok: true, text: 'Второй' });
  expect(stores.dialogue.history('p2', 'n')).toHaveLength(1);
  expect(timers.size).toBe(0); await npc.stop();
});
it.each(['monotonic', 'wall'] as const)('does not dispatch an expired queued request when the %s deadline passes without timer delivery', async (mode) => {
  const { npc, stores, state, calls, timers } = heldDeadlineFixture(); await npc.start();
  const first = npc.ask(question('1')); const second = npc.ask(question('2'));
  if (mode === 'monotonic') { state.mono = 30000; state.wall -= 60000; }
  else { state.mono = 1000; state.wall += 30000; }
  calls[0]!.finish({ text: 'Поздний' });
  expect(await first).toEqual({ ok: false, reason: 'timeout' });
  expect(await second).toEqual({ ok: false, reason: 'timeout' }); expect(calls).toHaveLength(1);
  expect(stores.dialogue.history('p1', 'n')).toEqual([]); expect(stores.dialogue.history('p2', 'n')).toEqual([]);
  expect(timers.size).toBe(0); await npc.stop();
});
it.each([29999, 30000, 30001])('checks monotonic time before committing at %i ms after rollback, without timer delivery', async (elapsed) => {
  const { npc, stores, state, calls, timers } = heldDeadlineFixture(); await npc.start();
  const pending = npc.ask(question()); state.wall -= 60000; state.mono = elapsed;
  calls[0]!.finish({ text: 'Ответ' });
  expect(await pending).toEqual(elapsed < 30000 ? { ok: true, text: 'Ответ' } : { ok: false, reason: 'timeout' });
  expect(calls[0]!.signal.aborted).toBe(elapsed >= 30000);
  expect(stores.dialogue.history('p1', 'n')).toHaveLength(elapsed < 30000 ? 1 : 0);
  expect(timers.size).toBe(0); await npc.stop();
});
it.each([2000, 10000])('rechecks the budget after a synchronous history read consumes %i ms before dispatch', async (readMs) => {
  const { npc, stores, state, calls, timers } = heldDeadlineFixture(); await npc.start();
  const history = stores.dialogue.history.bind(stores.dialogue);
  stores.dialogue.history = (player, target) => {
    if (player === 'p2') { state.mono += readMs; state.wall -= 60000; }
    return history(player, target);
  };
  const first = npc.ask(question('1')); const second = npc.ask(question('2'));
  state.mono = 20000; state.wall += 20000; calls[0]!.finish({ text: 'Первый' }); await first;
  if (readMs < 10000) {
    expect(calls).toHaveLength(2); expect(calls[1]!.request.deadlineAt - state.wall).toBe(10000 - readMs);
    calls[1]!.finish({ text: 'Второй' }); expect(await second).toEqual({ ok: true, text: 'Второй' });
  } else {
    expect(await second).toEqual({ ok: false, reason: 'timeout' }); expect(calls).toHaveLength(1);
  }
  expect(timers.size).toBe(0); await npc.stop();
});
it('does not restore a shorter observed wall budget when the clock rolls back during history IO', async () => {
  const { npc, stores, state, calls } = heldDeadlineFixture(); await npc.start();
  const history = stores.dialogue.history.bind(stores.dialogue);
  stores.dialogue.history = (player, target) => {
    if (player === 'p2') state.wall -= 60000;
    return history(player, target);
  };
  const first = npc.ask(question('1')); const second = npc.ask(question('2'));
  state.mono = 10000; state.wall += 25000; calls[0]!.finish({ text: 'Первый' }); await first;
  expect(calls[1]!.request.deadlineAt - state.wall).toBe(5000);
  state.mono = 15000; calls[1]!.finish({ text: 'Поздний' });
  expect(await second).toEqual({ ok: false, reason: 'timeout' }); expect(history('p2', 'n')).toEqual([]);
  await npc.stop();
});
it('FIFO with one slot, four unfinished, one/player and the total 30 s queue deadline', async () => {
  vi.useFakeTimers(); const { npc, stores } = service(scripted({ delayMs: 11000 }, deps)); await npc.start();
  const delivered: string[] = [];
  const pending = ['1', '2', '3', '4'].map((id) => npc.ask(question(id)).then((answer) => { delivered.push(id); return answer; }));
  expect(await npc.ask(question('1', 'second'))).toEqual({ ok: false, reason: 'player-busy' });
  expect(await npc.ask(question('5'))).toEqual({ ok: false, reason: 'server-busy' });
  await vi.advanceTimersByTimeAsync(22000); expect(delivered).toEqual(['1', '2']);
  expect(stores.dialogue.history('p1', 'n')).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(8000); const results = await Promise.all(pending);
  expect(results.map((r) => r.ok)).toEqual([true, true, false, false]);
  expect(results[3]).toEqual({ ok: false, reason: 'timeout' }); await npc.stop();
});
it('commits a successful answer after 20 s within the 30 s overall deadline', async () => {
  vi.useFakeTimers(); const { npc, stores } = service(scripted({ delayMs: 20000 }, deps)); await npc.start();
  let settled = false;
  const pending = npc.ask(question()).then(result => { settled = true; return result; });
  await vi.advanceTimersByTimeAsync(19999); expect(settled).toBe(false);
  expect(stores.dialogue.history('p1', 'n')).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  expect((await pending).ok).toBe(true); expect(stores.dialogue.history('p1', 'n')).toHaveLength(1);
  await npc.stop();
});
it('passes only the remaining queue budget and holds a timed-out slot until physical settlement', async () => {
  vi.useFakeTimers(); const acceptedAt = Date.now();
  let finish!: (value: { text: string }) => void;
  const started: { deadline: number; at: number; signal: AbortSignal }[] = [];
  const responder: NpcResponder = {
    async start() {}, async stop() {},
    answer: (request, signal) => new Promise(resolve => {
      started.push({ deadline: request.deadlineAt, at: Date.now(), signal }); finish = resolve;
    }),
  };
  const { npc, stores, errors } = service(responder); await npc.start();
  const first = npc.ask(question('1')); const second = npc.ask(question('2'));
  await vi.advanceTimersByTimeAsync(20000); finish({ text: 'Первый' });
  expect(await first).toEqual({ ok: true, text: 'Первый' });
  expect(started.map(({ deadline, at }) => ({ deadline, at }))).toEqual([
    { deadline: acceptedAt + 30000, at: acceptedAt },
    { deadline: acceptedAt + 30000, at: acceptedAt + 20000 },
  ]);
  await vi.advanceTimersByTimeAsync(9999); expect(started[1]!.signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await second).toEqual({ ok: false, reason: 'timeout' }); expect(started[1]!.signal.aborted).toBe(true);
  expect(await npc.ask(question('2', 'retry'))).toEqual({ ok: false, reason: 'player-busy' });
  const queued = npc.ask(question('3')); expect(started).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(2000); expect(errors).toHaveLength(1);
  npc.cancelConnection('c3'); expect(await queued).toEqual({ ok: false, reason: 'cancelled' });
  finish({ text: 'Поздний' }); await vi.advanceTimersByTimeAsync(0);
  expect(stores.dialogue.history('p2', 'n')).toEqual([]);
  const next = npc.ask(question('2', 'new')); finish({ text: 'Новый' });
  expect(await next).toEqual({ ok: true, text: 'Новый' }); await npc.stop();
});
it('cancels queued and running work without history, preserving a stuck slot until settlement', async () => {
  vi.useFakeTimers(); let finish!: (value: { text: string }) => void;
  const responder: NpcResponder = { async start() {}, async stop() {}, answer: () => new Promise((resolve) => { finish = resolve; }) };
  const { npc, stores, errors } = service(responder); await npc.start();
  const running = npc.ask(question('1')); const queued = npc.ask(question('2'));
  npc.cancelConnection('c2'); expect(await queued).toEqual({ ok: false, reason: 'cancelled' });
  npc.cancelConnection('c1'); expect(await running).toEqual({ ok: false, reason: 'cancelled' });
  expect(await npc.ask(question('1'))).toEqual({ ok: false, reason: 'player-busy' });
  await vi.advanceTimersByTimeAsync(2000); expect(errors).toHaveLength(1);
  finish({ text: 'late' }); await vi.advanceTimersByTimeAsync(0);
  expect(stores.dialogue.history('p1', 'n')).toEqual([]);
  const next = npc.ask(question('1')); finish({ text: 'new' }); expect(await next).toEqual({ ok: true, text: 'new' }); await npc.stop();
});
it('normalizes and commits before resolving; failures are safe and never delivered as answers', async () => {
  const responder: NpcResponder = { async start() {}, async stop() {}, async answer() { return { text: ` \r\nA\t\x00${'z'.repeat(5000)}` }; } };
  const { npc, stores } = service(responder); await npc.start();
  const result = await npc.ask(question()); expect(result.ok && result.text.length).toBe(4000);
  expect(stores.dialogue.history('p1', 'n')[0]?.answer).toBe(result.ok && result.text);
  stores.dialogue.append = () => { throw new Error('secret SQL'); };
  expect(await npc.ask(question())).toEqual({ ok: false, reason: 'unavailable' });
  responder.answer = async () => { throw new Error('secret model'); };
  expect(await npc.ask(question())).toEqual({ ok: false, reason: 'unavailable' });
  expect(normalizeAnswer(' \r\nx\ty\u0080 ')).toBe('xy'); await npc.stop();
});
it('degraded start and shutdown keep requests unavailable and abort all work', async () => {
  const responder: NpcResponder = { async start() { throw new Error('start'); }, async stop() {}, async answer() { return { text: 'x' }; } };
  const { npc } = service(responder); await npc.start(); expect(npc.ready()).toBe(false);
  expect(await npc.ask(question())).toEqual({ ok: false, reason: 'unavailable' }); await npc.stop();
  vi.useFakeTimers(); const live = service(scripted({ delayMs: 3000 }, deps)); await live.npc.start();
  const pending = [live.npc.ask(question('1')), live.npc.ask(question('2'))]; await live.npc.stop();
  expect(await Promise.all(pending)).toEqual([{ ok: false, reason: 'cancelled' }, { ok: false, reason: 'cancelled' }]);
  expect(live.stores.dialogue.history('p1', 'n')).toEqual([]);
});
it('scripted recalls the previous question and changes repeated explanations even after history saturates', async () => {
  vi.useFakeTimers(); const { npc, stores } = service(scripted({ delayMs: 1 }, deps)); await npc.start();
  let previous = '';
  for (let i = 0; i < 10; i++) {
    const pending = npc.ask(question()); await vi.advanceTimersByTimeAsync(1); const answer = await pending;
    expect(answer.ok).toBe(true);
    if (answer.ok) { expect(answer.text).not.toBe(previous); if (i > 0) expect(answer.text).toContain('В прошлый раз ты спрашивал'); previous = answer.text; }
  }
  expect(stores.dialogue.history('p1', 'n')).toHaveLength(6); await npc.stop();
});
it('allows two slots only as configured and rejects empty answers', async () => {
  vi.useFakeTimers(); const { npc } = service(scripted({ delayMs: 100 }, deps), { maxConcurrent: 2, maxUnfinished: 4, timeoutMs: 8000 });
  await npc.start(); const pending = [npc.ask(question('1')), npc.ask(question('2'))];
  await vi.advanceTimersByTimeAsync(100); expect((await Promise.all(pending)).every((r) => r.ok)).toBe(true); await npc.stop();
  const empty = service({ async start() {}, async stop() {}, async answer() { return { text: '\x00  ' }; } });
  await empty.npc.start(); expect(await empty.npc.ask(question())).toEqual({ ok: false, reason: 'unavailable' }); await empty.npc.stop();
});
