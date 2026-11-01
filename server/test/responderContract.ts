import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHook } from 'node:async_hooks';
import { Socket } from 'node:net';
import type { NpcAnswerRequest, NpcResponder } from '../src/npc/NpcResponder.ts';
export const answerRequest = (): NpcAnswerRequest => ({ requestKey: 'c:r', playerId: 'p', playerName: 'Аня', npc: { id: 'n', name: 'Лея', topic: 'История', persona: 'Рассказывает спокойно', greeting: 'Привет' }, question: 'Вопрос', history: [], locale: 'ru', deadlineAt: Date.now() + 8000 });

/** Node-side contract guard only. A real subprocess needs separate OS/offline qualification. */
export async function auditResponderNetwork(action: () => Promise<void>, policy: 'none' | 'loopback' = 'none'): Promise<void> {
  let forbidden = 0;
  const original = Socket.prototype.connect;
  const hook = createHook({ init(_id, type) {
    if (type === 'UDPSENDWRAP' || type === 'GETADDRINFOREQWRAP' || (policy === 'none' && type === 'TCPCONNECTWRAP')) forbidden++;
  } });
  const spy = vi.spyOn(Socket.prototype, 'connect').mockImplementation(function (this: Socket, ...raw: unknown[]) {
    const args: unknown[] = Array.isArray(raw[0]) ? raw[0] : raw;
    const first = args[0];
    let allowed = false;
    if (policy === 'loopback') {
      if (first && typeof first === 'object') {
        const options = first as { host?: unknown; port?: unknown; path?: unknown };
        allowed = typeof options.path === 'string' || (['127.0.0.1', '::1'].includes(String(options.host)) && options.port !== undefined);
      } else if (typeof first === 'number') allowed = ['127.0.0.1', '::1'].includes(String(args[1]));
      else if (typeof first === 'string' && !/^\d+$/.test(first)) allowed = true; // Unix-domain IPC.
    }
    if (!allowed) { forbidden++; throw new Error('Responder attempted forbidden network access'); }
    return Reflect.apply(original, this, raw) as Socket;
  } as typeof Socket.prototype.connect);
  hook.enable();
  try { await action(); expect(forbidden).toBe(0); }
  finally { hook.disable(); spy.mockRestore(); }
}

/** Register for every adapter; real loopback and subprocess cases need explicit extra evidence. */
export function responderContract(name: string, factory: () => NpcResponder, options: { network?: 'none' | 'loopback'; realTimers?: boolean } = {}): void {
  describe(`NpcResponder contract: ${name}`, () => {
    afterEach(() => vi.useRealTimers());
    it('starts/stops repeatedly, answers nonempty and uses no external Node network', async () => {
      const responder = factory();
      await auditResponderNetwork(async () => {
        try {
          await responder.start(); await responder.start();
          const answer = await responder.answer(answerRequest(), new AbortController().signal);
          expect(answer.text.trim().length).toBeGreaterThan(0);
          await responder.stop(); await responder.stop();
        } finally { await responder.stop(); }
      }, options.network);
    });
    it('streams only before settlement: no partial after the answer or an abort', async () => {
      if (!options.realTimers) vi.useFakeTimers();
      const responder = factory(); await responder.start();
      const advance = async () => {
        if (options.realTimers) await new Promise(resolve => setTimeout(resolve, 25));
        else await vi.advanceTimersByTimeAsync(9000);
      };
      try {
        let settled = false; let late = 0;
        const answer = responder.answer(answerRequest(), new AbortController().signal, () => { if (settled) late++; }).finally(() => { settled = true; });
        await advance(); await answer; await advance(); expect(late).toBe(0);
        const controller = new AbortController(); let afterAbort = 0;
        const aborted = responder.answer(answerRequest(), controller.signal, () => { if (controller.signal.aborted) afterAbort++; });
        const rejected = expect(aborted).rejects.toThrow(); controller.abort(); await advance(); await rejected;
        expect(afterAbort).toBe(0);
      } finally { await responder.stop(); }
    });
    it('settles abort before and during answer within two seconds and respects deadline', async () => {
      if (!options.realTimers) vi.useFakeTimers();
      const responder = factory(); await responder.start();
      const settle = async (pending: Promise<unknown>, advance: number) => {
        const assertion = expect(pending).rejects.toThrow();
        if (options.realTimers) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try { await Promise.race([assertion, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Responder did not settle within 2 seconds')), 2000); })]); }
          finally { clearTimeout(timer); }
        } else { await vi.advanceTimersByTimeAsync(advance); await assertion; }
      };
      try {
        const aborted = new AbortController(); aborted.abort();
        await settle(responder.answer(answerRequest(), aborted.signal), 2000);
        const controller = new AbortController(); const pending = responder.answer(answerRequest(), controller.signal);
        const cancelled = settle(pending, 2000); controller.abort(); await cancelled;
        // A local backend can unload on abort; readiness must be explicit before the next question.
        await responder.start();
        await settle(responder.answer({ ...answerRequest(), deadlineAt: Date.now() + 1 }, new AbortController().signal), 1);
      } finally { await responder.stop(); }
    });
  });
}
