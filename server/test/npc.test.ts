import { afterEach, expect, it, vi } from 'vitest';
import { createNpcDialogueService, normalizeAnswer } from '../src/npc/NpcDialogueService.ts';
import { scripted } from '../src/npc/adapters/scripted.ts';
import { systemClock, systemScheduler } from '../src/common/time.ts';
import { memoryLogger } from '../src/common/logger.ts';
import type { NpcQuestion } from '../src/contracts.ts';
import type { NpcResponder } from '../src/npc/NpcResponder.ts';
import { memoryStores } from './memory.ts';
import { responderContract, answerRequest } from './responderContract.ts';
const deps = { clock: { now: systemClock.now }, scheduler: systemScheduler };
responderContract('scripted', () => scripted({ delayMs: 10 }, deps));
afterEach(() => vi.useRealTimers());
function question(id = '1', requestId = 'r'): NpcQuestion { return { connectionId: `c${id}`, requestId, player: { accountId: `a${id}`, playerId: `p${id}`, displayName: 'Аня' }, npc: answerRequest().npc, question: 'Расскажи' }; }
function service(responder: NpcResponder, options = { maxConcurrent: 1, maxUnfinished: 4, timeoutMs: 8000 }) {
  const stores = memoryStores(); const logger = memoryLogger();
  const npc = createNpcDialogueService({ ...deps, responder, dialogue: stores.dialogue, logger }, options);
  return { npc, stores, logger };
}
it('FIFO with one slot, four unfinished, one/player and total queue deadline', async () => {
  vi.useFakeTimers(); const { npc, stores } = service(scripted({ delayMs: 3000 }, deps)); await npc.start();
  const delivered: string[] = [];
  const pending = ['1', '2', '3', '4'].map((id) => npc.ask(question(id)).then((answer) => { delivered.push(id); return answer; }));
  expect(await npc.ask(question('1', 'second'))).toEqual({ ok: false, reason: 'player-busy' });
  expect(await npc.ask(question('5'))).toEqual({ ok: false, reason: 'server-busy' });
  await vi.advanceTimersByTimeAsync(6000); expect(delivered).toEqual(['1', '2']);
  expect(stores.dialogue.history('p1', 'n')).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(2000); const results = await Promise.all(pending);
  expect(results.map((r) => r.ok)).toEqual([true, true, false, false]);
  expect(results[3]).toEqual({ ok: false, reason: 'timeout' }); await npc.stop();
});
it('cancels queued and running work without history, preserving a stuck slot until settlement', async () => {
  vi.useFakeTimers(); let finish!: (value: { text: string }) => void;
  const responder: NpcResponder = { async start() {}, async stop() {}, answer: () => new Promise((resolve) => { finish = resolve; }) };
  const { npc, stores, logger } = service(responder); await npc.start();
  const running = npc.ask(question('1')); const queued = npc.ask(question('2'));
  npc.cancelConnection('c2'); expect(await queued).toEqual({ ok: false, reason: 'cancelled' });
  npc.cancelConnection('c1'); expect(await running).toEqual({ ok: false, reason: 'cancelled' });
  expect(await npc.ask(question('1'))).toEqual({ ok: false, reason: 'player-busy' });
  await vi.advanceTimersByTimeAsync(2000); expect(logger.records.filter((r) => r.event === 'npc.slot.stuck')).toHaveLength(1);
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
