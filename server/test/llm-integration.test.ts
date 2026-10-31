import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, Socket } from 'node:net';
import { parseConfig } from '../src/app/config.ts';
import { createResponder } from '../src/npc/adapters/index.ts';
import { createNpcDialogueService } from '../src/npc/NpcDialogueService.ts';
import type { NpcResponder } from '../src/npc/NpcResponder.ts';
import { systemClock, systemScheduler } from '../src/common/time.ts';
import { silentLogger } from '../src/common/logger.ts';
import { memoryStores } from './memory.ts';
import { answerRequest, auditResponderNetwork } from './responderContract.ts';

const deps = { clock: systemClock, scheduler: systemScheduler };
const config = { maxConcurrent: 1, maxUnfinished: 4, timeoutMs: 8000 };
const q = (player = 'p', id = 'r') => ({ connectionId: 'c' + player, requestId: id,
  player: { accountId: 'a' + player, playerId: player, displayName: 'Игрок' }, npc: answerRequest().npc, question: 'Вопрос' });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('configured game LLM integration without real models', () => {
  it('selects registered backends explicitly and does not permit an unqualified second slot', async () => {
    for (const adapter of ['ollama', 'mlx']) {
      const c = parseConfig({ npc: { adapter, options: {} } }, '/tmp/config.json');
      expect(c.npc.adapter).toBe(adapter); expect(c.npc.timeoutMs).toBe(8000);
      expect(() => parseConfig({ npc: { adapter, maxConcurrent: 2 } }, '/tmp/config.json')).toThrow('maxConcurrent');
      expect(() => createResponder(adapter, {}, deps)).toThrow(); // strict options, not a scripted fallback
    }
    expect(() => createResponder('auto', {}, deps)).toThrow('Неизвестный');
    expect(parseConfig({ npc: { adapter: 'scripted', maxConcurrent: 2 } }, '/tmp/config.json').npc.maxConcurrent).toBe(2);
  });
  it('reports an idle backend failure immediately and recovers once without replaying a question', async () => {
    vi.useFakeTimers(); let status: 'ready' | 'unavailable' = 'unavailable';
    const responder: NpcResponder = {
      start: vi.fn(async () => { status = 'ready'; }), stop: vi.fn(async () => { status = 'unavailable'; }),
      status: () => status, answer: vi.fn(async () => ({ text: 'Ответ модели' })),
    };
    const store = memoryStores();
    const service = createNpcDialogueService({ ...deps, responder, dialogue: store.dialogue, logger: silentLogger }, config);
    await service.start(); expect(service.ready()).toBe(true);
    status = 'unavailable'; expect(service.ready()).toBe(false);
    expect(await service.ask(q())).toEqual({ ok: false, reason: 'unavailable' });
    expect(await service.ask(q('p2'))).toEqual({ ok: false, reason: 'unavailable' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(responder.start).toHaveBeenCalledTimes(2); expect(responder.answer).not.toHaveBeenCalled();
    expect(service.ready()).toBe(true);
    expect(await service.ask(q('p', 'new'))).toEqual({ ok: true, text: 'Ответ модели' });
    expect(store.dialogue.history('p', 'n')).toHaveLength(1);
    await service.stop(); await vi.advanceTimersByTimeAsync(10000); expect(service.ready()).toBe(false);
  });
  it('clears queued jobs on physical backend failure, commits none, and does not start a restart loop', async () => {
    vi.useFakeTimers(); let status: 'ready' | 'unavailable' = 'ready'; let fail!: (error: Error) => void;
    let starts = 0;
    const responder: NpcResponder = {
      async start() { if (++starts > 1) throw new Error('missing model'); }, async stop() { status = 'unavailable'; }, status: () => status,
      answer: vi.fn(() => new Promise<{ text: string }>((_, reject) => { fail = reject; })),
    };
    const store = memoryStores();
    const service = createNpcDialogueService({ ...deps, responder, dialogue: store.dialogue, logger: silentLogger }, config);
    await service.start(); const first = service.ask(q()); const second = service.ask(q('p2'));
    status = 'unavailable'; fail(new Error('backend stopped'));
    expect(await first).toEqual({ ok: false, reason: 'unavailable' }); expect(await second).toEqual({ ok: false, reason: 'unavailable' });
    await vi.advanceTimersByTimeAsync(30000);
    expect(starts).toBe(2); expect(responder.answer).toHaveBeenCalledTimes(1); expect(service.ready()).toBe(false);
    expect(store.dialogue.history('p', 'n')).toEqual([]); await service.stop();
  });
  it('does not recover or reuse a slot while physical cancellation remains unsettled', async () => {
    vi.useFakeTimers(); let finish!: (text: { text: string }) => void; let status: 'ready' | 'unavailable' = 'ready';
    const responder: NpcResponder = { start: vi.fn(async () => { status = 'ready'; }), async stop() {}, status: () => status,
      answer: () => new Promise(resolve => { finish = resolve; }) };
    const service = createNpcDialogueService({ ...deps, responder, dialogue: memoryStores().dialogue, logger: silentLogger }, config);
    await service.start(); const pending = service.ask(q()); service.cancelConnection('cp'); status = 'unavailable';
    expect(await pending).toEqual({ ok: false, reason: 'cancelled' });
    expect(await service.ask(q('p2'))).toEqual({ ok: false, reason: 'unavailable' });
    await vi.advanceTimersByTimeAsync(5000); expect(responder.start).toHaveBeenCalledTimes(1);
    finish({ text: 'late' }); await vi.advanceTimersByTimeAsync(2000); expect(responder.start).toHaveBeenCalledTimes(2);
    await service.stop();
  });
  it('cancels a scheduled recovery on shutdown', async () => {
    vi.useFakeTimers(); const start = vi.fn(async () => {});
    const responder: NpcResponder = { start, async stop() {}, status: () => 'unavailable', async answer() { throw new Error(); } };
    const service = createNpcDialogueService({ ...deps, responder, dialogue: memoryStores().dialogue, logger: silentLogger }, config);
    await service.start(); await service.ask(q()); await service.stop(); await vi.advanceTimersByTimeAsync(5000);
    expect(start).toHaveBeenCalledTimes(1);
  });
});

describe('NPC contract network guard', () => {
  it('permits only explicit loopback TCP under the loopback policy', async () => {
    const server = createServer(socket => { socket.end(); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error();
    try {
      await auditResponderNetwork(async () => {
        await new Promise<void>((resolve, reject) => {
          const socket = new Socket(); socket.on('error', reject); socket.on('close', () => resolve()); socket.connect({ host: '127.0.0.1', port: address.port });
        });
      }, 'loopback');
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it('blocks non-loopback before connecting and does not resolve hostnames', async () => {
    for (const host of ['example.invalid', '192.0.2.1', 'localhost']) {
      await expect(auditResponderNetwork(async () => { const socket = new Socket(); socket.connect({ host, port: 12345 }); }, 'loopback')).rejects.toThrow('forbidden');
    }
  });
});
