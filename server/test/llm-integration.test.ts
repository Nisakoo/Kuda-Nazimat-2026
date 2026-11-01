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
    expect(() => createResponder('ollamaDiagnostic', {}, deps)).toThrow('Неизвестный');
    expect(parseConfig({ npc: { adapter: 'scripted', maxConcurrent: 2 } }, '/tmp/config.json').npc.maxConcurrent).toBe(2);
  });
  it.each([
    ['ollama_memory_insufficient', 'ollama_memory_insufficient'],
    ['memory_sample_ps_timeout', 'memory_sample_ps_timeout'],
    ['ollama_token_count_mismatch', 'ollama_token_count_mismatch'],
    ['secret prompt /Users/private/path', 'unavailable'],
  ])('logs only a fixed startup diagnostic (%s) and leaves health unavailable', async (failure, expected) => {
    const error = vi.fn();
    const responder: NpcResponder = {
      async start() { throw new Error('secret body and prompt'); }, async stop() {},
      async answer() { throw new Error(); }, status: () => 'unavailable', lastFailure: () => failure,
    };
    const service = createNpcDialogueService({ ...deps, responder, dialogue: memoryStores().dialogue, logger: { ...silentLogger, error } }, config);
    await service.start();
    expect(service.ready()).toBe(false);
    expect(error).toHaveBeenCalledExactlyOnceWith('NpcResponder недоступен: проверьте локальные пакеты, модель, платформу и профиль', { code: expected });
    expect(JSON.stringify(error.mock.calls)).not.toContain('secret');
    await service.stop();
  });
  it('logs ready only after successful startup and again after recovery', async () => {
    vi.useFakeTimers(); const info = vi.fn(); let status: 'ready' | 'unavailable' = 'unavailable';
    let finish!: () => void;
    const responder: NpcResponder = {
      start: vi.fn(() => new Promise<void>(resolve => { finish = () => { status = 'ready'; resolve(); }; })),
      async stop() { status = 'unavailable'; }, status: () => status, async answer() { return { text: 'Ответ' }; },
    };
    const service = createNpcDialogueService({ ...deps, responder, dialogue: memoryStores().dialogue, logger: { ...silentLogger, info } }, config);
    const started = service.start(); expect(info).not.toHaveBeenCalled();
    finish(); await started;
    expect(info).toHaveBeenCalledExactlyOnceWith('NPC готов к вопросам', { status: 'ready' });
    status = 'unavailable'; await service.ask(q()); await vi.advanceTimersByTimeAsync(2000);
    expect(info).toHaveBeenCalledTimes(1); finish(); await vi.advanceTimersByTimeAsync(0);
    expect(info).toHaveBeenCalledTimes(2); await service.stop();
  });
  it('does not log ready for failed startup or a startup completed after shutdown', async () => {
    for (const failure of [false, true]) {
      const info = vi.fn(); let finish!: () => void;
      const responder: NpcResponder = {
        start: () => new Promise<void>((resolve, reject) => { finish = () => failure ? reject(new Error('private')) : resolve(); }),
        async stop() {}, status: () => 'ready', async answer() { return { text: 'Ответ' }; },
      };
      const service = createNpcDialogueService({ ...deps, responder, dialogue: memoryStores().dialogue, logger: { ...silentLogger, info } }, config);
      const started = service.start(); const stopped = service.stop(); finish(); await started; await stopped;
      expect(info).not.toHaveBeenCalled();
    }
  });
  it('logs only bounded timing fields at timeout before abort clears diagnostics', async () => {
    vi.useFakeTimers(); const info = vi.fn(); let sample: ReturnType<NonNullable<NpcResponder['diagnostics']>>;
    const responder: NpcResponder = {
      async start() {}, async stop() {}, status: () => 'ready', diagnostics: () => sample,
      answer: (_request, signal) => new Promise((_resolve, reject) => {
        sample = { stage: 'decoding', elapsedMs: 100, promptTokens: 80, firstTokenMs: 40, outputChunks: 3, secret: 'private prompt' } as NonNullable<typeof sample>;
        signal.addEventListener('abort', () => { sample = undefined; reject(new Error('abort')); }, { once: true });
      }),
    };
    const service = createNpcDialogueService({ ...deps, responder, dialogue: memoryStores().dialogue, logger: { ...silentLogger, info } }, { ...config, timeoutMs: 100 });
    await service.start(); const pending = service.ask(q()); await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toEqual({ ok: false, reason: 'timeout' });
    expect(info).toHaveBeenLastCalledWith('Этапы ответа NPC', { reason: 'timeout', stage: 'decoding', elapsedMs: 100, promptTokens: 80, firstTokenMs: 40, outputChunks: 3 });
    expect(JSON.stringify(info.mock.calls)).not.toContain('private'); await service.stop();
  });
  it.each(['throws', 'bad-stage', 'unsafe-count', 'negative', 'missing-elapsed'])('ignores invalid timing (%s) without changing delivery', async (mode) => {
    const info = vi.fn();
    const responder: NpcResponder = {
      async start() {}, async stop() {}, status: () => 'ready', async answer() { return { text: 'Ответ' }; },
      diagnostics() {
        if (mode === 'throws') throw new Error('private');
        const value = { stage: mode === 'bad-stage' ? 'private stage' : 'complete', elapsedMs: 10,
          outputChunks: mode === 'unsafe-count' ? 4097 : mode === 'negative' ? -1 : 1 };
        if (mode === 'missing-elapsed') delete (value as Partial<typeof value>).elapsedMs;
        return value as NonNullable<ReturnType<NonNullable<NpcResponder['diagnostics']>>>;
      },
    };
    const service = createNpcDialogueService({ ...deps, responder, dialogue: memoryStores().dialogue, logger: { ...silentLogger, info } }, config);
    await service.start(); expect(await service.ask(q())).toEqual({ ok: true, text: 'Ответ' });
    expect(info).toHaveBeenCalledExactlyOnceWith('NPC готов к вопросам', { status: 'ready' }); await service.stop();
  });
  it('logs bounded timing after a successful committed answer', async () => {
    const info = vi.fn(); const store = memoryStores();
    const responder: NpcResponder = {
      async start() {}, async stop() {}, status: () => 'ready', async answer() { return { text: 'Ответ' }; },
      diagnostics: () => ({ stage: 'complete', elapsedMs: 50, promptTokens: 80, firstTokenMs: 20, outputChunks: 4 }),
    };
    const service = createNpcDialogueService({ ...deps, responder, dialogue: store.dialogue, logger: { ...silentLogger, info } }, config);
    await service.start(); expect(await service.ask(q())).toEqual({ ok: true, text: 'Ответ' });
    expect(store.dialogue.history('p', 'n')).toHaveLength(1);
    expect(info).toHaveBeenLastCalledWith('Этапы ответа NPC', { reason: 'completed', stage: 'complete', elapsedMs: 50, promptTokens: 80, firstTokenMs: 20, outputChunks: 4 });
    await service.stop();
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
  it.each([
    ['ollama_token_count_mismatch', 'ollama_token_count_mismatch'],
    ['resource_limit', 'resource_limit'],
    ['memory_sample_deadline', 'memory_sample_deadline'],
    ['secret body /Users/private/path', 'unavailable'],
  ])('logs a safe runtime failure once per outage, including after recovery (%s)', async (failure, expected) => {
    vi.useFakeTimers(); let status: 'ready' | 'unavailable' = 'unavailable';
    const error = vi.fn();
    const responder: NpcResponder = {
      async start() { status = 'ready'; }, async stop() { status = 'unavailable'; }, status: () => status,
      lastFailure: () => failure,
      async answer() { status = 'unavailable'; throw new Error('secret exception and prompt'); },
    };
    const stores = memoryStores();
    const service = createNpcDialogueService({ ...deps, responder, dialogue: stores.dialogue, logger: { ...silentLogger, error } }, config);
    await service.start();
    expect(await service.ask(q())).toEqual({ ok: false, reason: 'unavailable' });
    for (let i = 0; i < 3; i++) expect(await service.ask(q('p2', String(i)))).toEqual({ ok: false, reason: 'unavailable' });
    expect(error).toHaveBeenCalledExactlyOnceWith('NpcResponder недоступен во время игры', { code: expected });
    expect(JSON.stringify(error.mock.calls)).not.toContain('secret');
    expect(stores.dialogue.history('p', 'n')).toEqual([]);
    await vi.advanceTimersByTimeAsync(2000); expect(service.ready()).toBe(true);
    expect(await service.ask(q())).toEqual({ ok: false, reason: 'unavailable' });
    expect(error).toHaveBeenCalledTimes(2);
    await service.stop();
  });
  it('logs an idle backend failure on admission without flooding repeated unavailable questions', async () => {
    vi.useFakeTimers(); let status: 'ready' | 'unavailable' = 'ready'; const error = vi.fn();
    const responder: NpcResponder = {
      async start() {}, async stop() {}, status: () => status, lastFailure: () => 'memory_unavailable',
      answer: vi.fn(async () => ({ text: 'must not run' })),
    };
    const service = createNpcDialogueService({ ...deps, responder, dialogue: memoryStores().dialogue, logger: { ...silentLogger, error } }, config);
    await service.start(); status = 'unavailable';
    await service.ask(q()); await service.ask(q('p2'));
    expect(responder.answer).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledExactlyOnceWith('NpcResponder недоступен во время игры', { code: 'memory_unavailable' });
    await service.stop();
  });
  it.each(['cancelled', 'timeout'] as const)('distinguishes normal cancellation from an active timeout (%s)', async (reason) => {
    vi.useFakeTimers(); let status: 'ready' | 'unavailable' = 'ready'; const error = vi.fn();
    const responder: NpcResponder = {
      async start() {}, async stop() { status = 'unavailable'; }, status: () => status, lastFailure: () => 'aborted',
      answer: (_request, signal) => new Promise<{ text: string }>((_resolve, reject) => {
        signal.addEventListener('abort', () => { status = 'unavailable'; reject(new Error('secret cancelled computation')); }, { once: true });
      }),
    };
    const service = createNpcDialogueService({ ...deps, responder, dialogue: memoryStores().dialogue, logger: { ...silentLogger, error } }, { ...config, timeoutMs: 100 });
    await service.start(); const pending = service.ask(q());
    if (reason === 'cancelled') service.cancelConnection('cp');
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toEqual({ ok: false, reason });
    await service.ask(q('p2'));
    if (reason === 'timeout') expect(error).toHaveBeenCalledExactlyOnceWith('Истёк deadline ответа NPC', { code: 'timeout' });
    else expect(error).not.toHaveBeenCalled();
    await service.stop();
  });
  it('does not suppress a later outage when a timed-out responder remained ready', async () => {
    vi.useFakeTimers(); let status: 'ready' | 'unavailable' = 'ready'; let failure = 'timeout'; let shouldFail = false;
    const error = vi.fn();
    const responder: NpcResponder = {
      async start() {}, async stop() {}, status: () => status, lastFailure: () => failure,
      answer: (_request, signal) => new Promise<{ text: string }>((_resolve, reject) => {
        if (shouldFail) { status = 'unavailable'; failure = 'resource_limit'; reject(new Error('private failure')); return; }
        signal.addEventListener('abort', () => reject(new Error('private timeout')), { once: true });
      }),
    };
    const service = createNpcDialogueService({ ...deps, responder, dialogue: memoryStores().dialogue, logger: { ...silentLogger, error } }, { ...config, timeoutMs: 100 });
    await service.start(); const first = service.ask(q()); await vi.advanceTimersByTimeAsync(100);
    expect(await first).toEqual({ ok: false, reason: 'timeout' }); expect(service.ready()).toBe(true);
    expect(error).toHaveBeenCalledExactlyOnceWith('Истёк deadline ответа NPC', { code: 'timeout' });
    shouldFail = true;
    expect(await service.ask(q('p', 'next'))).toEqual({ ok: false, reason: 'unavailable' });
    expect(error).toHaveBeenNthCalledWith(2, 'NpcResponder недоступен во время игры', { code: 'resource_limit' });
    expect(error).toHaveBeenCalledTimes(2); await service.stop();
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
